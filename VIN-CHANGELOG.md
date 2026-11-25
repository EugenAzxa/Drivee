# Drivee Canadian VIN Upgrade — Change Log & Architecture Report

> Branch: `feat/vin-automated-reports` (isolated sandbox checkout; live `EugenAzxa/Drivee:main` untouched until PR review)  
> Pre-upgrade checkpoint tag: `checkpoint/vin-20261124-140049-pre-live-vin-upgrade`  
> Reference implementation: VinBadge dark-instrument & live dossier patterns ported for **Drivee Canada**

---

## 1. Summary of Changes & Why

| Area | What Changed | Why |
| :--- | :--- | :--- |
| **Responsive & Mobile Layout (`report.html`)** | Added `html, body { overflow-x: clip; }`, `minmax(0, 1fr)` on responsive grids, `.g-main` fluid height `clamp(240px, 34vw, 380px)`, `.s3-van` / `.s3-refl` `max-height: calc(100% - 54px); width: auto; max-width: 86%; object-fit: contain;`, `.verdict` `z-index: 2`, `#chart-tip` horizontal clamp, `.vin-form` <=560px wrap, and replaced the cramped `overflow-x` mobile nav strip with Drivee's `#navMenu` / `#navLinks` dropdown drawer. | Fixes the 3D Dodge Grand Caravan cutout overflowing vertically over `.verdict` around tablet/mid-stretch widths (Screenshot 1), prevents chart tooltip or long grid strings from widening the viewport, and brings mobile navigation in line with `index.html`. |
| **Buyer's Checklist (`report.html` + `assets/img/vin-sedan-xray-side.jpg`)** | Overhauled `#checklist` into a crisp Drivee **Light-Mode Buyer's Checklist v3** (`#F4F7FE` blueprint stages + separated `#F8FAFF` `.vb-toolbar` eliminating all bottom-corner control overlap), applied Reviewer -> Fixer geometry audits across Cards 01–06 (concentric R=82 dial with `x1000 RPM` below hub, unified torch pivot & dual staggered drips, continuous `1600ms` `P→R→N→D` auto-cycling with `Smooth <1s` / `Thud >1.5s` jitter toggle, and split-collar dipstick occlusion + emulsion froth), and ported VinBadge's exact **Step 03** (Gaussian-blurred 8-ellipse volumetric smoke + sculpted silver-pearl bumper, no cartoon wheel) and **Step 05** (orthographic `vin-sedan-xray-side.jpg` cobalt-blueprint laser scan with `isolation: isolate` dual-multiply rendering + arch/rocker beacons) into light mode. | Delivers native Drivee light-theme cohesion, exact SVG alignment, continuous `P-R-N-D` cycling, and photorealistic/volumetric smoke & X-ray quality from VinBadge while keeping Canadian winter/salt-belt copy (`-10°C`, `60–100 km/h`, Ontario/Quebec/Atlantic road salt). |
| **CAD Pricing & Package Overhaul (`lib/vin-core.js`, `report.html`, `index.html`, `api/stripe-webhook.js`)** | Retired the **$30 CAD** Ontario lien check add-on. Lowered Single Report from $19 to **$17 CAD**, introduced **3-Pack ($39 CAD · $13.00/ea · Save 24%)** and **10-Pack ($99 CAD · $9.90/ea · Save 42%)**, added built-in promo codes **`DRIVEE15`** (15% off) and **`DRIVEEFREE`** (100% off -> `$0 CAD` instant checkout bypass across Single/3-Pack/10-Pack, plus dev hot-reload in `api/vin-checkout.js` & `api/vin-admin.js`) and reusable Pack Credit redemption (`DRV3-...` / `DRV10-...`). | Removes an unused SKU, sharpens entry price below $19 CAD, captures multi-car comparative buyers and small Ontario dealers with high-margin bundles, gives owners a `100%` free-check test/VIP promo code (`DRIVEEFREE`), and explains ServiceOntario UVIP / provincial PPSA lien lookup in FAQ/notes. |
| **Automated Stripe Checkout (`api/vin-checkout.js`, `api/stripe-webhook.js`, `api/order-status.js`)** | Replaced hardcoded `STRIPE_LINKS` Payment Links with `POST /api/vin-checkout` creating dynamic Stripe Checkout Sessions (`currency=cad`, inline `price_data`, `client_reference_id = VIN`, `metadata`, omitting `payment_method_types` so Apple Pay / Google Pay / Link / Cards work automatically). Updated `stripe-webhook.js` and `order-status.js` for `$17/$39/$99` (while still recognizing legacy `$19/$30` events) and local sandbox fallback. | Eliminates manual Stripe Product / Price / Payment Link edits whenever CAD pricing or promos change; attaches buyer VIN and tier metadata automatically on every session. |
| **Live Canadian Report Backend & Branding (`lib/vin-core.js`, `lib/vin-report-builder.js`, `api/vin-lookup.js`, `api/vin-unlock.js`, `vin-report.html`)** | Built server-side live VIN decoder + recall fetcher (NHTSA vPIC + Recalls + Transport Canada links), CAD private-sale/trade valuation, Wikimedia CC reference photo resolver, AuctionsAPI & NotedCar partner report connectors, Drivee trademark scrubber (`scrubToDriveeBranding`), HMAC-SHA256 stateless access tokens, interactive dossier UI (`/vin-report.html` with `KM` default + `KM/MILES` toggle and print-ready PDF), and fixed F-150 sample VIN check digit (`1FTFW1E84MFA19204` → `1FTFW1E8XMFA19204`). | Generates full reports live in the browser under **Drivee** branding in Canadian metric (`km`) & `$ CAD`, while keeping email delivery active as backup (`VIN_AUTO_FULFILL`). |
| **Inquiries, Sales & Margin Tracking (`api/vin-admin.js`, `vin-admin.html`, `api/stats.js`)** | Added persistent JSON ledger (`.vin-data/store.json` locally; `/tmp/drivee-vin-store.json` fallback on read-only serverless runtimes; `VIN_STORE_PATH` test override), tracking every VIN inquiry, paid order, pack code credit balance, promo usage, gross revenue (`$ CAD`), upstream API cost, net profit (`$ CAD`), and CSV export (`?format=csv`), alongside `vinFunnel` metrics inside `/api/stats`. | Audits revealed Drivee previously only logged raw events to Supabase `analytics` + `/analytics.html` without live report generation, credit balances, or upstream margin tracking. |
| **Homepage & Header Discoverability (`index.html`)** | Exposed `VIN Check [FREE]` in `#navLinks` drawer/menu, added a `Check VIN` pill CTA in `#topnav` beside `Scan your ticket →`, added a secondary hero link (`Buying a used car in Canada? Check any 17-digit VIN free →`) under `#heroScanBtn`, inserted `#vin-home-strip` lookup card right below `.strip`, and updated JSON-LD & visible `#faq` pricing to `$17 / $39 / $99 CAD`. | Makes Canadian VIN lookup discoverable in 1 click from the top header and homepage without disturbing any ticket-scanning hero elements or protected files. |

---

## 2. File-by-File Inventory

### Created Files
- [`lib/vin-core.js`](file:///Users/mdp/.t3/projects/drivee-vin/lib/vin-core.js): Canadian pricing tiers (`VIN_PRICING_CAD`), ISO-3779 VIN validator, `scrubToDriveeBranding`, persistent JSON ledger (`VIN_STORE_PATH` override), HMAC access tokens, pack credits, promo codes, NHTSA vPIC/recalls, CAD market valuation, Wikimedia CC photo resolver, Supabase event emitter.
- [`lib/vin-report-builder.js`](file:///Users/mdp/.t3/projects/drivee-vin/lib/vin-report-builder.js): Builds Drivee-branded Canadian Vehicle History Dossiers from AuctionsAPI (`AUCTIONS_API_KEY`), NotedCar (`NOTEDCAR_API_KEY`), HTML parser normalization (`km`-first), and 3 ISO-valid Canadian demo VINs (`2C4RDGBGXGR217456`, `KNAF55AC3L5071117`, `1FTFW1E8XMFA19204`).
- [`api/vin-lookup.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/vin-lookup.js): `POST` free pre-check returning NHTSA specs, recalls, CAD valuation, upstream coverage counts, and inquiry logging.
- [`api/vin-checkout.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/vin-checkout.js): `GET` promo quote + `POST` automated Stripe Checkout Session (`currency=cad`) or localhost sandbox fallback.
- [`api/vin-unlock.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/vin-unlock.js): `POST` dossier unlocker via signed `accessToken`, Stripe `sessionId`, `DRV3-`/`DRV10-` `packCode`, or `demo: true`.
- [`api/vin-admin.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/vin-admin.js): `GET` dashboard JSON & CSV export + `POST` promo creation, manual pack code issuance, and order simulation (`VIN_ADMIN_KEY` protected outside localhost).
- [`vin-report.html`](file:///Users/mdp/.t3/projects/drivee-vin/vin-report.html): Drivee Canadian Vehicle History Dossier viewer + print/PDF export + `KM`/`MILES` toggle + pack code status.
- [`vin-admin.html`](file:///Users/mdp/.t3/projects/drivee-vin/vin-admin.html): Drivee VIN back-office dashboard for inquiries, orders, margins, packs, and promos.
- [`assets/img/vin-sedan-xray-side.jpg`](file:///Users/mdp/.t3/projects/drivee-vin/assets/img/vin-sedan-xray-side.jpg): Dark sedan side X-ray graphic used in Checklist Step 05.
- [`VIN-CHANGELOG.md`](file:///Users/mdp/.t3/projects/drivee-vin/VIN-CHANGELOG.md): This itemized change log.

### Modified Files (Inline Comments Included in Source)
- [`report.html`](file:///Users/mdp/.t3/projects/drivee-vin/report.html): Head/JSON-LD SEO, responsive stretch & `.s3-van` cutout fix, `#navMenu` mobile drawer, 3-tier `$17/$39/$99 CAD` pricing + promo & pack credit UI, 6 VinBadge dark-instrument checklist panels, chart tooltip clamping, `km` default, `/api/vin-*` frontend integration, updated FAQ.
- [`index.html`](file:///Users/mdp/.t3/projects/drivee-vin/index.html): Header `VIN Check [FREE]` & `Check VIN` button, hero secondary CTA, `#vin-home-strip` lookup section, JSON-LD & visible FAQ `$17/$39/$99 CAD` pricing update.
- [`api/stripe-webhook.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/stripe-webhook.js): `$17/$39/$99 CAD` plan recognition + legacy `$19/$30`, `recordVinOrder` + Pack Code creation, optional `VIN_AUTO_FULFILL=true` report link/PDF email, returns `{ ok, orderNumber, packCode, reportUrl }`.
- [`api/order-status.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/order-status.js): Returns `tierId`, `packCode`, `accessToken`, and `reportUrl` (with local ledger fallback for sandbox/webhook orders).
- [`api/stats.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/stats.js): Exposes structured `vinFunnel` metrics alongside existing parking/ticket analytics.
- [`.env.example`](file:///Users/mdp/.t3/projects/drivee-vin/.env.example) & [`.gitignore`](file:///Users/mdp/.t3/projects/drivee-vin/.gitignore): Documented `VIN_ACCESS_SECRET` / `VIN_ADMIN_KEY` and ignored local `.vin-data/` storage.
- [`tools/verify-vin-gates.js`](file:///Users/mdp/.t3/projects/drivee-vin/tools/verify-vin-gates.js), [`tools/vin-workflow.js`](file:///Users/mdp/.t3/projects/drivee-vin/tools/vin-workflow.js), [`tools/simulate-vin-order.js`](file:///Users/mdp/.t3/projects/drivee-vin/tools/simulate-vin-order.js): Updated 7-gate scope allowlists, expanded HTML/API/smoke coverage across all 6 endpoints and 4 HTML pages, and updated dry-run simulator to `$17/$39/$99` CAD packages.

---

## 3. Existing Backend Audit & Stripe Automatic Checkout Architecture

### What Existed Before
Drivee previously shipped **webhook & telemetry endpoints only**:
- `api/stripe-webhook.js` verified Stripe signatures, emailed `reports@drivee.ca` / `drivee.canada@gmail.com` for manual pulling within 5–60 minutes, pinged Telegram, and inserted simple funnel rows into Supabase `analytics`.
- `api/order-status.js` queried Stripe's Checkout Session status for the post-payment modal.
- `api/stats.js` & `analytics.html` aggregated raw Supabase funnel counts.

**Gaps filled by this upgrade:** Drivee had **no** live vehicle history report generator, **no** report viewer/PDF page, **no** pack credit balance engine, and **no** upstream API cost/margin ledger.

### How Stripe Works Automatically Now
Instead of static Stripe Payment Links (`STRIPE_LINKS`), [`api/vin-checkout.js`](file:///Users/mdp/.t3/projects/drivee-vin/api/vin-checkout.js) calls `POST https://api.stripe.com/v1/checkout/sessions` dynamically with `currency=cad`, exact `unit_amount` (after any promo code), dynamic bundle `product_data`, `client_reference_id = VIN`, and metadata (`vin`, `tierId`, `credits`).  
- **Do you need to manually create Products/Prices/Payment Links in Stripe for package or promo changes?** **No.** Changing CAD prices or pack sizes in `lib/vin-core.js` updates Stripe Checkout automatically.
- **One-time setup required in Stripe + Vercel:**
  1. Set `STRIPE_SECRET_KEY` (restricted key with **Checkout Sessions Read/Write** is sufficient) and `STRIPE_WEBHOOK_SECRET` in Vercel Environment Variables (plus `VIN_ACCESS_SECRET` and `VIN_ADMIN_KEY`).
  2. Point your Stripe Webhook endpoint (`https://www.drivee.ca/api/stripe-webhook`) at `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, and `charge.refunded`.
  3. *(Optional for live automated report pulling)* Add `AUCTIONS_API_KEY` and/or `NOTEDCAR_API_KEY`, and set `VIN_AUTO_FULFILL=true` when ready for unattended live report fulfillment.

---

## 4. Recommended Next-Phase VinBadge Features for Drivee Canada
1. **1-Check Cap on Promo Codes (e.g., `FREE1VIN`):** Adapt VinBadge's per-IP + email rate cap so giveaways can't be farmed.
2. **Signed Photo Proxy (`/api/vin-media`):** Proxy external auction/salvage images cleanly through Drivee so browsers never leak upstream URLs or hit mixed-content/hotlink blocks.
3. **Bilingual EN / FR-CA Toggle:** Support Quebec buyers (`km`, SAAQ context, French labels) across `/report.html` and `/vin-report.html`.
4. **Build Sheet / Window Sticker & Provincial Landed-Cost Estimator:** Show factory trim/options and Ontario HST (13%), BC PST/GST, or QC QST total-out-the-door cost in `$ CAD`.
5. **First-Touch Attribution:** Capture `?utm_source` / `gclid` / `fbclid` into orders so `/vin-admin.html` tracks ROAS per ad campaign.


---

## Multi-Step Report Loader & Live Upstream Pipeline Fixes (2026-11-24)

| File | Change | Reason |
|---|---|---|
| `vin-report.html` | Replaced plain `.loading-box` with VinBadge-inspired 4-step `.pipeline-loader` (`LIVE REPORT PIPELINE ACTIVE`, live elapsed-seconds counter + VIN badge, animated progress bar, 4 stage cards transitioning `QUEUED -> RUNNING -> DONE` with cobalt spinner & green checks); also wired into Pack Code redemption and replaced misleading `0 / Verified` KPIs on `sandbox-preview` reports with `— / Needs live API key`. | Matches VinBadge's staged compilation UX in Drivee's light palette and makes unconfigured local sandbox previews transparent. |
| `lib/vin-report-builder.js` | Fixed `checkFreeUpstreamCoverage()` from `POST /vhr/checks` to AuctionsAPI's verified `GET /reports/check-records/{vin}`; ported VinBadge's `window.__INITIAL__DATA__` JSON Carfax parser (`parseCarfaxInitialDataToDrivee()`) ahead of `<tr>` fallback so live AuctionsAPI Carfax HTML extracts owners, accidents, service records, and odometer progression; stopped caching `sandbox-preview` fallback dossiers so adding API keys immediately returns live history. | Prevents empty reports once `AUCTIONS_API_KEY` is added and eliminates stale `sandbox-preview` cache poisoning. |
| `lib/vin-core.js` | Updated `capWords()` to preserve automotive acronyms (`BMW`, `GMC`, `RAM`, `AWD`, etc.) and calibrated `estimateCanadianValueCad()` for luxury/performance badges (e.g., `2020 BMW M340i` now estimates `$37,900 CAD` instead of `$14,300 CAD`, and uppercase `BMW` fixes live NHTSA recall matching from `0` to `10` recalls). | Fixes `Bmw` casing, missing recalls, and unrealistic luxury valuations observed on `WBA5U7C09LAF53985`. |
| `api/vin-unlock.js`, `api/vin-lookup.js` | Added non-Vercel local dev `require.cache` refresh for `lib/vin-core` and `lib/vin-report-builder`. | Keeps local `_dev-server.js` hot-synced with library edits without manual restarts. |
| `tools/verify-vin-gates.js` | Added Gate 4 assertions for `vin-report.html` multi-step loader markers and Gate 5 unit tests for `BMW`/`GMC` casing, luxury CAD valuation, `window.__INITIAL__DATA__` HTML parsing + trademark scrubbing, and verified `/reports/check-records/` endpoint. | Enforces regression coverage across all 7 verification gates (`7/7 passed`). |


---

## Executive VinBadge-Grade Dossier Redesign (2026-11-24)

| File | Change | Reason |
|---|---|---|
| `lib/vin-report-builder.js` | Upgraded `parseCarfaxInitialDataToDrivee()` to `schemaVersion: 2`: extracts `pointOfImpactIdentifiers` impact zones (`left_front`, `front`, `right_front`, `left_side`, `right_side`, etc.) from both `accidentDamageSection` and `detailsSection.ownerBlocks`, plus per-event `ownerNumber`, `headline`, `location`, `pills[]` chips, `listing` category, owner date spans / annual pace, and per-reading odometer source/owner metadata; auto-refreshes pre-v2 cache entries from `/reports/my-history` at `$0`. | Supplies all structured fields required for VinBadge-grade impact blueprints, owner-shaded odometer bands, and pill-tagged chronological history. |
| `vin-report.html` | Rebuilt report renderer into the executive VinBadge dossier architecture natively styled in Drivee Canada's light palette: single-row sticky running header (`KM/MI` toggle, jump links, `Download PDF`), soft-sky gradient hero banner with framed vehicle photo + spec chips, `DRIVEE QUICK VERDICT` + 2×2 tinted KPI tiles, multi-color segmented Ownership Timeline + left-accented owner cards, interactive owner-shaded Odometer History SVG chart + 4-stat footer, Contoured Top-Down Collision Vehicle Blueprint SVG + side-by-side Open Recalls, 8-row Condition & Title Checks Matrix by owner, 6-card Service Snapshot strip, owner-grouped Detailed History with category legend & live filter chips, and Before You Buy Canadian Checklist + CAD Market Valuation + Glossary. | Matches the user's VinBadge reference dossier (`WBA5U7C09LAF53985`) while staying 100% Drivee Canada (`km`-first, CAD values, zero third-party trademark leaks, zero mobile horizontal overflow at `390px`). |


---

## Dedicated Official Letter-Size PDF / Print Dossier Fix (2026-11-24)

| File | Change | Reason |
|---|---|---|
| `vin-report.html` | Scoped responsive mobile `@media (max-width: ...)` rules to `@media screen and (...)` so Letter-width print viewports (`~739px`) never collapse multi-column grids into a mobile stack; added `-webkit-print-color-adjust: exact` / `print-color-adjust: exact` + `@page { size: letter portrait; margin: 0.36in 0.40in; }`; built a dedicated `.print-only` `#print-dossier` multi-page document (Page 1: Official Drivee Cert Header + Hero + Verdict + KPIs + Ownership Timeline + Owner-Shaded Odometer Chart [`770px`]; Page 2: 5-Zone Collision Blueprint + 8-Row Condition Matrix + Open Recalls + CAD Valuation & Checklist [`959px`]; Page 3+: Complete untruncated owner-grouped chronological ledger with per-row `break-inside: avoid`); updated `#print-pdf-btn` to wait for hero image decode and set `document.title = 'Drivee-Report-' + r.vin` so browsers default to a clean PDF filename. | Fixes poor PDF rendering (collapsed mobile columns, washed-out colors, split cards, and truncated timelines) on `Download PDF`. |
| `tools/verify-vin-gates.js` | Extended Gate 4 checks to enforce `#print-dossier`, `print-color-adjust: exact`, and `@page` rules in `vin-report.html`. | Guards print/PDF regressions automatically (`7/7` gates passing). |


---

## True Server-Side Vector PDF Dossier Engine (`POST /api/vin-pdf`, 2026-11-24)

| File | Change | Reason |
|---|---|---|
| `lib/vin-pdf-generator.js` | Built a zero-dependency pure-Node PDF 1.4 vector engine (`612×792pt` Letter, `FlateDecode` compressed streams, calibrated Helvetica/Courier text wrapping, native `/DCTDecode` JPEG hero photo embedding, vector category badges, contoured top-down 5-zone collision blueprint, owner-shaded odometer chart, 9-row condition matrix, 6-card service snapshot, auto-paginated owner-grouped detailed history with `(continued)` headers & pill chips, 6-item Drivee Canadian checklist, Glossary, and Customer/Seller signature lines). | Replaces inconsistent browser `window.print()` output with a pixel-perfect direct `.pdf` download matching `VinBadge-Dossier-WBA5U7C09LAF53985.pdf` with zero `npm install` needed. |
| `api/vin-pdf.js` | Added `POST /api/vin-pdf` endpoint returning `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="Drivee-Dossier-{VIN}.pdf"` (respecting current `km` / `mi` unit selection). | Enables one-click instant PDF file download in both local `_dev-server.js` and Vercel serverless functions. |
| `vin-report.html` | Wired **Download PDF** button directly to `POST /api/vin-pdf` (Blob download with loading state + `window.print()` fallback) and added a separate Print icon button beside it. | Gives buyers an instant official `.pdf` file download without browser print-dialog artifacts. |
| `tools/verify-vin-gates.js` | Added Gate 5 offline verification of `POST /api/vin-pdf` (`200`, `application/pdf`, `%PDF-1.4` header, `%%EOF` trailer, >3.5 KB binary output). | Keeps all 7 verification gates green (`7/7`, 15 offline assertions). |


---

## Admin Login Gate, Daily/Weekly Charts, GitHub-Style 52-Week Heatmap & Hardened 160-Bit Pack Codes (2026-11-24)

| File | Change | Reason |
|---|---|---|
| `lib/vin-core.js` | Upgraded 3-Pack & 10-Pack credit codes from 32-bit hex to **v2 cryptographically hardened 160-bit codes** (`DRV3-XXXXXX-XXXXXX-XXXXXX-XXXXXX-MMMMMMMM`: 120-bit CSPRNG nonce in unambiguous Crockford Base32 + 40-bit keyed HMAC-SHA256 authentication tag verified with `crypto.timingSafeEqual` pre-lookup); stored pack codes only as keyed HMAC-SHA256 hashes + masked previews (`DRV3-K7M9-••••-••••-F9Q2`), encrypted order receipt copies with AES-256-GCM at rest (`packCodeEnc`), added `revokePackCreditCode()`, added sliding-window per-IP rate limiting (`checkRateLimit` / `recordRateLimitFailure`), added timing-safe Admin Auth + signed HttpOnly session cookie helpers, and added `buildVinAnalytics()` (`dailySeries` 30d, `weeklySeries` 12w by tier, 52-week GitHub-style `heatmap` with streaks & peak day). | Eliminates brute-force / guessing / database-leak attacks on 3-pack and 10-pack codes, enforces real Admin Login, and powers executive buy analytics. |
| `api/vin-admin.js` | Replaced passwordless localhost access and insecure `?key=` query-string auth with `POST` `{ action: "login" / "logout" }` issuing a signed `HttpOnly; SameSite=Strict` cookie (`drivee_vin_admin`, `Secure` on HTTPS/Vercel, 5-failure/15-min `429` lockout), strict `401` on all unauthenticated reads/writes, masked pack codes in `GET` and CSV export, one-time plaintext reveal on `issue_pack`, and one-click `revoke_pack`. | Protects the VIN dashboard and customer/sales ledger behind real authentication both locally and in production. |
| `api/vin-unlock.js` | Added per-IP brute-force lockout (`5` failed pack-code attempts per 15 minutes -> `429 Too Many Requests` with `Retry-After`) and generic invalid/exhausted error messages to prevent code enumeration. | Stops automated credential-stuffing or guessing attacks on 3-pack and 10-pack redemption. |
| `vin-admin.html` | Built a Drivee light-theme **Admin Sign-In Gate** + executive authenticated dashboard featuring: 6-card KPI strip, **GitHub-style 52-week (1-year) Buys / Revenue CAD / Inquiries Activity Heatmap** with hover tooltips & streak badges, **Daily Buys & Velocity** (`14D`/`30D` + `Buys`/`CAD` toggle), **Weekly Buys by Package** (12-week stacked `$17/$39/$99` bar chart), one-time **Hardened Multi-Pack Code** reveal + Copy button, and **Revoke** actions in the masked pack ledger. | Gives Drivee operators an authenticated, executive-grade daily/weekly sales and activity command center. |
| `.env.example`, `tools/verify-vin-gates.js` | Documented `VIN_ADMIN_USER` & `VIN_ADMIN_PASSWORD` in `.env.example`; expanded Gates 4, 5, and 6 to verify Admin Login (`401` -> cookie login -> logout), 30d/12w/52w analytics payloads, v2 pack code HMAC tamper rejection, same-VIN idempotency, `429` brute-force lockout, masked ledger/CSV output, and instant pack revocation (`7/7` gates, 21 offline assertions). | Enforces automated security and analytics regression coverage on every build. |


---

## CAD ↔ USD Converter, Buyer Email CRM, Promo Revocation, Support Tools & Browser Pack Key Wallet (2026-11-25)

| File | Change | Reason |
|---|---|---|
| `lib/vin-core.js` | Added `CAD_TO_USD_RATE` FX helper (`0.72` default), persistent + order-aggregated **Customer Email Database** (`customers` CRM tracking orders, repeat buyers, total spent CAD, avg order, credits bought, active packs, and VINs checked + `exportCustomersCsv()`), promo lifecycle (`setPromoCodeActive()` / `deletePromoCode()`), order refunds (`markOrderRefunded()` auto-revoking linked pack keys), courtesy pack credit top-ups (`adjustPackCredits()`), support pack inspector (`inspectPackCreditCode()`), read-only browser wallet balance check (`checkPackCreditStatus()`), and `mtimeMs:size` file-stamp sync in `readStore()` so multi-endpoint changes never serve stale memory caches. | Equips Drivee operators with CAD/USD reporting, a full purchasing customer email database, promo revocation, refund & support tools, and cross-endpoint consistency. |
| `api/vin-admin.js`, `api/vin-unlock.js`, `api/order-status.js`, `api/vin-checkout.js` | Wired `?format=customers_csv`, `?fx=` rate forwarding, `revoke_promo` / `restore_promo` / `delete_promo`, `mark_refunded`, `adjust_pack_credits`, `inspect_pack`, rate-limited `{ checkPackOnly: true }` balance checks, and `remainingCredits` / `totalCredits` on checkout & unlock responses. | Connects admin CRM, promo controls, support tools, and live browser pack balance syncing end-to-end. |
| `vin-admin.html` | Added top-bar **CAD ↔ USD switcher** + editable FX rate input converting all KPIs, 52-week heatmap, daily/weekly charts, orders, and buyer LTV live; added **Customer Email Database & Lifetime Spend** table with search, `Copy All Emails`, and `Export Buyers CSV`; upgraded **Promo Code Manager** with Revoke / Restore / Delete; added **Support Pack Key Inspector**; added searchable/filterable Orders with one-click **Refund** and Pack Ledger **`+1` credit top-up**. | Gives operators complete financial, CRM, promo, and customer-support control from one authenticated dashboard. |
| `report.html`, `vin-report.html` | Added automatic **Browser Pack Key Wallet** (`localStorage` `drivee_vin_pack_v1`): automatically saves purchased or redeemed 3-Pack / 10-Pack keys, strips `&pack=` from URLs via `history.replaceState`, silently syncs live remaining credits on page load, pre-fills pack inputs, and displays a 1-click **"Unlock VIN with 1 Saved Credit (X left) →"** bar with Copy & Forget controls. | Eliminates re-entering long cryptographic pack keys across multiple VIN checks while keeping keys out of shared URLs. |
| `tools/verify-vin-gates.js` | Expanded Gates 4 & 5 to verify CAD→USD FX metadata, buyer email CRM aggregation + Buyers CSV, promo revoke/restore enforcement, support pack inspector, `+1` credit adjustment, order refunds, read-only `checkPackOnly`, and Saved Pack Wallet DOM markers (`7/7` gates, `28` offline assertions). | Protects every new operator and browser-wallet workflow against regressions. |


---

## Prominent Sample Dossier CTA Buttons & Admin Confirmation Modal Guards (2026-11-25)

| File | Change | Reason |
|---|---|---|
| `report.html` | Promoted the buried low-contrast `.ub-note` sample link into two high-visibility CTA buttons: a **`LIVE DEMO · Preview full live Drivee sample dossier →`** pill directly below the hero sample strip (`#hero-sample-dossier-btn`), and a high-contrast white **`Preview Full Sample Dossier →`** button with eye icon in the `.ub-head` of `#unlock-plans` (`#unlock-sample-dossier-btn`). | Makes it effortless for buyers to preview the full Drivee Canadian dossier and PDF before paying. |
| `vin-admin.html` | Added a frosted-backdrop executive confirmation modal (`#confirm-modal`, Escape/backdrop dismiss, default focus on `Cancel`) guarding every critical operator mutation: **Refund Order** (shows Order #, Amount, Buyer, VIN & Linked Pack), **Revoke Pack Key**, **Grant `+1` Courtesy Credit**, **Revoke Promo Code**, **Restore Promo Code**, and **Delete Promo Code**. | Prevents accidental refunds, key revocations, promo toggles, or duplicate credit top-ups from misclicks. |
| `tools/verify-vin-gates.js` | Extended Gate 4 DOM assertions to enforce `#hero-sample-dossier-btn`, `#unlock-sample-dossier-btn`, and `#confirm-modal`. | Ensures visibility and misclick-protection stay guarded across builds (`7/7` gates). |


---

## Flagship Midnight-Cobalt Pricing Palette & `0.0px` Button Alignment Overhaul (2026-11-25)

| File | Change | Reason |
|---|---|---|
| `report.html` | Synthesized specialist subagent palette + WCAG AA/AAA accessibility audits to overhaul `#unlock-plans` CSS: removed the broken `.plan.pack10` fade-to-white gradient and duplicate legacy `.plan` block; introduced cohesive midnight-navy glass cards (`#09112A` → `#111E42`) with a single **Drivee Cobalt** (`#2D63F0` → `#3D74FF`) focal tier on `$39 3-Pack` and dark-backed emerald savings pill (`#0F2537` / `#6EE7B7`) on `$99 10-Pack`; raised `.p-unit` contrast to `#93C5FD` (`8.8:1`) / `#6EE7B7` (`10.8:1`), bullets to `#CBD5E1`, and footer note to `#94A3B8`; converted `.aux-box` promo/pack trays to native dark-glass wells; locked all 3 tier cards to equal height (`366.8px`) and exact **`0.0px` CTA vertical alignment** via `display: flex; flex-direction: column;` + `flex: 1` on `ul` + `margin-top: auto` on `.p-btn`, plus `row-gap: 28px` (`18px` badge clearance) on mobile `<= 820px`. | Eliminates the clashing palette, unreadable `$99` gradient / dark-blue unit prices, competing bright greens, and misaligned `$39` button reported by the user. |


---

## Global Removal of "Customer Favorites" & Third-Party Dealer Review Clutter Across All Reports & PDFs (2026-11-25)

| File | Change | Reason |
|---|---|---|
| `lib/vin-core.js` | Extended `scrubToDriveeBranding()` and added `cleanDealerSourceText()` to globally strip `N Customer Favorites`, `Customer Favorite(s)`, `Verified Reviews`, `N.N / 5.0` / `out of 5` star ratings, `Top-Rated Dealer`, `Dealer of the Year`, upstream `City, null` template artifacts, dealer phone numbers, and bare dealer URLs while preserving dealer names & city/province cleanly. | Permanently prevents `"6 Customer Favorites"`, `"175 Customer Favorites"`, and similar third-party dealer review strings from appearing on any car report. |
| `lib/vin-report-builder.js` | Applied `cleanDealerSourceText()` in both `window.__INITIAL__DATA__` and `<tr>` fallback parsers, and added `sanitizeDriveeReport()` invoked across all demo, live, and **already-cached** reports before returning. | Guarantees both freshly fetched and previously cached vehicle reports are always scrubbed. |
| `vin-report.html`, `lib/vin-pdf-generator.js` | Added matching defense-in-depth scrubbing inside `cleanReportCopy()` (DOM `esc`) and `sanitizePdfText()` (PDF vector generator). | Ensures neither the interactive browser dossier nor any downloaded `.pdf` can ever display `"Customer Favorites"` or related review clutter. |
| `tools/verify-vin-gates.js` | Added Gate 5 regression assertions verifying dirty dealer HTML (`Port Perry Automotive ... 6 Customer Favorites 4.9 / 5.0 120 Verified Reviews ... 175 Customer Favorites`) strips all clutter while preserving `"Port Perry Automotive"` (`7/7` gates, `30` offline assertions). | Prevents regressions across all report parsers and future builds. |


---

## Homepage Header De-Duplication — Option 1 (`index.html`, 2026-11-25)

| File | Change | Reason |
|---|---|---|
| `index.html` | Added `.nav-vin-mobile-only` to the `VIN Check [FREE]` item inside `#navLinks` so desktop (`> 760px`) displays only the crisp right-side **`Check VIN`** button beside **`Scan your ticket →`** (`0` header duplication, ~120px extra nav breathing room), while mobile (`<= 760px`) keeps **`VIN Check [FREE]`** inside the Menu dropdown when `.cta-vin` hides. | Eliminates redundant dual VIN mentions in the desktop header while preserving mobile menu discoverability. |



---

## Comprehensive Security & Bug Audit Fixes (2026-11-25)

| File | Severity & Fix | Reason |
|---|---|---|
| `lib/vin-pdf-generator.js`, `api/vin-pdf.js` | **[HIGH Security — SSRF & Memory/CPU DoS]** Added strict HTTPS public hostname allowlist (`isAllowedHeroPhotoUrl`) blocking private/loopback/metadata IPs, `localhost`, non-HTTPS, credentials, custom ports, and arbitrary domains; enforced `redirect: 'error'`, `content-length` check + streaming byte cap (`2.5 MB`) in `fetchHeroJpeg`; capped incoming `/api/vin-pdf` payload arrays (`events <= 250`, `owners <= 25`, `odometerReadings <= 250`, `recalls <= 50`). | Prevents `POST /api/vin-pdf` from being abused as an SSRF proxy or memory/CPU exhaustion vector. |
| `lib/vin-core.js`, `api/stripe-webhook.js` | **[HIGH Business Logic — Stripe Refund Sync]** Added `markOrderRefundedByPaymentIntent(paymentIntent, true)` and invoked it in Stripe's `charge.refunded` webhook handler so refunds issued directly in Stripe Dashboard automatically mark the ledger order `refunded` and revoke its linked 3-Pack / 10-Pack code. | Closes a loophole where a buyer refunded in Stripe Dashboard could keep redeeming remaining multi-pack credits. |
| `lib/vin-core.js` | **[MEDIUM Security — CSV Formula Injection]** Added `escCsvCell()` in `exportOrdersCsv()` and `exportCustomersCsv()` to neutralize leading spreadsheet formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) with a leading `'` while keeping signed numeric columns intact. | Protects operators opening exported Buyer / Order CSVs in Excel or Google Sheets from formula injection. |
| `lib/vin-core.js` | **[MEDIUM Bug — Promo Case Normalization]** Normalized `promoCode` via `.trim().toUpperCase()` inside `recordVinOrder()` before recording and incrementing `store.promoCodes[code].usesCount`. | Ensures lowercase promo codes accurately increment usage counters and match `maxUses` caps. |
| `vin-admin.html` | **[LOW Bug — Strict Private Browsing]** Wrapped `localStorage.getItem('drivee_admin_fx')` in `renderAll()` inside `try/catch`. | Prevents uncaught `SecurityError` crashes in strict private-browsing contexts where `localStorage` is blocked. |
| `report.html`, `api/order-status.js` | **[LOW Copy & Dev Consistency]** Updated JSON-LD `WebPage.description` (`from $19` → `from $17 CAD (3-pack $39, 10-pack $99)`), replaced sample card `"No damage reported to CARFAX"` with `"No damage reported across Canadian & insurer registries"`, and added local-dev `require.cache` refresh to `api/order-status.js`. | Eliminates stale pricing/CARFAX references and keeps local dev hot-reloading consistent across all endpoints. |
| `tools/verify-vin-gates.js` | Added 4 automated Gate 5 regression assertions covering SSRF allowlist rejection, Stripe `charge.refunded` order + pack revocation sync, CSV formula injection neutralization, and lowercase promo normalization (`7/7` gates, `34` offline assertions). | Prevents any of the audited bugs or security issues from regressing. |



---

## 100% Vercel Production Readiness — Durable Supabase Postgres Store & Production Lockdowns (2026-11-25)

| File | Change | Reason |
|---|---|---|
| `lib/vin-store-supabase.js`, `tools/vin-supabase-schema.sql` | Created a zero-dependency Supabase PostgREST durable bucket store backed by RLS-locked `public.vin_store_buckets` (`SUPABASE_SERVICE_ROLE_KEY` server-side only; zero anon/public access) with **Optimistic Concurrency Control (CAS on `version`)** and automatic randomized-backoff retries across `ledger` (atomic orders + pack codes + customers + promos + webhook dedupe), `inquiries`, `report:<VIN>` individual report cache rows, and `ratelimit:<bucket>:<ipHash>` brute-force lockouts. | Eliminates Vercel serverless `/tmp` ephemerality and multi-lambda race conditions so pack credits, orders, buyer emails, promo revocations, webhook deduplication, and brute-force lockouts persist durably and atomically across cold starts and parallel instances. |
| `lib/vin-core.js` | Wired dual-mode durable `*Async` operations (`hydrateStore`, `recordVinOrderAsync`, `redeemPackCreditCodeAsync`, `markOrderRefundedAsync`, `markOrderRefundedByPaymentIntentAsync`, `claimWebhookEventAsync`/`releaseWebhookEventAsync`, `getCachedReportAsync`/`saveCachedReportAsync`, `checkRateLimitAsync`/`recordRateLimitFailureAsync`/`clearRateLimitAsync`, `getVinDashboardStatsAsync`, `exportOrdersCsvAsync`, `exportCustomersCsvAsync`, plus `getProductionReadiness()`). Locked down built-in `DRIVEEFREE` 100% promo on Vercel production (`VERCEL=1`) unless `VIN_ALLOW_FREE_PROMO=true` or explicitly restored by an admin, and made `getSigningSecret()` fail closed on Vercel if all signing secrets are unset. | Keeps local dev/tests zero-config while guaranteeing strict production safety on Vercel. |
| `api/vin-admin.js`, `api/vin-checkout.js`, `api/vin-unlock.js`, `api/vin-lookup.js`, `api/order-status.js`, `api/stripe-webhook.js`, `lib/vin-report-builder.js` | Migrated every serverless handler and report cache path to the durable `*Async` store methods, added cross-instance Stripe webhook event deduplication (`claimWebhookEventAsync` / `releaseWebhookEventAsync`), and enabled safe `*.vercel.app` preview origin handling in `api/vin-checkout.js`. | Ensures every production Vercel route reads and writes durable Postgres state atomically. |
| `vin-admin.html`, `.env.example` | Added a live Storage Backend badge (`Supabase Postgres · Durable`, `Local JSON`, or red `Ephemeral /tmp · Configure Supabase` warning banner when running on Vercel without `SUPABASE_SERVICE_ROLE_KEY`) and documented all production env vars in `.env.example`. | Gives operators immediate visual confirmation of storage durability and production readiness. |
| `tools/verify-vin-gates.js` | Added Gate 5 Test 16 verifying Supabase CAS conflict auto-retry, cross-lambda cold-start pack redemption, `report:<VIN>` caching, durable Stripe webhook deduplication, `DRIVEEFREE` Vercel production lockdown, and fail-closed `VIN_ACCESS_SECRET` (`7/7` gates, `42` offline assertions). | Proves full Vercel production durability and security offline without touching live services. |
