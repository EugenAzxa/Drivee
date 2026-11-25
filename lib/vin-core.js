/**
 * Drivee Canadian VIN Core Library
 * ---------------------------------------------------------------------------
 * Pure Node >= 18 built-ins (no npm dependencies) so it runs identically in
 * local _dev-server.js and Vercel serverless functions without dirtying tracked
 * node_modules binaries.
 *
 * Responsibilities:
 *   1. Canadian CAD pricing tiers ($17 Single / $39 3-Pack / $99 10-Pack)
 *   2. ISO-3779 VIN validation + Drivee trademark scrubbing
 *   3. Free government & public data helpers (NHTSA vPIC, Safety Recalls,
 *      CAD private-sale value heuristic, Wikimedia CC exterior photo resolver)
 *   4. Stateless HMAC-SHA256 report access tokens + pack credit codes + promos
 *   5. Inquiry, order, margin & cache ledger (.vin-data/store.json or /tmp)
 *   6. Non-blocking Supabase analytics event emission (respects .env.local)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const supabaseStore = require('./vin-store-supabase');

const ROOT = path.resolve(__dirname, '..');

// Canadian CAD package catalog — replaces legacy $19 basic / $30 Ontario lien tiers.
const VIN_PRICING_CAD = [
  {
    id: 'single',
    name: 'Single Vehicle Report',
    badge: 'SAVE 75%',
    priceCad: 17,
    priceCents: 1700,
    retailCompareCad: 66.95,
    credits: 1,
    perReportLabel: '$17.00 CAD · 1 VIN',
    description:
      'Complete Canadian & North American vehicle history dossier for one car, delivered instantly with print-ready PDF.',
    features: [
      'Accident & collision claims + severity flags',
      'Chronological odometer graph (km & miles) + rollback alerts',
      'Provincial ownership sequence & prior commercial/rental use',
      'Stolen vehicle, salvage, flood & rebuilt title brand checks',
      'Save & print Drivee PDF report — one-time fee, no subscription',
    ],
    ctaLabel: 'Get Full Report — $17 CAD',
  },
  {
    id: 'pack3',
    name: 'Buyer 3-Report Pack',
    badge: 'MOST POPULAR',
    priceCad: 39,
    priceCents: 3900,
    retailCompareCad: 200.85,
    credits: 3,
    perReportLabel: '$13.00 CAD / report · never expires',
    description:
      'Compare your top 2–3 AutoTrader, Kijiji, or Marketplace finalists without paying $66+ per car.',
    features: [
      'Unlocks your current VIN + issues a 2-credit code for future cars',
      'Free VIN spec & recall radar on unlimited cars before spending credits',
      'Includes crash/auction photo gallery when indexed',
      'Credits never expire — zero monthly subscription ever',
    ],
    ctaLabel: 'Get 3-Report Pack — $39 CAD',
  },
  {
    id: 'pack10',
    name: 'Pro / Dealer 10-Pack',
    badge: 'BEST VALUE',
    priceCad: 99,
    priceCents: 9900,
    retailCompareCad: 669.50,
    credits: 10,
    perReportLabel: '$9.90 CAD / report · never expires',
    description:
      'Wholesale economics for frequent shoppers, mobile mechanics, and independent Ontario dealers.',
    features: [
      'Unlocks your current VIN + issues a 9-credit code for future checks',
      'Full collision, odometer, ownership, recall & auction logs',
      'Branded Drivee PDF export to share with buyers or clients',
      'Priority support via drivee.canada@gmail.com',
    ],
    ctaLabel: 'Get 10-Pack — $99 CAD',
  },
];

const TIER_MAP = new Map(VIN_PRICING_CAD.map((t) => [t.id, t]));

function getVinTier(id) {
  const clean = String(id || '').trim().toLowerCase();
  if (clean === 'basic') return TIER_MAP.get('single');
  return TIER_MAP.get(clean) || TIER_MAP.get('single');
}

function getTierByAmountCadCents(cents) {
  const n = Number(cents);
  if (n === 1700) return TIER_MAP.get('single');
  if (n === 3900) return TIER_MAP.get('pack3');
  if (n === 9900) return TIER_MAP.get('pack10');
  return null;
}

// ---------------------------------------------------------------------------
// VIN validation (ISO-3779 check digit for North American / standard 17-char)
// ---------------------------------------------------------------------------
const VIN_TRANSLIT = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function sanitizeVinInput(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
}

function validateVin(raw) {
  const vin = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!vin) return { valid: false, vin: '', error: 'Enter a 17-character VIN.' };
  if (/[IOQ]/.test(vin)) {
    return { valid: false, vin, error: 'A valid VIN never contains the letters I, O, or Q.' };
  }
  if (vin.length !== 17) {
    return {
      valid: false,
      vin,
      error: `A VIN must be exactly 17 characters (you entered ${vin.length}).`,
    };
  }
  // North American VINs (starting with 1, 2, 3, 4, 5) strictly obey ISO-3779 check digit at position 9.
  if (/^[1-5]/.test(vin)) {
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const val = VIN_TRANSLIT[vin[i]];
      if (val === undefined) {
        return { valid: false, vin, error: 'VIN contains an unsupported character.' };
      }
      sum += val * VIN_WEIGHTS[i];
    }
    const rem = sum % 11;
    const expected = rem === 10 ? 'X' : String(rem);
    if (vin[8] !== expected) {
      return {
        valid: false,
        vin,
        error: `Invalid VIN check digit (expected "${expected}" at character 9, found "${vin[8]}"). Double-check for a typo.`,
      };
    }
  }
  return { valid: true, vin };
}

// ---------------------------------------------------------------------------
// Drivee branding & Canadian sanitization helpers
// ---------------------------------------------------------------------------
function scrubToDriveeBranding(input) {
  return String(input || '')
    .replace(/\bno total loss reported to CARFAX\.?/gi, 'No total loss reported across insurer registries.')
    .replace(/\bCARFAX recommends\b/gi, 'Drivee recommends')
    .replace(/\bCARFAX guarantees\b/gi, 'Registry verification checks')
    .replace(/\bnot reported to CARFAX\b/gi, 'not reported to registry sources')
    .replace(/\breported to CARFAX\b/gi, 'reported to Canadian & insurer registries')
    .replace(/\bCARFAX Canada\b/gi, 'Drivee Registry')
    .replace(/\bCARFAX\b/gi, 'Drivee Vehicle History')
    .replace(/\bCARFOX\b/gi, 'Drivee')
    .replace(/\bCARPROOF\b/gi, 'Canadian Registry')
    .replace(/\bAutoCheck\b/gi, 'Vehicle Registry')
    .replace(/\bExperian\b/gi, 'Registry Partner')
    .replace(/\bVinBadge\b/gi, 'Drivee')
    .replace(/\bAuctionsAPI\b/gi, 'Drivee Auction Archive')
    .replace(/©\s*\d{4}.*?(S&P Global|Mobility Global|Experian|CARFAX)[^\n.]*/gi, '')
    .replace(/https?:\/\/(www\.)?(carfax|autocheck|carfaxonline|auctionsapi|report-cars\.b-cdn|v-h-r\.b-cdn|vinbadge)[^\s)]*/gi, '')
    // Never display third-party dealer review/favorites clutter ("6 Customer Favorites", "4.8 / 5.0", etc.)
    .replace(/\b\d[\d,]*\s*Customer\s+Favorites?\b/gi, '')
    .replace(/\bCustomer\s+Favorites?\b/gi, '')
    .replace(/\b\d[\d,]*\s*(?:Verified\s+)?(?:Customer\s+)?Reviews?\b/gi, '')
    .replace(/\bVerified\s+Reviews?\b/gi, '')
    .replace(/\b\d(?:\.\d)?\s*(?:\/|out\s+of)\s*5(?:\.0)?(?:\s*stars?)?\b/gi, '')
    .replace(/\bTop[- ]Rated\s+(?:Dealer|Service\s+Center)(?:\s+\d{4})?\b/gi, '')
    .replace(/\bDealer\s+of\s+the\s+Year(?:\s+\d{4})?\b/gi, '')
    // Clean upstream "City, null" template glitches without eating dealer names
    .replace(/\b([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,2}),\s*null(?=\s+\1,\s*[A-Z]{2}\b)/gi, '')
    .replace(/(\b([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,2}),\s*[A-Z]{2})\s+\2,\s*null\b/gi, '$1')
    .replace(/,\s*null\b/gi, '')
    .replace(/(?:\s*·\s*){2,}/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanDealerSourceText(input) {
  let s = scrubToDriveeBranding(input);
  if (!s) return '';
  s = s
    // Strip phone numbers and bare dealer domains from source lines
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '')
    .replace(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ca|net|org|auto|io)(?:\/\S*)?\b/gi, '')
    .replace(/(?:\s*·\s*){2,}/g, ' · ')
    .replace(/^\s*[·,|-]+\s*|\s*[·,|-]+\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s;
}

const UPPER_AUTO_TOKENS = new Set([
  'BMW', 'GMC', 'RAM', 'MINI', 'VW', 'AMG', 'GTI', 'SUV', 'AWD', 'FWD', 'RWD',
  '4WD', 'EV', 'PHEV', 'RS', 'SRT', 'TRD', 'M2', 'M3', 'M4', 'M5', 'M8', 'X1',
  'X3', 'X5', 'X7', 'Z4', 'I4', 'IX', 'GT', 'USA', 'UK',
]);

function capWords(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/\b[a-z0-9]+\b/g, (word) => {
      const upper = word.toUpperCase();
      if (UPPER_AUTO_TOKENS.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

// ---------------------------------------------------------------------------
// Persistent Ledger (Supabase Postgres on Vercel, .vin-data/store.json locally)
// ---------------------------------------------------------------------------
function isProductionRuntime() {
  return Boolean(
    process.env.VERCEL === '1' ||
      process.env.VERCEL === 'true' ||
      process.env.VERCEL_ENV === 'production'
  );
}

function isFreePromoEnabledByDefault() {
  if (String(process.env.VIN_ALLOW_FREE_PROMO || '').trim().toLowerCase() === 'true') return true;
  return !isProductionRuntime();
}

const DEFAULT_PROMO_CODES = () => ({
  DRIVEE15: {
    code: 'DRIVEE15',
    discountPct: 15,
    active: true,
    usesCount: 0,
    maxUses: null,
    createdAt: '2026-11-24T00:00:00.000Z',
  },
  DRIVEEFREE: {
    code: 'DRIVEEFREE',
    discountPct: 100,
    active: isFreePromoEnabledByDefault(),
    usesCount: 0,
    maxUses: null,
    createdAt: '2026-11-24T00:00:00.000Z',
  },
});

const DEFAULT_SETTINGS = () => ({
  singlePriceCad: 17,
  pack3PriceCad: 39,
  pack10PriceCad: 99,
  allowLocalSandboxFallback: true,
});

function clampCadPrice(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 999) return fallback;
  return Number(n.toFixed(2));
}

function formatCadShort(amount) {
  const n = Number(amount);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function sanitizeAdminSettings(raw) {
  const def = DEFAULT_SETTINGS();
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    singlePriceCad: clampCadPrice(src.singlePriceCad, def.singlePriceCad),
    pack3PriceCad: clampCadPrice(src.pack3PriceCad, def.pack3PriceCad),
    pack10PriceCad: clampCadPrice(src.pack10PriceCad, def.pack10PriceCad),
    allowLocalSandboxFallback:
      typeof src.allowLocalSandboxFallback === 'boolean'
        ? src.allowLocalSandboxFallback
        : def.allowLocalSandboxFallback,
  };
}

function getEffectiveSettings(store) {
  return sanitizeAdminSettings(store && store.settings);
}

function getEffectivePricingTiers(store) {
  const cfg = getEffectiveSettings(store);
  const priceById = {
    single: cfg.singlePriceCad,
    pack3: cfg.pack3PriceCad,
    pack10: cfg.pack10PriceCad,
  };
  return VIN_PRICING_CAD.map((base) => {
    const priceCad = priceById[base.id] ?? base.priceCad;
    const priceCents = Math.round(priceCad * 100);
    const perReport = (priceCad / Math.max(1, base.credits)).toFixed(2);
    const perReportLabel =
      base.id === 'single'
        ? `$${Number(priceCad).toFixed(2)} CAD · 1 VIN`
        : `$${perReport} CAD / report · never expires`;
    const shortAmt = formatCadShort(priceCad);
    const ctaLabel =
      base.id === 'pack10'
        ? `Get 10-Pack — $${shortAmt} CAD`
        : base.id === 'pack3'
        ? `Get 3-Report Pack — $${shortAmt} CAD`
        : `Get Full Report — $${shortAmt} CAD`;
    return {
      ...base,
      priceCad,
      priceCents,
      perReportLabel,
      ctaLabel,
    };
  });
}

const EMPTY_STORE = () => ({
  inquiries: [],
  orders: [],
  customers: {},
  packCodes: {},
  promoCodes: DEFAULT_PROMO_CODES(),
  settings: DEFAULT_SETTINGS(),
  reportCache: {},
  photoCache: {},
  webhookEvents: {},
});

function defaultLedgerPayload() {
  return {
    orders: [],
    customers: {},
    packCodes: {},
    promoCodes: DEFAULT_PROMO_CODES(),
    settings: DEFAULT_SETTINGS(),
    webhookEvents: {},
  };
}

function normalizeStoreInPlace(target) {
  if (!target || typeof target !== 'object') return EMPTY_STORE();
  if (!Array.isArray(target.inquiries)) target.inquiries = [];
  if (!Array.isArray(target.orders)) target.orders = [];
  if (!target.customers || typeof target.customers !== 'object') target.customers = {};
  if (!target.packCodes || typeof target.packCodes !== 'object') target.packCodes = {};
  if (!target.reportCache || typeof target.reportCache !== 'object') target.reportCache = {};
  if (!target.photoCache || typeof target.photoCache !== 'object') target.photoCache = {};
  if (!target.webhookEvents || typeof target.webhookEvents !== 'object') target.webhookEvents = {};
  const defaults = DEFAULT_PROMO_CODES();
  if (!target.promoCodes || typeof target.promoCodes !== 'object') {
    target.promoCodes = defaults;
  } else {
    target.promoCodes = { ...defaults, ...target.promoCodes };
  }
  target.settings = sanitizeAdminSettings(target.settings);
  return target;
}

function getDefaultCadToUsdRate() {
  const n = Number(process.env.CAD_TO_USD_RATE);
  return Number.isFinite(n) && n > 0.2 && n < 2.0 ? n : 0.72;
}

let memStore = null;
let memStorePath = null;
let memStoreStamp = '';

function getFileStamp(p) {
  try {
    const st = fs.statSync(p);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

function resolveStorePath() {
  const candidates = [];
  if (process.env.VIN_STORE_PATH && String(process.env.VIN_STORE_PATH).trim()) {
    candidates.push(path.resolve(String(process.env.VIN_STORE_PATH).trim()));
  }
  candidates.push(
    path.join(ROOT, '.vin-data', 'store.json'),
    '/tmp/drivee-vin-store.json'
  );
  for (const p of candidates) {
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return p;
    } catch {
      // try next path (Vercel /var/task is read-only; /tmp is writable)
    }
  }
  return null;
}

function getStorageBackendInfo() {
  const sbCfg = supabaseStore.getSupabaseStoreConfig();
  if (sbCfg.enabled) {
    return {
      mode: 'supabase',
      durable: true,
      table: sbCfg.table,
      isVercel: isProductionRuntime(),
    };
  }
  const p = resolveStorePath();
  const isTmp = Boolean(p && p.startsWith('/tmp'));
  return {
    mode: isTmp ? 'ephemeral-tmp' : 'local-file',
    durable: !isTmp && !isProductionRuntime(),
    table: null,
    isVercel: isProductionRuntime(),
  };
}

function getProductionReadiness() {
  const storage = getStorageBackendInfo();
  const hasSigningSecret = Boolean(
    (process.env.VIN_ACCESS_SECRET || '').trim() ||
      (process.env.STRIPE_WEBHOOK_SECRET || '').trim() ||
      (process.env.STRIPE_SECRET_KEY || '').trim()
  );
  const hasAdminCreds = Boolean(
    (process.env.VIN_ADMIN_PASSWORD || '').trim() || (process.env.VIN_ADMIN_KEY || '').trim()
  );
  const hasStripeKey = Boolean((process.env.STRIPE_SECRET_KEY || '').trim());
  const hasWebhookSecret = Boolean((process.env.STRIPE_WEBHOOK_SECRET || '').trim());
  const hasUpstreamKey = Boolean((process.env.AUCTIONS_API_KEY || '').trim());
  return {
    isVercel: storage.isVercel,
    storageBackend: storage.mode,
    storageDurable: storage.durable,
    storageTable: storage.table,
    signingSecretConfigured: hasSigningSecret,
    adminConfigured: hasAdminCreds,
    stripeConfigured: hasStripeKey,
    webhookConfigured: hasWebhookSecret,
    upstreamConfigured: hasUpstreamKey,
    freePromoLockedInProd: !isFreePromoEnabledByDefault(),
  };
}

function readStore() {
  const storePath = resolveStorePath();
  const stamp = storePath ? getFileStamp(storePath) : '';
  if (memStore && memStorePath === storePath && memStoreStamp === stamp) return memStore;
  memStore = null;
  memStorePath = storePath;
  memStoreStamp = stamp;
  if (storePath && fs.existsSync(storePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      memStore = normalizeStoreInPlace({ ...EMPTY_STORE(), ...parsed });
      return memStore;
    } catch {
      // corrupt JSON -> re-initialize cleanly
    }
  }
  memStore = EMPTY_STORE();
  return memStore;
}

function writeStore(store) {
  const storePath = resolveStorePath();
  memStore = store;
  memStorePath = storePath;
  if (!storePath) return;
  try {
    // Keep cache bounded so store.json stays snappy
    if (store.inquiries.length > 500) store.inquiries = store.inquiries.slice(0, 500);
    if (store.orders.length > 500) store.orders = store.orders.slice(0, 500);
    const tmp = `${storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, storePath);
    memStoreStamp = getFileStamp(storePath);
  } catch {
    // non-fatal on ephemeral filesystems
  }
}

async function hydrateStore({ includeInquiries = false, includePhotoCache = false } = {}) {
  if (!supabaseStore.isSupabaseStoreEnabled()) {
    return readStore();
  }
  const bucketsToFetch = ['ledger'];
  if (includeInquiries) bucketsToFetch.push('inquiries');
  if (includePhotoCache) bucketsToFetch.push('photo_cache');
  const map = await supabaseStore.getBuckets(bucketsToFetch);
  const store = normalizeStoreInPlace({ ...(memStore || EMPTY_STORE()) });
  const ledgerRow = map.get('ledger');
  if (ledgerRow && ledgerRow.payload) {
    const lp = ledgerRow.payload;
    store.orders = Array.isArray(lp.orders) ? lp.orders : [];
    store.customers = lp.customers && typeof lp.customers === 'object' ? lp.customers : {};
    store.packCodes = lp.packCodes && typeof lp.packCodes === 'object' ? lp.packCodes : {};
    store.webhookEvents = lp.webhookEvents && typeof lp.webhookEvents === 'object' ? lp.webhookEvents : {};
    store.promoCodes = { ...DEFAULT_PROMO_CODES(), ...(lp.promoCodes && typeof lp.promoCodes === 'object' ? lp.promoCodes : {}) };
    store.settings = sanitizeAdminSettings(lp.settings);
  }
  if (includeInquiries) {
    const inqRow = map.get('inquiries');
    store.inquiries = inqRow && inqRow.payload && Array.isArray(inqRow.payload.inquiries)
      ? inqRow.payload.inquiries
      : [];
  }
  if (includePhotoCache) {
    const photoRow = map.get('photo_cache');
    store.photoCache = photoRow && photoRow.payload && typeof photoRow.payload.photoCache === 'object'
      ? photoRow.payload.photoCache
      : {};
  }
  memStore = store;
  return store;
}

async function mutateLedgerDurable(mutatorFn) {
  if (!supabaseStore.isSupabaseStoreEnabled()) {
    const store = readStore();
    const out = mutatorFn(store);
    if (out && out.__skipWrite === true) return out.value;
    writeStore(store);
    return out;
  }
  let committedLedger = null;
  const result = await supabaseStore.runWithBucketCas(
    'ledger',
    defaultLedgerPayload,
    (ledger) => {
      normalizeStoreInPlace(ledger);
      const out = mutatorFn(ledger);
      if (out && out.__skipWrite === true) {
        committedLedger = ledger;
        return out;
      }
      if (Array.isArray(ledger.orders) && ledger.orders.length > 500) {
        ledger.orders = ledger.orders.slice(0, 500);
      }
      committedLedger = ledger;
      return out;
    }
  );
  if (committedLedger) {
    const base = normalizeStoreInPlace({ ...(memStore || EMPTY_STORE()) });
    base.orders = committedLedger.orders;
    base.customers = committedLedger.customers;
    base.packCodes = committedLedger.packCodes;
    base.promoCodes = committedLedger.promoCodes;
    base.settings = committedLedger.settings;
    base.webhookEvents = committedLedger.webhookEvents;
    memStore = base;
  }
  return result;
}

async function mutateInquiriesDurable(mutatorFn) {
  if (!supabaseStore.isSupabaseStoreEnabled()) {
    const store = readStore();
    const out = mutatorFn(store);
    writeStore(store);
    return out;
  }
  let committedInquiries = null;
  const result = await supabaseStore.runWithBucketCas(
    'inquiries',
    () => ({ inquiries: [] }),
    (bucketPayload) => {
      if (!Array.isArray(bucketPayload.inquiries)) bucketPayload.inquiries = [];
      const out = mutatorFn(bucketPayload);
      if (bucketPayload.inquiries.length > 500) {
        bucketPayload.inquiries = bucketPayload.inquiries.slice(0, 500);
      }
      committedInquiries = bucketPayload.inquiries;
      return out;
    }
  );
  if (committedInquiries && memStore) {
    memStore.inquiries = committedInquiries;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Signing, Admin Auth, Rate Limiting & Hardened Pack Credit / Promo Engine
// ---------------------------------------------------------------------------
function getSigningSecret() {
  const secret =
    (process.env.VIN_ACCESS_SECRET || '').trim() ||
    (process.env.STRIPE_WEBHOOK_SECRET || '').trim() ||
    (process.env.STRIPE_SECRET_KEY || '').trim();
  if (secret) return secret;
  if (isProductionRuntime()) {
    throw new Error('VIN_ACCESS_SECRET is required in Vercel Environment Variables.');
  }
  return 'drivee-vin-local-dev-secret-change-in-vercel';
}

function derivePurposeKey(purpose) {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`drivee-vin:${purpose}:v2`)
    .digest();
}

function timingSafeStrEqual(aStr, bStr) {
  const aHash = crypto.createHash('sha256').update(String(aStr || ''), 'utf8').digest();
  const bHash = crypto.createHash('sha256').update(String(bStr || ''), 'utf8').digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

function hashIp(ip) {
  return crypto
    .createHash('sha256')
    .update(`${ip || 'unknown'}:${getSigningSecret()}`)
    .digest('hex')
    .slice(0, 14);
}

function extractClientIp(req) {
  if (!req) return 'unknown';
  const h = req.headers || {};
  const xff = h['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  const xri = h['x-real-ip'];
  if (xri) return String(xri).trim();
  return (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}

// Sliding-window rate limiter (attached to globalThis so local dev hot-reloads
// preserve active lockout windows; protects pack redemption & admin login).
const rateLimitBuckets =
  globalThis.__driveeVinRateLimits || (globalThis.__driveeVinRateLimits = new Map());

function checkRateLimit(bucketName, keyId, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  const mapKey = `${bucketName}:${keyId || 'anon'}`;
  const now = Date.now();
  const prev = (rateLimitBuckets.get(mapKey) || []).filter((ts) => now - ts < windowMs);
  if (prev.length) rateLimitBuckets.set(mapKey, prev);
  else rateLimitBuckets.delete(mapKey);

  if (prev.length >= maxAttempts) {
    const oldest = prev[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { blocked: true, remaining: 0, retryAfterSec };
  }
  return { blocked: false, remaining: Math.max(0, maxAttempts - prev.length), retryAfterSec: 0 };
}

function recordRateLimitFailure(bucketName, keyId, windowMs = 15 * 60 * 1000) {
  const mapKey = `${bucketName}:${keyId || 'anon'}`;
  const now = Date.now();
  const prev = (rateLimitBuckets.get(mapKey) || []).filter((ts) => now - ts < windowMs);
  prev.push(now);
  rateLimitBuckets.set(mapKey, prev);
  return prev.length;
}

function clearRateLimit(bucketName, keyId) {
  rateLimitBuckets.delete(`${bucketName}:${keyId || 'anon'}`);
}

function resetAllRateLimits() {
  rateLimitBuckets.clear();
}

async function checkRateLimitAsync(bucketName, keyId, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  if (!supabaseStore.isSupabaseStoreEnabled()) {
    return checkRateLimit(bucketName, keyId, maxAttempts, windowMs);
  }
  const bucketKey = `ratelimit:${bucketName}:${keyId || 'anon'}`;
  try {
    const row = await supabaseStore.getBucket(bucketKey, { timeoutMs: 2000 });
    const now = Date.now();
    const rawList = row.exists && row.payload && Array.isArray(row.payload.timestamps) ? row.payload.timestamps : [];
    const recent = rawList.filter((ts) => now - Number(ts) < windowMs);
    if (recent.length >= maxAttempts) {
      const oldest = Number(recent[0]);
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { blocked: true, remaining: 0, retryAfterSec };
    }
    return { blocked: false, remaining: Math.max(0, maxAttempts - recent.length), retryAfterSec: 0 };
  } catch {
    // Fallback to in-memory limiter if transient DB timeout occurs
    return checkRateLimit(bucketName, keyId, maxAttempts, windowMs);
  }
}

async function recordRateLimitFailureAsync(bucketName, keyId, windowMs = 15 * 60 * 1000) {
  const localCount = recordRateLimitFailure(bucketName, keyId, windowMs);
  if (!supabaseStore.isSupabaseStoreEnabled()) return localCount;
  const bucketKey = `ratelimit:${bucketName}:${keyId || 'anon'}`;
  try {
    const row = await supabaseStore.getBucket(bucketKey, { timeoutMs: 2000 });
    const now = Date.now();
    const rawList = row.exists && row.payload && Array.isArray(row.payload.timestamps) ? row.payload.timestamps : [];
    const next = rawList.filter((ts) => now - Number(ts) < windowMs);
    next.push(now);
    await supabaseStore.upsertBucket(bucketKey, { timestamps: next.slice(-20) }, { timeoutMs: 2000 });
    return next.length;
  } catch {
    return localCount;
  }
}

async function clearRateLimitAsync(bucketName, keyId) {
  clearRateLimit(bucketName, keyId);
  if (!supabaseStore.isSupabaseStoreEnabled()) return;
  const bucketKey = `ratelimit:${bucketName}:${keyId || 'anon'}`;
  try {
    await supabaseStore.deleteBucket(bucketKey, { timeoutMs: 2000 });
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Admin Authentication (Timing-Safe Credentials + Signed HttpOnly Cookie)
// ---------------------------------------------------------------------------
const ADMIN_COOKIE_NAME = 'drivee_vin_admin';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const LOCAL_DEV_DEFAULT_USER = 'admin';
const LOCAL_DEV_DEFAULT_PASS = 'drivee-admin';

function isLocalHostRequest(req) {
  const host = String((req && req.headers && req.headers.host) || '').trim();
  return !host || /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
}

function getAdminAuthConfig(req) {
  const configuredUser = (process.env.VIN_ADMIN_USER || '').trim() || LOCAL_DEV_DEFAULT_USER;
  const configuredPass = (process.env.VIN_ADMIN_PASSWORD || '').trim() || (process.env.VIN_ADMIN_KEY || '').trim();
  const configuredKey = (process.env.VIN_ADMIN_KEY || '').trim();
  const isLocal = isLocalHostRequest(req) && !process.env.VERCEL;
  const usingDefaultLocalCreds = !configuredPass && isLocal;
  return {
    username: configuredUser,
    password: configuredPass || (usingDefaultLocalCreds ? LOCAL_DEV_DEFAULT_PASS : ''),
    apiKey: configuredKey || configuredPass || '',
    configured: Boolean(configuredPass || usingDefaultLocalCreds),
    isLocal,
    usingDefaultLocalCreds,
  };
}

function verifyAdminCredentials(username, password, req) {
  const cfg = getAdminAuthConfig(req);
  if (!cfg.configured || !cfg.password) {
    return { ok: false, notConfigured: true, usingDefaultLocalCreds: false };
  }
  const uOk = timingSafeStrEqual(String(username || '').trim().toLowerCase(), cfg.username.toLowerCase());
  const pOk = timingSafeStrEqual(String(password || ''), cfg.password);
  return {
    ok: uOk && pOk,
    username: cfg.username,
    usingDefaultLocalCreds: cfg.usingDefaultLocalCreds,
  };
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function signAdminSessionToken(username) {
  const iat = Date.now();
  const exp = iat + ADMIN_SESSION_TTL_MS;
  const payloadObj = { u: String(username || LOCAL_DEV_DEFAULT_USER), iat, exp };
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', derivePurposeKey('admin-session'))
    .update(payload)
    .digest('base64url');
  return { token: `${payload}.${sig}`, exp };
}

function verifyAdminSessionCookie(cookieHeader) {
  try {
    const cookies = parseCookies(cookieHeader);
    const raw = cookies[ADMIN_COOKIE_NAME];
    if (!raw) return { valid: false };
    const dot = raw.indexOf('.');
    if (dot <= 0) return { valid: false };
    const payload = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expected = crypto
      .createHmac('sha256', derivePurposeKey('admin-session'))
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false };
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || !parsed.u || !parsed.exp || Date.now() > Number(parsed.exp)) {
      return { valid: false };
    }
    return { valid: true, username: String(parsed.u), exp: Number(parsed.exp) };
  } catch {
    return { valid: false };
  }
}

function buildAdminSessionSetCookie(token, req, maxAgeSec = Math.floor(ADMIN_SESSION_TTL_MS / 1000)) {
  const isHttps = Boolean(
    process.env.VERCEL ||
      (req && req.headers && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https')
  );
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Number(maxAgeSec) || 0)}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function verifyAdminRequest(req) {
  const cfg = getAdminAuthConfig(req);
  // 1. Primary: Signed HttpOnly session cookie
  const cookieRes = verifyAdminSessionCookie(req && req.headers && req.headers.cookie);
  if (cookieRes.valid) {
    return {
      authorized: true,
      method: 'cookie',
      username: cookieRes.username,
      expiresAt: new Date(cookieRes.exp).toISOString(),
      usingDefaultLocalCreds: cfg.usingDefaultLocalCreds,
    };
  }
  // 2. Secondary: Explicit x-admin-key header (for API / automation when VIN_ADMIN_KEY/PASSWORD is set)
  const headerKey = String((req && req.headers && req.headers['x-admin-key']) || '').trim();
  if (headerKey && cfg.apiKey && timingSafeStrEqual(headerKey, cfg.apiKey)) {
    return {
      authorized: true,
      method: 'api-key',
      username: cfg.username,
      expiresAt: null,
      usingDefaultLocalCreds: cfg.usingDefaultLocalCreds,
    };
  }
  return {
    authorized: false,
    configured: cfg.configured,
    isLocal: cfg.isLocal,
    usingDefaultLocalCreds: cfg.usingDefaultLocalCreds,
  };
}

function signReportAccessToken(vin, refId) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  const cleanRef = String(refId || 'direct').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'direct';
  const payload = `${cleanVin}.${cleanRef}`;
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url')
    .slice(0, 24);
  return Buffer.from(`${payload}.${sig}`, 'utf8').toString('base64url');
}

function verifyReportAccessToken(vin, token) {
  if (!token) return false;
  try {
    const cleanVin = String(vin || '').toUpperCase().trim();
    const decoded = Buffer.from(String(token), 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return false;
    const [tokVin, refId, sig] = parts;
    if (tokVin !== cleanVin) return false;
    const expected = crypto
      .createHmac('sha256', getSigningSecret())
      .update(`${tokVin}.${refId}`)
      .digest('base64url')
      .slice(0, 24);
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cryptographically Hardened Pack Credit Codes (v2)
//   - 120-bit CSPRNG nonce (15 bytes -> 24 Crockford Base32 chars)
//   - 40-bit keyed HMAC-SHA256 tag (5 bytes -> 8 Crockford Base32 chars)
//   - Total: 160 bits -> DRV3-XXXXXX-XXXXXX-XXXXXX-XXXXXX-MMMMMMMM
//   - Stored ONLY as keyed HMAC-SHA256 hash + masked preview in packCodes
//   - Order receipt copy encrypted at rest with AES-256-GCM for Stripe redirect
// ---------------------------------------------------------------------------
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCrockfordBase32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function computePackMacTag(prefix, nonceChars) {
  const macBuf = crypto
    .createHmac('sha256', derivePurposeKey('pack-code-mac'))
    .update(`${prefix}:${nonceChars}`)
    .digest();
  // 5 bytes = 40 bits = exactly 8 Crockford Base32 characters
  return encodeCrockfordBase32(macBuf.subarray(0, 5));
}

function hashPackCodeForStorage(canonicalCode) {
  return crypto
    .createHmac('sha256', derivePurposeKey('pack-code-hash'))
    .update(String(canonicalCode || '').toUpperCase().trim())
    .digest('hex');
}

function maskPackCode(code) {
  const clean = String(code || '').toUpperCase().trim();
  if (!clean) return null;
  const parts = clean.split('-');
  if (parts.length >= 6) {
    return `${parts[0]}-${parts[1].slice(0, 4)}-••••-••••-${parts[parts.length - 1].slice(-4)}`;
  }
  if (parts.length >= 3) {
    return `${parts[0]}-••••-${parts[parts.length - 1]}`;
  }
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

function encryptPackCodeForOrder(plainCode) {
  if (!plainCode) return null;
  const key = derivePurposeKey('pack-code-aes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plainCode), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

function decryptPackCodeForOrder(encBlob) {
  if (!encBlob) return null;
  try {
    const parts = String(encBlob).split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ct = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivePurposeKey('pack-code-aes'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function normalizePackCodeInput(raw) {
  const upper = String(raw || '').trim().toUpperCase();
  if (!upper) return { canonical: '', version: 0 };

  // Check v2 hardened format (forgiving of spaces/missing hyphens and Crockford O/I/L typos)
  const compact = upper.replace(/[\s-]+/g, '');
  const m = compact.match(/^(DRV10|DRV3|DRV1)([0-9A-Z]{32})$/);
  if (m) {
    const prefix = m[1];
    const body = m[2].replace(/O/g, '0').replace(/[IL]/g, '1');
    if (/^[0-9A-HJKMNP-TV-Z]{32}$/.test(body)) {
      const nonce = body.slice(0, 24);
      const tag = body.slice(24, 32);
      const canonical = `${prefix}-${nonce.slice(0, 6)}-${nonce.slice(6, 12)}-${nonce.slice(12, 18)}-${nonce.slice(18, 24)}-${tag}`;
      return { canonical, prefix, nonce, tag, version: 2 };
    }
  }

  // Legacy v1 format compatibility (for pre-existing local test codes only)
  if (/^(DRV10|DRV3|DRV1)-[A-F0-9]{4}-[A-F0-9]{4}$/.test(upper)) {
    return { canonical: upper, prefix: upper.split('-')[0], version: 1 };
  }

  return { canonical: upper, version: 0 };
}

function verifyPackCodeFormatAndMac(codeRaw) {
  const parsed = normalizePackCodeInput(codeRaw);
  if (parsed.version === 2) {
    const expectedTag = computePackMacTag(parsed.prefix, parsed.nonce);
    const a = Buffer.from(parsed.tag, 'utf8');
    const b = Buffer.from(expectedTag, 'utf8');
    const macValid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid: macValid, version: 2, canonical: parsed.canonical, prefix: parsed.prefix };
  }
  if (parsed.version === 1) {
    return { valid: true, version: 1, canonical: parsed.canonical, prefix: parsed.prefix };
  }
  return { valid: false, version: 0, canonical: parsed.canonical };
}

function generatePackCodeString(tierId) {
  const prefix = tierId === 'pack10' ? 'DRV10' : tierId === 'pack3' ? 'DRV3' : 'DRV1';
  // 15 random bytes = 120 bits CSPRNG = exactly 24 Crockford Base32 chars
  const nonce = encodeCrockfordBase32(crypto.randomBytes(15));
  // 40-bit keyed HMAC-SHA256 authentication tag = 8 Crockford Base32 chars
  const tag = computePackMacTag(prefix, nonce);
  return `${prefix}-${nonce.slice(0, 6)}-${nonce.slice(6, 12)}-${nonce.slice(12, 18)}-${nonce.slice(18, 24)}-${tag}`;
}

function _issuePackInStore(store, { tierId, totalCredits, remainingCredits, customerEmail, orderNumber, notes }) {
  const code = generatePackCodeString(tierId);
  const codeHash = hashPackCodeForStorage(code);
  const codeMasked = maskPackCode(code);
  const record = {
    codeHash,
    codeMasked,
    securityVersion: 2,
    entropyBits: 120,
    macBits: 40,
    tierId: tierId || 'pack3',
    totalCredits: Number(totalCredits || 3),
    remainingCredits: Number(remainingCredits ?? totalCredits ?? 3),
    customerEmail: customerEmail || null,
    orderNumber: orderNumber || null,
    notes: notes || null,
    revoked: false,
    createdAt: new Date().toISOString(),
    redemptions: [],
  };
  // Never store plaintext v2 pack code on disk/DB in packCodes ledger
  store.packCodes = store.packCodes || {};
  store.packCodes[codeHash] = record;
  // Return plaintext code ONCE to the immediate caller (checkout/email/admin modal)
  return { ...record, code };
}

function issuePackCreditCode(opts) {
  const store = readStore();
  const issued = _issuePackInStore(store, opts || {});
  writeStore(store);
  return issued;
}

async function issuePackCreditCodeAsync(opts) {
  return mutateLedgerDurable((store) => _issuePackInStore(store, opts || {}));
}

function _revokePackInStore(store, codeHash) {
  const key = String(codeHash || '').trim();
  if (!key) throw new Error('Pack code identifier required.');
  const rec = (store.packCodes || {})[key];
  if (!rec) throw new Error('Pack code not found.');
  rec.revoked = true;
  rec.revokedAt = new Date().toISOString();
  return rec;
}

function revokePackCreditCode(codeHash) {
  const store = readStore();
  const rec = _revokePackInStore(store, codeHash);
  writeStore(store);
  return rec;
}

async function revokePackCreditCodeAsync(codeHash) {
  return mutateLedgerDurable((store) => _revokePackInStore(store, codeHash));
}

function _adjustPackInStore(store, codeHash, delta) {
  const key = String(codeHash || '').trim();
  const d = Math.round(Number(delta) || 0);
  if (!key || !d) throw new Error('Pack code identifier and non-zero credit delta required.');
  const rec = (store.packCodes || {})[key];
  if (!rec) throw new Error('Pack code not found.');
  rec.remainingCredits = Math.max(0, Number(rec.remainingCredits || 0) + d);
  if (rec.remainingCredits > Number(rec.totalCredits || 0)) {
    rec.totalCredits = rec.remainingCredits;
  }
  rec.updatedAt = new Date().toISOString();
  return rec;
}

function adjustPackCredits(codeHash, delta) {
  const store = readStore();
  const rec = _adjustPackInStore(store, codeHash, delta);
  writeStore(store);
  return rec;
}

async function adjustPackCreditsAsync(codeHash, delta) {
  return mutateLedgerDurable((store) => _adjustPackInStore(store, codeHash, delta));
}

function findPackRecordByPlaintext(store, codeRaw) {
  const check = verifyPackCodeFormatAndMac(codeRaw);
  if (!check.valid) return { check, rec: null };
  let rec = null;
  if (check.version === 2) {
    rec = (store.packCodes || {})[hashPackCodeForStorage(check.canonical)] || null;
  } else if (check.version === 1) {
    rec = (store.packCodes || {})[check.canonical] || null;
  }
  return { check, rec };
}

function _checkPackStatusInStore(store, codeRaw) {
  const raw = String(codeRaw || '').trim();
  if (!raw) return { ok: false, error: 'Pack code required.' };
  const { check, rec } = findPackRecordByPlaintext(store, raw);
  if (!check.valid || !rec || rec.revoked) {
    return { ok: false, error: 'Invalid or revoked pack code.' };
  }
  return {
    ok: true,
    valid: true,
    tierId: rec.tierId || 'pack3',
    codeMasked: rec.codeMasked || maskPackCode(check.canonical),
    remainingCredits: Number(rec.remainingCredits || 0),
    totalCredits: Number(rec.totalCredits || 0),
    securityVersion: rec.securityVersion || check.version,
  };
}

function checkPackCreditStatus(codeRaw) {
  return _checkPackStatusInStore(readStore(), codeRaw);
}

async function checkPackCreditStatusAsync(codeRaw) {
  const store = await hydrateStore();
  return _checkPackStatusInStore(store, codeRaw);
}

function _inspectPackInStore(store, codeRaw) {
  const raw = String(codeRaw || '').trim();
  if (!raw) throw new Error('Enter a pack code to inspect.');
  const { check, rec } = findPackRecordByPlaintext(store, raw);
  if (!check.valid) {
    return {
      found: false,
      macValid: false,
      securityVersion: check.version,
      reason: 'Cryptographic HMAC tag or format check failed (forged or mistyped key).',
    };
  }
  if (!rec) {
    return {
      found: false,
      macValid: true,
      securityVersion: check.version,
      reason: 'Format/MAC valid, but no matching ledger record exists in this store.',
    };
  }
  return {
    found: true,
    macValid: true,
    securityVersion: rec.securityVersion || check.version,
    codeHash: rec.codeHash || null,
    codeMasked: rec.codeMasked || maskPackCode(check.canonical),
    tierId: rec.tierId,
    remainingCredits: Number(rec.remainingCredits || 0),
    totalCredits: Number(rec.totalCredits || 0),
    revoked: Boolean(rec.revoked),
    revokedAt: rec.revokedAt || null,
    customerEmail: rec.customerEmail || null,
    orderNumber: rec.orderNumber || null,
    createdAt: rec.createdAt,
    redemptions: Array.isArray(rec.redemptions) ? rec.redemptions : [],
  };
}

function inspectPackCreditCode(codeRaw) {
  return _inspectPackInStore(readStore(), codeRaw);
}

async function inspectPackCreditCodeAsync(codeRaw) {
  const store = await hydrateStore();
  return _inspectPackInStore(store, codeRaw);
}

function _redeemPackInStore(store, codeRaw, vin, vehicleTitle) {
  const raw = String(codeRaw || '').trim();
  if (!raw) return { mutated: false, result: { ok: false, error: 'Enter your 3-Pack or 10-Pack code.' } };

  const { check, rec } = findPackRecordByPlaintext(store, raw);
  if (!check.valid) {
    return {
      mutated: false,
      result: {
        ok: false,
        invalidMac: true,
        error: 'Invalid or exhausted pack code. Double-check your code or contact drivee.canada@gmail.com.',
      },
    };
  }

  if (!rec || rec.revoked) {
    return {
      mutated: false,
      result: {
        ok: false,
        error: 'Invalid or exhausted pack code. Double-check your code or contact drivee.canada@gmail.com.',
      },
    };
  }

  const cleanVin = String(vin || '').toUpperCase().trim();
  const tokenRef = rec.codeHash ? rec.codeHash.slice(0, 24) : check.canonical;
  const already = (rec.redemptions || []).find((r) => r.vin === cleanVin);
  if (already) {
    return {
      mutated: false,
      result: {
        ok: true,
        reusedSameVin: true,
        code: rec.codeMasked || check.canonical,
        tierId: rec.tierId || 'pack3',
        remainingCredits: rec.remainingCredits,
        totalCredits: rec.totalCredits,
        accessToken: signReportAccessToken(cleanVin, tokenRef),
      },
    };
  }
  if (rec.remainingCredits <= 0) {
    return {
      mutated: false,
      result: {
        ok: false,
        error: 'Invalid or exhausted pack code. Double-check your code or contact drivee.canada@gmail.com.',
      },
    };
  }
  rec.remainingCredits -= 1;
  rec.redemptions = rec.redemptions || [];
  rec.redemptions.push({
    vin: cleanVin,
    vehicleTitle: vehicleTitle || `VIN ${cleanVin}`,
    redeemedAt: new Date().toISOString(),
  });
  return {
    mutated: true,
    result: {
      ok: true,
      reusedSameVin: false,
      code: rec.codeMasked || check.canonical,
      tierId: rec.tierId || 'pack3',
      remainingCredits: rec.remainingCredits,
      totalCredits: rec.totalCredits,
      accessToken: signReportAccessToken(cleanVin, tokenRef),
    },
  };
}

function redeemPackCreditCode(codeRaw, vin, vehicleTitle) {
  const store = readStore();
  const { mutated, result } = _redeemPackInStore(store, codeRaw, vin, vehicleTitle);
  if (mutated) writeStore(store);
  return result;
}

async function redeemPackCreditCodeAsync(codeRaw, vin, vehicleTitle) {
  return mutateLedgerDurable((store) => {
    const { mutated, result } = _redeemPackInStore(store, codeRaw, vin, vehicleTitle);
    if (!mutated) return { __skipWrite: true, value: result };
    return result;
  });
}

function _evaluatePromoInStore(store, codeRaw) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return null;
  const p = (store.promoCodes || {})[code];
  if (!p || !p.active || p.deleted) return null;
  // Lock down built-in 100% DRIVEEFREE code on Vercel production unless explicitly allowed or restored by an admin
  if (
    code === 'DRIVEEFREE' &&
    isProductionRuntime() &&
    String(process.env.VIN_ALLOW_FREE_PROMO || '').trim().toLowerCase() !== 'true' &&
    !p.explicitlyRestored
  ) {
    return null;
  }
  if (p.maxUses != null && p.usesCount >= p.maxUses) return null;
  return p;
}

function evaluatePromoCode(codeRaw) {
  return _evaluatePromoInStore(readStore(), codeRaw);
}

async function evaluatePromoCodeAsync(codeRaw) {
  const store = await hydrateStore();
  return _evaluatePromoInStore(store, codeRaw);
}

function _createPromoInStore(store, { code, discountPct, maxUses }) {
  const clean = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!clean || clean.length < 3) throw new Error('Promo code must be at least 3 alphanumeric characters.');
  const pct = Math.max(1, Math.min(100, Math.round(Number(discountPct) || 15)));
  store.promoCodes = store.promoCodes || {};
  const prevUses = store.promoCodes[clean] ? Number(store.promoCodes[clean].usesCount || 0) : 0;
  store.promoCodes[clean] = {
    code: clean,
    discountPct: pct,
    active: true,
    deleted: false,
    revokedAt: null,
    explicitlyRestored: clean === 'DRIVEEFREE' ? true : undefined,
    usesCount: prevUses,
    maxUses: maxUses ? Math.max(1, Math.round(Number(maxUses))) : null,
    createdAt: new Date().toISOString(),
  };
  return store.promoCodes[clean];
}

function createPromoCode(opts) {
  const store = readStore();
  const created = _createPromoInStore(store, opts || {});
  writeStore(store);
  return created;
}

async function createPromoCodeAsync(opts) {
  return mutateLedgerDurable((store) => _createPromoInStore(store, opts || {}));
}

function _setPromoActiveInStore(store, codeRaw, active) {
  const clean = String(codeRaw || '').trim().toUpperCase();
  if (!clean) throw new Error('Promo code is required.');
  const p = (store.promoCodes || {})[clean];
  if (!p || p.deleted) throw new Error(`Promo code "${clean}" not found.`);
  p.active = Boolean(active);
  p.revokedAt = p.active ? null : new Date().toISOString();
  if (clean === 'DRIVEEFREE') {
    p.explicitlyRestored = Boolean(active);
  }
  return p;
}

function setPromoCodeActive(codeRaw, active) {
  const store = readStore();
  const p = _setPromoActiveInStore(store, codeRaw, active);
  writeStore(store);
  return p;
}

async function setPromoCodeActiveAsync(codeRaw, active) {
  return mutateLedgerDurable((store) => _setPromoActiveInStore(store, codeRaw, active));
}

function _deletePromoInStore(store, codeRaw) {
  const clean = String(codeRaw || '').trim().toUpperCase();
  if (!clean) throw new Error('Promo code is required.');
  const p = (store.promoCodes || {})[clean];
  if (!p) throw new Error(`Promo code "${clean}" not found.`);
  // Soft-delete built-ins so readStore default merge never resurrects them
  if (clean === 'DRIVEE15' || clean === 'DRIVEEFREE') {
    p.active = false;
    p.deleted = true;
    p.explicitlyRestored = false;
    p.revokedAt = new Date().toISOString();
  } else {
    delete store.promoCodes[clean];
  }
  return { code: clean, deleted: true };
}

function deletePromoCode(codeRaw) {
  const store = readStore();
  const out = _deletePromoInStore(store, codeRaw);
  writeStore(store);
  return out;
}

async function deletePromoCodeAsync(codeRaw) {
  return mutateLedgerDurable((store) => _deletePromoInStore(store, codeRaw));
}

// ---------------------------------------------------------------------------
// Inquiries, Orders, Refunds, Webhook Deduplication & Report Cache Ledger
// ---------------------------------------------------------------------------
function _recordInquiryInStore(store, { vin, vehicleTitle, provinceHint, recordsFound, ip }) {
  const entry = {
    id: `inq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    vin: vin || null,
    vehicleTitle: vehicleTitle || null,
    provinceHint: provinceHint || 'ON',
    recordsFound: Number(recordsFound || 0),
    ipHash: hashIp(ip),
  };
  store.inquiries = Array.isArray(store.inquiries) ? store.inquiries : [];
  store.inquiries.unshift(entry);
  return entry;
}

function recordVinInquiry(opts) {
  const store = readStore();
  const entry = _recordInquiryInStore(store, opts || {});
  writeStore(store);
  return entry;
}

async function recordVinInquiryAsync(opts) {
  return mutateInquiriesDurable((bucket) => _recordInquiryInStore(bucket, opts || {}));
}

function _recordOrderInStore(store, {
  sessionId,
  paymentIntent,
  vin,
  vehicleTitle,
  tierId,
  amountCad,
  upstreamCostCad = 0,
  customerEmail,
  customerName,
  promoCode,
  packCode,
  creditsTotal,
  status = 'paid',
  livemode = false,
  source = 'stripe',
  createdAt,
}) {
  store.orders = Array.isArray(store.orders) ? store.orders : [];
  // Deduplicate by Stripe sessionId when already recorded
  if (sessionId) {
    const existing = store.orders.find((o) => o.sessionId === sessionId);
    if (existing) {
      const plainPack = decryptPackCodeForOrder(existing.packCodeEnc) || existing.packCode || null;
      let remainingCredits = null;
      if (plainPack) {
        const { rec } = findPackRecordByPlaintext(store, plainPack);
        if (rec) remainingCredits = Number(rec.remainingCredits || 0);
      }
      return {
        mutated: false,
        order: {
          ...existing,
          packCode: plainPack,
          remainingCredits,
        },
      };
    }
  }
  const effectiveTiers = getEffectivePricingTiers(store);
  const tierKey = String(tierId || '').trim().toLowerCase() === 'basic'
    ? 'single'
    : String(tierId || 'single').trim().toLowerCase();
  const tier = effectiveTiers.find((t) => t.id === tierKey) || effectiveTiers[0] || getVinTier(tierId);
  const cleanVin = String(vin || '').toUpperCase().trim();
  const rev = Number(amountCad ?? tier.priceCad);
  const cost = Number(upstreamCostCad || 0);
  const createdIso = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();
  const orderNumber = `DRV-${createdIso.slice(2, 10).replace(/-/g, '')}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

  // Automatically issue hardened pack credit code for 3-pack / 10-pack inside the SAME atomic store mutation
  let issuedPack = null;
  const totalCredits = Number(creditsTotal || tier.credits || 1);
  if (totalCredits > 1 && !packCode) {
    const initialRemaining = cleanVin ? totalCredits - 1 : totalCredits;
    issuedPack = _issuePackInStore(store, {
      tierId: tier.id,
      totalCredits,
      remainingCredits: initialRemaining,
      customerEmail,
      orderNumber,
      notes: cleanVin ? `Initial credit applied to ${cleanVin}` : 'Issued on pack purchase',
    });
    if (cleanVin) {
      const storedPack = store.packCodes[issuedPack.codeHash];
      if (storedPack) {
        storedPack.redemptions.push({
          vin: cleanVin,
          vehicleTitle: vehicleTitle || `VIN ${cleanVin}`,
          redeemedAt: createdIso,
        });
      }
    }
  }

  const plainPackCode = packCode || (issuedPack ? issuedPack.code : null);
  const cleanPromoCode = promoCode ? String(promoCode).trim().toUpperCase() : null;
  const storedOrder = {
    orderNumber,
    createdAt: createdIso,
    sessionId: sessionId || null,
    paymentIntent: paymentIntent || null,
    vin: cleanVin || null,
    vehicleTitle: vehicleTitle || (cleanVin ? `VIN ${cleanVin}` : 'Pack Credit Purchase'),
    tierId: tier.id,
    tierName: tier.name,
    creditsTotal: totalCredits,
    packCodeMasked: plainPackCode ? maskPackCode(plainPackCode) : null,
    packCodeEnc: plainPackCode ? encryptPackCodeForOrder(plainPackCode) : null,
    customerEmail: customerEmail || '',
    customerName: customerName || '',
    promoCode: cleanPromoCode,
    amountCad: Number(rev.toFixed(2)),
    upstreamCostCad: Number(cost.toFixed(2)),
    netProfitCad: Number((rev - cost).toFixed(2)),
    status,
    livemode: Boolean(livemode),
    source,
    accessToken: cleanVin ? signReportAccessToken(cleanVin, sessionId || orderNumber) : null,
  };

  store.orders.unshift(storedOrder);
  if (cleanPromoCode && store.promoCodes && store.promoCodes[cleanPromoCode]) {
    store.promoCodes[cleanPromoCode].usesCount += 1;
  }

  // Persist/update customer email CRM record on purchase
  const normEmail = String(customerEmail || '').trim().toLowerCase();
  if (normEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
    store.customers = store.customers || {};
    const prev = store.customers[normEmail] || {
      email: normEmail,
      name: '',
      firstPurchaseAt: createdIso,
      lastPurchaseAt: createdIso,
      ordersCount: 0,
      totalSpentCad: 0,
      totalCreditsPurchased: 0,
      vins: [],
    };
    if (customerName && !prev.name) prev.name = String(customerName).trim();
    prev.lastPurchaseAt = createdIso;
    prev.ordersCount = Number(prev.ordersCount || 0) + 1;
    prev.totalSpentCad = Number((Number(prev.totalSpentCad || 0) + Number(rev || 0)).toFixed(2));
    prev.totalCreditsPurchased = Number(prev.totalCreditsPurchased || 0) + totalCredits;
    if (cleanVin && !prev.vins.includes(cleanVin)) {
      prev.vins.unshift(cleanVin);
      if (prev.vins.length > 25) prev.vins = prev.vins.slice(0, 25);
    }
    store.customers[normEmail] = prev;
  }

  return {
    mutated: true,
    order: {
      ...storedOrder,
      packCode: plainPackCode,
      remainingCredits: issuedPack ? issuedPack.remainingCredits : null,
    },
  };
}

function recordVinOrder(opts) {
  const store = readStore();
  const { mutated, order } = _recordOrderInStore(store, opts || {});
  if (mutated) writeStore(store);
  return order;
}

async function recordVinOrderAsync(opts) {
  return mutateLedgerDurable((store) => {
    const { mutated, order } = _recordOrderInStore(store, opts || {});
    if (!mutated) return { __skipWrite: true, value: order };
    return order;
  });
}

function _findOrderBySessionIdInStore(store, sessionId) {
  if (!sessionId) return null;
  const found = (store.orders || []).find((o) => o.sessionId === sessionId);
  if (!found) return null;
  const plainPack = decryptPackCodeForOrder(found.packCodeEnc) || found.packCode || null;
  let remainingCredits = null;
  let totalCredits = Number(found.creditsTotal || 1);
  if (plainPack) {
    const { rec } = findPackRecordByPlaintext(store, plainPack);
    if (rec) {
      remainingCredits = Number(rec.remainingCredits || 0);
      totalCredits = Number(rec.totalCredits || totalCredits);
    }
  }
  return {
    ...found,
    packCode: plainPack,
    remainingCredits,
    totalCredits,
  };
}

function findOrderBySessionId(sessionId) {
  return _findOrderBySessionIdInStore(readStore(), sessionId);
}

async function findOrderBySessionIdAsync(sessionId) {
  const store = await hydrateStore();
  return _findOrderBySessionIdInStore(store, sessionId);
}

function _markOrderRefundedInStore(store, orderNumber, revokeLinkedPack = true) {
  const num = String(orderNumber || '').trim();
  if (!num) throw new Error('Order number is required.');
  const order = (store.orders || []).find((o) => o.orderNumber === num);
  if (!order) throw new Error(`Order "${num}" not found.`);
  order.status = 'refunded';
  order.refundedAt = new Date().toISOString();
  let revokedPackMasked = null;
  if (revokeLinkedPack) {
    for (const p of Object.values(store.packCodes || {})) {
      if (p.orderNumber === num && !p.revoked) {
        p.revoked = true;
        p.revokedAt = order.refundedAt;
        revokedPackMasked = p.codeMasked || null;
      }
    }
  }
  return { orderNumber: order.orderNumber, status: order.status, refundedAt: order.refundedAt, revokedPackMasked };
}

function markOrderRefunded(orderNumber, revokeLinkedPack = true) {
  const store = readStore();
  const out = _markOrderRefundedInStore(store, orderNumber, revokeLinkedPack);
  writeStore(store);
  return out;
}

async function markOrderRefundedAsync(orderNumber, revokeLinkedPack = true) {
  return mutateLedgerDurable((store) => _markOrderRefundedInStore(store, orderNumber, revokeLinkedPack));
}

function _markOrderRefundedByPaymentIntentInStore(store, paymentIntent, revokeLinkedPack = true) {
  const pi = String(paymentIntent || '').trim();
  if (!pi) return { mutated: false, result: { matched: false } };
  const order = (store.orders || []).find((o) => o.paymentIntent && o.paymentIntent === pi);
  if (!order) return { mutated: false, result: { matched: false } };
  order.status = 'refunded';
  order.refundedAt = new Date().toISOString();
  let revokedPackMasked = null;
  if (revokeLinkedPack) {
    for (const p of Object.values(store.packCodes || {})) {
      if (p.orderNumber === order.orderNumber && !p.revoked) {
        p.revoked = true;
        p.revokedAt = order.refundedAt;
        revokedPackMasked = p.codeMasked || null;
      }
    }
  }
  return {
    mutated: true,
    result: {
      matched: true,
      orderNumber: order.orderNumber,
      status: order.status,
      refundedAt: order.refundedAt,
      revokedPackMasked,
    },
  };
}

function markOrderRefundedByPaymentIntent(paymentIntent, revokeLinkedPack = true) {
  const store = readStore();
  const { mutated, result } = _markOrderRefundedByPaymentIntentInStore(store, paymentIntent, revokeLinkedPack);
  if (mutated) writeStore(store);
  return result;
}

async function markOrderRefundedByPaymentIntentAsync(paymentIntent, revokeLinkedPack = true) {
  return mutateLedgerDurable((store) => {
    const { mutated, result } = _markOrderRefundedByPaymentIntentInStore(store, paymentIntent, revokeLinkedPack);
    if (!mutated) return { __skipWrite: true, value: result };
    return result;
  });
}

async function claimWebhookEventAsync(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return { duplicate: false };
  return mutateLedgerDurable((store) => {
    store.webhookEvents = store.webhookEvents && typeof store.webhookEvents === 'object' ? store.webhookEvents : {};
    if (store.webhookEvents[id]) {
      return { __skipWrite: true, value: { duplicate: true } };
    }
    store.webhookEvents[id] = Date.now();
    // Bound webhook event dedupe table to most recent 1000 events
    const keys = Object.keys(store.webhookEvents);
    if (keys.length > 1000) {
      keys
        .sort((a, b) => Number(store.webhookEvents[a] || 0) - Number(store.webhookEvents[b] || 0))
        .slice(0, keys.length - 1000)
        .forEach((k) => { delete store.webhookEvents[k]; });
    }
    return { duplicate: false };
  });
}

async function releaseWebhookEventAsync(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return;
  try {
    await mutateLedgerDurable((store) => {
      if (!store.webhookEvents || !store.webhookEvents[id]) {
        return { __skipWrite: true, value: false };
      }
      delete store.webhookEvents[id];
      return true;
    });
  } catch {
    // non-fatal cleanup
  }
}

// ---------------------------------------------------------------------------
// Report build lock + one-time "report ready" email claim
//   Only one process (Stripe webhook kick-off, buyer page, reload, second tab)
//   may run the paid upstream build for a VIN at a time; the others answer
//   "pending" and the page polls until the cached report exists.
// ---------------------------------------------------------------------------
const REPORT_BUILD_LOCK_MS = 5 * 60 * 1000;

async function claimReportBuildAsync(vin) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  if (!cleanVin) return false;
  return mutateLedgerDurable((store) => {
    const builds = store.reportBuilds && typeof store.reportBuilds === 'object' ? store.reportBuilds : {};
    const now = Date.now();
    for (const k of Object.keys(builds)) {
      if (now - Number(builds[k] || 0) > REPORT_BUILD_LOCK_MS) delete builds[k];
    }
    store.reportBuilds = builds;
    if (builds[cleanVin]) return { __skipWrite: true, value: false };
    builds[cleanVin] = now;
    return true;
  });
}

async function releaseReportBuildAsync(vin) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  try {
    await mutateLedgerDurable((store) => {
      if (!store.reportBuilds || !store.reportBuilds[cleanVin]) return { __skipWrite: true, value: false };
      delete store.reportBuilds[cleanVin];
      return true;
    });
  } catch {
    // lock expires on its own after REPORT_BUILD_LOCK_MS
  }
}

// Marks a paid order's "report ready" email as sent and returns what the email
// needs, or null if there is no matching paid order or it was already sent.
async function claimReportReadyEmailAsync({ vin, sessionId, accessToken }) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  if (!cleanVin || (!sessionId && !accessToken)) return null;
  return mutateLedgerDurable((store) => {
    const o = (store.orders || []).find((x) =>
      x.vin === cleanVin &&
      ((sessionId && x.sessionId === sessionId) || (accessToken && x.accessToken === accessToken))
    );
    if (!o || o.status !== 'paid' || !o.customerEmail || o.readyEmailSentAt) {
      return { __skipWrite: true, value: null };
    }
    o.readyEmailSentAt = new Date().toISOString();
    return {
      orderNumber: o.orderNumber,
      email: o.customerEmail,
      name: o.customerName || '',
      vin: o.vin,
      vehicleTitle: o.vehicleTitle || '',
      accessToken: o.accessToken,
    };
  });
}

async function releaseReportReadyEmailAsync(orderNumber) {
  try {
    await mutateLedgerDurable((store) => {
      const o = (store.orders || []).find((x) => x.orderNumber === orderNumber);
      if (!o || !o.readyEmailSentAt) return { __skipWrite: true, value: false };
      delete o.readyEmailSentAt;
      return true;
    });
  } catch {
    // non-fatal
  }
}

function getCachedReport(vin) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  const store = readStore();
  return (store.reportCache || {})[cleanVin] || null;
}

async function getCachedReportAsync(vin) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  if (!cleanVin) return null;
  const local = getCachedReport(cleanVin);
  if (local) return local;
  if (!supabaseStore.isSupabaseStoreEnabled()) return null;
  try {
    const row = await supabaseStore.getBucket(`report:${cleanVin}`);
    if (row.exists && row.payload && row.payload.report) {
      const store = readStore();
      store.reportCache[cleanVin] = row.payload;
      return row.payload;
    }
  } catch {
    // non-fatal cache miss
  }
  return null;
}

function saveCachedReport(vin, report) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  if (!cleanVin || !report) return;
  const store = readStore();
  store.reportCache[cleanVin] = {
    savedAt: new Date().toISOString(),
    report,
  };
  writeStore(store);
}

async function saveCachedReportAsync(vin, report) {
  const cleanVin = String(vin || '').toUpperCase().trim();
  if (!cleanVin || !report) return;
  const entry = {
    savedAt: new Date().toISOString(),
    report,
  };
  const store = readStore();
  store.reportCache[cleanVin] = entry;
  if (!supabaseStore.isSupabaseStoreEnabled()) {
    writeStore(store);
    return;
  }
  try {
    await supabaseStore.upsertBucket(`report:${cleanVin}`, entry);
  } catch {
    // non-fatal: also keep local /tmp L1 cache
    writeStore(store);
  }
}

// ---------------------------------------------------------------------------
// Time-Series Analytics (Daily 30d, Weekly 12w, GitHub-Style 26w Heatmap)
// ---------------------------------------------------------------------------
function toUtcDateKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addUtcDays(dateObj, deltaDays) {
  const d = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function computeHeatLevel(value, maxVal) {
  if (!value || value <= 0) return 0;
  if (maxVal <= 1) return 4;
  const ratio = value / maxVal;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.78) return 3;
  return 4;
}

function buildVinAnalytics(paidOrders, inquiries) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const dayMap = new Map();
  const ensureDay = (key) => {
    let row = dayMap.get(key);
    if (!row) {
      row = { buys: 0, inquiries: 0, revenueCad: 0, profitCad: 0, single: 0, pack3: 0, pack10: 0 };
      dayMap.set(key, row);
    }
    return row;
  };

  for (const o of paidOrders) {
    const key = toUtcDateKey(o.createdAt);
    if (!key) continue;
    const row = ensureDay(key);
    row.buys += 1;
    row.revenueCad += Number(o.amountCad || 0);
    row.profitCad += Number(o.netProfitCad || 0);
    if (o.tierId === 'pack10') row.pack10 += 1;
    else if (o.tierId === 'pack3') row.pack3 += 1;
    else row.single += 1;
  }

  for (const inq of inquiries) {
    const key = toUtcDateKey(inq.createdAt);
    if (!key) continue;
    ensureDay(key).inquiries += 1;
  }

  // 1. Daily series (last 30 days, oldest -> today)
  const dailySeries = [];
  for (let i = 29; i >= 0; i--) {
    const d = addUtcDays(todayUtc, -i);
    const key = toUtcDateKey(d);
    const row = dayMap.get(key) || { buys: 0, inquiries: 0, revenueCad: 0, profitCad: 0, single: 0, pack3: 0, pack10: 0 };
    dailySeries.push({
      date: key,
      label: `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
      shortLabel: String(d.getUTCDate()),
      dow: d.getUTCDay(),
      buys: row.buys,
      inquiries: row.inquiries,
      revenueCad: Number(row.revenueCad.toFixed(2)),
      profitCad: Number(row.profitCad.toFixed(2)),
      single: row.single,
      pack3: row.pack3,
      pack10: row.pack10,
    });
  }

  const last7 = dailySeries.slice(-7);
  const prev7 = dailySeries.slice(-14, -7);
  const windowTotals = {
    buys7d: last7.reduce((s, x) => s + x.buys, 0),
    buysPrev7d: prev7.reduce((s, x) => s + x.buys, 0),
    revenue7dCad: Number(last7.reduce((s, x) => s + x.revenueCad, 0).toFixed(2)),
    inquiries7d: last7.reduce((s, x) => s + x.inquiries, 0),
    buys30d: dailySeries.reduce((s, x) => s + x.buys, 0),
    revenue30dCad: Number(dailySeries.reduce((s, x) => s + x.revenueCad, 0).toFixed(2)),
    inquiries30d: dailySeries.reduce((s, x) => s + x.inquiries, 0),
  };

  // 2. Weekly series (last 12 Monday-anchored weeks, oldest -> current week)
  const dowToday = todayUtc.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMon = (dowToday + 6) % 7;
  const currentWeekMon = addUtcDays(todayUtc, -daysSinceMon);
  const weeklySeries = [];
  for (let w = 11; w >= 0; w--) {
    const start = addUtcDays(currentWeekMon, -w * 7);
    let buys = 0;
    let inquiriesCount = 0;
    let revenueCad = 0;
    let profitCad = 0;
    let single = 0;
    let pack3 = 0;
    let pack10 = 0;
    for (let dOff = 0; dOff < 7; dOff++) {
      const key = toUtcDateKey(addUtcDays(start, dOff));
      const row = dayMap.get(key);
      if (!row) continue;
      buys += row.buys;
      inquiriesCount += row.inquiries;
      revenueCad += row.revenueCad;
      profitCad += row.profitCad;
      single += row.single;
      pack3 += row.pack3;
      pack10 += row.pack10;
    }
    weeklySeries.push({
      weekStart: toUtcDateKey(start),
      label: `${SHORT_MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`,
      buys,
      inquiries: inquiriesCount,
      revenueCad: Number(revenueCad.toFixed(2)),
      profitCad: Number(profitCad.toFixed(2)),
      single,
      pack3,
      pack10,
    });
  }

  // 3. GitHub-style 52-week (1-year) contribution heatmap aligned Sunday -> Saturday
  const currentWeekSun = addUtcDays(todayUtc, -dowToday);
  const heatmapStart = addUtcDays(currentWeekSun, -51 * 7);
  const totalHeatmapDays = 51 * 7 + dowToday + 1;
  const rawCells = [];
  let maxBuys = 0;
  let maxInquiries = 0;
  let maxRevenue = 0;

  for (let idx = 0; idx < totalHeatmapDays; idx++) {
    const d = addUtcDays(heatmapStart, idx);
    const key = toUtcDateKey(d);
    const row = dayMap.get(key) || { buys: 0, inquiries: 0, revenueCad: 0, profitCad: 0, single: 0, pack3: 0, pack10: 0 };
    if (row.buys > maxBuys) maxBuys = row.buys;
    if (row.inquiries > maxInquiries) maxInquiries = row.inquiries;
    if (row.revenueCad > maxRevenue) maxRevenue = row.revenueCad;
    rawCells.push({
      date: key,
      label: `${SHORT_DAYS[d.getUTCDay()]}, ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
      month: SHORT_MONTHS[d.getUTCMonth()],
      dayOfMonth: d.getUTCDate(),
      dow: d.getUTCDay(),
      weekIdx: Math.floor(idx / 7),
      buys: row.buys,
      inquiries: row.inquiries,
      revenueCad: Number(row.revenueCad.toFixed(2)),
      single: row.single,
      pack3: row.pack3,
      pack10: row.pack10,
    });
  }

  let activeBuyDays = 0;
  let totalBuys = 0;
  let totalInquiries = 0;
  let totalRevenueCad = 0;
  let longestBuyStreak = 0;
  let runStreak = 0;
  let peakBuyDay = null;

  const days = rawCells.map((c) => {
    totalBuys += c.buys;
    totalInquiries += c.inquiries;
    totalRevenueCad += c.revenueCad;
    if (c.buys > 0) {
      activeBuyDays += 1;
      runStreak += 1;
      if (runStreak > longestBuyStreak) longestBuyStreak = runStreak;
      if (!peakBuyDay || c.buys > peakBuyDay.buys || (c.buys === peakBuyDay.buys && c.revenueCad > peakBuyDay.revenueCad)) {
        peakBuyDay = { date: c.date, label: c.label, buys: c.buys, revenueCad: c.revenueCad };
      }
    } else {
      runStreak = 0;
    }
    return {
      ...c,
      levelBuys: computeHeatLevel(c.buys, maxBuys),
      levelInquiries: computeHeatLevel(c.inquiries, maxInquiries),
      levelRevenue: computeHeatLevel(c.revenueCad, maxRevenue),
    };
  });

  // Current streak (counting backward from today, allowing today to be 0 if yesterday had a buy)
  let currentBuyStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].buys > 0) {
      currentBuyStreak += 1;
    } else if (i === days.length - 1) {
      continue;
    } else {
      break;
    }
  }

  return {
    windowTotals,
    dailySeries,
    weeklySeries,
    heatmap: {
      weeksCount: 52,
      windowDays: days.length,
      totalBuys,
      totalInquiries,
      totalRevenueCad: Number(totalRevenueCad.toFixed(2)),
      activeBuyDays,
      currentBuyStreak,
      longestBuyStreak,
      peakBuyDay,
      days,
    },
  };
}

function buildCustomerDatabase(store) {
  const map = new Map();
  const ensure = (emailRaw, nameRaw) => {
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    let c = map.get(email);
    if (!c) {
      c = {
        email,
        name: String(nameRaw || '').trim(),
        ordersCount: 0,
        paidOrdersCount: 0,
        refundedCount: 0,
        totalSpentCad: 0,
        totalCreditsPurchased: 0,
        tiersBought: { single: 0, pack3: 0, pack10: 0 },
        vinsSet: new Set(),
        activePackCodesCount: 0,
        firstPurchaseAt: null,
        lastPurchaseAt: null,
      };
      map.set(email, c);
    } else if (nameRaw && !c.name) {
      c.name = String(nameRaw).trim();
    }
    return c;
  };

  // Seed from persisted store.customers if any
  for (const saved of Object.values(store.customers || {})) {
    const c = ensure(saved.email, saved.name);
    if (c && saved.firstPurchaseAt) c.firstPurchaseAt = saved.firstPurchaseAt;
    if (c && saved.lastPurchaseAt) c.lastPurchaseAt = saved.lastPurchaseAt;
  }

  // Authoritative aggregation across all orders (handles refunds & historical backfills)
  for (const o of store.orders || []) {
    const c = ensure(o.customerEmail, o.customerName);
    if (!c) continue;
    c.ordersCount += 1;
    const isPaid = o.status === 'paid' || o.status === 'sandbox_paid';
    if (isPaid) {
      c.paidOrdersCount += 1;
      c.totalSpentCad += Number(o.amountCad || 0);
      c.totalCreditsPurchased += Number(o.creditsTotal || 1);
      if (o.tierId === 'pack10') c.tiersBought.pack10 += 1;
      else if (o.tierId === 'pack3') c.tiersBought.pack3 += 1;
      else c.tiersBought.single += 1;
    } else if (o.status === 'refunded') {
      c.refundedCount += 1;
    }
    if (o.vin) c.vinsSet.add(o.vin);
    if (o.createdAt) {
      if (!c.firstPurchaseAt || o.createdAt < c.firstPurchaseAt) c.firstPurchaseAt = o.createdAt;
      if (!c.lastPurchaseAt || o.createdAt > c.lastPurchaseAt) c.lastPurchaseAt = o.createdAt;
    }
  }

  // Count active packs & redeemed VINs per customer email
  for (const p of Object.values(store.packCodes || {})) {
    if (!p.customerEmail) continue;
    const c = ensure(p.customerEmail, '');
    if (!c) continue;
    if (!p.revoked && Number(p.remainingCredits || 0) > 0) {
      c.activePackCodesCount += 1;
    }
    for (const r of p.redemptions || []) {
      if (r.vin) c.vinsSet.add(r.vin);
    }
  }

  return Array.from(map.values())
    .map((c) => {
      const totalSpentCad = Number(c.totalSpentCad.toFixed(2));
      const avgOrderCad =
        c.paidOrdersCount > 0 ? Number((totalSpentCad / c.paidOrdersCount).toFixed(2)) : 0;
      const vins = Array.from(c.vinsSet).slice(0, 12);
      return {
        email: c.email,
        name: c.name || '',
        ordersCount: c.ordersCount,
        paidOrdersCount: c.paidOrdersCount,
        refundedCount: c.refundedCount,
        totalSpentCad,
        avgOrderCad,
        totalCreditsPurchased: c.totalCreditsPurchased,
        tiersBought: c.tiersBought,
        vinsCount: c.vinsSet.size,
        vins,
        activePackCodesCount: c.activePackCodesCount,
        isRepeatBuyer: c.paidOrdersCount >= 2,
        firstPurchaseAt: c.firstPurchaseAt,
        lastPurchaseAt: c.lastPurchaseAt,
      };
    })
    .sort((a, b) => b.totalSpentCad - a.totalSpentCad || String(b.lastPurchaseAt || '').localeCompare(String(a.lastPurchaseAt || '')));
}

function isSandboxOrder(o) {
  return Boolean(
    o &&
      (o.status === 'sandbox_paid' ||
        o.source === 'admin-simulator' ||
        o.source === 'local-sandbox')
  );
}

async function getEffectiveSettingsAsync() {
  const store = await hydrateStore();
  return getEffectiveSettings(store);
}

async function getEffectivePricingTiersAsync() {
  const store = await hydrateStore();
  return getEffectivePricingTiers(store);
}

async function updateAdminSettingsAsync(patch) {
  return mutateLedgerDurable((store) => {
    const merged = sanitizeAdminSettings({
      ...(store.settings && typeof store.settings === 'object' ? store.settings : {}),
      ...(patch && typeof patch === 'object' ? patch : {}),
    });
    store.settings = merged;
    return {
      settings: merged,
      tiers: getEffectivePricingTiers(store),
    };
  });
}

async function purgeSandboxOrdersAsync() {
  return mutateLedgerDurable((store) => {
    const existingOrders = Array.isArray(store.orders) ? store.orders : [];
    const removedNumbers = new Set();
    const keptOrders = [];
    for (const o of existingOrders) {
      if (isSandboxOrder(o)) {
        if (o && o.orderNumber) removedNumbers.add(String(o.orderNumber));
      } else {
        keptOrders.push(o);
      }
    }
    store.orders = keptOrders;
    let purgedPacksCount = 0;
    if (store.packCodes && typeof store.packCodes === 'object' && removedNumbers.size > 0) {
      for (const [k, rec] of Object.entries(store.packCodes)) {
        if (rec && rec.orderNumber && removedNumbers.has(String(rec.orderNumber))) {
          delete store.packCodes[k];
          purgedPacksCount += 1;
        }
      }
    }
    return {
      purgedOrdersCount: removedNumbers.size,
      purgedPacksCount,
    };
  });
}

function _buildDashboardStatsFromStore(store) {
  const orders = store.orders || [];
  const inquiries = store.inquiries || [];
  const paidOrders = orders.filter((o) => o.status === 'paid' || o.status === 'sandbox_paid');
  const refundedOrders = orders.filter((o) => o.status === 'refunded');
  const sandboxOrdersCount = orders.filter(isSandboxOrder).length;
  const compOrdersCount = orders.filter((o) => o.status === 'comp').length;
  const totalRevenueCad = paidOrders.reduce((s, o) => s + Number(o.amountCad || 0), 0);
  const totalUpstreamCostCad = paidOrders.reduce((s, o) => s + Number(o.upstreamCostCad || 0), 0);
  const netProfitCad = paidOrders.reduce((s, o) => s + Number(o.netProfitCad || 0), 0);
  const refundedAmountCad = refundedOrders.reduce((s, o) => s + Number(o.amountCad || 0), 0);
  const avgOrderValueCad = paidOrders.length > 0 ? totalRevenueCad / paidOrders.length : 0;
  const byTier = { single: 0, pack3: 0, pack10: 0 };
  for (const o of paidOrders) {
    if (byTier[o.tierId] !== undefined) byTier[o.tierId] += 1;
  }
  const uniqueInquiredVins = new Set(inquiries.map((i) => i.vin).filter(Boolean)).size;
  const conversionPct =
    inquiries.length > 0 ? Number(((paidOrders.length / inquiries.length) * 100).toFixed(1)) : 0;

  const customers = buildCustomerDatabase(store);
  const repeatBuyersCount = customers.filter((c) => c.isRepeatBuyer).length;
  const repeatBuyerPct =
    customers.length > 0 ? Number(((repeatBuyersCount / customers.length) * 100).toFixed(1)) : 0;

  const packList = Object.values(store.packCodes || {});
  const activePackCodes = packList.filter((p) => !p.revoked && p.remainingCredits > 0).length;

  // Never expose plaintext pack codes or encrypted blobs in dashboard API responses
  const safeOrders = orders.slice(0, 100).map((o) => ({
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    vin: o.vin,
    vehicleTitle: o.vehicleTitle,
    tierId: o.tierId,
    tierName: o.tierName,
    creditsTotal: o.creditsTotal,
    packCode: o.packCodeMasked || (o.packCode ? maskPackCode(o.packCode) : null),
    customerEmail: o.customerEmail,
    customerName: o.customerName || '',
    promoCode: o.promoCode,
    amountCad: o.amountCad,
    upstreamCostCad: o.upstreamCostCad,
    netProfitCad: o.netProfitCad,
    status: o.status,
    refundedAt: o.refundedAt || null,
    livemode: o.livemode,
    source: o.source,
    accessToken: o.accessToken,
  }));

  const safePacks = packList
    .slice(-60)
    .reverse()
    .map((p) => ({
      codeHash: p.codeHash || null,
      code: p.codeMasked || (p.code ? maskPackCode(p.code) : 'DRV-••••'),
      securityVersion: p.securityVersion || 1,
      tierId: p.tierId,
      totalCredits: p.totalCredits,
      remainingCredits: p.remainingCredits,
      customerEmail: p.customerEmail || null,
      orderNumber: p.orderNumber || null,
      revoked: Boolean(p.revoked),
      redemptionsCount: Array.isArray(p.redemptions) ? p.redemptions.length : 0,
      createdAt: p.createdAt,
    }));

  const visiblePromos = Object.values(store.promoCodes || {}).filter((p) => !p.deleted);

  return {
    generatedAt: new Date().toISOString(),
    currency: 'CAD',
    runtime: getProductionReadiness(),
    fx: {
      baseCurrency: 'CAD',
      cadToUsd: getDefaultCadToUsdRate(),
    },
    settings: getEffectiveSettings(store),
    pricingTiers: getEffectivePricingTiers(store),
    summary: {
      totalInquiries: inquiries.length,
      uniqueInquiredVins,
      totalPaidOrders: paidOrders.length,
      refundedOrdersCount: refundedOrders.length,
      sandboxOrdersCount,
      compOrdersCount,
      refundedAmountCad: Number(refundedAmountCad.toFixed(2)),
      totalRevenueCad: Number(totalRevenueCad.toFixed(2)),
      totalUpstreamCostCad: Number(totalUpstreamCostCad.toFixed(2)),
      netProfitCad: Number(netProfitCad.toFixed(2)),
      avgOrderValueCad: Number(avgOrderValueCad.toFixed(2)),
      conversionPct,
      uniqueBuyersCount: customers.length,
      repeatBuyersCount,
      repeatBuyerPct,
      byTier,
      activePackCodes,
      cachedReportsCount: Object.keys(store.reportCache || {}).length,
    },
    analytics: buildVinAnalytics(paidOrders, inquiries),
    customers,
    recentInquiries: inquiries.slice(0, 60),
    recentOrders: safeOrders,
    packCodes: safePacks,
    promoCodes: visiblePromos,
  };
}

function getVinDashboardStats() {
  return _buildDashboardStatsFromStore(readStore());
}

async function getVinDashboardStatsAsync() {
  const store = await hydrateStore({ includeInquiries: true });
  return _buildDashboardStatsFromStore(store);
}

function escCsvCell(v) {
  let s = String(v == null ? '' : v);
  // Neutralize CSV formula injection (Excel/Sheets/Calc) while keeping valid negative numbers intact
  const trimmedStart = s.replace(/^[ \u00A0]+/, '');
  const isPureSignedNumber = /^-?\d+(?:\.\d+)?$/.test(trimmedStart);
  if (!isPureSignedNumber && /^[=+\-@\t\r]/.test(trimmedStart)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

function _exportCustomersCsvFromStore(store, cadToUsdRate) {
  const rate = Number.isFinite(Number(cadToUsdRate)) && Number(cadToUsdRate) > 0
    ? Number(cadToUsdRate)
    : getDefaultCadToUsdRate();
  const customers = buildCustomerDatabase(store);
  const header = [
    'Email',
    'Name',
    'PaidOrders',
    'RefundedOrders',
    'TotalSpentCAD',
    'TotalSpentUSD',
    'AvgOrderCAD',
    'CreditsPurchased',
    'SingleCount',
    'Pack3Count',
    'Pack10Count',
    'ActivePacks',
    'VinsCount',
    'VinsChecked',
    'FirstPurchaseAt',
    'LastPurchaseAt',
  ];
  const rows = customers.map((c) =>
    [
      c.email,
      c.name,
      c.paidOrdersCount,
      c.refundedCount,
      c.totalSpentCad.toFixed(2),
      (c.totalSpentCad * rate).toFixed(2),
      c.avgOrderCad.toFixed(2),
      c.totalCreditsPurchased,
      c.tiersBought.single,
      c.tiersBought.pack3,
      c.tiersBought.pack10,
      c.activePackCodesCount,
      c.vinsCount,
      c.vins.join(' | '),
      c.firstPurchaseAt || '',
      c.lastPurchaseAt || '',
    ]
      .map(escCsvCell)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

function exportCustomersCsv(cadToUsdRate) {
  return _exportCustomersCsvFromStore(readStore(), cadToUsdRate);
}

async function exportCustomersCsvAsync(cadToUsdRate) {
  const store = await hydrateStore();
  return _exportCustomersCsvFromStore(store, cadToUsdRate);
}

function _exportOrdersCsvFromStore(store, cadToUsdRate) {
  const rate = Number.isFinite(Number(cadToUsdRate)) && Number(cadToUsdRate) > 0
    ? Number(cadToUsdRate)
    : getDefaultCadToUsdRate();
  const header = [
    'OrderNumber',
    'CreatedAt',
    'VIN',
    'Vehicle',
    'Tier',
    'Status',
    'AmountCAD',
    'AmountUSD',
    'UpstreamCostCAD',
    'NetProfitCAD',
    'Email',
    'PackCodeMasked',
    'PromoCode',
    'Source',
  ];
  const rows = (store.orders || []).map((o) =>
    [
      o.orderNumber,
      o.createdAt,
      o.vin || '',
      o.vehicleTitle || '',
      o.tierId,
      o.status,
      Number(o.amountCad || 0).toFixed(2),
      (Number(o.amountCad || 0) * rate).toFixed(2),
      Number(o.upstreamCostCad || 0).toFixed(2),
      Number(o.netProfitCad || 0).toFixed(2),
      o.customerEmail || '',
      o.packCodeMasked || (o.packCode ? maskPackCode(o.packCode) : ''),
      o.promoCode || '',
      o.source || '',
    ]
      .map(escCsvCell)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

function exportOrdersCsv(cadToUsdRate) {
  return _exportOrdersCsvFromStore(readStore(), cadToUsdRate);
}

async function exportOrdersCsvAsync(cadToUsdRate) {
  const store = await hydrateStore();
  return _exportOrdersCsvFromStore(store, cadToUsdRate);
}

// ---------------------------------------------------------------------------
// Free NHTSA vPIC Spec Decode + Recalls + Canadian Market Valuation (CAD)
// ---------------------------------------------------------------------------
function inferAssemblyOrigin(vin, plantCountry) {
  const pc = capWords(plantCountry || '');
  if (pc) return pc;
  const first = String(vin || '')[0];
  if (first === '2') return 'Canada';
  if (first === '1' || first === '4' || first === '5') return 'United States';
  if (first === '3') return 'Mexico';
  if (first === 'J') return 'Japan';
  if (first === 'K') return 'South Korea';
  if (first === 'W') return 'Germany';
  if (first === 'S') return 'United Kingdom';
  if (first === 'Z') return 'Italy';
  return 'International';
}

async function decodeVinNhtsa(vin) {
  const cleanVin = String(vin || '').trim().toUpperCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(cleanVin)}?format=json`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const r = data && Array.isArray(data.Results) ? data.Results[0] : null;
    if (!r || (!r.Make && !r.ModelYear)) return null;
    const year = Number(r.ModelYear) || null;
    const make = capWords(r.Make || '');
    const model = String(r.Model || '').trim();
    const trim = String(r.Trim || r.Series || '').trim();
    const disp = r.DisplacementL ? `${Number(r.DisplacementL).toFixed(1)}L` : '';
    const cyl = r.EngineCylinders ? `${r.EngineCylinders}-cyl` : '';
    const engineSummary = [disp, cyl].filter(Boolean).join(' · ') || r.EngineModel || 'Standard';
    const plantCity = capWords(r.PlantCity || '');
    const plantCountry = inferAssemblyOrigin(cleanVin, r.PlantCountry);
    return {
      vin: cleanVin,
      year,
      make,
      model,
      trim,
      bodyClass: String(r.BodyClass || 'Passenger Vehicle').trim(),
      engineSummary,
      fuelType: String(r.FuelTypePrimary || 'Gasoline').trim(),
      driveType: String(r.DriveType || 'Standard').trim(),
      manufacturer: String(r.Manufacturer || make || 'Manufacturer').trim(),
      plantCity,
      plantCountry,
      builtIn: [plantCity, plantCountry].filter(Boolean).join(', '),
      builtInCanada: /^2/.test(cleanVin) || /canada/i.test(plantCountry),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRecallsForVehicle(make, model, year) {
  if (!make || !model || !year) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const url =
      `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}` +
      `&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data.results) ? data.results : [];
    return rows.slice(0, 12).map((rc) => ({
      campaignNumber: String(rc.NHTSACampaignNumber || 'RECALL').trim(),
      component: String(rc.Component || 'Safety Component').trim(),
      summary: String(rc.Summary || '').trim(),
      consequence: String(rc.Consequence || '').trim(),
      remedy: String(rc.Remedy || 'Authorized Canadian dealership performs recall repairs free of charge.').trim(),
      reportDate: String(rc.ReportReceivedDate || '').trim(),
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function estimateCanadianValueCad(specs) {
  const year = Number((specs && specs.year) || 2016);
  const age = Math.max(0, new Date().getFullYear() - year);
  const body = String((specs && specs.bodyClass) || '').toLowerCase();
  const make = String((specs && specs.make) || '').toUpperCase();
  const modelTrim = `${(specs && specs.model) || ''} ${(specs && specs.trim) || ''}`.toUpperCase();

  let baseCad = 39000;
  if (/minivan|van/.test(body)) baseCad = 44000;
  else if (/pickup|truck/.test(body)) baseCad = 58000;
  else if (/suv|utility|crossover/.test(body)) baseCad = 47000;
  else if (/coupe|convertible/.test(body)) baseCad = 52000;
  else if (/sedan|hatchback|wagon/.test(body)) baseCad = 36000;

  // Apply realistic Canadian MSRP multipliers for luxury & performance badges
  if (/\b(PORSCHE|MASERATI|ASTON MARTIN|BENTLEY|FERRARI|LAMBORGHINI)\b/.test(make)) {
    baseCad *= 2.4;
  } else if (
    /\b(BMW|MERCEDES-BENZ|MERCEDES|AUDI|LEXUS|LAND ROVER|JAGUAR|VOLVO|TESLA|CADILLAC|GENESIS|LINCOLN|ALFA ROMEO|RIVIAN|LUCID)\b/.test(
      make
    )
  ) {
    baseCad *= 1.82;
  } else if (/\b(ACURA|INFINITI|BUICK|MINI)\b/.test(make)) {
    baseCad *= 1.28;
  }

  if (/\b(M340I|M440I|M240I|M2|M3|M4|M5|M8|AMG|RS\d|S4|S5|SQ5|TYPE R|STI|SRT|HELLCAT|RAPTOR|TRX|GT350|GT500|Z06|PLAID|PERFORMANCE)\b/.test(modelTrim)) {
    baseCad *= 1.18;
  }

  let val = baseCad;
  for (let i = 0; i < age; i++) {
    val *= i < 4 ? 0.87 : 0.925;
  }
  val = Math.max(val, 2200);
  const lowCad = Math.round((val * 0.85) / 100) * 100;
  const highCad = Math.round((val * 1.15) / 100) * 100;
  const midCad = Math.round(((lowCad + highCad) / 2) / 100) * 100;
  return {
    currency: 'CAD',
    lowCad,
    highCad,
    midCad,
    dealerTradeLowCad: Math.round((lowCad * 0.78) / 100) * 100,
    dealerTradeHighCad: Math.round((highCad * 0.78) / 100) * 100,
  };
}

// ---------------------------------------------------------------------------
// Reference Photo Resolver (Wikimedia Commons CC-licensed exterior fallback)
// ---------------------------------------------------------------------------
const PHOTO_EXCLUDE_RE =
  /\b(interior|cockpit|dashboard|steering|instrument|cluster|engine|motor|logo|emblem|badge|wheel|rim|headlight|taillight|wreck|crash|damaged|accident|burn|diagram|schematic|map|brochure|ad\b|key|fob|trunk|boot|seat|seats|leather|gearbox|shifter|exhaust|plate|dealer|police|taxi|ambulance|racecar|rally|gt3|gt4|nascar|motorsport|concept|spy|camo|camouflage|prototype|lego|toy|diecast|scale)\b/i;

async function resolveVehicleReferencePhoto({ year, make, model, bodyClass, exteriorColor }) {
  const cleanMake = String(make || '').trim();
  const cleanModel = String(model || '').trim();
  if (!cleanMake || !cleanModel) return { imageUrl: null, caption: null };

  const store = readStore();
  const key = `${year || 'any'}:${cleanMake}:${cleanModel}:${exteriorColor || 'any'}`.toLowerCase();
  if (store.photoCache && store.photoCache[key]) {
    return store.photoCache[key];
  }

  const baseModel = cleanModel.split(/\s+/)[0];
  const queries = [];
  if (year) {
    queries.push(`(intitle:${year - 1} OR intitle:${year} OR intitle:${year + 1}) intitle:"${cleanMake}" intitle:"${baseModel}"`);
  }
  queries.push(`intitle:"${cleanMake}" intitle:"${baseModel}" front`);

  for (const q of queries) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const sp = new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: `filetype:bitmap ${q}`,
        gsrlimit: '10',
        prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: '800',
      });
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${sp.toString()}`, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Drivee/1.0 (https://www.drivee.ca; drivee.canada@gmail.com)',
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const pages = Object.values((data.query && data.query.pages) || {});
      const scored = [];
      for (const p of pages) {
        const title = String(p.title || '');
        const ii = p.imageinfo && p.imageinfo[0];
        if (!ii) continue;
        const mime = String(ii.mime || '').toLowerCase();
        if (mime !== 'image/jpeg' && mime !== 'image/png') continue;
        const w = Number(ii.width || 0);
        const h = Number(ii.height || 0);
        if (w < 640 || h < 360 || w / h < 1.18 || w / h > 2.35) continue;
        const tl = title.toLowerCase();
        if (!tl.includes(cleanMake.toLowerCase()) || !tl.includes(baseModel.toLowerCase())) continue;
        if (PHOTO_EXCLUDE_RE.test(tl)) continue;
        const url = ii.thumburl || ii.url;
        if (!url || !/^https:\/\//i.test(url)) continue;

        let score = 10;
        if (year && tl.includes(String(year))) score += 25;
        if (/\bfront\b/i.test(tl)) score += 12;
        if (/\brear\b/i.test(tl) && !/\bfront\b/i.test(tl)) score -= 12;
        if (exteriorColor && tl.includes(String(exteriorColor).toLowerCase())) score += 8;
        if (/sedan/i.test(bodyClass || '') && /\b(wagon|estate)\b/i.test(tl)) score -= 8;
        const lic = String((ii.extmetadata && ii.extmetadata.LicenseShortName && ii.extmetadata.LicenseShortName.value) || 'CC BY-SA')
          .replace(/<[^>]+>/g, '')
          .trim();
        scored.push({ score, url, lic });
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored[0]) {
        const out = {
          imageUrl: scored[0].url,
          caption: `Reference photo of an equivalent ${year ? `${year} ` : ''}${cleanMake} ${cleanModel}, not this exact vehicle · Wikimedia Commons (${scored[0].lic})`,
        };
        store.photoCache[key] = out;
        writeStore(store);
        return out;
      }
    } catch {
      clearTimeout(timer);
    }
  }

  return { imageUrl: null, caption: null };
}

// ---------------------------------------------------------------------------
// Non-blocking Supabase funnel logging (isolated when SUPABASE_URL is set)
// ---------------------------------------------------------------------------
async function emitSupabaseEvent(event, metaObj) {
  const url = process.env.SUPABASE_URL || 'https://ofnsssyiiejohcnbejxq.supabase.co';
  if (url.includes('127.0.0.1:9')) return;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbnNzc3lpaWVqb2hjbmJlanhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDE4OTcsImV4cCI6MjA5MTA3Nzg5N30._C3k82OSOklVtKaWT4zl1rWGJyaokiRQC9H6y5VhS58';
  try {
    await fetch(`${url}/rest/v1/analytics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        event,
        meta: JSON.stringify(metaObj || {}),
      }),
    });
  } catch {
    // non-fatal telemetry
  }
}

module.exports = {
  VIN_PRICING_CAD,
  DEFAULT_SETTINGS,
  getEffectiveSettings,
  getEffectiveSettingsAsync,
  getEffectivePricingTiers,
  getEffectivePricingTiersAsync,
  updateAdminSettingsAsync,
  purgeSandboxOrdersAsync,
  isProductionRuntime,
  isFreePromoEnabledByDefault,
  getStorageBackendInfo,
  getProductionReadiness,
  hydrateStore,
  getVinTier,
  getTierByAmountCadCents,
  sanitizeVinInput,
  validateVin,
  scrubToDriveeBranding,
  cleanDealerSourceText,
  capWords,
  hashIp,
  extractClientIp,
  checkRateLimit,
  recordRateLimitFailure,
  clearRateLimit,
  resetAllRateLimits,
  checkRateLimitAsync,
  recordRateLimitFailureAsync,
  clearRateLimitAsync,
  getAdminAuthConfig,
  verifyAdminCredentials,
  signAdminSessionToken,
  verifyAdminSessionCookie,
  buildAdminSessionSetCookie,
  verifyAdminRequest,
  signReportAccessToken,
  verifyReportAccessToken,
  verifyPackCodeFormatAndMac,
  maskPackCode,
  issuePackCreditCode,
  issuePackCreditCodeAsync,
  revokePackCreditCode,
  revokePackCreditCodeAsync,
  adjustPackCredits,
  adjustPackCreditsAsync,
  checkPackCreditStatus,
  checkPackCreditStatusAsync,
  inspectPackCreditCode,
  inspectPackCreditCodeAsync,
  redeemPackCreditCode,
  redeemPackCreditCodeAsync,
  evaluatePromoCode,
  evaluatePromoCodeAsync,
  createPromoCode,
  createPromoCodeAsync,
  setPromoCodeActive,
  setPromoCodeActiveAsync,
  deletePromoCode,
  deletePromoCodeAsync,
  recordVinInquiry,
  recordVinInquiryAsync,
  recordVinOrder,
  recordVinOrderAsync,
  markOrderRefunded,
  markOrderRefundedAsync,
  markOrderRefundedByPaymentIntent,
  markOrderRefundedByPaymentIntentAsync,
  claimWebhookEventAsync,
  releaseWebhookEventAsync,
  findOrderBySessionId,
  findOrderBySessionIdAsync,
  getCachedReport,
  getCachedReportAsync,
  claimReportBuildAsync,
  releaseReportBuildAsync,
  claimReportReadyEmailAsync,
  releaseReportReadyEmailAsync,
  saveCachedReport,
  saveCachedReportAsync,
  getVinDashboardStats,
  getVinDashboardStatsAsync,
  exportOrdersCsv,
  exportOrdersCsvAsync,
  exportCustomersCsv,
  exportCustomersCsvAsync,
  getDefaultCadToUsdRate,
  decodeVinNhtsa,
  fetchRecallsForVehicle,
  estimateCanadianValueCad,
  resolveVehicleReferencePhoto,
  emitSupabaseEvent,
};
