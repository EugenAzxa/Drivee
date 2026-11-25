/**
 * Drivee Canadian Vehicle Report Builder & Upstream API Connector
 * ---------------------------------------------------------------------------
 * Builds a complete Drivee-branded Canadian Vehicle History Dossier (km-first,
 * CAD values, Transport Canada + NHTSA recalls, Drivee verdict & cost notes).
 *
 * Upstream sources supported (server-side only):
 *   1. AuctionsAPI (AUCTIONS_API_KEY):
 *        - Free pre-check: GET  /api/reports/check-records/{vin} + GET /api/local-exists/{vin}
 *        - Free reuse:     GET  /api/reports/my-history?page=1..2
 *        - Paid history:   GET  /api/reports/carfax/{vin}?days=30&exclude_base_64=1
 *        - Paid auction:   GET  /api/local-report/{vin} (salvage lot photos & bids)
 *   2. Free Government + CC Photo Sources:
 *        - NHTSA vPIC VIN decoder, NHTSA / Transport Canada recall links,
 *          Wikimedia Commons CC exterior reference photo resolver.
 */

'use strict';

const {
  capWords,
  cleanDealerSourceText,
  decodeVinNhtsa,
  estimateCanadianValueCad,
  fetchRecallsForVehicle,
  getCachedReportAsync,
  resolveVehicleReferencePhoto,
  saveCachedReportAsync,
  scrubToDriveeBranding,
} = require('./vin-core');

const AUCTIONS_BASE = 'https://auctionsapi.com/api';

function getAuctionsKey() {
  return (process.env.AUCTIONS_API_KEY || process.env.AUCTIONSAPI_KEY || '').trim();
}

function hasAnyLiveUpstreamKey() {
  return Boolean(getAuctionsKey());
}

async function fetchUpstreamReportBalance() {
  const key = getAuctionsKey();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${AUCTIONS_BASE}/reports/balance`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'x-api-key': key,
      },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return null;
    const balUsd = Number(data.balance_usd ?? data.available_usd ?? data.balance ?? 0);
    return {
      balance: Number(data.balance ?? balUsd) || 0,
      balanceUsd: Number.isFinite(balUsd) ? Number(balUsd.toFixed(2)) : 0,
      currency: String(data.currency || 'USD').toUpperCase(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function testUpstreamConnection() {
  const key = getAuctionsKey();
  if (!key) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      error: 'AUCTIONS_API_KEY is not configured in environment variables.',
    };
  }
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${AUCTIONS_BASE}/reports/balance`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'x-api-key': key,
      },
    });
    const durationMs = Date.now() - started;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        durationMs,
        error: (data && (data.error || data.message || data.detail)) || `Upstream returned HTTP ${res.status}`,
      };
    }
    const balUsd = Number(data && (data.balance_usd ?? data.available_usd ?? data.balance ?? 0));
    return {
      ok: true,
      status: res.status,
      durationMs,
      balance: Number((data && data.balance) ?? balUsd) || 0,
      balanceUsd: Number.isFinite(balUsd) ? Number(balUsd.toFixed(2)) : 0,
      currency: String((data && data.currency) || 'USD').toUpperCase(),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      error: (err && err.message) || 'Upstream connection timeout or network error.',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Built-in Canadian Demo Dossiers (for instant sample viewing & zero-key dev)
// ---------------------------------------------------------------------------
function makeDemoCaravan() {
  const kmReadings = [
    ['2015-12-02', 5],
    ['2016-03-09', 50],
    ['2016-06-07', 12000],
    ['2016-11-14', 25687],
    ['2017-04-12', 36809],
    ['2017-08-17', 48275],
    ['2018-05-03', 65359],
    ['2018-10-24', 78618],
    ['2019-09-10', 94406],
    ['2019-11-12', 96804],
    ['2020-04-14', 102588],
    ['2020-10-13', 106801],
    ['2021-04-06', 111182],
    ['2021-11-02', 120799],
    ['2022-07-28', 129819],
    ['2023-02-07', 136765],
    ['2023-11-07', 150374],
    ['2024-04-26', 157301],
    ['2024-07-31', 162953],
    ['2025-11-24', 164232],
  ];
  const serviceRows = [
    ['2015-12-02', 5, 'Service Facility · Scarborough, ON', 'Pre-delivery inspection completed'],
    ['2016-03-09', 50, 'NewRoads Chrysler · Newmarket, ON', 'Floor mats, winter tires mounted, undercoating'],
    ['2016-06-07', 12000, 'Service Facility · Newmarket, ON', 'Fluids checked · oil & filter changed'],
    ['2016-11-14', 25687, 'NewRoads Chrysler · Newmarket, ON', 'Brakes serviced · oil & filter · rear brakes adjusted'],
    ['2017-04-12', 36809, 'NewRoads Chrysler · Newmarket, ON', 'Cabin air filter · oil & filter · tires mounted'],
    ['2018-05-03', 65359, 'Williamson Chrysler · Uxbridge, ON', 'Engine air filter · cabin air filter replaced'],
    ['2018-10-24', 78618, 'Williamson Chrysler · Uxbridge, ON', '4-wheel alignment · brakes & drivability checked'],
    ['2019-09-10', 94406, 'Jiffy Lube · Oshawa, ON', 'Oil & filter changed · cabin filter'],
    ['2020-04-14', 102588, 'Port Perry Automotive · Port Perry, ON', 'Front brake pads & rotors · oil & filter'],
    ['2021-04-06', 111182, 'Port Perry Automotive · Port Perry, ON', 'Cabin filter · oil & filter · seasonal tire swap'],
    ['2023-02-07', 136765, 'Port Perry Automotive · Port Perry, ON', 'Power steering rack & pinion replaced · alignment'],
    ['2024-07-31', 162953, 'Port Perry Automotive · Port Perry, ON', 'Alignment · synthetic oil & filter changed'],
  ];

  return {
    vin: '2C4RDGBGXGR217456',
    isDemo: true,
    sourceMode: 'demo',
    generatedAt: new Date().toISOString(),
    vehicleTitle: '2016 Dodge Grand Caravan SE / R/T',
    year: 2016,
    make: 'Dodge',
    model: 'Grand Caravan',
    trim: 'SE',
    bodyClass: 'Minivan · 4-Door MPV',
    engineSummary: '3.6L V6 Pentastar · 6-cyl',
    fuelType: 'Gasoline',
    driveType: 'Front-Wheel Drive',
    builtIn: 'Windsor, Ontario, Canada',
    builtInCanada: true,
    lastProvince: 'Ontario, Canada',
    exteriorColor: 'Red',
    verdict: {
      tone: 'good',
      headline: 'Clean Canadian history — 0 accidents, consistent Ontario odometer',
      subheadline: '5 Ontario registrations · 25 service visits · no salvage or flood brands · steering rack already replaced',
    },
    brandFlags: {
      cleanTitle: true,
      salvage: false,
      rebuilt: false,
      flood: false,
      totalLoss: false,
      structural: false,
      airbag: false,
      theft: false,
      odometerRollback: false,
      titleBrandSummary: 'Clean Ontario Registration',
    },
    kpis: {
      accidents: 0,
      owners: 5,
      serviceRecords: 25,
      openRecalls: 0,
      lastOdometerKm: 164232,
      lastOdometerMi: 102049,
      avgKmPerYear: 16400,
      auctionLotsCount: 0,
    },
    valuationCad: {
      currency: 'CAD',
      lowCad: 10500,
      highCad: 12500,
      midCad: 11500,
      dealerTradeLowCad: 8000,
      dealerTradeHighCad: 9500,
    },
    odometerReadings: kmReadings.map(([date, km]) => ({
      date,
      km,
      mi: Math.round(km / 1.60934),
      flaggedRollback: false,
    })),
    owners: [
      {
        ownerNumber: 1,
        usageType: 'Commercial / Fleet',
        province: 'Scarborough / Newmarket, ON',
        period: '2016 – 2024 (~8 yrs)',
        avgKmYear: '19,400 km / yr',
        note: 'Maintained on schedule at NewRoads Chrysler & Port Perry Automotive.',
      },
      { ownerNumber: 2, usageType: 'Personal', province: 'Ontario', period: '2024', avgKmYear: '—', note: 'Passed Ontario Safety Standards Certificate inspection.' },
      { ownerNumber: 3, usageType: 'Personal', province: 'Ontario', period: '2024', avgKmYear: '—', note: 'Registered in Ontario.' },
      { ownerNumber: 4, usageType: 'Personal', province: 'Ontario', period: '2025 (19 days)', avgKmYear: '—', note: 'Short dealer/private transfer — ask seller for bill of sale.' },
      { ownerNumber: 5, usageType: 'Personal · Current', province: 'Ontario', period: '2025 – Present', avgKmYear: '—', note: 'Last recorded reading 164,232 km on Nov 24, 2025.' },
    ],
    incidents: [],
    events: serviceRows.slice().reverse().map(([date, km, source, detail]) => ({
      date,
      km,
      mi: Math.round(km / 1.60934),
      source,
      category: 'service',
      detail,
    })),
    recalls: [],
    photos: [
      { url: '/caravan-front.webp', caption: 'Equivalent 2016 Dodge Grand Caravan reference — Front / Right' },
      { url: '/caravan-rear.webp', caption: 'Equivalent 2016 Dodge Grand Caravan reference — Rear / Right' },
      { url: '/caravan-rear2.webp', caption: 'Equivalent 2016 Dodge Grand Caravan reference — Rear / Left' },
    ],
    auctionLots: [],
    externalPdfUrl: null,
  };
}

function makeDemoForte() {
  const kmReadings = [
    ['2020-02-14', 18],
    ['2020-11-05', 11420],
    ['2021-08-19', 23800],
    ['2022-06-12', 34150],
    ['2023-05-20', 44900],
    ['2024-04-08', 53210],
    ['2025-07-24', 59840],
    ['2026-01-19', 63904],
  ];
  return {
    vin: 'KNAF55AC3L5071117',
    isDemo: true,
    sourceMode: 'demo',
    generatedAt: new Date().toISOString(),
    vehicleTitle: '2020 Kia Forte EX',
    year: 2020,
    make: 'Kia',
    model: 'Forte',
    trim: 'EX IVT',
    bodyClass: 'Sedan · 4-Door',
    engineSummary: '2.0L MPI 4-cyl',
    fuelType: 'Gasoline',
    driveType: 'Front-Wheel Drive',
    builtIn: 'Hwaseong, South Korea',
    builtInCanada: false,
    lastProvince: 'Sudbury, Ontario, Canada',
    exteriorColor: 'Black',
    verdict: {
      tone: 'warn',
      headline: 'Collision reported in Ontario (Jul 2025) + 4 owners — inspect frame & paint closely',
      subheadline: '63,904 km verified · 12 service records · check unibody apron & radar calibration before buying',
    },
    brandFlags: {
      cleanTitle: true,
      salvage: false,
      rebuilt: false,
      flood: false,
      totalLoss: false,
      structural: false,
      airbag: false,
      theft: false,
      odometerRollback: false,
      titleBrandSummary: 'Active Registration (Collision Claim Logged)',
    },
    kpis: {
      accidents: 1,
      owners: 4,
      serviceRecords: 12,
      openRecalls: 1,
      lastOdometerKm: 63904,
      lastOdometerMi: 39708,
      avgKmPerYear: 10650,
      auctionLotsCount: 0,
    },
    valuationCad: {
      currency: 'CAD',
      lowCad: 14800,
      highCad: 17900,
      midCad: 16300,
      dealerTradeLowCad: 11800,
      dealerTradeHighCad: 14000,
    },
    odometerReadings: kmReadings.map(([date, km]) => ({
      date,
      km,
      mi: Math.round(km / 1.60934),
      flaggedRollback: false,
    })),
    owners: [
      { ownerNumber: 1, usageType: 'Personal', province: 'Greater Sudbury, ON', period: '2020 – 2023', avgKmYear: '13,200 km / yr', note: 'Original Ontario owner; regular Kia dealership maintenance.' },
      { ownerNumber: 2, usageType: 'Personal', province: 'Ontario', period: '2023 – 2025', avgKmYear: '9,100 km / yr', note: 'Involved in collision reported Jul 24, 2025.' },
      { ownerNumber: 3, usageType: 'Dealer / Wholesale', province: 'Ontario', period: '2025', avgKmYear: '—', note: 'Repaired and transferred post-incident.' },
      { ownerNumber: 4, usageType: 'Personal · Current', province: 'Ontario', period: '2026 – Present', avgKmYear: '—', note: 'Odometer 63,904 km verified Jan 2026.' },
    ],
    incidents: [
      {
        incidentNumber: 1,
        date: '2025-07-24',
        headline: 'Severe Ontario Collision Reported',
        details: 'Police / Collision Reporting Centre record · front-left & side panel repair recommended for pre-purchase inspection.',
        severity: 'severe',
        airbagDeployed: false,
        structural: false,
        claimAmount: '$8,450 CAD (est.)',
      },
    ],
    events: [
      { date: '2026-01-19', km: 63904, mi: 39708, source: 'Ontario MTO Registration', category: 'title', detail: 'Registration renewed · Ontario safety inspection passed' },
      { date: '2025-07-24', km: 59840, mi: 37183, source: 'Ontario Collision Reporting Centre', category: 'damage', detail: 'Collision report logged — verify front bumper, radiator core support & ADAS sensor alignment' },
      { date: '2024-04-08', km: 53210, mi: 33063, source: 'Kia Dealership · Sudbury, ON', category: 'service', detail: '50,000 km maintenance · oil & filter · brake fluid flush' },
      { date: '2022-06-12', km: 34150, mi: 21220, source: 'Kia Dealership · Sudbury, ON', category: 'service', detail: 'Oil & filter changed · tire rotation · winter safety check' },
    ],
    recalls: [
      {
        campaignNumber: 'TC-2023-KIA-HCU',
        component: 'Hydraulic Electronic Control Unit (HECU)',
        summary: 'Verify with Kia Canada or Transport Canada VRDB whether software/fuse recall remedy was completed.',
        remedy: 'Free inspection and fuse replacement at any authorized Kia Canada dealer.',
      },
    ],
    photos: [],
    auctionLots: [],
    externalPdfUrl: null,
  };
}

function makeDemoF150() {
  const kmReadings = [
    ['2021-04-10', 22],
    ['2022-02-18', 21400],
    ['2023-03-09', 43100],
    ['2024-05-14', 62800],
    ['2025-08-22', 78420],
  ];
  return {
    vin: '1FTFW1E8XMFA19204',
    isDemo: true,
    sourceMode: 'demo',
    generatedAt: new Date().toISOString(),
    vehicleTitle: '2021 Ford F-150 Lariat 4WD',
    year: 2021,
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat 4WD',
    bodyClass: 'Pickup · Crew Cab',
    engineSummary: '3.5L EcoBoost V6 · 6-cyl',
    fuelType: 'Gasoline',
    driveType: '4WD',
    builtIn: 'Dearborn, Michigan, United States',
    builtInCanada: false,
    lastProvince: 'Ontario, Canada (RIV Imported)',
    exteriorColor: 'Blue',
    verdict: {
      tone: 'good',
      headline: 'Clean cross-border history — 0 accidents, verified RIV federal import',
      subheadline: '78,420 km · 2 owners · 8 service records · zero salvage or flood auction flags',
    },
    brandFlags: {
      cleanTitle: true,
      salvage: false,
      rebuilt: false,
      flood: false,
      totalLoss: false,
      structural: false,
      airbag: false,
      theft: false,
      odometerRollback: false,
      titleBrandSummary: 'Clean Title (RIV Cleared)',
    },
    kpis: {
      accidents: 0,
      owners: 2,
      serviceRecords: 8,
      openRecalls: 0,
      lastOdometerKm: 78420,
      lastOdometerMi: 48728,
      avgKmPerYear: 17400,
      auctionLotsCount: 0,
    },
    valuationCad: {
      currency: 'CAD',
      lowCad: 43500,
      highCad: 49500,
      midCad: 46500,
      dealerTradeLowCad: 36500,
      dealerTradeHighCad: 41500,
    },
    odometerReadings: kmReadings.map(([date, km]) => ({
      date,
      km,
      mi: Math.round(km / 1.60934),
      flaggedRollback: false,
    })),
    owners: [
      { ownerNumber: 1, usageType: 'Personal', province: 'Texas, USA', period: '2021 – 2024', avgKmYear: '18,200 km / yr', note: 'Clean US title, zero hurricane/flood damage markers.' },
      { ownerNumber: 2, usageType: 'Personal · Current', province: 'Ontario, Canada', period: '2024 – Present', avgKmYear: '15,600 km / yr', note: 'Cleared Registrar of Imported Vehicles (RIV) & Ontario safety inspection.' },
    ],
    incidents: [],
    events: [
      { date: '2025-08-22', km: 78420, mi: 48728, source: 'Ford Service · Mississauga, ON', category: 'service', detail: 'Synthetic oil change · brake pad check (7mm front / 8mm rear)' },
      { date: '2024-05-14', km: 62800, mi: 39022, source: 'RIV / ServiceOntario', category: 'title', detail: 'Federal import inspection & Ontario registration issued' },
      { date: '2023-03-09', km: 43100, mi: 26781, source: 'Ford Dealership Service', category: 'service', detail: '40,000 km scheduled service · cabin & air filters' },
    ],
    recalls: [],
    photos: [],
    auctionLots: [],
    externalPdfUrl: null,
  };
}

const DEMO_BUILDERS = {
  '2C4RDGBGXGR217456': makeDemoCaravan,
  KNAF55AC3L5071117: makeDemoForte,
  '1FTFW1E8XMFA19204': makeDemoF150,
};

function getDemoDossier(vin) {
  const clean = String(vin || '').trim().toUpperCase();
  return DEMO_BUILDERS[clean] ? DEMO_BUILDERS[clean]() : null;
}

// ---------------------------------------------------------------------------
// AuctionsAPI Client (Ported to pure Node for Drivee serverless)
// ---------------------------------------------------------------------------
async function auctionsGet(pathOrUrl, timeoutMs = 20000) {
  const key = getAuctionsKey();
  if (!key) return { ok: false, status: 0, data: null };
  const target = pathOrUrl.startsWith(`${AUCTIONS_BASE}/`)
    ? pathOrUrl
    : `${AUCTIONS_BASE}/${pathOrUrl.replace(/^\/+/, '')}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'x-api-key': key },
    });
    clearTimeout(timer);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, data: null };
  }
}

async function checkFreeUpstreamCoverage(vin) {
  const key = getAuctionsKey();
  if (!key) return null;
  const cleanVin = String(vin || '').toUpperCase().trim();

  // Verified AuctionsAPI free record pre-check endpoint: GET /reports/check-records/{vin}
  // Returns { vin, carfax: number, autocheck: number, vehicle: string } at $0 cost.
  const [recRes, localRes] = await Promise.all([
    auctionsGet(`/reports/check-records/${encodeURIComponent(cleanVin)}`, 12000),
    auctionsGet(`/local-exists/${encodeURIComponent(cleanVin)}`, 10000),
  ]);
  const recData = recRes.ok && recRes.data ? recRes.data : null;
  const localData = localRes.ok && localRes.data ? localRes.data : null;

  const carfaxRecords = Number(
    (recData && (typeof recData.carfax === 'number' ? recData.carfax : recData.carfax && recData.carfax.records)) || 0
  );
  const autocheckRecords = Number(
    (recData && (typeof recData.autocheck === 'number' ? recData.autocheck : recData.autocheck && recData.autocheck.records)) || 0
  );

  return {
    carfaxRecords,
    autocheckRecords,
    vehicleTitle: (recData && recData.vehicle) || (localData && localData.title) || null,
    localAuctionExists: Boolean(localData && localData.exists),
    auctionDomains: localData && Array.isArray(localData.domains) ? localData.domains : [],
  };
}

function isTrustedReportUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'report-cars.b-cdn.net' ||
        u.hostname === 'v-h-r.b-cdn.net' ||
        u.hostname === 'auctionsapi.com' ||
        u.hostname.endsWith('.auctionsapi.com'))
    );
  } catch {
    return false;
  }
}

async function fetchTrustedText(urlStr) {
  if (!isTrustedReportUrl(urlStr)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(urlStr, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok ? await res.text() : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function findFreeHistoryReportHtml(vin) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  for (const page of [1, 2]) {
    const res = await auctionsGet(`/reports/my-history?page=${page}`, 12000);
    if (!res.ok || !res.data || !Array.isArray(res.data.data)) break;
    const match = res.data.data.find(
      (item) => String(item.vin || '').toUpperCase() === cleanVin && item.path && item.path.html
    );
    if (match) {
      const html = await fetchTrustedText(String(match.path.html));
      if (html) return { html, type: String(match.type || 'carfax').toLowerCase(), costCad: 0 };
    }
    if (!res.data.links || !res.data.links.next) break;
  }
  return null;
}

async function orderPaidAuctionsHistory(vin) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  for (const kind of ['carfax', 'autocheck']) {
    const res = await auctionsGet(`/reports/${kind}/${encodeURIComponent(cleanVin)}?days=30&exclude_base_64=1`, 40000);
    if (res.ok && res.data && res.data.html) {
      const html = await fetchTrustedText(res.data.html);
      if (html) {
        return { html, type: kind, costCad: kind === 'carfax' ? 4.5 : 2.5 };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Upstream HTML Report Parser -> Drivee Canadian Dossier
// Supports both modern Carfax window.__INITIAL__DATA__ JSON payloads AND
// classic Carfax/AutoCheck HTML table layouts (all trademarks scrubbed).
// ---------------------------------------------------------------------------
function stripTags(html) {
  return scrubToDriveeBranding(
    String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function toIsoDate(rawDate) {
  const s = String(rawDate || '').trim();
  const iso = /\b((?:19|20)\d{2}-\d{2}-\d{2})\b/.exec(s);
  if (iso) return iso[1];
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    const yy = m[3].length === 2 ? (Number(m[3]) >= 70 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    return `${yy}-${mm}-${dd}`;
  }
  const yr = /\b(19|20)\d{2}\b/.exec(s);
  return yr ? `${yr[0]}-01-01` : '2020-01-01';
}

function parseOdometerTokenKm(raw) {
  const txt = String(raw || '').replace(/\u00a0/g, ' ').trim();
  if (!txt || /\bexempt\b|not\s+reported|n\/a/i.test(txt)) return null;
  const kmMatch = /([\d,]+)\s*(?:km|kilometers?)\b/i.exec(txt);
  if (kmMatch) {
    const n = Number(kmMatch[1].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  const miMatch = /([\d,]+)\s*mi\b/i.exec(txt);
  if (miMatch) {
    const mi = Number(miMatch[1].replace(/,/g, ''));
    return Number.isFinite(mi) && mi > 0 ? Math.round(mi * 1.60934) : null;
  }
  const bareMatch = /^[\s]*([\d,]{1,7})[\s]*$/.exec(txt);
  if (bareMatch) {
    const n = Number(bareMatch[1].replace(/,/g, ''));
    // Bare odometer values in Carfax US/NA tables are miles unless labeled km
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1.60934) : null;
  }
  return null;
}

function unwrapUpstreamText(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return stripTags(val);
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val !== 'object') return '';
  if (val.displayed === false) return '';
  if (typeof val.text === 'string') return stripTags(val.text);
  if (val.text && typeof val.text === 'object') return unwrapUpstreamText(val.text);
  for (const k of [
    'en',
    'translatedTextDisplay',
    'translatedText',
    'translatedTitle',
    'translatedHeading',
    'translatedDisplay',
    'urlDisplay',
    'yearMakeModel',
    'value',
  ]) {
    if (val[k] !== undefined) {
      const out = unwrapUpstreamText(val[k]);
      if (out) return out;
    }
  }
  return '';
}

function isNegativeRegistryPhrase(cell) {
  const t = String(cell || '').trim();
  if (!t || /^[-—\s]+$/.test(t)) return true;
  return /^(?:no\s+(?:new\s+)?issues?(?:\s+(?:reported|indicated))?|no\s+problems?|guaranteed\s+no\s+problem|no\s+recalls?\s+(?:reported|indicated)|no\s+open\s+recalls?(?:\s+(?:reported|indicated))?|no\s+airbag\s+deployment(?:\s+(?:reported|indicated))?|airbags?\s+did\s+not\s+deploy|no\s+structural\s+damage(?:\s+(?:reported|indicated))?|no\s+total\s+loss(?:\s+(?:reported|indicated))?|no\s+accidents?\s+or\s+damage(?:\s+(?:reported|indicated))?|no\s+cpo\s+info(?:\s+available)?|no\s+major\s+state\s+title\s+brands?|no\s+data|---)$/i.test(
    t
  );
}

function extractCarfaxInitialData(rawHtml) {
  const s = String(rawHtml || '');
  const markerIdx = s.indexOf('window.__INITIAL__DATA__');
  if (markerIdx < 0) return null;
  const eqIdx = s.indexOf('=', markerIdx);
  if (eqIdx < 0) return null;
  const jsonStart = s.indexOf('{', eqIdx);
  if (jsonStart < 0) return null;
  const scriptEnd = s.indexOf('</script>', jsonStart);
  const upperBound = scriptEnd > jsonStart ? scriptEnd : s.length;
  const jsonEnd = s.lastIndexOf('}', upperBound);
  if (jsonEnd <= jsonStart) return null;
  try {
    const parsed = JSON.parse(s.slice(jsonStart, jsonEnd + 1));
    if (parsed && typeof parsed === 'object' && parsed.vhr && typeof parsed.vhr === 'object') {
      return parsed.vhr;
    }
  } catch {
    return null;
  }
  return null;
}

function classifyEventCategory(text) {
  const lower = String(text || '').toLowerCase();
  if (/(accident|collision|damage report|damage claim|airbag|total loss|structural|impact)/.test(lower)) {
    return 'damage';
  }
  if (/(auction|copart|iaai|auto auction)/.test(lower)) {
    return 'auction';
  }
  if (/(listed for sale|online listing|offered for sale|dealer inventory)/.test(lower)) {
    return 'listing';
  }
  if (/(serviced|oil|filter|brake|tire|alignment|inspection|fluid|maintenance|battery|wiper)/.test(lower)) {
    return 'service';
  }
  return 'title';
}

function mapPoiIdentifier(rawId) {
  const clean = String(rawId || '').trim().toLowerCase().replace(/_/g, '-');
  const map = {
    front: 'front',
    'left-front': 'left_front',
    'right-front': 'right_front',
    'left-side': 'left_side',
    left: 'left_side',
    'right-side': 'right_side',
    right: 'right_side',
    side: 'side',
    'left-rear': 'left_rear',
    'right-rear': 'right_rear',
    rear: 'rear',
    roof: 'roof',
    undercarriage: 'undercarriage',
    'all-over': 'all_over',
    all: 'all_over',
  };
  return map[clean] || null;
}

function extractDamageZonesFromText(text) {
  const t = String(text || '').toLowerCase();
  const zones = [];
  const add = (z) => { if (!zones.includes(z)) zones.push(z); };
  if (/\ball[\s-]?over\b|\bmultiple\s+areas\b/.test(t)) add('all_over');
  if (/\bleft[\s-]?front\b|\bfront[\s-]?left\b|\bdriver[\s'-]*s?\s+front\b/.test(t)) add('left_front');
  if (/\bright[\s-]?front\b|\bfront[\s-]?right\b|\bpassenger[\s'-]*s?\s+front\b/.test(t)) add('right_front');
  if (/\bfront\b/.test(t) && !/\b(?:left|right)[\s-]?front\b/.test(t)) add('front');
  if (/\bfront\s+(?:bumper|end|impact|center)\b/.test(t)) add('front');
  if (/\bleft[\s-]?rear\b|\brear[\s-]?left\b/.test(t)) add('left_rear');
  if (/\bright[\s-]?rear\b|\brear[\s-]?right\b/.test(t)) add('right_rear');
  if (/\brear\b/.test(t) && !/\b(?:left|right)[\s-]?rear\b/.test(t)) add('rear');
  if (/\bleft[\s-]?side\b|\bdriver[\s'-]*s?\s+side\b/.test(t)) add('left_side');
  if (/\bright[\s-]?side\b|\bpassenger[\s'-]*s?\s+side\b/.test(t)) add('right_side');
  if (/\broof\b|\btop\b|\brollover\b/.test(t)) add('roof');
  if (/\bundercarriage\b|\bunderbody\b|\bsubframe\b/.test(t)) add('undercarriage');
  return zones;
}

function parseCarfaxInitialDataToDrivee({ vin, vhr, specs, recalls, valuationCad }) {
  const headerSec = vhr.headerSection || {};
  const vInfo = headerSec.vehicleInformation || {};
  const upstreamTitle = unwrapUpstreamText(vInfo.yearMakeModel) || null;

  let lastProvince = 'North America';
  let serviceCountOverride = null;
  const overviewRows = (headerSec.historyOverview && Array.isArray(headerSec.historyOverview.rows))
    ? headerSec.historyOverview.rows
    : [];
  for (const row of overviewRows) {
    if (!row || row.displayed === false) continue;
    const combined = `${unwrapUpstreamText(row.translatedText)} ${unwrapUpstreamText(row.translatedTextSecondLine)}`.trim();
    const lastOwned = /Last Owned in\s+([A-Za-z0-9\s.,-]+)/i.exec(combined);
    if (lastOwned) lastProvince = lastOwned[1].trim();
    const svc = /(\d+)\s+Service History Records?/i.exec(combined);
    if (svc) serviceCountOverride = Number(svc[1]);
  }

  const extractCommentGroups = (commentsObj) => {
    const headlines = [];
    const lines = [];
    if (!commentsObj || commentsObj.displayed === false || !Array.isArray(commentsObj.commentsGroups)) {
      return { headlines, lines };
    }
    for (const grp of commentsObj.commentsGroups) {
      if (!grp || grp.displayed === false || grp.followupGroup === true) continue;
      if (grp.outerLine && grp.outerLine.displayed !== false) {
        const t = unwrapUpstreamText(grp.outerLine.commentsTextLine) || unwrapUpstreamText(grp.outerLine.commentsUrlLine);
        if (t && !isNegativeRegistryPhrase(t) && !/^locate an authorized/i.test(t)) headlines.push(t);
      }
      if (Array.isArray(grp.innerLines)) {
        for (const il of grp.innerLines) {
          if (!il || il.displayed === false) continue;
          const t = unwrapUpstreamText(il.commentsTextLine) || unwrapUpstreamText(il.commentsUrlLine);
          if (t) lines.push(t);
        }
      }
    }
    return { headlines, lines };
  };

  // Additional history + Title history flags
  const getSectionPositiveCells = (sec, needle) => {
    const out = [];
    const rows = sec && Array.isArray(sec.rows) ? sec.rows : [];
    for (const row of rows) {
      if (!row || row.displayed === false) continue;
      const titleTxt = unwrapUpstreamText(row.translatedTitle) || unwrapUpstreamText(row.description);
      if (needle && !needle.test(titleTxt)) continue;
      const cells = Array.isArray(row.cells) ? row.cells.map(unwrapUpstreamText).filter(Boolean) : [];
      const comb = unwrapUpstreamText(row.combinedCell);
      for (const c of cells.length ? cells : comb ? [comb] : []) {
        if (!isNegativeRegistryPhrase(c)) out.push(c);
      }
    }
    return out;
  };

  const addSec = vhr.additionalHistorySection || {};
  const thSec = vhr.titleHistorySection || {};
  const titlePos = getSectionPositiveCells(thSec, null);
  const totalLossPos = getSectionPositiveCells(addSec, /total\s*loss/i);
  const structuralPos = getSectionPositiveCells(addSec, /structural/i);
  const airbagPos = getSectionPositiveCells(addSec, /airbag/i);
  const odoPos = getSectionPositiveCells(addSec, /odometer/i);
  const titleJoined = titlePos.join(' · ');

  const salvage = /\bsalvage\b/i.test(titleJoined);
  const rebuilt = /\brebuilt\b|\breconstructed\b/i.test(titleJoined);
  const flood = /\bflood\b|\bwater\s+damage\b/i.test(titleJoined);
  const totalLoss = totalLossPos.length > 0 || /\btotal\s+loss\b/i.test(titleJoined);
  const structural = structuralPos.length > 0;
  const airbag = airbagPos.length > 0;
  let detectedRollback = odoPos.length > 0 || /\brollback\b|\bnot\s+actual\s+mileage\b|\binconsisten/i.test(titleJoined);

  // Accident / Damage records (with impact zones from pointsOfImpact + text)
  const incidents = [];
  const accSec = vhr.accidentDamageSection;
  if (accSec && accSec.displayed !== false && Array.isArray(accSec.accidentDamageRecords)) {
    let idx = 0;
    for (const rec of accSec.accidentDamageRecords) {
      if (!rec || rec.displayed === false) continue;
      idx += 1;
      const { headlines, lines } = extractCommentGroups(rec.comments);
      const headline = headlines[0] || 'Accident / damage reported';
      const details = lines.join(' · ') || 'Logged in accident / damage history';
      const combined = `${headline} · ${details}`;
      const zones = [];
      const poiObj = rec.pointsOfImpact;
      if (poiObj && poiObj.displayed !== false) {
        for (const rawId of Array.isArray(poiObj.pointOfImpactIdentifiers) ? poiObj.pointOfImpactIdentifiers : []) {
          const z = mapPoiIdentifier(rawId);
          if (z && !zones.includes(z)) zones.push(z);
        }
        const altTxt = unwrapUpstreamText(poiObj.translatedPOIImageAltText);
        for (const z of extractDamageZonesFromText(altTxt)) {
          if (!zones.includes(z)) zones.push(z);
        }
      }
      for (const z of extractDamageZonesFromText(combined)) {
        if (!zones.includes(z)) zones.push(z);
      }
      const sevStr = rec.severityScale && rec.severityScale.displayed !== false ? String(rec.severityScale.severity || '') : '';
      const claimM = /((?:CAD|US)?\$\s*[\d,]+(?:\.\d{2})?)/i.exec(combined);
      const incAirbag = /\bairbags?\s+deployed\b/i.test(combined) && !/\b(?:did\s+not\s+deploy|no\s+airbag)/i.test(combined);
      const incStructural = /structural/i.test(sevStr) || (/\b(?:structural|frame)\s+damage/i.test(combined) && !/\bno\s+(?:structural|frame)/i.test(combined));
      const sevText = `${sevStr} ${combined}`;
      const severity = incAirbag || incStructural || /severe/i.test(sevText)
        ? 'severe'
        : /moderate/i.test(sevText)
        ? 'moderate'
        : /minor/i.test(sevText)
        ? 'minor'
        : 'unspecified';
      incidents.push({
        incidentNumber: idx,
        ownerNumber: null,
        date: toIsoDate(rec.date || ''),
        headline,
        details,
        sourceLabel: 'Police / Insurer Damage Report',
        zones,
        severity,
        airbagDeployed: incAirbag,
        structural: incStructural,
        claimAmount: claimM ? claimM[1].replace(/\s+/g, '') : null,
      });
    }
  }

  // Ownership summary table
  const owners = [];
  const ohSec = vhr.ownershipHistorySection;
  if (ohSec && ohSec.displayed !== false) {
    const headings = (
      ohSec.columnedSectionHeader &&
      ohSec.columnedSectionHeader.columnHeadings &&
      Array.isArray(ohSec.columnedSectionHeader.columnHeadings.columnHeadings)
    )
      ? ohSec.columnedSectionHeader.columnHeadings.columnHeadings
          .filter((ch) => ch && ch.displayed !== false)
          .map((ch) => unwrapUpstreamText(ch.translatedHeading))
          .filter(Boolean)
      : [];
    const metricMap = new Map();
    for (const row of Array.isArray(ohSec.rows) ? ohSec.rows : []) {
      if (!row || row.displayed === false) continue;
      const k = (unwrapUpstreamText(row.translatedTitle) || unwrapUpstreamText(row.description)).toLowerCase();
      if (!k) continue;
      const cells = Array.isArray(row.cells) ? row.cells : [];
      const comb = unwrapUpstreamText(row.combinedCell);
      metricMap.set(
        k,
        headings.map((_, idx) => unwrapUpstreamText(cells[idx]) || (headings.length === 1 ? comb : ''))
      );
    }
    const getMetric = (frag, col) => {
      for (const [k, vals] of metricMap.entries()) {
        if (k.includes(frag)) {
          const v = vals[col] || '';
          return v === '---' || /no data/i.test(v) ? '' : v;
        }
      }
      return '';
    };
    headings.forEach((lbl, i) => {
      const yr = getMetric('year purchased', i) || 'Recorded';
      const usage = getMetric('type of owner', i) || 'Personal';
      const dur = getMetric('length of ownership', i) || 'Recorded';
      const prov = getMetric('states/provinces', i) || lastProvince || 'North America';
      const lastOdo = getMetric('last reported odometer', i);
      const rawMiYr = getMetric('miles driven per year', i);
      const miPerYearNum = rawMiYr ? Number(rawMiYr.replace(/[^0-9]/g, '')) || null : null;
      const kmPerYearNum = miPerYearNum ? Math.round(miPerYearNum * 1.60934) : null;
      const isShortFlip = /^([12]\s*months?|<\s*1\s*month|\d+\s*days?)/i.test(dur);
      owners.push({
        ownerNumber: i + 1,
        label: lbl || `Owner ${i + 1}`,
        purchasedYear: yr,
        usageType: usage,
        durationLabel: dur,
        period: `${yr}${dur ? ` · ${dur}` : ''}`,
        province: prov,
        miPerYear: miPerYearNum,
        kmPerYear: kmPerYearNum,
        firstDate: null,
        lastDate: null,
        shortFlipWarning: isShortFlip,
        note: `${lbl} (${usage}, ${dur})${lastOdo ? ` · Last reported odometer ${lastOdo}` : ''}.`,
      });
    });
  }

  // Detailed history owner blocks -> events + odometer readings + POI zones + owner date spans
  const events = [];
  const odometerReadings = [];
  const seenOdo = new Set();
  const blocks =
    vhr.detailsSection &&
    vhr.detailsSection.ownerBlocks &&
    Array.isArray(vhr.detailsSection.ownerBlocks.ownerBlocks)
      ? vhr.detailsSection.ownerBlocks.ownerBlocks
      : [];

  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b] || {};
    const ownerNumber = Number(block.ownerNumber) || b + 1;
    const recs = Array.isArray(block.records)
      ? block.records
      : block.records && Array.isArray(block.records.records)
      ? block.records.records
      : [];
    let firstDate = null;
    let lastDate = null;

    for (const rec of recs) {
      if (!rec || rec.displayed === false) continue;
      const isoDate = toIsoDate(rec.dateDisplay || '');
      if (!firstDate || isoDate < firstDate) firstDate = isoDate;
      if (!lastDate || isoDate > lastDate) lastDate = isoDate;

      const odoObj = rec.odometerReading;
      let km =
        odoObj && odoObj.displayed !== false && odoObj.odometerReading
          ? parseOdometerTokenKm(`${odoObj.odometerReading} ${odoObj.odometerReadingLabel || 'mi'}`)
          : null;

      const srcLines = [];
      if (rec.source && Array.isArray(rec.source.sourceLines)) {
        for (const sl of rec.source.sourceLines) {
          if (!sl || sl.displayed === false) continue;
          const t = cleanDealerSourceText(unwrapUpstreamText(sl.sourceTextLine) || unwrapUpstreamText(sl.sourceUrlLine));
          if (t && !/\.(com|ca|net|org)\b/i.test(t) && !/^[\d\-().\s+]{7,}$/.test(t) && !/customer favorite|verified review|out of 5|stars$|top[- ]rated/i.test(t)) {
            if (!srcLines.some((e) => e.toLowerCase() === t.toLowerCase())) srcLines.push(t);
          }
        }
      }
      const dealerTrack = rec.source && rec.source.ratingsSummary && rec.source.ratingsSummary.ratingsDealerTracking;
      const cityState = srcLines.find((l) => /,\s*[A-Z]{2}\b/.test(l)) || (dealerTrack && dealerTrack.city && dealerTrack.state ? `${dealerTrack.city}, ${dealerTrack.state}` : '');
      const sourceName = (dealerTrack && dealerTrack.name && (!srcLines[0] || /,\s*[A-Z]{2}\b/.test(srcLines[0])))
        ? stripTags(dealerTrack.name)
        : srcLines[0] || 'Vehicle Registry';
      const location = cityState || srcLines[1] || sourceName;
      const source = srcLines.slice(0, 2).join(' · ') || sourceName;

      const { headlines, lines } = extractCommentGroups(rec.comments);
      const headline = headlines[0] || lines[0] || 'Registry record logged';
      const pills = [];
      if (sourceName && sourceName !== location) {
        if (lines.length) pills.push(`${sourceName} — ${lines[0]}`);
        else pills.push(sourceName);
        for (const l of lines.slice(1, 7)) pills.push(l);
      } else {
        for (const l of lines.slice(0, 7)) pills.push(l);
      }
      const detail = [...headlines, ...lines].filter(Boolean).join(' · ') || 'Registry record logged';

      // Merge pointOfImpactContainer zones into matching incident (or create one!)
      const poiCont = rec.pointOfImpactContainer;
      if (poiCont && poiCont.displayed) {
        const recZones = [];
        const ids = (poiCont.pointOfImpactFrame && Array.isArray(poiCont.pointOfImpactFrame.pointOfImpactIdentifiers))
          ? poiCont.pointOfImpactFrame.pointOfImpactIdentifiers
          : [];
        for (const rawId of ids) {
          const z = mapPoiIdentifier(rawId);
          if (z && !recZones.includes(z)) recZones.push(z);
        }
        const sevStr = poiCont.severityScaleFrame && poiCont.severityScaleFrame.displayed ? String(poiCont.severityScaleFrame.severity || '') : '';
        const existingInc = incidents.find((inc) => inc.date === isoDate);
        if (existingInc) {
          existingInc.ownerNumber = existingInc.ownerNumber || ownerNumber;
          if (sourceName && sourceName !== 'Vehicle Registry') existingInc.sourceLabel = sourceName;
          for (const z of recZones) {
            if (!existingInc.zones.includes(z)) existingInc.zones.push(z);
          }
          if (sevStr && existingInc.severity === 'unspecified') {
            existingInc.severity = /severe/i.test(sevStr) ? 'severe' : /moderate/i.test(sevStr) ? 'moderate' : /minor/i.test(sevStr) ? 'minor' : existingInc.severity;
          }
        } else if (recZones.length > 0) {
          incidents.push({
            incidentNumber: incidents.length + 1,
            ownerNumber,
            date: isoDate,
            headline,
            details: lines.join(' · ') || 'Logged in accident / damage history',
            sourceLabel: sourceName,
            zones: recZones,
            severity: /severe/i.test(sevStr) ? 'severe' : /moderate/i.test(sevStr) ? 'moderate' : /minor/i.test(sevStr) ? 'minor' : 'unspecified',
            airbagDeployed: /\bairbags?\s+deployed\b/i.test(detail) && !/did not deploy|no airbag/i.test(detail),
            structural: Boolean(poiCont.isSmashed) || /structural/i.test(sevStr),
            claimAmount: null,
          });
        }
      }

      if (km === null) {
        const kmFb = /Odometer reported as\s+([\d,]+)\s*kilometers?/i.exec(detail);
        if (kmFb) km = Math.round(Number(kmFb[1].replace(/,/g, '')));
      }

      const category = classifyEventCategory(`${source} ${detail}`);
      if (category === 'damage') {
        const matchInc = incidents.find((inc) => inc.date === isoDate);
        if (matchInc && !matchInc.ownerNumber) matchInc.ownerNumber = ownerNumber;
      }

      events.push({
        date: isoDate,
        km,
        mi: km ? Math.round(km / 1.60934) : null,
        ownerNumber,
        headline,
        location,
        source,
        pills,
        category,
        detail,
      });

      if (km && km > 0) {
        const key = `${isoDate}|${km}`;
        if (!seenOdo.has(key)) {
          seenOdo.add(key);
          odometerReadings.push({
            date: isoDate,
            km,
            mi: Math.round(km / 1.60934),
            ownerNumber,
            source: sourceName,
            location,
            flaggedRollback: false,
          });
        }
      }
    }

    const ownerObj = owners.find((o) => o.ownerNumber === ownerNumber);
    if (ownerObj) {
      ownerObj.firstDate = firstDate;
      ownerObj.lastDate = lastDate;
    } else if (firstDate) {
      owners.push({
        ownerNumber,
        label: `Owner ${ownerNumber}`,
        purchasedYear: firstDate.slice(0, 4),
        usageType: 'Personal',
        durationLabel: 'Recorded',
        period: firstDate.slice(0, 4),
        province: lastProvince,
        miPerYear: null,
        kmPerYear: null,
        firstDate,
        lastDate,
        shortFlipWarning: false,
        note: `Owner ${ownerNumber} (${lastProvince}).`,
      });
    }
  }

  odometerReadings.sort((a, b) => a.date.localeCompare(b.date));
  let maxKm = -1;
  for (const r of odometerReadings) {
    if (r.km < maxKm - 50) {
      r.flaggedRollback = true;
      detectedRollback = true;
    } else if (r.km > maxKm) {
      maxKm = r.km;
    }
  }

  const damageEvents = events.filter((e) => e.category === 'damage');
  const serviceEvents = events.filter((e) => e.category === 'service');
  const serviceCount = typeof serviceCountOverride === 'number' ? serviceCountOverride : serviceEvents.length;
  const accidentCount = incidents.length || damageEvents.length;
  const lastOdo = odometerReadings[odometerReadings.length - 1] || null;
  const avgKmPerYear =
    odometerReadings.length >= 2
      ? Math.max(
          0,
          Math.round(
            (odometerReadings[odometerReadings.length - 1].km - odometerReadings[0].km) /
              Math.max(
                0.5,
                (Date.parse(odometerReadings[odometerReadings.length - 1].date) -
                  Date.parse(odometerReadings[0].date)) /
                  (1000 * 60 * 60 * 24 * 365.25)
              )
          )
        )
      : null;

  const hasSevere = salvage || rebuilt || flood || totalLoss || structural || airbag || detectedRollback;
  const hasWarn = !hasSevere && accidentCount > 0;
  const title = specs
    ? [specs.year, specs.make, specs.model, specs.trim].filter(Boolean).join(' ')
    : upstreamTitle || `VIN ${vin}`;

  return {
    schemaVersion: 2,
    vin,
    isDemo: false,
    sourceMode: 'live',
    generatedAt: new Date().toISOString(),
    vehicleTitle: title,
    year: specs ? specs.year : null,
    make: specs ? specs.make : null,
    model: specs ? specs.model : null,
    trim: specs ? specs.trim : null,
    bodyClass: specs ? specs.bodyClass : 'Passenger Vehicle',
    engineSummary: specs ? specs.engineSummary : 'Standard',
    fuelType: specs ? specs.fuelType : 'Gasoline',
    driveType: specs ? specs.driveType : 'Standard',
    builtIn: specs ? specs.builtIn : 'Verified by VIN',
    builtInCanada: specs ? specs.builtInCanada : /^2/.test(vin),
    lastProvince,
    exteriorColor: null,
    verdict: {
      tone: hasSevere ? 'bad' : hasWarn ? 'warn' : 'good',
      headline: hasSevere
        ? 'High-risk history alert — brand, structural, or odometer flag detected'
        : hasWarn
        ? `Clean title status · ${accidentCount} reported damage event${accidentCount === 1 ? '' : 's'}`
        : 'Looks clean — no salvage brands or odometer rollbacks detected',
      subheadline: hasSevere
        ? 'A major title brand, structural alert, airbag deployment, or odometer inconsistency was reported. Require full documentation and a hoist inspection before buying.'
        : hasWarn
        ? 'Title brands and total-loss registries are clear, though at least one collision or damage claim was filed. Confirm repair workmanship on an alignment rack and paint depth gauge.'
        : `${owners.length || Math.max(1, blocks.length)} owner(s) · ${serviceCount} service records · ${odometerReadings.length} odometer logs · ${recalls.length} open recall(s)`,
    },
    brandFlags: {
      cleanTitle: !salvage && !rebuilt && !flood && !totalLoss,
      salvage,
      rebuilt,
      flood,
      totalLoss,
      structural,
      airbag,
      theft: /\bstolen\b|\btheft\s+record\b/i.test(titleJoined) && !/no\s+theft/i.test(titleJoined),
      odometerRollback: detectedRollback,
      titleBrandSummary: salvage
        ? 'Salvage Brand'
        : rebuilt
        ? 'Rebuilt Brand'
        : flood
        ? 'Flood / Water Brand'
        : totalLoss
        ? 'Total Loss'
        : 'Clean Title',
    },
    kpis: {
      accidents: accidentCount,
      owners: owners.length || Math.max(1, blocks.length),
      serviceRecords: serviceCount,
      openRecalls: recalls.length,
      lastOdometerKm: lastOdo ? lastOdo.km : null,
      lastOdometerMi: lastOdo ? lastOdo.mi : null,
      avgKmPerYear,
      auctionLotsCount: 0,
    },
    valuationCad,
    odometerReadings,
    owners,
    incidents: incidents.length
      ? incidents
      : damageEvents.map((e, idx) => ({
          incidentNumber: idx + 1,
          ownerNumber: e.ownerNumber || 1,
          date: e.date,
          headline: e.headline || e.source,
          details: e.detail,
          sourceLabel: e.source || 'Registry Report',
          zones: extractDamageZonesFromText(e.detail),
          severity: structural || airbag ? 'severe' : 'moderate',
          airbagDeployed: airbag,
          structural,
          claimAmount: null,
        })),
    events: events.slice().reverse(),
    recalls,
    photos: [],
    auctionLots: [],
    externalPdfUrl: null,
  };
}

function parseUpstreamHtmlToDrivee({ vin, html, specs, recalls, valuationCad }) {
  // 1. Modern Carfax HTML embeds complete structured history inside window.__INITIAL__DATA__
  const initialVhr = extractCarfaxInitialData(html);
  if (initialVhr) {
    const structured = parseCarfaxInitialDataToDrivee({
      vin,
      vhr: initialVhr,
      specs,
      recalls,
      valuationCad,
    });
    if (structured && (structured.events.length > 0 || structured.owners.length > 0)) {
      return structured;
    }
  }

  // 2. Fallback for AutoCheck / classic table-based Carfax HTML layouts
  const plain = stripTags(html);
  const salvage = /\bsalvage\s+title\b|\bsalvage\s+brand\b/i.test(plain) && !/no\s+salvage/i.test(plain);
  const rebuilt = /\brebuilt\s+title\b|\brebuilt\s+brand\b/i.test(plain);
  const flood = /\bflood\s+(?:damage|title|brand)\b/i.test(plain) && !/no\s+flood/i.test(plain);
  const totalLoss = /\btotal\s+loss\s+(?:reported|vehicle)\b/i.test(plain) && !/no\s+total\s+loss/i.test(plain);
  const structural = /\bstructural\s+damage\s+reported\b/i.test(plain) && !/no\s+structural/i.test(plain);
  const airbag = /\bairbags?\s+deployed\b/i.test(plain) && !/did\s+not\s+deploy/i.test(plain);
  const rollbackFlag = /\bodometer\s+rollback\b|\bmileage\s+inconsistency\b/i.test(plain);

  // Extract dated rows from standard <tr> detail records when present
  const events = [];
  const odometerReadings = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(html)) !== null && events.length < 150) {
    const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]));
    if (cells.length < 3) continue;
    const dateMatch = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(cells[0]);
    if (!dateMatch) continue;
    const isoDate = toIsoDate(dateMatch[1]);
    const km = parseOdometerTokenKm(cells[1]);
    const source = cleanDealerSourceText(cells[2]) || 'Vehicle Registry';
    const detail = scrubToDriveeBranding(cells.slice(3).join(' · ')) || 'Registry record logged';
    const category = classifyEventCategory(`${source} ${detail}`);

    events.push({
      date: isoDate,
      km,
      mi: km ? Math.round(km / 1.60934) : null,
      source,
      category,
      detail,
    });
    if (km && km > 0) {
      odometerReadings.push({ date: isoDate, km, mi: Math.round(km / 1.60934), flaggedRollback: false });
    }
  }

  // Chronological rollback detection
  odometerReadings.sort((a, b) => a.date.localeCompare(b.date));
  let maxKm = -1;
  let detectedRollback = rollbackFlag;
  for (const r of odometerReadings) {
    if (r.km < maxKm) {
      r.flaggedRollback = true;
      detectedRollback = true;
    } else {
      maxKm = r.km;
    }
  }

  const damageEvents = events.filter((e) => e.category === 'damage');
  const serviceEvents = events.filter((e) => e.category === 'service');
  const lastOdo = odometerReadings[odometerReadings.length - 1] || null;
  const avgKmPerYear =
    odometerReadings.length >= 2
      ? Math.max(
          0,
          Math.round(
            (odometerReadings[odometerReadings.length - 1].km - odometerReadings[0].km) /
              Math.max(
                0.5,
                (Date.parse(odometerReadings[odometerReadings.length - 1].date) -
                  Date.parse(odometerReadings[0].date)) /
                  (1000 * 60 * 60 * 24 * 365.25)
              )
          )
        )
      : null;

  const hasSevere = salvage || rebuilt || flood || totalLoss || structural || airbag || detectedRollback;
  const hasWarn = !hasSevere && damageEvents.length > 0;

  return {
    vin,
    isDemo: false,
    sourceMode: 'live',
    generatedAt: new Date().toISOString(),
    vehicleTitle: specs ? [specs.year, specs.make, specs.model, specs.trim].filter(Boolean).join(' ') : `VIN ${vin}`,
    year: specs ? specs.year : null,
    make: specs ? specs.make : null,
    model: specs ? specs.model : null,
    trim: specs ? specs.trim : null,
    bodyClass: specs ? specs.bodyClass : 'Passenger Vehicle',
    engineSummary: specs ? specs.engineSummary : 'Standard',
    fuelType: specs ? specs.fuelType : 'Gasoline',
    driveType: specs ? specs.driveType : 'Standard',
    builtIn: specs ? specs.builtIn : 'Verified by VIN',
    builtInCanada: specs ? specs.builtInCanada : /^2/.test(vin),
    lastProvince: 'North America',
    exteriorColor: null,
    verdict: {
      tone: hasSevere ? 'bad' : hasWarn ? 'warn' : 'good',
      headline: hasSevere
        ? 'High-risk history alert — brand, structural, or odometer flag detected'
        : hasWarn
        ? `${damageEvents.length} damage/incident record(s) logged — inspect repairs closely`
        : 'Looks clean — no salvage brands or odometer rollbacks detected',
      subheadline: `${serviceEvents.length} service records · ${odometerReadings.length} odometer logs · ${recalls.length} open safety recall(s)`,
    },
    brandFlags: {
      cleanTitle: !salvage && !rebuilt && !flood && !totalLoss,
      salvage,
      rebuilt,
      flood,
      totalLoss,
      structural,
      airbag,
      theft: /\bstolen\b|\btheft\s+record\b/i.test(plain) && !/no\s+theft/i.test(plain),
      odometerRollback: detectedRollback,
      titleBrandSummary: salvage
        ? 'Salvage Brand'
        : rebuilt
        ? 'Rebuilt Brand'
        : flood
        ? 'Flood / Water Brand'
        : totalLoss
        ? 'Total Loss'
        : 'Clean Title',
    },
    kpis: {
      accidents: damageEvents.length,
      owners: Math.max(1, (plain.match(/\bOwner\s+\d+\b/gi) || []).length || 1),
      serviceRecords: serviceEvents.length,
      openRecalls: recalls.length,
      lastOdometerKm: lastOdo ? lastOdo.km : null,
      lastOdometerMi: lastOdo ? lastOdo.mi : null,
      avgKmPerYear,
      auctionLotsCount: 0,
    },
    valuationCad,
    odometerReadings,
    owners: [],
    incidents: damageEvents.map((e, idx) => ({
      incidentNumber: idx + 1,
      date: e.date,
      headline: e.source,
      details: e.detail,
      severity: structural || airbag ? 'severe' : 'moderate',
      airbagDeployed: airbag,
      structural,
      claimAmount: null,
    })),
    events: events.slice().reverse(),
    recalls,
    photos: [],
    auctionLots: [],
    externalPdfUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Defense-in-depth Report Sanitizer (cleans live + cached reports uniformly)
// ---------------------------------------------------------------------------
function sanitizeDriveeReport(report) {
  if (!report || typeof report !== 'object') return report;
  if (report.verdict) {
    if (report.verdict.headline) report.verdict.headline = scrubToDriveeBranding(report.verdict.headline);
    if (report.verdict.subheadline) report.verdict.subheadline = scrubToDriveeBranding(report.verdict.subheadline);
  }
  if (Array.isArray(report.events)) {
    for (const ev of report.events) {
      if (!ev) continue;
      if (ev.source) ev.source = cleanDealerSourceText(ev.source) || 'Vehicle Registry';
      if (ev.location) ev.location = cleanDealerSourceText(ev.location) || ev.source || '';
      if (ev.headline) ev.headline = scrubToDriveeBranding(ev.headline) || 'Registry record logged';
      if (ev.detail) ev.detail = scrubToDriveeBranding(ev.detail) || 'Registry record logged';
      if (Array.isArray(ev.pills)) {
        ev.pills = ev.pills
          .map((p) => scrubToDriveeBranding(p))
          .filter((p) => p && !/customer favorite|verified review|out of 5|top[- ]rated/i.test(p));
      }
    }
  }
  if (Array.isArray(report.odometerReadings)) {
    for (const o of report.odometerReadings) {
      if (o && o.source) o.source = cleanDealerSourceText(o.source) || 'Vehicle Registry';
    }
  }
  if (Array.isArray(report.incidents)) {
    for (const inc of report.incidents) {
      if (!inc) continue;
      if (inc.headline) inc.headline = scrubToDriveeBranding(inc.headline);
      if (inc.details) inc.details = scrubToDriveeBranding(inc.details);
      if (inc.sourceLabel) inc.sourceLabel = cleanDealerSourceText(inc.sourceLabel) || 'Registry Report';
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Public Report Orchestrator
// ---------------------------------------------------------------------------
async function buildLiveDriveeReport({ vin, allowPaidFetch = false, demo = false }) {
  const cleanVin = String(vin || '').trim().toUpperCase();

  // 1. Built-in Canadian demo VINs (instant, zero API spend)
  const demoDossier = getDemoDossier(cleanVin);
  if (demoDossier && (demo || !allowPaidFetch || !hasAnyLiveUpstreamKey())) {
    return { ok: true, mode: 'demo', costCad: 0, report: sanitizeDriveeReport(demoDossier) };
  }

  // 2. Durable Supabase / local cached dossier (never reuse stale sandbox-preview or pre-v2 schemas)
  const cached = await getCachedReportAsync(cleanVin);
  if (
    cached &&
    cached.report &&
    cached.report.sourceMode !== 'sandbox-preview' &&
    Number(cached.report.schemaVersion || 1) >= 2
  ) {
    const before = JSON.stringify(cached.report);
    const cleaned = sanitizeDriveeReport(cached.report);
    if (JSON.stringify(cleaned) !== before) {
      await saveCachedReportAsync(cleanVin, cleaned);
    }
    return { ok: true, mode: 'cached', costCad: 0, report: cleaned };
  }

  // 3. Always fetch live free NHTSA vPIC specs, safety recalls, & CAD value estimate
  const specs = await decodeVinNhtsa(cleanVin);
  const recalls = specs && specs.make && specs.model && specs.year
    ? await fetchRecallsForVehicle(specs.make, specs.model, specs.year)
    : [];
  const valuationCad = estimateCanadianValueCad(specs);

  // 4. Try free AuctionsAPI my-history reuse first ($0 extra spend)
  if (getAuctionsKey()) {
    const freeHit = await findFreeHistoryReportHtml(cleanVin);
    if (freeHit && freeHit.html) {
      const report = parseUpstreamHtmlToDrivee({
        vin: cleanVin,
        html: freeHit.html,
        specs,
        recalls,
        valuationCad,
      });
      const refPhoto = specs
        ? await resolveVehicleReferencePhoto({
            year: specs.year,
            make: specs.make,
            model: specs.model,
            bodyClass: specs.bodyClass,
          })
        : { imageUrl: null, caption: null };
      if (refPhoto.imageUrl) {
        report.photos.push({ url: refPhoto.imageUrl, caption: refPhoto.caption });
      }
      await saveCachedReportAsync(cleanVin, report);
      return { ok: true, mode: 'live-history-reuse', costCad: 0, report };
    }
  }

  // 5. Paid live upstream order (strictly gated behind allowPaidFetch === true)
  let totalCostCad = 0;
  let report = null;

  if (allowPaidFetch && getAuctionsKey()) {
    const paidHtml = await orderPaidAuctionsHistory(cleanVin);
    if (paidHtml && paidHtml.html) {
      totalCostCad += paidHtml.costCad;
      report = parseUpstreamHtmlToDrivee({
        vin: cleanVin,
        html: paidHtml.html,
        specs,
        recalls,
        valuationCad,
      });
    }
    // Check auction photos/bids when indexed
    const localExists = await auctionsGet(`/local-exists/${encodeURIComponent(cleanVin)}`, 8000);
    if (localExists.ok && localExists.data && localExists.data.exists && report) {
      const lotRes = await auctionsGet(`/local-report/${encodeURIComponent(cleanVin)}`, 15000);
      if (lotRes.ok && lotRes.data && lotRes.data.data) {
        totalCostCad += 1.0;
        const ld = lotRes.data.data;
        const imgs = Array.isArray(ld.images) ? ld.images : [];
        for (const u of imgs.slice(0, 8)) {
          if (typeof u === 'string' && /^https:\/\//.test(u)) {
            report.photos.push({ url: u, caption: 'Pre-repair auction lot photo' });
          }
        }
        report.kpis.auctionLotsCount = 1;
      }
    }
  }

  // 6. Fallback structured dossier using NHTSA specs + recalls + Wikimedia photo
  // (also serves sandbox dry-run orders cleanly when upstream key is empty)
  if (!report && allowPaidFetch) {
    const title = specs
      ? [specs.year, specs.make, specs.model, specs.trim].filter(Boolean).join(' ')
      : `VIN ${cleanVin}`;
    report = {
      vin: cleanVin,
      isDemo: !hasAnyLiveUpstreamKey(),
      sourceMode: hasAnyLiveUpstreamKey() ? 'nhtsa-fallback' : 'sandbox-preview',
      generatedAt: new Date().toISOString(),
      vehicleTitle: title,
      year: specs ? specs.year : null,
      make: specs ? specs.make : null,
      model: specs ? specs.model : null,
      trim: specs ? specs.trim : null,
      bodyClass: specs ? specs.bodyClass : 'Passenger Vehicle',
      engineSummary: specs ? specs.engineSummary : 'Standard',
      fuelType: specs ? specs.fuelType : 'Gasoline',
      driveType: specs ? specs.driveType : 'Standard',
      builtIn: specs ? specs.builtIn : 'Verified by VIN',
      builtInCanada: specs ? specs.builtInCanada : /^2/.test(cleanVin),
      lastProvince: 'Canada',
      exteriorColor: null,
      verdict: {
        tone: !hasAnyLiveUpstreamKey() || recalls.length > 0 ? 'warn' : 'good',
        headline: !hasAnyLiveUpstreamKey()
          ? `${title} decoded — live history API key not configured locally`
          : `${title} decoded — ${recalls.length} safety recall(s) found`,
        subheadline: hasAnyLiveUpstreamKey()
          ? 'Live NHTSA vPIC + Canadian registry integration active.'
          : 'Local sandbox preview (live NHTSA vPIC specs + safety recalls + CAD valuation only). Set AUCTIONS_API_KEY in .env.local to pull full accident, owner, service, and odometer records.',
      },
      brandFlags: {
        cleanTitle: true,
        salvage: false,
        rebuilt: false,
        flood: false,
        totalLoss: false,
        structural: false,
        airbag: false,
        theft: false,
        odometerRollback: false,
        titleBrandSummary: 'Factory Decode & Recalls Verified',
      },
      kpis: {
        accidents: 0,
        owners: 1,
        serviceRecords: 0,
        openRecalls: recalls.length,
        lastOdometerKm: null,
        lastOdometerMi: null,
        avgKmPerYear: null,
        auctionLotsCount: 0,
      },
      valuationCad,
      odometerReadings: [],
      owners: [],
      incidents: [],
      events: [
        {
          date: new Date().toISOString().slice(0, 10),
          km: null,
          mi: null,
          source: 'Drivee Registry Engine',
          category: 'title',
          detail: `Decoded ${title} (${specs ? specs.builtIn : 'VIN verified'}). Live NHTSA safety recalls & Transport Canada lookup attached.`,
        },
      ],
      recalls,
      photos: [],
      auctionLots: [],
      externalPdfUrl: null,
    };
  }

  if (report) {
    sanitizeDriveeReport(report);
    if (!report.photos.length && specs) {
      const refPhoto = await resolveVehicleReferencePhoto({
        year: specs.year,
        make: specs.make,
        model: specs.model,
        bodyClass: specs.bodyClass,
      });
      if (refPhoto.imageUrl) {
        report.photos.push({ url: refPhoto.imageUrl, caption: refPhoto.caption });
      }
    }
    if (report.sourceMode !== 'sandbox-preview') {
      await saveCachedReportAsync(cleanVin, report);
    }
    return { ok: true, mode: report.sourceMode, costCad: totalCostCad, report };
  }

  return { ok: false, mode: 'locked', costCad: 0, report: null };
}

module.exports = {
  getAuctionsKey,
  hasAnyLiveUpstreamKey,
  fetchUpstreamReportBalance,
  testUpstreamConnection,
  getDemoDossier,
  checkFreeUpstreamCoverage,
  parseUpstreamHtmlToDrivee,
  sanitizeDriveeReport,
  buildLiveDriveeReport,
  capWords,
};
