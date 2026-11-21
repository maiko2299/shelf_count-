const g = $('Gatekeeper').first().json;
return [{ json: { ok: true, actionId: g.data.actionId, status: g.data.status } }];
