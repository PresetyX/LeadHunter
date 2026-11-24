🌐 **English** | [Português (BR)](README.pt-BR.md)

# LeadHunter

[![CI](https://github.com/PresetyX/LeadHunter/actions/workflows/ci.yml/badge.svg)](https://github.com/PresetyX/LeadHunter/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)
![Vercel](https://img.shields.io/badge/deploy-Vercel-black)

**B2B lead generation SaaS for local businesses.** Enter a *niche* (e.g. "dentist") and a *city* (e.g. "Jundiaí") and get a list of companies with phone, WhatsApp, website, email and social networks, ready to export as CSV (Excel) or XLSX and use for prospecting.

**🔗 Live: <https://leadhunter-xi-indol.vercel.app>**

<!-- Add a screenshot or GIF of the dashboard: ![LeadHunter](docs/dashboard.png) -->

> The product targets the Brazilian market, so the interface is in Portuguese, prices are in Brazilian reais (R$) and payments go through Mercado Pago (Pix and card).

### At a glance

| | |
| --- | --- |
| **Problem** | Prospecting local businesses takes hours of copying data from Google Maps and hunting for contact details on each website. |
| **Solution** | A search that takes under a minute: it collects, deduplicates and enriches the leads and exports the finished spreadsheet. |
| **Product** | A paid SaaS that is live (Mercado Pago: Pix and card), with volume-based plans and quotas enforced on the server. |
| **Engineering** | Next.js 15 + TypeScript on Vercel, NDJSON streaming, real cancellation, a 7-day cache, a cost cap on the Google API and 33 automated tests in CI. |

---

## 1. Platform overview

Prospecting local businesses usually means hours of copying data from Google Maps, looking up each business's website and hunting for an email or WhatsApp number. LeadHunter automates that flow in a search that takes under a minute:

1. **Collects** businesses from Google Maps' official database (Places API).
2. **Normalizes and deduplicates** the records (phone numbers in the `55AREACODENUMBER` format, clean URLs, duplicates merged).
3. **Enriches** each company by visiting its website: email, WhatsApp, Instagram, Facebook, LinkedIn, TikTok and YouTube.
4. **Delivers** the table on screen, in real time, and lets you export to CSV (UTF-8 with BOM, opens directly in Excel) or XLSX.

The product is sold with paid access (Mercado Pago, Pix or card), with plans by lead volume and usage caps to protect the margin and the Google API quota.

### Who it's for

- **Marketing and social media agencies**, which need lists segmented by niche and region.
- **B2B salespeople and SDRs**, who do cold calls, WhatsApp and cold email.
- **Freelancers and service providers** (websites, paid traffic, automation, accounting) who prospect local businesses.
- **Consultancies and franchises**, to map the market and competition by city.

---

## 2. Architecture and technologies

| Layer | Technology |
| --- | --- |
| Front end and back end | **Next.js 15** (App Router), **React 19**, **TypeScript** |
| Styling | Tailwind CSS 3, Lucide icons, dark theme with neon green (`#A9EA2E` / `#82C91E`) |
| Runtime | **Node.js** (>= 20), serverless functions on **Vercel** (region `gru1`, São Paulo) |
| Main data source | **Google Places API (New)**, Text Search |
| Alternative sources | Outscraper (optional) and OpenStreetMap (Nominatim + Overpass, free) |
| Payments | **Mercado Pago** (Checkout Pro: Pix and card) + signed webhook |
| Authentication | JWT cookie session (`jose`), hashed passwords, one device at a time |
| Storage | **Vercel Blob** (private) or **Postgres** (Neon), chosen by environment variable |
| Spreadsheets | ExcelJS (XLSX), custom CSV generation |
| Metrics | Vercel Web Analytics |

### Flow of a search

```
Browser ──POST /api/search──▶ validates session and payment
                                  │
                                  ├─ reserves the search in the user's quota (atomic operation)
                                  ├─ 7-day cache? ──yes──▶ returns from cache (does not query Google)
                                  │
                                  ├─ 1) Google Places  (main; with a global monthly call cap)
                                  ├─ 2) Outscraper     (optional, only if configured and Google returned nothing)
                                  ├─ 3) OpenStreetMap  (last resort, free)
                                  │
                                  ├─ dedupe ─▶ sends a partial result right away (NDJSON streaming)
                                  ├─ website enrichment (email, WhatsApp, social networks)
                                  └─ writes to the cache and debits the delivered leads
```

Design points worth highlighting:

- **NDJSON streaming.** The response arrives as events (`status`, `partial`, `result`, `error`), so the screen shows progress and the first leads before enrichment finishes.
- **Real cancellation.** The *Stop* button closes the connection and the server actually halts the search: it doesn't spend API calls, doesn't enrich websites and doesn't debit leads nobody received.
- **Serverless limit.** The function has an internal budget of 52 s (`maxDuration = 60`). Near the limit, it returns what has already been enriched instead of hitting the timeout.
- **Coverage of large cities.** Google returns at most 60 places per query. To cover more, the search runs niche synonyms and splits the city map into quadrants while the queries keep "filling up", always within a cap on calls per search.
- **7-day cache.** Repeated searches come from the cache, with no new API call and without consuming leads from whoever repeats the search.
- **Google cost cap.** A global monthly counter blocks new Google calls once the configured ceiling is reached, and the search falls back to OpenStreetMap instead of causing an unexpected bill.

### Repository structure

```
app/                 pages and API routes (App Router)
  api/auth/          login, logout, sign-up, session
  api/search/        streaming lead search
  api/export/        XLSX export
  api/checkout/      payment creation and verification
  api/webhooks/      Mercado Pago webhook
components/          interface (dashboard, pricing, usage panel)
lib/                 business rules
  sources/           Google Places, Outscraper, OpenStreetMap
  plan.ts            product catalog, prices and limits
  pricing.ts         dynamic promotion (lifetime vs. monthly)
  quota.ts           lead and daily search quotas
  places-budget.ts   global monthly cap on Google calls
  enrich.ts          email, WhatsApp and social network extraction
tests/               automated tests (node:test)
```

---

## 3. Features and business use cases

### Features

- **Search by niche and city**, with niche synonyms to increase coverage.
- **Data per lead:** name, category, address, phone, WhatsApp, website, email, social networks, rating and number of reviews.
- **Automatic enrichment** of the companies' websites.
- **Export** to CSV (UTF-8-SIG, `;` separator, phone numbers preserved in Excel) and XLSX (frozen header, filters, clickable links, WhatsApp as a `wa.me` link), with protection against formula injection.
- **Usage panel:** remaining leads, searches for the day and plan validity.
- **Payment by Pix or card** through Mercado Pago, with automatic access release.
- **Upgrade panel** when the limit runs out: an extra credit pack or a move to a monthly plan.
- **Price preview mode** (`dev-toggle`), visible only to emails listed in `ADMIN_EMAILS`, to see the transition between the lifetime offer and the monthly plans.

### Commercial model

**Launch offer (first 50 sales).** While there are fewer than 50 completed sales, the pricing page highlights the lifetime plan and a scarcity badge ("Launch Offer: X/50 spots left").

| Product | Price | Includes |
| --- | --- | --- |
| **Launch lifetime** | R$ 30, one-time payment | Up to 1,000 leads in total and up to 10 searches per day |
| **Extra Credits Pack** | R$ 15 | +1,000 leads, never expires |

**Monthly plans.** When the 50 sales are reached, the pricing area switches by itself to the monthly plans (Pix or card, each payment unlocks 30 days, no lock-in):

| Plan | Price | Leads per month | Searches per day |
| --- | --- | --- | --- |
| **Basic** | R$ 29.90 | up to 1,000 | 20 |
| **Pro** (most popular) | R$ 59.90 | up to 4,500 | 40 |
| **Business** | R$ 149.90 | unlimited, with an internal fair-use cap (30,000/month) | 100 |

Prices, limits and quotas live on the server (`lib/plan.ts`), so the client cannot change them.

### Use cases

- **Paid traffic agency:** search "aesthetic clinics" in 5 cities, export the XLSX and send a proposal via WhatsApp to those without a website.
- **B2B software SDR:** build lists of "accounting firms" by region with email and phone for a cold-call cadence.
- **Website freelancer:** list local businesses with no website (empty website field) and offer to build a page.
- **Franchise or expansion:** map the competition and the density of a niche by city.

### Security

- Signed cookie session, **one device at a time**, 30-minute inactivity expiry and a session heartbeat while the tab is visible.
- Login attempt limit per IP and per email.
- Same-origin check on routes that change state.
- Payment confirmed **on the server**, by querying the Mercado Pago API; the webhook requires a valid HMAC signature.
- Lead and search quota reserved atomically, leaving no gap to bypass login or payment from the client.
- Security headers (CSP, HSTS, `X-Frame-Options`, etc.) in `next.config.mjs`.
- Enrichment with basic SSRF protection (blocks internal hosts).

### Design decisions

- **NDJSON streaming response, not a single response.** Search and enrichment take
  time; with events (`status`, `partial`, `result`, `error`) the screen shows progress and the
  first leads before the end. The cost is a client that has to handle events and cancellation.
- **Real cancellation.** Closing the connection halts the search on the server, so it doesn't
  spend API calls, doesn't enrich websites and doesn't debit leads nobody received.
- **Global monthly cap on Google Places calls.** The search asks for phone and website, which falls
  into the Enterprise tier (1,000 free calls per month and about US$ 35 per 1,000 after that),
  and each search uses 3 to 18 calls. Once the ceiling is reached, the search falls back to OpenStreetMap
  instead of causing an unexpected bill.
- **7-day cache.** A repeated search doesn't call the API and doesn't consume leads from whoever repeats it.
- **Prices, plans and quotas only on the server** (`lib/plan.ts`, `lib/quota.ts`). The client doesn't
  decide anything involving money, and the reservation of the lead and search quota is atomic.
- **Payment confirmed on the server.** The Mercado Pago webhook requires a valid HMAC signature and
  access is only released for an approved payment, in BRL and at the product's minimum amount.
- **Storage chosen by environment variable.** Postgres (`DATABASE_URL`) or private Vercel Blob
  behind the same `Store` interface (`lib/store.ts`). On Blob, the unique email uses atomic
  creation and updates use ETag (`ifMatch`).
- **Source chain with fallback.** Google Places is the main one, Outscraper only comes in if
  it is configured and Google returned nothing, and OpenStreetMap (free) is the last
  resort. Each source lives in its own module under `lib/sources`.

---

## 4. Local installation and running

**Prerequisites:** Node.js 20 or higher and npm.

```bash
git clone https://github.com/PresetyX/LeadHunter.git
cd LeadHunter

npm install
cp .env.example .env.local     # fill in the variables (see section 5)

npm run dev                    # http://localhost:3000
```

Other commands:

```bash
npm test          # automated tests (node:test)
npm run build     # production build
npm start         # serves the production build
```

### Tests and CI

There are 33 tests with `node:test`, without calling real APIs, focused on the rules that involve money and cost:

- **Payments:** only approved payments are released, in BRL, at each product's minimum amount and with a valid reference; checks the Mercado Pago webhook HMAC.
- **Quotas:** limits for the lifetime plan, the monthly plans and the credit pack (including refunds), cycle renewal and expiry, a repeated search within 7 days without consumption, giving back a search that fails, and the day counted in Brasília time.
- **Google cap:** blocks when the ceiling is reached even with parallel calls, resets at the turn of the month and doesn't release more than what was counted when a read fails.
- **Collection and normalization:** quadrant splitting and call cap in large cities, Brazilian phone numbers, deduplication, extraction of email, WhatsApp and social networks from HTML, and Excel-safe CSV.
- **Cancellation:** the internal deadline drops to zero and the pool stops picking up new tasks.

GitHub Actions runs the tests, `tsc --noEmit` and the production build on every push and pull request.

> **No credentials?** To try the interface locally without Blob or Postgres, set `LEADHUNTER_TEST_MEMORY_STORE=1` (in-memory storage, outside Vercel only). Without `PLACES_API_KEY`, the search uses OpenStreetMap.

### Deploying to Vercel

```bash
npm i -g vercel
vercel --prod
```

Add the environment variables under *Settings > Environment Variables* of the project (mark secrets as **Sensitive**). Variables only apply to new deployments, so redeploy after creating or changing them.

---

## 5. Environment variables

Copy `.env.example` to `.env.local` (development) or add the same keys on Vercel (production). **Never commit real keys.**

| Variable | Required | Description |
| --- | --- | --- |
| `AUTH_SECRET` | yes | Session secret. Generate it with `openssl rand -base64 48`. |
| `BLOB_READ_WRITE_TOKEN` | one of the two | Vercel Blob token, used for users, cache and the call counter. |
| `DATABASE_URL` | one of the two | Alternative to Blob: Postgres (Neon). |
| `MP_ACCESS_TOKEN` | yes | Mercado Pago access token (Checkout Pro). |
| `MP_WEBHOOK_SECRET` | yes | Secret to validate the Mercado Pago webhook signature. |
| `PLACES_API_KEY` | recommended | Google Cloud Places API (New) key. Without it the search falls back to OpenStreetMap. Restrict the key to the Places API. |
| `PLACES_MONTHLY_CALL_CAP` | no | Global cap on Google calls per month (default `900`). |
| `GOOGLE_MAX_CALLS_PER_SEARCH` | no | Cap on Google calls per search (default `18`). |
| `SCRAPER_API_KEY` | no | Outscraper key, used only if Google returns no results. |
| `OUTSCRAPER_QUERY_VARIANTS` | no | Number of niche synonyms per Outscraper search (1 to 3). |
| `NEXT_PUBLIC_APP_URL` | no | Public URL of the app (payment returns and webhook). On Vercel it is inferred. |
| `PRICING_MODE` | no | `auto` (default: lifetime while sales < 50), `launch` or `monthly`. |
| `ADMIN_EMAILS` | no | Emails (comma-separated) that see the pricing `dev-toggle`. |
| `PRICING_DEV_TOGGLE` | no | `1` shows the selector to everyone. Avoid in production. |

`PLACES_API_KEY` also accepts the old name `GOOGLE_PLACES_API_KEY`.

### Google Places API costs

The search asks for phone and website, which falls into Google's **Enterprise** tier: **1,000 free calls per month** and then about **US$ 35 per 1,000**. Each search uses 3 to 18 calls. That is why the project has the `PLACES_MONTHLY_CALL_CAP` cap and the 7-day cache. It is also recommended to create a **budget alert** in Google Cloud and restrict the key to the Places API. Check the current prices in Google's documentation before raising the cap.

---

## Responsible use

The data comes from public sources and official APIs. For prospecting, respect **LGPD** (Brazil's data protection law: legitimate-interest legal basis and an easy opt-out) and the sources' terms of use. Nominatim and Overpass are community services: avoid bulk searches.

## Development history

Developed locally between November 4 and November 13, 2026. The commit history was created afterwards, and the commit dates were adjusted to match the period in which the work was actually done.

## License

Distributed under the MIT license. See the [LICENSE](LICENSE) file.
