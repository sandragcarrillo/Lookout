# Lookout — Agent Trust Protocol

> Before your agent pays, trusts, or cooperates with another agent — check their TrustScore.

Lookout is an onchain reputation scoring layer for AI agents. It audits agent behavior from public onchain transactions, integrates ZK identity verification via Self Protocol, and writes composable TrustScores that any agent, dApp, or human can query.

Built on [ERC-8004](https://www.8004.org) (agent identity) • Deployed on **Celo** + **Base**

---

## How It Works

```
1. Agent calls registerAgent() from their own wallet
2. Lookout auditor agent scans onchain transactions
3. Behavioral score calculated (0-100) based on tx patterns
4. Score + audit report ("recibo") written onchain
5. Other agents/dApps query the score before transacting
```

**Optional:** Agent owner verifies as human via Self Protocol → +15 score bonus, confirmed onchain via ZK proof.

---

## For Agents

Point your agent at the skill file:

```bash
curl -s https://lookout.watch/skill.md
```

Quick score check:
```bash
GET https://lookout.watch/api/score/0xAgentAddress?chain=celo
```

---

## Scoring Model

| Component | Points | What It Measures |
|---|---|---|
| Transaction count | 0–15 | Behavioral data volume |
| Success rate | 0–15 | % of non-reverted txs |
| Account age | 0–15 | Time since first tx |
| Counterparty diversity | 0–15 | Unique addresses |
| Self Protocol verified | +15 | ZK-confirmed human behind the agent |
| ENS identity | +5 | Named identity |
| Consistency | +10 | Regular, non-suspicious patterns |
| Penalties | –30 to 0 | Reverts, dormancy, suspicious interactions |

**Score → Level:** 0–25 🔴 Not Trusted | 26–50 🟡 Caution | 51–75 🟢 Trusted | 76–100 💎 Highly Trusted

---

## Contracts

### Testnets (deployed & verified)

| Chain | Contract | Address |
|---|---|---|
| Celo Sepolia (11142220) | TrustRegistry | `0xAc800b34E85256DD8dd503b8E8e08893C9bDe57A` |
| Base Sepolia (84532) | TrustRegistry | `0xbC50290e05d9F159c0CB6db1008Acc0a1228AF55` |
| ERC-8004 IdentityRegistry | all chains | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

### Mainnets

| Chain | Contract |
|---|---|
| Celo (42220) | `0xCe74337add024796C9061D88C0d9fa4836d02FE7` |
| Base (8453) | `0xCe74337add024796C9061D88C0d9fa4836d02FE7` |

---

## Tech Stack

- **Contracts:** Solidity 0.8.20 / Foundry
- **Chains:** Celo (42220) + Base (8453)
- **Identity:** ERC-8004 IdentityRegistry 
- **ZK Verification:** Self Protocol Agent Registry (onchain, not just offchain)
- **Auditor Agent:** Claude Code (`claude-sonnet-4-6`)
- **Frontend:** Next.js / TypeScript / Viem / Tailwind
- **Data:** Blockscout API (Celo) / Basescan API (Base)

---

## Development

```bash
cd contracts
forge build              # compile
forge test -vvv          # run 50 tests (unit + fuzz)
forge test --gas-report  # gas analysis
```

### Deploy

Copy and fill in the environment file:

```bash
cp contracts/.env.example contracts/.env
```

Key variables:

| Variable | Description |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Owns the registry |
| `AUDITOR_WALLET` | Address of the Lookout agent wallet that writes scores |
| `SELF_AGENT_REGISTRY` | Self Protocol Agent Registry address (see below) |

Self Protocol Agent Registry addresses:

| Chain | Address |
|---|---|
| Celo mainnet (42220) | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |
| Celo Sepolia (11142220) | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| Others (Base, Status) | `address(0)` — Self check disabled |

## Security

Key protections:

- **Self-registration only** — `registerAgent()` uses `msg.sender`; no third party can register your address
- **Onchain ZK verification** — `setHumanVerified(agent, true)` makes a live call to the Self Protocol Agent Registry; the auditor cannot fake the flag
- **Rate limiting** — Score updates are capped at once per hour per agent (prevents flash manipulation)
- **Score cap** — Hard cap at 100, enforced onchain
- **Breakdown validation** — All sub-score fields validated against spec ranges on every write
- **Two-step ownership** — `transferOwnership()` requires the new owner to call `acceptOwnership()` to prevent permanent lockout
- **Auditor rotation** — Owner can replace the auditor wallet instantly if compromised

---

## Built For

[The Synthesis](https://synthesis.md) — the first builder event you can enter without a body.

**Track:** Agents That Trust + Agents That Pay

## License

MIT
