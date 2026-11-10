const BUILTIN_WH = {"name": "", "rows": []};
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const KEY = 'shelfcount.session.v2', WHKEY = 'shelfcount.wh.v2';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
function splitLoc(loc, fallback) {
  const seg = String(loc || '').split(/[\\/]/).map(x => x.trim()).filter(Boolean);
  if (!seg.length) return { rack: String(fallback || 'No bin').trim() || 'No bin', bin: '', noBin: true };
  return { rack: seg[0].toUpperCase(), bin: (seg[1] || '').toUpperCase(), noBin: false };
}
function prepRows(rows, fallback) { return rows.map(r => ({ ...r, ...splitLoc(r.loc, r.wh || fallback) })); }
const binLabel = b => b ? b : 'All items';
const binId = b => 'bin-' + (b || '_');
const hasShelves = () => S && S.parts.some(p => p.bin);

let WH = store.get(WHKEY) || { name: BUILTIN_WH.name, file: 'built-in sample', loadedAt: null, rows: prepRows(BUILTIN_WH.rows), pin: null, builtin: true };
let S = null, index = null, whIndex = null, whOthers = [];
let undoStack = [];
let dict = null, downloads = null, tts = null;
let pickedRack = null;
let managerOpen = false;

function racks() {
  const m = new Map(); for (const r of WH.rows) m.set(r.rack, (m.get(r.rack) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}
function save() { if (S) store.set(KEY, S); }
function setIndex() {
  index = Matcher.buildIndex(S.parts);
  whOthers = WH.rows.filter(r => r.rack !== S.rack);
  whIndex = null; // built lazily: only needed when a part isn't on this rack
}
function getWhIndex() { if (!whIndex) whIndex = Matcher.buildIndex(whOthers); return whIndex; }
function partByKey(k) { const [src, i] = k.split(':'); return src === 'r' ? S.parts[+i] : whOthers[+i]; }

/* ---------------- setup ---------------- */
function renderSetup() {
  $('top').hidden = true; $('composer').hidden = true; $('vCount').hidden = true; $('vReview').hidden = true; $('vSetup').hidden = false;
  const saved = store.get(KEY);
  if (!$('inName').value) $('inName').value = (saved && saved.counter) || store.get('shelfcount.name') || '';
  $('resumeBtn').hidden = !(saved && saved.parts);
  if (saved && saved.parts) $('resumeBtn').textContent = `Resume ${saved.rack} (${Object.keys(saved.counts).length} of ${saved.parts.length} lines)`;
  const rk = racks();
  $('startBtn').disabled = !rk.length;
  if (!rk.length) { $('whBox').innerHTML = '<b>No warehouse list loaded yet</b><span>Upload the ManagerPlus inventory export for the whole warehouse (Part ID, Description, Bin Location, On Hand, Current Cost). It stays on this phone.</span>'; $('upLbl').textContent = 'Upload whole-warehouse export (.xlsx)'; $('rackGrid').innerHTML = '<span class="empty-note">Racks appear here after the upload.</span>'; return; }
  $('whBox').innerHTML = `<b>${esc(WH.name)}</b><span>${WH.rows.length} lines on ${rk.length} racks · ${WH.builtin ? 'sample list: CI5 and CI8 only. Upload the full warehouse export to count other racks.' : `from ${esc(WH.file)}, loaded ${new Date(WH.loadedAt).toLocaleDateString()}`}</span>`;
  $('upLbl').textContent = WH.builtin ? 'Upload whole-warehouse export (.xlsx)' : 'Replace with a newer export';
  if (!pickedRack || !rk.some(([r]) => r === pickedRack)) pickedRack = rk.some(([r]) => r === 'CI8') ? 'CI8' : (rk[0] || [null])[0];
  const noBinRacks = new Set(WH.rows.filter(x => x.noBin).map(x => x.rack));
  $('rackGrid').innerHTML = rk.map(([r, n]) => `<button class="rackbtn ${r === pickedRack ? 'sel' : ''} ${r.length > 7 ? 'long' : ''}" data-r="${esc(r)}" aria-pressed="${r === pickedRack}"><b>${esc(r)}</b><span>${n} lines${noBinRacks.has(r) ? ' · no bins' : ''}</span></button>`).join('');
}
$('rackGrid').addEventListener('click', e => { const b = e.target.closest('.rackbtn'); if (!b) return; pickedRack = b.dataset.r; renderSetup(); });
$('startBtn').addEventListener('click', () => {
  const name = $('inName').value.trim();
  if (!name) { $('inName').focus(); $('inName').placeholder = 'Enter your name to start'; return; }
  if (!pickedRack) return;
  const saved = store.get(KEY);
  if (saved && saved.parts && Object.keys(saved.counts).length && !$('startBtn').dataset.confirm) {
    $('startBtn').dataset.confirm = '1'; $('startBtn').textContent = `Discard saved ${saved.rack} count and start ${pickedRack}?`; return;
  }
  delete $('startBtn').dataset.confirm; $('startBtn').textContent = 'Start counting';
  store.set('shelfcount.name', name);
  S = { v: 2, counter: name, rack: pickedRack, whName: WH.name, whFile: WH.file, parts: WH.rows.filter(r => r.rack === pickedRack).map(r => ({ ...r })), counts: {}, pending: [], unlisted: [], strays: [], log: [], bin: null, startedAt: new Date().toISOString(), seq: 1 };
  setIndex(); save(); showCount();
});
$('resumeBtn').addEventListener('click', () => { S = store.get(KEY); const n = $('inName').value.trim(); if (n) S.counter = n; setIndex(); showCount(); });
$('inFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  $('fileMsg').textContent = 'Reading…';
  try {
    const wb = XLSX.read(await f.arrayBuffer());
    const rows = [];
    for (const sn of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
      const hi = aoa.findIndex(r => r && r.some(c => /^part\s*id$/i.test(String(c || '').trim())));
      if (hi < 0) continue;
      const H = aoa[hi].map(c => String(c || '').trim().toLowerCase());
      const col = (...names) => H.findIndex(h => names.includes(h));
      const ci = { id: col('part id'), type: col('part type','type'), desc: col('description'), status: col('status'), loc: col('bin location','warehouse bin','bin','bin #','bin number','location'), wh: col('warehouse','inventory warehouse','warehouse name','warehouse id'), avail: col('available'), onHand: col('on hand','onhand','qty on hand'), cost: col('current cost','cost','unit cost') };
      for (const r of aoa.slice(hi + 1)) {
        const id = r[ci.id]; if (id == null || String(id).trim() === '') continue;
        if (/^count:/i.test(String(id))) continue;
        const cost = ci.cost >= 0 ? parseFloat(String(r[ci.cost] ?? '0').replace(/[$,]/g, '')) || 0 : 0;
        rows.push({ id: String(id).trim(), type: r[ci.type] || '', desc: r[ci.desc] || '', status: r[ci.status] || '', loc: ci.loc >= 0 ? String(r[ci.loc] ?? '').trim() : '', wh: ci.wh >= 0 ? String(r[ci.wh] ?? '').trim() : '', avail: +r[ci.avail] || 0, onHand: +r[ci.onHand] || 0, cost });
      }
    }
    if (!rows.length) throw new Error('No sheet with a "Part ID" header and part rows');
    const whName = f.name.replace(/\.(xlsx|xls|csv)$/i, '');
    WH = { name: whName, file: f.name, loadedAt: new Date().toISOString(), rows: prepRows(rows, whName), pin: WH.pin, builtin: false };
    const ok = store.set(WHKEY, WH);
    $('fileMsg').textContent = `Loaded ${rows.length} lines.${ok ? '' : ' (Too big to keep on this phone; re-upload if you close the page.)'}`;
    pickedRack = null; renderSetup();
  } catch (err) { $('fileMsg').textContent = 'Could not read that file: ' + err.message + '.'; }
  e.target.value = '';
});

/* ---------------- counting ---------------- */
function showCount() {
  $('vSetup').hidden = true; $('vReview').hidden = true; $('vCount').hidden = false; $('top').hidden = false; $('composer').hidden = false;
  renderAll(); updatePreview();
}
function binsInOrder() { return [...new Set(S.parts.map(p => p.bin))].sort(); }
function renderHeader() {
  const n = S.parts.length, c = Object.keys(S.counts).length;
  $('hShelf').textContent = S.rack;
  $('hMeta').innerHTML = `${esc(S.counter)} · <span class="num">${c}/${n}</span> lines${S.pending.length ? ` · <b style="color:var(--warn)">${S.pending.length} to confirm</b>` : ''}`;
  $('hBar').style.width = (n ? c / n * 100 : 0) + '%';
  $('hBins').hidden = !hasShelves();
  $('hBins').innerHTML = !hasShelves() ? '' : binsInOrder().filter(b => b).map(b => {
    const ps = S.parts.filter(p => p.bin === b); const done = ps.every(p => S.counts[p._i] != null);
    return `<button class="binchip ${S.bin === b ? 'on' : ''} ${done ? 'done' : ''}" data-b="${b}" aria-pressed="${S.bin === b}" aria-label="Shelf ${b}">${b}</button>`;
  }).join('');
  $('binHint').textContent = !hasShelves() ? 'No bins here. Just say part and count.' : S.bin ? `Shelf ${S.bin}: new lines log here` : 'Shelf: none set. Say “shelf A”';
}
function renderBins() {
  S.parts.forEach((p, i) => p._i = i);
  $('binsList').innerHTML = binsInOrder().map(b => {
    const ps = S.parts.filter(p => p.bin === b);
    const c = ps.filter(p => S.counts[p._i] != null).length;
    const tag = b ? `<span class="tag"><small>\\${esc(S.rack)}\\</small>${b}</span>` : `<span class="tag">${esc(S.rack)}<small>${hasShelves() ? '· no bin' : ''}</small></span>`;
    return `<div class="bin" id="${binId(b)}"><div class="binhead">${tag}<span class="cnt num">${c}/${ps.length} counted</span></div>
      <div class="rows">${ps.map(rowHTML).join('')}</div></div>`;
  }).join('') + (S.strays.length ? `<div class="bin"><div class="binhead"><span class="tag" style="background:var(--warn-bg);color:var(--warn)">From other racks</span><span class="cnt">system says these live elsewhere</span></div>
      <div class="rows">${S.strays.map(strayHTML).join('')}</div></div>` : '');
}
function rowHTML(p) {
  const c = S.counts[p._i];
  const cls = c == null ? '' : (c.qty === 0 ? 'zero' : 'counted');
  const notes = c && (c.notes.length || c.manualNote) ? `<div class="notes">${esc([...c.notes, c.manualNote].filter(Boolean).join(' · '))}</div>` : '';
  return `<div class="row ${cls}" id="row-${p._i}" data-i="${p._i}"><div class="stripe"></div>
    <div class="info"><div class="pn">${esc(p.id)}</div><div class="desc">${esc(p.desc)}</div>${notes}</div>
    <div class="stepper"><button data-act="dec" aria-label="Minus one">−</button><div class="val num ${c == null ? 'empty' : ''}">${c == null ? '–' : c.qty}</div><button data-act="inc" aria-label="Plus one">+</button></div>
    <div class="rowtools" hidden><input type="text" placeholder="Note for this line" value="${esc(c ? (c.manualNote || '') : '')}" data-act="note"><button class="btn small" data-act="zero">Not found</button><button class="btn small ghost" data-act="clear">Clear</button></div>
  </div>`;
}
function strayHTML(st) {
  return `<div class="row counted" data-sid="${st.id}"><div class="stripe" style="background:var(--warn)"></div>
    <div class="info"><div class="stray">System location ${esc(st.part.loc || st.part.rack + ' (no bin)')}</div><div class="pn">${esc(st.part.id)}</div><div class="desc">${esc(st.part.desc)}</div><div class="notes">${esc(st.notes.join(' · '))}</div></div>
    <div class="stepper"><button data-sact="dec" aria-label="Minus one">−</button><div class="val num">${st.qty}</div><button data-sact="inc" aria-label="Plus one">+</button></div></div>`;
}
function renderPending() {
  $('pending').innerHTML = S.pending.length ? `<div class="section-h">Confirm these</div>` + S.pending.map(pcardHTML).join('') : '';
}
function pcardHTML(pd) {
  const unknown = pd.status === 'unknown';
  const elsewhere = pd.top.some(t => t.key[0] === 'w');
  const why = pd.status === 'needqty' ? 'Part found. How many?' : (!unknown && pd.top.length === 1) ? 'Best guess. Tap it to confirm.' : unknown ? (elsewhere ? `Not on ${esc(S.rack)}'s list. These match elsewhere in the warehouse:` : 'No match anywhere in the warehouse list. Log it as not in system.') : 'More than one part fits. Tap the right one.';
  const choices = pd.top.map(t => { const p = partByKey(t.key); const other = t.key[0] === 'w';
    return `<button class="choice ${pd.sel === t.key ? 'sel' : ''}" data-pick="${t.key}"><b>${esc(p.id)}</b><span>${other ? `<strong style="color:var(--warn)">${esc(p.loc || p.rack)}</strong> · ` : ''}${esc(p.desc)}${other || !p.bin ? '' : ' · shelf ' + p.bin}</span><em class="pct num">${Math.round(Math.min(1, t.score) * 100)}%</em></button>`; }).join('');
  return `<div class="pcard ${unknown ? 'unknown' : ''}" data-pid="${pd.id}">
    <div class="heard">Heard <q>${esc(pd.raw)}</q>${pd.bin ? ` <span class="tag" style="font-size:13px;padding:1px 6px">${pd.bin}</span>` : ''}</div>
    <div class="why">${why}</div>
    ${choices ? `<div class="choices">${choices}</div>` : ''}
    <div class="prow"><input class="qtyin num" type="number" inputmode="numeric" min="0" value="${pd.qty ?? ''}" placeholder="Qty" aria-label="Quantity" data-q>
      <div class="quickq">${[0,1,2,3].map(n => `<button data-qq="${n}">${n}</button>`).join('')}</div></div>
    <div class="prow"><button class="btn primary small" data-ok>Confirm</button><button class="btn small" data-unl>Not in system</button><button class="btn small ghost" data-x>Discard</button></div>
  </div>`;
}
function renderUnlisted() {
  $('unlistedWrap').hidden = !S.unlisted.length;
  $('unlisted').innerHTML = S.unlisted.map(u => `<div class="ucard" data-uid="${u.id}">${u.photo ? `<img src="${u.photo}" alt="Photo of ${esc(u.pn)}">` : '<div class="ph">No photo</div>'}
    <div class="info"><div class="mono" style="font-weight:600;word-break:break-all">${esc(u.pn || '(no P/N)')}</div><div style="font-size:13px;color:var(--muted)">${esc(u.desc)} · shelf ${esc(u.bin || '?')}${u.notes ? ' · ' + esc(u.notes) : ''}</div></div>
    <div style="display:grid;gap:4px;justify-items:end"><b class="num" style="font-family:var(--f-display);font-size:22px">${u.qty}</b><button class="btn small ghost" data-uedit>Edit</button></div></div>`).join('');
}
function renderAll() { renderHeader(); renderBins(); renderPending(); renderUnlisted(); }

/* count mutations */
function addNote(c, n) { if (n && !c.notes.includes(n)) c.notes.push(n); }
function logIt(o) { S.log.push({ ts: new Date().toISOString(), counter: S.counter, rack: S.rack, shelf: o.bin || '', heard: o.raw || '(manual)', part: o.part, qty: o.qty, mode: o.mode || 'add', status: o.status || 'manual', confidence: o.conf != null ? Math.round(Math.min(1, o.conf) * 100) : '' }); }
function applyCount(i, qty, opts = {}) {
  const p = S.parts[i];
  const prev = S.counts[i] ? JSON.parse(JSON.stringify(S.counts[i])) : null;
  let c = S.counts[i];
  if (!c || opts.mode === 'set') c = S.counts[i] = { qty: 0, notes: prev ? prev.notes : [], heard: prev ? prev.heard : [], parts: [], manualNote: prev ? prev.manualNote : '' };
  if (opts.mode === 'set') { c.qty = qty; c.parts = [qty]; c.notes = c.notes.filter(n => !/^Logged as /.test(n)); }
  else { c.parts.push(qty); c.qty += qty; if (c.parts.length > 1) { c.notes = c.notes.filter(n => !/^Logged as /.test(n)); addNote(c, `Logged as ${c.parts.join(' + ')}`); } }
  if (opts.raw) c.heard.push(opts.raw);
  if (opts.countedAs) addNote(c, `Counted as ${opts.countedAs}`);
  if (opts.byDesc) addNote(c, 'Matched by description');
  if (opts.bin && p.bin && opts.bin !== p.bin) addNote(c, `Found on shelf ${opts.bin}, system shows ${p.bin} - relocate/update bin`);
  if (opts.bin && !p.bin && hasShelves()) addNote(c, `Found on shelf ${opts.bin}, no bin in system - assign bin`);
  if (qty === 0 && opts.notFound) addNote(c, 'Not found in count - verify');
  logIt({ ...opts, part: p.id, qty });
  undoStack.push({ type: 'count', i, prev, logLen: S.log.length - 1 });
  save(); return c;
}
function applyStray(wi, qty, opts = {}) {
  const p = whOthers[wi];
  let st = S.strays.find(x => x.part.id === p.id && x.part.loc === p.loc);
  const prevStrays = JSON.parse(JSON.stringify(S.strays));
  if (!st) { st = { id: 's' + (S.seq++), part: { ...p }, qty: 0, notes: [], parts: [] }; S.strays.push(st); }
  st.parts.push(qty); st.qty += qty;
  const here = opts.bin ? `\\${S.rack}\\${opts.bin}` : S.rack, there = p.loc || `${p.rack} (no bin)`;
  addNote(st, `Found on ${here}, system shows ${there} - relocate/update bin`);
  if (st.parts.length > 1) { st.notes = st.notes.filter(n => !/^Logged as /.test(n)); addNote(st, `Logged as ${st.parts.join(' + ')}`); }
  logIt({ ...opts, part: p.id + ' (system ' + p.loc + ')', qty, status: 'stray' });
  undoStack.push({ type: 'strays', prev: prevStrays, logLen: S.log.length - 1 });
  save(); return st;
}
function undo() {
  const u = undoStack.pop(); if (!u) return;
  if (u.type === 'count') { if (u.prev) S.counts[u.i] = u.prev; else delete S.counts[u.i]; S.log.length = u.logLen; }
  if (u.type === 'strays') { S.strays = u.prev; S.log.length = u.logLen; }
  if (u.type === 'pending') S.pending = S.pending.filter(p => p.id !== u.id);
  if (u.type === 'bin') S.bin = u.prev;
  save(); renderAll(); hideToast(); updatePreview();
}

/* parse + commit */
function shortPN(id) { return id.length > 22 ? id.slice(0, 20) + '…' : id; }
function commitText(text) {
  const utts = Matcher.splitUtterances(text);
  let last = null;
  for (const u of utts) last = commitOne(u) || last;
  if (last) toast(last, true);
  renderAll();
}
function commitOne(raw) {
  const r = Matcher.parse(raw, index, { bin: S.bin });
  if (!r) return null;
  if (r.kind === 'location') {
    if (r.rack && r.rack !== S.rack && !r.bin) return `Rack ${r.rack} isn't the one being counted. This count is ${S.rack}.`;
    if (r.bin) { undoStack.push({ type: 'bin', prev: S.bin }); S.bin = r.bin; save(); speak(`Shelf ${r.bin}`); scrollToBin(r.bin); return `Now on shelf ${r.bin}`; }
    return null;
  }
  const bin = r.foundBin || S.bin;
  let whBetter = false;
  if (r.status === 'matched' && r.best.leftover && whOthers.length) { const w = Matcher.parse(raw, getWhIndex(), {}); whBetter = !!(w && w.best && w.best.score > r.best.score + 0.04); }
  if (r.status === 'matched' && r.qty != null && !whBetter) {
    const b = r.best, p = b.part;
    const countedAs = b.via === 'pn' && !b.pnExact && b.pn < 0.97 && r.heardPN && !Matcher.alnum(p.id).startsWith(Matcher.alnum(r.heardPN)) ? r.heardPN : null;
    const c = applyCount(b.idx, r.qty, { raw, bin, countedAs, byDesc: b.via === 'desc' && b.pn < 0.5, status: 'matched', conf: b.score });
    flashRow(b.idx); speak(`${spokenPN(p)}, ${r.qty}`);
    return `${r.qty === 0 ? 'Zero' : '+' + r.qty} ${shortPN(p.id)}${c.parts.length > 1 ? ` (now ${c.qty})` : ''}`;
  }
  let top = r.top.slice(0, 3).filter(t => t.score >= 0.3).map(t => ({ key: 'r:' + t.idx, score: t.score, via: t.via, pn: t.pn }));
  let status = r.status;
  // weak on this rack: look across the rest of the warehouse
  if (whOthers.length) {
    const w = Matcher.parse(raw, getWhIndex(), {});
    if (w && w.kind === 'count' && w.best && w.best.score >= 0.6 && (!r.best || w.best.score > r.best.score + 0.04)) {
      const wt = w.top.slice(0, 3).filter(t => t.score >= 0.55).map(t => ({ key: 'w:' + t.idx, score: t.score, via: t.via, pn: t.pn }));
      top = [...wt, ...top.filter(t => t.score >= 0.5)].slice(0, 4); status = 'unknown';
    }
  }
  const pd = { id: 'p' + (S.seq++), raw, bin, qty: r.qty, status, top, heardPN: r.heardPN, sel: null };
  if (r.status === 'needqty' && !whBetter) { pd.status = 'needqty'; pd.sel = 'r:' + r.best.idx; pd.top = pd.top.slice(0, 1); }
  S.pending.push(pd); undoStack.push({ type: 'pending', id: pd.id }); save();
  buzz([30, 60, 30]);
  return pd.status === 'needqty' ? 'Found it. Enter the quantity on the card.' : status === 'unknown' ? 'Not on this rack. Check the red card.' : 'Needs a tap to confirm';
}
function spokenPN(p) { return (String(p.id).split(/[\s\-]/)[0] || p.id).slice(0, 8); }
function flashRow(i) { buzz(25); requestAnimationFrame(() => { const el = $('row-' + i); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }); }
function scrollToBin(b) { requestAnimationFrame(() => { const el = $(binId(b)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); }
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }

/* live preview */
let pvT = 0;
function updatePreview() {
  if (!S) return;
  const text = $('say').value; const pv = $('preview');
  const utts = Matcher.splitUtterances(text);
  pv.className = 'preview';
  if (!utts.length) { $('ptxt').textContent = !hasShelves() ? 'Tap the box, then the keyboard mic. Say a part and a count.' : S.bin ? `On shelf ${S.bin}. Say a part and a count.` : 'Tap the box, then the keyboard mic. Say “shelf A” to start.'; return; }
  const r = Matcher.parse(utts[utts.length - 1], index, { bin: S.bin });
  if (!r) return;
  const more = utts.length > 1 ? `<span style="color:var(--muted)">${utts.length} lines · </span>` : '';
  if (r.kind === 'location') { pv.classList.add('location'); $('ptxt').innerHTML = more + (r.bin ? `Move to shelf <b>${esc(r.bin)}</b>` : `Rack <b>${esc(r.rack)}</b>`); return; }
  pv.classList.add(r.status);
  if (!r.best || r.status === 'unknown') { $('ptxt').innerHTML = more + `Not on ${esc(S.rack)} yet${r.qty != null ? ` · qty <b>${r.qty}</b>` : ''}. Add it to search the warehouse.`; return; }
  $('ptxt').innerHTML = more + `<span class="mono">${esc(r.best.part.id)}</span> · ${esc(r.best.part.desc)} · qty <b>${r.qty ?? '?'}</b> <span style="color:var(--muted)">${Math.round(Math.min(1, r.best.score) * 100)}%</span>`;
}
$('say').addEventListener('input', () => { clearTimeout(pvT); pvT = setTimeout(updatePreview, 90); autoGrow(); if (/\bnext\s*[.!]?\s*$/i.test($('say').value)) submitBox(); });
$('say').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitBox(); } });
$('addBtn').addEventListener('click', submitBox);
function autoGrow() { const t = $('say'); t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }
function submitBox() {
  const v = $('say').value; if (!v.trim()) { $('say').focus(); return; }
  micBase = ''; commitText(v); $('say').value = ''; autoGrow(); updatePreview();
}

/* header + rows events */
$('hBins').addEventListener('click', e => { const b = e.target.closest('.binchip'); if (!b) return; undoStack.push({ type: 'bin', prev: S.bin }); S.bin = b.dataset.b; save(); renderHeader(); scrollToBin(S.bin); updatePreview(); });
$('binsList').addEventListener('click', e => {
  const srow = e.target.closest('[data-sid]');
  if (srow) { const st = S.strays.find(x => x.id === srow.dataset.sid); const a = e.target.closest('[data-sact]')?.dataset.sact; if (!st || !a) return;
    undoStack.push({ type: 'strays', prev: JSON.parse(JSON.stringify(S.strays)), logLen: S.log.length });
    st.qty = Math.max(0, st.qty + (a === 'inc' ? 1 : -1)); st.parts = [st.qty]; st.notes = st.notes.filter(n => !/^Logged as /.test(n));
    if (st.qty === 0) S.strays = S.strays.filter(x => x !== st); save(); renderAll(); return; }
  const row = e.target.closest('.row'); if (!row) return;
  const i = +row.dataset.i; const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'inc') { const c = S.counts[i]; applyCount(i, (c ? c.qty : 0) + 1, { mode: 'set', bin: S.bin && S.parts[i].bin && S.bin !== S.parts[i].bin ? S.bin : null }); renderAll(); return; }
  if (act === 'dec') { const c = S.counts[i]; applyCount(i, Math.max(0, (c ? c.qty : 1) - 1), { mode: 'set' }); renderAll(); return; }
  if (act === 'zero') { applyCount(i, 0, { mode: 'set', notFound: true }); renderAll(); return; }
  if (act === 'clear') { undoStack.push({ type: 'count', i, prev: S.counts[i] ? JSON.parse(JSON.stringify(S.counts[i])) : null, logLen: S.log.length }); delete S.counts[i]; save(); renderAll(); return; }
  if (act === 'note') return;
  const tools = row.querySelector('.rowtools'); if (tools) tools.hidden = !tools.hidden;
});
$('binsList').addEventListener('change', e => {
  if (e.target.dataset.act !== 'note') return;
  const i = +e.target.closest('.row').dataset.i;
  if (!S.counts[i]) applyCount(i, 0, { mode: 'set' });
  S.counts[i].manualNote = e.target.value.trim(); save(); renderAll();
});

/* pending events */
$('pending').addEventListener('click', e => {
  const card = e.target.closest('.pcard'); if (!card) return;
  const pd = S.pending.find(p => p.id === card.dataset.pid); if (!pd) return;
  const qIn = card.querySelector('[data-q]');
  const pick = e.target.closest('[data-pick]');
  if (pick) { pd.sel = pick.dataset.pick; save(); card.querySelectorAll('.choice').forEach(c => c.classList.toggle('sel', c.dataset.pick === pd.sel)); return; }
  const qq = e.target.closest('[data-qq]'); if (qq) { qIn.value = qq.dataset.qq; pd.qty = +qq.dataset.qq; save(); return; }
  if (e.target.closest('[data-x]')) { S.pending = S.pending.filter(p => p !== pd); save(); renderAll(); return; }
  if (e.target.closest('[data-unl]')) { openUnlisted({ pn: pd.heardPN || '', desc: pd.raw, qty: qIn.value === '' ? 1 : +qIn.value, bin: pd.bin || S.bin || '' }, pd.id); return; }
  if (e.target.closest('[data-ok]')) {
    const q = qIn.value === '' ? null : +qIn.value;
    if (pd.sel == null) { card.querySelector('.why').innerHTML = '<b style="color:var(--bad)">Tap the part that matches first.</b>'; return; }
    if (q == null || isNaN(q)) { qIn.focus(); card.querySelector('.why').innerHTML = '<b style="color:var(--bad)">Enter the quantity.</b>'; return; }
    const t = pd.top.find(x => x.key === pd.sel) || {}; const [src, ix] = pd.sel.split(':'); const p = partByKey(pd.sel);
    const countedAs = pd.heardPN && t.via === 'pn' && !Matcher.alnum(p.id).startsWith(Matcher.alnum(pd.heardPN)) ? pd.heardPN : null;
    if (src === 'r') { applyCount(+ix, q, { raw: pd.raw, bin: pd.bin, countedAs, byDesc: t.via === 'desc' && (t.pn || 0) < 0.5, status: 'confirmed', conf: t.score }); }
    else { const st = applyStray(+ix, q, { raw: pd.raw, bin: pd.bin, conf: t.score }); if (countedAs) addNote(st, `Counted as ${countedAs}`); save(); }
    S.pending = S.pending.filter(x => x !== pd); save(); renderAll(); if (src === 'r') flashRow(+ix); toast(`+${q} ${shortPN(p.id)}`, true);
  }
});
$('pending').addEventListener('input', e => { if (!e.target.matches('[data-q]')) return; const pd = S.pending.find(p => p.id === e.target.closest('.pcard').dataset.pid); if (pd) { pd.qty = e.target.value === '' ? null : +e.target.value; save(); } });

/* unlisted sheet */
function openUnlisted(pre = {}, fromPending = null, editId = null) {
  const u = editId ? S.unlisted.find(x => x.id === editId) : null;
  const v = u || { pn: pre.pn || '', desc: pre.desc || '', qty: pre.qty ?? 1, bin: pre.bin || S.bin || '', notes: '', photo: null };
  let photo = v.photo;
  $('sheetPanel').innerHTML = `<h2>${u ? 'Edit' : 'Add'} part not in system</h2>
    <p>Goes in its own section of the export so it can be added to ManagerPlus or matched later.</p>
    <div class="field"><label for="uPn">Part # as seen on the part</label><input type="text" id="uPn" value="${esc(v.pn)}" autocapitalize="characters"></div>
    <div class="field"><label for="uDesc">Description</label><input type="text" id="uDesc" value="${esc(v.desc)}"></div>
    <div class="prow"><div class="field"><label for="uQty">Qty</label><input class="qtyin" type="number" inputmode="numeric" id="uQty" value="${v.qty}"></div>
      <div class="field"><label for="uBin">Shelf</label><input class="qtyin" type="text" id="uBin" value="${esc(v.bin)}" maxlength="3" style="width:64px"></div></div>
    <div class="field"><label for="uNotes">Notes</label><input type="text" id="uNotes" value="${esc(v.notes)}" placeholder="e.g. No P/N on unit, possibly HE-XC1E2"></div>
    <div class="prow"><label class="btn small" for="uPhoto">${photo ? 'Retake photo' : 'Take photo'}</label><input type="file" id="uPhoto" accept="image/*" capture="environment" hidden><img id="uPrev" ${photo ? `src="${photo}"` : 'hidden'} style="width:64px;height:64px;object-fit:cover;border-radius:8px" alt="Part photo"></div>
    <div class="prow"><button class="btn primary" id="uSave">Save</button><button class="btn" id="uCancel">Cancel</button>${u ? '<button class="btn ghost" id="uDel" style="color:var(--bad)">Delete</button>' : ''}</div>`;
  $('sheet').hidden = false;
  $('uPhoto').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; photo = await shrink(f); if (photo) { $('uPrev').src = photo; $('uPrev').hidden = false; } };
  $('uCancel').onclick = () => $('sheet').hidden = true;
  if (u) $('uDel').onclick = () => { S.unlisted = S.unlisted.filter(x => x !== u); save(); $('sheet').hidden = true; renderAll(); };
  $('uSave').onclick = () => {
    const rec = { id: u ? u.id : 'u' + (S.seq++), pn: $('uPn').value.trim(), desc: $('uDesc').value.trim(), qty: +$('uQty').value || 0, bin: $('uBin').value.trim().toUpperCase(), notes: $('uNotes').value.trim(), photo };
    if (u) Object.assign(u, rec); else S.unlisted.push(rec);
    if (fromPending) S.pending = S.pending.filter(p => p.id !== fromPending);
    logIt({ bin: rec.bin, raw: pre.desc, part: '(not in system) ' + rec.pn, qty: rec.qty, mode: 'unlisted', status: 'unlisted' });
    if (!save()) { rec.photo = null; save(); }
    $('sheet').hidden = true; renderAll(); toast(`Logged ${rec.pn || 'part'} as not in system`);
  };
}
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').hidden = true; });
$('addUnlistedBtn').addEventListener('click', () => openUnlisted());
$('unlisted').addEventListener('click', e => { if (e.target.closest('[data-uedit]')) openUnlisted({}, null, e.target.closest('.ucard').dataset.uid); });
function shrink(file) {
  return new Promise(res => { const img = new Image(); img.onload = () => { const s = Math.min(1, 640 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.72)); URL.revokeObjectURL(img.src); }; img.onerror = () => res(null); img.src = URL.createObjectURL(file); });
}

/* toast */
let toastT = 0;
function toast(msg, withUndo) { const cp = $('composer'); $('toast').style.bottom = ((cp.hidden ? 0 : cp.offsetHeight) + 12) + 'px'; $('toastTxt').textContent = msg; $('toastUndo').hidden = !withUndo; $('toast').hidden = false; clearTimeout(toastT); toastT = setTimeout(hideToast, 3800); }
function hideToast() { $('toast').hidden = true; }
$('toastUndo').addEventListener('click', undo);

/* ---------------- review: counter (blind) + manager ---------------- */
$('toReview').addEventListener('click', () => { managerOpen = false; showReview(); });
function computeRows() {
  return S.parts.map((p, i) => {
    const c = S.counts[i]; const counted = c ? c.qty : 0;
    const notes = c ? [...c.notes, c.manualNote].filter(Boolean) : ['Not found in count - verify'];
    const vq = counted - (+p.onHand || 0);
    return { p, i, counted, uncounted: !c, vq, vd: vq * (+p.cost || 0), notes: [...new Set(notes)].join('; ') };
  });
}
async function hashPin(pin) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shelfcount:' + pin)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch { return 'plain:' + pin; }
}
function showReview() {
  $('vCount').hidden = true; $('composer').hidden = true; $('top').hidden = true; $('vReview').hidden = false; hideToast();
  const rows = computeRows();
  const unc = rows.filter(r => r.uncounted);
  const units = rows.reduce((a, r) => a + r.counted, 0) + S.strays.reduce((a, s) => a + s.qty, 0);
  const mins = Math.max(1, Math.round((Date.now() - new Date(S.startedAt)) / 60000));
  let html = `
    <div class="prow" style="justify-content:space-between"><h1>${esc(S.rack)} count</h1><button class="btn small" id="backBtn">Back to counting</button></div>
    <p>${esc(S.counter)} · about ${mins} min · ${esc(S.whName)}</p>
    ${S.pending.length ? `<div class="callout" style="background:var(--bad-bg)"><b>${S.pending.length} unconfirmed card${S.pending.length > 1 ? 's' : ''}</b> won't be in the file until you confirm or discard them.</div>` : ''}
    <div class="stats">
      <div class="stat"><small>Lines counted</small><b class="num">${rows.length - unc.length}/${rows.length}</b></div>
      <div class="stat"><small>Units counted</small><b class="num">${units}</b></div>
      <div class="stat"><small>From other racks</small><b class="num">${S.strays.length}</b></div>
      <div class="stat"><small>Not in system</small><b class="num">${S.unlisted.length}</b></div>
    </div>
    ${unc.length ? `<h2>Not counted yet (${unc.length})</h2><p>These go in the file as 0, "Not found in count - verify". Go back if you skipped a shelf.</p>
      <div class="tablewrap"><table style="min-width:0"><thead><tr><th>Shelf</th><th>Part ID</th><th>Description</th></tr></thead><tbody>${unc.map(r => `<tr><td>${r.p.bin || '–'}</td><td class="mono">${esc(r.p.id)}</td><td>${esc(r.p.desc)}</td></tr>`).join('')}</tbody></table></div>` : '<p style="color:var(--ok);font-weight:600">Every line on this rack has a count.</p>'}
    <div class="prow"><button class="btn primary" id="blindBtn">Save count file</button><button class="btn" id="csvBtn">Save CSV</button>${S.unlisted.some(u => u.photo) ? '<button class="btn" id="photoBtn">Save photos</button>' : ''}</div>
    <div class="empty-note" id="saveMsg"></div>
    <div id="mgr" style="display:grid;gap:14px;border-top:1px solid var(--line);padding-top:14px"></div>
    <div class="prow" style="border-top:1px solid var(--line);padding-top:14px"><button class="btn ghost" id="newBtn">Finish and start another rack</button></div>`;
  $('reviewPanel').innerHTML = html;
  $('backBtn').onclick = showCount;
  $('blindBtn').onclick = () => saveFile(`${S.rack}_Count_${S.counter.replace(/\W+/g, '')}_${dateTag()}.xlsx`, buildXlsx(false));
  $('csvBtn').onclick = () => saveFile(`${S.rack}_Count_${dateTag()}.csv`, buildCsv());
  if ($('photoBtn')) $('photoBtn').onclick = savePhotos;
  $('newBtn').onclick = () => { $('newBtn').outerHTML = `<span class="callout" style="width:100%">This clears the ${esc(S.rack)} count from this phone. Save the count file first. <button class="btn small" id="newYes" style="color:var(--bad)">Clear and pick a rack</button></span>`; $('newYes').onclick = () => { store.del(KEY); S = null; renderSetup(); window.scrollTo(0, 0); }; };
  renderManager();
  window.scrollTo(0, 0);
}
function renderManager() {
  const box = $('mgr');
  if (!managerOpen) {
    box.innerHTML = `<div class="prow" style="justify-content:space-between"><h2>Manager view</h2></div>
      <p>${WH.pin ? 'System quantities and variance. Enter the manager PIN.' : 'System quantities and variance. No PIN is set on this phone yet, so set one now to keep counters blind.'}</p>
      <div class="prow"><input class="qtyin" type="password" inputmode="numeric" id="pinIn" placeholder="PIN" style="width:120px;font-size:18px" autocomplete="off"><button class="btn" id="pinBtn">${WH.pin ? 'Unlock' : 'Set PIN and unlock'}</button><span class="empty-note" id="pinMsg"></span></div>`;
    $('pinBtn').onclick = async () => {
      const v = $('pinIn').value.trim(); if (v.length < 3) { $('pinMsg').textContent = 'Use at least 3 digits.'; return; }
      const h = await hashPin(v);
      if (!WH.pin) { WH.pin = h; store.set(WHKEY, WH); managerOpen = true; renderManager(); return; }
      if (h === WH.pin) { managerOpen = true; renderManager(); } else { $('pinMsg').textContent = 'Wrong PIN.'; $('pinIn').value = ''; }
    };
    return;
  }
  const rows = computeRows();
  const over = rows.filter(r => r.vd > 0).reduce((a, r) => a + r.vd, 0), under = rows.filter(r => r.vd < 0).reduce((a, r) => a + r.vd, 0);
  const exact = rows.filter(r => r.vq === 0).length;
  const varRows = rows.filter(r => r.vq !== 0).sort((a, b) => Math.abs(b.vd) - Math.abs(a.vd));
  box.innerHTML = `<div class="prow" style="justify-content:space-between"><h2>Manager view: variance</h2><button class="btn small ghost" id="lockBtn">Lock</button></div>
    <div class="stats">
      <div class="stat"><small>Lines exact</small><b class="num">${exact}/${rows.length}</b></div>
      <div class="stat pos"><small>Total over</small><b class="num">${money(over)}</b></div>
      <div class="stat neg"><small>Total under</small><b class="num">${money(under)}</b></div>
      <div class="stat"><small>Net variance</small><b class="num">${money(over + under)}</b></div>
    </div>
    ${varRows.length ? `<div class="tablewrap"><table><thead><tr><th>Part ID</th><th>Shelf</th><th class="r">System</th><th class="r">Counted</th><th class="r">Var</th><th class="r">Var $</th><th>Notes</th></tr></thead><tbody>
      ${varRows.map(r => `<tr class="${r.vq > 0 ? 'over' : 'under'}"><td class="mono">${esc(r.p.id)}</td><td>${r.p.bin || '–'}</td><td class="r num">${r.p.onHand}</td><td class="r num">${r.counted}</td><td class="r num v">${r.vq > 0 ? '+' : ''}${r.vq}</td><td class="r num v">${money(r.vd)}</td><td>${esc(r.notes)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p>Every line matched the system.</p>'}
    ${S.strays.length ? `<h2>Found here, system says elsewhere</h2><div class="tablewrap"><table><thead><tr><th>Part ID</th><th>System location</th><th class="r">System on hand</th><th class="r">Found here</th><th>Notes</th></tr></thead><tbody>${S.strays.map(s => `<tr><td class="mono">${esc(s.part.id)}</td><td>${esc(s.part.loc || s.part.rack + ' (no bin)')}</td><td class="r num">${s.part.onHand}</td><td class="r num">${s.qty}</td><td>${esc(s.notes.join('; '))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${S.unlisted.length ? `<h2>On the rack, not in system</h2><div class="tablewrap"><table><thead><tr><th>Part # (as counted)</th><th>Shelf</th><th>Description</th><th class="r">Qty</th><th>Notes</th></tr></thead><tbody>${S.unlisted.map(u => `<tr><td class="mono">${esc(u.pn)}</td><td>${esc(u.bin)}</td><td>${esc(u.desc)}</td><td class="r num">${u.qty}</td><td>${esc(u.notes)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="prow"><button class="btn primary" id="xlsxBtn">Save variance workbook</button></div>
    <div class="empty-note" id="saveMsg2"></div>`;
  $('lockBtn').onclick = () => { managerOpen = false; renderManager(); };
  $('xlsxBtn').onclick = () => saveFile(`${S.rack}_Counted_${dateTag()}.xlsx`, buildXlsx(true), 'saveMsg2');
}
function dateTag() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function buildXlsx(withVariance) {
  const rows = computeRows();
  const ws = {}; const set = (r, c, v) => { ws[XLSX.utils.encode_cell({ r, c })] = v; };
  const str = v => ({ t: 's', v: String(v ?? '') }), num = (v, z) => (z ? { t: 'n', v: +v || 0, z } : { t: 'n', v: +v || 0 });
  const CUR = '$#,##0.00', CURNEG = '$#,##0.00;[Red]-$#,##0.00';
  let R = 0, lastCol;
  if (withVariance) {
    ['Part ID','Part Type','Description','Status','Bin Location','Available','On Hand','Current Cost','Physical Count','Variance (Qty)','Variance ($)','Count Notes'].forEach((h, c) => set(0, c, str(h)));
    rows.forEach((r, k) => {
      const x = k + 2, p = r.p;
      [p.id, p.type, p.desc, p.status, p.loc].forEach((v, c) => set(k + 1, c, str(v)));
      set(k + 1, 5, num(p.avail)); set(k + 1, 6, num(p.onHand)); set(k + 1, 7, num(p.cost, CUR)); set(k + 1, 8, num(r.counted));
      set(k + 1, 9, { t: 'n', f: `I${x}-G${x}`, v: r.vq }); set(k + 1, 10, { t: 'n', f: `J${x}*H${x}`, v: r.vd, z: CURNEG }); set(k + 1, 11, str(r.notes));
    });
    const n = rows.length, last = n + 1; R = n + 1;
    const over = rows.filter(r => r.vd > 0).reduce((a, r) => a + r.vd, 0), under = rows.filter(r => r.vd < 0).reduce((a, r) => a + r.vd, 0);
    set(R, 0, str(`Count: ${n}`)); set(R, 8, str('Total Over ($)')); set(R, 10, { t: 'n', f: `SUMIF(K2:K${last},">0")`, v: over, z: CUR }); R++;
    set(R, 8, str('Total Under ($)')); set(R, 10, { t: 'n', f: `SUMIF(K2:K${last},"<0")`, v: under, z: CURNEG }); R++;
    set(R, 8, str('Net Variance ($)')); set(R, 10, { t: 'n', f: `SUM(K2:K${last})`, v: over + under, z: CURNEG }); R++;
    ws['!autofilter'] = { ref: `A1:L${last}` };
    ws['!cols'] = [22, 14, 48, 9, 13, 9, 9, 12, 14, 13, 13, 50].map(w => ({ wch: w })); lastCol = 11;
  } else {
    ['Part ID','Part Type','Description','Bin Location','Physical Count','Count Notes'].forEach((h, c) => set(0, c, str(h)));
    rows.forEach((r, k) => { const p = r.p; [p.id, p.type, p.desc, p.loc].forEach((v, c) => set(k + 1, c, str(v))); set(k + 1, 4, num(r.counted)); set(k + 1, 5, str(r.notes)); });
    R = rows.length + 1; set(R, 0, str(`Count: ${rows.length}`)); R++;
    ws['!cols'] = [22, 14, 48, 13, 14, 50].map(w => ({ wch: w })); lastCol = 5;
  }
  if (S.strays.length) {
    R++; set(R, 0, str('Found on this rack, system location elsewhere (relocate or update bin)')); R++;
    const hs = withVariance ? ['Part ID','Description','System Bin','Found On','System On Hand','Physical Count','Notes'] : ['Part ID','Description','System Bin','Found On','Physical Count','Notes'];
    hs.forEach((h, c) => set(R, c, str(h))); R++;
    for (const s of S.strays) { const found = (s.notes.find(n => /^Found on /.test(n)) || '').replace(/^Found on (.+?), system shows.*$/, '$1');
      const vals = withVariance ? [str(s.part.id), str(s.part.desc), str(s.part.loc || s.part.rack + ' (no bin)'), str(found), num(s.part.onHand), num(s.qty), str(s.notes.join('; '))] : [str(s.part.id), str(s.part.desc), str(s.part.loc || s.part.rack + ' (no bin)'), str(found), num(s.qty), str(s.notes.join('; '))];
      vals.forEach((v, c) => set(R, c, v)); R++; }
  }
  if (S.unlisted.length) {
    R++; set(R, 0, str('Counted on Shelf but NOT in System (no cost on file - add to system or match)')); R++;
    ['Part # (as counted)','Bin','Description','Physical Count','Notes'].forEach((h, c) => set(R, c, str(h))); R++;
    for (const u of S.unlisted) { set(R, 0, str(u.pn)); set(R, 1, str(u.bin)); set(R, 2, str(u.desc)); set(R, 3, num(u.qty)); set(R, 4, str([u.notes, u.photo ? 'photo taken' : ''].filter(Boolean).join('; '))); R++; }
  }
  R++; set(R, 0, str(`Rack ${S.rack} counted by ${S.counter} · started ${new Date(S.startedAt).toLocaleString()} · list: ${S.whFile}`));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: R, c: lastCol } });
  const log = XLSX.utils.json_to_sheet(S.log.map(l => ({ Timestamp: l.ts, Counter: l.counter, Rack: l.rack, Shelf: l.shelf, Heard: l.heard, 'Matched Part': l.part, Qty: l.qty, Mode: l.mode, Status: l.status, 'Confidence %': l.confidence })));
  log['!cols'] = [22, 12, 7, 6, 44, 30, 6, 8, 10, 12].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Count');
  XLSX.utils.book_append_sheet(wb, log, 'Count Log');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
function buildCsv() {
  const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [['Rack','Shelf','Part ID','Description','System Bin','Physical Count','Line Type','Count Notes','Counter','Counted At'].join(',')];
  const at = new Date().toISOString();
  for (const r of computeRows()) lines.push([S.rack, r.p.bin, r.p.id, r.p.desc, r.p.loc, r.counted, r.uncounted ? 'not counted' : 'counted', r.notes, S.counter, at].map(q).join(','));
  for (const s of S.strays) lines.push([S.rack, '', s.part.id, s.part.desc, s.part.loc, s.qty, 'other rack', s.notes.join('; '), S.counter, at].map(q).join(','));
  for (const u of S.unlisted) lines.push([S.rack, u.bin, u.pn, u.desc, '', u.qty, 'not in system', u.notes, S.counter, at].map(q).join(','));
  return lines.join('\n');
}
async function saveFile(name, data, msgId = 'saveMsg') {
  const msg = $(msgId); msg.textContent = '';
  if (downloads) {
    try { await downloads.save({ filename: name, data }); msg.textContent = `Saved ${name}.`; return; }
    catch (e) { if (e && e.code === 'declined') { msg.textContent = 'Save cancelled.'; return; } if (e && e.code === 'rate_limited') { msg.textContent = 'A save prompt is already open. Try again in a moment.'; return; } }
  }
  try {
    const type = /\.xlsx$/.test(name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.jpg$/.test(name) ? 'image/jpeg' : 'text/csv';
    const file = new File([data], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: name }); msg.textContent = `Shared ${name}.`; return; } catch (e) { if (e && e.name === 'AbortError') { msg.textContent = 'Share cancelled.'; return; } }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    msg.textContent = `Downloading ${name}.`;
  } catch { msg.textContent = 'Saving is not available in this view.'; }
}
async function savePhotos() {
  for (const u of S.unlisted.filter(x => x.photo)) {
    const bin = atob(u.photo.split(',')[1]); const arr = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
    await saveFile(`${S.rack}_${u.bin || 'X'}_${(u.pn || 'unlisted').replace(/[^\w.-]+/g, '_')}.jpg`, arr);
  }
}

/* ---------------- voice in/out: Claude capabilities, else browser APIs ---------------- */
let micBase = '';
function speak(text) {
  if (!$('optSpeak').checked) return;
  if (tts) { tts.speak(text, { rate: 1.15 }).catch(() => {}); return; }
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
}
function browserDictation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
  let rec = null, live = false; const h = { p: [], f: [], s: [] };
  const emit = (k, v) => h[k].forEach(fn => fn(v));
  return {
    start() { return new Promise((res, rej) => {
      try { rec = new SR(); } catch (e) { rej({ code: 'unavailable' }); return; }
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      rec.onstart = () => { live = true; emit('s', { state: 'listening' }); res(); };
      rec.onresult = ev => { let interim = ''; for (let k = ev.resultIndex; k < ev.results.length; k++) { const r = ev.results[k]; if (r.isFinal) emit('f', { text: r[0].transcript.trim() }); else interim += r[0].transcript; } if (interim) emit('p', { text: interim.trim() }); };
      rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { live = false; emit('s', { state: 'idle', reason: 'not_granted' }); rej({ code: 'not_granted' }); } };
      rec.onend = () => { live = false; emit('s', { state: 'idle', reason: 'stopped' }); };
      try { rec.start(); } catch (e) { rej({ code: 'unavailable' }); }
    }); },
    stop() { try { rec && rec.stop(); } catch {} return Promise.resolve(); },
    active() { return live; },
    onPartial(fn) { h.p.push(fn); }, onFinal(fn) { h.f.push(fn); }, onState(fn) { h.s.push(fn); }
  };
}
function wireDictation(d) {
  dict = d; if (!d) return;
  $('micBtn').hidden = false;
  d.onPartial(({ text }) => { $('say').value = (micBase ? micBase + ' ' : '') + text; updatePreview(); });
  d.onFinal(({ text }) => {
    if (!S) return;
    micBase = ((micBase ? micBase + ' ' : '') + text).trim();
    // auto-add shelf commands and confident lines; anything doubtful waits in the box
    const forceAll = /\bnext\s*[.!]?\s*$/i.test(micBase);
    const keep = [];
    for (const u of Matcher.splitUtterances(micBase)) {
      const r = Matcher.parse(u, index, { bin: S.bin });
      if (forceAll || (r && (r.kind === 'location' || (r.status === 'matched' && r.qty != null)))) commitText(u); else keep.push(u);
    }
    micBase = keep.join('. '); $('say').value = micBase; autoGrow(); updatePreview();
  });
  d.onState(({ state, reason }) => {
    const live = state !== 'idle'; $('micBtn').classList.toggle('live', live); $('micBtn').setAttribute('aria-label', live ? 'Stop talking' : 'Start talking');
    if (state === 'idle' && reason === 'not_granted') $('micBtn').hidden = true;
  });
}
async function wireCaps() {
  const c = window.claude;
  if (c && c.use) {
    c.use('downloads').then(d => { downloads = d; }).catch(() => {});
    c.use('tts').then(t => { tts = t; }).catch(() => {});
    const d = await c.use('dictation').catch(() => null);
    if (d) { wireDictation(d); return; }
  }
  wireDictation(browserDictation());
}
$('micBtn').addEventListener('click', () => {
  if (!dict) return;
  if (dict.active()) { dict.stop().catch(() => {}); return; }
  micBase = $('say').value.trim();
  dict.start({ language: 'en-US' }).catch(e => { if (e && e.code === 'not_granted') $('micBtn').hidden = true; });
});

/* boot */
const saved = store.get(KEY);
if (saved && saved.parts && saved.counter && saved.v === 2) { S = saved; setIndex(); showCount(); } else renderSetup();
wireCaps();
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
})();
