# Drivee Canadian VIN Reports — Production Deployment & Operations Handoff

This single file has **everything** needed to take the upgraded **Drivee Canadian VIN Reports** system live on **Vercel + Supabase + Stripe** — written so either **you** or **an AI agent** can follow it top-to-bottom without guesswork.

> **One key sent privately:** You will receive **`AUCTIONS_API_KEY`** privately (it is intentionally not committed to git). Everything else (`SUPABASE_*`, `STRIPE_*`, `RESEND_API_KEY`, admin credentials, and `VIN_ACCESS_SECRET`) is already in your Supabase, Stripe, Resend, and Vercel accounts or generated below.

---

## Master Go-Live Checklist (10 Minutes Total)

- [ ] **1. Supabase Postgres (Zero Data Loss):** Run the SQL in [Step 1](#step-1--create-the-supabase-postgres-table-2-minutes) in **Supabase SQL Editor** to create the RLS-locked `public.vin_store_buckets` table (does not touch `analytics` or any existing table), and copy `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] **2. Stripe Key Permission Upgrade:** Verify `STRIPE_SECRET_KEY` has **`Checkout Sessions: Write` + `Read`** (previously `Read` alone was enough for static Payment Links; dynamic CAD checkout now creates sessions).
- [ ] **3. Stripe Payment Methods & Webhook:** Confirm **Cards, Apple Pay, Google Pay, Link** are enabled in Stripe, and confirm webhook `https://www.drivee.ca/api/stripe-webhook` has all **6 events** checked (especially `charge.refunded`).
- [ ] **4. Vercel Environment Variables:** Add/verify all required Production env vars from [Step 4](#step-4--set-vercel-environment-variables) (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VIN_ACCESS_SECRET`, `VIN_ADMIN_USER`, `VIN_ADMIN_PASSWORD`, `AUCTIONS_API_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `VIN_AUTO_FULFILL`, `VIN_ALLOW_FREE_PROMO=false`). Back up `VIN_ACCESS_SECRET` in your password manager!
- [ ] **5. Pre-Deploy Check & Deploy:** Run `npm run check:all` (`7/7` gates passing), test on a Vercel Preview deployment, then merge/deploy to `https://www.drivee.ca`.
- [ ] **6. Post-Deploy Verification:**
  - [ ] `/vin-admin.html` shows login gate (`401` unauthenticated) and green **`Supabase Postgres · Durable`** badge after sign-in.
  - [ ] `DRIVEEFREE` returns `"promoValid": false` in Production.
  - [ ] `/report.html` free VIN check (`2C4RDGBGXGR217456`), Sample Dossier, and PDF download (`/api/order-status?op=pdf`) all succeed.
  - [ ] 1 end-to-end test purchase + Stripe Dashboard refund flips the order to `refunded` and auto-revokes its `DRV3-...` pack code.

---

## 0. What Was Built (Quick Orientation)

- **Pricing & Checkout (Automated CAD):**
  - **Single VIN Report:** `$17 CAD`
  - **3-Pack VIN Reports:** `$39 CAD` (`$13.00/report`, Save 24%, issues a reusable 160-bit HMAC-SHA256 `DRV3-...` key)
  - **10-Pack VIN Reports:** `$99 CAD` (`$9.90/report`, Save 42%, issues a reusable `DRV10-...` key)
  - Dynamic Stripe Checkout Sessions (`POST /api/order-status?op=checkout`, `currency=cad`, Cards + Apple Pay + Google Pay + Link) — **no static Payment Links or Stripe Products need to be maintained manually**.
- **Live Canadian Dossier & PDF:**
  - `/report.html` — Free VIN decode (NHTSA vPIC specs, safety recalls, CAD market valuation, upstream record count radar, interactive buyer's checklist, saved browser pack wallet, sample dossier CTAs).
  - `/vin-report.html` — Interactive Drivee-branded Canadian Vehicle History Dossier (`km` default with `KM/MILES` toggle, collision blueprint, odometer graph, owner-grouped timeline, 0 third-party CARFAX/dealer-favorites clutter).
  - `POST /api/order-status?op=pdf` — Pure-Node server-side Vector PDF generator (`Drivee-Dossier-{VIN}.pdf`) with SSRF & payload DoS protection.
- **Authenticated 6-Tab Admin Command Desk (`/vin-admin.html`):**
  - Timing-safe login with signed `HttpOnly; SameSite=Strict` cookie + 5-attempt/15-min lockout (fails closed on Vercel until `VIN_ADMIN_USER` / `VIN_ADMIN_PASSWORD` are set).
  - **6 Tabs:** `Sales Analytics` (live `CAD ↔ USD` converter, 52-week GitHub-style heatmap, daily/weekly charts), `Orders, Packs & Promos` (Orders ledger + CSV export, 160-bit HMAC pack generator & inspector, promo revoke/restore/delete, `+1` courtesy credit top-up), `Buyer CRM` (LTV database + CSV export), `Instant Comp Desk` (`$0` signed report links + live dossier pull), `Recent Lookups`, and `Settings & Sandbox` (upstream `Test Connection` + live AuctionsAPI balance check, optional live CAD pricing overrides stored inside the existing `ledger` bucket, and one-click `Purge Sandbox Orders`), with confirmation modals on destructive actions.
- **Durable Vercel Serverless Persistence (`Supabase Postgres`):**
  - Uses RLS-locked `public.vin_store_buckets` via `SUPABASE_SERVICE_ROLE_KEY` with **Optimistic Concurrency Control (CAS on `version`)** so orders, pack credits, buyer emails, promo revocations, Stripe webhook deduplication, cached VIN reports, and brute-force lockouts survive Vercel cold starts and parallel lambda runs.
- **Zero Impact on Core Parking/Ticket App:**
  - **Zero new `npm` dependencies** (pure Node >= 18 built-ins only).
  - **0 bytes changed** across all 10 protected parking/ticket files: `app.html`, `account.html`, `mechanic.html`, `enforcement-map.html`, `vercel.json`, `sw.js`, `api/scan-ticket.js`, `api/claude.js`, `api/track.js`, `api/lead.js`.

### Endpoints & Pages Map

| Route / File | Purpose |
| :--- | :--- |
| `index.html` | Homepage with desktop `Check VIN` header button, mobile `VIN Check [FREE]` menu link, and homepage VIN lookup strip. |
| `report.html` | Public Canadian VIN pre-check, `$17/$39/$99 CAD` unlock cards, promo & pack credit redemption, saved browser pack wallet. |
| `vin-report.html` | Unlocked live Drivee Canadian Vehicle History Dossier + PDF download button. |
| `vin-admin.html` | Operator back-office dashboard (requires login). |
| `POST /api/order-status?op=lookup` | Free VIN decode, recalls, CAD valuation, upstream record count check, inquiry logging (`lib/vin-api-lookup.js`). |
| `GET/POST /api/order-status?op=checkout` | Promo quote (`GET`) & dynamic Stripe CAD Checkout Session creation (`POST`, `lib/vin-api-checkout.js`). |
| `POST /api/order-status?op=unlock` | Unlocks dossier via signed token, Stripe `session_id`, 160-bit `DRV3-`/`DRV10-` pack code, or demo VIN (`lib/vin-api-unlock.js`). |
| `POST /api/order-status?op=pdf` | Generates downloadable Drivee Vector PDF (`application/pdf`, `lib/vin-api-pdf.js`). |
| `GET/POST /api/order-status?op=admin` | Authenticated admin auth, dashboard stats, CSV exports, promo/pack/refund mutations (`lib/vin-api-admin.js`). |
| `POST /api/stripe-webhook` | Verifies Stripe signature, records orders, issues pack keys, emails buyer/owner, and **auto-revokes pack keys on `charge.refunded`**. |
| `GET /api/order-status?session_id=...` | Post-checkout order lookup returning buyer email, report link, and pack code (also routes `?op=*` so `api/` stays at **12/12 Vercel Hobby functions**). |

---

## Step 1 — Create the Supabase Postgres Table (2 Minutes)

Run this **once** in **Supabase Dashboard → SQL Editor → New query → Run** (identical to `tools/vin-supabase-schema.sql`):

```sql
create table if not exists public.vin_store_buckets (
  bucket     text primary key,
  payload    jsonb not null default '{}'::jsonb,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists vin_buckets_updated_idx
  on public.vin_store_buckets (updated_at desc);

alter table public.vin_store_buckets enable row level security;

revoke all on table public.vin_store_buckets from anon, authenticated;

comment on table public.vin_store_buckets is
  'Server-side durable state for Drivee VIN reports (orders, buyers, hashed pack codes, promos, inquiries, rate limits, report cache). Service-role access only.';
```

> **Zero data loss guarantee:** This script uses `create table if not exists` on a brand-new table (`public.vin_store_buckets`). It does **not** touch, alter, or delete your existing `analytics` table or any other Supabase data.
>
> **Security check — do NOT weaken RLS:** Because `SUPABASE_ANON_KEY` is public in client-side HTML for funnel tracking, `public.vin_store_buckets` **must** keep RLS enabled with **zero `anon`/`authenticated` policies**. Only Vercel server functions using `SUPABASE_SERVICE_ROLE_KEY` can access this table.

Then grab two values from **Supabase Dashboard → Project Settings → API**:
1. **Project URL** → `SUPABASE_URL` (e.g. `https://ofnsssyiiejohcnbejxq.supabase.co`)
2. **`service_role` secret key** → `SUPABASE_SERVICE_ROLE_KEY` (**never** expose in frontend code)

---

## Step 2 — Configure Stripe Dashboard (3 Minutes)

You do **not** need to create manual Stripe Products, Prices, or Payment Links for the `$17 / $39 / $99 CAD` packages — `lib/vin-api-checkout.js` (`POST /api/order-status?op=checkout`) creates dynamic Checkout Sessions in CAD automatically.

### 2A. Enable Dynamic Payment Methods
1. Go to **Stripe Dashboard → Settings → Payments → Payment methods**.
2. Ensure **Cards**, **Apple Pay**, **Google Pay**, and **Link** are enabled for CAD Checkout Sessions.
3. For Apple Pay on `www.drivee.ca`, verify domain registration under **Settings → Payment methods → Apple Pay → Domains**.

### 2B. Check / Upgrade Your Existing `STRIPE_SECRET_KEY`
- Go to **Stripe Dashboard → Developers → API keys**.
- **Important if Stripe is already connected:** Previously Drivee used static Payment Links, so a restricted key with only **`Checkout Sessions: Read`** was enough. Because `POST /api/order-status?op=checkout` now **creates** CAD Checkout Sessions dynamically, make sure `STRIPE_SECRET_KEY` has **`Checkout Sessions: Write` (and Read)** enabled — or use a standard Live Secret Key.
- *(Tip: Use your **Test** key on Vercel Preview deployments and your **Live** key on Vercel Production.)*

### 2C. Verify Your Existing Webhook Endpoint (No Need to Recreate If Already Set Up)
1. Go to **Stripe Dashboard → Developers → Webhooks**. If `https://www.drivee.ca/api/stripe-webhook` already exists, you can keep it and keep your existing `STRIPE_WEBHOOK_SECRET` — just verify all **6 events** below are checked! Otherwise click **Add endpoint**.
2. Set **Endpoint URL** to:
   ```text
   https://www.drivee.ca/api/stripe-webhook
   ```
3. Subscribe to these **exact 6 events**:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `charge.refunded` *(critical: automatically marks the order `refunded` and revokes any linked 3-Pack / 10-Pack code so refunded buyers cannot keep using remaining credits)*
4. Save the endpoint, click **Reveal signing secret**, and copy `whsec_...` → `STRIPE_WEBHOOK_SECRET`.

---

## Step 3 — Confirm Upstream VIN API & Email Keys

1. **Upstream VIN History Provider (required for live non-demo reports):**
   - `AUCTIONS_API_KEY` — powers free pre-check record count radar (`/api/reports/check-records/{vin}`), free reuse of already-purchased VINs (`/api/reports/my-history`), and paid history pulls.
2. **Email Receipts & Alerts (Resend):**
   - `RESEND_API_KEY` — sends buyer confirmation/report links from `Drivee Car Report <reports@drivee.ca>` and owner alerts to `ORDER_ALERT_EMAIL` (defaults to `drivee.canada@gmail.com`). Confirm `drivee.ca` domain DNS is verified in Resend.
3. **Fulfillment Mode (`VIN_AUTO_FULFILL`):**
   - `VIN_AUTO_FULFILL=false` *(safe initial default)*: Buyer still unlocks their live dossier + PDF immediately on `/vin-report.html` after Stripe Checkout, and you receive an owner email alert.
   - `VIN_AUTO_FULFILL=true` *(hands-free mode)*: The Stripe webhook also pre-fetches the live report on `checkout.session.completed` and emails the buyer a direct unlocked report link + their Pack Code automatically.

---

## Step 4 — Set Vercel Environment Variables

Go to **Vercel Dashboard → Your Drivee Project → Settings → Environment Variables** and configure the following for **Production** (and optionally Test keys for **Preview**):

| Variable | Required? | Recommended Production Value / How to Get |
| :--- | :---: | :--- |
| `SUPABASE_URL` | **Yes** | Your Supabase Project URL (e.g. `https://ofnsssyiiejohcnbejxq.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase `service_role` secret key (**server-side only**) |
| `STRIPE_SECRET_KEY` | **Yes** | Live Stripe Secret Key (or restricted key with Checkout Sessions R/W) |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | Signing secret (`whsec_...`) from `https://www.drivee.ca/api/stripe-webhook` |
| `VIN_ACCESS_SECRET` | **Yes** | Strong random 64-hex secret — generate via `openssl rand -hex 32` |
| `VIN_ADMIN_USER` | **Yes** | Admin username for `/vin-admin.html` (e.g. `admin` or founder handle) |
| `VIN_ADMIN_PASSWORD` | **Yes** | Strong unique password for `/vin-admin.html` (login fails closed on Vercel if unset) |
| `AUCTIONS_API_KEY` | **Yes** | Your AuctionsAPI key for live VIN history pulls |
| `RESEND_API_KEY` | **Yes** | Your Resend API key (`re_...`) for buyer & owner emails |
| `NEXT_PUBLIC_SITE_URL` | **Yes** | `https://www.drivee.ca` |
| `VIN_AUTO_FULFILL` | Recommended | `true` for instant emailed report links, or `false` to keep manual email backup |
| `VIN_ALLOW_FREE_PROMO` | Recommended | `false` *(keeps the built-in `DRIVEEFREE` 100% test promo locked off in production)* |
| `CAD_TO_USD_RATE` | Optional | `0.72` (default CAD→USD rate in `/vin-admin.html`; also editable in the UI) |
| `ORDER_ALERT_EMAIL` | Optional | Owner email for order/refund alerts (defaults to `drivee.canada@gmail.com`) |
| `VIN_ADMIN_KEY` | Optional | Optional API header key (`x-admin-key`) for automated admin scripts |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional | Instant Telegram pings on paid orders |

### Optional CLI Commands (if using Vercel CLI)

```bash
# Generate a fresh signing secret locally first:
openssl rand -hex 32

# Add required Production env vars via Vercel CLI:
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
vercel env add VIN_ACCESS_SECRET production
vercel env add VIN_ADMIN_USER production
vercel env add VIN_ADMIN_PASSWORD production
vercel env add AUCTIONS_API_KEY production
vercel env add RESEND_API_KEY production
vercel env add NEXT_PUBLIC_SITE_URL production
vercel env add VIN_AUTO_FULFILL production
vercel env add VIN_ALLOW_FREE_PROMO production
```

> **Important note about `VIN_ACCESS_SECRET`:** Once you start issuing live 3-Pack / 10-Pack codes, **do not rotate `VIN_ACCESS_SECRET` lightly** — pack key HMAC tags, storage hashes, and AES-GCM order receipts are derived from it. Back it up safely in your password manager!

---

## Step 5 — Run Pre-Deploy Checks & Deploy

Before merging/deploying, run the built-in 7-gate verification suite (pure Node >= 18, zero network calls):

```bash
npm run check:all
```

Expected result:
- **7/7 gates passing** (`42` offline assertions covering scope guard, secret hygiene, JS syntax, HTML/SEO integrity, Stripe webhooks, Supabase CAS persistence, Vercel production lockdowns, SSRF/CSV guards, local HTTP smoke, and 0-byte diff on the 10 protected parking/ticket files).

Then deploy:
1. Push/merge branch to trigger a **Vercel Preview** deployment first (Stripe checkout redirects automatically stay on `*.vercel.app` when `VERCEL_ENV=preview`).
2. After verifying Preview, merge to `main` (or run `vercel --prod`) to deploy to `https://www.drivee.ca`.

---

## Step 6 — Post-Deploy Live Verification Checklist (5 Minutes)

Run these checks right after Production deploys:

### 6.1 Verify Admin Auth, Durable Postgres Storage & Upstream Balance
1. Open `https://www.drivee.ca/vin-admin.html` in an incognito window.
2. Confirm you see the **Login Gate** (unauthenticated `GET /api/order-status?op=admin` must return `401`).
3. Sign in with `VIN_ADMIN_USER` and `VIN_ADMIN_PASSWORD`.
4. Confirm the top header pills show **`Supabase Postgres · Durable`** (green), **`Stripe Configured`**, and your live **`Balance $...`** badge — with **no red `/tmp` warning banner**.
5. Open **Settings & Sandbox** and click **`Test Connection`** to verify live AuctionsAPI connectivity; use **Instant Comp Desk** whenever you need a `$0` signed preview/VIP link without counting a sandbox sale.

### 6.2 Verify Promo Lockdowns (`DRIVEEFREE` Blocked, `DRIVEE15` Active)
```bash
# Must return "promoValid": false on Production:
curl -s "https://www.drivee.ca/api/order-status?op=checkout&tierId=single&promo=DRIVEEFREE"

# Must return "promoValid": true, "discountPct": 15, "finalPriceCad": 14.45:
curl -s "https://www.drivee.ca/api/order-status?op=checkout&tierId=single&promo=DRIVEE15"
```

### 6.3 Verify Public VIN Pre-Check & Sample Dossier + PDF
1. Visit `https://www.drivee.ca/` → confirm desktop header shows **`Check VIN`** (no duplicate `VIN Check` center link), and mobile menu (`<= 760px`) shows **`VIN Check [FREE]`**.
2. Visit `https://www.drivee.ca/report.html` → enter `2C4RDGBGXGR217456` → confirm specs, recalls, and CAD valuation load cleanly.
3. Click **`Preview Full Sample Dossier →`** → confirm `/vin-report.html?vin=2C4RDGBGXGR217456&demo=1` loads cleanly and clicking **Download PDF** downloads a valid `Drivee-Dossier-2C4RDGBGXGR217456.pdf`.

### 6.4 Verify End-to-End Paid Order + Refund Auto-Revocation
1. In Stripe **Test Mode** (on Preview) or with a `$17` / `$39` live checkout (on Production) — or create a single-use `95%` off test promo in `/vin-admin.html` (`maxUses: 1`):
   - Complete checkout for a 3-Pack (`$39` tier).
   - Confirm redirect to `/vin-report.html`, unlocked report, `DRV3-...` Pack Code displayed & saved in Browser Pack Wallet, and order visible in `/vin-admin.html` + Buyer Email Database.
   - Confirm buyer receipt & owner alert emails arrived via Resend.
2. Refund that test payment inside **Stripe Dashboard → Payments**.
3. Refresh `/vin-admin.html` → confirm the order automatically flipped to **`refunded`** and its linked `DRV3-...` Pack Code is automatically **`Revoked`**.

---

## Step 7 — Instructions for an AI Agent Executing This Handoff

If you are an AI agent asked by the repository owner to complete deployment and setup on their behalf, follow this exact protocol:

```text
OBJECTIVE: Deploy and configure Drivee Canadian VIN Reports on Supabase + Stripe + Vercel using VIN-DEPLOY-README.md.

HARD GUARDRAILS:
1. NEVER modify any of the 10 protected parking/ticket files:
   app.html, account.html, mechanic.html, enforcement-map.html, vercel.json, sw.js,
   api/scan-ticket.js, api/claude.js, api/track.js, api/lead.js.
2. NEVER run `npm install` or add dependencies (codebase is pure Node >= 18 built-ins).
3. NEVER commit `.env*` files or print secret values (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `VIN_ACCESS_SECRET`, `VIN_ADMIN_PASSWORD`, `AUCTIONS_API_KEY`, `RESEND_API_KEY`)
   into tracked files, git commits, or public logs.
4. NEVER weaken or disable Row Level Security on `public.vin_store_buckets` or grant `anon`/`authenticated` access.
5. NEVER set `VIN_ALLOW_FREE_PROMO=true` in Production.

EXECUTION SEQUENCE:
1. Run `npm run check:all` and confirm all 7 gates pass before making deployment changes.
2. Apply `tools/vin-supabase-schema.sql` to the target Supabase project (via Supabase SQL Editor or Supabase CLI).
3. Verify/create the Stripe webhook endpoint `https://www.drivee.ca/api/stripe-webhook` with all 6 required events:
   checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
   checkout.session.expired, payment_intent.payment_failed, charge.refunded.
4. Set all required Vercel Production environment variables listed in Step 4 (generate `VIN_ACCESS_SECRET` with
   `openssl rand -hex 32` if not already set; confirm with the human before overwriting an existing `VIN_ACCESS_SECRET`).
5. Trigger a Vercel deployment (Preview first if requested, then Production).
6. Run Step 6 verification checks (verify `/api/order-status?op=admin` returns 401 unauthenticated, `DRIVEEFREE` returns
   `promoValid: false`, `DRIVEE15` returns `promoValid: true`, `/vin-admin.html` reports `storageBackend: "supabase"`
   and `storageDurable: true`, and `/api/order-status?op=pdf` returns `200 application/pdf`).
7. Report pass/fail evidence for each check back to the owner without printing secret values.
```

---

## Troubleshooting Quick Reference

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| Red banner in `/vin-admin.html`: **"Ephemeral Vercel `/tmp` storage active"** | `SUPABASE_SERVICE_ROLE_KEY` is missing on Vercel (or `VIN_STORE_MODE=local` is set). | Add `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL` in Vercel Production env vars, run `tools/vin-supabase-schema.sql`, and redeploy. |
| `Supabase store error (404): relation "public.vin_store_buckets" does not exist` | SQL migration wasn't run yet on Supabase. | Run `tools/vin-supabase-schema.sql` in Supabase SQL Editor. |
| `503 Admin login is not configured on this server` on `/vin-admin.html` | `VIN_ADMIN_PASSWORD` is unset on Vercel (intentionally fails closed). | Set `VIN_ADMIN_USER` and `VIN_ADMIN_PASSWORD` in Vercel env vars and redeploy. |
| `500 VIN_ACCESS_SECRET is required in Vercel Environment Variables` | Neither `VIN_ACCESS_SECRET`, `STRIPE_WEBHOOK_SECRET`, nor `STRIPE_SECRET_KEY` is set on Vercel. | Set `VIN_ACCESS_SECRET` (`openssl rand -hex 32`) in Vercel env vars and redeploy. |
| Stripe webhook returns `400 Bad signature` | Wrong `STRIPE_WEBHOOK_SECRET` (e.g. Test secret used for Live webhook, or vice versa). | Copy the exact `whsec_...` signing secret from the matching Live/Test Stripe webhook endpoint. |
| `429 Too many failed sign-in / pack attempts` | 5 failed tries triggered the 15-minute sliding-window lockout. | Wait 15 minutes (or delete the `ratelimit:...` row in `public.vin_store_buckets` if an admin locked themselves out). |
| `DRIVEEFREE` rejected in Production | Intentional security lockdown on `VERCEL=1`. | Do not enable `DRIVEEFREE` globally; instead create a single-use capped promo (`maxUses: 1`) in `/vin-admin.html` for VIPs/testing. |
