const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

export function authorize(request, env) {
  if (!env.APP_ACCESS_TOKEN) return json({ error: 'Cloudflare 缺少 APP_ACCESS_TOKEN 配置。' }, 503);
  const supplied = request.headers.get('Authorization') || '';
  if (supplied !== `Bearer ${env.APP_ACCESS_TOKEN}`) return json({ error: '访问口令无效。' }, 401);
  return null;
}

export async function supabase(env, path, init = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Cloudflare 缺少 Supabase 环境变量。' }, 503);
  }
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (response.ok) return response;
  const message = await response.text();
  return json({ error: `Supabase 请求失败：${response.status} ${message}` }, response.status);
}
