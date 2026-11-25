/**
 * Drivee Canadian VIN — Durable Supabase Postgres Bucket Store
 * ---------------------------------------------------------------------------
 * Pure Node >= 18 built-ins (native fetch, zero npm dependencies).
 *
 * Uses Supabase PostgREST with SUPABASE_SERVICE_ROLE_KEY against the
 * RLS-locked `public.vin_store_buckets` table so orders, buyer emails,
 * hashed pack credit codes, promo revocations, webhook deduplication,
 * rate-limit lockouts, and cached VIN reports persist durably across
 * Vercel serverless cold starts and parallel lambda instances.
 *
 * Concurrency:
 *   Critical buckets (`ledger`, `inquiries`) use optimistic concurrency
 *   control (CAS on `version`) with automatic randomized-backoff retries so
 *   concurrent pack redemptions or Stripe webhooks can never overwrite each
 *   other or double-spend a credit.
 */

'use strict';

const DEFAULT_SUPABASE_URL = 'https://ofnsssyiiejohcnbejxq.supabase.co';
const DEFAULT_TABLE = 'vin_store_buckets';
const DEFAULT_TIMEOUT_MS = 6500;

function getSupabaseStoreConfig() {
  const modeOverride = String(process.env.VIN_STORE_MODE || '').trim().toLowerCase();
  if (modeOverride === 'local' || modeOverride === 'file') {
    return { enabled: false, reason: 'forced-local' };
  }
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceRoleKey) {
    return { enabled: false, reason: 'missing-service-role-key' };
  }
  const rawUrl = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, '');
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl) || rawUrl.includes('127.0.0.1:9')) {
    return { enabled: false, reason: 'disabled-url' };
  }
  const rawTable = String(process.env.VIN_SUPABASE_TABLE || DEFAULT_TABLE).trim();
  const table = /^[a-zA-Z_][a-zA-Z0-9_]{1,62}$/.test(rawTable) ? rawTable : DEFAULT_TABLE;
  return {
    enabled: true,
    url: rawUrl,
    serviceRoleKey,
    table,
  };
}

function isSupabaseStoreEnabled() {
  return getSupabaseStoreConfig().enabled;
}

function buildHeaders(cfg, extra = {}) {
  return {
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

async function pgFetch(cfg, pathAndQuery, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${cfg.table}${pathAndQuery}`, {
      method: options.method || 'GET',
      headers: buildHeaders(cfg, options.headers || {}),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const detail = (json && (json.message || json.error || json.hint)) || text.slice(0, 240) || `HTTP ${res.status}`;
      const err = new Error(`Supabase store error (${res.status}): ${detail}`);
      err.status = res.status;
      err.code = json && json.code;
      throw err;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function getBucket(bucket, opts = {}) {
  const cfg = getSupabaseStoreConfig();
  if (!cfg.enabled) return { exists: false, payload: null, version: 0 };
  const q = `?bucket=eq.${encodeURIComponent(String(bucket))}&select=bucket,payload,version,updated_at&limit=1`;
  const { json } = await pgFetch(cfg, q, { method: 'GET', timeoutMs: opts.timeoutMs });
  const row = Array.isArray(json) ? json[0] : null;
  if (!row) return { exists: false, payload: null, version: 0 };
  return {
    exists: true,
    bucket: row.bucket,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    version: Number(row.version || 1),
    updatedAt: row.updated_at || null,
  };
}

async function getBuckets(bucketNames, opts = {}) {
  const cfg = getSupabaseStoreConfig();
  const out = new Map();
  if (!cfg.enabled || !Array.isArray(bucketNames) || !bucketNames.length) return out;
  const escaped = bucketNames.map((b) => `"${String(b).replace(/"/g, '')}"`).join(',');
  const q = `?bucket=in.(${encodeURIComponent(escaped)})&select=bucket,payload,version,updated_at`;
  const { json } = await pgFetch(cfg, q, { method: 'GET', timeoutMs: opts.timeoutMs });
  if (Array.isArray(json)) {
    for (const row of json) {
      if (row && row.bucket) {
        out.set(row.bucket, {
          exists: true,
          bucket: row.bucket,
          payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
          version: Number(row.version || 1),
          updatedAt: row.updated_at || null,
        });
      }
    }
  }
  return out;
}

async function ensureBucket(bucket, initialPayload) {
  const cfg = getSupabaseStoreConfig();
  if (!cfg.enabled) return { exists: false, payload: initialPayload, version: 0 };
  await pgFetch(cfg, '?on_conflict=bucket', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: {
      bucket: String(bucket),
      payload: initialPayload,
      version: 1,
      updated_at: new Date().toISOString(),
    },
  });
  return getBucket(bucket);
}

async function compareAndSwapBucket(bucket, expectedVersion, nextPayload) {
  const cfg = getSupabaseStoreConfig();
  if (!cfg.enabled) return { ok: false, conflict: false };
  const q = `?bucket=eq.${encodeURIComponent(String(bucket))}&version=eq.${Number(expectedVersion)}`;
  const { json } = await pgFetch(cfg, q, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: {
      payload: nextPayload,
      version: Number(expectedVersion) + 1,
      updated_at: new Date().toISOString(),
    },
  });
  if (Array.isArray(json) && json.length === 1) {
    return { ok: true, version: Number(json[0].version || expectedVersion + 1) };
  }
  return { ok: false, conflict: true };
}

async function upsertBucket(bucket, nextPayload, opts = {}) {
  const cfg = getSupabaseStoreConfig();
  if (!cfg.enabled) return { ok: false };
  await pgFetch(cfg, '?on_conflict=bucket', {
    method: 'POST',
    timeoutMs: opts.timeoutMs,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      bucket: String(bucket),
      payload: nextPayload,
      version: 1,
      updated_at: new Date().toISOString(),
    },
  });
  return { ok: true };
}

async function deleteBucket(bucket, opts = {}) {
  const cfg = getSupabaseStoreConfig();
  if (!cfg.enabled) return { ok: false };
  const q = `?bucket=eq.${encodeURIComponent(String(bucket))}`;
  await pgFetch(cfg, q, {
    method: 'DELETE',
    timeoutMs: opts.timeoutMs,
    headers: { Prefer: 'return=minimal' },
  });
  return { ok: true };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithBucketCas(bucket, defaultFactory, mutatorFn, maxRetries = 5) {
  const cfg = getSupabaseStoreConfig();
  if (!cfg.enabled) {
    throw new Error('Supabase store is not configured (SUPABASE_SERVICE_ROLE_KEY missing).');
  }
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let row = await getBucket(bucket);
    if (!row.exists) {
      row = await ensureBucket(bucket, defaultFactory());
    }
    const working = JSON.parse(JSON.stringify(row.payload || defaultFactory()));
    const result = await mutatorFn(working);
    if (result && result.__skipWrite === true) {
      return result.value;
    }
    const cas = await compareAndSwapBucket(bucket, row.version, working);
    if (cas.ok) {
      return result;
    }
    if (attempt < maxRetries - 1) {
      await sleep(25 + Math.floor(Math.random() * 75));
    }
  }
  throw new Error(`Concurrent write conflict on Supabase bucket "${bucket}". Please retry.`);
}

module.exports = {
  getSupabaseStoreConfig,
  isSupabaseStoreEnabled,
  getBucket,
  getBuckets,
  ensureBucket,
  compareAndSwapBucket,
  upsertBucket,
  deleteBucket,
  runWithBucketCas,
};
