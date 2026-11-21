const g = $input.first().json;
return [{ json: { action_id: String(g.data.actionId), status: g.data.status, updated_by: g.user, updated_at: new Date().toISOString() } }];
