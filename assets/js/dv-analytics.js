/*
 * Drivee — Google tag (GA4 + Google Ads) in one place.
 *
 * Fill in the IDs below and every page that includes this file starts
 * reporting. While an ID is empty, that part stays off (no network calls).
 *
 *   GA4_ID              GA4 → Admin → Data streams → web stream → Measurement ID (G-XXXXXXXXXX)
 *   ADS_ID              Google Ads → Goals → Conversions → tag setup → Conversion ID (AW-XXXXXXXXXX)
 *   ADS_PURCHASE_LABEL  the same screen, the part after the slash in send_to 'AW-XXXX/<label>'
 *
 * Exposes:
 *   dvGa(event, meta)        forward an internal dvTrack event to GA4 / Ads
 *   dvAds.purchase({...})    fire the purchase conversion once per Stripe session
 *   dvAds.clickIds()         {gclid, gbraid, wbraid} saved from the ad click (90 days)
 */
(function () {
  var GA4_ID = 'G-JSWWRDD7SN';
  var ADS_ID = '';
  var ADS_PURCHASE_LABEL = '';

  var CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];
  var CLICK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // Remember the ad click id so the purchase (often a later visit) can be tied to the click.
  try {
    var q = new URLSearchParams(location.search);
    CLICK_KEYS.forEach(function (k) {
      var v = q.get(k);
      if (v && /^[A-Za-z0-9_\-]{10,200}$/.test(v)) store('dv_' + k, JSON.stringify({ v: v, t: Date.now() }));
    });
  } catch (e) {}

  function clickIds() {
    var out = {};
    CLICK_KEYS.forEach(function (k) {
      try {
        var o = JSON.parse(load('dv_' + k) || 'null');
        if (o && o.v && Date.now() - o.t < CLICK_TTL_MS) out[k] = o.v;
      } catch (e) {}
    });
    return out;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  var enabled = !!(GA4_ID || ADS_ID);

  if (enabled) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID || ADS_ID);
    document.head.appendChild(s);
    gtag('js', new Date());
    if (GA4_ID) gtag('config', GA4_ID);
    if (ADS_ID) gtag('config', ADS_ID);
  }

  // Internal event names → GA4 names. Anything not listed is sent as-is.
  var GA_NAMES = { report_buy_click: 'begin_checkout' };
  var SKIP = { page_view: 1, app_open: 1 }; // GA4 counts page views itself

  window.dvGa = function (event, meta) {
    if (!enabled || !event || SKIP[event]) return;
    try {
      var params = {};
      if (meta) params.detail = String(meta).slice(0, 100);
      gtag('event', GA_NAMES[event] || event, params);
    } catch (e) {}
  };

  window.dvAds = {
    clickIds: clickIds,
    // o: { sessionId, value, currency, tierId }
    purchase: function (o) {
      if (!enabled || !o || !o.sessionId) return;
      var key = 'dv_conv_' + o.sessionId;
      if (load(key)) return; // already reported from this browser
      store(key, '1');
      var value = Number(o.value) || 0;
      var currency = (o.currency || 'CAD').toUpperCase();
      try {
        if (GA4_ID) {
          gtag('event', 'purchase', {
            send_to: GA4_ID,
            transaction_id: o.sessionId,
            value: value,
            currency: currency,
            items: [{ item_id: o.tierId || 'single', item_name: 'Drivee VIN report', price: value, quantity: 1 }]
          });
        }
        if (ADS_ID && ADS_PURCHASE_LABEL) {
          gtag('event', 'conversion', {
            send_to: ADS_ID + '/' + ADS_PURCHASE_LABEL,
            transaction_id: o.sessionId,
            value: value,
            currency: currency
          });
        }
      } catch (e) {}
    }
  };
})();
