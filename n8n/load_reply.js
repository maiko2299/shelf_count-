// Combine every page from ManagerPlus into one parts list for the app.
const g = $('Gatekeeper').first().json;
const parts = [];
let error = '';
for (const item of $input.all()) {
  const page = Array.isArray(item.json) ? item.json[0] : item.json;
  if (!page || !Array.isArray(page.data)) { error = (page && (page.message || page.error)) || 'ManagerPlus did not return inventory.'; continue; }
  for (const r of page.data) {
    parts.push({
      key: r.partKey, id: String(r.partId || '').trim(), type: String(r.partType || '').trim(),
      desc: String(r.description || '').replace(/\s+/g, ' ').trim(), status: r.status || '',
      loc: r.warehouseBin || '', onHand: Number(r.onHand) || 0, available: Number(r.available) || 0,
      cost: Number(r.currentCost) || 0,
    });
  }
}
if (!parts.length && error) return [{ json: { ok: false, error: String(error) } }];
const seen = new Set();
const unique = parts.filter((p) => { const k = p.key + '|' + p.loc; if (seen.has(k)) return false; seen.add(k); return true; });
return [{ json: { ok: true, warehouse: g.warehouse, loadedAt: new Date().toISOString(), parts: unique } }];
