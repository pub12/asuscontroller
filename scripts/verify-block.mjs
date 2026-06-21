// scripts/verify-block.mjs — unit check for AsusWrtProvider real blocking.
//
// Mocks a STATEFUL ASUS router (login + MULTIFILTER nvram + applyapp.cgi) so it
// makes ZERO real network calls. Proves the provider:
//   - auto-logs-in before any authed call,
//   - blocks by appending an ENABLE=2 entry (or flipping an existing one) while
//     preserving other entries,
//   - commits with action_mode=apply + rc_service=restart_firewall,
//   - unblocks by removing only its own entry,
//   - reports getBlockState from the live table,
//   - refuses to write when the four lists are misaligned.
//
// Run:  node --conditions=react-server --loader ./scripts/live-block-loader.mjs scripts/verify-block.mjs
process.env.ROUTER_HOST ||= '10.0.0.1';
process.env.ROUTER_USER ||= 'tester';
process.env.ROUTER_PASS ||= 'secret';

const enc = (s) => s.replaceAll('>', '&#62').replaceAll('<', '&#60');

// --- stateful fake router ---------------------------------------------------
function makeRouter(initial) {
  const state = { MULTIFILTER_ALL: '1', ...initial };
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/login.cgi')) {
      return new Response(JSON.stringify({ asus_token: 'TESTTOKEN' }), { status: 200 });
    }
    const nv = u.match(/nvram_get\(([^)]+)\)/);
    if (nv) {
      const name = nv[1];
      return new Response(JSON.stringify({ [name]: enc(state[name] ?? '') }), { status: 200 });
    }
    if (u.includes('/applyapp.cgi')) {
      const params = new URLSearchParams(init.body);
      for (const [k, v] of params) {
        if (k.startsWith('MULTIFILTER') || k === 'action_mode' || k === 'rc_service') state[k] = v;
      }
      state._lastApply = Object.fromEntries(params);
      return new Response(JSON.stringify({ '': '' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return { state, calls, fetchImpl };
}

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `   ${extra ?? ''}`}`);
  if (!cond) failures++;
};

const { AsusWrtProvider } = await import('../src/server/router/AsusWrtProvider.ts');

// Two pre-existing GUI time-schedule entries (ENABLE=1) that must be preserved.
const baseState = () => ({
  MULTIFILTER_MAC: 'AA:AA:AA:AA:AA:AA>BB:BB:BB:BB:BB:BB',
  MULTIFILTER_ENABLE: '1>1',
  MULTIFILTER_DEVICENAME: 'Existing A>Existing B',
  MULTIFILTER_MACFILTER_DAYTIME_V2: 'W03E07000800<W04E09001000>W05E11001200',
});
const NEW = 'CC:CC:CC:CC:CC:CC';

// --- 1) BLOCK appends ENABLE=2, preserves existing, commits with restart_firewall ---
{
  const r = makeRouter(baseState());
  globalThis.fetch = r.fetchImpl;
  const res = await new AsusWrtProvider().setInternetAccess(NEW, false);
  check('block returns success', res.success === true, res.message);
  check('block appended MAC (now 3 entries)', r.state.MULTIFILTER_MAC === 'AA:AA:AA:AA:AA:AA>BB:BB:BB:BB:BB:BB>' + NEW, r.state.MULTIFILTER_MAC);
  check('block set new entry ENABLE=2, preserved others', r.state.MULTIFILTER_ENABLE === '1>1>2', r.state.MULTIFILTER_ENABLE);
  check('block preserved existing daytime schedules', r.state.MULTIFILTER_MACFILTER_DAYTIME_V2 === 'W03E07000800<W04E09001000>W05E11001200><', r.state.MULTIFILTER_MACFILTER_DAYTIME_V2);
  check('commit used action_mode=apply', r.state._lastApply.action_mode === 'apply');
  check('commit used rc_service=restart_firewall', r.state._lastApply.rc_service === 'restart_firewall');
  check('commit set MULTIFILTER_ALL=1', r.state._lastApply.MULTIFILTER_ALL === '1');
  const loginIdx = r.calls.findIndex((u) => u.includes('/login.cgi'));
  const applyIdx = r.calls.findIndex((u) => u.includes('/applyapp.cgi'));
  check('auto-login precedes applyapp', loginIdx >= 0 && applyIdx > loginIdx);
}

// --- 2) BLOCK an already-listed scheduled MAC flips it to ENABLE=2 in place ---
{
  const r = makeRouter(baseState());
  globalThis.fetch = r.fetchImpl;
  const res = await new AsusWrtProvider().setInternetAccess('aa:aa:aa:aa:aa:aa', false); // lowercase on purpose
  check('block existing returns success', res.success === true, res.message);
  check('block existing flipped only its ENABLE to 2', r.state.MULTIFILTER_ENABLE === '2>1', r.state.MULTIFILTER_ENABLE);
  check('block existing did not change entry count', r.state.MULTIFILTER_MAC === 'AA:AA:AA:AA:AA:AA>BB:BB:BB:BB:BB:BB', r.state.MULTIFILTER_MAC);
}

// --- 3) UNBLOCK removes only our entry ---
{
  const start = baseState();
  start.MULTIFILTER_MAC += '>' + NEW;
  start.MULTIFILTER_ENABLE += '>2';
  start.MULTIFILTER_DEVICENAME += '>NetWarden block';
  start.MULTIFILTER_MACFILTER_DAYTIME_V2 += '><';
  const r = makeRouter(start);
  globalThis.fetch = r.fetchImpl;
  const res = await new AsusWrtProvider().setInternetAccess(NEW, true);
  check('unblock returns success', res.success === true, res.message);
  check('unblock removed our MAC, kept the other two', r.state.MULTIFILTER_MAC === 'AA:AA:AA:AA:AA:AA>BB:BB:BB:BB:BB:BB', r.state.MULTIFILTER_MAC);
  check('unblock removed our ENABLE entry', r.state.MULTIFILTER_ENABLE === '1>1', r.state.MULTIFILTER_ENABLE);
}

// --- 4) getBlockState reflects the table ---
{
  const start = baseState();
  start.MULTIFILTER_MAC += '>' + NEW;
  start.MULTIFILTER_ENABLE += '>2';
  start.MULTIFILTER_DEVICENAME += '>NetWarden block';
  start.MULTIFILTER_MACFILTER_DAYTIME_V2 += '><';
  const r = makeRouter(start);
  globalThis.fetch = r.fetchImpl;
  const p = new AsusWrtProvider();
  check('getBlockState true for ENABLE=2 device', (await p.getBlockState(NEW)) === true);
  check('getBlockState false for ENABLE=1 (scheduled) device', (await p.getBlockState('AA:AA:AA:AA:AA:AA')) === false);
  check('getBlockState false for absent device', (await p.getBlockState('DD:DD:DD:DD:DD:DD')) === false);
}

// --- 5) misaligned lists are refused, not written ---
{
  const r = makeRouter({
    MULTIFILTER_MAC: 'AA:AA:AA:AA:AA:AA>BB:BB:BB:BB:BB:BB',
    MULTIFILTER_ENABLE: '1', // <-- only one entry: misaligned
    MULTIFILTER_DEVICENAME: 'A>B',
    MULTIFILTER_MACFILTER_DAYTIME_V2: '<><',
  });
  globalThis.fetch = r.fetchImpl;
  const res = await new AsusWrtProvider().setInternetAccess(NEW, false);
  check('misaligned lists -> success:false', res.success === false, res.message);
  check('misaligned lists -> no applyapp write', r.state._lastApply === undefined);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
