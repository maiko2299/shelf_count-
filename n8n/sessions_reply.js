const rows = $input.all().map((i) => i.json).filter((r) => r && r.session_id);
rows.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
return [{ json: { ok: true, sessions: rows.map((r) => ({
  id: r.session_id, warehouseKey: r.warehouse_key, warehouseName: r.warehouse_name, area: r.area, counter: r.counter,
  startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, source: r.source, lineCount: r.line_count, notes: r.notes,
})) } }];
