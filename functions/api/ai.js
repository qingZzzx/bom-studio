import { authorize, json } from '../_shared/supabase.js';

const MAX_BATCH_ROWS = 60;
const MAX_FIELDS = 400;
const AI_TIMEOUT_MS = 120000;

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';
const DEFAULT_MAX_TOKENS = 8192;

const SYSTEM_PROMPT = [
  '你是电视机硬件 BOM 工程师，负责把「基础 BOM」派生成「新项目 BOM 创建表」。',
  '输入包含：项目资料库中该项目的全部字段，以及 BOM 模板的物料行（序号、物料名称、基础BOM料号、单机用量）。',
  '你的任务：为每一行模板物料判断在新项目中应当使用的料号，并说明与基础 BOM 的差别。',
  '',
  '硬性规则：',
  '1. 派生料号只能来自输入提供的字段值，禁止编造、拼接或推测任何料号。',
  '2. 无法从输入字段确定的行，derived 返回 null，confidence 返回 0，并在 reason 说明缺什么。',
  '3. 使用 sourceField 指明取值来自哪个字段名；没有取到字段时返回 null。',
  '4. changed 表示派生料号与基础BOM料号不同（不同为 true，相同为 false，无法判断为 null）。',
  '5. confidence 取 0 到 1 之间的小数，表示该行匹配的把握程度。',
  '6. reason 用简短中文说明依据，不超过 30 字。',
  '7. 除逐行判断外，还要找出模板没有覆盖的差异：如果项目资料库里有某个物料字段（取值是料号），而模板的物料行里没有任何一行代表该物料，就把它放进 extraRows。',
  '8. extraRows 里的料号同样只能取自输入字段，禁止编造；没有这类差异就返回空数组。',
  '',
  '只输出 json，不要输出解释性文字或 Markdown 代码块。输出格式：',
  '{"rows":[{"index":数字,"sourceField":字符串或null,"derived":字符串或null,"changed":布尔或null,"confidence":数字,"reason":"简短中文理由"}],"extraRows":[{"name":"物料名称","derived":"料号","sourceField":"字段名","qty":"用量","reason":"简短中文理由"}],"summary":"整体说明"}',
  'rows 必须覆盖输入的每一行，index 与输入行的 index 一致，顺序保持一致。',
].join('\n');

function normalizeRows(rows) {
  return rows.slice(0, MAX_BATCH_ROWS).map((row, fallbackIndex) => ({
    index: Number.isFinite(Number(row?.index)) ? Number(row.index) : fallbackIndex,
    name: String(row?.name ?? '').slice(0, 200),
    base: String(row?.base ?? '').slice(0, 200),
    qty: String(row?.qty ?? '').slice(0, 50),
  }));
}

function normalizeFields(fields) {
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(fields || {})) {
    if (count >= MAX_FIELDS) break;
    if (key === '_row') continue;
    const text = String(value ?? '').trim();
    if (!text) continue;
    out[String(key).slice(0, 120)] = text.slice(0, 200);
    count += 1;
  }
  return out;
}

function extractJson(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(withoutFence.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

function contentOf(text) {
  try {
    const envelope = JSON.parse(text);
    const content = envelope?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

async function callModel({ base, key, model, maxTokens, messages, jsonMode }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const payload = { model, temperature: 0, messages };
    if (jsonMode) payload.response_format = { type: 'json_object' };
    if (maxTokens) payload.max_tokens = maxTokens;
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `AI 服务超时（${AI_TIMEOUT_MS / 1000} 秒）` : error?.message;
    return { ok: false, status: 0, text: String(reason || '网络错误'), networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = authorize(request, env);
  if (denied) return denied;
  if (!env.AI_API_KEY) return json({ error: 'Cloudflare 缺少 AI_API_KEY 配置。' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求内容不是有效 JSON。' }, 400); }

  const task = String(body?.task || '');
  if (task !== 'derive-bom') return json({ error: `不支持的 AI 任务：${task || '未指定'}` }, 400);

  const payload = body?.payload || {};
  const incomingRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!incomingRows.length) return json({ error: '缺少待派生的模板物料行。' }, 400);
  if (incomingRows.length > MAX_BATCH_ROWS) {
    return json({ error: `单次最多处理 ${MAX_BATCH_ROWS} 行，请分批提交。` }, 400);
  }

  const rows = normalizeRows(incomingRows);
  const fields = normalizeFields(payload.fields);
  if (!Object.keys(fields).length) return json({ error: '缺少项目资料库字段。' }, 400);

  const context = {
    model: String(payload?.context?.model ?? '').slice(0, 120),
    country: String(payload?.context?.country ?? '').slice(0, 120),
    board: String(payload?.context?.board ?? '').slice(0, 200),
    instruction: String(payload?.context?.instruction ?? '').slice(0, 1000),
  };

  const base = String(env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = String(env.AI_MODEL || DEFAULT_MODEL);
  const maxTokens = Number.parseInt(env.AI_MAX_TOKENS, 10) || DEFAULT_MAX_TOKENS;
  const userContent = JSON.stringify({ context, projectFields: fields, templateRows: rows });
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const attempts = [];
  let attempt = await callModel({ base, key: env.AI_API_KEY, model, maxTokens, messages, jsonMode: true });
  attempts.push({ jsonMode: true, status: attempt.status });

  // 部分兼容实现不支持 response_format，或返回内容被截断／为空，这里降级重试一次。
  let parsed = attempt.ok ? extractJson(contentOf(attempt.text)) : null;
  let degraded = false;
  if (!parsed) {
    const unsupportedJsonMode = attempt.ok === false && /response_format/i.test(attempt.text);
    const retryable = unsupportedJsonMode || attempt.ok || attempt.networkError === true;
    if (retryable) {
      degraded = true;
      const retryMessages = unsupportedJsonMode
        ? messages
        : [{ role: 'system', content: `${SYSTEM_PROMPT}\n上一次返回无法解析，请务必只返回完整、可解析的 json 对象，不要截断。` }, { role: 'user', content: userContent }];
      attempt = await callModel({ base, key: env.AI_API_KEY, model, maxTokens: Math.min(maxTokens, DEFAULT_MAX_TOKENS), messages: retryMessages, jsonMode: !unsupportedJsonMode });
      attempts.push({ jsonMode: !unsupportedJsonMode, status: attempt.status });
      parsed = attempt.ok ? extractJson(contentOf(attempt.text)) : null;
    }
  }

  if (!attempt.ok) {
    const detail = attempt.networkError ? attempt.text : `AI 服务返回 ${attempt.status}：${String(attempt.text).slice(0, 500)}`;
    return json({ error: `AI 请求失败：${detail}` }, 502);
  }
  if (!parsed || !Array.isArray(parsed.rows)) {
    return json({ error: 'AI 返回内容无法解析为逐行派生结果。', attempts }, 502);
  }

  let envelope = {};
  try { envelope = JSON.parse(attempt.text); } catch { envelope = {}; }
  const finishReason = envelope?.choices?.[0]?.finish_reason || null;

  return json({
    ok: true,
    model: envelope?.model || model,
    usage: envelope?.usage || null,
    finishReason,
    truncated: finishReason === 'length',
    degraded,
    attempts,
    rows: parsed.rows,
    extraRows: Array.isArray(parsed.extraRows) ? parsed.extraRows.slice(0, 100).map(item => ({
      name: String(item?.name ?? '').slice(0, 200),
      derived: item?.derived ? String(item.derived).slice(0, 200) : '',
      sourceField: item?.sourceField ? String(item.sourceField).slice(0, 120) : '',
      qty: String(item?.qty ?? '').slice(0, 50),
      reason: String(item?.reason ?? '').slice(0, 200),
    })).filter(item => item.name && item.derived) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 2000) : '',
  });
}
