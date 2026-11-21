// Build ManagerPlus filters for work-order parts used on the counted parts (8 parts per request; ManagerPlus caps at 500 rows).
const lines = $('Recon: get lines').all().map((i) => i.json).filter((r) => r && r.line_id);
const keys = [...new Set(lines.map((l) => l.part_key).filter((k) => k != null && k !== ''))];
const out = [];
for (let i = 0; i < keys.length; i += 8) out.push({ json: { filter: keys.slice(i, i + 8).map((k) => `partKey eq ${Number(k)}`).join(' or ') } });
return out.length ? out : [{ json: { filter: 'partKey eq -1' } }];
