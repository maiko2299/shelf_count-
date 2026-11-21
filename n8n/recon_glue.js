
// ---------------- n8n glue ----------------
const g = $('Gatekeeper').first().json;
const rows = (name) => $(name).all().map((i) => i.json);
const inventories = {};
for (const w of rows('Recon: each warehouse')) if (w && w.wk != null) inventories[w.wk] = w.parts || [];
const sessions = rows('Recon: get sessions').filter((s) => s && s.session_id && s.source !== 'test');
const lines = rows('Recon: get lines').filter((l) => l && l.line_id && l.source !== 'test');
const flat = (name) => rows(name).flatMap((r) => (Array.isArray(r) ? r : r && Array.isArray(r.data) ? r.data : [r])).filter((r) => r && typeof r === 'object' && Object.keys(r).length);
const woParts = flat('Recon: work-order parts').filter((r) => r.workOrderKey);
const workOrders = flat('Recon: work orders').filter((r) => r.workOrderKey);
const poLines = flat('Recon: purchase orders').filter((r) => r.purchaseOrderKey);
const existing = rows('Recon: get actions').filter((r) => r && r.action_id);
const actions = reconcile({ lines, sessions, inventories, woParts, workOrders, poLines, existing, warehouses: g.warehouses });
return actions.map((a) => ({ json: a }));
