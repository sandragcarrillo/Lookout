import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, getAddress } from 'viem';
import { mainnet } from 'viem/chains';

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  let target: `0x${string}`;
  try {
    target = getAddress(address) as `0x${string}`;
  } catch {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  try {
    const ensName = await client.getEnsName({ address: target });
    return NextResponse.json(
      { address: target, ensName: ensName ?? null },
      {
        headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
      },
    );
  } catch {
    return NextResponse.json({ address: target, ensName: null });
  }
}
