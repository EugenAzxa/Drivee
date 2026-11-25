/**
 * POST /api/vin-pdf
 * Generates & downloads a true server-side Drivee Vector PDF Dossier
 * (`Drivee-Dossier-{VIN}.pdf`) with embedded hero photo, 5-zone collision
 * blueprint, owner-shaded odometer chart, condition matrix, full owner-grouped
 * chronological history, and Canadian pre-purchase checklist.
 */

'use strict';

if (!process.env.VERCEL) {
  try {
    delete require.cache[require.resolve('./vin-core')];
    delete require.cache[require.resolve('./vin-pdf-generator')];
  } catch { /* ignore */ }
}

const { validateVin } = require('./vin-core');
const { generateDriveePdfBuffer } = require('./vin-pdf-generator');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) || {};
    const report = body.report;
    if (!report || typeof report !== 'object' || !report.vin) {
      return res.status(400).json({ ok: false, error: 'Unlocked Drivee report payload required.' });
    }
    const check = validateVin(report.vin);
    if (!check.valid) {
      return res.status(400).json({ ok: false, error: check.error });
    }

    const unit = body.unit === 'mi' ? 'mi' : 'km';
    const boundedReport = {
      ...report,
      events: Array.isArray(report.events) ? report.events.slice(0, 250) : [],
      owners: Array.isArray(report.owners) ? report.owners.slice(0, 25) : [],
      odometerReadings: Array.isArray(report.odometerReadings) ? report.odometerReadings.slice(0, 250) : [],
      recalls: Array.isArray(report.recalls) ? report.recalls.slice(0, 50) : [],
    };
    const pdfBuf = await generateDriveePdfBuffer(boundedReport, { unit });
    const safeVin = check.vin.replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'REPORT';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Drivee-Dossier-${safeVin}.pdf"`);
    res.setHeader('Content-Length', String(pdfBuf.length));
    return res.status(200).send(pdfBuf);
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err && err.message) || 'PDF generation failed' });
  }
};
