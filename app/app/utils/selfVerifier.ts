/**
 * Shared Self Protocol agent verification helpers.
 *
 * TWO MODES:
 *  1. Service verifier  — Lookout checks that incoming API callers are Self-verified
 *     (SelfAgentVerifier.verify for signed requests)
 *  2. Status checker    — Lookout checks any target agent's onchain status
 *     (verifyAgent for direct registry lookups)
 */

import { SelfAgentVerifier, verifyAgent, isProofExpiringSoon } from '@selfxyz/agent-sdk';
import type { VerifyResult, VerificationResult } from '@selfxyz/agent-sdk';
import type { NextRequest } from 'next/server';
import { padHex } from 'viem';

// Self Agent Registry on Celo mainnet
const SELF_REGISTRY = '0xaC3DF9ABf80d0F5c020C06B04Cced27763355944' as const;
const CELO_RPC     = 'https://forno.celo.org';
const CELO_CHAIN   = 42220;

// ── 1. Service verifier (singleton) ──────────────────────────────────────────
//
// Lookout acts as a service that verifies AI agents calling its API.
// Verification is OPTIONAL — unverified callers are not blocked, but
// verified callers get `callerSelfVerified: true` in the response.
//
// Config: require age 18+ and OFAC pass (mirrors the TrustScore scoring model).
//
export const selfVerifier = SelfAgentVerifier.create()
  .network(process.env.NODE_ENV === 'production' ? 'mainnet' : 'testnet')
  .requireAge(18)
  .requireOFAC()
  .build();

/**
 * Check if an inbound API request carries valid Self agent auth headers.
 * Returns null when no headers are present (request proceeds without penalty).
 * Returns VerificationResult when headers are present (valid or invalid).
 */
export async function checkSelfSignedRequest(
  request: NextRequest,
  body?: string,
): Promise<VerificationResult | null> {
  const signature = request.headers.get('x-self-agent-signature');
  const timestamp = request.headers.get('x-self-agent-timestamp');
  if (!signature || !timestamp) return null;

  try {
    return await selfVerifier.verify({
      signature,
      timestamp,
      method:   request.method,
      url:      request.url,
      body:     body || undefined,
      keytype:  request.headers.get('x-self-agent-keytype') ?? undefined,
      agentKey: request.headers.get('x-self-agent-key')     ?? undefined,
    });
  } catch {
    // Bad headers — treat as unsigned (don't crash the request)
    return null;
  }
}

// ── 2. Onchain status checker ─────────────────────────────────────────────────
//
// Used by GET /api/self/status/:address and the /verify page's status check.
//
function agentKeyFromAddress(address: string): string {
  return padHex(address.toLowerCase() as `0x${string}`, { size: 32 });
}

export type SelfStatus =
  | { verified: true; agentId: string; expiresAt: string | null; expiringSoon: boolean }
  | { verified: false; reason: 'NOT_REGISTERED' | 'NO_HUMAN_PROOF' | 'PROOF_EXPIRED'; reauthUrl?: string };

/** Direct onchain lookup for any agent address on Celo mainnet. */
export async function checkAgentStatus(address: string): Promise<SelfStatus> {
  const agentKey = agentKeyFromAddress(address);
  const result: VerifyResult = await verifyAgent(
    agentKey,
    { chainId: CELO_CHAIN, registryAddress: SELF_REGISTRY },
    CELO_RPC,
  );

  if (result.verified) {
    return {
      verified:    true,
      agentId:     result.agentId.toString(),
      expiresAt:   result.expiresAt?.toISOString() ?? null,
      expiringSoon: result.expiresAt ? isProofExpiringSoon(result.expiresAt) : false,
    };
  }

  if (result.reason === 'PROOF_EXPIRED') {
    return { verified: false, reason: 'PROOF_EXPIRED', reauthUrl: result.reauthUrl };
  }

  return { verified: false, reason: result.reason };
}
