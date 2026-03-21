'use client';

import { useEffect, useState } from 'react';
import { SelfAppBuilder, SelfQRcodeWrapper, type SelfApp } from '@selfxyz/qrcode';

interface Props {
  agentAddress: string;
  onSuccess: () => void;
  onError: (err: Error) => void;
}

/**
 * Renders a Self Protocol QR code that the user scans with the Self mobile app.
 * After scanning, Self Protocol writes the verification to their registry on Celo
 * (0xaC3DF9ABf80d0F5c020C06B04Cced27763355944). Lookout's auditor reads this
 * registry and awards +15 to the TrustScore.
 */
export function SelfVerification({ agentAddress, onSuccess, onError }: Props) {
  const [selfApp, setSelfApp] = useState<SelfApp | null>(null);

  useEffect(() => {
    if (!agentAddress) return;

    try {
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'https://lookout.watch';

      const app = new SelfAppBuilder({
        appName: 'Lookout',
        endpointType: 'https',
        endpoint: `${origin}/api/self/verify`,
        scope: 'lookout-trust-verification',
        userId: agentAddress.toLowerCase(),
        userIdType: 'hex',
        devMode: process.env.NODE_ENV !== 'production',
        chainID: 42220, // Celo mainnet
        disclosures: {
          minimumAge: 18,
          ofac: true,
        },
      }).build();

      setSelfApp(app);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [agentAddress, onError]);

  if (!selfApp) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        Loading QR code...
      </div>
    );
  }

  return (
    <SelfQRcodeWrapper
      selfApp={selfApp}
      onSuccess={onSuccess}
      onError={(data) =>
        onError(new Error(data.reason ?? data.error_code ?? 'Verification failed'))
      }
      size={280}
    />
  );
}
