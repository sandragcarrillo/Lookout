import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { defineChain } from 'thirdweb';
import { settlePayment } from 'thirdweb/x402';
import { audit } from '@agent/auditor';
import type { AuditResult } from '@agent/auditor';
import { checkSelfSignedRequest } from '../../../utils/selfVerifier';
import { PAY_TO, USDC, getThirdwebFacilitator } from '../../../utils/x402';

export const maxDuration = 60; // seconds — audits take ~10-15s

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract address from URL path: /api/audit/[address]
    const address = decodeURIComponent(request.nextUrl.pathname.split('/').slice(-1)[0]);

    // Chain: prefer query param (available before body is read)
    const chainParam = request.nextUrl.searchParams.get('chain') ?? 'celo';

    if (chainParam !== 'celo' && chainParam !== 'base') {
      return NextResponse.json({ error: 'chain must be celo or base' }, { status: 400 });
    }

    let target: string;
    try {
      target = getAddress(address);
    } catch {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    // ── x402 payment gate ────────────────────────────────────────────────────
    // Pay on the same chain as the audit target (Base USDC or Celo USDC)
    const paymentChain = defineChain(chainParam === 'base' ? 8453 : 42220);
    const usdcAddress  = chainParam === 'base' ? USDC.base : USDC.celo;

    const paymentData =
      request.headers.get('x-payment') ?? request.headers.get('payment-signature');

    const payment = await settlePayment({
      resourceUrl: request.url,
      method:      'POST',
      paymentData,
      payTo:       PAY_TO,
      network:     paymentChain,
      price: {
        amount: '10000', // $0.01 USDC (6 decimals)
        asset:  { address: usdcAddress },
      },
      facilitator: getThirdwebFacilitator(),
      routeConfig: {
        description: 'Trigger fresh agent audit + onchain score write - Lookout',
        mimeType:    'application/json',
      },
    });

    if (payment.status !== 200) {
      // Return the 402 (or error) response from Thirdweb
      return NextResponse.json(payment.responseBody, {
        status:  payment.status,
        headers: payment.responseHeaders as Record<string, string>,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Read body for caller verification (after payment settled)
    let rawBody = '{}';
    try { rawBody = (await request.text()) || '{}'; } catch { /* already consumed */ }

    const callerVerification = await checkSelfSignedRequest(request, rawBody).catch(() => null);

    const result: AuditResult = await audit(target, chainParam, { privateKey: process.env.AUDITOR_PRIVATE_KEY });

    const response = NextResponse.json({
      address:              result.targetAddress,
      chain:                result.chain,
      score:                result.score,
      level:                result.level,
      breakdown:            result.breakdown,
      totalTxs:             result.totalTxs,
      successfulTxs:        result.successfulTxs,
      failedTxs:            result.failedTxs,
      uniqueCounterparties: result.uniqueCounterparties,
      accountAgeDays:       result.accountAgeDays,
      isHumanBacked:        result.isHumanBacked,
      ensName:              result.ensName,
      reportCID:            result.reportCID,
      txHash:               result.txHash,
      durationMs:           result.durationMs,
      report:               result.reportContent,
      runId:                result.runId,
      callerSelfVerified:   callerVerification?.valid ?? false,
    });

    // Forward payment receipt headers
    for (const [key, value] of Object.entries(payment.responseHeaders)) {
      response.headers.set(key, value as string);
    }
    return response;

  } catch (err) {
    return NextResponse.json(
      { error: 'Audit failed', detail: String(err) },
      { status: 500 },
    );
  }
}
