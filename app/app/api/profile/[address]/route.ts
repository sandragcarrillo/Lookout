import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, getAddress } from 'viem';
import { celo, base } from 'viem/chains';

const TRUST_REGISTRY   = '0xCe74337add024796C9061D88C0d9fa4836d02FE7' as const;
const ERC8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;

/**
 * Look up an agent's ERC-8004 tokenId via Blockscout API.
 * ERC-8004 IdentityRegistry is not ERC721Enumerable so we can't use tokenOfOwnerByIndex.
 * Blockscout NFT holder API is the reliable alternative.
 */
async function lookupErc8004Id(owner: string, chain: string): Promise<number> {
  const blockscoutBase = chain === 'base'
    ? 'https://base.blockscout.com'
    : 'https://celo.blockscout.com';

  try {
    // Query NFT instances held by this address in the ERC-8004 IdentityRegistry
    const res = await fetch(
      `${blockscoutBase}/api/v2/tokens/${ERC8004_REGISTRY}/instances?holder_address_hash=${owner}`,
      { cache: 'no-store', signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return 0;
    const data = await res.json() as { items?: { id?: string | number }[] };
    if (data.items && data.items.length > 0 && data.items[0].id != null) {
      return Number(data.items[0].id);
    }
  } catch {
    // Timeout or network error — non-fatal
  }
  return 0;
}

const PROFILE_ABI = [
  {
    name: 'getFullProfile',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentAddress',    type: 'address' },
          { name: 'erc8004Id',       type: 'uint256' },
          { name: 'score',           type: 'uint256' },
          {
            name: 'breakdown',
            type: 'tuple',
            components: [
              { name: 'txCount',          type: 'uint8' },
              { name: 'successRate',      type: 'uint8' },
              { name: 'accountAge',       type: 'uint8' },
              { name: 'counterparties',   type: 'uint8' },
              { name: 'selfBonus',        type: 'uint8' },
              { name: 'ensBonus',         type: 'uint8' },
              { name: 'consistencyBonus', type: 'uint8' },
              { name: 'penalties',        type: 'int8' },
            ],
          },
          { name: 'isHumanBacked',   type: 'bool' },
          { name: 'isActive',        type: 'bool' },
          { name: 'firstSeenAt',     type: 'uint256' },
          { name: 'lastAuditedAt',   type: 'uint256' },
          { name: 'auditCount',      type: 'uint256' },
          { name: 'latestReportCID', type: 'string' },
        ],
      },
    ],
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
    const profile = await client.readContract({
      address: TRUST_REGISTRY,
      abi: PROFILE_ABI,
      functionName: 'getFullProfile',
      args: [target],
    }) as {
      agentAddress: string;
      erc8004Id: bigint;
      score: bigint;
      breakdown: {
        txCount: number; successRate: number; accountAge: number; counterparties: number;
        selfBonus: number; ensBonus: number; consistencyBonus: number; penalties: number;
      };
      isHumanBacked: boolean;
      isActive: boolean;
      firstSeenAt: bigint;
      lastAuditedAt: bigint;
      auditCount: bigint;
      latestReportCID: string;
    };

    if (!profile.isActive) {
      return NextResponse.json({ error: 'Address not found in registry', address: target }, { status: 404 });
    }

    const scoreNum = Number(profile.score);
    // If TrustRegistry has erc8004Id = 0 (auto-registered via credit bureau model),
    // look up the real tokenId directly from the ERC-8004 IdentityRegistry.
    const registryErc8004Id = Number(profile.erc8004Id);
    const erc8004Id = registryErc8004Id > 0
      ? registryErc8004Id
      : await lookupErc8004Id(target, chainParam);

    return NextResponse.json({
      address: target,
      chain: chainParam,
      score: scoreNum,
      level: levelFromScore(scoreNum),
      breakdown: {
        txCount:          profile.breakdown.txCount,
        successRate:      profile.breakdown.successRate,
        accountAge:       profile.breakdown.accountAge,
        counterparties:   profile.breakdown.counterparties,
        selfBonus:        profile.breakdown.selfBonus,
        ensBonus:         profile.breakdown.ensBonus,
        consistencyBonus: profile.breakdown.consistencyBonus,
        penalties:        profile.breakdown.penalties,
      },
      isHumanBacked:   profile.isHumanBacked,
      firstSeenAt:     Number(profile.firstSeenAt),
      lastAuditedAt:   Number(profile.lastAuditedAt),
      auditCount:      Number(profile.auditCount),
      erc8004Id,
      latestReportCID: profile.latestReportCID,
      contract: TRUST_REGISTRY,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Contract read failed', detail: String(err) }, { status: 502 });
  }
}
