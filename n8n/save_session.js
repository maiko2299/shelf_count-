// One row for the count session (insert the first time, update after).
const g = $input.first().json;
const s = g.data.session;
const iso = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString() : null; };
const wh = { key: Number(s.warehouseKey), name: String(s.warehouseName || '') };
return [{ json: {
  session_id: String(s.id).slice(0, 80),
  warehouse_key: wh.key,
  warehouse_name: wh.name.slice(0, 120),
  area: String(s.area || '').slice(0, 60),
  counter: String(s.counter || g.user).slice(0, 60),
  started_at: iso(s.startedAt) || new Date().toISOString(),
  finished_at: iso(s.finishedAt),
  status: s.finishedAt ? 'finished' : 'open',
  source: String(s.source || 'app').slice(0, 20),
  line_count: Number(s.lineCount) || 0,
  notes: String(s.notes || '').slice(0, 2000),
} }];
