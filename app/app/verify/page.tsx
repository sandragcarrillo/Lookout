'use client';

import { useState } from 'react';
import { isAddress, getAddress, createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import Link from 'next/link';
import { SelfVerification } from '../../components/SelfVerification';

type Step = 'input' | 'qr' | 'done' | 'error';
type OwnershipStatus = 'unknown' | 'checking' | 'owner' | 'not_owner';
type SelfStatus =
  | { verified: true; agentId: string; expiresAt: string | null; expiringSoon: boolean }
  | { verified: false; reason: string; reauthUrl?: string }
  | null;

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string }) => Promise<string[]> };
  }
}

async function readContractOwner(addr: `0x${string}`): Promise<string | null> {
  const client = createPublicClient({ chain: celo, transport: http('https://forno.celo.org') });
  try {
    const owner = await client.readContract({
      address: addr,
      abi: [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
      functionName: 'owner',
    });
    return getAddress(owner as string);
  } catch { return null; }
}

export default function VerifyPage() {
  const [address,          setAddress]          = useState('');
  const [connectedWallet,  setConnectedWallet]  = useState<string | null>(null);
  const [connecting,       setConnecting]       = useState(false);
  const [ownership,        setOwnership]        = useState<OwnershipStatus>('unknown');
  const [step,             setStep]             = useState<Step>('input');
  const [errorMsg,         setErrorMsg]         = useState('');
  const [statusAddr,       setStatusAddr]       = useState('');
  const [statusResult,     setStatusResult]     = useState<SelfStatus>(null);
  const [statusLoading,    setStatusLoading]    = useState(false);
  const [statusError,      setStatusError]      = useState('');

  async function connectWallet() {
    if (!window.ethereum) { setErrorMsg('No wallet detected. Install MetaMask or a compatible wallet.'); return; }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const wallet = getAddress(accounts[0]);
      setConnectedWallet(wallet);
      setAddress(wallet);
      setOwnership('owner');
      setErrorMsg('');
    } catch { setErrorMsg('Wallet connection rejected.'); }
    finally { setConnecting(false); }
  }

  async function checkOwnership(agentAddress: string) {
    if (!connectedWallet || !isAddress(agentAddress)) { setOwnership('unknown'); return; }
    const checksummed = getAddress(agentAddress);
    if (checksummed === connectedWallet) { setOwnership('owner'); return; }
    setOwnership('checking');
    const contractOwner = await readContractOwner(checksummed as `0x${string}`);
    setOwnership(contractOwner === connectedWallet ? 'owner' : 'not_owner');
  }

  function handleAddressChange(value: string) {
    setAddress(value);
    setOwnership('unknown');
    if (connectedWallet && isAddress(value)) checkOwnership(value);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(address)) { setErrorMsg('Enter a valid 0x address'); return; }
    setErrorMsg('');
    setStep('qr');
  }

  async function checkStatus() {
    if (!isAddress(statusAddr)) { setStatusError('Enter a valid 0x address'); return; }
    setStatusError(''); setStatusResult(null); setStatusLoading(true);
    try {
      const res  = await fetch(`/api/self/status/${getAddress(statusAddr)}`);
      const data = await res.json();
      if (!res.ok) { setStatusError(data.error ?? 'Status check failed'); return; }
      setStatusResult(data);
    } catch (err) { setStatusError(String(err)); }
    finally { setStatusLoading(false); }
  }

  const ownerBadge = connectedWallet && isAddress(address) ? (() => {
    if (ownership === 'checking')  return { text: 'Checking ownership…', ok: null };
    if (ownership === 'owner')     return { text: '✓ You own this address', ok: true };
    if (ownership === 'not_owner') return { text: '⚠ Connected wallet is not the owner', ok: false };
    return null;
  })() : null;

  return (
    <div className="min-h-screen flex flex-col">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="font-display text-lg tracking-widest text-ink-2 group-hover:text-ink transition-colors">LOOKOUT</span>
        </Link>
        <span className="text-xs font-mono text-ink-3 uppercase tracking-wider">Self Verification</span>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12 space-y-8">

        {/* Header */}
        <div className="stagger-item space-y-3" style={{ animationDelay: '0ms' }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] badge-verified" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-3">Self Protocol · ZK Identity</span>
          </div>
          <h1 className="font-display text-4xl tracking-wider text-ink">VERIFY YOUR AGENT</h1>
          <p className="text-sm text-ink-2 leading-relaxed max-w-md">
            Prove a human backs your AI agent using a ZK identity proof.
            Verified agents receive a permanent{' '}
            <span className="text-[#22c55e] font-semibold">+15 TrustScore</span>{' '}
            bonus on every audit.
          </p>
        </div>

        {/* How it works */}
        <div className="stagger-item rounded-xl border border-border bg-bg-2 p-5 space-y-4" style={{ animationDelay: '80ms' }}>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-3">How it works</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { n: '01', title: 'Scan QR',        desc: 'Open the Self app and scan the code below' },
              { n: '02', title: 'ZK Proof',        desc: 'Self generates a proof without revealing your passport data' },
              { n: '03', title: 'Score Update',    desc: '+15 TrustScore applied on your next audit' },
            ].map(item => (
              <div key={item.n} className="flex gap-3">
                <span className="font-display text-xl text-ink-4 mt-0.5 flex-shrink-0">{item.n}</span>
                <div>
                  <div className="text-sm font-semibold text-ink mb-1">{item.title}</div>
                  <div className="text-xs text-ink-3 leading-relaxed">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Input step ─────────────────────────────────────── */}
        {step === 'input' && (
          <div className="stagger-item space-y-4" style={{ animationDelay: '160ms' }}>

            {/* Wallet connect */}
            {!connectedWallet ? (
              <button onClick={connectWallet} disabled={connecting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border bg-bg-2 hover:border-border-bright text-ink-2 hover:text-ink text-sm font-medium transition-colors disabled:opacity-50">
                {connecting ? 'Connecting…' : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                    </svg>
                    Connect wallet to auto-fill agent address
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                  <span className="text-xs text-ink-3">Connected</span>
                </div>
                <span className="font-mono text-xs text-[#22c55e]">
                  {connectedWallet.slice(0, 6)}…{connectedWallet.slice(-4)}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-2">
                <label htmlFor="agent-address" className="text-xs font-mono uppercase tracking-wider text-ink-3">
                  Agent wallet address
                </label>
                <input
                  id="agent-address"
                  type="text"
                  value={address}
                  onChange={e => handleAddressChange(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-bg-2 border border-border rounded-xl px-4 py-3 text-sm font-mono text-ink placeholder-ink-4 focus:outline-none focus:border-accent transition-colors"
                />
                {ownerBadge && (
                  <p className={`text-xs font-mono ${ownerBadge.ok === true ? 'text-[#22c55e]' : ownerBadge.ok === false ? 'text-[#f59e0b]' : 'text-ink-3'}`}>
                    {ownerBadge.text}
                  </p>
                )}
                {errorMsg && <p className="text-xs font-mono text-score-bad">{errorMsg}</p>}
              </div>
              <button type="submit"
                className="w-full py-3 rounded-xl bg-accent hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-semibold transition-colors">
                Generate Verification QR
              </button>
            </form>

            <p className="text-center text-xs text-ink-3">
              First time?{' '}
              <a href="https://app.ai.self.xyz/agents/register" target="_blank" rel="noopener noreferrer"
                className="text-accent hover:underline">
                Register on Self Agent ID →
              </a>
            </p>
          </div>
        )}

        {/* ── QR step ────────────────────────────────────────── */}
        {step === 'qr' && (
          <div className="stagger-item space-y-5" style={{ animationDelay: '0ms' }}>
            <div className="rounded-xl border border-border bg-white p-6 flex items-center justify-center">
              <SelfVerification
                agentAddress={address}
                onSuccess={() => setStep('done')}
                onError={err => { setErrorMsg(err.message); setStep('error'); }}
              />
            </div>
            <div className="rounded-xl border border-border bg-bg-2 px-4 py-3 font-mono text-xs text-ink-3 break-all">
              {address}
            </div>
            <button onClick={() => setStep('input')}
              className="w-full text-xs font-mono text-ink-3 hover:text-ink py-2 transition-colors">
              ← Use a different address
            </button>
          </div>
        )}

        {/* ── Done step ──────────────────────────────────────── */}
        {step === 'done' && (
          <div className="stagger-item text-center space-y-5 py-8" style={{ animationDelay: '0ms' }}>
            <div className="relative inline-block">
              <span className="absolute -inset-2 rounded-full bg-[#22c55e]/10 animate-ping" />
              <span className="relative w-12 h-12 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/40 flex items-center justify-center mx-auto">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
            </div>
            <div>
              <h2 className="font-display text-2xl tracking-wider text-[#22c55e]">VERIFIED</h2>
              <p className="text-sm text-ink-2 mt-2 max-w-xs mx-auto">
                ZK proof submitted. Run a fresh audit to see your +15 TrustScore bonus applied.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <a href={`/agent/${address}`}
                className="block w-full py-3 rounded-xl bg-[#22c55e] hover:bg-green-400 text-black text-sm font-bold transition-colors">
                View Updated Score →
              </a>
              <button onClick={() => { setStep('input'); setAddress(''); setConnectedWallet(null); }}
                className="text-xs text-ink-3 hover:text-ink py-2 transition-colors">
                Verify another agent
              </button>
            </div>
          </div>
        )}

        {/* ── Error step ─────────────────────────────────────── */}
        {step === 'error' && (
          <div className="stagger-item text-center space-y-4 py-8">
            <div className="w-12 h-12 rounded-full border border-score-bad/40 bg-score-bad/10 flex items-center justify-center mx-auto">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-score-bad">Verification failed</h2>
              <p className="text-xs font-mono text-ink-3 mt-2 bg-bg-2 border border-border rounded px-3 py-2">{errorMsg || 'Unknown error'}</p>
            </div>
            <button onClick={() => setStep('qr')}
              className="px-5 py-2.5 rounded-xl bg-bg-2 border border-border hover:border-border-bright text-ink text-sm font-semibold transition-colors">
              Try again
            </button>
          </div>
        )}

        {/* ── Status Checker ─────────────────────────────────── */}
        <div className="stagger-item border-t border-border pt-8 space-y-4" style={{ animationDelay: '240ms' }}>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-3">Check Verification Status</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <p className="text-xs text-ink-3">Look up any agent address on the Self Agent Registry (Celo mainnet).</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={statusAddr}
              onChange={e => { setStatusAddr(e.target.value); setStatusResult(null); setStatusError(''); }}
              placeholder="0x..."
              className="flex-1 bg-bg-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-ink placeholder-ink-4 focus:outline-none focus:border-accent transition-colors"
            />
            <button onClick={checkStatus} disabled={statusLoading}
              className="px-4 py-2 rounded-lg bg-bg-3 border border-border hover:border-border-bright text-ink-2 hover:text-ink text-xs font-medium disabled:opacity-50 transition-colors whitespace-nowrap">
              {statusLoading ? 'Checking…' : 'Check'}
            </button>
          </div>
          {statusError && <p className="text-xs font-mono text-score-bad">{statusError}</p>}
          {statusResult && (
            <div className={`rounded-lg border p-4 space-y-2 text-xs ${statusResult.verified ? 'border-[#22c55e]/30 bg-[#22c55e]/5' : 'border-border bg-bg-2'}`}>
              {statusResult.verified ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] badge-verified" />
                    <span className="font-semibold text-[#22c55e]">Self-verified</span>
                    {statusResult.expiringSoon && <span className="text-[#f59e0b] font-mono">(expiring soon)</span>}
                  </div>
                  <div className="font-mono text-ink-3 space-y-0.5">
                    <p>Agent ID: <span className="text-ink">{statusResult.agentId}</span></p>
                    {statusResult.expiresAt && (
                      <p>Proof expires: <span className="text-ink">{new Date(statusResult.expiresAt).toLocaleDateString()}</span></p>
                    )}
                    <p className="text-[#22c55e]">+15 TrustScore active</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-ink-2">
                    {statusResult.reason === 'NOT_REGISTERED'  && 'Not registered on Self Agent ID'}
                    {statusResult.reason === 'NO_HUMAN_PROOF'  && 'Registered, no human proof yet'}
                    {statusResult.reason === 'PROOF_EXPIRED'   && 'Proof expired'}
                  </div>
                  {statusResult.reason === 'PROOF_EXPIRED' && statusResult.reauthUrl && (
                    <a href={statusResult.reauthUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Re-authenticate →</a>
                  )}
                  {statusResult.reason === 'NOT_REGISTERED' && (
                    <a href="https://app.ai.self.xyz/agents/register" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Register on Self Agent ID →</a>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between text-[11px] font-mono text-ink-3">
          <Link href="/" className="hover:text-ink transition-colors">← Lookout</Link>
          <span>Powered by <a href="https://self.xyz" target="_blank" rel="noopener noreferrer" className="hover:text-ink transition-colors">Self Protocol</a></span>
        </div>
      </footer>
    </div>
  );
}
