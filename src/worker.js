// Cloudflare Worker — Help Desk API + static asset server
// POST /api/chat  → Anthropic Claude with prompt-cached rules context

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_OUTPUT_TOKENS = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_MESSAGE_LENGTH = 1000;
const KV_RULES_KEY = 'rules_text';
const KV_SCHEDULE_KEY = 'class_schedule';
const KV_CONTACTS_KEY = 'contacts_directory';
const CACHE_TTL_MS = 60_000;

const SYSTEM_BASE = `You are a help desk assistant. You answer questions using ONLY the reference material provided below.

Rules:
- Answer ONLY using the reference material provided below. Do not invent facts.
- Keep answers concise (2-4 sentences) unless the user explicitly asks for more detail.
- Quote specific rule numbers or class names when relevant.
- Do not answer questions unrelated to the reference material.

When you cannot give a confident answer from the reference material, do NOT guess. Instead, direct the user to the most relevant contact listed in the contact directory below. Always include a phone number as a fallback when one is provided.

Pick the single most relevant contact based on the question's topic. If unsure, default to the first entry plus any phone number listed.`;

// In-isolate cache with TTL so KV updates propagate within CACHE_TTL_MS.
const contextCache = { value: null, loadedAt: 0 };

async function loadContext(env) {
  const now = Date.now();
  if (contextCache.value && now - contextCache.loadedAt < CACHE_TTL_MS) {
    return contextCache.value;
  }
  const [rules, schedule, contacts] = await Promise.all([
    env.HELPDESK_KV.get(KV_RULES_KEY),
    env.HELPDESK_KV.get(KV_SCHEDULE_KEY),
    env.HELPDESK_KV.get(KV_CONTACTS_KEY),
  ]);
  contextCache.value = {
    rules: rules || '',
    schedule: schedule || '',
    contacts: contacts || '',
  };
  contextCache.loadedAt = now;
  return contextCache.value;
}

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const history = Array.isArray(body.history) ? body.history : [];

  if (!message) return json({ error: 'message required' }, 400);
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: 'message too long' }, 400);
  }

  if (env.GLOBAL_RATE_LIMITER) {
    const { success } = await env.GLOBAL_RATE_LIMITER.limit({ key: 'global' });
    if (!success) return json({ error: 'Service is busy. Please try again shortly.' }, 429);
  }

  if (env.RATE_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const { rules, schedule, contacts } = await loadContext(env);
  if (!rules && !schedule) {
    return json({ error: 'knowledge base not loaded — run the ingest script' }, 503);
  }

  const referenceBlock =
    `<reference_material>\n${rules || '(none loaded)'}\n</reference_material>\n\n` +
    `<class_schedule>\n${schedule || '(none loaded)'}\n</class_schedule>\n\n` +
    `<contact_directory>\n${contacts || '(none loaded)'}\n</contact_directory>`;

  const systemBlocks = [
    { type: 'text', text: SYSTEM_BASE },
    {
      type: 'text',
      text: referenceBlock,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const messages = history
    .slice(-MAX_HISTORY_TURNS)
    .filter((m) => m && typeof m.text === 'string')
    .map((m) => ({
      role: m.role === 'bot' ? 'assistant' : 'user',
      content: m.text.slice(0, MAX_MESSAGE_LENGTH),
    }));
  messages.push({ role: 'user', content: message });

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
      messages,
    }),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error('Anthropic API error', apiRes.status, errText);
    return json({ error: 'AI request failed' }, 502);
  }

  const data = await apiRes.json();
  const reply = data.content?.[0]?.text?.trim() || '(no response)';

  return json({
    reply,
    usage: data.usage,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function getAllowedOrigins(env) {
  const raw = env.ALLOWED_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function withCors(response, request, env) {
  const origin = request.headers.get('origin');
  const allowed = getAllowedOrigins(env);
  const headers = new Headers(response.headers);
  headers.append('vary', 'Origin');
  if (origin && allowed.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
  }
  return new Response(response.body, { status: response.status, headers });
}

function corsPreflight(request, env) {
  const origin = request.headers.get('origin');
  const allowed = getAllowedOrigins(env);
  const headers = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
  if (origin && allowed.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      if (request.method === 'OPTIONS') return corsPreflight(request, env);
      if (request.method !== 'POST') return withCors(json({ error: 'POST only' }, 405), request, env);
      try {
        const res = await handleChat(request, env);
        return withCors(res, request, env);
      } catch (e) {
        console.error('handleChat error', e);
        return withCors(json({ error: 'server error' }, 500), request, env);
      }
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  },
};
