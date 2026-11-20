// One data-table row per counted line. line_id comes from the phone, so re-sending a line updates it instead of duplicating it.
const g = $('Gatekeeper').first().json;
const s = g.data.session;
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const iso = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString() : new Date().toISOString(); };
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
return g.data.lines.filter((l) => l && l.id).map((l) => ({ json: {
  line_id: str(l.id, 120),
  session_id: str(s.id, 80),
  warehouse_key: Number(s.warehouseKey),
  area: str(l.area || s.area, 60),
  part_key: num(l.partKey),
  part_id: str(l.partId, 120),
  description: str(l.desc, 300),
  system_bin: str(l.systemBin, 60),
  found_bin: str(l.foundBin, 60),
  qty_counted: num(l.qty),
  system_on_hand: num(l.systemOnHand),
  unit_cost: num(l.cost),
  counted_at: iso(l.countedAt),
  counter: str(l.counter || g.user, 60),
  heard: str(l.heard, 300),
  match_status: str(l.status, 30),
  confidence: num(l.confidence),
  unlisted: !!l.unlisted,
  notes: str(l.notes, 1000),
  source: str(l.source || s.source || 'app', 20),
} }));
