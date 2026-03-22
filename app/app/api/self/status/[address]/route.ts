/**
 * GET /api/self/status/:address
 *
 * Check the Self Protocol human-verification status of any agent address
 * by reading directly from the Self Agent Registry on Celo mainnet.
 *
 * Returns:
 *   { verified: true, agentId, expiresAt, expiringSoon }
 *   { verified: false, reason: 'NOT_REGISTERED' | 'NO_HUMAN_PROOF' | 'PROOF_EXPIRED', reauthUrl? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { checkAgentStatus } from '../../../../lib/selfVerifier';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  let checksummed: string;
  try {
    checksummed = getAddress(address);
  } catch {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  try {
    const status = await checkAgentStatus(checksummed);
    return NextResponse.json({ address: checksummed, ...status });
  } catch (err) {
    return NextResponse.json(
      { error: 'Self registry read failed', detail: String(err) },
      { status: 502 },
    );
  }
}
