// Cloudflare Worker — Help Desk API + static asset server
// POST /api/chat  → Anthropic Claude with prompt-cached rules context

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_OUTPUT_TOKENS = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_MESSAGE_LENGTH = 1000;
const KV_RULES_KEY = 'rules_text';
const KV_SCHEDULE_KEY = 'class_schedule';

const SYSTEM_INSTRUCTIONS = `You are a help desk assistant for the Greater Louisville Association of REALTORS. You answer questions from members and consumers about the association's MLS Rules & Regulations and upcoming classes.

Rules:
- Answer ONLY using the reference material provided below. Do not invent facts.
- Keep answers concise (2-4 sentences) unless the user explicitly asks for more detail.
- Quote specific rule numbers or class names when relevant.
- Do not answer questions unrelated to the association, its rules, or its classes.

When you cannot give a confident answer from the reference material, do NOT guess. Instead, direct the user to the appropriate contact below based on the nature of their question. Always include the phone number as a fallback.

Contact directory:
- General MLS questions (listings, data, system access): Support@LouisvilleRealtors.com
- MLS compliance and rule violations: Compliance@ApexMLS.com
- Classes, CE credits, and education: Education@LouisvilleRealtors.com
- Billing, dues, invoices, payments: Accounting@LouisvilleRealtors.com
- Membership applications, status, renewals: Membership@LouisvilleRealtors.com
- Phone (all departments): (502) 894-9860

When providing contact info, format it clearly — for example:
"I don't have that information in my reference material. For this question, please contact our Education department at Education@LouisvilleRealtors.com or call (502) 894-9860."

Pick the single most relevant email based on the question's topic. If unsure which department fits, default to Support@LouisvilleRealtors.com plus the phone number.`;

// In-isolate cache so we don't re-read KV on every request within the same isolate
let rulesCache = null;
let scheduleCache = null;

async function loadContext(env) {
  if (rulesCache === null) {
    rulesCache = (await env.HELPDESK_KV.get(KV_RULES_KEY)) || '';
  }
  if (scheduleCache === null) {
    scheduleCache = (await env.HELPDESK_KV.get(KV_SCHEDULE_KEY)) || '';
  }
  return { rules: rulesCache, schedule: scheduleCache };
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

  if (env.RATE_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const { rules, schedule } = await loadContext(env);
  if (!rules && !schedule) {
    return json({ error: 'knowledge base not loaded — run the ingest script' }, 503);
  }

  const referenceBlock =
    `<mls_rules>\n${rules || '(none loaded)'}\n</mls_rules>\n\n` +
    `<class_schedule>\n${schedule || '(none loaded)'}\n</class_schedule>`;

  const systemBlocks = [
    { type: 'text', text: SYSTEM_INSTRUCTIONS },
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
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      if (request.method === 'OPTIONS') return corsPreflight();
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      try {
        return await handleChat(request, env);
      } catch (e) {
        console.error('handleChat error', e);
        return json({ error: 'server error' }, 500);
      }
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  },
};
