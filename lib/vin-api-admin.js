/**
 * GET / POST /api/vin-admin
 * Drivee VIN Back-Office API for tracking inquiries, CAD/USD sales, upstream
 * margins, buyer email database (CRM), daily/weekly charts, 52-week GitHub-style
 * activity heatmap, hardened 3-pack / 10-pack codes, promo lifecycle, and CSV exports.
 */

'use strict';

if (!process.env.VERCEL) {
  try {
    delete require.cache[require.resolve('./vin-store-supabase')];
    delete require.cache[require.resolve('./vin-core')];
    delete require.cache[require.resolve('./vin-report-builder')];
  } catch {}
}

const {
  adjustPackCreditsAsync,
  buildAdminSessionSetCookie,
  checkRateLimitAsync,
  clearRateLimitAsync,
  createPromoCodeAsync,
  decodeVinNhtsa,
  deletePromoCodeAsync,
  exportCustomersCsvAsync,
  exportOrdersCsvAsync,
  extractClientIp,
  getVinDashboardStatsAsync,
  hashIp,
  inspectPackCreditCodeAsync,
  issuePackCreditCodeAsync,
  markOrderRefundedAsync,
  purgeSandboxOrdersAsync,
  recordRateLimitFailureAsync,
  recordVinOrderAsync,
  revokePackCreditCodeAsync,
  setPromoCodeActiveAsync,
  signAdminSessionToken,
  signReportAccessToken,
  updateAdminSettingsAsync,
  validateVin,
  verifyAdminCredentials,
  verifyAdminRequest,
} = require('./vin-core');
const {
  buildLiveDriveeReport,
  fetchUpstreamReportBalance,
  getDemoDossier,
  hasAnyLiveUpstreamKey,
  testUpstreamConnection,
} = require('./vin-report-builder');

const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) || {};

  // Public auth endpoints: login & logout
  if (req.method === 'POST' && body.action === 'logout') {
    res.setHeader('Set-Cookie', buildAdminSessionSetCookie('', req, 0));
    return res.status(200).json({ ok: true, authenticated: false });
  }

  if (req.method === 'POST' && body.action === 'login') {
    const ipHash = hashIp(extractClientIp(req));
    const rl = await checkRateLimitAsync('admin_login', ipHash, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS);
    if (rl.blocked) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: `Too many failed sign-in attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`,
        retryAfterSec: rl.retryAfterSec,
      });
    }

    const check = verifyAdminCredentials(body.username, body.password, req);
    if (check.notConfigured) {
      return res.status(503).json({
        ok: false,
        error: 'Admin login is not configured on this server. Set VIN_ADMIN_USER and VIN_ADMIN_PASSWORD in Vercel.',
      });
    }
    if (!check.ok) {
      await recordRateLimitFailureAsync('admin_login', ipHash, LOGIN_WINDOW_MS);
      return res.status(401).json({
        ok: false,
        error: 'Invalid admin username or password.',
      });
    }

    await clearRateLimitAsync('admin_login', ipHash);
    const { token, exp } = signAdminSessionToken(check.username);
    res.setHeader('Set-Cookie', buildAdminSessionSetCookie(token, req));
    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: {
        username: check.username,
        expiresAt: new Date(exp).toISOString(),
        usingDefaultLocalCreds: Boolean(check.usingDefaultLocalCreds),
      },
    });
  }

  // Strictly enforce session cookie or x-admin-key header for all dashboard reads & mutations
  const auth = verifyAdminRequest(req);
  if (!auth.authorized) {
    return res.status(401).json({
      ok: false,
      authenticated: false,
      isLocal: Boolean(auth.isLocal),
      configured: Boolean(auth.configured),
      usingDefaultLocalCreds: Boolean(auth.usingDefaultLocalCreds),
      error: 'Admin sign-in required.',
    });
  }

  if (req.method === 'GET') {
    try {
      const fmt = req.query && req.query.format;
      const fxRate = req.query && req.query.fx ? Number(req.query.fx) : undefined;
      if (fmt === 'csv') {
        const csv = await exportOrdersCsvAsync(fxRate);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="drivee-vin-orders.csv"');
        return res.status(200).send(csv);
      }
      if (fmt === 'customers_csv') {
        const csv = await exportCustomersCsvAsync(fxRate);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="drivee-vin-buyers.csv"');
        return res.status(200).send(csv);
      }
      const [stats, reportBalance] = await Promise.all([
        getVinDashboardStatsAsync(),
        fetchUpstreamReportBalance().catch(() => null),
      ]);
      return res.status(200).json({
        ok: true,
        authenticated: true,
        user: {
          username: auth.username,
          method: auth.method,
          expiresAt: auth.expiresAt,
          usingDefaultLocalCreds: Boolean(auth.usingDefaultLocalCreds),
        },
        upstreamStatus: {
          configured: hasAnyLiveUpstreamKey(),
          reportBalance,
        },
        ...stats,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: (err && err.message) || 'Failed to load dashboard' });
    }
  }

  if (req.method === 'POST') {
    try {
      if (body.action === 'create_promo') {
        const promo = await createPromoCodeAsync({
          code: body.code,
          discountPct: body.discountPct,
          maxUses: body.maxUses,
        });
        return res.status(200).json({ ok: true, promo });
      }

      if (body.action === 'revoke_promo') {
        const promo = await setPromoCodeActiveAsync(body.code, false);
        return res.status(200).json({ ok: true, promo });
      }

      if (body.action === 'restore_promo') {
        const promo = await setPromoCodeActiveAsync(body.code, true);
        return res.status(200).json({ ok: true, promo });
      }

      if (body.action === 'delete_promo') {
        const resDel = await deletePromoCodeAsync(body.code);
        return res.status(200).json({ ok: true, promo: resDel });
      }

      if (body.action === 'issue_pack') {
        const tierId = body.tierId === 'pack10' ? 'pack10' : 'pack3';
        const pack = await issuePackCreditCodeAsync({
          tierId,
          totalCredits: tierId === 'pack10' ? 10 : 3,
          customerEmail: body.email || null,
          notes: body.notes || `Issued via Drivee VIN Admin (${auth.username})`,
        });
        // Full plaintext pack.code is returned ONCE here for immediate copy/delivery
        return res.status(200).json({ ok: true, pack });
      }

      if (body.action === 'revoke_pack') {
        const pack = await revokePackCreditCodeAsync(body.codeHash);
        return res.status(200).json({ ok: true, pack: { codeHash: pack.codeHash, codeMasked: pack.codeMasked, revoked: true } });
      }

      if (body.action === 'adjust_pack_credits') {
        const pack = await adjustPackCreditsAsync(body.codeHash, body.delta);
        return res.status(200).json({
          ok: true,
          pack: {
            codeHash: pack.codeHash,
            codeMasked: pack.codeMasked,
            remainingCredits: pack.remainingCredits,
            totalCredits: pack.totalCredits,
          },
        });
      }

      if (body.action === 'inspect_pack') {
        const inspection = await inspectPackCreditCodeAsync(body.code);
        return res.status(200).json({ ok: true, inspection });
      }

      if (body.action === 'mark_refunded') {
        const result = await markOrderRefundedAsync(body.orderNumber, body.revokePack !== false);
        return res.status(200).json({ ok: true, refund: result });
      }

      if (body.action === 'generate_comp_report') {
        const check = validateVin(body.vin || body.query || '');
        if (!check.valid) {
          return res.status(400).json({ ok: false, error: check.error || 'Enter a valid 17-character VIN.' });
        }
        const cleanVin = check.vin;
        const emailRaw = String(body.customerEmail || body.email || '').trim();
        const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : 'owner-comp@drivee.ca';
        let vehicleTitle = String(body.vehicleTitle || '').trim().slice(0, 120);
        if (!vehicleTitle) {
          const demo = getDemoDossier(cleanVin);
          if (demo && demo.vehicleTitle) {
            vehicleTitle = demo.vehicleTitle;
          } else {
            try {
              const specs = await decodeVinNhtsa(cleanVin);
              if (specs && (specs.year || specs.make || specs.model)) {
                vehicleTitle = [specs.year, specs.make, specs.model].filter(Boolean).join(' ');
              }
            } catch {}
          }
        }
        const order = await recordVinOrderAsync({
          vin: cleanVin,
          vehicleTitle: vehicleTitle || `VIN ${cleanVin}`,
          tierId: 'single',
          amountCad: 0,
          upstreamCostCad: 0,
          customerEmail: validEmail,
          creditsTotal: 1,
          status: 'comp',
          livemode: false,
          source: 'admin-comp',
        });
        const reportUrl = `/vin-report.html?vin=${encodeURIComponent(cleanVin)}&access=${encodeURIComponent(order.accessToken)}`;
        return res.status(200).json({
          ok: true,
          vin: cleanVin,
          order,
          reportUrl,
        });
      }

      if (body.action === 'generate_live_dossier') {
        const check = validateVin(body.vin || body.query || '');
        if (!check.valid) {
          return res.status(400).json({ ok: false, error: check.error || 'Enter a valid 17-character VIN.' });
        }
        const cleanVin = check.vin;
        const live = await buildLiveDriveeReport({
          vin: cleanVin,
          allowPaidFetch: true,
          demo: false,
        });
        if (!live || !live.report) {
          return res.status(502).json({ ok: false, error: 'Unable to pull live dossier for this VIN.' });
        }
        const token = signReportAccessToken(cleanVin, `admin-live-${Date.now()}`);
        const reportUrl = `/vin-report.html?vin=${encodeURIComponent(cleanVin)}&access=${encodeURIComponent(token)}`;
        return res.status(200).json({
          ok: true,
          vin: cleanVin,
          mode: live.mode,
          costCad: live.costCad,
          recordsCount: Array.isArray(live.report.events) ? live.report.events.length : 0,
          reportUrl,
        });
      }

      if (body.action === 'test_upstream') {
        const result = await testUpstreamConnection();
        return res.status(200).json({
          ok: result.ok,
          upstream: result,
          error: result.error,
        });
      }

      if (body.action === 'purge_sandbox_orders') {
        const purged = await purgeSandboxOrdersAsync();
        return res.status(200).json({
          ok: true,
          ...purged,
        });
      }

      if (body.action === 'update_settings') {
        const updated = await updateAdminSettingsAsync({
          singlePriceCad: body.singlePriceCad,
          pack3PriceCad: body.pack3PriceCad,
          pack10PriceCad: body.pack10PriceCad,
          allowLocalSandboxFallback: body.allowLocalSandboxFallback,
        });
        return res.status(200).json({
          ok: true,
          ...updated,
        });
      }

      if (body.action === 'simulate_order') {
        const daysAgo = Number(body.daysAgo || 0);
        const createdAt =
          Number.isFinite(daysAgo) && daysAgo > 0 && daysAgo <= 180
            ? new Date(Date.now() - Math.round(daysAgo) * 86400000).toISOString()
            : undefined;
        const order = await recordVinOrderAsync({
          vin: body.vin || 'KNAF55AC3L5071117',
          vehicleTitle: body.vehicleTitle || '2020 Kia Forte EX',
          tierId: body.tierId || 'pack3',
          customerEmail: body.email || 'test-buyer@drivee.ca',
          customerName: body.name || 'Test Buyer',
          status: 'sandbox_paid',
          source: 'admin-simulator',
          createdAt,
        });
        return res.status(200).json({ ok: true, order });
      }

      return res.status(400).json({ ok: false, error: 'Unsupported action' });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Action failed' });
    }
  }

  return res.status(405).json({ ok: false, error: 'GET or POST only' });
};
