import { createThirdwebClient } from 'thirdweb';
import { facilitator } from 'thirdweb/x402';

export const PAY_TO =
  (process.env.AUDITOR_WALLET ?? '0xa2E5D703Aeb869E7a165E39BD82463aE6Cf10772') as `0x${string}`;

// USDC contract addresses
export const USDC = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  celo: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
} as const;

// Read env at call time — Next.js inlines module-level process.env at build time
export function getThirdwebFacilitator() {
  const client = createThirdwebClient({
    secretKey: process.env.THIRDWEB_SECRET_KEY ?? '',
  });
  return facilitator({
    client,
    serverWalletAddress: PAY_TO,
    waitUntil: 'simulated',
  });
}
