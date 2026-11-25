// GET / POST /api/order-status
// Unified Drivee VIN serverless entry point (keeps Vercel Hobby deployment at <= 12 functions):
//   - No `?op=` (GET ?session_id=cs_...): post-checkout order status lookup
//   - `?op=lookup`   -> lib/vin-api-lookup.js   (POST free VIN decode, recalls, CAD value)
//   - `?op=checkout` -> lib/vin-api-checkout.js (GET promo quote / POST Stripe CAD checkout)
//   - `?op=unlock`   -> lib/vin-api-unlock.js   (POST dossier unlocker & pack redemption)
//   - `?op=pdf`      -> lib/vin-api-pdf.js      (POST server-side Drivee vector PDF)
//   - `?op=admin`    -> lib/vin-api-admin.js    (GET/POST authenticated admin dashboard & CSV)

'use strict';

if (!process.env.VERCEL) {
  for (const mod of [
    '../lib/vin-store-supabase',
    '../lib/vin-core',
    '../lib/vin-report-builder',
    '../lib/vin-pdf-generator',
    '../lib/vin-api-lookup',
    '../lib/vin-api-checkout',
    '../lib/vin-api-unlock',
    '../lib/vin-api-pdf',
    '../lib/vin-api-admin',
  ]) {
    try { delete require.cache[require.resolve(mod)]; } catch (e) {}
  }
}

// Static literal requires so Vercel's @vercel/nft bundler traces every VIN module cleanly
var vinCore = require('../lib/vin-core');
var VIN_OP_HANDLERS = {
  lookup: require('../lib/vin-api-lookup'),
  checkout: require('../lib/vin-api-checkout'),
  unlock: require('../lib/vin-api-unlock'),
  pdf: require('../lib/vin-api-pdf'),
  admin: require('../lib/vin-api-admin'),
};

module.exports = async function handler(req, res) {
  var op = String((req.query && req.query.op) || '').trim().toLowerCase();
  if (op) {
    var subHandler = Object.prototype.hasOwnProperty.call(VIN_OP_HANDLERS, op) ? VIN_OP_HANDLERS[op] : null;
    if (!subHandler) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(400).json({ ok: false, error: 'Unsupported VIN operation.' });
    }
    return subHandler(req, res);
  }

  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  var sid = String((req.query && req.query.session_id) || '');
  if (!/^cs_(test|live)_[A-Za-z0-9_]{10,200}$/.test(sid)) return res.status(400).json({ ok: false });

  var localOrder = await vinCore.findOrderBySessionIdAsync(sid);
  var key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    if (localOrder) {
      return res.status(200).json({
        ok: true,
        paid: localOrder.status === 'paid' || localOrder.status === 'sandbox_paid',
        email: localOrder.customerEmail || '',
        vin: localOrder.vin || '',
        tierId: localOrder.tierId || 'single',
        packCode: localOrder.packCode || null,
        remainingCredits: localOrder.remainingCredits != null ? localOrder.remainingCredits : null,
        totalCredits: localOrder.totalCredits || null,
        accessToken: localOrder.accessToken || null,
        reportUrl: localOrder.vin && localOrder.accessToken
          ? '/vin-report.html?vin=' + encodeURIComponent(localOrder.vin) + '&access=' + encodeURIComponent(localOrder.accessToken)
          : null,
      });
    }
    return res.status(200).json({ ok: false, reason: 'not-configured' });
  }

  try {
    var r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sid), {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    if (r.status !== 200) return res.status(404).json({ ok: false });
    var s = await r.json();
    var meta = s.metadata || {};
    var vin = String(meta.vin || s.client_reference_id || '').toUpperCase();
    var cleanVin = /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : '';
    // A report link only for a paid session.
    var token = cleanVin && s.payment_status === 'paid' ? vinCore.signReportAccessToken(cleanVin, sid) : null;
    return res.status(200).json({
      ok: true,
      paid: s.payment_status === 'paid',
      email: (s.customer_details && s.customer_details.email) || s.customer_email || '',
      vin: cleanVin,
      tierId: meta.tierId || (localOrder && localOrder.tierId) || 'single',
      packCode: (localOrder && localOrder.packCode) || null,
      remainingCredits: localOrder && localOrder.remainingCredits != null ? localOrder.remainingCredits : null,
      totalCredits: localOrder && localOrder.totalCredits != null ? localOrder.totalCredits : null,
      accessToken: token,
      reportUrl: cleanVin && token
        ? '/vin-report.html?vin=' + encodeURIComponent(cleanVin) + '&access=' + encodeURIComponent(token)
        : null,
    });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
