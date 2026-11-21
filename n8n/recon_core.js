// Reconcile engine: turns every saved count line into a short list of actions.
// Pure function, no network: n8n feeds it the data and saves what it returns.
// In n8n this whole file is pasted into the "Recon: decide" Code node above the glue code.
function reconcile(input) {
  const { lines, sessions, inventories, woParts, workOrders, poLines, existing, warehouses, now } = input;
  const runAt = now || new Date().toISOString();
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const whName = (k) => (warehouses.find((w) => w.key === +k) || {}).name || `Warehouse ${k}`;
  const keyOfName = (n) => (warehouses.find((w) => w.name.toLowerCase() === String(n || '').trim().toLowerCase()) || {}).key;
  const money = (n) => Math.round((+n || 0) * 100) / 100;
  const day = (d) => String(d || '').slice(0, 10);
  const binOf = (loc) => String(loc || '').trim();
  const rackOf = (loc) => (binOf(loc).split(/[\\/]/).filter(Boolean)[0] || '').toUpperCase();

  // ---- current ManagerPlus stock: by part, by warehouse ----
  const inv = new Map(); // norm(partId) -> [{wk, key, id, desc, loc, onHand, cost}]
  const invByKey = new Map(); // `${wk}|${partKey}` -> row
  for (const [wk, parts] of Object.entries(inventories)) for (const p of parts) {
    const row = { wk: +wk, key: p.key, id: String(p.id).trim(), desc: p.desc, loc: binOf(p.loc), onHand: +p.onHand || 0, cost: +p.cost || 0 };
    const n = norm(row.id); if (!inv.has(n)) inv.set(n, []); inv.get(n).push(row);
    invByKey.set(`${row.wk}|${row.key}`, row);
  }
  const allIds = [...inv.keys()];

  // ---- usage and receipts after a date ----
  const woDate = new Map(workOrders.map((w) => [w.workOrderKey, w.dateCompleted || w.dateCreated]));
  const woNum = new Map(workOrders.map((w) => [w.workOrderKey, w.workOrderNumber]));
  function usedSince(partKey, wk, since) {
    const name = whName(wk).toLowerCase(); let qty = 0; const ev = [];
    for (const u of woParts) {
      if (u.partKey !== partKey || String(u.warehouseId || '').trim().toLowerCase() !== name) continue;
      const d = woDate.get(u.workOrderKey); if (!d || d <= since) continue;
      qty += +u.quantity || 0; ev.push(`WO ${woNum.get(u.workOrderKey) || u.workOrderKey} used ${u.quantity} on ${day(d)}`);
    }
    return { qty, ev };
  }
  function receivedSince(partId, wk, since) {
    const n = norm(partId); let qty = 0; const ev = [];
    for (const po of poLines) {
      if (+po.inventoryWarehouseKey !== +wk) continue;
      for (const l of po.purchaseOrderLines || []) {
        if (norm(l.item) !== n || !(+l.quantityReceived > 0)) continue;
        const d = l.dateModified || po.dateModified; if (!d || d <= since) continue;
        qty += +l.quantityReceived; ev.push(`PO ${po.purchaseOrderNumber} received ${l.quantityReceived} about ${day(d)}`);
      }
    }
    return { qty, ev };
  }

  // ---- keep only the newest count of each area (a recount replaces the old one) ----
  const latest = new Map();
  for (const s of sessions) { const k = `${s.warehouse_key}|${String(s.area).toUpperCase()}`; const cur = latest.get(k); if (!cur || s.started_at > cur.started_at) latest.set(k, s); }
  const live = new Set([...latest.values()].map((s) => s.session_id));
  const counted = lines.filter((l) => live.has(l.session_id) && l.qty_counted != null && !/^(cleared|removed|deleted)$/.test(l.match_status || ''));
  const countedAreas = new Map(); // wk -> Set(area)
  for (const s of latest.values()) { if (!countedAreas.has(s.warehouse_key)) countedAreas.set(s.warehouse_key, new Set()); countedAreas.get(s.warehouse_key).add(String(s.area).toUpperCase()); }

  // ---- fuzzy part-number match for lines that didn't match ManagerPlus ----
  const ALIKE = new Set(['A8','8A','O0','0O','I1','1I','L1','1L','S5','5S','B8','8B','Z2','2Z','G6','6G','T7','7T','Q0','0Q','D0','0D']);
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n);
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) { const sub = a[i - 1] === b[j - 1] ? 0 : ALIKE.has(a[i - 1] + b[j - 1]) ? 0.3 : 1; cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub); } [prev, cur] = [cur, prev]; }
    return prev[n];
  }
  function fuzzy(partId) {
    const n = norm(partId); if (n.length < 5) return null;
    let best = null, bestS = 0, second = 0;
    for (const id of allIds) {
      if (Math.abs(id.length - n.length) > 4) continue;
      const s = 1 - lev(n, id) / Math.max(n.length, id.length);
      if (s > bestS) { second = bestS; bestS = s; best = id; } else if (s > second) second = s;
    }
    return best && bestS >= 0.8 && bestS - second >= 0.05 ? { id: best, score: bestS } : null;
  }

  // ---- group counted lines by warehouse + ManagerPlus part ----
  const groups = new Map(); const newParts = [];
  for (const l of counted) {
    let partKey = l.part_key, sysRow = partKey != null ? invByKey.get(`${l.warehouse_key}|${partKey}`) : null;
    if (partKey == null) {
      const exact = inv.get(norm(l.part_id));
      const hit = exact ? { id: norm(l.part_id), score: 1 } : +l.qty_counted > 0 ? fuzzy(l.part_id) : null;
      if (!hit) { if (+l.qty_counted > 0) newParts.push(l); continue; }
      const cand = inv.get(hit.id); const here = cand.find((r) => r.wk === +l.warehouse_key) || cand[0];
      partKey = here.key; sysRow = cand.find((r) => r.wk === +l.warehouse_key) || null;
      l._fuzzy = hit.score < 1 ? { asCounted: l.part_id, system: here.id, score: hit.score } : null;
      if (!sysRow) l._otherWh = here;
    }
    const gk = `${l.warehouse_key}|${partKey}`;
    if (!groups.has(gk)) groups.set(gk, { wk: +l.warehouse_key, partKey, lines: [], sysRow: sysRow || invByKey.get(gk) || null });
    groups.get(gk).lines.push(l);
  }

  const actions = [];
  const push = (a) => actions.push({ status: 'open', run_at: runAt, ...a });
  const descOf = (g) => (g.sysRow && g.sysRow.desc) || g.lines[0].description || '';
  const idOf = (g) => (g.sysRow && g.sysRow.id) || g.lines.find((l) => l.part_key != null)?.part_id || g.lines[0].part_id;

  // ---- per part: where it was found, how many, and what to do ----
  const net = []; // for transfers: {g, varAdj}
  for (const g of groups.values()) {
    const L = g.lines; const pid = idOf(g); const desc = descOf(g);
    const sysAtCount = L.map((l) => l.system_on_hand).find((v) => v != null);
    const countedQty = L.reduce((n, l) => n + (+l.qty_counted || 0), 0);
    const countedAt = L.map((l) => l.counted_at).sort().pop();
    const firstAt = L.map((l) => l.counted_at).sort()[0];
    const cost = +((g.sysRow && g.sysRow.cost) || L.find((l) => l.unit_cost)?.unit_cost || 0);
    const sysBin = binOf((g.sysRow && g.sysRow.loc) || L.find((l) => l.system_bin)?.system_bin || '');
    const wn = whName(g.wk);

    // part-number mix-ups
    for (const l of L) if (l._fuzzy) push({ action_id: `fix-id|${g.wk}|${norm(l.part_id)}`, type: 'part_id_fix', part_id: l._fuzzy.system, part_key: g.partKey, description: desc, warehouse_key: g.wk, warehouse_name: wn, from_loc: l.part_id, to_loc: l._fuzzy.system, qty: +l.qty_counted, value: money(+l.qty_counted * cost), counted_at: l.counted_at,
      summary: `Counted as "${l.part_id}", almost certainly ${l._fuzzy.system} (${Math.round(l._fuzzy.score * 100)}% match). Fix the label or the part number.`, detail: JSON.stringify({ found: l.found_bin }) });

    // where it sits vs where ManagerPlus says
    const foundBins = {}; for (const l of L) if (+l.qty_counted > 0) { const b = binOf(l.found_bin) || wn; foundBins[b] = (foundBins[b] || 0) + +l.qty_counted; }
    const fb = Object.keys(foundBins);
    const noteMove = L.map((l) => (String(l.notes || '').match(/found on (?:shelf )?([A-Z0-9\\]+)\s*\((?:system:?\s*)?([A-Z0-9\\]+)\)/i))).find(Boolean);
    if (!sysBin && fb.length && fb.some((b) => /\\/.test(b))) {
      push({ action_id: `assign|${g.wk}|${g.partKey}`, type: 'assign_bin', part_id: pid, part_key: g.partKey, description: desc, warehouse_key: g.wk, warehouse_name: wn, from_loc: '(no bin)', to_loc: fb.filter((b) => /\\/.test(b)).join(', '), qty: countedQty, value: money(countedQty * cost), counted_at: countedAt,
        summary: `No bin in ManagerPlus. Found on ${fb.join(', ')}. Assign the bin.`, detail: JSON.stringify({ foundBins }) });
    } else if (sysBin && fb.length && !fb.some((b) => b.toUpperCase() === sysBin.toUpperCase())) {
      const to = fb.sort((a, b) => foundBins[b] - foundBins[a])[0];
      push({ action_id: `move|${g.wk}|${g.partKey}`, type: 'bin_move', part_id: pid, part_key: g.partKey, description: desc, warehouse_key: g.wk, warehouse_name: wn, from_loc: sysBin, to_loc: to, qty: countedQty, value: money(countedQty * cost), counted_at: countedAt,
        summary: `ManagerPlus says ${sysBin}; found on ${fb.map((b) => `${b} ×${foundBins[b]}`).join(', ')}. Move it back or update the bin.`, detail: JSON.stringify({ foundBins }) });
    } else if (noteMove && sysBin) {
      const to = /\\/.test(noteMove[1]) ? noteMove[1] : `\\${rackOf(sysBin)}\\${noteMove[1].toUpperCase()}`;
      if (to.toUpperCase() !== sysBin.toUpperCase()) push({ action_id: `move|${g.wk}|${g.partKey}`, type: 'bin_move', part_id: pid, part_key: g.partKey, description: desc, warehouse_key: g.wk, warehouse_name: wn, from_loc: sysBin, to_loc: to, qty: countedQty, value: money(countedQty * cost), counted_at: countedAt,
        summary: `Count note says found on ${to}; ManagerPlus says ${sysBin}.`, detail: JSON.stringify({ note: noteMove[0] }) });
    }

    if (sysAtCount == null && !g.sysRow) {
      // counted here but this warehouse has no record of it: the system has it in another warehouse
      const other = L.find((l) => l._otherWh)?._otherWh;
      if (other && countedQty > 0) net.push({ g, pid, desc, cost, wn, countedAt, firstAt, varAdj: countedQty, sysBin, onlyElsewhere: other });
      continue;
    }
    const variance = countedQty - (sysAtCount ?? 0);
    const used = usedSince(g.partKey, g.wk, firstAt), recv = receivedSince(pid, g.wk, firstAt);
    const current = g.sysRow ? g.sysRow.onHand : 0;
    const target = Math.max(0, countedQty - used.qty + recv.qty);
    let adjust = target - current;
    let late = false;
    if (adjust !== 0 && used.qty > 0 && current === countedQty && adjust === -used.qty) { late = true; adjust = 0; }
    net.push({ g, pid, desc, cost, wn, countedAt, firstAt, variance, varAdj: adjust, used, recv, current, target, sysAtCount, countedQty, sysBin, late });
  }

  // ---- transfers: extra in one warehouse, short in another ----
  const byPart = new Map(); for (const n of net) { const k = norm(n.pid); if (!byPart.has(k)) byPart.set(k, []); byPart.get(k).push(n); }
  for (const list of byPart.values()) {
    const overs = list.filter((n) => n.varAdj > 0), shorts = list.filter((n) => n.varAdj < 0);
    for (const s of shorts) for (const o of overs) {
      if (o.g.wk === s.g.wk) continue;
      const q = Math.min(-s.varAdj, o.varAdj); if (q <= 0) continue;
      push({ action_id: `transfer|${s.g.partKey}|${o.g.wk}>${s.g.wk}`, type: 'transfer', part_id: s.pid, part_key: s.g.partKey, description: s.desc, warehouse_key: o.g.wk, warehouse_name: o.wn, from_loc: `${o.wn}${o.sysBin ? ' ' + o.sysBin : ''}`, to_loc: `${s.wn}${s.sysBin ? ' ' + s.sysBin : ''}`, qty: q, value: money(q * s.cost), counted_at: s.countedAt,
        summary: `${q} extra at ${o.wn} (counted ${day(o.countedAt)}) and ${q} short at ${s.wn} (counted ${day(s.countedAt)}). Record a transfer from ${o.wn} to ${s.wn} instead of two adjustments.`, detail: JSON.stringify({ from: { wh: o.wn, counted: o.countedQty, system: o.sysAtCount }, to: { wh: s.wn, counted: s.countedQty, system: s.sysAtCount } }) });
      s.varAdj += q; o.varAdj -= q;
    }
  }

  // ---- what's left: look elsewhere, or adjust the quantity ----
  for (const n of net) {
    const { g } = n;
    if (n.onlyElsewhere) {
      if (n.varAdj > 0) push({ action_id: `wrongwh|${g.wk}|${g.partKey}`, type: 'transfer', part_id: n.pid, part_key: g.partKey, description: n.desc, warehouse_key: n.onlyElsewhere.wk, warehouse_name: whName(n.onlyElsewhere.wk), from_loc: `${whName(n.onlyElsewhere.wk)} ${n.onlyElsewhere.loc}`.trim(), to_loc: n.wn, qty: n.varAdj, value: money(n.varAdj * n.cost), counted_at: n.countedAt,
        summary: `Found ${n.varAdj} at ${n.wn}, but ManagerPlus only has it at ${whName(n.onlyElsewhere.wk)} (on hand ${n.onlyElsewhere.onHand}). Record a transfer.`, detail: '{}' });
      continue;
    }
    const ev = [...n.used.ev, ...n.recv.ev];
    if (n.late) { push({ action_id: `late|${g.wk}|${g.partKey}`, type: 'resolved', part_id: n.pid, part_key: g.partKey, description: n.desc, warehouse_key: g.wk, warehouse_name: n.wn, from_loc: n.sysBin, to_loc: '', qty: n.variance, value: 0, counted_at: n.countedAt,
        summary: `Counted ${n.countedQty} vs ${n.sysAtCount} in system; the work order entered after the count already brought ManagerPlus to ${n.current}. Nothing to adjust.`, detail: JSON.stringify({ evidence: ev }) }); continue; }
    if (n.varAdj === 0) continue;
    if (n.varAdj < 0) {
      const elsewhere = (inv.get(norm(n.pid)) || []).filter((r) => r.onHand > 0 && !(r.wk === g.wk && r.loc.toUpperCase() === n.sysBin.toUpperCase()) && !(countedAreas.get(r.wk) || new Set()).has(rackOf(r.loc) || whName(r.wk).toUpperCase()));
      if (elsewhere.length) push({ action_id: `look|${g.wk}|${g.partKey}`, type: 'check_elsewhere', part_id: n.pid, part_key: g.partKey, description: n.desc, warehouse_key: g.wk, warehouse_name: n.wn, from_loc: elsewhere.map((r) => `${whName(r.wk)} ${r.loc} ×${r.onHand}`.trim()).join('; '), to_loc: `${n.wn} ${n.sysBin}`.trim(), qty: -n.varAdj, value: money(-n.varAdj * n.cost), counted_at: n.countedAt,
        summary: `${-n.varAdj} short at ${n.wn}. ManagerPlus shows stock at ${elsewhere.map((r) => `${whName(r.wk)} ${r.loc}`.trim()).join(', ')}, which hasn't been counted yet. Look there before adjusting.`, detail: JSON.stringify({ evidence: ev }) });
    }
    push({ action_id: `adjust|${g.wk}|${g.partKey}`, type: 'adjust_qty', part_id: n.pid, part_key: g.partKey, description: n.desc, warehouse_key: g.wk, warehouse_name: n.wn, from_loc: String(n.current), to_loc: String(n.current + n.varAdj), qty: n.varAdj, value: money(n.varAdj * n.cost), counted_at: n.countedAt,
      summary: `Counted ${n.countedQty} on ${day(n.countedAt)} (system then ${n.sysAtCount})${n.used.qty ? `, ${n.used.qty} used since` : ''}${n.recv.qty ? `, ${n.recv.qty} received since` : ''}. ManagerPlus now ${n.current}; should be ${n.current + n.varAdj}. Adjust ${n.varAdj > 0 ? '+' : ''}${n.varAdj}.${n.used.qty ? ' If a work order below was pulled before the count date, leave it out.' : ''}`,
      detail: JSON.stringify({ evidence: ev, counted: n.countedQty, systemAtCount: n.sysAtCount, usedSince: n.used.qty, receivedSince: n.recv.qty, currentOnHand: n.current }) });
  }

  for (const l of newParts) push({ action_id: `new|${l.warehouse_key}|${norm(l.part_id)}`, type: 'new_part', part_id: l.part_id, part_key: null, description: l.description || '', warehouse_key: +l.warehouse_key, warehouse_name: whName(l.warehouse_key), from_loc: '', to_loc: l.found_bin || '', qty: +l.qty_counted, value: 0, counted_at: l.counted_at,
    summary: `On the shelf but not in ManagerPlus under any similar number. Add it as a part, or find its real number.`, detail: JSON.stringify({ notes: l.notes || '' }) });

  // ---- keep decisions people already made; close actions that no longer apply ----
  const COLS = ['action_id', 'type', 'status', 'part_id', 'part_key', 'description', 'warehouse_key', 'warehouse_name', 'from_loc', 'to_loc', 'qty', 'value', 'counted_at', 'summary', 'detail', 'run_at', 'updated_by', 'updated_at'];
  const clean = (a) => Object.fromEntries(COLS.map((c) => [c, a[c] === undefined ? null : a[c]]));
  const open = actions.filter((a) => a.type !== 'resolved');
  push({ action_id: 'run|last', type: 'run', part_id: '', part_key: null, description: '', warehouse_key: null, warehouse_name: '', from_loc: '', to_loc: '', qty: open.length, value: money(open.reduce((n, a) => n + Math.abs(a.value || 0), 0)), counted_at: null,
    summary: `Checked ${counted.length} counted lines from ${live.size} counts against ManagerPlus stock in ${Object.keys(inventories).length} warehouses, ${woParts.length} work-order part lines and ${poLines.length} purchase orders.`, detail: '{}' });
  const prev = new Map(existing.map((e) => [e.action_id, e]));
  const out = actions.map((a) => { const p = prev.get(a.action_id); return p && p.status && p.status !== 'open' && p.status !== 'cleared' ? { ...a, status: p.status, updated_by: p.updated_by, updated_at: p.updated_at } : a; });
  const ids = new Set(out.map((a) => a.action_id));
  for (const e of existing) if (!ids.has(e.action_id) && e.status === 'open') out.push({ ...e, status: 'cleared', run_at: runAt, summary: String(e.summary || '').replace(/ \(No longer showing up.*$/, '') + ' (No longer showing up: ManagerPlus or a newer count now agrees.)' });
  return out.map(clean);
}
if (typeof module !== 'undefined') module.exports = { reconcile };
