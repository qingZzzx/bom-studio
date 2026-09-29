import { authorize, json, supabase } from '../_shared/supabase.js';

export async function onRequestGet({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;
  return supabase(env, '/rest/v1/generation_history?select=id,created_at,model,template,matched,pending&order=created_at.desc&limit=30');
}

export async function onRequestPost({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;
  let record;
  try { record = await request.json(); } catch { return json({ error: '请求内容不是有效 JSON。' }, 400); }
  const payload = {
    model: String(record?.model || '').slice(0, 200),
    template: String(record?.template || '').slice(0, 500),
    matched: Number.parseInt(record?.matched, 10) || 0,
    pending: Number.parseInt(record?.pending, 10) || 0,
  };
  const response = await supabase(env, '/rest/v1/generation_history', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return response;
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;
  const response = await supabase(env, '/rest/v1/generation_history?id=not.is.null', {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  if (!response.ok) return response;
  return json({ ok: true });
}
