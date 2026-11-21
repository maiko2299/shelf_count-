const acts = $('Recon: decide').all().map((i) => i.json);
return [{ json: { ok: true, ranAt: new Date().toISOString(), actions: acts } }];
