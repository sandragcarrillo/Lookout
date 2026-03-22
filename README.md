# Lookout: Agent Trust Protocol

> Before your agent pays, trusts, or cooperates with another agent, check their TrustScore.

Lookout is an onchain reputation scoring layer for AI agents. It audits agent behavior from public onchain transactions, integrates ZK identity verification via Self Protocol, and writes composable TrustScores that any agent, dApp, or human can query before transacting.

**One-liner:** The credit score for AI agents. Onchain, composable, ZK-verified.

Built on [ERC-8004](https://www.8004.org) agent identity standard. Deployed on **Celo** + **Base** mainnets.

**Live:** https://lookout-agent.vercel.app

---

## How It Works

```
1. Any agent POSTs to /api/audit/{address} — no target cooperation required
2. Lookout fetches transaction history from Blockscout (Celo) / Basescan (Base)
3. Behavioral TrustScore (0-100) is calculated from tx patterns
4. Score + breakdown written onchain to TrustRegistry (credit bureau model)
5. Any agent GETs the score instantly via API or direct contract read
6. All runs logged to agent_log.json (structured, with tx hashes and decisions)
```


## Start Here (For Agents)

Load the skill into your runtime and you are ready to query trust scores and trigger audits:

```
skill: https://lookout-agent.vercel.app/skill.md
agent.json: https://lookout-agent.vercel.app/agent.json
```

**Check a score** (free, no wallet, instant):

```
GET https://lookout-agent.vercel.app/api/score/{address}?chain=celo
```

```json
{
  "address": "0xC15366fD9078aC523b04077b0f9632C9DbBBDF29",
  "score": 45,
  "level": "caution",
  "isHumanBacked": false,
  "chain": "celo"
}
```

**Trigger a fresh audit** ($0.01 USDC via x402, your agent needs a funded EVM wallet):

```
POST https://lookout-agent.vercel.app/api/audit/{address}?chain=celo
```

The server returns HTTP 402 with a `payment-required` header. Sign an ERC-3009 transfer and retry with a `PAYMENT-SIGNATURE` header. Full payment flow documented in [skill.md](https://lookout-agent.vercel.app/skill.md).

## Scoring Model

| Component | Max Points | What It Measures |
|---|---|---|
| Transaction count | 15 | Volume of behavioral data available |
| Success rate | 15 | Percentage of non-reverted transactions |
| Account age | 15 | Days since first onchain transaction |
| Counterparty diversity | 15 | Number of unique addresses interacted with |
| Self Protocol verified | +15 | ZK-confirmed human behind the agent |
| ENS identity | +5 | Agent has a named onchain identity |
| Activity consistency | +10 | Regular non-bursty patterns across 3+ days |
| High revert rate | -10 | More than 20% of transactions fail |
| Dormancy | -5 | No activity in the past 30 days |
| Suspicious interactions | -15 | Interactions with flagged addresses |

**Score levels:** 0-25 Not Trusted | 26-50 Caution | 51-75 Trusted | 76-100 Highly Trusted


## Live Proofs

### Lookout Auditor Agent (ERC-8004 Registered)

The Lookout agent itself is registered onchain as an ERC-8004 identity. This is the agent that writes all TrustScores.

| Chain | ERC-8004 Token ID | Registration Tx |
|---|---|---|
| Celo (42220) | 3261 | `0x8699762c083c484e2f252c7147098bc23f8d6e902b027394677451d317c1a19d` |
| Base (8453) | 35219 | `0x19c7e71c686c3ced8771bb7db68eba73c5bef6db1126e7b2cb71c871ed20d336` |

Auditor wallet: `0xa2E5D703Aeb869E7a165E39BD82463aE6Cf10772`

### Real Onchain Score Writes (Mainnet)

| Chain | Target | Score | Tx Hash |
|---|---|---|---|
| Celo | `0xC15366fD...` | 45 | `0x1c2a1b96aa49406838c59ea3b57d319b8ade2c0719b55b5b26871fa21e53eaa3` |
| Base | `0x460297...` | 39 | `0xe2c993208166f66f641df7894757c3cd9e29fb898f5a4217dd65fb102e11a568` |
| Base | `0x460297...` (re-audit) | updated | `0xde2ad43f6ba7d186a5ec2f8c5bd3c12e6ccc681beefc3f8ebe537d42d48b7504` |

### x402 Payment Verified

Real USDC payment processed on Base mainnet:
`0xce129808c801b5c5c28979efa9195f23855d68278bda1bbb2415ba1ad40ad007`

### Agent Execution Logs

`agent_log.json` contains 20+ structured runs with decisions, tool calls, retries, tx hashes, and compute metrics. Required format for Protocol Labs ERC-8004 bounty.

---

## Contracts

### Mainnets

| Chain | TrustRegistry | Explorer |
|---|---|---|
| Celo (42220) | `0xCe74337add024796C9061D88C0d9fa4836d02FE7` | [celoscan.io](https://celoscan.io/address/0xCe74337add024796C9061D88C0d9fa4836d02FE7) |
| Base (8453) | `0xCe74337add024796C9061D88C0d9fa4836d02FE7` | [basescan.org](https://basescan.org/address/0xCe74337add024796C9061D88C0d9fa4836d02FE7) |

ERC-8004 IdentityRegistry (all chains): `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

### Testnets 

| Chain | TrustRegistry |
|---|---|
| Celo Sepolia (11142220) | `0xAc800b34E85256DD8dd503b8E8e08893C9bDe57A` |
| Base Sepolia (84532) | `0xbC50290e05d9F159c0CB6db1008Acc0a1228AF55` |

## Integrations

### ERC-8004

Lookout uses ERC-8004 as the identity layer for both the auditor agent and the agents it scores.

- Lookout's own auditor wallet is registered in the ERC-8004 IdentityRegistry (tokenId 3261 on Celo, 35219 on Base)
- When an agent is audited, Lookout queries the IdentityRegistry to check if the target has an ERC-8004 identity and includes the tokenId in the onchain profile
- The `agent.json` manifest is served at `https://lookout-agent.vercel.app/agent.json` per ERC-8004 spec

### Self Protocol (ZK Human Verification)

Agents can earn a +15 score bonus by proving a verified human controls them. The verification is onchain, not just offchain: Lookout calls `isVerifiedAgent(bytes32)` on the Self Protocol Agent Registry at `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` (Celo). The auditor cannot fake this flag.

Verification flow: `https://lookout-agent.vercel.app/verify`

### ENS Identity

Lookout resolves ENS names for all addresses via Ethereum mainnet. Agents with ENS names receive a +5 score bonus. The frontend accepts ENS names as search input (e.g. `vitalik.eth`). Reverse and forward resolution available at `/api/ens/{address}` and `/api/ens/resolve/{name}`.

### x402 (Agent-Native Payments)

The `/api/audit` endpoint is gated behind x402. No API key, no human approval flow. Agents pay $0.01 USDC autonomously using their own EVM wallet. Payment revenue covers the auditor's onchain gas costs, making Lookout self-sustaining.

## Security

- **No target cooperation required** - any address can be audited without the target registering or consenting (credit bureau model)
- **Self-registration only** - `registerAgent()` uses `msg.sender`; no third party can register for you
- **Onchain ZK verification** - `setHumanVerified()` makes a live call to Self Protocol; auditor cannot forge the flag
- **Rate limiting** - score updates capped at once per hour per agent onchain; prevents flash manipulation
- **Score cap** - hard cap at 100, enforced in both `scorer.ts` (offchain) and `TrustRegistry.sol` (onchain)
- **Breakdown validation** - all sub-score fields validated against spec ranges on every write
- **Two-step ownership** - `transferOwnership()` requires new owner to call `acceptOwnership()`
- **Auditor rotation** - owner can replace the auditor wallet instantly if compromised

---

## Tech Stack

| Layer | Technology |
|---|---|
| Contracts | Solidity 0.8.20, Foundry |
| Chains | Celo (42220), Base (8453) |
| Agent runtime | Claude Code (`claude-sonnet-4-6`) |
| Agent identity | ERC-8004 IdentityRegistry |
| Human verification | Self Protocol (ZK, onchain) |
| Payments | x402 via Thirdweb facilitator |
| Transaction data | Blockscout API (Celo), Basescan API (Base) |
| Frontend | Next.js, TypeScript, Viem, Tailwind |
| Naming | ENS (Ethereum mainnet resolution) |

## Links

| Resource | URL |
|---|---|
| Website | https://lookout-agent.vercel.app |
| skill.md | https://lookout-agent.vercel.app/skill.md |
| agent.json | https://lookout-agent.vercel.app/agent.json |
| GitHub | https://github.com/sandragcarrillo/Lookout |
| Human verification | https://lookout-agent.vercel.app/verify |

---

MIT License
