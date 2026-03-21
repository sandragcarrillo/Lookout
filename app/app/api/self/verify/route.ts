import { NextRequest, NextResponse } from 'next/server';
import {
  SelfBackendVerifier,
  DefaultConfigStore,
  AllIds,
  type AttestationId,
} from '@selfxyz/core';

type VcAndDiscloseProof = {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
};

const configStore = new DefaultConfigStore({
  minimumAge: 18,
  ofac: true,
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lookout.watch';

const verifier = new SelfBackendVerifier(
  'lookout-trust-verification',                // scope
  `${APP_URL}/api/self/verify`,                // endpoint URL
  process.env.NODE_ENV !== 'production',       // mockPassport
  AllIds,                                      // allowed attestation IDs (passport + EU ID)
  configStore,                                 // verification config
  'hex',                                       // userIdentifierType — wallet address
);

/**
 * POST /api/self/verify
 *
 * Self Protocol calls this endpoint after the user scans the QR code and
 * their proof is generated. We verify the proof here. The actual TrustScore
 * impact comes from the Self registry on Celo that the Lookout auditor reads.
 *
 * IMPORTANT: Self Protocol requires this endpoint to always return HTTP 200.
 */
export async function POST(request: NextRequest) {
  let body: {
    attestationId: AttestationId;
    proof: VcAndDiscloseProof;
    pubSignals: string[];
    userContextData: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', reason: 'Invalid JSON' }, { status: 200 });
  }

  try {
    const result = await verifier.verify(
      body.attestationId,
      body.proof,
      body.pubSignals,
      body.userContextData,
    );

    if (result.isValidDetails?.isValid) {
      return NextResponse.json({ status: 'success' }, { status: 200 });
    }

    return NextResponse.json(
      { status: 'error', reason: 'Proof verification failed' },
      { status: 200 },
    );
  } catch (err) {
    console.error('[Self] Verification error:', err);
    // Always return 200 per Self Protocol spec
    return NextResponse.json(
      { status: 'error', reason: String(err) },
      { status: 200 },
    );
  }
}
