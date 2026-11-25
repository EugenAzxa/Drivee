// Stripe webhook for Drivee Car Report orders.
//
// Every report sale goes through a Stripe Payment Link (see STRIPE_LINKS in
// report.html). Stripe calls this endpoint when something happens to the
// checkout, and we turn that into:
//   - an email to the owner (PAID / PAYMENT FAILED / ABANDONED / REFUNDED),
//   - a confirmation email to the buyer on PAID ("your report arrives in 5-60 min"),
//   - a row in Supabase `analytics` so orders show up next to the funnel,
//   - a Telegram ping when the bot is configured.
//
// Setup (once):
//   Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
//     URL:    https://www.drivee.ca/api/stripe-webhook
//     Events: checkout.session.completed
//             checkout.session.async_payment_succeeded
//             checkout.session.async_payment_failed
//             checkout.session.expired
//             payment_intent.payment_failed
//             charge.refunded
//   Copy the endpoint's signing secret (whsec_...) into Vercel env
//   STRIPE_WEBHOOK_SECRET and redeploy.
//
// Env: STRIPE_WEBHOOK_SECRET (required), RESEND_API_KEY (required),
//      ORDER_ALERT_EMAIL (optional, defaults to drivee.canada@gmail.com),
//      TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (optional).

var crypto = require('crypto');
var vinCore = require('../lib/vin-core');
var reportBuilder = require('../lib/vin-report-builder');

var OWNER_EMAIL = process.env.ORDER_ALERT_EMAIL || 'drivee.canada@gmail.com';
var FROM_OWNER = 'Drivee Orders <reports@drivee.ca>';
var FROM_BUYER = 'Drivee Car Report <reports@drivee.ca>';
var SUPPORT_EMAIL = 'drivee.canada@gmail.com';
var SITE_ORIGIN = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://www.drivee.ca').replace(/\/+$/, '');
var TOLERANCE_SEC = 300;

// Prices in cents -> plan (supports current $17/$39/$99 CAD packages + legacy $19/$30 amounts).
var PLAN_BY_AMOUNT = {
  1700: 'single',
  3900: 'pack3',
  9900: 'pack10',
  1900: 'basic',
  3000: 'lien',
};
var PLAN_LABEL = {
  single: 'Single Vehicle Report ($17 CAD)',
  pack3: 'Buyer 3-Report Pack ($39 CAD)',
  pack10: 'Pro / Dealer 10-Pack ($99 CAD)',
  basic: 'Full report ($19 CAD)',
  lien: 'Full report + Ontario lien check ($30 CAD)',
};

// Stripe retries on any non-2xx; remember what we already handled on this
// instance so a retry after a slow response doesn't double-email the buyer.
var seen = {};

// Stripe signs the exact bytes it sent, so we need the raw body. Vercel's Node
// helpers parse req.body lazily, so reading the stream normally works; if the
// runtime already consumed it, fall back to whatever raw form it kept, and as a
// last resort re-serialise the parsed object the way Stripe formats it (2-space JSON).
function readStream(req) {
  return new Promise(function (resolve) {
    if (req.readableEnded || req.complete && !req.readableLength) return resolve(Buffer.alloc(0));
    var chunks = [], done = false;
    function finish() { if (!done) { done = true; resolve(Buffer.concat(chunks)); } }
    req.on('data', function (c) { chunks.push(typeof c === 'string' ? Buffer.from(c) : c); });
    req.on('end', finish);
    req.on('error', finish);
    setTimeout(finish, 3000);
  });
}

async function rawBodies(req) {
  var out = [];
  if (Buffer.isBuffer(req.rawBody)) out.push(req.rawBody);
  var streamed = await readStream(req);
  if (streamed.length) out.push(streamed);
  if (!out.length) {
    var b = req.body;
    if (Buffer.isBuffer(b)) out.push(b);
    else if (typeof b === 'string') out.push(Buffer.from(b));
    else if (b && typeof b === 'object') {
      out.push(Buffer.from(JSON.stringify(b, null, 2)));
      out.push(Buffer.from(JSON.stringify(b)));
    }
  }
  return out;
}

function verify(raw, header, secret) {
  if (!header) return false;
  var t = null, sigs = [];
  String(header).split(',').forEach(function (part) {
    var i = part.indexOf('=');
    var k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    if (k === 'v1') sigs.push(v);
  });
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_SEC) return false;
  var expected = crypto.createHmac('sha256', secret).update(t + '.' + raw.toString('utf8')).digest('hex');
  var exp = Buffer.from(expected, 'hex');
  return sigs.some(function (s) {
    var got = Buffer.from(s, 'hex');
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(cents, cur) {
  if (cents == null) return '?';
  return '$' + (cents / 100).toFixed(2) + ' ' + String(cur || 'cad').toUpperCase();
}

function torontoTime(sec) {
  var d = sec ? new Date(sec * 1000) : new Date();
  return d.toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
}

function cleanVin(v) {
  v = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) ? v : '';
}

// Pull the order facts out of a Checkout Session.
function fromSession(s) {
  var cd = s.customer_details || {};
  var meta = s.metadata || {};
  var plan = meta.tierId || PLAN_BY_AMOUNT[s.amount_total] || 'unknown';
  var vin = cleanVin(meta.vin || s.client_reference_id);
  return {
    sessionId: s.id,
    paymentIntent: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || '',
    vin: vin,
    rawRef: meta.vin || s.client_reference_id || '',
    email: cd.email || s.customer_email || '',
    name: cd.name || '',
    phone: cd.phone || '',
    country: (cd.address && cd.address.country) || '',
    amountCents: s.amount_total,
    amountCad: s.amount_total != null ? Number((s.amount_total / 100).toFixed(2)) : 0,
    amount: money(s.amount_total, s.currency),
    plan: plan,
    planLabel: PLAN_LABEL[plan] || money(s.amount_total, s.currency),
    vehicleTitle: meta.vehicleTitle || '',
    promoCode: meta.promoCode || '',
    credits: Number(meta.credits || (plan === 'pack10' ? 10 : plan === 'pack3' ? 3 : 1)),
    created: torontoTime(s.created),
    livemode: !!s.livemode
  };
}

async function sendEmail(payload) {
  var key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  var r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(payload)
  });
  if (r.status < 200 || r.status >= 300) {
    var txt = '';
    try { txt = await r.text(); } catch (e) {}
    throw new Error('Resend ' + r.status + ' ' + txt.slice(0, 200));
  }
}

async function telegram(text) {
  var bot = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!bot || !chat) return;
  try {
    await fetch('https://api.telegram.org/bot' + bot + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text })
    });
  } catch (e) {}
}

async function logEvent(event, o) {
  var url = process.env.SUPABASE_URL || 'https://ofnsssyiiejohcnbejxq.supabase.co';
  // Same public anon key fallback as api/track.js (it already ships in index.html).
  var key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbnNzc3lpaWVqb2hjbmJlanhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDE4OTcsImV4cCI6MjA5MTA3Nzg5N30._C3k82OSOklVtKaWT4zl1rWGJyaokiRQC9H6y5VhS58';
  try {
    await fetch(url + '/rest/v1/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key },
      // No buyer email in analytics - only what the funnel needs.
      body: JSON.stringify({ event: event, meta: JSON.stringify({ m: (o.plan || '') + ' ' + (o.vin || o.rawRef || ''), amt: o.amount, live: o.livemode ? 1 : 0 }) })
    });
  } catch (e) {}
}

function row(k, v) {
  return '<tr><td style="padding:6px 12px 6px 0;color:#667;white-space:nowrap;vertical-align:top">' + esc(k) + '</td><td style="padding:6px 0;color:#0E1B3D;font-weight:600">' + v + '</td></tr>';
}

function ownerHtml(status, color, o, extra) {
  var stripeBase = 'https://dashboard.stripe.com/' + (o.livemode ? '' : 'test/');
  var vinCell = o.vin
    ? '<span style="font-family:Menlo,monospace;letter-spacing:1px">' + esc(o.vin) + '</span>'
    : '<span style="color:#C2410C">No valid VIN (' + esc(o.rawRef || 'empty') + ') - ask the buyer for it</span>';
  return '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0E1B3D">' +
    '<div style="display:inline-block;padding:6px 12px;border-radius:999px;background:' + color + ';color:#fff;font-weight:800;font-size:13px;letter-spacing:.5px">' + esc(status) + '</div>' +
    (o.livemode ? '' : ' <span style="font-size:12px;color:#C2410C;font-weight:700">TEST MODE</span>') +
    '<h2 style="margin:14px 0 6px">' + esc(o.planLabel) + '</h2>' +
    (extra ? '<p style="margin:0 0 12px;color:#333;line-height:1.5">' + extra + '</p>' : '') +
    '<table style="border-collapse:collapse;font-size:14px">' +
      row('VIN', vinCell) +
      row('Buyer email', o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a>' : '-') +
      (o.name ? row('Name', esc(o.name)) : '') +
      (o.phone ? row('Phone', esc(o.phone)) : '') +
      (o.country ? row('Country', esc(o.country)) : '') +
      row('Amount', esc(o.amount)) +
      row('Time', esc(o.created) + ' (Toronto)') +
      (o.paymentIntent ? row('Stripe', '<a href="' + stripeBase + 'payments/' + esc(o.paymentIntent) + '">Open payment</a>') : '') +
    '</table>' +
  '</div>';
}

function buyerHtml(o, extras) {
  extras = extras || {};
  var vinLine = o.vin
    ? '<p style="margin:0 0 4px;font-size:13px;color:#667">VIN</p><p style="margin:0 0 16px;font-family:Menlo,monospace;font-size:17px;font-weight:700;letter-spacing:1px">' + esc(o.vin) + '</p>'
    : '<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;background:#FFF7ED;color:#9A3412;line-height:1.5"><b>We did not receive a VIN with your order.</b> Please reply to this email with the 17-character VIN of the car so we can prepare your report.</p>';
  var packBox = extras.packCode
    ? '<div style="padding:14px 16px;border-radius:12px;background:#F0FDF4;border:1px solid #BBF7D0;margin:0 0 16px">' +
      '<p style="margin:0 0 4px;font-weight:800;color:#15803D">Your Multi-Report Pack Code</p>' +
      '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:18px;font-weight:800;letter-spacing:1px;color:#0E1B3D">' + esc(extras.packCode) + '</p>' +
      '<p style="margin:0;font-size:13px;color:#166534">Redeem remaining credits anytime at <a href="' + SITE_ORIGIN + '/report.html">' + SITE_ORIGIN + '/report.html</a>. Credits never expire.</p>' +
      '</div>'
    : '';
  var reportBox = extras.reportUrl
    ? '<div style="padding:16px 18px;border-radius:12px;background:#EFF6FF;margin:0 0 18px">' +
      '<p style="margin:0 0 8px;font-weight:800">Your Drivee Car Report is ready</p>' +
      '<p style="margin:0 0 12px"><a href="' + esc(extras.reportUrl) + '" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0B1430;color:#fff;font-weight:800;text-decoration:none">Open Drivee Report &amp; Print PDF →</a></p>' +
      (extras.externalPdfUrl ? '<p style="margin:0;font-size:13px"><a href="' + esc(extras.externalPdfUrl) + '">Download full Vehicle History PDF backup</a></p>' : '') +
      '</div>'
    : '<div style="padding:16px 18px;border-radius:12px;background:#EFF6FF;margin:0 0 18px">' +
      '<p style="margin:0 0 6px;font-weight:800">When and where it arrives</p>' +
      '<p style="margin:0">Your Drivee Car Report will be sent to <b>' + esc(o.email) + '</b> from <b>reports@drivee.ca</b>, usually <b>within 5-60 minutes</b>.</p>' +
      '</div>';
  return '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0E1B3D;line-height:1.55">' +
    '<p style="font-size:22px;font-weight:800;margin:0 0 4px">Drivee<span style="color:#2563EB">.</span></p>' +
    '<h2 style="margin:18px 0 8px">Payment received - ' + (extras.reportUrl ? 'your report is ready' : 'your report is on its way') + '</h2>' +
    '<p style="margin:0 0 18px">Thanks' + (o.name ? ', ' + esc(o.name.split(' ')[0]) : '') + '. Order confirmed for <b>' + esc(o.planLabel) + '</b>.</p>' +
    vinLine +
    packBox +
    reportBox +
    '<p style="margin:0 0 6px;font-weight:700">Need help?</p>' +
    '<ol style="margin:0 0 18px;padding-left:20px">' +
      '<li>Check your Spam, Junk or Promotions folder for "Drivee Car Report".</li>' +
      '<li>Reply to this email or write to <a href="mailto:' + SUPPORT_EMAIL + '">' + SUPPORT_EMAIL + '</a> - we answer the same day.</li>' +
    '</ol>' +
    '<p style="margin:0 0 18px;font-size:13px;color:#667">Stripe sends a separate payment receipt. Drivee is independent and not affiliated with CARFAX or any data provider.</p>' +
    '<p style="margin:0;font-size:13px;color:#667">Drivee Technologies Inc. · Toronto, ON · <a href="https://www.drivee.ca/report.html">drivee.ca</a></p>' +
  '</div>';
}

async function handle(evt) {
  var type = evt.type, obj = evt.data && evt.data.object || {};

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    var o = fromSession(obj);
    if (type === 'checkout.session.completed' && obj.payment_status !== 'paid') {
      // Delayed payment method (rare for cards). Wait for async_payment_succeeded.
      await sendEmail({
        from: FROM_OWNER, to: [OWNER_EMAIL], reply_to: o.email || undefined,
        subject: 'PENDING ' + o.amount + ' - VIN ' + (o.vin || 'missing') + ' - payment not cleared yet',
        html: ownerHtml('PENDING', '#CA8A04', o, 'Checkout finished but the payment has not cleared yet. Do not order the report until you get the PAID email.')
      });
      await logEvent('report_pending', o);
      return;
    }

    // Attempt automated report fulfillment only when VIN_AUTO_FULFILL=true
    var autoReportUrl = '';
    var externalPdfUrl = '';
    var upstreamCostCad = 0;
    if (process.env.VIN_AUTO_FULFILL === 'true' && o.vin && process.env.VIN_DRY_RUN !== 'true') {
      try {
        var built = await reportBuilder.buildLiveDriveeReport({ vin: o.vin, allowPaidFetch: true });
        if (built && built.ok && built.report) {
          upstreamCostCad = Number(built.costCad || 0);
          externalPdfUrl = built.report.externalPdfUrl || '';
          var tok = vinCore.signReportAccessToken(o.vin, o.sessionId || 'webhook');
          autoReportUrl = SITE_ORIGIN + '/vin-report.html?vin=' + encodeURIComponent(o.vin) + '&access=' + encodeURIComponent(tok);
        }
      } catch (autoErr) {
        console.log('[stripe-webhook] auto-fulfill fallback to manual', autoErr && autoErr.message);
      }
    }

    var recordedOrder = await vinCore.recordVinOrderAsync({
      sessionId: o.sessionId,
      paymentIntent: o.paymentIntent,
      vin: o.vin,
      vehicleTitle: o.vehicleTitle || (o.vin ? 'VIN ' + o.vin : ''),
      tierId: ['single', 'pack3', 'pack10'].indexOf(o.plan) >= 0 ? o.plan : 'single',
      amountCad: o.amountCad || undefined,
      upstreamCostCad: upstreamCostCad,
      customerEmail: o.email,
      customerName: o.name,
      promoCode: o.promoCode || null,
      creditsTotal: o.credits,
      status: 'paid',
      livemode: o.livemode,
      source: 'stripe-webhook'
    });

    var ownerNote = autoReportUrl
      ? 'Automated fulfillment succeeded (' + autoReportUrl + '). Buyer received the report link & pack code.'
      : 'Pull the report and email it to the buyer. They were told it arrives within 5-60 minutes.' +
        (recordedOrder.packCode ? ' Issued Pack Code: ' + recordedOrder.packCode : '');

    await sendEmail({
      from: FROM_OWNER, to: [OWNER_EMAIL], reply_to: o.email || undefined,
      subject: 'PAID ' + o.amount + ' - VIN ' + (o.vin || 'MISSING') + ' - ' + (o.email || 'no email'),
      html: ownerHtml('PAID', '#16A34A', o, ownerNote)
    });
    if (o.email) {
      try {
        await sendEmail({
          from: FROM_BUYER, to: [o.email], reply_to: SUPPORT_EMAIL,
          subject: (autoReportUrl ? 'Your Drivee Car Report is ready' : 'Your Drivee Car Report is being prepared') + (o.vin ? ' - VIN ' + o.vin : ''),
          html: buyerHtml(o, {
            reportUrl: autoReportUrl,
            externalPdfUrl: externalPdfUrl,
            packCode: recordedOrder.packCode
          })
        });
      } catch (e) { console.log('[stripe-webhook] buyer email failed', e.message); }
    }
    await logEvent('report_paid', o);
    await telegram('PAID ' + o.amount + '\n' + o.planLabel + '\nVIN ' + (o.vin || 'MISSING') + '\n' + (o.email || 'no email') + (recordedOrder.packCode ? '\nPack: ' + recordedOrder.packCode : '') + '\n' + o.created);
    return {
      orderNumber: recordedOrder.orderNumber,
      packCode: recordedOrder.packCode || null,
      reportUrl: autoReportUrl || (recordedOrder.accessToken && o.vin
        ? SITE_ORIGIN + '/vin-report.html?vin=' + encodeURIComponent(o.vin) + '&access=' + encodeURIComponent(recordedOrder.accessToken)
        : '')
    };
  }

  if (type === 'checkout.session.async_payment_failed') {
    var f = fromSession(obj);
    await sendEmail({
      from: FROM_OWNER, to: [OWNER_EMAIL], reply_to: f.email || undefined,
      subject: 'FAILED ' + f.amount + ' - VIN ' + (f.vin || 'missing') + ' - not paid',
      html: ownerHtml('PAYMENT FAILED', '#DC2626', f, 'The delayed payment failed. Nothing to deliver. You may want to email the buyer.')
    });
    await logEvent('report_failed', f);
    return;
  }

  if (type === 'checkout.session.expired') {
    var x = fromSession(obj);
    await sendEmail({
      from: FROM_OWNER, to: [OWNER_EMAIL], reply_to: x.email || undefined,
      subject: 'NOT BOUGHT - checkout abandoned - VIN ' + (x.vin || 'missing'),
      html: ownerHtml('ABANDONED', '#64748B', x, 'The buyer opened checkout but did not pay, and the session has now expired.' + (x.email ? ' They entered an email, so you can follow up.' : ''))
    });
    await logEvent('report_abandoned', x);
    return;
  }

  if (type === 'payment_intent.payment_failed') {
    var err = obj.last_payment_error || {};
    var p = {
      vin: '', rawRef: 'see checkout', email: obj.receipt_email || (err.payment_method && err.payment_method.billing_details && err.payment_method.billing_details.email) || '',
      name: (err.payment_method && err.payment_method.billing_details && err.payment_method.billing_details.name) || '',
      phone: '', country: '', amount: money(obj.amount, obj.currency), plan: PLAN_BY_AMOUNT[obj.amount] || 'unknown',
      planLabel: PLAN_LABEL[PLAN_BY_AMOUNT[obj.amount]] || money(obj.amount, obj.currency),
      created: torontoTime(obj.created), paymentIntent: obj.id, livemode: !!obj.livemode
    };
    await sendEmail({
      from: FROM_OWNER, to: [OWNER_EMAIL],
      subject: 'DECLINED ' + p.amount + ' - card attempt failed',
      html: ownerHtml('CARD DECLINED', '#DC2626', p, esc(err.message || 'The card was declined.') + ' The buyer can retry on the same checkout page; you will get PAID if they succeed.')
    });
    await logEvent('report_declined', p);
    return;
  }

  if (type === 'charge.refunded') {
    var refundSync = null;
    if (obj.payment_intent && typeof vinCore.markOrderRefundedByPaymentIntentAsync === 'function') {
      try {
        refundSync = await vinCore.markOrderRefundedByPaymentIntentAsync(obj.payment_intent, true);
      } catch (e) {
        console.log('[stripe-webhook] refund sync failed', e && e.message);
      }
    }
    var r = {
      vin: '', rawRef: (refundSync && refundSync.orderNumber) || 'see payment', email: obj.billing_details && obj.billing_details.email || obj.receipt_email || '',
      name: obj.billing_details && obj.billing_details.name || '', phone: '', country: '',
      amount: money(obj.amount_refunded, obj.currency), plan: '', planLabel: 'Refund issued',
      created: torontoTime(obj.created), paymentIntent: obj.payment_intent || '', livemode: !!obj.livemode
    };
    var refundNote = refundSync && refundSync.matched
      ? 'Ledger order <b>' + esc(refundSync.orderNumber) + '</b> marked refunded' +
        (refundSync.revokedPackMasked ? ' and linked pack key <b>' + esc(refundSync.revokedPackMasked) + '</b> automatically revoked.' : '.')
      : '';
    await sendEmail({
      from: FROM_OWNER, to: [OWNER_EMAIL],
      subject: 'REFUNDED ' + r.amount,
      html: ownerHtml('REFUNDED', '#7C3AED', r, refundNote)
    });
    await logEvent('report_refunded', r);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  var secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.log('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  var candidates = await rawBodies(req);
  var raw = candidates.filter(function (c) { return verify(c, req.headers['stripe-signature'], secret); })[0];
  if (!raw) {
    console.log('[stripe-webhook] signature check failed; body candidates', candidates.map(function (c) { return c.length; }));
    return res.status(400).json({ error: 'Bad signature' });
  }

  var evt;
  try { evt = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'Bad JSON' }); }

  if (seen[evt.id]) return res.status(200).json({ ok: true, duplicate: true });
  if (typeof vinCore.claimWebhookEventAsync === 'function') {
    try {
      var claim = await vinCore.claimWebhookEventAsync(evt.id);
      if (claim && claim.duplicate) {
        seen[evt.id] = Date.now();
        return res.status(200).json({ ok: true, duplicate: true });
      }
    } catch (claimErr) {
      console.log('[stripe-webhook] durable dedupe check failed', claimErr && claimErr.message);
    }
  }

  try {
    var resultMeta = await handle(evt);
    seen[evt.id] = Date.now();
    var out = { ok: true };
    if (resultMeta && resultMeta.orderNumber) out.orderNumber = resultMeta.orderNumber;
    if (resultMeta && resultMeta.packCode) out.packCode = resultMeta.packCode;
    if (resultMeta && resultMeta.reportUrl) out.reportUrl = resultMeta.reportUrl;
    return res.status(200).json(out);
  } catch (e) {
    if (typeof vinCore.releaseWebhookEventAsync === 'function') {
      await vinCore.releaseWebhookEventAsync(evt.id);
    }
    // Owner alert failed: return 500 so Stripe retries (it retries for up to 3 days).
    console.log('[stripe-webhook] error', evt.type, e && e.message);
    return res.status(500).json({ error: 'Handler failed' });
  }
};

// Ask the runtime not to parse the body (honoured by Vercel's Node runtime).
module.exports.config = { api: { bodyParser: false } };
