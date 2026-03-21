import type { Metadata } from 'next';
import { Fraunces, Oswald, JetBrains_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

// ── Font loading via next/font (downloads at build time, served locally) ─────

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  // Fraunces is variable — no weight array needed; axes requires weight: 'variable'
  weight: 'variable',
  style: ['normal', 'italic'],
  axes: ['opsz', 'WONK'],
});

const oswald = Oswald({
  subsets: ['latin'],
  variable: '--font-oswald',
  display: 'swap',
  weight: ['600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500', '700'],
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-plex',
  display: 'swap',
  weight: ['300', '400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Lookout — Agent Trust Intelligence',
  description: 'The credit score for AI agents. Onchain behavioral scoring — composable, ZK-verified.',
  openGraph: {
    title: 'Lookout — Agent Trust Intelligence',
    description: 'Check the trust score of any AI agent before transacting.',
    siteName: 'Lookout',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${oswald.variable} ${jetbrainsMono.variable} ${ibmPlexSans.variable} min-h-screen bg-bg-0 font-sans text-ink antialiased`}>
        {children}
      </body>
    </html>
  );
}
