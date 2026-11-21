// Every work order created or completed since the first count (paged in the next step), so each part use gets a date.
// (Filtering by a list of keys hits ManagerPlus's 100-node OData limit.)
const lines = $('Recon: get lines').all().map((i) => i.json).filter((r) => r && r.counted_at);
const first = lines.map((l) => String(l.counted_at)).sort()[0] || new Date().toISOString();
const since = first.slice(0, 10);
return [{ json: { filter: `dateCompleted ge ${since} or dateCreated ge ${since}` } }];
