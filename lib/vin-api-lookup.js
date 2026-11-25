/**
 * POST /api/vin-lookup
 * Free Canadian VIN pre-check endpoint:
 *   - Validates 17-char VIN + ISO-3779 check digit
 *   - Decodes factory specs (NHTSA vPIC), safety recalls, & CAD private-sale value
 *   - Queries free upstream coverage radar (AUCTIONS_API_KEY) when configured
 *   - Logs inquiry to Drivee VIN ledger + Supabase funnel telemetry
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
  decodeVinNhtsa,
  emitSupabaseEvent,
  estimateCanadianValueCad,
  fetchRecallsForVehicle,
  getCachedReportAsync,
  getEffectivePricingTiersAsync,
  recordVinInquiryAsync,
  validateVin,
} = require('./vin-core');
const {
  checkFreeUpstreamCoverage,
  getDemoDossier,
  hasAnyLiveUpstreamKey,
} = require('./vin-report-builder');

function getClientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.headers && req.headers['x-real-ip']) || '127.0.0.1';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) || {};
    const check = validateVin(body.vin || body.query || '');
    if (!check.valid) {
      return res.status(400).json({ ok: false, error: check.error });
    }
    const vin = check.vin;
    const demo = getDemoDossier(vin);
    const cached = await getCachedReportAsync(vin);

    const [specs, coverage, pricingTiers] = await Promise.all([
      decodeVinNhtsa(vin),
      hasAnyLiveUpstreamKey() ? checkFreeUpstreamCoverage(vin) : Promise.resolve(null),
      getEffectivePricingTiersAsync(),
    ]);

    const effectiveSpecs = specs || (demo
      ? {
          vin,
          year: demo.year,
          make: demo.make,
          model: demo.model,
          trim: demo.trim,
          bodyClass: demo.bodyClass,
          engineSummary: demo.engineSummary,
          fuelType: demo.fuelType,
          driveType: demo.driveType,
          builtIn: demo.builtIn,
          builtInCanada: demo.builtInCanada,
        }
      : null);

    if (!effectiveSpecs) {
      return res.status(404).json({
        ok: false,
        error: 'We could not decode that VIN. Double-check all 17 characters or try a newer North American vehicle.',
      });
    }

    const recalls =
      effectiveSpecs.make && effectiveSpecs.model && effectiveSpecs.year
        ? await fetchRecallsForVehicle(effectiveSpecs.make, effectiveSpecs.model, effectiveSpecs.year)
        : [];
    const valuationCad = demo ? demo.valuationCad : estimateCanadianValueCad(effectiveSpecs);
    const vehicleTitle = [effectiveSpecs.year, effectiveSpecs.make, effectiveSpecs.model]
      .filter(Boolean)
      .join(' ');

    const recordsFound = demo
      ? demo.kpis.serviceRecords + demo.kpis.accidents
      : coverage
      ? Math.max(coverage.carfaxRecords, coverage.autocheckRecords) + (coverage.localAuctionExists ? 1 : 0)
      : 0;

    await recordVinInquiryAsync({
      vin,
      vehicleTitle,
      provinceHint: body.provinceHint || 'ON',
      recordsFound,
      ip: getClientIp(req),
    });
    await emitSupabaseEvent('vin_check', {
      m: `${vin} ${vehicleTitle}`.slice(0, 120),
      prov: body.provinceHint || 'ON',
      rec: recordsFound,
    });

    return res.status(200).json({
      ok: true,
      vin,
      vehicleTitle,
      specs: effectiveSpecs,
      recalls,
      valuationCad,
      hasDemoReport: Boolean(demo),
      hasCachedReport: Boolean(cached),
      upstreamCoverage: coverage,
      pricingTiers,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Lookup failed' });
  }
};
