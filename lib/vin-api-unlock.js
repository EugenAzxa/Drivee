/**
 * POST /api/vin-unlock
 * Unlocks & builds a Drivee-branded Canadian Vehicle History Dossier:
 *   - demo: true         -> unlocks built-in Canadian sample VINs (no charge)
 *   - accessToken        -> verifies HMAC-signed unlock token
 *   - sessionId (cs_...) -> checks local ledger or verifies live with Stripe API
 *   - packCode (DRV3-..) -> redeems 1 pack credit & issues signed token
 */

'use strict';

if (!process.env.VERCEL) {
  try {
    delete require.cache[require.resolve('./vin-store-supabase')];
    delete require.cache[require.resolve('./vin-core')];
    delete require.cache[require.resolve('./vin-report-builder')];
  } catch { /* ignore */ }
}

const {
  checkPackCreditStatusAsync,
  checkRateLimitAsync,
  clearRateLimitAsync,
  extractClientIp,
  findOrderBySessionIdAsync,
  getTierByAmountCadCents,
  getVinTier,
  hashIp,
  recordRateLimitFailureAsync,
  recordVinOrderAsync,
  redeemPackCreditCodeAsync,
  signReportAccessToken,
  validateVin,
  verifyReportAccessToken,
} = require('./vin-core');
const { buildLiveDriveeReport } = require('./vin-report-builder');

const PACK_REDEEM_MAX_FAILURES = 5;
const PACK_REDEEM_WINDOW_MS = 15 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) || {};

    // Read-only browser pack wallet balance check (does NOT spend a credit; rate-limited)
    if (body.checkPackOnly && body.packCode) {
      const ipHash = hashIp(extractClientIp(req));
      const rl = await checkRateLimitAsync('pack_redeem', ipHash, PACK_REDEEM_MAX_FAILURES, PACK_REDEEM_WINDOW_MS);
      if (rl.blocked) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        return res.status(429).json({
          ok: false,
          error: `Too many invalid pack code attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`,
        });
      }
      const st = await checkPackCreditStatusAsync(body.packCode);
      if (!st.ok) {
        await recordRateLimitFailureAsync('pack_redeem', ipHash, PACK_REDEEM_WINDOW_MS);
        return res.status(400).json(st);
      }
      await clearRateLimitAsync('pack_redeem', ipHash);
      return res.status(200).json(st);
    }

    const check = validateVin(body.vin || '');
    if (!check.valid) {
      return res.status(400).json({ ok: false, error: check.error });
    }
    const vin = check.vin;

    let authorized = false;
    let allowPaidFetch = false;
    let packCode = null;
    let remainingCredits = null;
    let totalCredits = null;
    let accessToken = body.accessToken || null;
    let tierId = body.tierId || null;

    // 1. Signed access token (issued by checkout, webhook, or pack redemption)
    if (accessToken && verifyReportAccessToken(vin, accessToken)) {
      authorized = true;
      allowPaidFetch = true;
    }

    // 2. Stripe Checkout Session verification (survives serverless restarts)
    if (!authorized && body.sessionId) {
      const sid = String(body.sessionId || '').trim();
      const recorded = await findOrderBySessionIdAsync(sid);
      if (recorded && (!recorded.vin || recorded.vin === vin)) {
        authorized = true;
        allowPaidFetch = true;
        packCode = recorded.packCode || null;
        remainingCredits = recorded.remainingCredits != null ? recorded.remainingCredits : null;
        totalCredits = recorded.totalCredits != null ? recorded.totalCredits : null;
        accessToken = recorded.accessToken || signReportAccessToken(vin, sid);
        tierId = recorded.tierId;
      } else if (/^cs_(test|live)_[A-Za-z0-9_]{10,200}$/.test(sid) && process.env.STRIPE_SECRET_KEY) {
        const sr = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sid)}`, {
          headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
        });
        if (sr.ok) {
          const s = await sr.json();
          const sVin = String((s.metadata && s.metadata.vin) || s.client_reference_id || '').toUpperCase();
          if (s.payment_status === 'paid' && (!sVin || sVin === vin)) {
            const matchedTier =
              (s.metadata && s.metadata.tierId && getVinTier(s.metadata.tierId)) ||
              getTierByAmountCadCents(s.amount_total) ||
              getVinTier('single');
            const order = await recordVinOrderAsync({
              sessionId: sid,
              paymentIntent: typeof s.payment_intent === 'string' ? s.payment_intent : '',
              vin,
              vehicleTitle: (s.metadata && s.metadata.vehicleTitle) || `VIN ${vin}`,
              tierId: matchedTier.id,
              amountCad: s.amount_total != null ? s.amount_total / 100 : matchedTier.priceCad,
              customerEmail: (s.customer_details && s.customer_details.email) || s.customer_email || '',
              customerName: (s.customer_details && s.customer_details.name) || '',
              promoCode: (s.metadata && s.metadata.promoCode) || null,
              creditsTotal: Number((s.metadata && s.metadata.credits) || matchedTier.credits),
              status: 'paid',
              livemode: Boolean(s.livemode),
              source: 'stripe-session-verify',
            });
            authorized = true;
            allowPaidFetch = true;
            packCode = order.packCode || null;
            remainingCredits = order.remainingCredits != null ? order.remainingCredits : null;
            totalCredits = order.creditsTotal || null;
            accessToken = order.accessToken;
            tierId = order.tierId;
          }
        }
      }
    }

    // 3. Multi-pack credit redemption (hardened v2 DRV3-... / DRV10-... with durable rate limit & CAS)
    if (!authorized && body.packCode) {
      const ipHash = hashIp(extractClientIp(req));
      const rl = await checkRateLimitAsync('pack_redeem', ipHash, PACK_REDEEM_MAX_FAILURES, PACK_REDEEM_WINDOW_MS);
      if (rl.blocked) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        return res.status(429).json({
          ok: false,
          error: `Too many invalid pack code attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`,
          retryAfterSec: rl.retryAfterSec,
        });
      }
      const red = await redeemPackCreditCodeAsync(body.packCode, vin, body.vehicleTitle);
      if (!red.ok) {
        await recordRateLimitFailureAsync('pack_redeem', ipHash, PACK_REDEEM_WINDOW_MS);
        return res.status(400).json({ ok: false, error: red.error });
      }
      await clearRateLimitAsync('pack_redeem', ipHash);
      authorized = true;
      allowPaidFetch = true;
      packCode = red.code;
      remainingCredits = red.remainingCredits;
      totalCredits = red.totalCredits || null;
      tierId = red.tierId || tierId;
      accessToken = red.accessToken;
    }

    // 4. Built-in Canadian sample VINs (never triggers paid upstream API charges)
    if (!authorized && body.demo) {
      const demoAttempt = await buildLiveDriveeReport({ vin, allowPaidFetch: false, demo: true });
      if (demoAttempt.ok && demoAttempt.report) {
        return res.status(200).json({
          ok: true,
          mode: demoAttempt.mode,
          report: demoAttempt.report,
        });
      }
    }

    if (!authorized) {
      return res.status(402).json({
        ok: false,
        error: 'Unlock required. Purchase a $17 CAD single report, 3-pack ($39), or redeem a pack code.',
      });
    }

    const built = await buildLiveDriveeReport({ vin, allowPaidFetch, demo: false });
    if (!built.ok || !built.report) {
      return res.status(404).json({ ok: false, error: 'Unable to build report for this VIN.' });
    }

    return res.status(200).json({
      ok: true,
      mode: built.mode,
      tierId,
      accessToken,
      packCode,
      remainingCredits,
      totalCredits,
      report: built.report,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Unlock failed' });
  }
};
