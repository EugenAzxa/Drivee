// Aggregated analytics for the internal dashboard.
// Reads /analytics rows from Supabase, returns rolled-up JSON.

var ALLOWED_ORIGINS = [
  'https://drivee.ca',
  'https://www.drivee.ca',
  'http://localhost',
  'http://127.0.0.1'
];

// Pull up to this many most-recent rows. Plenty of headroom for early-stage app.
var FETCH_LIMIT = 10000;

function dayKey(iso) {
  // "YYYY-MM-DD" — bucketing in UTC keeps things simple
  return iso.slice(0, 10);
}

function topN(map, n) {
  return Object.keys(map)
    .map(function(k){ return { key: k, count: map[k] }; })
    .sort(function(a, b){ return b.count - a.count; })
    .slice(0, n);
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || req.headers.referer || '';
  var allowed = ALLOWED_ORIGINS.some(function(o){ return origin.indexOf(o) === 0; });

  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  var supabaseUrl = process.env.SUPABASE_URL || 'https://ofnsssyiiejohcnbejxq.supabase.co';
  var supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  if (!supabaseKey) {
    return res.status(500).json({ error: 'Supabase key missing' });
  }

  // Pull recent rows. Supabase has a default 1000-row limit per request unless we add a Range header.
  var url = supabaseUrl + '/rest/v1/analytics?select=event,meta,created_at&order=created_at.desc&limit=' + FETCH_LIMIT;
  var rows = [];
  try {
    var r = await fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Range-Unit': 'items',
        'Range': '0-' + (FETCH_LIMIT - 1)
      }
    });
    if (!r.ok) {
      var txt = await r.text();
      return res.status(500).json({ error: 'Supabase fetch failed', status: r.status, body: txt.slice(0, 200) });
    }
    rows = await r.json();
  } catch (e) {
    return res.status(500).json({ error: 'Supabase fetch threw', detail: String(e).slice(0, 200) });
  }

  // ── Aggregate ────────────────────────────────────────
  var now = Date.now();
  var DAY = 86400000;
  var todayCutoff = now - 1 * DAY;
  var weekCutoff  = now - 7 * DAY;
  var monthCutoff = now - 30 * DAY;

  var totals = { today: 0, last7d: 0, last30d: 0, allTime: rows.length };
  var byEvent = {};
  var byTab   = {};
  var byDay   = {};   // YYYY-MM-DD → count, last 14 days
  var funnel  = { app_open: 0, scan_ticket: 0, scan_success: 0, dispute_generated: 0 };
  var recent  = [];

  // Build a 14-day skeleton so days with zero events still show up
  var trendDays = 14;
  for (var i = 0; i < trendDays; i++) {
    var d = new Date(now - i * DAY).toISOString().slice(0, 10);
    byDay[d] = 0;
  }

  rows.forEach(function(row) {
    var ts = new Date(row.created_at).getTime();
    if (ts >= todayCutoff) totals.today++;
    if (ts >= weekCutoff)  totals.last7d++;
    if (ts >= monthCutoff) totals.last30d++;

    byEvent[row.event] = (byEvent[row.event] || 0) + 1;

    if (row.event === 'tab_click' && row.meta) {
      // meta is the tab id, e.g. "tab-dashboard"
      var tabName = String(row.meta).replace(/^tab-/, '') || 'unknown';
      byTab[tabName] = (byTab[tabName] || 0) + 1;
    }

    var dk = dayKey(row.created_at);
    if (dk in byDay) byDay[dk]++;

    if (funnel.hasOwnProperty(row.event)) funnel[row.event]++;
  });

  recent = rows.slice(0, 30).map(function(r){
    return { event: r.event, meta: r.meta || '', created_at: r.created_at };
  });

  var dailyTrend = Object.keys(byDay)
    .sort()
    .map(function(date){ return { date: date, count: byDay[date] }; });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    rowCount: rows.length,
    totals: totals,
    byEvent: topN(byEvent, 20),
    byTab:   topN(byTab, 10),
    dailyTrend: dailyTrend,
    funnel: funnel,
    recent: recent
  });
};
