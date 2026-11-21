// One item per warehouse: {wk, parts}
const wk = $('Recon: each warehouse').first(1).json.key;
const parts = [];
for (const item of $input.all()) {
  const page = Array.isArray(item.json) ? item.json[0] : item.json;
  for (const r of (page && page.data) || []) parts.push({ key: r.partKey, id: String(r.partId || '').trim(), desc: String(r.description || '').trim(), loc: r.warehouseBin || '', onHand: Number(r.onHand) || 0, cost: Number(r.currentCost) || 0 });
}
return [{ json: { wk, parts } }];
