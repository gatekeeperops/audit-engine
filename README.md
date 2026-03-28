# audit-engine

AI-powered funnel audit system that scans a SaaS product, generates a scored QA report, and delivers it via cold email — fully automated.

Built by [GatekeeperOps](https://gatekeeperops.ai) — AI-native QA automation for SaaS teams.

---

## What It Does

1. **Crawls 5 critical pages** — Homepage, Pricing, Signup, Login, Demo
2. **Detects tech stack** — framework, analytics, auth providers, error tracking
3. **Runs AI analysis** — Claude generates scored findings across Performance, Reliability, and Test Coverage
4. **Generates a PDF report** — 5-page professional audit report via Playwright HTML→PDF
5. **Stores results** — audit run saved to Supabase with PDF uploaded to storage
6. **Sends cold email** — personalized outreach via Resend with PDF report link

Single command. No manual steps.

---

## Real Audit Results

| Target | Score | Risk Level | Duration | Cost |
|--------|-------|------------|----------|------|
| cal.com | 73/100 | Critical | ~210s | $0.026 |
| loom.com | 79/100 | High | ~195s | $0.025 |

---

## Architecture

```
prospects.csv
     │
     ▼
batchRunner.ts          ← processes multiple prospects from CSV
     │
     ▼
pipeline.ts             ← orchestrates full end-to-end run
     │
     ├── funnelAgent.ts         ← Playwright multi-page crawler
     │       └── healthAgent.ts ← single-page audit + PageSpeed API
     │
     ├── aiAnalyzer.ts          ← Claude Tool Use + Zod schema validation
     │
     ├── pdfGenerator.ts        ← Playwright HTML→PDF (5-page report)
     │
     ├── supabaseClient.ts      ← saves run + uploads PDF to storage
     │
     └── email (Resend)         ← personalized cold email with PDF link
```

---

## Stack

| Layer | Technology |
|-------|------------|
| Browser automation | Playwright + Browserbase |
| AI analysis | Claude (Anthropic) + Zod |
| Performance data | PageSpeed Insights API |
| Database | Supabase (PostgreSQL) |
| Email delivery | Resend |
| Runtime | Node.js + TypeScript (tsx) |

---

## Usage

**Single prospect:**
```bash
npx tsx src/pipeline.ts https://target.com founder@company.com "Name" "Company"
```

**Batch from CSV:**
```bash
# Audit only
npx tsx src/batchRunner.ts prospects.csv

# Audit + send emails
npx tsx src/batchRunner.ts prospects.csv --send-email --max=10
```

**prospects.csv format:**
```
url,email,name,company
https://cal.com,cto@company.com,Alex,Cal.com
```

---

## Batch Runner

- Skips already-processed URLs — safe to re-run
- 15s delay between runs to avoid rate limits
- Appends results to `reports/batch-results-YYYY-MM-DD.csv`
- Continues on failure — one bad URL doesn't stop the batch
- Default max: 20 prospects per run

---

## Environment Variables

```bash
# Anthropic
ANTHROPIC_API_KEY=

# Browserbase (headless browser)
BROWSERBASE_PROJECT_ID=
BROWSERBASE_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Resend (email)
RESEND_API_KEY=
FROM_EMAIL=

# PageSpeed
PAGESPEED_API_KEY=

# Mode
LOCAL_MODE=true   # false = use Browserbase, true = local Playwright
```

---

## Output

Each run produces:
- `reports/<company>-audit-<date>.pdf` — 5-page scored report
- `reports/<company>-audit-<date>.json` — raw findings
- Supabase row with audit metadata + PDF storage URL

---

## Contact

**Pardha** — [pardha@gatekeeperops.ai](mailto:pardha@gatekeeperops.ai)  
**Website** — [gatekeeperops.ai](https://gatekeeperops.ai)  
**Book a call** — [calendly.com/pardha-gatekeeperops/30min](https://calendly.com/pardha-gatekeeperops/30min)