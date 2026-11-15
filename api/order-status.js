// GET /api/order-status?session_id=cs_...
// Used by the after-payment window on report.html to show the buyer which
// email address the Drivee Car Report goes to. The Checkout Session id only
// reaches the buyer's own browser (Stripe puts it in the redirect URL), so it
// works as the access token. Returns only what the window needs.
//
// Env: STRIPE_SECRET_KEY - a restricted key with "Checkout Sessions: Read" is enough.
// Without it the endpoint answers { ok: false } and the window shows generic copy.

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  var sid = String((req.query && req.query.session_id) || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) return res.status(400).json({ ok: false });

  var key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'not-configured' });

  try {
    var r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sid), {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    if (r.status !== 200) return res.status(404).json({ ok: false });
    var s = await r.json();
    var vin = String(s.client_reference_id || '').toUpperCase();
    return res.status(200).json({
      ok: true,
      paid: s.payment_status === 'paid',
      email: (s.customer_details && s.customer_details.email) || s.customer_email || '',
      vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : ''
    });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
