import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lookout — TrustScore for AI Agents',
  description: 'Onchain reputation scoring for AI agents. The credit score for AI agents.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
