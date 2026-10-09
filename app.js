/* Attendance Risk Predictor - application logic (data, accounts, attendance maths, views, server sync) */
/* Student Attendance Risk Predictor - Team Byte Builders (CSE326 CA1)
   Data is kept in localStorage so the site works on GitHub Pages with no server. */
const KEY = 'abp_data_v1';
// Backend: Firebase Realtime Database over its REST API. Empty URL means local-only mode.
const SERVER_URL = (document.querySelector('meta[name=server-url]') || {}).content || '';
const BASE = SERVER_URL.trim() ? SERVER_URL.trim().replace(/\/$/, '') + '/abp' : '';
// Each program is a list of semesters; each semester is a list of "CODE Subject name".
const DEFAULT_PROGRAMS = {
  'B.Tech CSE': [['CSE326 Web Technologies', 'MTH101 Engineering Maths', 'PHY110 Applied Physics', 'CHE110 Environmental Studies'], ['CSE202 Data Structures', 'MTH102 Discrete Maths', 'ECE120 Digital Electronics']],
  'B.Tech ECE': [['ECE101 Basic Electrical Engineering', 'ECE102 Engineering Mathematics I', 'ECE103 Applied Physics', 'ECE104 Programming in C'], ['ECE201 Electronic Devices', 'ECE202 Network Analysis', 'ECE203 Digital Logic Design', 'ECE204 Engineering Mathematics II']],
  'B.Tech ME': [['MEC101 Engineering Mechanics', 'MEC102 Engineering Graphics', 'MEC103 Engineering Mathematics I', 'MEC104 Applied Physics'], ['MEC201 Thermodynamics', 'MEC202 Manufacturing Processes', 'MEC203 Strength of Materials', 'MEC204 Engineering Mathematics II']],
  'B.Tech Civil': [['CIV101 Surveying', 'CIV102 Engineering Mechanics', 'CIV103 Building Materials', 'CIV104 Engineering Mathematics I'], ['CIV201 Structural Analysis', 'CIV202 Fluid Mechanics', 'CIV203 Concrete Technology', 'CIV204 Geology']],
  'B.Tech AI and ML': [['AIM101 Python Programming', 'AIM102 Linear Algebra', 'AIM103 Introduction to AI', 'AIM104 Applied Physics'], ['AIM201 Data Structures', 'AIM202 Probability and Statistics', 'AIM203 Machine Learning Basics', 'AIM204 Database Systems']],
  'BCA': [['BCA101 Computer Fundamentals', 'BCA102 Programming in C', 'BCA103 Mathematics I', 'BCA104 Business Communication'], ['BCA201 Data Structures', 'BCA202 Database Management', 'BCA203 Web Designing', 'BCA204 Mathematics II']],
  'MCA': [['MCA101 Advanced Java', 'MCA102 Operating Systems', 'MCA103 Discrete Structures', 'MCA104 Software Engineering'], ['MCA201 Cloud Computing', 'MCA202 Data Mining', 'MCA203 Computer Networks', 'MCA204 Python for Data Science']],
  'BBA': [['BBA101 Principles of Management', 'BBA102 Business Economics', 'BBA103 Financial Accounting', 'BBA104 Business Communication'], ['BBA201 Marketing Management', 'BBA202 Organisational Behaviour', 'BBA203 Business Statistics', 'BBA204 Cost Accounting']],
  'MBA': [['MBA101 Managerial Economics', 'MBA102 Financial Management', 'MBA103 Marketing Management', 'MBA104 Business Analytics'], ['MBA201 Operations Management', 'MBA202 Human Resource Management', 'MBA203 Corporate Strategy', 'MBA204 Business Law']],
  'B.Sc': [['BSC101 Physics I', 'BSC102 Chemistry I', 'BSC103 Mathematics I', 'BSC104 English Communication'], ['BSC201 Physics II', 'BSC202 Chemistry II', 'BSC203 Mathematics II', 'BSC204 Environmental Science']],
  'B.Com': [['COM101 Financial Accounting', 'COM102 Business Law', 'COM103 Micro Economics', 'COM104 Business Mathematics'], ['COM201 Corporate Accounting', 'COM202 Income Tax', 'COM203 Macro Economics', 'COM204 Cost Accounting']]
};
let COURSES = [];
function flat(progs) {
  const out = [];
  Object.keys(progs).forEach(p => progs[p].forEach((subs, i) => subs.forEach(x => {
    const k = x.indexOf(' '); out.push({ code: x.slice(0, k), name: x.slice(k + 1), sem: i + 1, prog: p });
  })));
  return out;
}
const isAdmin = () => !!user && user.role === 'admin';
const fac = id => db.faculty.find(x => x.id === String(id).toLowerCase());
const myCourses = () => user && user.role === 'faculty' ? COURSES.filter(c => ((fac(user.id) || {}).courses || []).includes(c.code)) : COURSES;
const stat = x => x.l === 'ML' ? 'Medical leave' : x.l === 'DL' ? 'Duty leave' : x.p ? 'Present' : 'Absent';
const alertMsg = s => `Dear ${s.name}, your attendance is ${s.pct.toFixed(1)}%, below the required ${db.thr}%. Please attend your next ${need(s)} classes in a row to get back on track.`;
const inCourse = (c, st) => !!c && c.prog === st.prog && c.sem === st.sem;
const subjFor = st => COURSES.filter(c => inCourse(c, st));
const LABEL = { safe: 'Safe', watch: 'Watch', high: 'High risk' };
const $ = s => document.querySelector(s);
const dlg = $('#dlg');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// simple salted hash so passwords are not stored as plain text (demo level, not real security)
function hp(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57; const t = 'abp|' + s;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
let db = load();
COURSES = flat(db.programs);

/* ---------- server sync ---------- */
const net = { ready: false, busy: false, ver: 0 };
const dirty = new Set();
let coreDirty = false, fullRecs = false, syncTimer = null;
// explain why the server cannot be reached, so the problem is easy to find
const why = (e, tail) => {
  const m = String(e && e.message);
  return 'Offline: ' + (/HTTP 40[13]/.test(m) ? 'Firebase rules block access, publish the rules again' : /HTTP 404/.test(m) ? 'database link not found, check the link' : 'cannot reach the server (check internet, and open the site from its GitHub Pages link)') + '. ' + tail;
};
const syncNote = t => { const e = $('#saveSync'); if (e) e.textContent = ' ' + t; };
const rkey = r => r.reg + '_' + r.course + '_' + r.date;
// status is shown to the admin only; the sign-in page shows it only when the server cannot be reached
const setNet = t => ['#netst', '#netst2'].forEach(i => {
  const e = $(i); if (!e) return;
  e.textContent = t; e.hidden = i === '#netst2' ? !/^Offline/.test(t) : !(user && user.role === 'admin');
});
async function rq(method, path, body) {
  const r = await fetch(BASE + path + '.json', { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function recMap() {
  const m = {}; db.records.forEach(r => { m[rkey(r)] = { p: r.p ? 1 : 0, l: r.l || '' }; }); return m;
}
async function push() {
  if (!BASE || !net.ready) return;
  net.busy = true; setNet('Saving to server...');
  try {
    if (fullRecs) { fullRecs = false; dirty.clear(); await rq('PUT', '/records', recMap()); }
    else if (dirty.size) { const all = recMap(), m = {}; dirty.forEach(k => { if (all[k]) m[k] = all[k]; }); dirty.clear(); await rq('PATCH', '/records', m); }
    if (coreDirty) { coreDirty = false; const core = { ...db }; delete core.records; await rq('PUT', '/core', JSON.stringify(core)); }
    net.ver = Date.now(); await rq('PUT', '/ver', net.ver); setNet('Synced with server'); syncNote('Synced to the server.');
  } catch (e) { coreDirty = true; fullRecs = true; setNet(why(e, 'Changes are kept on this device.')); syncNote('Saved on this device. The server could not be reached, so it will try again automatically.'); }
  net.busy = false;
}
async function pull(force) {
  if (!BASE || net.busy || coreDirty || dirty.size || fullRecs) return;
  try {
    const v = await rq('GET', '/ver');
    if (v === null) return;
    if (!force && net.ready && v === net.ver) { setNet('Synced with server'); return; }
    const [c, r] = await Promise.all([rq('GET', '/core'), rq('GET', '/records')]);
    if (!c) return;
    const d = JSON.parse(c), rs = r || {}; d.pending = d.pending || []; d.faculty = d.faculty || [];
    d.records = Object.keys(rs).map(k => { const [reg, course, date] = k.split('_'); return { reg, course, date, p: !!rs[k].p, l: rs[k].l || '' }; });
    db = d; COURSES = flat(db.programs); net.ver = v; net.ready = true;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { }
    setNet('Synced with server'); if (!user) authView(authCur); softRender();
  } catch (e) { setNet(why(e, 'Using the data saved on this device.')); }
}
// refresh the screen after new data arrives, but never while someone is typing or a popup is open
function softRender() {
  if (!user) return;
  if (!db.admin || (user.role === 'student' && !db.students.some(x => x.reg === user.reg)) || (user.role === 'faculty' && !fac(user.id))) { logout(); return; }
  const a = document.activeElement;
  if (dlg.open || (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) || ['entry', 'settings', 'acct', 'faculty'].includes(tab)) return;
  render();
}
async function boot() {
  if (!BASE) { setNet('Local mode: data stays on this device only.'); return; }
  setNet('Connecting to server...');
  try {
    const v = await rq('GET', '/ver');
    if (v === null) { net.ready = true; coreDirty = true; fullRecs = true; await push(); }   // first device fills the empty server
    else await pull(true);
  } catch (e) { setNet(why(e, 'Using the data saved on this device.')); }
  net.offline = !net.ready; authView(authCur);
  setInterval(() => { if (net.ready && (coreDirty || dirty.size || fullRecs)) push(); else pull(!net.ready); }, 6000);
}
let user = null;
let tab = 'dash';
let f = { q: '', prog: '', course: '', sem: '', risk: '' };
let sort = { k: 'pct', d: 1 };
try { document.documentElement.dataset.theme = localStorage.getItem('abp_theme') || 'light'; } catch (e) { }

/* ---------- storage ---------- */
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.students) {
      if (d.admin === undefined) { d.admin = { pw: hp('admin123') }; d.students.forEach(x => { if (x.pw === undefined) x.pw = hp('student123'); }); }
      if (d.admin) { if (!d.admin.name) d.admin.name = 'Administrator'; if (!d.admin.id) d.admin.id = 'admin'; }
      if (!d.faculty) d.faculty = []; if (!d.pending) d.pending = []; if (!d.total) d.total = 40;
      if (!d.programs) { d.programs = JSON.parse(JSON.stringify(DEFAULT_PROGRAMS)); d.students.forEach(x => { if (!x.prog) x.prog = 'B.Tech CSE'; }); }
      return d;
    } } catch (e) { }
  return blank();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { }
  if (BASE) { coreDirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(push, 400); }
}

function blank() {
  return { thr: 75, total: 40, programs: JSON.parse(JSON.stringify(DEFAULT_PROGRAMS)), students: [], records: [], notified: {}, faculty: [], pending: [], admin: null };
}
// sample students and attendance, for demos. Sample students have no password: they create their own account.
function addSample(d) {
  let seedN = 7; const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
  const names = ['Aarav Mehta', 'Diya Sharma', 'Kabir Singh', 'Ananya Rao', 'Rohan Verma', 'Ishita Nair', 'Vikram Joshi', 'Meera Iyer', 'Arjun Das', 'Sneha Kapoor', 'Karan Malhotra', 'Pooja Bansal'];
  const prop = [.95, .9, .82, .78, .7, .62, .55, .92, .85, .74, .66, .5];
  const pr = ['B.Tech CSE', 'B.Tech CSE', 'B.Tech CSE', 'B.Tech CSE', 'B.Tech CSE', 'B.Tech ECE', 'BCA', 'BCA', 'B.Tech CSE', 'B.Tech ECE', 'BBA', 'MBA'];
  const cs = flat(d.programs), dates = [], day = new Date('2026-09-01');
  while (dates.length < 18) { if (day.getDay() % 6) dates.push(day.toISOString().slice(0, 10)); day.setDate(day.getDate() + 1); }
  names.forEach((n, i) => {
    const reg = '1261' + (5100 + i * 7); if (d.students.some(x => x.reg === reg) || !d.programs[pr[i]]) return;
    const st = { reg, name: n, prog: pr[i], sem: i < 7 ? 1 : 2, pw: '' }; d.students.push(st);
    cs.filter(c => inCourse(c, st)).forEach(c => dates.forEach(date => d.records.push({ reg, course: c.code, date, p: rnd() < prop[i], l: '' })));
  });
}

/* ---------- attendance maths ---------- */
function stats(reg, course) {
  const r = db.records.filter(x => x.reg === reg && (!course || x.course === course));
  const att = r.filter(x => x.p).length;
  return { held: r.length, att, pct: r.length ? att / r.length * 100 : 100 };
}
const level = p => p >= db.thr ? 'safe' : p >= db.thr - 10 ? 'watch' : 'high';
// classes the student must attend in a row to reach the threshold
function need(s) {
  const t = db.thr;
  return s.pct >= t ? 0 : Math.ceil((t * s.held - 100 * s.att) / (100 - t));
}
// recent form: last 9 records vs overall percentage
function trend(reg) {
  const r = db.records.filter(x => x.reg === reg).sort((a, b) => a.date.localeCompare(b.date)).slice(-9);
  return r.length < 9 ? 0 : r.filter(x => x.p).length / 9 * 100 - stats(reg).pct;
}
const arrow = d => d > 5 ? '<span style="color:var(--safe)">Improving</span>' : d < -5 ? '<span style="color:var(--high)">Declining</span>' : '<span class="small">Steady</span>';
// bunk calculator and semester forecast
function plan(t) {
  const left = Math.max(0, db.total - t.held), best = (t.att + left) / Math.max(db.total, t.held) * 100;
  return { left, best, can: t.pct >= db.thr ? Math.max(0, Math.floor(100 * t.att / db.thr - t.held)) : 0, ok: best >= db.thr };
}
function planText(t) {
  const p = plan(t);
  return (t.pct >= db.thr ? `Right now you can miss ${p.can} more class${p.can === 1 ? '' : 'es'} and stay at ${db.thr}% or more.` : `Below the limit: attend the next ${need(t)} classes in a row.`) +
    ` Classes left this semester: ${p.left}. ` + (p.ok ? `Best case at the end: ${p.best.toFixed(1)}%.` : `Even if every remaining class is attended, the best possible is ${p.best.toFixed(1)}%.`);
}
// one square per day: green all attended, amber some missed, red all missed
function heat(reg) {
  const by = {};
  db.records.filter(x => x.reg === reg).forEach(x => { (by[x.date] = by[x.date] || []).push(x.p); });
  const cells = Object.keys(by).sort().map(d => { const a = by[d], n = a.filter(Boolean).length;
    return `<i class="bg-${n === a.length ? 'safe' : n === 0 ? 'high' : 'watch'}" title="${d}: ${n} of ${a.length} classes attended"></i>`; }).join('');
  return `<div class="hm" role="img" aria-label="Day by day attendance">${cells}</div><p class="small">Each square is one day. Green: all classes attended. Amber: some missed. Red: all missed. Hover for details.</p>`;
}
const badge = p => `<span class="badge ${level(p)}">${LABEL[level(p)]}</span>`;
const cname = code => (COURSES.find(c => c.code === code) || {}).name || code;

function rows() {
  return db.students.filter(s => (user.role !== 'faculty' || myCourses().some(c => inCourse(c, s))) && (!f.sem || s.sem == f.sem) &&
    (!f.q || (s.name + s.reg).toLowerCase().includes(f.q.toLowerCase())) &&
    (!f.course || inCourse(COURSES.find(c => c.code === f.course), s)) &&
    (!f.prog || s.prog === f.prog))
    .map(s => ({ ...s, ...stats(s.reg, f.course) }))
    .filter(s => !f.risk || level(s.pct) === f.risk)
    .map(s => ({ ...s, tr: trend(s.reg) }))
    .sort((a, b) => sort.d * (typeof a[sort.k] === 'string' ? a[sort.k].localeCompare(b[sort.k]) : a[sort.k] - b[sort.k]));
}

/* ---------- login ---------- */
function doLogin() {
  const role = document.querySelector('[name=role]:checked').value;
  const id = $('#uid').value.trim(), pw = $('#pwd').value;
  const st = db.students.find(s => s.reg === id);
  if (role === 'admin' && db.admin && id.toLowerCase() === db.admin.id && hp(pw) === db.admin.pw) user = { role, name: db.admin.name };
  else if (role === 'student' && st && !st.pw) { $('#loginErr').textContent = 'No password yet for this registration number. Use Create password below.'; return; }
  else if (role === 'student' && st && hp(pw) === st.pw) user = { role, name: st.name, reg: st.reg };
  else if (role === 'faculty' && fac(id) && hp(pw) === fac(id).pw) user = { role, name: fac(id).name, id: fac(id).id };
  else if (role === 'faculty' && db.pending.some(x => x.id === id.toLowerCase())) { $('#loginErr').textContent = 'Your faculty account is waiting for admin approval.'; return; }
  else { $('#loginErr').textContent = 'ID or password is wrong. Check the role (Admin or Student) and try again.'; return; }
  $('#loginErr').textContent = ''; $('#uid').value = ''; $('#pwd').value = '';
  tab = { admin: 'dash', student: 'me', faculty: 'entry' }[role];
  $('#login').hidden = true; $('#app').hidden = false; render(); window.scrollTo(0, 0);
}
$('#loginBtn').addEventListener('click', doLogin);
['#sReg', '#sPw', '#sPw2'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doSignup(); }));

/* ---------- create / change / reset password ---------- */
let authCur = 'login';
function authView(v) {
  authCur = v;
  if (BASE && !net.ready && !net.offline) v = 'wait'; else if (!db.admin) v = 'setup';
  ['login', 'signup', 'setup', 'wait'].forEach(k => { $(k === 'login' ? '#loginForm' : k === 'wait' ? '#connecting' : '#' + k).hidden = k !== v; });
  const pr = Object.keys(db.programs);
  if (v === 'signup' && $('#sPrg').options.length !== pr.length) $('#sPrg').innerHTML = pr.map(p => `<option>${p}</option>`).join('');
  if (!$('#sSem').options.length) $('#sSem').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option>${n}</option>`).join('');
}
function showSignup(on) { $('#signErr').textContent = ''; $('#loginErr').textContent = ''; authView(on ? 'signup' : 'login'); }
function sRole() { const f = document.querySelector('[name=srole]:checked').value === 'faculty'; $('#sStu').hidden = f; $('#sFac').hidden = !f; }
// optional contact details used for attendance alerts: email and a 10 digit WhatsApp number
function readContact(eid, wid) {
  const email = $(eid).value.trim(), wa = $(wid).value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { err: 'Enter a valid email, or leave it empty.' };
  if (wa && !/^\d{10}$/.test(wa)) return { err: 'WhatsApp number must be 10 digits, or leave it empty.' };
  return { email, wa };
}
function doSetup() {
  const name = $('#suName').value.trim().replace(/\s+/g, ' '), id = $('#suId').value.trim().toLowerCase(), p1 = $('#suPw').value, p2 = $('#suPw2').value;
  const err = m => { $('#suErr').textContent = m; };
  if (name.length < 2) return err('Enter your name.');
  if (!/^[a-z0-9._-]{3,20}$/.test(id)) return err('Login ID: 3 to 20 letters, numbers, dot, dash or underscore, no spaces.');
  if (p1.length < 6) return err('Password must be at least 6 characters.');
  if (p1 !== p2) return err('The two passwords do not match.');
  db.admin = { name, id, pw: hp(p1) };
  if ($('#suSample').checked) { addSample(db); fullRecs = true; }
  save(); ['#suName', '#suId', '#suPw', '#suPw2'].forEach(i => { $(i).value = ''; });
  user = { role: 'admin', name }; tab = 'dash'; $('#login').hidden = true; $('#app').hidden = false; render(); window.scrollTo(0, 0);
}
function doSignup() {
  const role = document.querySelector('[name=srole]:checked').value, name = $('#sName').value.trim().replace(/\s+/g, ' ');
  const p1 = $('#sPw').value, p2 = $('#sPw2').value, err = m => { $('#signErr').textContent = m; };
  if (name.length < 2) return err('Enter your full name.');
  if (p1.length < 6) return err('Password must be at least 6 characters.');
  if (p1 !== p2) return err('The two passwords do not match.');
  let id, note;
  if (role === 'faculty') {
    id = $('#sFid').value.trim().toLowerCase();
    const codes = $('#sSub').value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), bad = codes.filter(c => !COURSES.some(x => x.code === c));
    if (!/^[a-z0-9._-]{3,20}$/.test(id)) return err('Login ID: 3 to 20 letters, numbers, dot, dash or underscore.');
    if ((db.admin && id === db.admin.id) || fac(id) || db.pending.some(x => x.id === id) || db.students.some(x => x.reg === id)) return err('That Login ID is already in use.');
    if (!codes.length || bad.length) return err(bad.length ? 'Unknown subject code: ' + bad.join(', ') : 'Enter at least one subject code.');
    db.pending.push({ id, name, pw: hp(p1), courses: codes }); note = 'Request sent. You can sign in after the admin approves it.';
  } else {
    id = $('#sReg').value.trim();
    if (!/^\d{8}$/.test(id)) return err('Registration number must be 8 digits.');
    const ct = readContact('#sEmail', '#sWa'); if (ct.err) return err(ct.err);
    const st = db.students.find(x => x.reg === id);
    if (st && st.pw) return err('This registration number already has an account. Sign in instead.');
    if (st) { st.pw = hp(p1); if (ct.email) st.email = ct.email; if (ct.wa) st.wa = ct.wa; } else db.students.push({ reg: id, name, prog: $('#sPrg').value, sem: +$('#sSem').value, pw: hp(p1), email: ct.email, wa: ct.wa });
    note = 'Account created. Sign in now.';
  }
  save(); ['#sName', '#sReg', '#sFid', '#sSub', '#sPw', '#sPw2', '#sEmail', '#sWa'].forEach(i => { $(i).value = ''; });
  showSignup(false); document.querySelector('[name=role][value=' + role + ']').checked = true; $('#uid').value = id; toast(note);
}
function acct() {
  return `${head('Account', 'Your sign-in details.')}${user.role === 'admin' ? `<div class="card acct" style="max-width:420px;display:grid;gap:.8rem;margin-bottom:1rem"><h3>Profile</h3>
    <label>Your name (shown in the sidebar)<input id="adName" maxlength="40" value="${esc(db.admin.name)}"></label>
    <label>Login ID (what you type on the sign-in page)<input id="adId" maxlength="20" autocapitalize="off" value="${esc(db.admin.id)}"></label>
    <p class="small">Login ID: 3 to 20 letters, numbers, dot, dash or underscore. Remember it, because you need it to sign in.</p>
    <p id="nmMsg" class="err" role="alert"></p><button class="btn" onclick="saveName()">Save profile</button></div>` : ''}<div class="card acct" style="max-width:420px;display:grid;gap:.8rem"><h3>Change password</h3>
    <label>Current password<input id="cpCur" type="password" autocomplete="current-password"></label>
    <label>New password (at least 6 characters)<input id="cpNew" type="password" autocomplete="new-password"></label>
    <label>Confirm new password<input id="cpNew2" type="password" autocomplete="new-password"></label>
    <p id="cpMsg" class="err" role="alert"></p><button class="btn" onclick="changePw()">Update password</button></div>`;
}
function saveName() {
  if (!isAdmin()) return;
  const n = $('#adName').value.trim().replace(/\s+/g, ' ');
  if (n.length < 2) { $('#nmMsg').textContent = 'Enter a name with at least 2 characters.'; return; }
  const id = $('#adId').value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(id)) { $('#nmMsg').textContent = 'Login ID must be 3 to 20 characters: letters, numbers, dot, dash or underscore, no spaces.'; return; }
  if (db.students.some(x => x.reg === id) || fac(id)) { $('#nmMsg').textContent = 'That Login ID matches a student registration number. Choose another.'; return; }
  db.admin.name = n; db.admin.id = id; user.name = n; save(); render(); toast('Profile updated. Sign in with ID: ' + id);
}
function changePw() {
  const cur = $('#cpCur').value, n1 = $('#cpNew').value, n2 = $('#cpNew2').value;
  const rec = user.role === 'admin' ? db.admin : user.role === 'faculty' ? fac(user.id) : db.students.find(x => x.reg === user.reg);
  const msg = m => { $('#cpMsg').textContent = m; };
  if (hp(cur) !== rec.pw) return msg('Current password is wrong.');
  if (n1.length < 6) return msg('New password must be at least 6 characters.');
  if (n1 !== n2) return msg('The new passwords do not match.');
  if (n1 === cur) return msg('Choose a password different from the current one.');
  rec.pw = hp(n1); save(); render(); toast('Password changed.');
}
function resetPw() {
  if (!isAdmin()) return;
  const st = db.students.find(x => x.reg === $('#rpSel').value); if (!st) return;
  st.pw = ''; save(); toast('Password cleared for ' + st.name + '. They can create a new one on the login page.');
}
['#uid', '#pwd'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));
function logout() { user = null; $('#app').hidden = true; $('#login').hidden = false; authView('login'); window.scrollTo(0, 0); }

/* ---------- shell ---------- */
const ICONS = {"dash": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"9\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"5\"/><rect x=\"14\" y=\"12\" width=\"7\" height=\"9\"/><rect x=\"3\" y=\"16\" width=\"7\" height=\"5\"/>", "students": "<path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M23 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/>", "programs": "<path d=\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20\"/><path d=\"M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z\"/>", "faculty": "<path d=\"M22 10L12 5 2 10l10 5 10-5z\"/><path d=\"M6 12v5c3 2 9 2 12 0v-5\"/>", "entry": "<path d=\"M9 11l3 3L22 4\"/><path d=\"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11\"/>", "alerts": "<path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9\"/><path d=\"M13.73 21a2 2 0 0 1-3.46 0\"/>", "settings": "<line x1=\"4\" y1=\"21\" x2=\"4\" y2=\"14\"/><line x1=\"4\" y1=\"10\" x2=\"4\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"12\"/><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"3\"/><line x1=\"20\" y1=\"21\" x2=\"20\" y2=\"16\"/><line x1=\"20\" y1=\"12\" x2=\"20\" y2=\"3\"/><line x1=\"1\" y1=\"14\" x2=\"7\" y2=\"14\"/><line x1=\"9\" y1=\"8\" x2=\"15\" y2=\"8\"/><line x1=\"17\" y1=\"16\" x2=\"23\" y2=\"16\"/>", "acct": "<path d=\"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>", "me": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M16 2v4M8 2v4M3 10h18\"/>"};
const ic = k => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>';
function head(t, sub) { return `<header class="ph"><h2>${t}</h2>${sub ? `<p class="small">${sub}</p>` : ''}</header>`; }
function ring(p) {
  const C = 2 * Math.PI * 52, d = Math.min(100, Math.max(0, p)) / 100 * C;
  return `<svg viewBox="0 0 120 120" width="128" role="img" aria-label="Overall attendance ${p.toFixed(0)} percent"><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="12"/><circle cx="60" cy="60" r="52" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-dasharray="${d} ${C}" transform="rotate(-90 60 60)"/><text x="60" y="69" text-anchor="middle" font-size="27" font-weight="800" fill="#fff">${p.toFixed(0)}%</text></svg>`;
}
function render() {
  const tabs = user.role === 'admin'
    ? [['dash', 'Dashboard'], ['students', 'Students'], ['programs', 'Programs'], ['faculty', 'Faculty' + (db.pending.length ? ' (' + db.pending.length + ')' : '')], ['entry', 'Add attendance'], ['alerts', 'Alerts'], ['settings', 'Settings'], ['acct', 'Account']]
    : user.role === 'faculty' ? [['students', 'Students'], ['entry', 'Add attendance'], ['acct', 'Account']] : [['me', 'My attendance'], ['acct', 'Account']];
  $('#nav').innerHTML = tabs.map(t => `<button class="${t[0] === tab ? 'on' : ''}" onclick="go('${t[0]}')">${ic(t[0])}${t[1]}</button>`).join('');
  $('#whoami').textContent = user.name + (user.reg ? ' (' + user.reg + ')' : '');
  $('#netst').hidden = user.role !== 'admin';
  $('#view').innerHTML = { dash, students, programs, faculty, entry, alerts, settings, me, acct }[tab]();
  if (tab === 'entry') fillCourses();
  if (tab === 'settings') editFill();
}
function go(t) { tab = t; render(); }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); }

/* ---------- admin views ---------- */
function dash() {
  const all = db.students.map(s => ({ ...s, ...stats(s.reg) }));
  const avg = all.reduce((a, s) => a + s.pct, 0) / (all.length || 1);
  const empty = all.length ? '' : '<div class="card" style="margin-bottom:1rem"><b>Your portal is ready.</b><p class="small" style="margin:.3rem 0 0">No students yet. Students can create their own accounts on the sign-in page, or you can add them in Settings. For a demo, use Settings and add sample students.</p></div>';
  const high = all.filter(s => level(s.pct) === 'high').length, watch = all.filter(s => level(s.pct) === 'watch').length;
  const bars = Object.keys(db.programs).map(p => {
    const r = all.filter(x => x.prog === p); if (!r.length) return '';
    const a = r.reduce((x, y) => x + y.pct, 0) / r.length;
    return `<div class="bar"><span>${esc(p)} (${r.length})</span><div class="track"><i class="bg-${level(a)}" style="width:${a}%"></i></div><b>${a.toFixed(0)}%</b></div>`;
  }).join('');
  const hero = !all.length ? '' : high ? `<div class="card hero s-high"><div><span class="lbl">Needs attention</span><h3>${high} student${high === 1 ? ' is' : 's are'} at high risk</h3><p>${watch} more on watch. Review them first and send a reminder.</p></div><button class="btn light" onclick="f.risk='high';go('students')">Review high risk students</button></div>`
    : `<div class="card hero s-safe"><div><span class="lbl">All clear</span><h3>No student is at high risk</h3><p>${watch} on watch.</p></div></div>`;
  return `${head('Dashboard', 'Attendance overview for every program')}${empty}${hero}<div class="stats">
    <div class="card stat kpi"><span class="lbl">Students</span><b>${all.length}</b></div>
    <div class="card stat kpi"><span class="lbl">Average attendance</span><b>${avg.toFixed(1)}%</b></div>
    <div class="card stat kpi k-high"><span class="lbl">High risk</span><b>${high}</b></div>
    <div class="card stat kpi k-watch"><span class="lbl">On watch</span><b>${watch}</b></div></div>
    <div class="grid2" style="margin-bottom:1rem"><div class="card"><h3>Daily attendance trend</h3>${lineChart()}</div><div class="card"><h3>Risk split</h3>${donut(all.length - high - watch, watch, high)}</div></div>
    <div class="card"><h3>Average attendance by program</h3><div class="bars">${bars}</div>
    <p class="small">Safe is ${db.thr}% or more. Watch is within 10 points below. High risk is lower than that.</p></div>`;
}

function lineChart() {
  const by = {};
  db.records.forEach(r => { (by[r.date] = by[r.date] || []).push(r.p ? 100 : 0); });
  const d = Object.keys(by).sort().slice(-20), W = 400, H = 130;
  if (d.length < 2) return '<p class="small">Add attendance on at least two dates to see a trend.</p>';
  const pts = d.map((k, i) => [i / (d.length - 1) * W, H - by[k].reduce((a, b) => a + b, 0) / by[k].length / 100 * H]);
  const ty = H - db.thr / 100 * H;
  return `<svg viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Daily average attendance">
    <line x1="0" x2="${W}" y1="${ty}" y2="${ty}" stroke="var(--high)" stroke-dasharray="5 4"/>
    <text x="4" y="${ty - 4}" font-size="10" fill="var(--high)">limit ${db.thr}%</text>
    <polyline fill="none" stroke="var(--accent)" stroke-width="3" points="${pts.map(p => p.join(',')).join(' ')}"/>
    <text x="0" y="${H + 14}" font-size="10" fill="var(--mute)">${d[0]}</text><text x="${W}" y="${H + 14}" font-size="10" text-anchor="end" fill="var(--mute)">${d[d.length - 1]}</text></svg>`;
}
function donut(a, b, c) {
  const C = 251.3, n = a + b + c || 1; let off = 0;
  const seg = [[a, 'var(--safe)', 'Safe'], [b, 'var(--watch)', 'Watch'], [c, 'var(--high)', 'High risk']].map(x => {
    const len = x[0] / n * C, o = off; off += len;
    return `<circle r="40" cx="60" cy="60" fill="none" stroke="${x[1]}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-o}" transform="rotate(-90 60 60)"/>`;
  }).join('');
  return `<div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 120 120" width="130" role="img" aria-label="Risk split">${seg}</svg>
    <ul style="list-style:none;padding:0;margin:0"><li><span class="badge safe">Safe</span> ${a}</li><li style="margin:.3rem 0"><span class="badge watch">Watch</span> ${b}</li><li><span class="badge high">High risk</span> ${c}</li></ul></div>`;
}

function students() {
  const opt = (v, t, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${t}</option>`;
  const r = rows();
  const body = r.length ? r.map(s => `<tr><td>${esc(s.name)}</td><td>${s.reg}</td><td>${esc(s.prog)} · Sem ${s.sem}</td><td>${s.att}/${s.held}</td>
    <td><b>${s.pct.toFixed(1)}%</b><div class="pbar"><i class="bg-${level(s.pct)}" style="width:${s.pct}%"></i></div></td><td>${arrow(s.tr)}</td><td>${badge(s.pct)}</td><td>${need(s) ? need(s) + ' classes' : '-'}</td>
    <td><button class="link" onclick="showHistory('${s.reg}')">History</button></td></tr>`).join('')
    : '<tr><td colspan="9">No students match these filters. Clear a filter to see more.</td></tr>';
  return `${head('Students', 'Search, sort and filter. Open a student to see history and a what-if forecast.')}<div class="filters">
    <input placeholder="Search name or reg. no." value="${esc(f.q)}" oninput="f.q=this.value;keep(this)" aria-label="Search">
    <select onchange="f.prog=this.value;f.course='';render()" aria-label="Program">${opt('', 'All programs', f.prog)}${Object.keys(db.programs).map(p => opt(p, p, f.prog)).join('')}</select>
    <select onchange="f.course=this.value;render()" aria-label="Subject">${opt('', 'All courses', f.course)}${COURSES.filter(c => !f.prog || c.prog === f.prog).map(c => opt(c.code, c.code + ' ' + c.name, f.course)).join('')}</select>
    <select onchange="f.sem=this.value;render()" aria-label="Semester">${opt('', 'All semesters', f.sem)}${[...new Set(COURSES.map(c => c.sem))].sort((a, b) => a - b).map(n => opt(n, 'Semester ' + n, f.sem)).join('')}</select>
    <select onchange="f.risk=this.value;render()" aria-label="Risk">${opt('', 'All risk levels', f.risk)}${opt('high', 'High risk', f.risk)}${opt('watch', 'Watch', f.risk)}${opt('safe', 'Safe', f.risk)}</select>
    <button class="btn" onclick="exportCSV()">Export CSV</button><button class="btn ghost" onclick="window.print()">Print report</button></div>
    <div class="tw"><table><thead><tr>${[['name','Name'],['reg','Reg. no.'],['prog','Program'],['att','Attended'],['pct','%'],['tr','Trend']].map(h => `<th><button class="link" onclick="sortBy('${h[0]}')">${h[1]}${sort.k === h[0] ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}<th>Risk</th><th>To reach ${db.thr}%</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}
// re-render the table while typing but keep the cursor in the search box
function sortBy(k) { sort = { k, d: sort.k === k ? -sort.d : 1 }; render(); }
function keep(el) { const p = el.selectionStart; render(); const n = $('.filters input'); n.focus(); n.setSelectionRange(p, p); }

function showHistory(reg) {
  const s = db.students.find(x => x.reg === reg);
  const courses = subjFor(s);
  const per = courses.map(c => { const t = stats(reg, c.code); return `<li>${c.code}: ${t.att}/${t.held} (${t.pct.toFixed(1)}%) ${badge(t.pct)}<br><span class="small">${planText(t)}</span></li>`; }).join('');
  const log = db.records.filter(x => x.reg === reg).sort((a, b) => b.date.localeCompare(a.date))
    .map(x => `<tr><td>${x.date}</td><td>${x.course}</td><td>${stat(x)}</td></tr>`).join('');
  $('#dlgBody').innerHTML = `<h3>${esc(s.name)} (${s.reg})</h3><p class="small">${esc(s.prog)}, Semester ${s.sem}</p><ul>${per}</ul>
    ${heat(reg)}<div class="card" style="margin:.8rem 0"><label>What if they miss the next <b id="wn">0</b> classes?
    <input type="range" min="0" max="20" value="0" style="width:100%" oninput="whatIf('${reg}', this.value)"></label><p id="wr" style="margin:.4rem 0 0"></p></div>
    <div class="hist"><table style="min-width:0"><thead><tr><th>Date</th><th>Course</th><th>Status</th></tr></thead><tbody>${log}</tbody></table></div>`;
  dlg.showModal(); whatIf(reg, 0);
}

function whatIf(reg, n) {
  const t = stats(reg), p = t.att / (t.held + +n) * 100;
  $('#wn').textContent = n;
  $('#wr').innerHTML = `Overall would become <b>${p.toFixed(1)}%</b> ${badge(p)}`;
}

function programs() {
  const list = Object.keys(db.programs).map(p => {
    const sems = db.programs[p], n = db.students.filter(x => x.prog === p).length;
    return `<details class="card" style="margin-bottom:.6rem"><summary><b>${esc(p)}</b> <span class="small">${sems.reduce((a, x) => a + x.length, 0)} subjects, ${n} students</span></summary>
      ${sems.map((subs, i) => `<h4 style="margin:.8rem 0 .2rem">Semester ${i + 1}</h4>` + (subs.length ? '<ul>' + subs.map((x, j) => `<li>${esc(x)} <button class="link" onclick="delSubject('${esc(p)}',${i},${j})">remove</button></li>`).join('') + '</ul>' : '<p class="small">No subjects yet.</p>')).join('')}</details>`;
  }).join('');
  const po = Object.keys(db.programs).map(p => `<option>${p}</option>`).join('');
  return `${head('Programs and subjects', 'Every program with its semester-wise subjects.')}${list}<div class="grid2" style="margin-top:1rem">
    <div class="card acct" style="display:grid;gap:.8rem"><h3>Add a program</h3><label>Program name<input id="apName" maxlength="40" placeholder="e.g. B.Tech Data Science"></label>
    <button class="btn" onclick="addProgram()">Add program</button></div>
    <div class="card acct" style="display:grid;gap:.8rem"><h3>Add a subject</h3><label>Program<select id="asPrg">${po}</select></label>
    <label>Semester<select id="asSem">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option>${n}</option>`).join('')}</select></label>
    <label>Subject code<input id="asCode" maxlength="10" placeholder="e.g. CSE401"></label><label>Subject name<input id="asName" maxlength="40"></label>
    <p id="apMsg" class="err" role="alert"></p><button class="btn" onclick="addSubject()">Add subject</button></div></div>`;
}
function addProgram() {
  if (!isAdmin()) return;
  const n = $('#apName').value.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 .()+-]{2,40}$/.test(n)) return toast('Program name: 2 to 40 letters, numbers, spaces, dot, dash or brackets.');
  if (Object.keys(db.programs).some(p => p.toLowerCase() === n.toLowerCase())) return toast('That program already exists.');
  db.programs[n] = [[], []]; save(); COURSES = flat(db.programs); render(); toast(n + ' added.');
}
function addSubject() {
  if (!isAdmin()) return;
  const p = $('#asPrg').value, sem = +$('#asSem').value, code = $('#asCode').value.trim().toUpperCase(), name = $('#asName').value.trim().replace(/\s+/g, ' ');
  const msg = m => { $('#apMsg').textContent = m; };
  if (!/^[A-Z0-9]{3,10}$/.test(code)) return msg('Subject code: 3 to 10 letters or numbers.');
  if (!/^[A-Za-z0-9 .()+,-]{2,40}$/.test(name)) return msg('Subject name: 2 to 40 letters, numbers or spaces.');
  if (COURSES.some(c => c.code === code)) return msg('That subject code is already used.');
  while (db.programs[p].length < sem) db.programs[p].push([]);
  db.programs[p][sem - 1].push(code + ' ' + name); save(); COURSES = flat(db.programs); render(); toast(code + ' added to ' + p + ', semester ' + sem + '.');
}

function entry() {
  const today = new Date().toISOString().slice(0, 10);
  return `${head('Add attendance', 'Mark one class at a time, or import many rows from a CSV file.')}<div class="stack"><div class="card">
    <h3>Mark a class</h3><div class="filters">
    <select id="ePrg" onchange="fillCourses()" aria-label="Program">${[...new Set(myCourses().map(c => c.prog))].map(p => `<option>${p}</option>`).join('')}</select>
    <select id="eCourse" onchange="fillList()" aria-label="Subject"></select>
    <input type="date" id="eDate" value="${today}" aria-label="Date"></div>
    <div id="eList" class="chk"></div><p class="small">Medical and duty leave count as present.</p><button class="btn" onclick="saveEntry()">Save attendance</button>
    <div id="saveMsg" class="okbox" role="status" hidden></div></div>
    <div class="card"><h3>Import from CSV</h3>
    <p class="small">One row per student per class: <code>reg,course,date,status</code>. Example: <code>12615128,CSE326,2026-10-05,P</code>. Status is P, A, ML or DL.</p>
    <input type="file" accept=".csv" onchange="importCSV(this.files[0])" aria-label="CSV file"></div></div>`;
}
function fillCourses() {
  const p = $('#ePrg').value;
  $('#eCourse').innerHTML = myCourses().filter(c => c.prog === p).map(c => `<option value="${c.code}">Sem ${c.sem} · ${c.code} ${esc(c.name)}</option>`).join('');
  fillList();
}
function fillList() {
  const c = COURSES.find(x => x.code === $('#eCourse').value);
  $('#eList').innerHTML = !c ? '<p class="small">This program has no subjects yet. Add one in the Programs tab.</p>' : db.students.filter(s => inCourse(c, s))
    .map(s => `<label>${esc(s.name)} <select data-reg="${s.reg}"><option value="P">Present</option><option value="A">Absent</option><option value="ML">Medical leave</option><option value="DL">Duty leave</option></select></label>`).join('');
  if (c && !$('#eList').children.length) $('#eList').innerHTML = '<p class="small">No students in this program and semester yet.</p>';
}
function setRecord(reg, course, date, p, l) {
  db.records = db.records.filter(x => !(x.reg === reg && x.course === course && x.date === date));
  db.records.push({ reg, course, date, p, l: l || '' }); dirty.add(rkey({ reg, course, date }));
}
function saveEntry() {
  const course = $('#eCourse').value, date = $('#eDate').value;
  if (!course || !date) { toast('Choose a subject and a date first.'); return; }
  [...document.querySelectorAll('#eList select')].forEach(i => setRecord(i.dataset.reg, course, date, i.value !== 'A', /^(ML|DL)$/.test(i.value) ? i.value : ''));
  const sel = [...document.querySelectorAll('#eList select')];
  if (!sel.length) { toast('There are no students to mark for this subject.'); return; }
  const ab = sel.filter(i => i.value === 'A').length, lv = sel.filter(i => /^(ML|DL)$/.test(i.value)).length;
  save();
  const m = $('#saveMsg'); m.hidden = false;
  m.innerHTML = `<b>&#10003; Attendance saved successfully</b>${course} on ${date}: ${sel.length} students, ${sel.length - ab - lv} present, ${ab} absent, ${lv} on leave.<span id="saveSync" class="small"> ${BASE ? 'Syncing to the server...' : 'Saved on this device.'}</span>`;
  m.scrollIntoView({ block: 'nearest' });
}
function importCSV(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    let ok = 0, bad = 0;
    rd.result.split(/\r?\n/).forEach(line => {
      const [reg, course, date, st] = line.split(',').map(x => x && x.trim());
      const valid = db.students.some(s => s.reg === reg) && myCourses().some(c => c.code === course) &&
        /^\d{4}-\d{2}-\d{2}$/.test(date || '') && /^(p|a|present|absent|1|0|ml|dl)$/i.test(st || '');
      if (valid) { setRecord(reg, course, date, !/^(a|absent|0)$/i.test(st), /^(ml|dl)$/i.test(st) ? st.toUpperCase() : ''); ok++; }
      else if (line.trim() && !/^reg/i.test(line)) bad++;
    });
    save(); toast(ok + ' rows imported, ' + bad + ' skipped.');
  };
  rd.readAsText(file);
}

function alerts() {
  const list = db.students.map(s => ({ ...s, ...stats(s.reg) })).filter(s => level(s.pct) !== 'safe').sort((a, b) => a.pct - b.pct);
  const html = list.map(s => `<div class="card alert ${level(s.pct) === 'watch' ? 'watch' : ''} ${db.notified[s.reg] ? 'done' : ''}">
    <div><b>${esc(s.name)}</b> (${s.reg}) is at ${s.pct.toFixed(1)}% ${badge(s.pct)}<br>
    <span class="small">Needs ${need(s)} more classes in a row to reach ${db.thr}%.</span><br><span class="small">WhatsApp: ${s.wa ? s.wa : 'not saved'} &nbsp;|&nbsp; Email: ${s.email ? esc(s.email) : 'not saved'}</span></div>
    <button class="link" onclick="copyMsg('${s.reg}')">Copy message</button><a class="link" target="_blank" rel="noopener" href="https://wa.me/${s.wa ? '91' + s.wa : ''}?text=${encodeURIComponent(alertMsg(s))}">WhatsApp</a><a class="link" href="mailto:${s.email ? esc(s.email) : ''}?subject=${encodeURIComponent('Attendance alert')}&body=${encodeURIComponent(alertMsg(s))}">Email</a><button class="btn ${db.notified[s.reg] ? 'ghost' : ''}" onclick="notify('${s.reg}')">${db.notified[s.reg] ? 'Notified' : 'Mark as notified'}</button></div>`).join('');
  return `${head('Alerts', 'Students below the limit, with a ready message to send.')}${html || '<p>No students are below the limit right now.</p>'}`;
}
function copyMsg(reg) {
  const s = { ...db.students.find(x => x.reg === reg), ...stats(reg) };
  const m = `Dear ${s.name}, your attendance is ${s.pct.toFixed(1)}%, below the required ${db.thr}%. Please attend your next ${need(s)} classes in a row to get back on track.`;
  (navigator.clipboard ? navigator.clipboard.writeText(m) : Promise.reject()).then(() => toast('Message copied.'), () => toast('Copy is blocked in this browser.'));
}
function notify(reg) { db.notified[reg] = !db.notified[reg]; save(); render(); }

function settings() {
  return `${head('Settings', 'People, attendance limit, backup and server.')}<div class="card stack"><h3>Attendance limit</h3><label>Minimum attendance (%)<br>
    <input type="number" min="50" max="95" value="${db.thr}" onchange="setThr(this.value)"></label>
    </div><div class="card stack"><h3>Add a student</h3><div class="filters"><input id="nName" placeholder="Full name" aria-label="Name"><input id="nReg" placeholder="Reg. no." aria-label="Reg no"><input id="nEmail" placeholder="Email (optional)" aria-label="Email"><input id="nWa" placeholder="WhatsApp, 10 digits (optional)" aria-label="WhatsApp number">
    <select id="nPrg" aria-label="Program">${Object.keys(db.programs).map(p => `<option>${p}</option>`).join('')}</select><select id="nSem" aria-label="Semester">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option>${n}</option>`).join('')}</select><button class="btn" onclick="addStudent()">Add student</button></div>
    </div><div class="card stack"><h3>Clear a student's password</h3><div class="filters"><select id="rpSel" aria-label="Student">${db.students.map(s => `<option value="${s.reg}">${esc(s.name)} (${s.reg})</option>`).join('')}</select>
    <button class="btn ghost" onclick="resetPw()">Clear password</button></div>
    </div><div class="card stack"><h3>Server</h3><p class="small">${BASE ? 'Connected to your Firebase database, so every phone using this site shares the same data. Status: ' + esc($('#netst').textContent) : 'No server is set up, so data stays in this browser only. To share data between phones, paste your Firebase Realtime Database URL into the server-url line at the top of index.html.'}</p>
    ${BASE ? '<button class="btn ghost" onclick="serverSeed()">Upload this device data to the server</button>' : ''}
    </div><div class="card stack"><h3>Semester length</h3><label>Planned classes per subject this semester<br><input type="number" min="10" max="120" value="${db.total}" onchange="setTotal(this.value)"></label>
    </div><div class="card stack"><h3>Import students from CSV</h3><p class="small">Columns: name,reg,program,semester,email,whatsapp (the last two are optional). Example: Asha Roy,12615999,BCA,1,asha@example.com,9876543210. Registration numbers have 8 digits.</p>
    <input type="file" accept=".csv" onchange="importStudents(this.files[0])" aria-label="Students CSV">
    <button class="btn ghost" onclick="loadSample()">Add sample students and attendance</button>
    </div><div class="card stack"><h3>Edit a student</h3><div class="filters"><select id="esSel" onchange="editFill()" aria-label="Student">${db.students.map(s => `<option value="${s.reg}">${esc(s.name)} (${s.reg})</option>`).join('')}</select>
    <input id="esName" maxlength="40" aria-label="Name"><input id="esEmail" placeholder="Email" aria-label="Email"><input id="esWa" placeholder="WhatsApp, 10 digits" aria-label="WhatsApp number"><select id="esPrg" aria-label="Program">${Object.keys(db.programs).map(p => `<option>${p}</option>`).join('')}</select>
    <select id="esSem" aria-label="Semester">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option>${n}</option>`).join('')}</select></div>
    <label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" id="esClr" checked> Clear old attendance if the program or semester changes</label>
    <button class="btn" onclick="saveStudent()">Save student</button>
    </div><div class="card stack"><h3>Remove a student</h3><div class="filters"><select id="dsSel" aria-label="Student">${db.students.map(s => `<option value="${s.reg}">${esc(s.name)} (${s.reg})</option>`).join('')}</select><button class="btn danger" onclick="delStudent()">Remove student</button></div>
    </div><div class="card stack"><h3>Backup and restore</h3><div class="filters"><button class="btn" onclick="backup(false)">Download backup</button><button class="btn ghost" onclick="backup(true)">Copy backup text</button></div>
    <input type="file" accept=".json" onchange="restoreFile(this.files[0])" aria-label="Backup file">
    <textarea id="bkTxt" rows="3" placeholder="Or paste backup text here" style="width:100%"></textarea><button class="btn ghost" onclick="restoreText($('#bkTxt').value)">Restore from pasted text</button>
    </div><div class="card stack danger-zone"><h3>Danger zone</h3><p class="small">Reset deletes all students, faculty, attendance and accounts, for every phone. It cannot be undone.</p><button class="btn danger" onclick="resetAll()">Reset portal (delete everything)</button></div>`;
}
function addStudent() {
  if (!isAdmin()) return;
  const name = $('#nName').value.trim(), reg = $('#nReg').value.trim();
  if (!name || !/^\d{8}$/.test(reg)) { toast('Enter a name and an 8-digit registration number.'); return; }
  if (db.students.some(x => x.reg === reg)) { toast('That registration number already exists.'); return; }
  const ct = readContact('#nEmail', '#nWa'); if (ct.err) { toast(ct.err); return; }
  db.students.push({ reg, name, prog: $('#nPrg').value, sem: +$('#nSem').value, pw: '', email: ct.email, wa: ct.wa }); save(); toast(name + ' added.'); render();
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('abp_theme', t); } catch (e) { }
}
function editFill() {
  const st = db.students.find(x => x.reg === $('#esSel').value); if (!st) return;
  $('#esName').value = st.name; $('#esPrg').value = st.prog; $('#esSem').value = st.sem; $('#esEmail').value = st.email || ''; $('#esWa').value = st.wa || '';
}
function saveStudent() {
  if (!isAdmin()) return;
  const st = db.students.find(x => x.reg === $('#esSel').value); if (!st) return;
  const name = $('#esName').value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return toast('Enter a name with at least 2 characters.');
  const prog = $('#esPrg').value, sem = +$('#esSem').value, moved = prog !== st.prog || sem !== st.sem;
  if (moved && $('#esClr').checked) { fullRecs = true; db.records = db.records.filter(r => r.reg !== st.reg); }
  const ct = readContact('#esEmail', '#esWa'); if (ct.err) return toast(ct.err);
  Object.assign(st, { name, prog, sem, email: ct.email, wa: ct.wa }); save(); render(); toast(name + ' updated.');
}
function serverSeed() {
  if (!isAdmin()) return; if (!twice('seed')) return; net.ready = true; coreDirty = true; fullRecs = true; push(); }
function setTotal(v) {
  if (!isAdmin()) return; db.total = Math.min(120, Math.max(10, +v || 40)); save(); toast('Planned classes set to ' + db.total + '.'); }
let armKey = '';
function twice(k) {
  if (armKey !== k) { armKey = k; toast('Click again to confirm.'); setTimeout(() => { if (armKey === k) armKey = ''; }, 4000); return false; }
  armKey = ''; return true;
}
function delStudent() {
  if (!isAdmin()) return;
  const r = $('#dsSel').value; if (!r || !twice('ds' + r)) return;
  db.students = db.students.filter(x => x.reg !== r); fullRecs = true; db.records = db.records.filter(x => x.reg !== r); delete db.notified[r];
  save(); render(); toast('Student removed.');
}
function delSubject(p, i, j) {
  if (!isAdmin()) return;
  const x = db.programs[p][i][j]; if (!twice('dj' + x)) return;
  const code = x.split(' ')[0]; db.programs[p][i].splice(j, 1);
  fullRecs = true; db.records = db.records.filter(r => r.course !== code); db.faculty.forEach(f => { f.courses = f.courses.filter(c => c !== code); });
  save(); COURSES = flat(db.programs); render(); toast(code + ' removed.');
}
function importStudents(file) {
  if (!isAdmin()) return;
  if (!file) return; const rd = new FileReader();
  rd.onload = () => {
    let ok = 0, bad = 0;
    rd.result.split(/\r?\n/).forEach(line => {
      if (!line.trim() || /^name/i.test(line)) return;
      const [name, reg, p0, s0, em, wn] = line.split(',').map(x => x && x.trim());
      const prog = Object.keys(db.programs).find(p => p.toLowerCase() === (p0 || '').toLowerCase()), sem = +s0;
      if (name && /^\d{8}$/.test(reg || '') && prog && sem >= 1 && sem <= 8 && !db.students.some(x => x.reg === reg) && !fac(reg)) { db.students.push({ reg, name, prog, sem, pw: '', email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em || '') ? em : '', wa: /^\d{10}$/.test(wn || '') ? wn : '' }); ok++; } else bad++;
    });
    save(); render(); toast(ok + ' students added, ' + bad + ' skipped.');
  };
  rd.readAsText(file);
}
function backup(copy) {
  if (!isAdmin()) return;
  const t = JSON.stringify(db);
  if (copy) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Backup copied. Paste it somewhere safe.'), () => toast('Copy is blocked here. Use Download backup.')); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'application/json' })); a.download = 'attendance-backup.json'; a.click();
  URL.revokeObjectURL(a.href); toast('Backup downloaded.');
}
function restoreText(t) {
  if (!isAdmin()) return;
  try {
    const d = JSON.parse(t); if (!d.students || !d.programs || !d.admin || !d.admin.pw) throw 0;
    if (!d.faculty) d.faculty = []; if (!d.pending) d.pending = []; if (!d.total) d.total = 40; if (!d.admin.name) d.admin.name = 'Administrator'; if (!d.admin.id) d.admin.id = 'admin';
    fullRecs = true; db = d; COURSES = flat(db.programs); save(); user = { role: 'admin', name: db.admin.name }; render(); toast('Backup restored.');
  } catch (e) { toast('That is not a valid backup.'); }
}
function restoreFile(file) {
  if (!isAdmin()) return; if (!file) return; const rd = new FileReader(); rd.onload = () => restoreText(rd.result); rd.readAsText(file); }

function faculty() {
  const rows = db.faculty.map(x => `<tr><td>${esc(x.name)}</td><td>${x.id}</td><td>${x.courses.join(', ') || '-'}</td>
    <td><input id="fp_${x.id}" type="password" placeholder="new password" aria-label="New password for ${x.id}"> <button class="link" onclick="facPw('${x.id}')">Set password</button> <button class="link" onclick="facDel('${x.id}')">Remove</button></td></tr>`).join('');
  const pend = db.pending.length ? `<h3>Waiting for approval</h3>` + db.pending.map(x => `<div class="card alert watch"><div><b>${esc(x.name)}</b> (${x.id}) asks for ${x.courses.join(', ')}</div>
    <div><button class="btn" onclick="facOk('${x.id}')">Approve</button> <button class="btn danger" onclick="facNo('${x.id}')">Reject</button></div></div>`).join('') : '';
  return `${head('Faculty', 'Approve requests and manage faculty accounts.')}${pend}<div class="tw"><table><thead><tr><th>Name</th><th>Login ID</th><th>Subjects</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4">No faculty yet.</td></tr>'}</tbody></table></div>
    <div class="card acct" style="max-width:520px;display:grid;gap:.8rem;margin-top:1rem"><h3>Add faculty</h3>
    <label>Name<input id="fcName" maxlength="40"></label><label>Login ID<input id="fcId" maxlength="20" autocapitalize="off"></label>
    <label>Password (at least 6 characters)<input id="fcPw" type="password"></label>
    <label>Subject codes, separated by commas<input id="fcSub" placeholder="e.g. CSE326, MTH101"></label>
    <p id="fcMsg" class="err" role="alert"></p><button class="btn" onclick="addFaculty()">Add faculty</button></div>
    <p class="small">Faculty sign in with the Faculty option. They can only mark attendance and see students for their own subjects.</p>`;
}
function addFaculty() {
  if (!isAdmin()) return;
  const name = $('#fcName').value.trim().replace(/\s+/g, ' '), id = $('#fcId').value.trim().toLowerCase(), pw = $('#fcPw').value;
  const codes = $('#fcSub').value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), msg = m => { $('#fcMsg').textContent = m; };
  if (name.length < 2) return msg('Enter the faculty name.');
  if (!/^[a-z0-9._-]{3,20}$/.test(id)) return msg('Login ID: 3 to 20 letters, numbers, dot, dash or underscore.');
  if (id === db.admin.id || fac(id) || db.students.some(x => x.reg === id)) return msg('That Login ID is already in use.');
  if (pw.length < 6) return msg('Password must be at least 6 characters.');
  const bad = codes.filter(c => !COURSES.some(x => x.code === c));
  if (!codes.length || bad.length) return msg(bad.length ? 'Unknown subject code: ' + bad.join(', ') : 'Enter at least one subject code.');
  db.faculty.push({ id, name, pw: hp(pw), courses: codes }); save(); render(); toast(name + ' added.');
}
function facOk(id) {
  if (!isAdmin()) return; const x = db.pending.find(p => p.id === id); if (!x) return; db.faculty.push(x); db.pending = db.pending.filter(p => p.id !== id); save(); render(); toast(x.name + ' approved.'); }
function facNo(id) {
  if (!isAdmin()) return; if (!twice('fn' + id)) return; db.pending = db.pending.filter(p => p.id !== id); save(); render(); toast('Request rejected.'); }
function facPw(id) {
  if (!isAdmin()) return; const v = $('#fp_' + id).value; if (v.length < 6) return toast('Password must be at least 6 characters.'); fac(id).pw = hp(v); save(); render(); toast('Password updated for ' + id + '.'); }
function facDel(id) {
  if (!isAdmin()) return; if (!twice('fd' + id)) return; db.faculty = db.faculty.filter(x => x.id !== id); save(); render(); toast('Faculty removed.'); }
function setThr(v) {
  if (!isAdmin()) return; v = Math.min(95, Math.max(50, +v || 75)); db.thr = v; save(); toast('Limit set to ' + v + '%.'); render(); }
function loadSample() {
  if (!isAdmin()) return; addSample(db); fullRecs = true; save(); render(); toast('Sample students added. They create their own passwords from the sign-in page.'); }
function resetAll() {
  if (!isAdmin()) return;
  if (!twice('wipe')) return;
  fullRecs = true; db = blank(); COURSES = flat(db.programs); save(); logout(); toast('Portal reset. Create a new admin account.');
}

function exportCSV() {
  const lines = [['Name', 'RegNo', 'Sem', 'Course', 'Held', 'Attended', 'Percent', 'Risk', 'ClassesNeeded']];
  rows().forEach(s => lines.push([s.name, s.reg, s.sem, f.course || 'All', s.held, s.att, s.pct.toFixed(1), LABEL[level(s.pct)], need(s)]));
  const blob = new Blob([lines.map(l => l.map(v => '"' + v + '"').join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'attendance-report.csv'; a.click();
  URL.revokeObjectURL(a.href); toast('Report downloaded.');
}

/* ---------- student view ---------- */
function me() {
  const st = db.students.find(s => s.reg === user.reg), all = stats(st.reg), lv = level(all.pct);
  const cards = subjFor(st).map(c => {
    const t = stats(st.reg, c.code);
    return `<div class="card subj"><span class="lbl">${c.code}</span><h3>${esc(c.name)}</h3>
      <div class="top"><b style="font-size:1.9rem">${t.pct.toFixed(1)}%</b>${badge(t.pct)}</div><div class="pbar"><i class="bg-${level(t.pct)}" style="width:${t.pct}%"></i></div>
      <p class="small">${t.att} of ${t.held} classes attended. ${planText(t)}</p></div>`;
  }).join('');
  const log = db.records.filter(x => x.reg === st.reg).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
    .map(x => `<tr><td>${x.date}</td><td>${x.course}</td><td>${stat(x)}</td></tr>`).join('');
  const msg = all.pct >= db.thr ? `You are above the ${db.thr}% limit. Keep it up.` : `You are below the ${db.thr}% limit. Attend your next ${need(all)} classes in a row to get back on track.`;
  return `${head('Hello, ' + esc(st.name.split(' ')[0]), esc(st.prog) + ', Semester ' + st.sem)}
    <div class="card hero s-${lv}"><div class="row">${ring(all.pct)}<div><span class="lbl">Overall attendance</span><h3>${LABEL[lv]}</h3><p>${msg}</p></div></div></div>
    <div class="grid2">${cards}</div><h3 class="sec">Day by day</h3>${heat(st.reg)}<h3 class="sec">Recent classes</h3>
    <div class="tw"><table style="min-width:0"><thead><tr><th>Date</th><th>Course</th><th>Status</th></tr></thead><tbody>${log}</tbody></table></div>`;
}


authView('login');
boot();
