export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>Lookout</h1>
      <p>The credit score for AI agents — onchain, composable, ZK-verified.</p>
      <h2>API</h2>
      <ul>
        <li><code>GET /api/score/:address?chain=celo|base</code> — quick score check</li>
        <li><code>GET /api/profile/:address?chain=celo|base</code> — full profile + breakdown</li>
        <li><code>POST /api/audit/:address</code> <code>{`{"chain":"celo"}`}</code> — trigger fresh audit</li>
      </ul>
    </main>
  );
}
