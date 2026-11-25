// "Your Drivee Car Report is ready" email to the buyer, plus a short owner alert.
// Sent once per paid order by lib/vin-api-unlock.js after the report is built.
//
// Env: RESEND_API_KEY (required), ORDER_ALERT_EMAIL (optional, comma-separated),
//      NEXT_PUBLIC_SITE_URL (optional, defaults to https://www.drivee.ca).

'use strict';

const SITE_ORIGIN = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://www.drivee.ca').replace(/\/+$/, '');
const FROM_BUYER = 'Drivee Car Report <reports@drivee.ca>';
const FROM_OWNER = 'Drivee Orders <reports@drivee.ca>';
const SUPPORT_EMAIL = 'drivee.canada@gmail.com';
const OWNER_EMAILS = String(process.env.ORDER_ALERT_EMAIL || 'drivee.canada@gmail.com,69apha@gmail.com')
  .split(',').map((e) => e.trim()).filter(Boolean);

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function reportUrlFor(vin, accessToken) {
  return `${SITE_ORIGIN}/vin-report.html?vin=${encodeURIComponent(vin)}&access=${encodeURIComponent(accessToken)}`;
}

async function sendEmail(payload) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  if (r.status < 200 || r.status >= 300) {
    let txt = '';
    try { txt = await r.text(); } catch { /* ignore */ }
    throw new Error(`Resend ${r.status} ${txt.slice(0, 200)}`);
  }
}

function readyHtml({ name, vin, vehicleTitle, url }) {
  return '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0E1B3D;line-height:1.55">' +
    '<p style="font-size:22px;font-weight:800;margin:0 0 4px">Drivee<span style="color:#2563EB">.</span></p>' +
    '<h2 style="margin:18px 0 8px">Your Drivee Car Report is ready</h2>' +
    `<p style="margin:0 0 16px">Thanks${name ? ', ' + esc(String(name).split(' ')[0]) : ''}. Your report${vehicleTitle && !/^VIN /.test(vehicleTitle) ? ' for the <b>' + esc(vehicleTitle) + '</b>' : ''} has been compiled.</p>` +
    '<p style="margin:0 0 4px;font-size:13px;color:#667">VIN</p>' +
    `<p style="margin:0 0 18px;font-family:Menlo,monospace;font-size:17px;font-weight:700;letter-spacing:1px">${esc(vin)}</p>` +
    `<p style="margin:0 0 18px"><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#0B1430;color:#fff;font-weight:800;text-decoration:none">Open my report &amp; print PDF →</a></p>` +
    '<p style="margin:0 0 18px;font-size:13px;color:#667">This link is personal to your order - keep it to reopen the report any time.</p>' +
    `<p style="margin:0 0 18px;font-size:13px;color:#667">Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>` +
    '<p style="margin:0;font-size:13px;color:#667">Drivee Technologies Inc. · Toronto, ON · <a href="https://www.drivee.ca/report.html">drivee.ca</a></p>' +
  '</div>';
}

// Buyer "ready" email + owner "DELIVERED" alert. Throws if the buyer email fails.
async function sendReportReadyEmail(order) {
  const url = reportUrlFor(order.vin, order.accessToken);
  await sendEmail({
    from: FROM_BUYER,
    to: [order.email],
    reply_to: SUPPORT_EMAIL,
    subject: `Your Drivee Car Report is ready - VIN ${order.vin}`,
    html: readyHtml({ name: order.name, vin: order.vin, vehicleTitle: order.vehicleTitle, url }),
  });
  try {
    await sendEmail({
      from: FROM_OWNER,
      to: OWNER_EMAILS,
      subject: `DELIVERED - VIN ${order.vin} - ${order.email}`,
      html: `<p>Report for VIN <b>${esc(order.vin)}</b> (order ${esc(order.orderNumber)}) was built and the link was emailed to ${esc(order.email)}.</p><p><a href="${esc(url)}">Open the report</a></p>`,
    });
  } catch { /* owner alert is best-effort */ }
}

// Owner alert when a paid order only got the basic (no history) fallback report.
async function sendBuildProblemAlert({ vin, mode, email }) {
  try {
    await sendEmail({
      from: FROM_OWNER,
      to: OWNER_EMAILS,
      subject: `CHECK - VIN ${vin} - full history not loaded (${mode})`,
      html: `<p>A paid report for VIN <b>${esc(vin)}</b>${email ? ' (' + esc(email) + ')' : ''} was built without vehicle history (mode: ${esc(mode)}). The buyer was not sent a "ready" email. Opening the report link again retries the history purchase; check <a href="${SITE_ORIGIN}/vin-admin.html">/vin-admin.html</a> and the AuctionsAPI balance.</p>`,
    });
  } catch { /* best-effort */ }
}

module.exports = { sendReportReadyEmail, sendBuildProblemAlert, reportUrlFor };
