// scripts/live-block-multifilter.mjs — LIVE, reversible verification of the real
// MULTIFILTER block against the actual router, using the production provider.
//
// Pinned to Google home - kitchen only. Reads the parental-control table before
// and after so we can see the exact change. ENABLE=2 = 24/7 block.
//
//   node --conditions=react-server --loader ./scripts/live-block-loader.mjs --env-file=.env.local scripts/live-block-multifilter.mjs status
//   node ... scripts/live-block-multifilter.mjs block
//   node ... scripts/live-block-multifilter.mjs unblock
const MAC = '00:F4:8D:91:04:59'; // Google home - kitchen — the only device this touches
const mode = process.argv[2] ?? 'status';

const { AsusWrtProvider } = await import('../src/server/router/AsusWrtProvider.ts');
const p = new AsusWrtProvider();

async function snapshot(label) {
  const blocked = await p.getBlockState(MAC);
  console.log(`\n[${label}] getBlockState(${MAC}) = ${blocked}`);
}

await snapshot('before');

if (mode === 'block' || mode === 'unblock') {
  const enabled = mode === 'unblock'; // unblock => grant internet
  console.log(`\n>>> setInternetAccess(${MAC}, ${enabled})  [${mode.toUpperCase()}]`);
  const res = await p.setInternetAccess(MAC, enabled);
  console.log('result:', JSON.stringify(res));
  // restart_firewall takes a few seconds to regenerate rules.
  console.log('waiting 6s for restart_firewall to apply…');
  await new Promise((r) => setTimeout(r, 6000));
  await snapshot('after');
}

console.log('\nDone.');
