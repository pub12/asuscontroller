// scripts/verify-autologin.mjs — unit check: AsusWrtProvider must auto-login.
//
// Reproduces the "block didn't block" bug: a fresh AsusWrtProvider (no explicit
// login()) must still authenticate before set_client_state / get_clientlist.
// Mocks global.fetch so it makes ZERO real network calls.
//
// Run:  node --conditions=react-server scripts/verify-autologin.mjs
process.env.ROUTER_HOST ||= '10.0.0.1';
process.env.ROUTER_USER ||= 'tester';
process.env.ROUTER_PASS ||= 'secret';

const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push(u);
  if (u.includes('/login.cgi')) {
    return new Response(JSON.stringify({ asus_token: 'TESTTOKEN' }), { status: 200 });
  }
  if (u.includes('hook=get_clientlist')) {
    return new Response(JSON.stringify({ get_clientlist: {} }), { status: 200 });
  }
  if (u.includes('/applyapp.cgi')) {
    return new Response(JSON.stringify({ '': '' }), { status: 200 });
  }
  return new Response('not found', { status: 404 });
};

const { AsusWrtProvider } = await import('../src/server/router/AsusWrtProvider.ts');

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

// --- setInternetAccess on a FRESH provider (the bug path) ---
{
  calls.length = 0;
  const p = new AsusWrtProvider();
  const res = await p.setInternetAccess('DC:BD:7A:D6:2F:02', false);
  const loginIdx = calls.findIndex((u) => u.includes('/login.cgi'));
  const applyIdx = calls.findIndex((u) => u.includes('/applyapp.cgi'));
  check('setInternetAccess auto-logs-in before applyapp.cgi', loginIdx >= 0 && applyIdx > loginIdx);
  check('setInternetAccess returns success on fresh provider', res.success === true);
}

// --- getClientList on a FRESH provider ---
{
  calls.length = 0;
  const p = new AsusWrtProvider();
  await p.getClientList();
  const loginIdx = calls.findIndex((u) => u.includes('/login.cgi'));
  const listIdx = calls.findIndex((u) => u.includes('hook=get_clientlist'));
  check('getClientList auto-logs-in before get_clientlist', loginIdx >= 0 && listIdx > loginIdx);
}

// --- login is reused, not repeated every call ---
{
  calls.length = 0;
  const p = new AsusWrtProvider();
  await p.setInternetAccess('DC:BD:7A:D6:2F:02', false);
  await p.setInternetAccess('DC:BD:7A:D6:2F:02', true);
  const logins = calls.filter((u) => u.includes('/login.cgi')).length;
  check('login happens once and the token is reused across calls', logins === 1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
