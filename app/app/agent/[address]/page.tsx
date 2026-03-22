'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { isAddress, getAddress } from 'viem';
import Link from 'next/link';
import { createThirdwebClient } from 'thirdweb';
import { ThirdwebProvider, ConnectButton, useActiveAccount, useFetchWithPayment, darkTheme } from 'thirdweb/react';
import { celo, base } from 'thirdweb/chains';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const client = createThirdwebClient({ clientId: 'c3b6543b2ecc31dce129145fb6309711' });

// ── Types ─────────────────────────────────────────────────────────────────────

interface Breakdown {
  txCount: number;
  successRate: number;
  accountAge: number;
  counterparties: number;
  selfBonus: number;
  ensBonus: number;
  consistencyBonus: number;
  penalties: number;
}

interface Profile {
  address: string;
  chain: string;
  score: number;
  level: 'not_trusted' | 'caution' | 'trusted' | 'highly_trusted';
  breakdown: Breakdown;
  isHumanBacked: boolean;
  firstSeenAt: number;
  lastAuditedAt: number;
  auditCount: number;
  erc8004Id: number;
  latestReportCID: string;
  contract: string;
}

interface AuditResult extends Profile {
  totalTxs: number;
  successfulTxs: number;
  failedTxs: number;
  uniqueCounterparties: number;
  accountAgeDays: number;
  ensName: string | null;
  txHash: string | null;
  durationMs: number;
  report: string;
  runId: string;
  callerSelfVerified: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type LevelKey = 'not_trusted' | 'caution' | 'trusted' | 'highly_trusted';

const LEVEL_CONFIG: Record<LevelKey, { color: string; bg: string; border: string; glow: string; label: string }> = {
  not_trusted:   { color: '#c0392b', bg: 'rgba(192,57,43,0.12)',  border: 'rgba(192,57,43,0.4)',  glow: '0 0 60px rgba(192,57,43,0.18)',  label: 'NOT TRUSTED' },
  caution:       { color: '#d4a030', bg: 'rgba(212,160,48,0.12)', border: 'rgba(212,160,48,0.4)', glow: '0 0 60px rgba(212,160,48,0.18)', label: 'CAUTION' },
  trusted:       { color: '#27a864', bg: 'rgba(39,168,100,0.12)', border: 'rgba(39,168,100,0.4)', glow: '0 0 60px rgba(39,168,100,0.15)', label: 'TRUSTED' },
  highly_trusted:{ color: '#00b8d4', bg: 'rgba(0,184,212,0.12)',  border: 'rgba(0,184,212,0.4)',  glow: '0 0 60px rgba(0,184,212,0.15)',  label: 'HIGHLY TRUSTED' },
};

function shortAddr(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }
function explorerUrl(chain: string, hash: string) {
  return chain === 'base' ? `https://basescan.org/tx/${hash}` : `https://celoscan.io/tx/${hash}`;
}
function explorerAddrUrl(chain: string, addr: string) {
  return chain === 'base' ? `https://basescan.org/address/${addr}` : `https://celoscan.io/address/${addr}`;
}

const BREAKDOWN_ITEMS: { key: keyof Breakdown; label: string; max: number; type: 'base' | 'bonus' | 'penalty' }[] = [
  { key: 'txCount',          label: 'Transaction Count',   max: 15, type: 'base' },
  { key: 'successRate',      label: 'Success Rate',        max: 15, type: 'base' },
  { key: 'accountAge',       label: 'Account Age',         max: 15, type: 'base' },
  { key: 'counterparties',   label: 'Counterparties',      max: 15, type: 'base' },
  { key: 'selfBonus',        label: 'Self Protocol ZK',    max: 15, type: 'bonus' },
  { key: 'ensBonus',         label: 'ENS Identity',        max: 5,  type: 'bonus' },
  { key: 'consistencyBonus', label: 'Behavioral Consistency', max: 10, type: 'bonus' },
  { key: 'penalties',        label: 'Risk Penalties',      max: 30, type: 'penalty' },
];

// ── Score counter animation ────────────────────────────────────────────────────

function AnimatedScore({ target, color }: { target: number; color: string }) {
  const [displayed, setDisplayed] = useState(0);
  const frame = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const duration = 1100;
    const start = performance.now();
    function step(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(eased * target));
      if (progress < 1) frame.current = setTimeout(() => step(performance.now()), 16);
    }
    frame.current = setTimeout(() => step(performance.now()), 150);
    return () => { if (frame.current) clearTimeout(frame.current); };
  }, [target]);

  return (
    <span
      className="font-score leading-none select-none"
      style={{
        fontSize: 'clamp(6rem,17vw,12rem)',
        fontWeight: 700,
        color,
        textShadow: `0 0 80px ${color}55, 0 0 30px ${color}33`,
        letterSpacing: '-0.02em',
      }}
    >
      {displayed}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AgentPage() {
  return (
    <ThirdwebProvider>
      <AgentPageInner />
    </ThirdwebProvider>
  );
}

function AgentPageInner() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const rawAddress = params.address as string;
  const chain      = (searchParams.get('chain') ?? 'celo') as 'celo' | 'base';

  const account = useActiveAccount();
  const { fetchWithPayment, isPending: isPaymentPending } = useFetchWithPayment(client);

  const [profile,     setProfile]     = useState<Profile | null>(null);
  const [auditing,    setAuditing]    = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [notFound,    setNotFound]    = useState(false);
  const [error,       setError]       = useState('');
  const [ensName,     setEnsName]     = useState<string | null>(null);

  const address = (() => {
    try { return isAddress(rawAddress) ? getAddress(rawAddress) : null; }
    catch { return null; }
  })();

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setNotFound(false);
    setError('');
    setEnsName(null);

    // Fetch profile and ENS name in parallel
    Promise.all([
      fetch(`/api/profile/${address}?chain=${chain}`).then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`/api/ens/${address}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([profileData, ensData]) => {
        if (profileData) setProfile(profileData);
        if (ensData?.ensName) setEnsName(ensData.ensName);
        // Also pick up ENS from audit result if available
        if (profileData?.ensName) setEnsName(profileData.ensName);
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [address, chain]);

  async function runAudit() {
    if (!address || auditing || !account) return;
    setAuditing(true);
    setAuditResult(null);
    setError('');
    try {
      // fetchWithPayment auto-parses JSON and throws on non-OK / 402 responses
      const data = await fetchWithPayment(`/api/audit/${address}?chain=${chain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }) as AuditResult;
      setAuditResult(data);
      setProfile(data);
      setNotFound(false);
      if (data.ensName) setEnsName(data.ensName);
    } catch (err) {
      setError(String(err));
    } finally {
      setAuditing(false);
    }
  }

  if (!address) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="font-mono text-sm" style={{ color: 'var(--score-bad)' }}>Invalid address</p>
          <Link href="/" className="text-xs font-mono text-ink-3 hover:text-ink transition-colors">← LOOKOUT</Link>
        </div>
      </div>
    );
  }

  const displayData = auditResult ?? profile;
  const lvl         = displayData ? LEVEL_CONFIG[displayData.level] : null;

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-6 md:px-10 py-4 border-b border-border relative z-10 gap-4">
        <Link href="/" className="flex items-center gap-3 group flex-shrink-0">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
              style={{ backgroundColor: 'var(--accent)' }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5"
              style={{ backgroundColor: 'var(--accent)' }} />
          </span>
          <span className="font-display text-base tracking-[0.18em] text-ink-2 group-hover:text-ink transition-colors font-semibold">LOOKOUT</span>
        </Link>
        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={() => router.push(`/agent/${address}?chain=${chain === 'celo' ? 'base' : 'celo'}`)}
            className="text-[11px] font-mono text-ink-3 hover:text-ink transition-colors border border-border hover:border-border-bright px-3 py-1.5 tracking-widest uppercase"
          >
            {chain === 'celo' ? 'Switch to Base' : 'Switch to Celo'}
          </button>
          <ConnectButton
            client={client}
            chains={[celo, base]}
            theme={darkTheme({
              colors: {
                primaryButtonBg: 'var(--accent)',
                primaryButtonText: '#060508',
                modalBg: 'var(--bg-1)',
                borderColor: 'var(--border)',
                secondaryText: 'var(--ink-3)',
                primaryText: 'var(--ink)',
                accentButtonBg: 'var(--bg-2)',
              },
            })}
            connectButton={{ label: 'CONNECT WALLET' }}
            detailsButton={{
              style: {
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                letterSpacing: '0.15em',
                border: '1px solid var(--border)',
                borderRadius: '0',
                background: 'var(--bg-2)',
                color: 'var(--ink-2)',
                padding: '6px 12px',
                height: 'auto',
              },
            }}
            connectModal={{
              title: 'Connect to run audit',
              size: 'compact',
            }}
          />
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 md:px-10 py-10 space-y-5">

        {/* ── Address header ──────────────────────────────────────── */}
        <div className="stagger-item flex items-start justify-between gap-4 flex-wrap" style={{ animationDelay: '0ms' }}>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-3">Agent</span>
              <span className="text-[10px] font-mono px-2 py-0.5 border uppercase tracking-widest text-ink-3"
                style={{ borderColor: 'var(--border-bright)', background: 'var(--bg-2)' }}>
                {chain}
              </span>
              {ensName && (
                <span className="text-[10px] font-mono px-2 py-0.5 border uppercase tracking-widest"
                  style={{ borderColor: 'rgba(212,168,85,0.35)', color: 'var(--accent)', background: 'rgba(212,168,85,0.06)' }}>
                  ENS
                </span>
              )}
            </div>
            {/* ENS name as primary identifier when available */}
            {ensName ? (
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="font-display font-semibold text-xl text-ink tracking-tight">{ensName}</span>
                  <a href={explorerAddrUrl(chain, address)} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 text-ink-3 hover:text-accent transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
                </div>
                <div className="font-mono text-xs text-ink-3 break-all">{address}</div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-ink break-all leading-relaxed">{address}</span>
                <a href={explorerAddrUrl(chain, address)} target="_blank" rel="noopener noreferrer"
                  className="flex-shrink-0 text-ink-3 hover:text-accent transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              </div>
            )}
          </div>

          <button
            onClick={runAudit}
            disabled={auditing || isPaymentPending || !account}
            className="flex-shrink-0 flex items-center gap-2.5 px-5 py-2.5 text-sm font-mono font-medium tracking-widest uppercase transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: (auditing || isPaymentPending) ? 'var(--bg-3)' : account ? 'var(--accent)' : 'var(--bg-3)',
              color: (auditing || isPaymentPending) ? 'var(--ink-2)' : account ? '#060508' : 'var(--ink-3)',
              border: account ? 'none' : '1px solid var(--border)',
            }}
            onMouseEnter={e => { if (!auditing && !isPaymentPending && account) (e.currentTarget as HTMLButtonElement).style.background = '#c49840'; }}
            onMouseLeave={e => { if (!auditing && !isPaymentPending && account) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
          >
            {(auditing || isPaymentPending) ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: 'rgba(138,127,142,0.5)', borderTopColor: 'transparent' }} />
                {isPaymentPending ? 'PAYING…' : 'SCANNING…'}
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                RUN AUDIT
              </>
            )}
          </button>
        </div>

        {/* ── Loading state — horizontal scanner ──────────────────── */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-28 space-y-8">
            <div className="relative w-full max-w-sm h-0.5 overflow-hidden"
              style={{ background: 'var(--bg-3)' }}>
              <div className="absolute inset-y-0 w-32 scan-beam"
                style={{ background: 'linear-gradient(90deg, transparent, var(--accent), transparent)' }} />
            </div>
            <div className="space-y-2 text-center">
              <p className="text-[11px] font-mono tracking-[0.25em] uppercase text-ink-3">
                Reading registry
              </p>
              <p className="text-[10px] font-mono text-ink-4 tracking-widest">
                {chain.toUpperCase()} · {shortAddr(address)}
              </p>
            </div>
          </div>
        )}

        {/* ── Not found ───────────────────────────────────────────── */}
        {!loading && notFound && !auditing && (
          <div className="stagger-item border" style={{ borderColor: 'var(--border)', background: 'var(--bg-1)' }}>
            {/* Empty state message */}
            <div className="p-10 text-center space-y-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="font-mono text-5xl font-bold text-ink-4">—</div>
              <p className="font-mono text-sm text-ink tracking-wide uppercase">No record found</p>
              <p className="text-sm text-ink-2 font-light max-w-sm mx-auto leading-relaxed">
                This address has no audit history. Run a scan to score it and write the result onchain.
              </p>
            </div>

            {/* Payment action panel */}
            <div className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-3">Request Audit</span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5"
                    style={{ background: 'rgba(212,168,85,0.1)', color: 'var(--accent)', border: '1px solid rgba(212,168,85,0.2)' }}>
                    0.01 USDC
                  </span>
                </div>
                <p className="text-sm font-sans text-ink-2 font-light leading-relaxed max-w-xs">
                  Behavioral scan of onchain activity — scored and written to the registry.
                </p>
                {account && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#27a864' }} />
                    <span className="text-[10px] font-mono" style={{ color: 'var(--ink-4)' }}>
                      {account.address.slice(0, 6)}…{account.address.slice(-4)}
                    </span>
                  </div>
                )}
              </div>

              {account ? (
                <button
                  onClick={runAudit}
                  disabled={auditing || isPaymentPending}
                  className="flex-shrink-0 flex items-center gap-2 px-6 py-2.5 text-sm font-mono font-medium tracking-widest uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'var(--accent)', color: '#060508' }}
                  onMouseEnter={e => { if (!auditing && !isPaymentPending) (e.currentTarget as HTMLButtonElement).style.background = '#c49840'; }}
                  onMouseLeave={e => { if (!auditing && !isPaymentPending) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
                >
                  {isPaymentPending ? 'PAYING…' : auditing ? 'SCANNING…' : 'RUN FIRST AUDIT'}
                </button>
              ) : (
                <div className="flex-shrink-0 flex flex-col items-start gap-1.5">
                  <ConnectButton
                    client={client}
                    chains={[celo, base]}
                    connectButton={{ label: 'CONNECT WALLET' }}
                    connectModal={{ title: 'Connect to run audit', size: 'compact' }}
                    theme={darkTheme({
                      colors: {
                        primaryButtonBg: 'var(--accent)',
                        primaryButtonText: '#060508',
                        modalBg: 'var(--bg-1)',
                        borderColor: 'var(--border)',
                      },
                    })}
                  />
                  <p className="text-[10px] font-mono text-ink-4 tracking-wider">Wallet required to pay</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────── */}
        {error && (
          <div className="border-l-2 px-4 py-3" style={{ borderColor: 'var(--score-bad)', background: 'rgba(192,57,43,0.06)' }}>
            <p className="text-sm font-mono" style={{ color: 'var(--score-bad)' }}>{error}</p>
          </div>
        )}

        {/* ── Score display ────────────────────────────────────────── */}
        {!loading && displayData && lvl && (
          <>
            {/* Score hero + stats grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

              {/* Big score card — the hero element */}
              <div className="stagger-item md:col-span-1" style={{ animationDelay: '80ms' }}>
                <div className="relative border flex flex-col items-center justify-center text-center py-10 px-6 overflow-hidden h-full"
                  style={{
                    borderColor: lvl.border,
                    background: lvl.bg,
                    boxShadow: lvl.glow,
                  }}>
                  {/* Radial glow behind number */}
                  <div className="absolute inset-0 pointer-events-none glow-pulse"
                    style={{
                      background: `radial-gradient(ellipse at center, ${lvl.color}22 0%, transparent 65%)`,
                    }} />

                  <div className="relative z-10 space-y-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink-3 mb-1">TrustScore</div>

                    <AnimatedScore target={displayData.score} color={lvl.color} />

                    {/* Level badge fades in after score lands */}
                    <div className="badge-reveal inline-flex items-center gap-2 px-3 py-1 border font-mono text-xs font-bold tracking-[0.15em]"
                      style={{ borderColor: lvl.border, color: lvl.color, background: lvl.bg }}>
                      <span className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: lvl.color }} />
                      {lvl.label}
                    </div>

                    <div className="text-[10px] font-mono text-ink-3 mt-1">
                      Audited {displayData.auditCount}×
                      {displayData.lastAuditedAt > 0 && (
                        <> · {new Date(displayData.lastAuditedAt * 1000).toLocaleDateString()}</>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div className="stagger-item md:col-span-2 grid grid-cols-2 gap-3" style={{ animationDelay: '140ms' }}>

                {/* Self Protocol */}
                <div className="border p-4 flex flex-col justify-between"
                  style={{
                    borderColor: displayData.isHumanBacked ? 'rgba(39,168,100,0.4)' : 'var(--border)',
                    background: 'var(--bg-2)',
                  }}>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Self Protocol</div>
                  <div className="mt-4">
                    {displayData.isHumanBacked ? (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full badge-verified" style={{ backgroundColor: '#27a864' }} />
                        <span className="text-sm font-mono font-bold" style={{ color: '#27a864' }}>ZK VERIFIED</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full bg-ink-4" />
                        <span className="text-sm font-mono text-ink-2">Not verified</span>
                      </div>
                    )}
                    <p className="text-[11px] font-mono text-ink-3">
                      {displayData.isHumanBacked ? '+15 pts · Human-backed' : 'Verify for +15 pts'}
                    </p>
                  </div>
                </div>

                {/* Transactions */}
                {'totalTxs' in displayData && (
                  <div className="border p-4 flex flex-col justify-between"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Transactions</div>
                    <div className="mt-4 space-y-1">
                      <div className="font-mono font-bold text-3xl text-ink" style={{ letterSpacing: '-0.03em' }}>
                        {(displayData as AuditResult).totalTxs}
                      </div>
                      <p className="text-[11px] font-mono text-ink-3">
                        {(displayData as AuditResult).successfulTxs} ok · {(displayData as AuditResult).failedTxs} failed
                      </p>
                    </div>
                  </div>
                )}

                {/* Account age */}
                {'accountAgeDays' in displayData ? (
                  <div className="border p-4 flex flex-col justify-between"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Account Age</div>
                    <div className="mt-4 space-y-1">
                      <div className="font-mono font-bold text-3xl text-ink" style={{ letterSpacing: '-0.03em' }}>
                        {(displayData as AuditResult).accountAgeDays}
                      </div>
                      <p className="text-[11px] font-mono text-ink-3">days onchain</p>
                    </div>
                  </div>
                ) : (
                  displayData.firstSeenAt > 0 && (
                    <div className="border p-4 flex flex-col justify-between"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3">First Seen</div>
                      <div className="mt-4">
                        <div className="text-sm font-mono text-ink">{new Date(displayData.firstSeenAt * 1000).toLocaleDateString()}</div>
                      </div>
                    </div>
                  )
                )}

                {/* Counterparties */}
                {'uniqueCounterparties' in displayData ? (
                  <div className="border p-4 flex flex-col justify-between"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3">Counterparties</div>
                    <div className="mt-4 space-y-1">
                      <div className="font-mono font-bold text-3xl text-ink" style={{ letterSpacing: '-0.03em' }}>
                        {(displayData as AuditResult).uniqueCounterparties}
                      </div>
                      <p className="text-[11px] font-mono text-ink-3">unique addresses</p>
                    </div>
                  </div>
                ) : (
                  <div className="border p-4 flex flex-col justify-between"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3">ERC-8004 ID</div>
                    <div className="mt-4">
                      {displayData.erc8004Id > 0 ? (
                        <div className="font-mono text-sm text-ink">#{displayData.erc8004Id}</div>
                      ) : (
                        <div className="text-sm text-ink-3 font-mono">—</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Score Breakdown — Intelligence X-Ray ─────────────── */}
            <div className="stagger-item border p-6" style={{ animationDelay: '200ms', borderColor: 'var(--border)', background: 'var(--bg-1)' }}>
              <div className="flex items-center gap-4 mb-6">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-3">Score Breakdown</span>
                <div className="flex-1 h-px border-t border-dashed border-border-bright" />
                <span className="text-xs font-mono font-bold text-ink">{displayData.score}<span className="text-ink-3 font-normal"> / 100</span></span>
              </div>

              <div className="space-y-4">
                {BREAKDOWN_ITEMS.map((item, i) => {
                  const raw   = displayData.breakdown[item.key];
                  const value = typeof raw === 'number' ? raw : 0;
                  const absVal = Math.abs(value);
                  const barColor =
                    item.type === 'penalty' ? (value < 0 ? 'var(--score-caution)' : 'var(--bg-3)') :
                    item.type === 'bonus'   ? 'var(--score-good)' :
                    'var(--accent)';

                  return (
                    <div key={item.key} className="stagger-item" style={{ animationDelay: `${i * 45}ms` }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-sans font-light text-ink-2">{item.label}</span>
                        <span className="text-xs font-mono tabular-nums"
                          style={{
                            color:
                              item.type === 'penalty' && value < 0 ? 'var(--score-caution)' :
                              item.type === 'bonus' && value > 0   ? 'var(--score-good)' :
                              'var(--ink)',
                          }}>
                          {item.type === 'penalty' ? (value < 0 ? value : '—') : value}
                          <span className="text-ink-4"> / {item.max}</span>
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden" style={{ background: 'var(--bg-3)' }}>
                        <div
                          className="score-bar-fill h-full"
                          style={{
                            '--bar-target': `${(absVal / item.max) * 100}%`,
                            animationDelay: `${220 + i * 55}ms`,
                            background: barColor,
                          } as React.CSSProperties}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Audit result — classified document style ──────────── */}
            {auditResult && (
              <div className="stagger-item border-l-2 pl-5 pr-5 py-5 space-y-4"
                style={{
                  animationDelay: '280ms',
                  borderLeftColor: 'var(--score-good)',
                  borderTop: '1px solid var(--border)',
                  borderRight: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-1)',
                }}>

                <div className="flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--score-good)' }} />
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: 'var(--score-good)' }}>
                    Audit Complete
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs font-mono">
                  {auditResult.ensName && (
                    <div>
                      <div className="text-ink-3 mb-1 tracking-widest uppercase text-[10px]">ENS</div>
                      <div className="text-ink">{auditResult.ensName}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-ink-3 mb-1 tracking-widest uppercase text-[10px]">Duration</div>
                    <div className="text-ink">{(auditResult.durationMs / 1000).toFixed(1)}s</div>
                  </div>
                  {auditResult.txHash && (
                    <div>
                      <div className="text-ink-3 mb-1 tracking-widest uppercase text-[10px]">Onchain Write</div>
                      <a href={explorerUrl(chain, auditResult.txHash)} target="_blank" rel="noopener noreferrer"
                        className="hover:underline transition-colors"
                        style={{ color: 'var(--accent)' }}>
                        {shortAddr(auditResult.txHash)}
                      </a>
                    </div>
                  )}
                  {auditResult.latestReportCID && (
                    <div className="col-span-2 md:col-span-3">
                      <div className="text-ink-3 mb-1 tracking-widest uppercase text-[10px]">Report CID (keccak256)</div>
                      <div className="text-ink-2 break-all text-[11px]">{auditResult.latestReportCID.slice(0, 66)}…</div>
                    </div>
                  )}
                </div>

                {/* Report — rendered markdown */}
                {auditResult.report && (
                  <div className="border-t pt-5" style={{ borderColor: 'var(--border-bright)', borderStyle: 'dashed' }}>
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-3 mb-4">Audit Report</div>
                    <div className="audit-report">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => (
                            <div className="flex items-center gap-3 mb-5">
                              <span className="text-[10px] font-mono uppercase tracking-[0.25em] px-2 py-1"
                                style={{ background: 'var(--bg-3)', color: 'var(--accent)', border: '1px solid rgba(212,168,85,0.2)' }}>
                                LOOKOUT REPORT
                              </span>
                              <span className="text-[10px] font-mono text-ink-4 tracking-wider">{String(children).split('—')[1]?.trim()}</span>
                            </div>
                          ),
                          h2: ({ children }) => (
                            <div className="flex items-center gap-3 mt-6 mb-3">
                              <span className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold"
                                style={{ color: 'var(--accent)' }}>{children}</span>
                              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                            </div>
                          ),
                          p: ({ children }) => (
                            <p className="text-sm font-sans font-light leading-relaxed text-ink-2 mb-3">{children}</p>
                          ),
                          strong: ({ children }) => (
                            <strong className="font-semibold" style={{ color: 'var(--ink)' }}>{children}</strong>
                          ),
                          em: ({ children }) => (
                            <em className="not-italic font-mono text-xs" style={{ color: 'var(--ink-3)' }}>{children}</em>
                          ),
                          hr: () => (
                            <div className="my-4 border-t border-dashed" style={{ borderColor: 'var(--border)' }} />
                          ),
                          ul: ({ children }) => (
                            <ul className="space-y-1.5 mb-4">{children}</ul>
                          ),
                          li: ({ children }) => (
                            <li className="flex items-start gap-2.5 text-sm font-sans font-light text-ink-2">
                              <span className="mt-[7px] w-1 h-1 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: 'var(--accent)', opacity: 0.6 }} />
                              <span>{children}</span>
                            </li>
                          ),
                          code: ({ children, className }) => {
                            const isBlock = className?.includes('language-');
                            if (isBlock) {
                              return (
                                <pre className="p-4 my-3 overflow-x-auto"
                                  style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                                  <code className="text-xs font-mono leading-relaxed"
                                    style={{ color: 'var(--ink-2)' }}>{children}</code>
                                </pre>
                              );
                            }
                            return (
                              <code className="text-xs font-mono px-1.5 py-0.5"
                                style={{ background: 'var(--bg-3)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                                {children}
                              </code>
                            );
                          },
                          pre: ({ children }) => <>{children}</>,
                          table: ({ children }) => (
                            <div className="overflow-x-auto mb-4">
                              <table className="w-full text-xs font-mono border-collapse">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => (
                            <thead style={{ borderBottom: '1px solid var(--border-bright)' }}>{children}</thead>
                          ),
                          th: ({ children }) => (
                            <th className="text-left py-2 pr-6 text-[10px] uppercase tracking-widest font-medium"
                              style={{ color: 'var(--ink-3)' }}>{children}</th>
                          ),
                          tr: ({ children }) => (
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>{children}</tr>
                          ),
                          td: ({ children }) => (
                            <td className="py-2 pr-6 text-ink-2">{children}</td>
                          ),
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-xs hover:underline underline-offset-2 transition-colors"
                              style={{ color: 'var(--accent)' }}>
                              {children}
                            </a>
                          ),
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-2 pl-4 my-3"
                              style={{ borderColor: 'var(--accent)', background: 'rgba(212,168,85,0.04)' }}>
                              {children}
                            </blockquote>
                          ),
                        }}
                      >
                        {auditResult.report}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Action links ─────────────────────────────────────── */}
            <div className="stagger-item flex flex-wrap gap-2.5 pt-1" style={{ animationDelay: '320ms' }}>
              {!displayData.isHumanBacked && (
                <Link href="/verify"
                  className="inline-flex items-center gap-2 px-4 py-2 border text-xs font-mono tracking-widest uppercase transition-colors"
                  style={{ borderColor: 'rgba(39,168,100,0.35)', color: '#27a864', background: 'rgba(39,168,100,0.06)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(39,168,100,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(39,168,100,0.06)')}>
                  <span className="w-1.5 h-1.5 rounded-full bg-score-good" />
                  Verify with Self (+15 pts)
                </Link>
              )}
              <a href={explorerAddrUrl(chain, address)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 border text-xs font-mono tracking-widest uppercase text-ink-2 hover:text-ink transition-colors"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border-bright)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)'; }}>
                {chain === 'base' ? 'Basescan' : 'Celoscan'}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
              <a href={`/api/profile/${address}?chain=${chain}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 border text-xs font-mono tracking-widest uppercase text-ink-2 hover:text-ink transition-colors"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border-bright)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)'; }}>
                Raw JSON
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            </div>
          </>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-border px-6 md:px-10 py-4 relative z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-[11px] font-mono text-ink-3 tracking-wide">
          <Link href="/" className="hover:text-ink transition-colors uppercase">← Lookout</Link>
          <span>Contract: <span className="text-ink-2">{shortAddr('0xCe74337add024796C9061D88C0d9fa4836d02FE7')}</span></span>
        </div>
      </footer>
    </div>
  );
}
