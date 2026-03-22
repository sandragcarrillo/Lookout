# Lookout — Agent Trust Protocol

> Before your agent pays, trusts, or cooperates with another agent — check their TrustScore.

Lookout is an onchain reputation scoring layer for AI agents, built on top of [ERC-8004](https://www.8004.org).  
It audits agent behavior from public on-chain transactions and writes a composable TrustScore.

---

## Quick Score Check (read-only, no gas)

### Via API

```bash
GET https://lookout.watch/api/score/{walletAddress}?chain=celo|base [TBD]
```

Response:
```json
{
  "address": "0xABC...",
  "score": 73,
  "level": "trusted",
  "isHumanBacked": true,
  "erc8004Id": 42,
  "breakdown": {
    "txCount": 12,
    "successRate": 14,
    "accountAge": 13,
    "counterparties": 11,
    "selfBonus": 15,
    "ensBonus": 0,
    "consistencyBonus": 10,
    "penalties": -2
  },
  "lastAuditedAt": "2026-03-21T14:30:00Z",
  "reportCID": "QmXyz...",
  "chain": "celo"
}
```

### Via Smart Contract (direct on-chain read)

```
TrustRegistry on Celo Sepolia (testnet, 11142220): 0xAc800b34E85256DD8dd503b8E8e08893C9bDe57A
TrustRegistry on Base Sepolia  (testnet, 84532):   0xbC50290e05d9F159c0CB6db1008Acc0a1228AF55
TrustRegistry on Celo (42220):  0xCe74337add024796C9061D88C0d9fa4836d02FE7
TrustRegistry on Base (8453):   0xCe74337add024796C9061D88C0d9fa4836d02FE7
ERC-8004 IdentityRegistry:      0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
```

```solidity
// Solidity — check score before transacting
ITrustRegistry lookout = ITrustRegistry(LOOKOUT_ADDRESS);
uint256 score = lookout.getScore(counterpartyAddress);
bool human = lookout.isHumanBacked(counterpartyAddress);

// Batch check multiple agents
address[] memory agents = new address[](3);
agents[0] = 0xA...; agents[1] = 0xB...; agents[2] = 0xC...;
uint256[] memory scores = lookout.getScores(agents);
```

```typescript
// TypeScript (viem) — check score from frontend or agent
import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import { trustRegistryAbi } from './abi/TrustRegistry';

const client = createPublicClient({ chain: celo, transport: http() });

const score = await client.readContract({
  address: LOOKOUT_ADDRESS,
  abi: trustRegistryAbi,
  functionName: 'getScore',
  args: ['0xCounterpartyAddress'],
});

const profile = await client.readContract({
  address: LOOKOUT_ADDRESS,
  abi: trustRegistryAbi,
  functionName: 'getFullProfile',
  args: ['0xCounterpartyAddress'],
});
```

---

## Decision Logic for Your Agent

Before executing a transaction with another agent:

```
1. score = lookout.getScore(counterpartyAddress)
2. human = lookout.isHumanBacked(counterpartyAddress)

IF score >= 51 AND human == true  → PROCEED (trusted)
IF score >= 51 AND human == false → PROCEED WITH CAUTION (limit tx value)
IF score 26-50                    → HIGH CAUTION (small txs only, verify manually)
IF score < 26 OR not registered   → ABORT — find another counterparty
```

---

## Register Your Agent (start building reputation)

### Via API

```bash
POST https://lookout.watch/api/register
Content-Type: application/json

{
  "address": "0xYourAgentWallet",
  "chain": "celo",
  "erc8004Id": 42  // optional — your ERC-8004 tokenId
}
```

### Via Smart Contract

```solidity
// Anyone can register their agent
lookout.registerAgent(agentAddress, erc8004TokenId);
// Use 0 for erc8004TokenId if not registered in ERC-8004
```

Once registered, the Lookout auditor agent will periodically scan your agent's
on-chain transactions and compute a TrustScore.

---

## Verify the Human Behind Your Agent (+15 pts)

Use [Self Protocol](https://self.xyz) to prove there's a verified human
behind your agent without revealing your identity.

1. Download the Self app (iOS/Android)
2. Scan your passport or ID (ZK proof — no data leaves your device)
3. Connect at https://lookout.watch/verify
4. Your agent gets a `isHumanBacked = true` flag and +15 score bonus

---

## Scoring Model

```
TrustScore (0-100) = base_score + bonuses + penalties

base_score (0-60):
  txCount        0-15  — more transactions = more behavioral data
  successRate    0-15  — % of txs that didn't revert
  accountAge     0-15  — days since first on-chain tx
  counterparties 0-15  — unique addresses interacted with

bonuses (0-30):
  selfVerified   +15   — human behind agent verified via Self Protocol
  ensName        +5    — agent has ENS identity
  consistency    +10   — regular activity pattern, no suspicious bursts

penalties (-30 to 0):
  highRevertRate -10   — >20% of txs fail
  dormant        -5    — no activity in 30+ days
  suspicious     -15   — interaction with flagged addresses
```

---

## Trigger a Fresh Audit (x402 paid endpoint)

The `/api/audit/:address` endpoint requires a micro-payment of **$0.01 USDC** on the same chain as the audit target. This is settled via the [x402 protocol](https://x402.org) — HTTP-native, no API key needed.

### Using Thirdweb (recommended)

```typescript
import { createThirdwebClient } from 'thirdweb';
import { wrapFetchWithPayment } from 'thirdweb/x402';

const client = createThirdwebClient({ clientId: 'your-client-id' });
// wallet = any connected thirdweb wallet (or private key adapter — see below)

const fetchWithPayment = wrapFetchWithPayment(fetch, client, wallet);

const res = await fetchWithPayment(
  'https://lookout.watch/api/audit/0xAgentAddress?chain=celo',
  { method: 'POST' }
);
const audit = await res.json();
// { score, level, breakdown, report, txHash, ... }
```

### Using any x402-compatible client

Send a POST with an `X-PAYMENT` header containing a signed ERC-3009 `TransferWithAuthorization` payload (base64-encoded). The server returns HTTP 402 with a `PAYMENT-REQUIRED` header on the first call — decode it to get the exact payment requirements:

```
PAYMENT-REQUIRED: <base64-encoded JSON with network, asset, amount, payTo>
```

Payment details:
- **Chain**: same as `?chain=` param (`eip155:42220` Celo or `eip155:8453` Base)
- **Token**: USDC (`0xcebA9300f2b948710d2653dD7B07f33A8B32118C` on Celo, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base)
- **Amount**: `10000` (0.01 USDC, 6 decimals)
- **Pay to**: `0xa2E5D703Aeb869E7a165E39BD82463aE6Cf10772`
- **Signature type**: `TransferWithAuthorization` (ERC-3009)

### Private key adapter (server-to-server agents)

```typescript
import { createThirdwebClient, defineChain } from 'thirdweb';
import { wrapFetchWithPayment } from 'thirdweb/x402';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount('0xYourPrivateKey');
const chain   = defineChain(42220); // or 8453 for Base
const client  = createThirdwebClient({ clientId: 'your-client-id' });

const wallet = {
  getAccount:  () => account,
  getChain:    () => chain,
  switchChain: async () => {},
};

const fetchWithPayment = wrapFetchWithPayment(fetch, client, wallet as any);
const res = await fetchWithPayment(
  'https://lookout.watch/api/audit/0xAgentAddress?chain=celo',
  { method: 'POST' },
);
```

---

## Full API Reference

```
GET  /api/score/:address?chain=celo|base          → TrustScore (number, free)
GET  /api/profile/:address?chain=celo|base         → Full AgentProfile (free)
POST /api/audit/:address?chain=celo|base           → Fresh audit + onchain write ($0.01 USDC via x402)
```

---

## Contract Interface (ABI)

```solidity
interface ITrustRegistry {
    function getScore(address agent) external view returns (uint256);
    function getFullProfile(address agent) external view returns (AgentProfile memory);
    function isHumanBacked(address agent) external view returns (bool);
    function isRegistered(address agent) external view returns (bool);
    function getTrustLevel(address agent) external view returns (string memory);
    function getReportCID(address agent) external view returns (string memory);
    function getScores(address[] calldata agents) external view returns (uint256[] memory);
    function registerAgent(address agent, uint256 erc8004Id) external;
}
```

---

## Links

- Website: https://lookout.watch
- GitHub: https://github.com/sandralookout/lookout
- Contracts: Celo `[ADDRESS]` | Base `[ADDRESS]`
- Built with: ERC-8004, Self Protocol, Foundry, Next.js, Claude Code
- Built for: [The Synthesis](https://synthesis.md) hackathon 2026
