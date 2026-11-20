// Lines for one session. Counters get their own counts back; only managers get system quantities.
const g = $('Gatekeeper').first().json;
const rows = $input.all().map((i) => i.json).filter((r) => r && r.line_id);
rows.sort((a, b) => String(a.counted_at).localeCompare(String(b.counted_at)));
return [{ json: { ok: true, sessionId: g.data.sessionId, lines: rows.map((r) => {
  const l = { id: r.line_id, area: r.area, partKey: r.part_key, partId: r.part_id, desc: r.description, systemBin: r.system_bin,
    foundBin: r.found_bin, qty: r.qty_counted, cost: r.unit_cost, countedAt: r.counted_at, counter: r.counter, heard: r.heard,
    status: r.match_status, confidence: r.confidence, unlisted: r.unlisted, notes: r.notes, source: r.source };
  if (g.manager) l.systemOnHand = r.system_on_hand;
  return l;
}) } }];
