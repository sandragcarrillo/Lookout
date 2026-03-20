// ─────────────────────────────────────────────────────────────────────────────
// Lookout Agent — Configuration
// ─────────────────────────────────────────────────────────────────────────────

export type Chain = 'celo' | 'base';

// ── Chain config ──────────────────────────────────────────────────────────────

export const CHAIN_CONFIG = {
  celo: {
    chainId: 42220,
    name: 'Celo',
    rpc: 'https://forno.celo.org',
    trustRegistry: '0xCe74337add024796C9061D88C0d9fa4836d02FE7' as `0x${string}`,
    explorerApi: 'https://celo.blockscout.com',
    explorerApiKey: process.env.CELOSCAN_API_KEY ?? '',
    explorer: 'https://celoscan.io',
    // Self Protocol Agent Registry on Celo (onchain ZK verification)
    selfAgentRegistry: '0xaC3DF9ABf80d0F5c020C06B04Cced27763355944' as `0x${string}`,
    // ERC-8004 tokenId of the Lookout auditor agent on this chain
    auditorErc8004Id: 2832,
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    trustRegistry: '0xCe74337add024796C9061D88C0d9fa4836d02FE7' as `0x${string}`,
    explorerApi: 'https://base.blockscout.com',
    explorerApiKey: process.env.BASESCAN_API_KEY ?? '',
    explorer: 'https://basescan.org',
    selfAgentRegistry: null,
    auditorErc8004Id: 34693,
  },
} as const satisfies Record<Chain, object>;

// ── Contract addresses ────────────────────────────────────────────────────────

export const ERC8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`;

// ── Lookout auditor identity ──────────────────────────────────────────────────

export const AUDITOR_ADDRESS = (process.env.AUDITOR_WALLET ?? '0xCd08B2269907d34Ff99C46AcfFE7a2e90059a2D8') as `0x${string}`;
export const AUDITOR_PRIVATE_KEY = (process.env.AUDITOR_PRIVATE_KEY ?? '') as `0x${string}`;

// Log file is at repo root (one level up from agent/)
export const AGENT_LOG_PATH = '../agent_log.json';

// ── Scoring thresholds ────────────────────────────────────────────────────────
//
//  Each range maps a raw count → sub-score out of 15.
//  Arrays are [threshold, score] pairs; first matching threshold wins.

export const SCORING = {
  // txCount: more transactions = more behavioral evidence
  txCount: [
    [100, 15],
    [50,  12],
    [20,   9],
    [10,   6],
    [5,    3],
    [0,    0],
  ] as [number, number][],

  // accountAge (days since first tx)
  accountAge: [
    [365, 15],
    [180, 12],
    [90,   9],
    [30,   6],
    [7,    3],
    [0,    0],
  ] as [number, number][],

  // counterparties: unique addresses interacted with
  counterparties: [
    [50, 15],
    [30, 12],
    [15,  9],
    [8,   6],
    [3,   3],
    [0,   0],
  ] as [number, number][],

  bonuses: {
    selfVerified:  15,
    ensName:        5,
    consistency:   10,
  },

  penalties: {
    highRevertRate: -10,  // >20% of txs fail (separate from successRate penalty)
    dormant:         -5,  // no activity in 30+ days
    suspicious:     -15,  // interaction with flagged address
  },

  thresholds: {
    highRevertRate:  0.20,  // 20% fail rate triggers penalty
    dormantDays:     30,    // days without activity = dormant
    consistencyDays: 3,        // need activity on ≥ N distinct days for consistency bonus
    maxDayConcentration: 0.6,  // no single day > 60% of txs
    minTxsForAudit:  1,     // minimum txs required to compute a score
  },
} as const;

// ── Compute budget ────────────────────────────────────────────────────────────

export const COMPUTE_BUDGET = {
  maxApiCallsPerAudit: 10,
  maxRetries: 3,
  timeoutMs: 30_000,
} as const;

// ── Known flagged addresses (tornado cash, known drainers) ────────────────────
// In production this list would be fetched from a maintained registry.

export const FLAGGED_ADDRESSES = new Set([
  // Tornado Cash router
  '0x722122df12d4e14e13ac3b6895a86e84145b6967',
  // Tornado Cash proxy
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
  // Common Celo/Base scam deployers (illustrative — replace with real list)
  '0x0000000000000000000000000000000000000bad',
].map(a => a.toLowerCase()));

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

export const TRUST_REGISTRY_ABI = [
  {
    name: 'isRegistered',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'registerAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    // Credit bureau model — anyone can register any address.
    inputs: [
      { name: '_agent',    type: 'address' },
      { name: '_erc8004Id', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getScore',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getFullProfile',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentAddress',    type: 'address' },
          { name: 'erc8004Id',       type: 'uint256' },
          { name: 'score',           type: 'uint256' },
          {
            name: 'breakdown',
            type: 'tuple',
            components: [
              { name: 'txCount',          type: 'uint8'  },
              { name: 'successRate',      type: 'uint8'  },
              { name: 'accountAge',       type: 'uint8'  },
              { name: 'counterparties',   type: 'uint8'  },
              { name: 'selfBonus',        type: 'uint8'  },
              { name: 'ensBonus',         type: 'uint8'  },
              { name: 'consistencyBonus', type: 'uint8'  },
              { name: 'penalties',        type: 'int8'   },
            ],
          },
          { name: 'isHumanBacked',   type: 'bool'    },
          { name: 'isActive',        type: 'bool'    },
          { name: 'firstSeenAt',     type: 'uint256' },
          { name: 'lastAuditedAt',   type: 'uint256' },
          { name: 'auditCount',      type: 'uint256' },
          { name: 'latestReportCID', type: 'string'  },
        ],
      },
    ],
  },
  {
    name: 'updateScore',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_agent',    type: 'address' },
      { name: '_score',    type: 'uint256' },
      {
        name: '_breakdown',
        type: 'tuple',
        components: [
          { name: 'txCount',          type: 'uint8' },
          { name: 'successRate',      type: 'uint8' },
          { name: 'accountAge',       type: 'uint8' },
          { name: 'counterparties',   type: 'uint8' },
          { name: 'selfBonus',        type: 'uint8' },
          { name: 'ensBonus',         type: 'uint8' },
          { name: 'consistencyBonus', type: 'uint8' },
          { name: 'penalties',        type: 'int8'  },
        ],
      },
      { name: '_reportCID', type: 'string' },
    ],
    outputs: [],
  },
] as const;

export const SELF_REGISTRY_ABI = [
  {
    name: 'isVerifiedAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
