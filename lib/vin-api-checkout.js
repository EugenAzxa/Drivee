/**
 * GET / POST /api/vin-checkout
 * Automated CAD Stripe Checkout Sessions for Drivee ($17 Single / $39 3-Pack / $99 10-Pack).
 *
 * Stripe Best Practices:
 *   - Uses Checkout Sessions API with currency=cad and inline price_data so
 *     tier price/bundle changes in code take effect automatically without
 *     re-creating static Payment Links in Stripe Dashboard.
 *   - Intentionally OMITS payment_method_types so Stripe Dynamic Payment Methods
 *     (Cards, Apple Pay, Google Pay, Link) work automatically.
 *   - On localhost when STRIPE_SECRET_KEY is unset (sandbox mode), creates a
 *     simulated test order + Pack Credit Code and redirects straight to
 *     /vin-report.html so the entire post-checkout experience works locally.
 */

'use strict';

if (!process.env.VERCEL) {
  try {
    delete require.cache[require.resolve('./vin-store-supabase')];
    delete require.cache[require.resolve('./vin-core')];
  } catch {}
}

const {
  emitSupabaseEvent,
  evaluatePromoCodeAsync,
  getEffectivePricingTiersAsync,
  getEffectiveSettingsAsync,
  recordVinOrderAsync,
  validateVin,
} = require('./vin-core');
const { getDemoDossier } = require('./vin-report-builder');

function findEffectiveTier(tiers, id) {
  const clean = String(id || '').trim().toLowerCase();
  const key = clean === 'basic' ? 'single' : clean;
  return tiers.find((t) => t.id === key) || tiers[0];
}

function resolveSafeOrigin(req) {
  const host = String((req.headers && req.headers.host) || '').trim();
  if (!process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return `http://${host}`;
  }
  // On Vercel Preview deployments, allow verified *.vercel.app host so QA redirects stay on preview
  if (process.env.VERCEL_ENV === 'preview' && /^[a-z0-9-]+\.vercel\.app$/i.test(host)) {
    return `https://${host}`;
  }
  const prodHost = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://www.drivee.ca')
    .trim()
    .replace(/\/+$/, '');
  return prodHost;
}

function isLocalHostRequest(req) {
  const host = String((req.headers && req.headers.host) || '').trim();
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) || !host;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // GET /api/vin-checkout?tierId=pack3&promo=DRIVEE15 -> validate promo & calculate CAD total
  if (req.method === 'GET') {
    const q = req.query || {};
    const tiers = await getEffectivePricingTiersAsync();
    const tier = findEffectiveTier(tiers, q.tierId || 'single');
    const promo = q.promo ? await evaluatePromoCodeAsync(q.promo) : null;
    const finalPriceCad = promo
      ? Number(Math.max(0, tier.priceCad * (1 - promo.discountPct / 100)).toFixed(2))
      : tier.priceCad;
    return res.status(200).json({
      ok: true,
      currency: 'CAD',
      tierId: tier.id,
      basePriceCad: tier.priceCad,
      promoValid: Boolean(promo),
      promoCode: promo ? promo.code : null,
      discountPct: promo ? promo.discountPct : 0,
      finalPriceCad,
      tiers,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'GET or POST only' });
  }

  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) || {};
    const check = validateVin(body.vin || '');
    if (!check.valid) {
      return res.status(400).json({ ok: false, error: check.error });
    }
    const vin = check.vin;
    const [tiers, settings] = await Promise.all([
      getEffectivePricingTiersAsync(),
      getEffectiveSettingsAsync(),
    ]);
    const tier = findEffectiveTier(tiers, body.tierId || 'single');
    const cleanPromo = String(body.promoCode || '').trim().toUpperCase();
    const promo = cleanPromo ? await evaluatePromoCodeAsync(cleanPromo) : null;
    if (cleanPromo && !promo) {
      return res.status(400).json({ ok: false, error: 'Promo code is invalid or expired.' });
    }

    const finalPriceCad = promo
      ? Number(Math.max(0, tier.priceCad * (1 - promo.discountPct / 100)).toFixed(2))
      : tier.priceCad;
    const finalCents = Math.round(finalPriceCad * 100);
    const origin = resolveSafeOrigin(req);
    const emailRaw = String(body.customerEmail || '').trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : '';
    const vehicleTitle = String(body.vehicleTitle || '').trim().slice(0, 120) || `VIN ${vin}`;

    await emitSupabaseEvent('report_buy_click', {
      m: `${tier.id} ${vin}`,
      cad: finalPriceCad,
      promo: promo ? promo.code : '',
    });

    // 100% discount promo code -> bypass Stripe directly and unlock immediately
    if (finalCents <= 0 && promo) {
      const order = await recordVinOrderAsync({
        vin,
        vehicleTitle,
        tierId: tier.id,
        amountCad: 0,
        customerEmail: validEmail || 'promo@drivee.ca',
        promoCode: promo.code,
        creditsTotal: tier.credits,
        status: 'paid',
        livemode: false,
        source: 'promo-100',
      });
      return res.status(200).json({
        ok: true,
        mode: 'promo',
        orderNumber: order.orderNumber,
        packCode: order.packCode,
        remainingCredits: order.remainingCredits,
        totalCredits: order.creditsTotal,
        url: `/vin-report.html?vin=${encodeURIComponent(vin)}&access=${encodeURIComponent(order.accessToken)}&tier=${tier.id}${
          order.packCode ? `&pack=${encodeURIComponent(order.packCode)}` : ''
        }`,
      });
    }

    const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
    if (stripeKey) {
      const form = new URLSearchParams();
      form.append('mode', 'payment');
      form.append('client_reference_id', vin);
      form.append('billing_address_collection', 'auto');
      if (validEmail) form.append('customer_email', validEmail);
      form.append(
        'success_url',
        `${origin}/vin-report.html?vin=${encodeURIComponent(vin)}&session_id={CHECKOUT_SESSION_ID}&tier=${tier.id}`
      );
      form.append('cancel_url', `${origin}/report.html?vin=${encodeURIComponent(vin)}#check`);
      form.append('line_items[0][quantity]', '1');
      form.append('line_items[0][price_data][currency]', 'cad');
      form.append('line_items[0][price_data][unit_amount]', String(finalCents));
      form.append(
        'line_items[0][price_data][product_data][name]',
        `Drivee — ${tier.name} (VIN ${vin})`
      );
      form.append(
        'line_items[0][price_data][product_data][description]',
        `${tier.description} Instant online report + printable Drivee PDF.`
      );
      form.append('metadata[vin]', vin);
      form.append('metadata[tierId]', tier.id);
      form.append('metadata[credits]', String(tier.credits));
      form.append('metadata[vehicleTitle]', vehicleTitle);
      if (promo) form.append('metadata[promoCode]', promo.code);

      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const stripeData = await stripeRes.json().catch(() => ({}));
      if (!stripeRes.ok || !stripeData.url) {
        return res.status(502).json({
          ok: false,
          error: (stripeData.error && stripeData.error.message) || 'Stripe checkout session creation failed.',
        });
      }
      return res.status(200).json({
        ok: true,
        mode: 'stripe',
        sessionId: stripeData.id,
        url: stripeData.url,
      });
    }

    // Local sandbox simulation when STRIPE_SECRET_KEY is not set on localhost
    if ((isLocalHostRequest(req) && settings.allowLocalSandboxFallback !== false) || process.env.VIN_DRY_RUN === 'true') {
      const simSessionId = `cs_test_local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const demo = getDemoDossier(vin);
      const order = await recordVinOrderAsync({
        sessionId: simSessionId,
        vin,
        vehicleTitle: demo ? demo.vehicleTitle : vehicleTitle,
        tierId: tier.id,
        amountCad: finalPriceCad,
        customerEmail: validEmail || 'sandbox-buyer@drivee.ca',
        promoCode: promo ? promo.code : null,
        creditsTotal: tier.credits,
        status: 'sandbox_paid',
        livemode: false,
        source: 'local-sandbox',
      });
      return res.status(200).json({
        ok: true,
        mode: 'sandbox',
        orderNumber: order.orderNumber,
        packCode: order.packCode,
        remainingCredits: order.remainingCredits,
        totalCredits: order.creditsTotal,
        accessToken: order.accessToken,
        url: `/vin-report.html?vin=${encodeURIComponent(vin)}&access=${encodeURIComponent(order.accessToken)}&tier=${tier.id}&sandbox=1${
          order.packCode ? `&pack=${encodeURIComponent(order.packCode)}` : ''
        }`,
      });
    }

    return res.status(503).json({
      ok: false,
      error: 'Stripe checkout is not configured yet (set STRIPE_SECRET_KEY in environment variables).',
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Checkout failed' });
  }
};
