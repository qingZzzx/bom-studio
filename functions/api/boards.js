import { authorize, json, supabase } from '../_shared/supabase.js';

export async function onRequestGet({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;
  return supabase(env, '/rest/v1/project_boards?select=id,name,imported_at,sheet_names,projects&order=imported_at.desc');
}

export async function onRequestPut({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;
  let board;
  try { board = await request.json(); } catch { return json({ error: '请求内容不是有效 JSON。' }, 400); }
  if (!board?.id || !board?.name || !Array.isArray(board?.projects)) return json({ error: '资料库内容不完整。' }, 400);
  const payload = {
    id: String(board.id).slice(0, 500),
    name: String(board.name).slice(0, 500),
    imported_at: board.importedAt || new Date().toISOString(),
    sheet_names: Array.isArray(board.sheetNames) ? board.sheetNames : [],
    projects: board.projects,
  };
  const response = await supabase(env, '/rest/v1/project_boards?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return response;
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: '缺少资料库 ID。' }, 400);
  const response = await supabase(env, `/rest/v1/project_boards?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  if (!response.ok) return response;
  return json({ ok: true });
}
