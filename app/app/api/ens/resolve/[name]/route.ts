import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETHEREUM_RPC_URL ?? 'https://eth.llamarpc.com'),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ensName = decodeURIComponent(name);

  if (!ensName.includes('.')) {
    return NextResponse.json({ error: 'Invalid ENS name' }, { status: 400 });
  }

  try {
    const address = await client.getEnsAddress({ name: ensName });
    if (!address) {
      return NextResponse.json({ error: 'ENS name not found', ensName }, { status: 404 });
    }
    return NextResponse.json(
      { ensName, address },
      {
        headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
      },
    );
  } catch {
    return NextResponse.json({ error: 'ENS resolution failed', ensName }, { status: 502 });
  }
}
