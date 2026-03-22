# Lookout: Agent Trust Protocol

Lookout answers one question before your agent transacts: can this counterparty be trusted? It audits onchain behavior, integrates ZK identity verification, and writes a composable TrustScore (0-100) that any agent, dApp, or human can query. Scores are stored onchain on Celo and Base via the TrustRegistry contract, built on ERC-8004 agent identity.

## What You Can Do With This Skill

You can check the trust score of any EVM wallet address before sending funds, signing agreements, or cooperating with another agent. You can also trigger a fresh audit of any address to get an up-to-date behavioral score written onchain. Score reads are free and instant. Fresh audits cost $0.01 USDC paid via x402.

## Checking a Score

To check an existing score, make a GET request with the wallet address and chain. No wallet, no payment, no authentication needed. If the address has never been audited, score will be 0 and registered will be false.

```
GET https://lookout-agent.vercel.app/api/score/{address}?chain=celo|base
```

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
  "reportCID": "Qm...",
  "chain": "celo"
}
```

For the full profile including the audit report text:

```
GET https://lookout-agent.vercel.app/api/profile/{address}?chain=celo|base
```

## How to Interpret a Score

A score of 76-100 means highly trusted. A score of 51-75 means trusted. A score of 26-50 means caution, proceed with small transactions only. A score below 26, or an unregistered address, means abort and find another counterparty. If isHumanBacked is true, there is a ZK-verified human behind the agent, which adds confidence. If false, the agent is fully autonomous with no human accountability link.

## Triggering a Fresh Audit

When a score is stale or the address has never been audited, POST to the audit endpoint. The server uses the x402 protocol for payment: a two-step HTTP flow with no API key required.

**Before you can pay, you need:**
- An EVM wallet (your agent's own address + private key)
- At least 0.01 USDC on the same chain as the audit target (Base or Celo)

This is intentional: x402 is designed for agents that control their own wallets and can pay autonomously without a human approving each transaction. If your agent does not have a wallet yet, create one and fund it with a small amount of USDC on Base or Celo before calling this endpoint.

```
POST https://lookout-agent.vercel.app/api/audit/{address}?chain=celo|base
```

### Step 1 — first call, no payment header

Send the POST bare. The server responds HTTP 402 with a `payment-required` header (base64-encoded JSON) describing what to pay.

### Step 2 — build and sign the payment payload

Construct the following JSON, sign it with EIP-712 `TransferWithAuthorization` (ERC-3009) using your wallet's private key, then base64-encode the whole object and send it in the `PAYMENT-SIGNATURE` header:

```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:42220",
  "payload": {
    "signature": "0x<eip712-signature>",
    "authorization": {
      "from": "0x<your-wallet>",
      "to": "0xa2E5D703Aeb869E7a165E39BD82463aE6Cf10772",
      "value": "10000",
      "validAfter": "0",
      "validBefore": "9999999999",
      "nonce": "0x<random-bytes32>"
    }
  }
}
```

The EIP-712 domain for signing:
```json
{
  "name": "USD Coin",
  "version": "2",
  "chainId": 42220,
  "verifyingContract": "0xcebA9300f2b948710d2653dD7B07f33A8B32118C"
}
```

The EIP-712 type:
```
TransferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
```

For Base: use `chainId: 8453`, `verifyingContract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and `"network": "eip155:8453"` in the payload.

### Step 3 — retry with payment header

```
POST https://lookout-agent.vercel.app/api/audit/{address}?chain=celo|base
PAYMENT-SIGNATURE: <base64-encoded payment JSON from step 2>
```

On success, the server returns HTTP 200 with the audit result:

```json
{
  "score": 73,
  "level": "trusted",
  "isHumanBacked": true,
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
  "report": "## Lookout Audit Report\n\n...",
  "txHash": "0xabc...",
  "chain": "celo"
}
```

### Payment quick reference

| Field        | Celo                                       | Base                                       |
|--------------|--------------------------------------------|--------------------------------------------|
| Chain ID     | 42220                                      | 8453                                       |
| USDC address | 0xcebA9300f2b948710d2653dD7B07f33A8B32118C | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| Amount       | 10000 (0.01 USDC, 6 decimals)              | 10000 (0.01 USDC, 6 decimals)              |
| Pay to       | 0xa2E5D703Aeb869E7a165E39BD82463aE6Cf10772 | 0xa2E5D703Aeb869E7a165E39BD82463aE6Cf10772 |
| USDC name    | USD Coin                                   | USD Coin                                   |
| USDC version | 2                                          | 2                                          |

The chain in `network` and `verifyingContract` must match the `?chain=` parameter in the URL.

## How Scores Are Calculated

The TrustScore is built from four base components (up to 15 points each): transaction count, success rate of non-reverted transactions, account age in days, and number of unique counterparties. On top of that, bonuses are added for human verification via Self Protocol (+15), having an ENS name (+5), and consistent non-bursty activity (+10). Penalties apply for high revert rates (-10), dormancy over 30 days (-5), and interactions with flagged addresses (-15). The total is capped at 100.

## Registration and Reputation Building

No registration is required. Lookout uses a credit bureau model: any address can be audited without prior sign-up. The first audit auto-registers the address. If the agent wants to link their ERC-8004 identity, they can optionally call registerAgent on the TrustRegistry contract with their agent address and ERC-8004 token ID.

## Human Verification

Agents can earn a +15 score bonus by proving a verified human is behind them using Self Protocol ZK proofs. The verification flow is at https://lookout-agent.vercel.app/verify. It uses a mobile app, a passport or ID scan, and produces a ZK proof that is verified onchain without revealing identity data.

## Contract Addresses

TrustRegistry on Celo (42220) and Base (8453): 0xCe74337add024796C9061D88C0d9fa4836d02FE7

ERC-8004 IdentityRegistry (all chains): 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

## Links

Website: https://lookout-agent.vercel.app
skill.md: https://lookout-agent.vercel.app/skill.md
agent.json: https://lookout-agent.vercel.app/agent.json
GitHub: https://github.com/sandragcarrillo/Lookout
