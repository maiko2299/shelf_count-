// Purchase orders for the counted parts created from 6 months before the first count on.
const lines = $('Recon: get lines').all().map((i) => i.json).filter((r) => r && r.line_id && r.part_key != null);
const ids = [...new Set(lines.map((l) => String(l.part_id || '').trim()).filter(Boolean))];
const first = lines.map((l) => String(l.counted_at || '')).filter(Boolean).sort()[0] || new Date().toISOString();
const since = new Date(new Date(first).getTime() - 180 * 864e5).toISOString().slice(0, 10);
const q = (s) => s.replace(/'/g, "''");
const out = [];
for (let i = 0; i < ids.length; i += 10) out.push({ json: { filter: `purchaseOrderLines/any(l: ${ids.slice(i, i + 10).map((id) => `contains(l/item, '${q(id)}')`).join(' or ')}) and dateCreated ge ${since}` } });
return out.length ? out : [{ json: { filter: "purchaseOrderNumber eq '-1'" } }];
