// ─────────────────────────────────────────────────────────────────────────────
// Lookout Agent — Scoring Engine (pure functions, no I/O)
// ─────────────────────────────────────────────────────────────────────────────

import { SCORING, FLAGGED_ADDRESSES } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw transaction as returned by Etherscan-compatible APIs */
export interface RawTransaction {
  hash: string;
  blockNumber: string;
  timeStamp: string;       // Unix seconds as string
  from: string;
  to: string;
  value: string;           // wei as string
  isError: string;         // '0' = success, '1' = reverted/failed
  input: string;           // '0x' = plain transfer; else contract call
  functionName?: string;   // decoded name if explorer supports it
  contractAddress?: string;
  txreceipt_status?: string;
}

export type TxType = 'transfer' | 'contract_call' | 'swap' | 'failed';

export interface ClassifiedTx {
  hash: string;
  type: TxType;
  from: string;
  to: string;
  timestamp: number;       // Unix seconds
  success: boolean;
}

/** Breakdown that maps directly to the Solidity ScoreBreakdown struct */
export interface ScoreBreakdown {
  txCount: number;          // 0–15
  successRate: number;      // 0–15
  accountAge: number;       // 0–15
  counterparties: number;   // 0–15
  selfBonus: number;        // 0 or 15
  ensBonus: number;         // 0 or 5
  consistencyBonus: number; // 0 or 10
  penalties: number;        // -30 to 0
}

export interface ScoringResult {
  score: number;
  breakdown: ScoreBreakdown;
  // diagnostic data (not stored onchain but written to agent_log.json)
  totalTxs: number;
  successfulTxs: number;
  failedTxs: number;
  uniqueCounterparties: number;
  accountAgeDays: number;
  firstTxAt: number;        // Unix seconds
  lastTxAt: number;         // Unix seconds
  flaggedAddressesFound: string[];
  classifiedTxs: ClassifiedTx[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Step-wise scoring: find the highest threshold the value exceeds.
 * thresholds are [minValue, score] pairs sorted descending.
 */
function stepScore(value: number, table: readonly [number, number][]): number {
  for (const [threshold, score] of table) {
    if (value >= threshold) return score;
  }
  return 0;
}

const SWAP_SIGNATURES = new Set([
  'swapExactTokensForTokens',
  'swapTokensForExactTokens',
  'swapExactETHForTokens',
  'swapTokensForExactETH',
  'swapExactTokensForETH',
  'swap',
  'exactInputSingle',
  'exactInput',
  'exactOutputSingle',
  'exactOutput',
  'multicall',
]);

function classifyOne(tx: RawTransaction, ownerAddress: string): ClassifiedTx {
  const success = tx.isError === '0';
  const isOutgoing = tx.from.toLowerCase() === ownerAddress.toLowerCase();

  let type: TxType;
  if (!success) {
    type = 'failed';
  } else if (isOutgoing) {
    const fn = (tx.functionName ?? '').split('(')[0].trim();
    if (SWAP_SIGNATURES.has(fn)) {
      type = 'swap';
    } else if (tx.input === '0x' || tx.input === '') {
      type = 'transfer';
    } else {
      type = 'contract_call';
    }
  } else {
    // Incoming tx — classify by input
    type = tx.input === '0x' || tx.input === '' ? 'transfer' : 'contract_call';
  }

  return {
    hash: tx.hash,
    type,
    from: tx.from.toLowerCase(),
    to: (tx.to ?? '').toLowerCase(),
    timestamp: parseInt(tx.timeStamp, 10),
    success,
  };
}

// ── Classify ──────────────────────────────────────────────────────────────────

export function classifyTransactions(
  txs: RawTransaction[],
  ownerAddress: string,
): ClassifiedTx[] {
  return txs.map(tx => classifyOne(tx, ownerAddress));
}

// ── Score components ──────────────────────────────────────────────────────────

function scoreTxCount(total: number): number {
  return stepScore(total, SCORING.txCount);
}

function scoreSuccessRate(successful: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((successful / total) * 15);
}

function scoreAccountAge(firstTxAt: number): number {
  const ageMs = Date.now() - firstTxAt * 1000;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return stepScore(ageDays, SCORING.accountAge);
}

function scoreCounterparties(unique: number): number {
  return stepScore(unique, SCORING.counterparties);
}

/**
 * Consistency bonus: award +10 if the agent has been active on at least
 * SCORING.thresholds.consistencyDays different calendar days AND no single
 * day accounts for more than maxDayConcentration of all transactions.
 *
 * We use daily buckets (not weekly) because AI agents can demonstrate
 * consistent behaviour within days; weekly buckets would unfairly penalise
 * wallets newer than 3 weeks.
 */
function consistencyBonus(classified: ClassifiedTx[]): number {
  if (classified.length < 3) return 0;

  const SECONDS_PER_DAY = 86_400;
  const dayCounts = new Map<number, number>();
  for (const tx of classified) {
    const day = Math.floor(tx.timestamp / SECONDS_PER_DAY);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const days = dayCounts.size;
  const maxInOneDay = Math.max(...dayCounts.values());
  const concentration = maxInOneDay / classified.length;

  if (
    days >= SCORING.thresholds.consistencyDays &&
    concentration <= SCORING.thresholds.maxDayConcentration
  ) {
    return SCORING.bonuses.consistency;
  }
  return 0;
}

/**
 * Penalty calculation. Returns a negative number (or 0).
 * - highRevertRate: >20% of txs fail → -10
 * - dormant: no tx in last 30 days → -5
 * - suspicious: interacted with a flagged address → -15
 *
 * Note: highRevertRate penalty is separate from successRate base score.
 * An address can still earn partial successRate points even with the penalty.
 */
function computePenalties(
  classified: ClassifiedTx[],
  flaggedFound: string[],
): number {
  let penalty = 0;

  const total = classified.length;
  const failed = classified.filter(t => !t.success).length;
  if (total > 0 && failed / total > SCORING.thresholds.highRevertRate) {
    penalty += SCORING.penalties.highRevertRate;
  }

  const lastTx = classified.reduce(
    (max, t) => (t.timestamp > max ? t.timestamp : max),
    0,
  );
  const daysSinceLast = (Date.now() / 1000 - lastTx) / (60 * 60 * 24);
  if (daysSinceLast > SCORING.thresholds.dormantDays) {
    penalty += SCORING.penalties.dormant;
  }

  if (flaggedFound.length > 0) {
    penalty += SCORING.penalties.suspicious;
  }

  // Clamp to [-30, 0] per contract validation rules
  return Math.max(-30, Math.min(0, penalty));
}

// ── Main scoring function ─────────────────────────────────────────────────────

export interface ScoringOptions {
  selfVerified: boolean;     // from Self Protocol onchain check
  ensName: string | null;    // null if no ENS name
  /** Unix seconds of the wallet's actual first-ever transaction.
   *  When provided, overrides the batch-minimum (which is only the oldest
   *  of the 200 most-recent txs and understates account age).
   *  If omitted, falls back to Math.min of batch timestamps. */
  walletFirstTxAt?: number;
}

export function computeScore(
  rawTxs: RawTransaction[],
  ownerAddress: string,
  opts: ScoringOptions,
): ScoringResult {
  const classified = classifyTransactions(rawTxs, ownerAddress);
  const total = classified.length;
  const successful = classified.filter(t => t.success).length;
  const failed = total - successful;

  // Unique counterparties (addresses that aren't the owner)
  const counterpartySet = new Set<string>();
  for (const tx of classified) {
    const other = tx.from === ownerAddress.toLowerCase() ? tx.to : tx.from;
    if (other && other !== ownerAddress.toLowerCase()) {
      counterpartySet.add(other);
    }
  }
  const uniqueCounterparties = counterpartySet.size;

  // Account age — prefer the explicitly-fetched first-tx timestamp so that
  // wallets with more than 200 txs aren't penalised by the batch window.
  const timestamps = classified.map(t => t.timestamp).filter(t => t > 0);
  const batchFirst = timestamps.length > 0 ? Math.min(...timestamps) : Math.floor(Date.now() / 1000);
  const firstTxAt  = opts.walletFirstTxAt && opts.walletFirstTxAt < batchFirst
    ? opts.walletFirstTxAt
    : batchFirst;
  const lastTxAt   = timestamps.length > 0 ? Math.max(...timestamps) : Math.floor(Date.now() / 1000);
  const ageMs = Date.now() - firstTxAt * 1000;
  const accountAgeDays = ageMs / (1000 * 60 * 60 * 24);

  // Flagged address check
  const flaggedFound: string[] = [];
  for (const tx of classified) {
    if (FLAGGED_ADDRESSES.has(tx.to)   && !flaggedFound.includes(tx.to))   flaggedFound.push(tx.to);
    if (FLAGGED_ADDRESSES.has(tx.from) && !flaggedFound.includes(tx.from)) flaggedFound.push(tx.from);
  }

  // Base scores
  const txCountScore       = scoreTxCount(total);
  const successRateScore   = scoreSuccessRate(successful, total);
  const accountAgeScore    = scoreAccountAge(firstTxAt);
  const counterpartiesScore = scoreCounterparties(uniqueCounterparties);

  // Bonuses
  const selfBonus        = opts.selfVerified  ? SCORING.bonuses.selfVerified : 0;
  const ensBonus         = opts.ensName       ? SCORING.bonuses.ensName      : 0;
  const consistencyScore = consistencyBonus(classified);

  // Penalties
  const penaltyTotal = computePenalties(classified, flaggedFound);

  // Total score, clamped 0–100
  const rawScore =
    txCountScore + successRateScore + accountAgeScore + counterpartiesScore +
    selfBonus + ensBonus + consistencyScore + penaltyTotal;
  const score = Math.max(0, Math.min(100, rawScore));

  const breakdown: ScoreBreakdown = {
    txCount:          txCountScore,
    successRate:      successRateScore,
    accountAge:       accountAgeScore,
    counterparties:   counterpartiesScore,
    selfBonus,
    ensBonus,
    consistencyBonus: consistencyScore,
    penalties:        penaltyTotal,
  };

  return {
    score,
    breakdown,
    totalTxs: total,
    successfulTxs: successful,
    failedTxs: failed,
    uniqueCounterparties,
    accountAgeDays,
    firstTxAt,
    lastTxAt,
    flaggedAddressesFound: flaggedFound,
    classifiedTxs: classified,
  };
}

// ── Trust level helper ────────────────────────────────────────────────────────

export function trustLevel(score: number): string {
  if (score >= 76) return 'highly_trusted';
  if (score >= 51) return 'trusted';
  if (score >= 26) return 'caution';
  return 'not_trusted';
}
