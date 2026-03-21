import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { audit } from '@agent/auditor';
import type { AuditResult } from '@agent/auditor';
import { checkSelfSignedRequest } from '../../../../lib/selfVerifier';

export const maxDuration = 60; // seconds — audits take ~10-15s

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  // Read body as text first so we can pass it to the Self verifier for signature checking
  const rawBody = await request.text().catch(() => '{}');
  const body = JSON.parse(rawBody || '{}') as { chain?: string };
  const chainParam = (body.chain ?? request.nextUrl.searchParams.get('chain') ?? 'celo') as string;

  // Optional: check if the calling agent is Self-verified (won't block unsigned callers)
  const callerVerification = await checkSelfSignedRequest(request, rawBody);

  let target: string;
  try {
    target = getAddress(address);
  } catch {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  if (chainParam !== 'celo' && chainParam !== 'base') {
    return NextResponse.json({ error: 'chain must be celo or base' }, { status: 400 });
  }

  try {
    const result: AuditResult = await audit(target, chainParam, { privateKey: process.env.AUDITOR_PRIVATE_KEY });

    return NextResponse.json({
      address: result.targetAddress,
      chain: result.chain,
      score: result.score,
      level: result.level,
      breakdown: result.breakdown,
      totalTxs: result.totalTxs,
      successfulTxs: result.successfulTxs,
      failedTxs: result.failedTxs,
      uniqueCounterparties: result.uniqueCounterparties,
      accountAgeDays: result.accountAgeDays,
      isHumanBacked: result.isHumanBacked,
      ensName: result.ensName,
      reportCID: result.reportCID,
      txHash: result.txHash,
      durationMs: result.durationMs,
      report: result.reportContent,   // full markdown report inline
      runId: result.runId,
      callerSelfVerified: callerVerification?.valid ?? false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Audit failed', detail: String(err) },
      { status: 500 },
    );
  }
}
