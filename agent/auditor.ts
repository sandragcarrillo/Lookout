#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Lookout Auditor Agent — Main audit loop
//
//   Usage:
//     npx tsx auditor.ts <address> [--chain celo|base]
//
//   ENV:
//     AUDITOR_PRIVATE_KEY  — Lookout auditor wallet private key (0x...)
//     AUDITOR_WALLET       — Auditor wallet address
//     CELOSCAN_API_KEY     — Celoscan API key (optional, free tier works)
//     BASESCAN_API_KEY     — Basescan API key (optional)
//
//   Flow:
//     DISCOVER → PLAN → EXECUTE → VERIFY → SUBMIT → LOG
// ─────────────────────────────────────────────────────────────────────────────

import { createPublicClient, createWalletClient, http, getAddress, padHex, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, base, mainnet } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  type Chain,
  CHAIN_CONFIG,
  TRUST_REGISTRY_ABI,
  SELF_REGISTRY_ABI,
  COMPUTE_BUDGET,
  AGENT_LOG_PATH,
  AUDITOR_ADDRESS,
  AUDITOR_PRIVATE_KEY,
} from './config.js';
import { computeScore, trustLevel, type RawTransaction } from './scorer.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, AGENT_LOG_PATH);

// ── Logging helpers ───────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[Lookout] ${new Date().toISOString()} — ${msg}`);
}
function warn(msg: string): void {
  console.warn(`[Lookout][WARN] ${msg}`);
}
function die(msg: string, code = 1): never {
  console.error(`[Lookout][ERROR] ${msg}`);
  process.exit(code);
}

// ── API helpers ───────────────────────────────────────────────────────────────

// Blockscout v2 REST API response shape
interface BlockscoutTx {
  hash: string;
  block: number;
  timestamp: string;   // ISO 8601
  from: { hash: string };
  to: { hash: string } | null;
  value: string;
  result: string;      // 'success' | 'error' | 'pending'
  raw_input: string;
  method?: string;     // decoded method name (may include args)
}

interface BlockscoutPage {
  items: BlockscoutTx[];
  next_page_params: Record<string, string | number> | null;
}

/** Convert Blockscout v2 tx shape → the RawTransaction shape scorer.ts expects */
function normalizeBlockscoutTx(tx: BlockscoutTx, ownerAddress: string): RawTransaction {
  return {
    hash:          tx.hash,
    blockNumber:   String(tx.block),
    timeStamp:     String(Math.floor(new Date(tx.timestamp).getTime() / 1000)),
    from:          tx.from?.hash ?? ownerAddress,
    to:            tx.to?.hash ?? '',
    value:         tx.value ?? '0',
    isError:       tx.result === 'success' ? '0' : '1',
    input:         tx.raw_input ?? '0x',
    functionName:  tx.method ?? '',
  };
}

async function fetchOnePage(url: string): Promise<BlockscoutPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPUTE_BUDGET.timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Lookout/1.0' },
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json() as BlockscoutPage;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTransactions(
  address: string,
  chain: Chain,
  apiCallCount: { n: number },
): Promise<RawTransaction[]> {
  const cfg = CHAIN_CONFIG[chain];
  if (apiCallCount.n >= COMPUTE_BUDGET.maxApiCallsPerAudit) {
    throw new Error('Compute budget: max API calls reached');
  }

  // Blockscout v2 REST endpoint (no API key required)
  const blockscoutBase = chain === 'celo'
    ? 'https://celo.blockscout.com'
    : 'https://base.blockscout.com';

  log(`Fetching txs from ${cfg.name} Blockscout...`);

  const allTxs: RawTransaction[] = [];
  let url: string | null = `${blockscoutBase}/api/v2/addresses/${address}/transactions`;
  const MAX_PAGES = 4; // up to 200 txs (50 per page)

  for (let page = 0; page < MAX_PAGES && url; page++) {
    apiCallCount.n++;
    if (apiCallCount.n > COMPUTE_BUDGET.maxApiCallsPerAudit) {
      warn('Compute budget: stopping pagination early');
      break;
    }

    let lastErr: Error | undefined;
    let data: BlockscoutPage | undefined;

    for (let attempt = 0; attempt < COMPUTE_BUDGET.maxRetries; attempt++) {
      try {
        data = await fetchOnePage(url);
        break;
      } catch (err) {
        lastErr = err as Error;
        if (attempt < COMPUTE_BUDGET.maxRetries - 1) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    if (!data) throw lastErr ?? new Error('Failed to fetch transactions');

    const normalized = data.items.map(tx => normalizeBlockscoutTx(tx, address));
    allTxs.push(...normalized);

    // Build next page URL from cursor params
    if (data.next_page_params && page < MAX_PAGES - 1) {
      const params = new URLSearchParams(
        Object.fromEntries(
          Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)])
        )
      );
      url = `${blockscoutBase}/api/v2/addresses/${address}/transactions?${params}`;
    } else {
      url = null;
    }
  }

  return allTxs;
}

/**
 * Fetch the wallet's very first transaction using the Etherscan-compat API
 * that Blockscout also exposes at /api (not /api/v2). This endpoint supports
 * sort=asc&offset=1 which the v2 REST endpoint rejects with 422.
 * Returns null on error so callers fall back to the batch-minimum timestamp.
 */
async function fetchFirstTransaction(
  address: string,
  chain: Chain,
  apiCallCount: { n: number },
): Promise<RawTransaction | null> {
  if (apiCallCount.n >= COMPUTE_BUDGET.maxApiCallsPerAudit) return null;

  const blockscoutBase = chain === 'celo'
    ? 'https://celo.blockscout.com'
    : 'https://base.blockscout.com';

  // Etherscan-compat API: sort=asc, page=1, offset=1 → the very first tx
  const url = `${blockscoutBase}/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=1`;

  apiCallCount.n++;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMPUTE_BUDGET.timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Lookout/1.0' },
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = await resp.json() as { status: string; result: RawTransaction[] | string };
    if (data.status !== '1' || !Array.isArray(data.result) || !data.result[0]) return null;
    return data.result[0];
  } catch {
    return null;
  }
}

// ── Onchain read helpers (viem) ───────────────────────────────────────────────

function makePublicClient(chain: Chain) {
  const viemChain = chain === 'celo' ? celo : base;
  return createPublicClient({
    chain: viemChain,
    transport: http(CHAIN_CONFIG[chain].rpc),
  });
}

async function isRegistered(address: `0x${string}`, chain: Chain): Promise<boolean> {
  const client = makePublicClient(chain);
  return client.readContract({
    address: CHAIN_CONFIG[chain].trustRegistry,
    abi: TRUST_REGISTRY_ABI,
    functionName: 'isRegistered',
    args: [address],
  }) as Promise<boolean>;
}

async function checkSelfVerified(address: `0x${string}`, chain: Chain): Promise<boolean> {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg.selfAgentRegistry) return false; // Self not deployed on this chain

  const client = makePublicClient(chain);
  // agentKey = bytes32(uint256(uint160(address)))
  const agentKey = padHex(address.toLowerCase() as `0x${string}`, { size: 32 });

  try {
    return await client.readContract({
      address: cfg.selfAgentRegistry,
      abi: SELF_REGISTRY_ABI,
      functionName: 'isVerifiedAgent',
      args: [agentKey],
    }) as boolean;
  } catch {
    warn('Self Protocol check failed — treating as not verified');
    return false;
  }
}

async function resolveEns(address: `0x${string}`): Promise<string | null> {
  // ENS resolution queries mainnet Ethereum regardless of audit chain
  const ethClient = createPublicClient({
    chain: mainnet,
    transport: http('https://eth.llamarpc.com'),
  });
  try {
    const name = await ethClient.getEnsName({ address });
    return name ?? null;
  } catch {
    return null;
  }
}

// ── Onchain write (viem walletClient) ─────────────────────────────────────────

async function writeScoreOnchain(
  target: `0x${string}`,
  score: number,
  breakdown: ReturnType<typeof computeScore>['breakdown'],
  reportCID: string,
  chain: Chain,
): Promise<string> {
  if (!AUDITOR_PRIVATE_KEY || AUDITOR_PRIVATE_KEY === '0x') {
    throw new Error('AUDITOR_PRIVATE_KEY not set');
  }

  const account = privateKeyToAccount(AUDITOR_PRIVATE_KEY);
  const viemChain = chain === 'celo' ? celo : base;

  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(CHAIN_CONFIG[chain].rpc),
  });

  const hash = await walletClient.writeContract({
    address: CHAIN_CONFIG[chain].trustRegistry,
    abi: TRUST_REGISTRY_ABI,
    functionName: 'updateScore',
    args: [
      target,
      BigInt(score),
      {
        txCount:          breakdown.txCount,
        successRate:      breakdown.successRate,
        accountAge:       breakdown.accountAge,
        counterparties:   breakdown.counterparties,
        selfBonus:        breakdown.selfBonus,
        ensBonus:         breakdown.ensBonus,
        consistencyBonus: breakdown.consistencyBonus,
        penalties:        breakdown.penalties,
      },
      reportCID,
    ],
  });

  return hash;
}

// ── Report generator ──────────────────────────────────────────────────────────

function generateReport(
  target: string,
  chain: Chain,
  result: ReturnType<typeof computeScore>,
  ensName: string | null,
  selfVerified: boolean,
  txHash: string | null,
  runId: string,
): string {
  const now = new Date().toISOString();
  const bd = result.breakdown;
  const level = trustLevel(result.score);
  const levelEmoji = { highly_trusted: '💎', trusted: '🟢', caution: '🟡', not_trusted: '🔴' }[level];
  const cfg = CHAIN_CONFIG[chain];

  return `# Lookout Audit Report — ${runId}

**Agent:** ${ensName ?? target}
**Address:** \`${target}\`
**Chain:** ${cfg.name} (${cfg.chainId})
**Audited at:** ${now}
**Run ID:** ${runId}

---

## TrustScore: ${result.score}/100 — ${levelEmoji} ${level.replace('_', ' ').toUpperCase()}

| Component | Score | Max |
|---|---|---|
| Transaction count | ${bd.txCount} | 15 |
| Success rate | ${bd.successRate} | 15 |
| Account age | ${bd.accountAge} | 15 |
| Counterparty diversity | ${bd.counterparties} | 15 |
| Self Protocol verified | ${bd.selfBonus} | 15 |
| ENS identity | ${bd.ensBonus} | 5 |
| Consistency | ${bd.consistencyBonus} | 10 |
| Penalties | ${bd.penalties} | 0 |
| **Total** | **${result.score}** | **100** |

---

## Behavioral Summary

- **Total transactions:** ${result.totalTxs}
- **Successful:** ${result.successfulTxs} (${result.totalTxs > 0 ? Math.round((result.successfulTxs / result.totalTxs) * 100) : 0}%)
- **Failed/reverted:** ${result.failedTxs}
- **Unique counterparties:** ${result.uniqueCounterparties}
- **Account age:** ${Math.round(result.accountAgeDays)} days
- **Human-backed (Self Protocol):** ${selfVerified ? '✅ Verified' : '❌ Not verified'}
- **ENS name:** ${ensName ?? 'None'}
${result.flaggedAddressesFound.length > 0 ? `- **⚠️ Flagged addresses found:** ${result.flaggedAddressesFound.join(', ')}` : '- **Flagged addresses:** None'}

---

## Transaction Breakdown

| Type | Count |
|---|---|
| Transfers | ${result.classifiedTxs.filter(t => t.type === 'transfer').length} |
| Swaps | ${result.classifiedTxs.filter(t => t.type === 'swap').length} |
| Contract calls | ${result.classifiedTxs.filter(t => t.type === 'contract_call').length} |
| Failed | ${result.classifiedTxs.filter(t => t.type === 'failed').length} |

---

## Trust Decision

\`\`\`
score = ${result.score}, humanBacked = ${selfVerified}

${result.score >= 51 && selfVerified  ? '→ PROCEED (trusted + human-backed)' :
  result.score >= 51                  ? '→ PROCEED WITH CAUTION (trusted but not human-verified)' :
  result.score >= 26                  ? '→ HIGH CAUTION (small transactions only)' :
                                        '→ ABORT — find another counterparty'}
\`\`\`

---

${txHash ? `**Onchain record:** [${txHash}](${cfg.explorer}/tx/${txHash})` : '_Score not written onchain (no auditor key configured)_'}

_Generated by [Lookout](https://lookout.watch) — The credit score for AI agents_
`;
}

// ── Log file management ───────────────────────────────────────────────────────

interface LogEntry {
  runId: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  chain: string;
  input: object;
  decisions: object[];
  toolCalls: object[];
  output: object;
  computeMetrics: object;
  error?: string;
}

interface AgentLog {
  agent: string;
  version: string;
  agentAddress: string;
  erc8004TokenId: string;
  runs: LogEntry[];
}

function appendToLog(entry: LogEntry): void {
  let agentLog: AgentLog = {
    agent: 'Lookout',
    version: '1.0.0',
    agentAddress: AUDITOR_ADDRESS,
    erc8004TokenId: '2832',
    runs: [],
  };

  if (existsSync(LOG_PATH)) {
    try {
      const raw = readFileSync(LOG_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as AgentLog;
      // Remove the template entry on first real write
      agentLog = {
        ...parsed,
        runs: parsed.runs.filter(r => r.status !== 'template'),
      };
    } catch {
      warn('Could not parse existing agent_log.json — starting fresh');
    }
  }

  agentLog.runs.push(entry);
  writeFileSync(LOG_PATH, JSON.stringify(agentLog, null, 2));
  log(`Log appended → ${LOG_PATH} (total runs: ${agentLog.runs.length})`);
}

// ── Audit result type (returned to both CLI and API callers) ──────────────────

export interface AuditResult {
  runId: string;
  targetAddress: string;
  chain: string;
  score: number;
  level: string;
  breakdown: ReturnType<typeof computeScore>['breakdown'];
  totalTxs: number;
  successfulTxs: number;
  failedTxs: number;
  uniqueCounterparties: number;
  accountAgeDays: number;
  isHumanBacked: boolean;
  ensName: string | null;
  reportContent: string;
  reportCID: string;
  txHash: string | null;
  durationMs: number;
  decisions: object[];
  toolCalls: object[];
  apiCallsUsed: number;
}

// ── Main audit function ───────────────────────────────────────────────────────

export async function audit(targetAddress: string, chain: Chain): Promise<AuditResult> {
  const startMs = Date.now();
  const runId = `run_${Date.now()}`;
  const target = getAddress(targetAddress) as `0x${string}`;
  const cfg = CHAIN_CONFIG[chain];
  const decisions: object[] = [];
  const toolCalls: object[] = [];
  let apiCallCount = { n: 0 };

  log(`Starting audit — target: ${target}, chain: ${chain}, run: ${runId}`);

  // ── DISCOVER ────────────────────────────────────────────────────────────────
  log('DISCOVER: checking registration status...');

  let registered = false;
  const discoverStart = Date.now();
  try {
    registered = await isRegistered(target, chain);
  } catch (err) {
    warn(`Could not check registration: ${(err as Error).message}`);
  }
  toolCalls.push({
    tool: 'trust_registry_read',
    action: `isRegistered(${target})`,
    startedAt: new Date(discoverStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - discoverStart,
    success: true,
    result: registered,
    retries: 0,
    error: null,
  });

  decisions.push({
    step: 1,
    decision: registered ? 'Agent is pre-registered in TrustRegistry' : 'Agent not yet in TrustRegistry — updateScore() will auto-register on first audit',
    reasoning: 'Credit bureau model: auditor can score any address; contract auto-registers on first updateScore() call',
    outcome: 'proceed_with_write',
  });

  // ── PLAN ────────────────────────────────────────────────────────────────────
  log('PLAN: estimating required API calls...');
  decisions.push({
    step: 2,
    decision: 'Fetch recent txs + first tx (for account age), check Self Protocol, resolve ENS',
    reasoning: `Budget: ${COMPUTE_BUDGET.maxApiCallsPerAudit} API calls max. Recent txs (4 pages) = 4, first tx = 1, Self = onchain, ENS = 1. Total ≤ 6.`,
    outcome: 'within_budget',
  });

  // ── EXECUTE ─────────────────────────────────────────────────────────────────
  log('EXECUTE: fetching transactions (recent batch + oldest tx)...');

  let rawTxs: RawTransaction[] = [];
  const txFetchStart = Date.now();
  let txFetchError: string | null = null;
  try {
    rawTxs = await fetchTransactions(target, chain, apiCallCount);
    log(`Fetched ${rawTxs.length} transactions`);
  } catch (err) {
    txFetchError = (err as Error).message;
    warn(`Transaction fetch failed: ${txFetchError}`);
  }
  toolCalls.push({
    tool: 'blockscout_api',
    action: `GET txlist?address=${target} (recent, desc)`,
    startedAt: new Date(txFetchStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - txFetchStart,
    success: txFetchError === null,
    txsFetched: rawTxs.length,
    retries: 0,
    error: txFetchError,
  });

  // Fetch wallet's true first transaction for accurate accountAge
  // (the recent-batch fetch only goes back 200 txs, missing older history)
  log('EXECUTE: fetching oldest transaction for account age...');
  let walletFirstTxAt: number | undefined;
  const firstTxFetchStart = Date.now();
  try {
    const firstTx = await fetchFirstTransaction(target, chain, apiCallCount);
    if (firstTx) {
      walletFirstTxAt = parseInt(firstTx.timeStamp, 10);
      const ageDays = Math.round((Date.now() / 1000 - walletFirstTxAt) / 86_400);
      log(`First tx: ${new Date(walletFirstTxAt * 1000).toISOString().slice(0, 10)} (${ageDays} days ago)`);
    }
  } catch (err) {
    warn(`First-tx fetch failed: ${(err as Error).message} — account age may be understated`);
  }
  toolCalls.push({
    tool: 'blockscout_api',
    action: `GET txlist?address=${target}&sort=asc (oldest tx)`,
    startedAt: new Date(firstTxFetchStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - firstTxFetchStart,
    success: walletFirstTxAt !== undefined,
    firstTxAt: walletFirstTxAt ?? null,
    retries: 0,
    error: null,
  });

  // Self Protocol check (onchain read — doesn't count against API budget)
  log('EXECUTE: checking Self Protocol verification...');
  const selfStart = Date.now();
  let selfVerified = false;
  try {
    selfVerified = await checkSelfVerified(target, chain);
    log(`Self Protocol: ${selfVerified ? '✅ verified' : '❌ not verified'}`);
  } catch (err) {
    warn(`Self Protocol check failed: ${(err as Error).message}`);
  }
  toolCalls.push({
    tool: 'self_protocol_verify',
    action: `isVerifiedAgent(${target})`,
    startedAt: new Date(selfStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - selfStart,
    success: true,
    isHumanBacked: selfVerified,
    retries: 0,
    error: null,
  });

  // ENS resolution
  log('EXECUTE: resolving ENS name...');
  const ensStart = Date.now();
  let ensName: string | null = null;
  try {
    ensName = await resolveEns(target);
    if (ensName) log(`ENS: ${ensName}`);
    else log('ENS: no name registered');
  } catch (err) {
    warn(`ENS resolution failed: ${(err as Error).message}`);
  }
  toolCalls.push({
    tool: 'ens_resolver',
    action: `getEnsName(${target})`,
    startedAt: new Date(ensStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - ensStart,
    success: true,
    result: ensName,
    retries: 0,
    error: null,
  });

  // Run scoring engine
  log('EXECUTE: computing TrustScore...');
  const scoringResult = computeScore(rawTxs, target, {
    selfVerified,
    ensName,
    walletFirstTxAt,
  });

  decisions.push({
    step: 3,
    decision: `Score computed: ${scoringResult.score}/100 (${trustLevel(scoringResult.score)})`,
    reasoning: `base=${scoringResult.breakdown.txCount + scoringResult.breakdown.successRate + scoringResult.breakdown.accountAge + scoringResult.breakdown.counterparties}, bonuses=${scoringResult.breakdown.selfBonus + scoringResult.breakdown.ensBonus + scoringResult.breakdown.consistencyBonus}, penalties=${scoringResult.breakdown.penalties}`,
    outcome: `score_${scoringResult.score}`,
  });

  // ── VERIFY ──────────────────────────────────────────────────────────────────
  log('VERIFY: validating result...');

  const validationErrors: string[] = [];
  if (scoringResult.score < 0 || scoringResult.score > 100) {
    validationErrors.push(`Score ${scoringResult.score} out of range [0, 100]`);
  }
  if (rawTxs.length < 1 && !txFetchError) {
    warn('No transactions found — scoring based on zero activity');
  }

  // Validate breakdown against contract rules
  const bd = scoringResult.breakdown;
  if (bd.txCount > 15 || bd.successRate > 15 || bd.accountAge > 15 || bd.counterparties > 15) {
    validationErrors.push('Base score component exceeds 15');
  }
  if (bd.selfBonus !== 0 && bd.selfBonus !== 15) validationErrors.push('selfBonus must be 0 or 15');
  if (bd.ensBonus !== 0  && bd.ensBonus !== 5)   validationErrors.push('ensBonus must be 0 or 5');
  if (bd.consistencyBonus !== 0 && bd.consistencyBonus !== 10) validationErrors.push('consistencyBonus must be 0 or 10');
  if (bd.penalties < -30 || bd.penalties > 0) validationErrors.push(`penalties ${bd.penalties} out of range [-30, 0]`);

  if (validationErrors.length > 0) {
    const msg = `Validation failed: ${validationErrors.join('; ')}`;
    die(msg);
  }

  decisions.push({
    step: 4,
    decision: 'Validation passed',
    reasoning: 'Score in [0,100], all breakdown fields within spec ranges',
    outcome: 'valid',
  });

  // ── SUBMIT ──────────────────────────────────────────────────────────────────

  // ── SUBMIT ──────────────────────────────────────────────────────────────────
  let txHash: string | null = null;
  const reportCID = '';

  // Write score onchain first so txHash is available in the report
  if (AUDITOR_PRIVATE_KEY && AUDITOR_PRIVATE_KEY !== '0x') {
    log(`SUBMIT: writing score ${scoringResult.score} onchain...`);
    const writeStart = Date.now();
    try {
      txHash = await writeScoreOnchain(target, scoringResult.score, scoringResult.breakdown, reportCID, chain);
      log(`Score written ✅ tx: ${txHash}`);
      log(`View: ${cfg.explorer}/tx/${txHash}`);
    } catch (err) {
      warn(`Failed to write score onchain: ${(err as Error).message}`);
    }
    toolCalls.push({
      tool: 'trust_registry_write',
      action: `updateScore(${target}, ${scoringResult.score}, breakdown, "${reportCID}")`,
      startedAt: new Date(writeStart).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - writeStart,
      success: txHash !== null,
      txHash,
      retries: 0,
      error: txHash ? null : 'write failed',
    });

    decisions.push({
      step: 5,
      decision: txHash ? `Score written onchain: ${txHash}` : 'Onchain write failed — score not persisted',
      reasoning: 'Called TrustRegistry.updateScore() — auto-registers agent on first audit if not already registered',
      outcome: txHash ? 'written' : 'write_failed',
    });
  } else {
    decisions.push({
      step: 5,
      decision: 'Skipped onchain write — no auditor private key',
      reasoning: 'AUDITOR_PRIVATE_KEY env var not set',
      outcome: 'skipped_no_key',
    });
  }

  // Generate report content
  log('SUBMIT: generating audit report...');
  const reportContent = generateReport(target, chain, scoringResult, ensName, selfVerified, txHash, runId);

  // keccak256 of report content as onchain identifier (no IPFS needed)
  const reportCIDFinal = keccak256(new TextEncoder().encode(reportContent));

  const durationMs = Date.now() - startMs;
  log(`Audit complete in ${durationMs}ms. Score: ${scoringResult.score} (${trustLevel(scoringResult.score)})`);

  return {
    runId,
    targetAddress: target,
    chain,
    score: scoringResult.score,
    level: trustLevel(scoringResult.score),
    breakdown: scoringResult.breakdown,
    totalTxs: scoringResult.totalTxs,
    successfulTxs: scoringResult.successfulTxs,
    failedTxs: scoringResult.failedTxs,
    uniqueCounterparties: scoringResult.uniqueCounterparties,
    accountAgeDays: Math.round(scoringResult.accountAgeDays),
    isHumanBacked: selfVerified,
    ensName,
    reportContent,
    reportCID: reportCIDFinal,
    txHash,
    durationMs,
    decisions,
    toolCalls,
    apiCallsUsed: apiCallCount.n,
  };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const chainIdx = args.findIndex(a => a === '--chain');
  let chain: Chain = 'celo';
  if (chainIdx !== -1 && args[chainIdx + 1]) {
    const c = args[chainIdx + 1] as Chain;
    if (c !== 'celo' && c !== 'base') die(`Unknown chain: ${c}. Use 'celo' or 'base'`);
    chain = c;
    args.splice(chainIdx, 2);
  }

  const targetAddress = args[0];
  if (!targetAddress) die('Usage: npx tsx auditor.ts <address> [--chain celo|base]');
  if (!/^0x[0-9a-fA-F]{40}$/.test(targetAddress)) die(`Invalid Ethereum address: ${targetAddress}`);

  const startedAt = new Date().toISOString();
  const result = await audit(targetAddress, chain);

  // CLI: save report to reports/ directory
  const reportsDir = resolve(__dirname, '../reports');
  mkdirSync(reportsDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const reportPath = resolve(reportsDir, `${result.targetAddress.slice(0, 8)}_${chain}_${dateStr}.md`);
  writeFileSync(reportPath, result.reportContent);
  log(`Report saved → ${reportPath}`);

  // CLI: append to agent_log.json
  appendToLog({
    runId: result.runId,
    type: 'audit',
    status: result.txHash ? 'completed' : 'completed_no_write',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    chain,
    input: { targetAddress: result.targetAddress, requestedBy: 'cli', trigger: 'manual' },
    decisions: result.decisions,
    toolCalls: result.toolCalls,
    output: {
      targetAddress: result.targetAddress,
      score: result.score,
      level: result.level,
      breakdown: result.breakdown,
      totalTxs: result.totalTxs,
      successfulTxs: result.successfulTxs,
      failedTxs: result.failedTxs,
      uniqueCounterparties: result.uniqueCounterparties,
      accountAgeDays: result.accountAgeDays,
      isHumanBacked: result.isHumanBacked,
      ensName: result.ensName,
      reportCID: result.reportCID,
      txHash: result.txHash,
      reportPath,
    },
    computeMetrics: {
      totalApiCalls: result.apiCallsUsed,
      totalRetries: 0,
      totalDurationMs: result.durationMs,
      budgetUsed: `${result.apiCallsUsed}/${COMPUTE_BUDGET.maxApiCallsPerAudit}`,
    },
  });
}

// Only run as CLI when executed directly (not when imported as a module)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[Lookout][FATAL]', err);
    process.exit(1);
  });
}
