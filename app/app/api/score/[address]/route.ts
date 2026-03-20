import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, getAddress } from 'viem';
import { celo, base } from 'viem/chains';

const TRUST_REGISTRY = '0xCe74337add024796C9061D88C0d9fa4836d02FE7' as const;

const SCORE_ABI = [
  {
    name: 'getScore',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'isRegistered',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

function levelFromScore(score: number) {
  if (score >= 76) return 'highly_trusted';
  if (score >= 51) return 'trusted';
  if (score >= 26) return 'caution';
  return 'not_trusted';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const chainParam = request.nextUrl.searchParams.get('chain') ?? 'celo';

  let target: `0x${string}`;
  try {
    target = getAddress(address) as `0x${string}`;
  } catch {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  if (chainParam !== 'celo' && chainParam !== 'base') {
    return NextResponse.json({ error: 'chain must be celo or base' }, { status: 400 });
  }

  const viemChain = chainParam === 'celo' ? celo : base;
  const rpc = chainParam === 'celo' ? 'https://forno.celo.org' : 'https://mainnet.base.org';

  const client = createPublicClient({ chain: viemChain, transport: http(rpc) });

  try {
    const [score, registered] = await Promise.all([
      client.readContract({ address: TRUST_REGISTRY, abi: SCORE_ABI, functionName: 'getScore', args: [target] }),
      client.readContract({ address: TRUST_REGISTRY, abi: SCORE_ABI, functionName: 'isRegistered', args: [target] }),
    ]);

    const scoreNum = Number(score);
    return NextResponse.json({
      address: target,
      chain: chainParam,
      score: scoreNum,
      level: levelFromScore(scoreNum),
      registered,
      contract: TRUST_REGISTRY,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Contract read failed', detail: String(err) }, { status: 502 });
  }
}
