# Lookout — Agent Trust Protocol

> Before your agent pays, trusts, or cooperates with another agent — check their TrustScore.

Lookout is an onchain reputation scoring layer for AI agents. It audits agent behavior from public on-chain transactions, integrates ZK identity verification via Self Protocol, and writes composable TrustScores that any agent, dApp, or human can query.

Built on [ERC-8004](https://www.8004.org) (agent identity) • Deployed on **Celo** + **Base**

## How It Works

```
1. Agent registers in Lookout (optionally links ERC-8004 identity)
2. Lookout auditor agent scans on-chain transactions
3. Behavioral score calculated (0-100) based on tx patterns
4. Score + audit report ("recibo") written on-chain
5. Other agents/dApps query the score before transacting
```

**Optional:** Agent owner verifies as human via Self Protocol → +15 score bonus.

## For Agents

Point your agent at the skill file:

```bash
curl -s https://lookout.watch/skill.md
```

Quick score check:
```bash
GET https://lookout.watch/api/score/0xAgentAddress?chain=celo
```

## Scoring Model

| Component | Points | What It Measures |
|-----------|--------|-----------------|
| Transaction count | 0-15 | Behavioral data volume |
| Success rate | 0-15 | % of non-reverted txs |
| Account age | 0-15 | Time since first tx |
| Counterparty diversity | 0-15 | Unique addresses |
| Self Protocol verified | +15 | Human behind the agent |
| ENS identity | +5 | Named identity |
| Consistency | +10 | Regular, non-suspicious patterns |
| Penalties | -30 to 0 | Reverts, dormancy, suspicious interactions |

**Score → Level:** 0-25 🔴 Not Trusted | 26-50 🟡 Caution | 51-75 🟢 Trusted | 76-100 💎 Highly Trusted

## Tech Stack

- **Contracts:** Solidity 0.8.20 / Foundry
- **Chains:** Celo (42220) + Base (8453)
- **Identity:** ERC-8004 IdentityRegistry
- **ZK Verification:** Self Protocol
- **Auditor Agent:** Claude Code
- **Frontend:** Next.js / TypeScript / Viem / Tailwind
- **Data:** Blockscout API / Basescan API

## Contracts

| Contract | Celo | Base |
|----------|------|------|
| TrustRegistry | `[TBD]` | `[TBD]` |

## Development

```bash
cd contracts
forge build        # compile
forge test -vvv    # run tests
forge test --gas-report  # gas analysis
```

## Built For

[The Synthesis](https://synthesis.md) — the first builder event you can enter without a body.

**Track:** Agents That Trust + Agents That Pay

## License

MIT
