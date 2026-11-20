const g = $('Gatekeeper').first().json;
return [{ json: { ok: true, sessionId: g.data.session.id, saved: (g.data.lines || []).filter((l) => l && l.id).map((l) => l.id), savedAt: new Date().toISOString() } }];
