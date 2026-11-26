# 2026-11-26 — Google Analytics 4 + Google Ads tracking

Everything changed on 26 Nov 2026 to prepare Drivee for Google Ads, and how to undo each piece.
This folder is excluded from the website deploy (`.vercelignore`).

## Code changes

Full diff: `code.patch`. File list: `files-changed.txt`.

| What | Where |
|---|---|
| New shared tag script (GA4 + Ads), IDs in one place | `assets/js/dv-analytics.js` |
| Script tag added before `</head>` on 36 public pages (not vin-admin, analytics dashboards or the 10 protected parking files) | all `*.html`, `blog/*`, `signs/*`, `parking-signs/*` |
| `dvTrack` events also forwarded to GA4 (`report_buy_click` → `begin_checkout`) | `index.html`, `report.html`, `contact.html` |
| Ad click id (`gclid`/`gbraid`/`wbraid`) saved for 90 days and sent to Stripe Checkout metadata | `lib/vin-api-checkout.js`, `report.html`, `vin-report.html` |
| `/api/order-status?session_id=` now also returns `amount` and `currency` | `api/order-status.js` |
| Purchase conversion fired once per Stripe session, live payments only (`cs_live_`), after `paid === true` | `vin-report.html` (dynamic checkout), `report.html` (legacy `?paid=1`) |
| Privacy policy: new "Google Analytics and Google Ads" section, "Who else sees your data" reworded, date → 26 Nov 2026 | `privacy.html` |

Protected files untouched (0-byte diff): `app.html`, `account.html`, `mechanic.html`, `enforcement-map.html`, `vercel.json`, `sw.js`, `api/scan-ticket.js`, `api/claude.js`, `api/track.js`, `api/lead.js`. No new files in `api/` (still 12).

### Undo the code

- Quick off switch, no redeploy of pages needed beyond this file: set `GA4_ID`, `ADS_ID`, `ADS_PURCHASE_LABEL` to `''` in `assets/js/dv-analytics.js`. Nothing loads from Google after that.
- Full revert after it is merged: `git revert <merge commit>`.
- Full revert from this folder on any checkout: `git apply -R _changes/2026-11-26-analytics-ads/code.patch`.

## Account changes (outside the code)

| Service | What was done | Undo |
|---|---|---|
| Google Analytics | New account **Drivee** (a417507223), property **drivee.ca** (p565952719), web stream `https://www.drivee.ca` (16421126876), Measurement ID **G-JSWWRDD7SN**. Canada, Toronto time, CAD, industry Automotive, event data retention 14 months. | GA Admin → Account settings → Move to trash |
| Google Analytics ↔ Search Console | Linked Search Console domain property `drivee.ca` to the GA4 web stream. | GA Admin → Product links → Search Console links → remove |
| Google Ads | New account **221-973-5358** "Drivee": billing country Canada, Toronto time, CAD, final URL `https://www.drivee.ca/report.html`. No campaign created. Did NOT link the AZXA YouTube channel, the unrelated business profile, or a phone number. | Ads → Admin → Account settings → Account status → Cancel account |
| Search Console | Already verified by DNS TXT before this work — no change. | — |

## Still to do (as of writing)

- [ ] Card added to Google Ads 221-973-5358 (owner does this)
- [ ] Conversion action "VIN Report Purchase" (Purchase, Primary, values from the tag, CAD, count Every) → put `AW-…` and label into `assets/js/dv-analytics.js`
- [ ] Link Google Ads ↔ GA4, auto-tagging on
- [ ] Access for the partner account: Google Ads Standard, GA4 Editor, Search Console Full
- [ ] Second empty Google Ads account "VinBadge" (billing Canada, USD), no campaign
- [ ] Merge + production deploy, then check GA4 Realtime

## Not done on purpose

- PostHog — not needed for the $100 test.
- Enhanced Conversions (buyer email to Google) — the privacy policy says we do not send email to Google.
- Search campaign — the partner uploads his own reviewed CSV, paused.
- `vin_cta` clicks still rejected by our own `/api/track` (fix would touch protected `api/track.js`); GA4 receives them.
