const acts = $input.all().map((i) => i.json).filter((r) => r && r.action_id);
return [{ json: { ok: true, actions: acts } }];
