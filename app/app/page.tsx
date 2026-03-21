'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isAddress, getAddress } from 'viem';

const EXAMPLE_AGENTS = [
  { address: '0x460297743e19A4a06D3Ee6D0a7B52b74E51a64AE', label: 'Demo · Base', chain: 'base' },
  { address: '0xc15366f6ac00df1b2ab09a06feea3a62e1ecdd3e', label: 'Demo · Celo', chain: 'celo' },
];

export default function Home() {
  const [address,    setAddress]    = useState('');
  const [chain,      setChain]      = useState<'celo' | 'base'>('celo');
  const [error,      setError]      = useState('');
  const [focused,    setFocused]    = useState(false);
  const [resolving,  setResolving]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router   = useRouter();

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const val = address.trim();
    if (!val) { inputRef.current?.focus(); return; }

    // ENS name — resolve it to an address first
    if (val.endsWith('.eth') || (val.includes('.') && !val.startsWith('0x'))) {
      setResolving(true);
      setError('');
      try {
        const res = await fetch(`/api/ens/resolve/${encodeURIComponent(val)}`);
        const data = await res.json();
        if (!res.ok || !data.address) {
          setError(`Could not resolve "${val}" — ENS name not found.`);
          return;
        }
        router.push(`/agent/${data.address}?chain=${chain}`);
      } catch {
        setError('ENS resolution failed. Try pasting the 0x address directly.');
      } finally {
        setResolving(false);
      }
      return;
    }

    if (!isAddress(val)) { setError('Not a valid EVM address or ENS name.'); return; }
    setError('');
    router.push(`/agent/${getAddress(val)}?chain=${chain}`);
  }

  function loadExample(addr: string, c: string) {
    setAddress(addr);
    setChain(c as 'celo' | 'base');
    setError('');
    inputRef.current?.focus();
  }

  return (
    <main className="relative min-h-screen flex flex-col overflow-hidden">

      {/* ── Ambient glow — radial in amber behind hero ────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[700px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(212,168,85,0.055) 0%, transparent 68%)' }} />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px]"
          style={{ background: 'radial-gradient(ellipse at bottom right, rgba(0,184,212,0.03) 0%, transparent 70%)' }} />
      </div>

      {/* ── Nav ───────────────────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 py-5 border-b border-border">
        <div className="flex items-center gap-4">
          {/* Amber status dot */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
              style={{ backgroundColor: 'var(--accent)' }} />
            <span className="relative inline-flex rounded-full h-2 w-2"
              style={{ backgroundColor: 'var(--accent)' }} />
          </span>
          <span className="font-display text-lg tracking-[0.18em] text-ink font-semibold">LOOKOUT</span>
        </div>
        <div className="flex items-center gap-5 text-xs font-mono text-ink-3">
          <a href="/verify" className="hover:text-ink transition-colors tracking-wide">VERIFY</a>
          <a href="https://github.com/sandralookout/lookout" target="_blank" rel="noopener noreferrer"
            className="hover:text-ink transition-colors tracking-wide">GITHUB</a>
          <a href="/api/score/0xCd08B2269907d34Ff99C46AcfFE7a2e90059a2D8?chain=celo"
            target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 border border-border-bright rounded text-ink-2 hover:text-accent hover:border-accent transition-colors tracking-wide">
            API
          </a>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16 md:py-24">

        {/* Classification badge */}
        <div className="mb-10 stagger-item" style={{ animationDelay: '0ms' }}>
          <span className="inline-flex items-center gap-2.5 px-4 py-1.5 border font-mono text-[11px] tracking-[0.15em] uppercase"
            style={{ borderColor: 'rgba(212,168,85,0.3)', color: 'rgba(212,168,85,0.8)', background: 'rgba(212,168,85,0.05)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-score-good" />
            Celo · Base · ERC-8004 · Self Protocol
          </span>
        </div>

        {/* Headline — Fraunces editorial masthead */}
        <div className="stagger-item text-center mb-6" style={{ animationDelay: '80ms' }}>
          <h1 className="font-display font-semibold text-[clamp(3.5rem,11vw,8rem)] leading-[0.88] tracking-tight text-ink mb-0">
            Agent Trust
          </h1>
          <h1 className="font-display font-light italic text-[clamp(3.5rem,11vw,8rem)] leading-[0.88] tracking-tight"
            style={{ color: 'var(--accent)' }}>
            Intelligence.
          </h1>
        </div>

        {/* Separator + tagline */}
        <div className="stagger-item flex flex-col items-center gap-4 mb-12" style={{ animationDelay: '160ms' }}>
          <div className="w-12 h-px" style={{ backgroundColor: 'rgba(212,168,85,0.4)' }} />
          <p className="text-center text-ink-2 font-sans text-sm max-w-sm leading-relaxed font-light tracking-wide">
            Onchain behavioral scoring for AI agents —<br />
            composable, ZK-verified, credit-bureau model.
          </p>
        </div>

        {/* ── Search form — terminal lookup ────────────────────────── */}
        <form onSubmit={handleSubmit}
          className="stagger-item w-full max-w-2xl"
          style={{ animationDelay: '240ms' }}>

          <div className="relative flex border transition-all duration-200"
            style={{
              borderColor: focused ? 'var(--accent)' : 'var(--border-bright)',
              background: 'var(--bg-2)',
              boxShadow: focused ? '0 0 0 1px rgba(212,168,85,0.15), 0 0 24px rgba(212,168,85,0.06)' : 'none',
            }}>

            {/* Chain selector */}
            <div className="flex-shrink-0 flex items-center border-r"
              style={{ borderColor: 'var(--border)' }}>
              <select
                value={chain}
                onChange={e => setChain(e.target.value as 'celo' | 'base')}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="h-full px-4 bg-transparent text-xs font-mono tracking-widest cursor-pointer focus:outline-none appearance-none pr-8 uppercase"
                style={{
                  color: 'var(--ink-2)',
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%238a7f8e'/%3E%3C/svg%3E\")",
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                }}
              >
                <option value="celo">CELO</option>
                <option value="base">BASE</option>
              </select>
            </div>

            {/* Address input */}
            <input
              ref={inputRef}
              type="text"
              value={address}
              onChange={e => { setAddress(e.target.value); setError(''); }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="_ agent address (0x...) or ENS name"
              className="flex-1 px-5 py-4 bg-transparent text-sm font-mono focus:outline-none"
              style={{ color: 'var(--ink)', caretColor: 'var(--accent)' }}
              spellCheck={false}
              autoComplete="off"
            />

            {/* Submit */}
            <button type="submit"
              disabled={resolving}
              className="flex-shrink-0 m-1.5 px-6 py-2.5 text-sm font-mono font-medium tracking-widest uppercase transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: resolving ? 'var(--bg-3)' : 'var(--accent)',
                color: resolving ? 'var(--ink-2)' : '#060508',
              }}
              onMouseEnter={e => { if (!resolving) (e.currentTarget as HTMLButtonElement).style.background = '#c49840'; }}
              onMouseLeave={e => { if (!resolving) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
            >
              {resolving ? 'RESOLVING…' : 'SCAN'}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-xs font-mono pl-1" style={{ color: 'var(--score-bad)' }}>{error}</p>
          )}
        </form>

        {/* Example agents */}
        <div className="stagger-item mt-5 flex items-center gap-3 flex-wrap justify-center"
          style={{ animationDelay: '320ms' }}>
          <span className="text-xs font-mono text-ink-3 tracking-widest uppercase">Try:</span>
          {EXAMPLE_AGENTS.map(ex => (
            <button
              key={ex.address}
              onClick={() => loadExample(ex.address, ex.chain)}
              className="text-xs font-mono text-ink-2 transition-colors border rounded-none px-3 py-1.5"
              style={{ borderColor: 'var(--border-bright)', background: 'var(--bg-2)' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.color = '';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-bright)';
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </section>

      {/* ── Intel stats bar ───────────────────────────────────────────── */}
      <div className="relative z-10 border-t border-border">
        <div className="max-w-4xl mx-auto px-6 md:px-10 py-7 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: 'SCORING COMPONENTS', value: '8' },
            { label: 'ZK BONUS',           value: '+15 pts' },
            { label: 'CHAINS',             value: 'Celo · Base' },
            { label: 'DATA SOURCE',        value: 'Onchain Only' },
          ].map((stat, i) => (
            <div key={stat.label} className="stagger-item" style={{ animationDelay: `${420 + i * 55}ms` }}>
              <div className="font-mono font-bold text-xl tracking-tight" style={{ color: 'var(--accent)' }}>{stat.value}</div>
              <div className="text-[10px] text-ink-3 mt-1 font-mono tracking-widest">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scoring model ─────────────────────────────────────────────── */}
      <div className="relative z-10 border-t border-border" style={{ background: 'var(--bg-1)' }}>
        <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
          <div className="flex items-center gap-4 mb-6">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-3">Scoring Model</span>
            <div className="flex-1 h-px border-t border-dashed border-border-bright" />
            <span className="text-[10px] font-mono text-ink-3">0 — 100</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {[
              { label: 'Tx Count',       max: 15, type: 'base' },
              { label: 'Success Rate',   max: 15, type: 'base' },
              { label: 'Account Age',    max: 15, type: 'base' },
              { label: 'Counterparties', max: 15, type: 'base' },
              { label: 'Self Verified',  max: 15, type: 'bonus' },
              { label: 'ENS Name',       max: 5,  type: 'bonus' },
              { label: 'Consistency',    max: 10, type: 'bonus' },
              { label: 'Penalties',      max: 30, type: 'penalty' },
            ].map((item, i) => (
              <div key={item.label} className="stagger-item border p-3"
                style={{
                  animationDelay: `${i * 35}ms`,
                  background: 'var(--bg-2)',
                  borderColor: 'var(--border)',
                }}>
                <div className="flex items-start justify-between gap-1">
                  <span className="text-xs text-ink-2 font-sans font-light leading-tight">{item.label}</span>
                  {item.type !== 'base' && (
                    <span className="text-[9px] font-mono px-1 py-0.5 flex-shrink-0"
                      style={{
                        color: item.type === 'penalty' ? 'var(--score-caution)' : 'var(--score-good)',
                        border: `1px solid ${item.type === 'penalty' ? 'rgba(212,160,48,0.3)' : 'rgba(39,168,100,0.3)'}`,
                      }}>
                      {item.type === 'penalty' ? 'RISK' : 'BONUS'}
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-ink-3 mt-2">max {item.max} pts</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-border px-6 md:px-10 py-5">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-[11px] text-ink-3 font-mono tracking-wide">
          <span>© 2026 LOOKOUT · The Synthesis</span>
          <div className="flex gap-6">
            <a href="https://lookout.watch" className="hover:text-ink transition-colors uppercase">lookout.watch</a>
            <a href="/skill.md" className="hover:text-ink transition-colors uppercase">skill.md</a>
            <a href="/api/score/0xCd08B2269907d34Ff99C46AcfFE7a2e90059a2D8" className="hover:text-ink transition-colors uppercase">API</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
