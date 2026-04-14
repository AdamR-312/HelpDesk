# HelpDesk

AI help-desk widget + Cloudflare Worker backend. Answers questions from a rules PDF using Claude with prompt caching.

## Structure

```
public/              Static site (embeddable chat widget demo)
  index.html
  widget.js
src/
  worker.js          Cloudflare Worker: /api/chat + static asset serving
scripts/
  extract-pdf.mjs    PDF → text extractor (Node, pdf-parse)
  sample-rules.txt   Placeholder rules content for smoke testing
  sample-schedule.txt
wrangler.toml        Cloudflare config (KV + rate limit)
package.json
.dev.vars.example    Template for local secrets
```

## Prerequisites

- Node.js 18+
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- An [Anthropic API key](https://console.anthropic.com/)

## First-time setup

```bash
npm install
npx wrangler login
```

Create the KV namespace and paste its id into `wrangler.toml`:

```bash
npx wrangler kv namespace create HELPDESK_KV
# → copy the printed id into wrangler.toml [[kv_namespaces]] id = "..."
```

Create `.dev.vars` for local development:

```bash
cp .dev.vars.example .dev.vars
# then edit .dev.vars and paste your Anthropic API key
```

## Load content into KV

### Option A — use the sample placeholder content (fastest smoke test)

```bash
npm run upload-samples-local
```

### Option B — extract your real PDF

```bash
# Extract text from the PDF
npm run extract -- path/to/mls-rules.pdf rules.txt

# Optionally prepare a schedule.txt (plain text, any format Claude can read)

# Upload to local KV (for wrangler dev)
npm run upload-rules-local
npm run upload-schedule-local
```

## Run locally

```bash
npm run dev
```

Open the printed URL (usually `http://localhost:8787`). The demo page appears and the widget calls your local worker.

## Deploy to Cloudflare

Push the API key as a secret, upload KV content to the remote namespace, and deploy:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npm run upload-rules              # remote KV
npm run upload-schedule           # remote KV
npm run deploy
```

Your widget + API are now live at `https://helpdesk.<your-subdomain>.workers.dev`.

## Embedding the widget on another site

On any external page:

```html
<script>
  window.HELPDESK_CONFIG = {
    apiUrl: 'https://helpdesk.<your-subdomain>.workers.dev/api/chat',
    title: 'MLS Help Desk',
    primaryColor: '#1f4e79',
  };
</script>
<script src="https://helpdesk.<your-subdomain>.workers.dev/widget.js" defer></script>
```

## Token usage controls

These are all set in [src/worker.js](src/worker.js):

- Model: `claude-haiku-4-5-20251001` (cheap and fast for Q&A)
- `MAX_OUTPUT_TOKENS = 500` — caps answer length
- `MAX_HISTORY_TURNS = 6` — trims conversation history sent to Claude
- `MAX_MESSAGE_LENGTH = 1000` — rejects oversized user messages
- **Prompt caching** — rules + schedule are marked `cache_control: ephemeral`, so after the first request within 5 minutes, reusing that context is ~90% cheaper
- Rate limit: 20 req/min per IP (see `wrangler.toml`)

Check `usage.cache_read_input_tokens` vs `usage.cache_creation_input_tokens` in the `/api/chat` response to confirm caching is working.

## Updating content

When rules change:

```bash
npm run extract -- path/to/new-rules.pdf rules.txt
npm run upload-rules
```

No redeploy needed — the worker picks up new KV content automatically (within ~60 seconds of propagation).
