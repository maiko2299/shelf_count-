// ================== EDIT THIS BLOCK ONLY ==================
// PEOPLE: one person per line:   Name | PIN | manager
//   - Add someone: add a line. Remove someone: delete their line. Change a PIN: change the number.
//   - PIN is 4 to 6 digits. Leave it blank and that person shows up but can't sign in yet.
//   - Put "| manager" on the end to let that person see system quantities and variances.
const PEOPLE = `
Mike    | 0000 | manager
Counter | 0000
`; // real names and PINs live only in n8n, not in this repo

// WAREHOUSES: ManagerPlus key | name | site
const WAREHOUSES = `
13 | Milton Ops controlled II | Milton
14 | Milton Ops W/H II | Milton
1  | Z Milton Ops Warehouse | Milton
16 | REBUILD | Milton
18 | Logistics W/H II | Milton
53 | specialty tools | Milton
7  | Service W/H 2 (Eslam) | Milton
11 | Service W/H 6 (Mike) | Milton
54 | Service W/H 5 (Mohamed) | Milton
47 | Service Van #15 | Milton
58 | Milton customer van | Milton
17 | Sylvamo Paper | Sylvamo
23 | Pembroke Operations W/H | Pembroke
55 | Pembroke customers van | Pembroke
49 | Springville maint w/h | Springville
56 | Springville customer van | Springville
59 | Foley | Other
60 | Amazon Fresno | Other
`;
// ===========================================================

const clean = (x) => String(x || '').replace(/^[\s'",]+|[\s'",]+$/g, '');
const problems = [];
const people = [];
PEOPLE.split('\n').forEach((line) => {
  const raw = line.trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return;
  const [name = '', pin = '', flag = ''] = raw.split('|').map(clean);
  if (!name) return;
  if (pin && !/^\d{4,6}$/.test(pin)) problems.push(`${name}'s PIN must be 4 to 6 digits`);
  people.push({ name, pin: /^\d{4,6}$/.test(pin) ? pin : '', manager: /manager|admin/i.test(flag) });
});
const warehouses = WAREHOUSES.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [key, name, site] = l.split('|').map(clean);
  return { key: Number(key), name, site: site || 'Other' };
}).filter((w) => w.key > 0 && w.name);

const store = $getWorkflowStaticData('global');
const body = $input.first().json.body || {};
let data = body;
if (typeof body.payload === 'string') { try { data = JSON.parse(body.payload); } catch (e) { data = {}; } }
const fail = (error) => [{ json: { route: 0, reply: { ok: false, error } } }];

const routes = { names: 0, login: 0, load: 1, save: 2, sessions: 3, session: 4 };
const action = String(data.action || '');
if (!(action in routes)) return fail('Unknown request.');
if (action === 'names') return [{ json: { route: 0, reply: { ok: true, people: people.map((p) => p.name), problems } } }];

// PIN check with a lockout after 5 wrong tries in 15 minutes.
const who = people.find((p) => p.name.toLowerCase() === String(data.name || '').trim().toLowerCase());
store.fails = store.fails || {};
const now = Date.now();
const f = store.fails[(who && who.name) || 'unknown'] || { n: 0, at: 0 };
if (now - f.at > 15 * 60000) f.n = 0;
if (f.n >= 5) return fail('Too many wrong PINs. Wait 15 minutes or ask Mike.');
if (!who || !who.pin || String(data.pin || '') !== String(who.pin)) {
  if (who) store.fails[who.name] = { n: f.n + 1, at: now };
  return fail(who && !who.pin ? `${who.name} has no PIN set up yet. Ask Mike.` : 'Name or PIN is wrong.');
}
delete store.fails[who.name];

if (action === 'login') {
  return [{ json: { route: 0, reply: { ok: true, name: who.name, manager: who.manager, warehouses } } }];
}

const wh = warehouses.find((w) => w.key === Number(data.warehouseKey));
if ((action === 'load' || action === 'sessions') && !wh) return fail('Pick a warehouse.');
if (action === 'save') {
  const s = data.session || {};
  if (!s.id || !warehouses.some((w) => w.key === Number(s.warehouseKey))) return fail('Save is missing its session or warehouse.');
  if (!Array.isArray(data.lines)) data.lines = [];
  if (data.lines.length > 2000) return fail('Too many lines in one save.');
}
if (action === 'session' && !data.sessionId) return fail('Which session?');
return [{ json: { route: routes[action], action, user: who.name, manager: who.manager, warehouse: wh || null, data } }];
