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
TrustRegistry on Celo (42220):  0x6D4e004F73344F0e206bdD7b97D8a09b32129C6E
TrustRegistry on Base (8453):   0x6D4e004F73344F0e206bdD7b97D8a09b32129C6E
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

## Full API Reference

```
GET  /api/score/:address?chain=celo|base          → TrustScore (number)
GET  /api/profile/:address?chain=celo|base         → Full AgentProfile
GET  /api/report/:address?chain=celo|base          → Latest recibo (audit report)
GET  /api/batch?addresses=0x1,0x2&chain=celo       → Batch scores
POST /api/register                                  → Register agent
POST /api/audit/:address                            → Request fresh audit
GET  /api/stats                                     → Registry statistics
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
