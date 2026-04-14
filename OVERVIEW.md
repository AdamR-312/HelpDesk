# Help Desk — Project Overview

A self-serve chat assistant for members and consumers, embedded directly on louisvillerealtors.com. Answers questions in plain English using the association's own MLS Rules & Regulations and class schedule — no generic web content.

---

## Why this matters

Staff currently field the same questions repeatedly: *"What's the penalty for late status changes?"* *"When's the next Code of Ethics class?"* *"How long do I have to upload listing photos?"*

An automated help desk handles these 24/7, frees staff for higher-value work, and gives members a faster answer than digging through a PDF.

---

## How it works (plain English)

1. A visitor lands on our website and sees a small **"Ask a Question"** button in the top menu.
2. They click it, type a question, and hit enter.
3. Behind the scenes, the question is sent along with our official rules and class schedule to a language service (Anthropic's Claude).
4. Claude reads the source material and returns an answer grounded in **our** documents — not the open internet.
5. Response comes back in 1-3 seconds.

The system never guesses. If the answer isn't in the rules or schedule, it routes the member to the right department — MLS Support, Compliance, Education, Accounting, or Membership — with the correct email and the main phone line.

---

## Current status — working prototype

A fully functioning demonstration is live and can be shown end-to-end:

- **Demo site**: https://adamr-312.github.io/HelpDesk/
- **Backend API**: Running on Cloudflare Workers (free tier)
- **Knowledge base**: The current MLS Rules PDF has been ingested (34 pages, ~27,000 words of reference material)
- **Source code**: https://github.com/AdamR-312/HelpDesk

The prototype uses a personal Anthropic account for testing. Moving to production means swapping in a company-issued key — no code changes required.

---

## Architecture at a glance

```
Visitor → louisvillerealtors.com
            │
            ▼
        Chat widget (30 KB JavaScript, drops in via one script tag)
            │
            ▼
        Cloudflare Worker (our API, deployed globally)
            │
            ├──► Cloudflare KV (holds rules + class schedule)
            │
            └──► Anthropic Claude API (reads our docs, writes answer)
```

**No servers to maintain.** Cloudflare runs the Worker at the edge in 300+ cities worldwide. Startup time is instant. There is nothing to patch or monitor day-to-day.

---

## Production deployment

### 1. Provision a company Anthropic account
- Create account at https://console.anthropic.com under a company email
- Add company payment method
- Generate an API key; label it `louisville-realtors-helpdesk-prod`

### 2. Install the company key on the Worker
One command replaces the existing key:
```
npx wrangler secret put ANTHROPIC_API_KEY
```
The key is stored encrypted inside Cloudflare. It never appears in our code, our GitHub repo, or logs. It cannot be read back — only rotated or revoked.

### 3. Deploy to a company Cloudflare account
- Transfer the Worker to an association-owned Cloudflare account
- Optionally point it at a subdomain like `helpdesk.louisvillerealtors.com` instead of the default `*.workers.dev` URL

That's the whole deployment path. Roughly a 30-minute task.

---

## Embedding on louisvillerealtors.com

The widget is a single JavaScript file. To add it to any page on the main website, a web administrator pastes two small blocks into the site's HTML (typically in the global footer template so it appears site-wide):

```html
<script>
  window.HELPDESK_CONFIG = {
    apiUrl: 'https://helpdesk.louisvillerealtors.com/api/chat',
    title: 'GLAR Help Desk',
    primaryColor: '#1f4e79',
  };
</script>
<script src="https://helpdesk.louisvillerealtors.com/widget.js" defer></script>
```

- Works on **any** website platform — WordPress, custom HTML, Wix, Squarespace, membership platforms, etc.
- Does not require changes to the existing site's code or design system.
- Completely reversible: remove the two lines and the widget is gone.
- Styling (colors, position, welcome message, title) is configurable without touching the widget itself.

---

## Keeping content up to date

### Updating the MLS Rules when they change

When the rulebook is revised, a single command refreshes the knowledge base:

```
npm run extract -- path/to/new-rules.pdf rules.txt
npm run upload-rules
```

- Takes under a minute
- No downtime — the widget keeps answering questions throughout
- No redeployment needed; changes propagate within about 60 seconds worldwide

This can be done by a staff member with basic technical comfort, or scripted into a button on an internal admin tool later.

### Importing classes from Google Calendar

The class schedule can be automated so it **never needs manual updates**. Three options, in order of simplicity:

**Option A — scheduled sync (recommended).** A Cloudflare Worker cron job runs every hour, pulls the association's public Google Calendar via its iCal feed, formats the events, and writes them to the knowledge base automatically. Once set up, classes added to the calendar by staff appear in chatbot answers within the hour.

**Option B — Google Calendar API.** Uses OAuth credentials to read directly from the calendar. Slightly more setup; useful if the calendar is private and should stay private.

**Option C — manual upload.** Staff export the schedule from Google Calendar as a CSV occasionally and run the upload command. Works immediately with zero integration effort.

Option A is the production target — 2-3 hours of setup, then it runs itself forever.

---

## Smart handoff to staff

When the chatbot cannot confidently answer from its reference material, it does not guess. It classifies the nature of the question and routes the member to the correct department:

| Question topic | Routed to |
|---|---|
| MLS listings, data, system access | Support@LouisvilleRealtors.com |
| MLS compliance and rule violations | Compliance@ApexMLS.com |
| Classes, CE credits, education | Education@LouisvilleRealtors.com |
| Billing, dues, invoices, payments | Accounting@LouisvilleRealtors.com |
| Membership applications, status, renewals | Membership@LouisvilleRealtors.com |
| Fallback for all categories | (502) 894-9860 |

The phone number is always included as a universal fallback. If the question category is ambiguous, the response defaults to general Support plus the phone line. This routing is configured in the system prompt and can be updated in seconds without a code release.

---

## Cost projection

| Component | Cost |
|---|---|
| Cloudflare Workers hosting | **$0** (well inside free tier — 100,000 requests/day) |
| Cloudflare KV (knowledge base storage) | **$0** (free tier) |
| GitHub Pages / code hosting | **$0** |
| Domain (if we use `helpdesk.louisvillerealtors.com`) | uses existing domain |
| Anthropic API usage | **~$0.01 per question** after the system "warms up" |

**Example monthly estimate:**
- 2,000 questions/month → **~$20/month**
- 10,000 questions/month → **~$100/month**

This is a ceiling estimate. A feature called *prompt caching* cuts repeat-question costs by ~90% automatically, and we use Anthropic's most cost-efficient model (Claude Haiku 4.5) which is more than capable for Q&A over a single rulebook.

Rate limiting is built in (20 requests per minute per visitor) so a bot or bad actor cannot run up the bill.

---

## Security & privacy

- **No API keys in the repo.** The Anthropic key is stored as an encrypted Cloudflare secret.
- **No user accounts.** Visitors don't sign in; no personal data is collected.
- **Conversations are not stored** by default. They live only in the user's browser tab.
- **Knowledge base is read-only.** Claude can read our rules but cannot modify them.
- **Rate limited** per IP address to prevent abuse.
- **Open source code** hosted on GitHub — any internal or external reviewer can audit exactly what the system does.

Optional production additions:
- Logging anonymized questions to learn what members actually ask (high value for staff training and FAQ updates)
- Moderation filter to refuse off-topic or abusive prompts
- Custom domain with association SSL certificate

---

## Roadmap

| Phase | Timeline | Scope |
|---|---|---|
| **Phase 1 — POC** (done) | — | Working prototype with real rules PDF on a demo domain |
| **Phase 2 — Production** | ~1-2 days | Company Anthropic key, company Cloudflare account, custom subdomain |
| **Phase 3 — Calendar automation** | ~1 day | Google Calendar sync (Option A above) |
| **Phase 4 — Embed site-wide** | coordinate with web team | Add widget snippet to louisvillerealtors.com templates |
| **Phase 5 — Analytics (optional)** | ~2-3 days | Question logging, staff dashboard of common topics, answer quality tracking |

---

## Open questions for discussion

1. Which Anthropic account / billing entity should own the production key?
2. Should the widget be available site-wide, or only on specific sections (e.g., Members area)?
3. Do we want to log visitor questions for analysis? If yes, with what retention policy?
4. Branding — should the widget use GLAR colors/logo exactly, or match whatever page it's embedded on?
5. Should we add a "contact staff" handoff button for questions the system can't answer?

---

## Ask

Approval to:
1. Provision a company Anthropic account and funding (~$25/month initial budget)
2. Allocate ~1 week of technical time to complete Phases 2-4
3. Coordinate with the web team to add two script tags to the main site template
