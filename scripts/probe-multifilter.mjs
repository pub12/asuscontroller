// scripts/probe-multifilter.mjs — READ-ONLY probe of the router's parental-control
// (MULTIFILTER) nvram. No writes, no block, no reboot. Confirms exact field names
// and current values before implementing the real block mechanism.
//
// Run:  node --env-file=.env.local scripts/probe-multifilter.mjs
const HOST = process.env.ROUTER_HOST;
const USER = process.env.ROUTER_USER;
const PASS = process.env.ROUTER_PASS;
const UA = 'asusrouter-Android-DUTUtil-1.0.0.245';

if (!HOST || !USER || !PASS) {
  console.error('Missing ROUTER_HOST/ROUTER_USER/ROUTER_PASS. Use --env-file=.env.local');
  process.exit(1);
}

const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');
const loginRes = await fetch(`http://${HOST}/login.cgi`, {
  method: 'POST',
  headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ login_authorization: auth }).toString(),
});
const loginJson = await loginRes.json();
const token = loginJson.asus_token;
if (!token) {
  console.error('Login failed:', JSON.stringify(loginJson));
  process.exit(1);
}
console.log('Logged in OK.\n');

const vars = [
  'MULTIFILTER_ALL',
  'MULTIFILTER_ENABLE',
  'MULTIFILTER_MAC',
  'MULTIFILTER_DEVICENAME',
  'MULTIFILTER_MACFILTER_DAYTIME_V2',
  'MULTIFILTER_MACFILTER_DAYTIME',
];
for (const v of vars) {
  const res = await fetch(`http://${HOST}/appGet.cgi?hook=nvram_get(${v})`, {
    headers: { 'User-Agent': UA, Cookie: `asus_token=${token}`, Referer: `http://${HOST}/index.asp` },
  });
  const text = await res.text();
  let val;
  try {
    val = JSON.parse(text)[v];
  } catch {
    val = `(unparseable: ${text.slice(0, 80)})`;
  }
  console.log(`  ${v} = ${JSON.stringify(val)}`);
}
