/**
 * Drivee Official Vector PDF Dossier Generator (Pure Node >= 18, zero npm deps)
 * ---------------------------------------------------------------------------
 * Builds a print-shop-grade, multi-page Letter (612 x 792 pt) PDF 1.4 binary
 * matching VinBadge's executive dossier architecture, tailored for Drivee Canada
 * (km/mi toggle-aware, CAD valuations, Canadian checklist, zero third-party leaks).
 *
 * Uses native PDF vector paths, FlateDecode compressed streams, Standard Type1
 * Helvetica/Courier with calibrated character widths, and native JPEG XObject
 * (/DCTDecode) embedding for the vehicle hero photo.
 */

'use strict';

const zlib = require('zlib');

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_L = 32;
const MARGIN_R = 32;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R; // 548 pt
const BODY_TOP_Y = 60;
const MAX_BODY_Y = 742;

const C = {
  ink: '#0B1430',
  ink2: '#334155',
  muted: '#64748B',
  light: '#94A3B8',
  border: '#E2E8F0',
  borderBlue: '#CFE0FA',
  softSlate: '#F8FAFC',
  softBlue: '#F4F7FC',
  heroSky: '#E8F1FE',
  heroNavy: '#0F2252',
  blue: '#2563EB',
  blueDark: '#1D4ED8',
  bluePill: '#DBEAFE',
  green: '#16A34A',
  greenDark: '#15803D',
  greenPill: '#DCFCE7',
  emerald: '#059669',
  emeraldPill: '#D1FAE5',
  amber: '#D97706',
  amberDark: '#B45309',
  amberBg: '#FFFBEB',
  amberPill: '#FEF3C7',
  amberBorder: '#FDE68A',
  red: '#DC2626',
  redBright: '#EF4444',
  redDark: '#991B1B',
  redBg: '#FEF2F2',
  redPill: '#FEE2E2',
  purple: '#7C3AED',
  purplePill: '#EDE9FE',
  neutralPill: '#F1F5F9',
  white: '#FFFFFF',
};

const OWNER_PALETTE = [
  { solid: '#2563EB', band: '#DBEAFE', text: '#1D4ED8' },
  { solid: '#16A34A', band: '#DCFCE7', text: '#15803D' },
  { solid: '#F59E0B', band: '#FEF3C7', text: '#B45309' },
  { solid: '#7C3AED', band: '#EDE9FE', text: '#6D28D9' },
  { solid: '#0D9488', band: '#CCFBF1', text: '#0F766E' },
];

function ownerPal(n) {
  return OWNER_PALETTE[Math.max(0, (Number(n) || 1) - 1) % OWNER_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Text Width Table (Helvetica AFM widths in 1/1000 em) & WinAnsi Escaping
// ---------------------------------------------------------------------------
const HELV_WIDTHS = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
  64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778,
  80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944,
  88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556,
  96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
  118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260,
  125: 334, 126: 584, 183: 278, 8211: 556, 8212: 1000, 8226: 350,
};

function sanitizePdfText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b\d[\d,]*\s*Customer\s+Favorites?\b/gi, '')
    .replace(/\bCustomer\s+Favorites?\b/gi, '')
    .replace(/\b\d[\d,]*\s*(?:Verified\s+)?(?:Customer\s+)?Reviews?\b/gi, '')
    .replace(/\b\d(?:\.\d)?\s*(?:\/|out\s+of)\s*5(?:\.0)?(?:\s*stars?)?\b/gi, '')
    .replace(/\bTop[- ]Rated\s+(?:Dealer|Service\s+Center)(?:\s+\d{4})?\b/gi, '')
    .replace(/\b([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,2}),\s*null(?=\s+\1,\s*[A-Z]{2}\b)/gi, '')
    .replace(/(\b([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,2}),\s*[A-Z]{2})\s+\2,\s*null\b/gi, '$1')
    .replace(/,\s*null\b/gi, '')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2192/g, '->')
    .replace(/\u2713|\u2714/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function encodeWinAnsi(str) {
  const s = sanitizePdfText(str);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x28) out += '\\(';
    else if (code === 0x29) out += '\\)';
    else if (code === 0x5c) out += '\\\\';
    else if (code >= 32 && code <= 126) out += s[i];
    else if (code === 0xb7) out += '\\267'; // middle dot ·
    else if (code === 0xb0) out += '\\260'; // degree °
    else if (code === 0xa9) out += '\\251'; // ©
    else if (code === 0xe9) out += '\\351'; // é
    else if (code === 0xe8) out += '\\350'; // è
    else if (code === 0xe0) out += '\\340'; // à
    else if (code === 0xc9) out += '\\311'; // É
    else out += ' ';
  }
  return out;
}

function measureText(raw, font, size) {
  const s = sanitizePdfText(raw);
  if (font === 'F3' || font === 'F4') {
    return s.length * 0.6 * size;
  }
  const boldMult = font === 'F2' ? 1.055 : 1.0;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    total += (HELV_WIDTHS[c] || 556);
  }
  return (total / 1000) * size * boldMult;
}

function truncateText(raw, maxW, font, size) {
  const s = sanitizePdfText(raw);
  if (measureText(s, font, size) <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(s.slice(0, mid) + '...', font, size) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, Math.max(1, lo)).trimEnd() + '...';
}

function wrapLines(raw, maxW, font, size, maxLines = 10) {
  const s = sanitizePdfText(raw);
  if (!s) return [];
  const words = s.split(' ');
  const all = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measureText(next, font, size) <= maxW) {
      cur = next;
    } else {
      if (cur) all.push(cur);
      cur = w;
    }
  }
  if (cur) all.push(cur);
  if (all.length <= maxLines) {
    return all.map((ln) => (measureText(ln, font, size) > maxW ? truncateText(ln, maxW, font, size) : ln));
  }
  const kept = all.slice(0, maxLines - 1);
  const rest = all.slice(maxLines - 1).join(' ');
  kept.push(truncateText(rest, maxW, font, size));
  return kept;
}

function hexRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function n(v) {
  return Number(v).toFixed(2);
}

// ---------------------------------------------------------------------------
// Native JPEG Dimension Parser (for PDF /DCTDecode Image XObject)
// ---------------------------------------------------------------------------
function parseJpegInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd8) continue;
    if (i + 2 > buf.length) break;
    const segLen = buf.readUInt16BE(i);
    if (segLen < 2 || i + segLen > buf.length) break;
    // SOF0, SOF1, SOF2 (baseline / extended / progressive JPEG)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const bits = buf[i + 2];
      const height = buf.readUInt16BE(i + 3);
      const width = buf.readUInt16BE(i + 5);
      const components = buf[i + 7];
      if (width > 0 && height > 0 && (components === 1 || components === 3)) {
        return { width, height, bits, components, data: buf };
      }
      return null;
    }
    i += segLen;
  }
  return null;
}

const ALLOWED_HERO_EXACT_HOSTS = new Set([
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'drivee.ca',
  'www.drivee.ca',
]);
const ALLOWED_HERO_SUFFIX_HOSTS = [
  '.b-cdn.net',
  '.amazonaws.com',
  '.cloudfront.net',
  '.copart.com',
  '.iaai.com',
  '.auctionsapi.com',
];
const MAX_HERO_JPEG_BYTES = 2.5 * 1024 * 1024;

function isAllowedHeroPhotoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 2048) return false;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = String(u.hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // Reject IPv4 and IPv6 literal hosts outright to prevent SSRF to loopback / cloud metadata IPs
  if (/^[\d.]+$/.test(host) || host.includes(':')) return false;
  if (ALLOWED_HERO_EXACT_HOSTS.has(host)) return true;
  return ALLOWED_HERO_SUFFIX_HOSTS.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

async function fetchHeroJpeg(url) {
  if (!isAllowedHeroPhotoUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'error',
      headers: { 'User-Agent': 'Drivee/1.0 (https://www.drivee.ca)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const clHeader = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('content-length') || 0) : 0;
    if (Number.isFinite(clHeader) && clHeader > MAX_HERO_JPEG_BYTES) return null;

    let buf;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_HERO_JPEG_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          return null;
        }
        chunks.push(Buffer.from(value));
      }
      buf = Buffer.concat(chunks, total);
    } else {
      const arr = await res.arrayBuffer();
      buf = Buffer.from(arr);
      if (buf.length > MAX_HERO_JPEG_BYTES) return null;
    }
    return parseJpegInfo(buf);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Minimal Pure-Node Multi-Page PDF 1.4 Vector Builder
// ---------------------------------------------------------------------------
class PdfBuilder {
  constructor() {
    this.pages = [];
    this.cur = null;
    this.images = []; // { name, width, height, bits, components, data }
  }

  addPage() {
    const ops = [];
    this.pages.push(ops);
    this.cur = ops;
    return this.pages.length;
  }

  py(y) {
    return PAGE_H - y;
  }

  raw(op) {
    this.cur.push(op);
  }

  registerImage(jpgInfo) {
    if (!jpgInfo) return null;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, ...jpgInfo });
    return name;
  }

  _roundedPath(x, y, w, h, r) {
    const rad = Math.min(r || 0, w / 2, h / 2);
    const x0 = x, x1 = x + w;
    const yTop = this.py(y), yBot = this.py(y + h);
    if (rad <= 0.1) {
      return `${n(x0)} ${n(yBot)} ${n(w)} ${n(h)} re`;
    }
    const k = rad * 0.55228475;
    return [
      `${n(x0 + rad)} ${n(yTop)} m`,
      `${n(x1 - rad)} ${n(yTop)} l`,
      `${n(x1 - rad + k)} ${n(yTop)} ${n(x1)} ${n(yTop - rad + k)} ${n(x1)} ${n(yTop - rad)} c`,
      `${n(x1)} ${n(yBot + rad)} l`,
      `${n(x1)} ${n(yBot + rad - k)} ${n(x1 - rad + k)} ${n(yBot)} ${n(x1 - rad)} ${n(yBot)} c`,
      `${n(x0 + rad)} ${n(yBot)} l`,
      `${n(x0 + rad - k)} ${n(yBot)} ${n(x0)} ${n(yBot + rad - k)} ${n(x0)} ${n(yBot + rad)} c`,
      `${n(x0)} ${n(yTop - rad)} l`,
      `${n(x0)} ${n(yTop - rad + k)} ${n(x0 + rad - k)} ${n(yTop)} ${n(x0 + rad)} ${n(yTop)} c`,
      'h',
    ].join('\n');
  }

  rect(x, y, w, h, opts = {}) {
    const { fill, stroke, lineWidth = 0.8, r = 0, opacity } = opts;
    this.raw('q');
    if (opacity != null) this.raw(`/${opacity} gs`);
    if (fill) this.raw(`${hexRgb(fill)} rg`);
    if (stroke) {
      this.raw(`${hexRgb(stroke)} RG`);
      this.raw(`${n(lineWidth)} w`);
    }
    this.raw(this._roundedPath(x, y, w, h, r));
    if (fill && stroke) this.raw('B');
    else if (fill) this.raw('f');
    else if (stroke) this.raw('S');
    this.raw('Q');
  }

  circle(cx, cy, r, opts = {}) {
    const { fill, stroke, lineWidth = 1.2 } = opts;
    const py = this.py(cy);
    const k = r * 0.55228475;
    this.raw('q');
    if (fill) this.raw(`${hexRgb(fill)} rg`);
    if (stroke) {
      this.raw(`${hexRgb(stroke)} RG`);
      this.raw(`${n(lineWidth)} w`);
    }
    this.raw([
      `${n(cx)} ${n(py + r)} m`,
      `${n(cx + k)} ${n(py + r)} ${n(cx + r)} ${n(py + k)} ${n(cx + r)} ${n(py)} c`,
      `${n(cx + r)} ${n(py - k)} ${n(cx + k)} ${n(py - r)} ${n(cx)} ${n(py - r)} c`,
      `${n(cx - k)} ${n(py - r)} ${n(cx - r)} ${n(py - k)} ${n(cx - r)} ${n(py)} c`,
      `${n(cx - r)} ${n(py + k)} ${n(cx - k)} ${n(py + r)} ${n(cx)} ${n(py + r)} c`,
      'h',
    ].join('\n'));
    if (fill && stroke) this.raw('B');
    else if (fill) this.raw('f');
    else if (stroke) this.raw('S');
    this.raw('Q');
  }

  line(x1, y1, x2, y2, opts = {}) {
    const { stroke = C.border, lineWidth = 0.8, dash, cap = 1 } = opts;
    this.raw('q');
    this.raw(`${hexRgb(stroke)} RG ${n(lineWidth)} w ${cap} J`);
    if (dash) this.raw(`[${dash}] 0 d`);
    this.raw(`${n(x1)} ${n(this.py(y1))} m ${n(x2)} ${n(this.py(y2))} l S`);
    this.raw('Q');
  }

  polyline(pts, opts = {}) {
    if (!pts || pts.length < 2) return;
    const { stroke = C.blue, lineWidth = 1.6, close = false, fill } = opts;
    this.raw('q');
    if (fill) this.raw(`${hexRgb(fill)} rg`);
    if (stroke) this.raw(`${hexRgb(stroke)} RG ${n(lineWidth)} w 1 J 1 j`);
    const parts = pts.map((p, i) => `${n(p[0])} ${n(this.py(p[1]))} ${i === 0 ? 'm' : 'l'}`);
    if (close) parts.push('h');
    this.raw(parts.join('\n'));
    if (fill && stroke) this.raw('B');
    else if (fill) this.raw('f');
    else if (stroke) this.raw('S');
    this.raw('Q');
  }

  text(str, x, y, opts = {}) {
    const { font = 'F1', size = 9, color = C.ink, align = 'left', maxW } = opts;
    const clean = maxW ? truncateText(str, maxW, font, size) : sanitizePdfText(str);
    if (!clean) return 0;
    const w = measureText(clean, font, size);
    let tx = x;
    if (align === 'right') tx = x - w;
    else if (align === 'center') tx = x - w / 2;
    const ty = this.py(y + size * 0.78);
    this.raw(`q ${hexRgb(color)} rg BT /${font} ${n(size)} Tf 1 0 0 1 ${n(tx)} ${n(ty)} Tm (${encodeWinAnsi(clean)}) Tj ET Q`);
    return w;
  }

  drawWrapped(str, x, y, maxW, opts = {}) {
    const { font = 'F1', size = 8.5, color = C.ink2, lineH = size * 1.38, maxLines = 6 } = opts;
    const lines = wrapLines(str, maxW, font, size, maxLines);
    lines.forEach((ln, i) => {
      this.text(ln, x, y + i * lineH, { font, size, color });
    });
    return lines.length * lineH;
  }

  drawImageCover(imgName, imgW, imgH, x, y, w, h, r = 8) {
    if (!imgName) return;
    const boxRatio = w / h;
    const imgRatio = imgW / imgH;
    let drawW = w, drawH = h, dx = x, dy = y;
    if (imgRatio > boxRatio) {
      drawH = h;
      drawW = h * imgRatio;
      dx = x - (drawW - w) / 2;
    } else {
      drawW = w;
      drawH = w / imgRatio;
      dy = y - (drawH - h) / 2;
    }
    this.raw('q');
    this.raw(this._roundedPath(x, y, w, h, r) + ' W n');
    this.raw(`${n(drawW)} 0 0 ${n(drawH)} ${n(dx)} ${n(this.py(dy + drawH))} cm /${imgName} Do`);
    this.raw('Q');
  }

  drawCheckmark(cx, cy, size, color = C.white, lineWidth = 1.4) {
    this.polyline([
      [cx - size * 0.36, cy + size * 0.02],
      [cx - size * 0.08, cy + size * 0.30],
      [cx + size * 0.38, cy - size * 0.26],
    ], { stroke: color, lineWidth });
  }

  drawPill(text, x, y, opts = {}) {
    const { tone = 'good', align = 'left', icon = true, size = 7.5, padX = 7, h = 15 } = opts;
    const map = {
      good: { bg: C.greenPill, fg: C.greenDark, dot: C.green },
      warn: { bg: C.amberPill, fg: C.amberDark, dot: C.amber },
      bad: { bg: C.redPill, fg: C.redDark, dot: C.red },
      info: { bg: C.bluePill, fg: C.blueDark, dot: C.blue },
      neutral: { bg: C.neutralPill, fg: C.ink2, dot: C.muted },
    };
    const st = map[tone] || map.neutral;
    const iconW = icon ? 10 : 0;
    const tw = measureText(text, 'F2', size);
    const w = padX * 2 + iconW + tw;
    const rx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.rect(rx, y, w, h, { fill: st.bg, r: h / 2 });
    if (icon) {
      const icx = rx + padX + 3.8;
      const icy = y + h / 2;
      if (tone === 'good') {
        this.circle(icx, icy, 4.1, { fill: st.dot });
        this.drawCheckmark(icx, icy, 6.2, C.white, 1.15);
      } else if (tone === 'warn' || tone === 'bad') {
        this.circle(icx, icy, 4.1, { fill: st.dot });
        this.text('!', icx, icy - 3.6, { font: 'F2', size: 6.8, color: C.white, align: 'center' });
      } else {
        this.circle(icx, icy, 4.1, { fill: st.dot });
        this.line(icx - 2, icy, icx + 2, icy, { stroke: C.white, lineWidth: 1.1 });
      }
    }
    this.text(text, rx + padX + iconW, y + (h - size) / 2 - 0.3, { font: 'F2', size, color: st.fg });
    return w;
  }

  toBuffer() {
    const objects = [];
    const addObj = (body) => {
      objects.push(body);
      return objects.length;
    };

    const catalogId = addObj(null); // 1
    const pagesId = addObj(null);   // 2
    const f1Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const f3Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
    const f4Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    const gs50Id = addObj('<< /Type /ExtGState /ca 0.50 /CA 0.50 >>');
    const gs18Id = addObj('<< /Type /ExtGState /ca 0.18 /CA 0.18 >>');

    const imgEntries = [];
    for (const img of this.images) {
      const cs = img.components === 1 ? '/DeviceGray' : '/DeviceRGB';
      const dict = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent ${img.bits || 8} /Filter /DCTDecode /Length ${img.data.length} >>`;
      const imgId = addObj({ dict, stream: img.data });
      imgEntries.push(`/${img.name} ${imgId} 0 R`);
    }

    const resDict =
      `<< /Font << /F1 ${f1Id} 0 R /F2 ${f2Id} 0 R /F3 ${f3Id} 0 R /F4 ${f4Id} 0 R >>` +
      ` /ExtGState << /GS50 ${gs50Id} 0 R /GS18 ${gs18Id} 0 R >>` +
      (imgEntries.length ? ` /XObject << ${imgEntries.join(' ')} >>` : '') +
      ' >>';

    const pageIds = [];
    for (const ops of this.pages) {
      const contentBytes = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const contentId = addObj({
        dict: `<< /Filter /FlateDecode /Length ${contentBytes.length} >>`,
        stream: contentBytes,
      });
      const pageId = addObj(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resDict} /Contents ${contentId} 0 R >>`
      );
      pageIds.push(pageId);
    }

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
    const offsets = [0];
    let bytePos = chunks[0].length;

    for (let i = 0; i < objects.length; i++) {
      offsets.push(bytePos);
      const objNum = i + 1;
      const body = objects[i];
      if (typeof body === 'string') {
        const part = Buffer.from(`${objNum} 0 obj\n${body}\nendobj\n`, 'latin1');
        chunks.push(part);
        bytePos += part.length;
      } else {
        const head = Buffer.from(`${objNum} 0 obj\n${body.dict}\nstream\n`, 'latin1');
        const tail = Buffer.from('\nendstream\nendobj\n', 'latin1');
        chunks.push(head, body.stream, tail);
        bytePos += head.length + body.stream.length + tail.length;
      }
    }

    const xrefStart = bytePos;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
function fmtLongDate(s) {
  const p = parseIso(s);
  return p ? `${MONTHS_LONG[p.m - 1]} ${p.d}, ${p.y}` : (s || 'Recorded');
}
function fmtShortMonth(s) {
  const p = parseIso(s);
  return p ? `${MONTHS_SHORT[p.m - 1]} ${p.y}` : (s || '');
}
function fmtMmDdYyyy(s) {
  const p = parseIso(s);
  return p ? `${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}/${p.y}` : (s || '-');
}
function fmtNum(v) {
  if (v == null || isNaN(v)) return '-';
  return Math.round(Number(v)).toLocaleString('en-CA');
}
function simplifyBody(b) {
  const s = String(b || '').toLowerCase();
  if (s.includes('sport utility') || s.includes('suv') || s.includes('multipurpose')) return 'SUV 4 DR';
  if (s.includes('sedan') || s.includes('saloon')) return 'SEDAN 4 DR';
  if (s.includes('pickup') || s.includes('truck')) return 'PICKUP TRUCK';
  if (s.includes('minivan') || s.includes('van')) return 'MINIVAN';
  if (s.includes('coupe')) return 'COUPE 2 DR';
  return (b || 'VEHICLE').toUpperCase();
}
function formatZonesText(zones) {
  if (!zones || !zones.length) return 'impact area unspecified';
  const map = {
    front: 'front', left_front: 'left front', right_front: 'right front',
    left_side: 'left side', right_side: 'right side', side: 'side panels',
    left_rear: 'left rear', right_rear: 'right rear', rear: 'rear',
    roof: 'roof / top', undercarriage: 'undercarriage', all_over: 'all exterior panels',
  };
  const uniq = [...new Set(zones.map((z) => map[z] || String(z).replace(/_/g, ' ')))];
  if (uniq.length === 1) return uniq[0];
  if (uniq.length === 2) return `${uniq[0]} and ${uniq[1]}`;
  return `${uniq.slice(0, -1).join(', ')}, and ${uniq[uniq.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Contoured Top-Down Vehicle Blueprint Vector Renderer (exact SVG geometry)
// ---------------------------------------------------------------------------
function drawContouredBlueprint(pdf, boxX, boxY, boxW, boxH, bodyClass, zones) {
  pdf.rect(boxX, boxY, boxW, boxH, { fill: C.softSlate, stroke: C.border, lineWidth: 0.7, r: 10 });
  const scale = Math.min((boxW - 8) / 220, (boxH - 8) / 288);
  const ox = boxX + (boxW - 220 * scale) / 2;
  const oy = boxY + (boxH - 288 * scale) / 2;
  const sx = (vx) => ox + vx * scale;
  const sy = (vy) => oy + vy * scale;
  const py = (vy) => pdf.py(sy(vy));

  const zList = Array.isArray(zones) ? zones : [];
  const all = zList.includes('all_over');
  const has = (z) => all || zList.includes(z);
  const act = {
    front: has('front'), left_front: has('left_front'), right_front: has('right_front'),
    left_side: has('left_side') || zList.includes('side'),
    right_side: has('right_side') || zList.includes('side'),
    left_rear: has('left_rear'), right_rear: has('right_rear'), rear: has('rear'),
    roof: has('roof'), undercarriage: zList.includes('undercarriage'),
  };

  // Directional labels
  pdf.text('FRONT', sx(110), sy(13), { font: 'F2', size: 6.2, color: C.muted, align: 'center' });
  pdf.text('REAR', sx(110), sy(271), { font: 'F2', size: 6.2, color: C.muted, align: 'center' });
  pdf.text('LEFT', sx(25), sy(144), { font: 'F2', size: 5.8, color: C.muted, align: 'center' });
  pdf.text('RIGHT', sx(195), sy(144), { font: 'F2', size: 5.8, color: C.muted, align: 'center' });

  // Tucked dark wheels
  pdf.rect(sx(60.5), sy(64), 6 * scale, 28 * scale, { fill: C.ink2, r: 2.5 * scale });
  pdf.rect(sx(153.5), sy(64), 6 * scale, 28 * scale, { fill: C.ink2, r: 2.5 * scale });
  pdf.rect(sx(60.5), sy(196), 6 * scale, 28 * scale, { fill: C.ink2, r: 2.5 * scale });
  pdf.rect(sx(153.5), sy(196), 6 * scale, 28 * scale, { fill: C.ink2, r: 2.5 * scale });

  // Side mirrors
  pdf.polyline([[sx(64), sy(102)], [sx(52), sy(105)], [sx(52), sy(109)], [sx(64), sy(108)]], { fill: '#E8EEF7', stroke: '#1E293B', lineWidth: 0.9, close: true });
  pdf.polyline([[sx(156), sy(102)], [sx(168), sy(105)], [sx(168), sy(109)], [sx(156), sy(108)]], { fill: '#E8EEF7', stroke: '#1E293B', lineWidth: 0.9, close: true });

  const carBodyPath = () => [
    `${n(sx(84))} ${n(py(37))} m`,
    `${n(sx(96))} ${n(py(34))} ${n(sx(124))} ${n(py(34))} ${n(sx(136))} ${n(py(37))} c`,
    `${n(sx(149))} ${n(py(40))} ${n(sx(156))} ${n(py(49))} ${n(sx(156))} ${n(py(64))} c`,
    `${n(sx(156))} ${n(py(226))} l`,
    `${n(sx(156))} ${n(py(241))} ${n(sx(149))} ${n(py(249))} ${n(sx(136))} ${n(py(252))} c`,
    `${n(sx(124))} ${n(py(255))} ${n(sx(96))} ${n(py(255))} ${n(sx(84))} ${n(py(252))} c`,
    `${n(sx(71))} ${n(py(249))} ${n(sx(64))} ${n(py(241))} ${n(sx(64))} ${n(py(226))} c`,
    `${n(sx(64))} ${n(py(64))} l`,
    `${n(sx(64))} ${n(py(49))} ${n(sx(71))} ${n(py(40))} ${n(sx(84))} ${n(py(37))} c`,
    'h',
  ].join('\n');

  // Base body fill
  pdf.raw(`q ${hexRgb('#E8EEF7')} rg\n${carBodyPath()}\nf Q`);

  // Clipped red impact panels
  pdf.raw(`q\n${carBodyPath()} W n`);
  const fillPanel = (pts) => pdf.polyline(pts.map(([px, ppy]) => [sx(px), sy(ppy)]), { fill: C.redBright, stroke: '#1E293B', lineWidth: 0.85, close: true });
  if (act.left_front) fillPanel([[64, 34], [86, 34], [83, 102], [64, 102]]);
  if (act.right_front) fillPanel([[134, 34], [156, 34], [156, 102], [137, 102]]);
  if (act.front) fillPanel([[74, 34], [146, 34], [138, 64], [110, 60], [82, 64]]);
  if (act.left_side) {
    fillPanel([[64, 102], [83, 102], [83, 192], [64, 192]]);
    pdf.line(sx(64), sy(147), sx(83), sy(147), { stroke: '#1E293B', lineWidth: 0.7 });
  }
  if (act.right_side) {
    fillPanel([[137, 102], [156, 102], [156, 192], [137, 192]]);
    pdf.line(sx(137), sy(147), sx(156), sy(147), { stroke: '#1E293B', lineWidth: 0.7 });
  }
  if (act.left_rear) fillPanel([[64, 192], [83, 192], [86, 256], [64, 256]]);
  if (act.right_rear) fillPanel([[137, 192], [156, 192], [156, 256], [134, 256]]);
  if (act.rear) fillPanel([[82, 224], [110, 228], [138, 224], [146, 256], [74, 256]]);
  if (act.undercarriage) {
    pdf.line(sx(94), sy(74), sx(94), sy(214), { stroke: C.redBright, lineWidth: 1.5, dash: '4 3' });
    pdf.line(sx(126), sy(74), sx(126), sy(214), { stroke: C.redBright, lineWidth: 1.5, dash: '4 3' });
  }
  pdf.raw('Q');

  // Windshield + Roof + Rear glass
  const b = String(bodyClass || '').toLowerCase();
  const isSuv = b.includes('suv') || b.includes('utility') || b.includes('minivan');
  pdf.polyline([[sx(78), sy(96)], [sx(110), sy(89)], [sx(142), sy(96)], [sx(136), sy(114)], [sx(110), sy(110)], [sx(84), sy(114)]], { fill: '#CBD5E1', stroke: '#1E293B', lineWidth: 0.85, close: true });
  pdf.rect(sx(84), sy(114), 52 * scale, (isSuv ? 78 : 62) * scale, { fill: act.roof ? C.redBright : '#F1F5F9', stroke: '#1E293B', lineWidth: 0.85, r: 4 * scale });
  if (isSuv) {
    pdf.polyline([[sx(85), sy(192)], [sx(79), sy(215)], [sx(110), sy(220)], [sx(141), sy(215)], [sx(135), sy(192)]], { fill: '#CBD5E1', stroke: '#1E293B', lineWidth: 0.85, close: true });
  } else {
    pdf.polyline([[sx(84), sy(176)], [sx(110), sy(180)], [sx(136), sy(176)], [sx(142), sy(204)], [sx(110), sy(210)], [sx(78), sy(204)]], { fill: '#CBD5E1', stroke: '#1E293B', lineWidth: 0.85, close: true });
  }
  // Pillar seams & outer silhouette stroke
  pdf.line(sx(83), sy(102), sx(83), sy(192), { stroke: '#1E293B', lineWidth: 0.65 });
  pdf.line(sx(137), sy(102), sx(137), sy(192), { stroke: '#1E293B', lineWidth: 0.65 });
  pdf.line(sx(78), sy(96), sx(84), sy(114), { stroke: '#1E293B', lineWidth: 0.7 });
  pdf.line(sx(142), sy(96), sx(136), sy(114), { stroke: '#1E293B', lineWidth: 0.7 });
  pdf.raw(`q ${hexRgb('#1E293B')} RG 1.05 w 1 j\n${carBodyPath()}\nS Q`);
}

// ---------------------------------------------------------------------------
// Category Icon Badge Vector Drawing (for KPI Tiles & Detailed History Rows)
// ---------------------------------------------------------------------------
function drawBadgeIcon(pdf, x, y, size, kind) {
  const styles = {
    damage: { bg: C.redPill, fg: C.red },
    warn: { bg: C.amberPill, fg: C.amber },
    service: { bg: C.greenPill, fg: C.green },
    inspection: { bg: C.emeraldPill, fg: C.emerald },
    auction: { bg: C.purplePill, fg: C.purple },
    listing: { bg: C.purplePill, fg: C.purple },
    owners: { bg: C.bluePill, fg: C.blue },
    title: { bg: C.bluePill, fg: C.blue },
    records: { bg: C.bluePill, fg: C.blue },
  };
  const st = styles[kind] || styles.title;
  pdf.rect(x, y, size, size, { fill: st.bg, r: 5 });
  const cx = x + size / 2;
  const cy = y + size / 2;
  if (kind === 'damage' || kind === 'warn') {
    pdf.text('!', cx, cy - 4.2, { font: 'F2', size: size * 0.54, color: st.fg, align: 'center' });
  } else if (kind === 'inspection') {
    pdf.drawCheckmark(cx, cy, size * 0.62, st.fg, 1.5);
  } else if (kind === 'service') {
    // Clean wrench silhouette
    pdf.line(cx - 3.2, cy + 3.2, cx + 1.8, cy - 1.8, { stroke: st.fg, lineWidth: 1.6 });
    pdf.circle(cx + 2.4, cy - 2.4, 2.3, { stroke: st.fg, lineWidth: 1.2 });
  } else if (kind === 'owners') {
    pdf.circle(cx, cy - 2.4, 2.3, { stroke: st.fg, lineWidth: 1.2 });
    pdf.polyline([[cx - 4.2, cy + 4.2], [cx - 3.2, cy + 1.6], [cx + 3.2, cy + 1.6], [cx + 4.2, cy + 4.2]], { stroke: st.fg, lineWidth: 1.2 });
  } else if (kind === 'auction' || kind === 'listing') {
    pdf.rect(cx - 3.6, cy - 3.2, 7.2, 6.4, { stroke: st.fg, lineWidth: 1.2, r: 1.4 });
  } else {
    // Document / list lines
    pdf.line(cx - 3.5, cy - 2.6, cx + 3.5, cy - 2.6, { stroke: st.fg, lineWidth: 1.2 });
    pdf.line(cx - 3.5, cy, cx + 3.5, cy, { stroke: st.fg, lineWidth: 1.2 });
    pdf.line(cx - 3.5, cy + 2.6, cx + 2.0, cy + 2.6, { stroke: st.fg, lineWidth: 1.2 });
  }
}

// ---------------------------------------------------------------------------
// Main Dossier PDF Orchestrator
// ---------------------------------------------------------------------------
async function generateDriveePdfBuffer(report, opts = {}) {
  const unit = opts.unit === 'mi' ? 'mi' : 'km';
  const pdf = new PdfBuilder();
  const reportDate = fmtMmDdYyyy((report.generatedAt || new Date().toISOString()).slice(0, 10));
  const vin = String(report.vin || '').toUpperCase();
  const owners = Array.isArray(report.owners) ? report.owners : [];
  const readings = Array.isArray(report.odometerReadings) ? report.odometerReadings : [];
  const incidents = Array.isArray(report.incidents) ? report.incidents : [];
  const recalls = Array.isArray(report.recalls) ? report.recalls : [];
  const events = Array.isArray(report.events) ? report.events : [];
  const chronoEvents = events.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const brandFlags = report.brandFlags || {};
  const kpis = report.kpis || {};
  const valCad = report.valuationCad || { lowCad: 0, highCad: 0, midCad: 0, dealerTradeLowCad: 0, dealerTradeHighCad: 0 };

  // Fetch vehicle hero JPEG (if present) for native /DCTDecode embedding
  const heroPhotoObj = Array.isArray(report.photos) && report.photos[0] ? report.photos[0] : null;
  const heroJpeg = heroPhotoObj ? await fetchHeroJpeg(heroPhotoObj.url) : null;
  const heroImgName = heroJpeg ? pdf.registerImage(heroJpeg) : null;

  const drawRunningChrome = (pageNum) => {
    // Top-left Drivee Shield + Brand
    pdf.rect(MARGIN_L, 20, 20, 20, { fill: C.blue, r: 5.5 });
    pdf.drawCheckmark(MARGIN_L + 10, 30, 12, C.white, 1.6);
    pdf.text('Drivee', MARGIN_L + 26, 20.5, { font: 'F2', size: 12.5, color: C.ink });
    pdf.text('VEHICLE HISTORY REPORT', MARGIN_L + 26, 33, { font: 'F2', size: 6.8, color: C.blue });

    // Top-right VIN | page N + Report Date
    pdf.text(`VIN  ${vin}   |   page ${pageNum}`, PAGE_W - MARGIN_R, 21.5, { font: 'F3', size: 8, color: C.ink, align: 'right' });
    pdf.text(`Report date ${reportDate}`, PAGE_W - MARGIN_R, 32.5, { font: 'F1', size: 7.5, color: C.muted, align: 'right' });
    pdf.line(MARGIN_L, 48, PAGE_W - MARGIN_R, 48, { stroke: C.border, lineWidth: 0.75 });

    // Bottom running footer
    pdf.line(MARGIN_L, 756, PAGE_W - MARGIN_R, 756, { stroke: C.border, lineWidth: 0.7 });
    pdf.text('drivee.ca', MARGIN_L, 763, { font: 'F2', size: 8, color: C.blue });
    pdf.text(
      `History data source: Canadian & North American Vehicle Registries, NHTSA & Transport Canada, as of ${reportDate}. Analysis by Drivee.`,
      PAGE_W - MARGIN_R,
      763.5,
      { font: 'F1', size: 6.8, color: C.muted, align: 'right' }
    );
  };

  const startNewPage = () => {
    const pNum = pdf.addPage();
    drawRunningChrome(pNum);
    return BODY_TOP_Y;
  };

  // =========================================================================
  // PAGE 1: Hero + Quick Verdict + 2x2 KPIs + Ownership Timeline + Odometer
  // =========================================================================
  let y = startNewPage();

  const lastOdoVal = unit === 'km' ? kpis.lastOdometerKm : kpis.lastOdometerMi;
  const lastOdoDate = readings.length ? fmtShortMonth(readings[readings.length - 1].date) : '';
  const eyebrow = [report.year, simplifyBody(report.bodyClass)].filter(Boolean).join(' · ');
  const makeHead = report.make || (report.vehicleTitle || '').split(/\s+/)[1] || 'Vehicle';
  const modelSub = [report.model, report.trim].filter(Boolean).join(' ') || '';

  const specPills = [];
  if (report.engineSummary && report.engineSummary !== 'Standard') specPills.push(report.engineSummary);
  if (report.fuelType) specPills.push(report.fuelType);
  if (report.driveType && report.driveType !== 'Standard') specPills.push(report.driveType);
  if (report.lastProvince) specPills.push(`Last owned in ${report.lastProvince}`);
  if (valCad.midCad) specPills.push(`Est. $${fmtNum(valCad.midCad)} CAD`);

  // 1. Hero Banner
  const heroH = 122;
  if (heroImgName && heroJpeg) {
    pdf.rect(MARGIN_L, y, CONTENT_W, heroH, { fill: C.heroSky, stroke: C.borderBlue, lineWidth: 0.8, r: 12 });
    const leftX = MARGIN_L + 16;
    pdf.text(eyebrow, leftX, y + 14, { font: 'F2', size: 8, color: C.blue });
    const makeW = pdf.text(makeHead, leftX, y + 26, { font: 'F2', size: 19, color: C.ink });
    if (modelSub) pdf.text(modelSub, leftX + makeW + 5, y + 26, { font: 'F1', size: 19, color: C.ink2, maxW: 328 - makeW });

    // Spec pills (wrapping cleanly within left 336pt)
    let px = leftX, py = y + 52;
    for (const pill of specPills) {
      const pw = measureText(pill, 'F2', 7.4) + 12;
      if (px + pw > leftX + 332) { px = leftX; py += 18; }
      pdf.rect(px, py, pw, 14.5, { fill: C.white, stroke: '#DCE7F8', lineWidth: 0.5, r: 5 });
      pdf.text(pill, px + 6, py + 3.6, { font: 'F2', size: 7.4, color: C.ink });
      px += pw + 5;
    }

    const odoText = lastOdoVal ? `${fmtNum(lastOdoVal)} ${unit}` : `$${fmtNum(valCad.midCad)} CAD`;
    const odoSub = lastOdoVal
      ? `last reported odometer${lastOdoDate ? ` · ${lastOdoDate}` : ''}`
      : 'estimated Canadian private market value';
    const odoW = pdf.text(odoText, leftX, y + 92, { font: 'F2', size: 17.5, color: C.ink });
    pdf.text(odoSub, leftX + odoW + 8, y + 99, { font: 'F1', size: 8, color: C.muted });

    // Right framed photo
    const imgBoxX = MARGIN_L + CONTENT_W - 186;
    const imgBoxY = y + 10;
    pdf.rect(imgBoxX, imgBoxY, 174, 96, { fill: C.white, stroke: C.white, lineWidth: 1, r: 9 });
    pdf.drawImageCover(heroImgName, heroJpeg.width, heroJpeg.height, imgBoxX + 3, imgBoxY + 3, 168, 90, 7);
    if (heroPhotoObj && heroPhotoObj.caption) {
      pdf.text(heroPhotoObj.caption, MARGIN_L + CONTENT_W - 12, y + 109.5, {
        font: 'F1', size: 6.2, color: C.muted, align: 'right', maxW: 210,
      });
    }
  } else {
    pdf.rect(MARGIN_L, y, CONTENT_W, heroH, { fill: C.heroNavy, r: 12 });
    const leftX = MARGIN_L + 18;
    pdf.text(eyebrow, leftX, y + 16, { font: 'F2', size: 8, color: '#93C5FD' });
    const makeW = pdf.text(makeHead, leftX, y + 29, { font: 'F2', size: 20, color: C.white });
    if (modelSub) pdf.text(modelSub, leftX + makeW + 6, y + 29, { font: 'F1', size: 20, color: '#E2E8F0', maxW: 460 - makeW });
    pdf.text(specPills.join('  ·  '), leftX, y + 58, { font: 'F1', size: 8.5, color: '#CBD5E1', maxW: 510 });
    const odoText = lastOdoVal ? `${fmtNum(lastOdoVal)} ${unit}` : `$${fmtNum(valCad.midCad)} CAD`;
    const odoW = pdf.text(odoText, leftX, y + 86, { font: 'F2', size: 18, color: C.white });
    pdf.text(lastOdoVal ? `last reported odometer · ${lastOdoDate}` : 'estimated Canadian private value', leftX + odoW + 8, y + 93, { font: 'F1', size: 8.5, color: '#93C5FD' });
  }

  y += heroH + 12;

  // 2. Quick Verdict (Left) + 2x2 KPI Tiles (Right)
  const allZones = [];
  for (const inc of incidents) {
    for (const z of inc.zones || []) {
      if (!allZones.includes(z)) allZones.push(z);
    }
  }

  const takeaways = [
    {
      tone: brandFlags.cleanTitle !== false ? 'good' : 'bad',
      text: brandFlags.cleanTitle !== false
        ? 'Clean title - no salvage, rebuilt, flood, junk, or manufacturer lemon brands reported.'
        : `Title brand alert: ${brandFlags.titleBrandSummary || 'Branded'} - confirm registration eligibility.`,
    },
    incidents.length > 0
      ? {
          tone: incidents[0].severity === 'severe' ? 'bad' : 'warn',
          text: `${incidents.length} accident on record (${fmtLongDate(incidents[0].date)}${allZones.length ? `, ${formatZonesText(allZones)}` : ''}) - inspect affected panels.`,
        }
      : { tone: 'good', text: 'Zero accidents or insurance collision claims reported across North American registries.' },
  ];
  if (readings.length >= 2) {
    const fVal = unit === 'km' ? readings[0].km : readings[0].mi;
    const lVal = unit === 'km' ? readings[readings.length - 1].km : readings[readings.length - 1].mi;
    const avg = kpis.avgKmPerYear
      ? (unit === 'km' ? `~${fmtNum(kpis.avgKmPerYear)} km/yr` : `~${fmtNum(kpis.avgKmPerYear / 1.60934)} mi/yr`)
      : '';
    takeaways.push({
      tone: brandFlags.odometerRollback ? 'bad' : 'good',
      text: `${readings.length} consistent odometer readings from ${fmtNum(fVal)} to ${fmtNum(lVal)} ${unit}${avg ? `, ${avg}` : ''}.`,
    });
  }
  takeaways.push(
    recalls.length > 0
      ? { tone: 'warn', text: `${recalls.length} open NHTSA safety recalls (#${recalls[0].campaignNumber}) - authorized Canadian dealers repair free of charge.` }
      : { tone: 'good', text: 'No open NHTSA recall campaigns returned - also confirm in Transport Canada VRDB.' }
  );

  const splitH = 198;
  const vW = 290;
  pdf.rect(MARGIN_L, y, vW, splitH, { fill: C.softBlue, stroke: '#DCE4F0', lineWidth: 0.8, r: 11 });
  pdf.text('DRIVEE QUICK VERDICT', MARGIN_L + 13, y + 10, { font: 'F2', size: 7.2, color: C.blue });
  pdf.text(report.verdict ? report.verdict.headline : 'Vehicle history verified', MARGIN_L + 13, y + 20.5, { font: 'F2', size: 11.2, color: C.ink, maxW: vW - 26 });
  const sumH = pdf.drawWrapped(
    report.verdict ? report.verdict.subheadline : '',
    MARGIN_L + 13, y + 35.5, vW - 26,
    { font: 'F1', size: 7.5, color: C.ink2, lineH: 9.8, maxLines: 3 }
  );
  let ty = y + 40 + sumH;
  takeaways.forEach((t, idx) => {
    if (idx > 0) pdf.line(MARGIN_L + 13, ty - 3.5, MARGIN_L + vW - 13, ty - 3.5, { stroke: '#DCE4F0', lineWidth: 0.6 });
    const dotC = t.tone === 'bad' ? C.redBright : t.tone === 'warn' ? '#F59E0B' : C.green;
    pdf.circle(MARGIN_L + 17, ty + 3.8, 2.5, { fill: dotC });
    const hUsed = pdf.drawWrapped(t.text, MARGIN_L + 24.5, ty, vW - 38, { font: 'F1', size: 7.4, color: C.ink, lineH: 9.6, maxLines: 3 });
    ty += hUsed + 6.5;
  });

  // Right 2x2 KPI tiles
  const kpiX = MARGIN_L + vW + 12;
  const tileW = (CONTENT_W - vW - 12 - 10) / 2;
  const tileH = (splitH - 10) / 2;
  const yrMin = chronoEvents.length ? String(chronoEvents[0].date || '').slice(0, 4) : (report.year || '');
  const yrMax = chronoEvents.length ? String(chronoEvents[chronoEvents.length - 1].date || '').slice(0, 4) : '';
  const kpiList = [
    {
      kind: incidents.length ? 'warn' : 'inspection',
      val: String(kpis.accidents || 0),
      lbl: 'Accidents',
      sub: allZones.length ? `${allZones.length} impact zones` : (incidents.length ? 'See damage section' : 'No accidents reported'),
      bad: Boolean(brandFlags.structural || brandFlags.airbag),
    },
    {
      kind: 'owners',
      val: String(kpis.owners || owners.length || 1),
      lbl: 'Owners',
      sub: `${(owners[0] && owners[0].usageType) || 'Personal'} · ${report.lastProvince || 'Canada'}`,
    },
    {
      kind: 'service',
      val: String(kpis.serviceRecords || 0),
      lbl: 'Service records',
      sub: `${kpis.serviceRecords || 0} logged visits`,
    },
    {
      kind: 'records',
      val: String(events.length),
      lbl: 'Detailed records',
      sub: yrMin && yrMax && yrMin !== yrMax ? `${yrMin}-${yrMax}` : (yrMin || 'Verified'),
    },
  ];
  kpiList.forEach((k, idx) => {
    const col = idx % 2, row = Math.floor(idx / 2);
    const tx = kpiX + col * (tileW + 10);
    const ty2 = y + row * (tileH + 10);
    pdf.rect(tx, ty2, tileW, tileH, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
    drawBadgeIcon(pdf, tx + 11, ty2 + 11, 20, k.kind);
    pdf.text(k.val, tx + 11, ty2 + 37, { font: 'F2', size: 17, color: k.bad ? C.red : C.ink });
    pdf.text(k.lbl, tx + 11, ty2 + 57, { font: 'F2', size: 8.5, color: C.ink });
    pdf.text(k.sub, tx + 11, ty2 + 69, { font: 'F1', size: 7.4, color: C.muted, maxW: tileW - 22 });
  });

  y += splitH + 12;

  // 3. Ownership Timeline Card
  if (owners.length > 0) {
    const ownH = 128;
    pdf.rect(MARGIN_L, y, CONTENT_W, ownH, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
    pdf.text('Ownership timeline', MARGIN_L + 14, y + 12, { font: 'F2', size: 11.5, color: C.ink });
    pdf.drawPill(`${owners.length} owner${owners.length === 1 ? '' : 's'}`, MARGIN_L + CONTENT_W - 14, y + 10.5, { tone: 'info', align: 'right', icon: false });

    // Multi-color duration bar
    const weights = owners.map((o) => {
      if (o.firstDate && o.lastDate) return Math.max(60, (Date.parse(o.lastDate) - Date.parse(o.firstDate)) / 86400000);
      return 365;
    });
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const barX = MARGIN_L + 14, barY = y + 34, barW = CONTENT_W - 28, barH = 8.5;
    let bx = barX;
    owners.forEach((o, i) => {
      const segW = Math.max(18, (weights[i] / wSum) * (barW - (owners.length - 1) * 3));
      pdf.rect(bx, barY, segW, barH, { fill: ownerPal(o.ownerNumber).solid, r: 4.2 });
      bx += segW + 3;
    });

    // Year axis ticks
    const yStart = Number(String(owners[0].firstDate || owners[0].purchasedYear || report.year || 2020).slice(0, 4)) || 2020;
    const yEnd = Number(String(owners[owners.length - 1].lastDate || new Date().toISOString()).slice(0, 4)) || new Date().getFullYear();
    const ySpan = Math.max(1, yEnd - yStart);
    for (let yr = yStart; yr <= yEnd; yr++) {
      const rx = barX + ((yr - yStart) / ySpan) * barW;
      const align = yr === yStart ? 'left' : yr === yEnd ? 'right' : 'center';
      pdf.text(String(yr), rx, barY + 12.5, { font: 'F4', size: 7, color: C.muted, align });
    }

    // Left-accented Owner Summary Cards
    const showOwners = owners.slice(0, 4);
    const gap = 8;
    const cardW = (barW - gap * (showOwners.length - 1)) / showOwners.length;
    const cardY = y + 60, cardH = 56;
    showOwners.forEach((o, i) => {
      const cx = barX + i * (cardW + gap);
      const pal = ownerPal(o.ownerNumber);
      pdf.rect(cx, cardY, cardW, cardH, { fill: C.softSlate, stroke: C.border, lineWidth: 0.7, r: 7 });
      pdf.rect(cx, cardY + 1, 3.2, cardH - 2, { fill: pal.solid, r: 1.5 });
      pdf.text(o.label || `Owner ${o.ownerNumber}`, cx + 10, cardY + 8, { font: 'F2', size: 8.8, color: C.ink });
      pdf.text(`${o.usageType || 'Personal'} | ${o.province || report.lastProvince || 'Canada'}`, cx + 10, cardY + 20, { font: 'F1', size: 7.4, color: C.ink2, maxW: cardW - 16 });
      const pace = o.kmPerYear
        ? (unit === 'km' ? `${fmtNum(o.kmPerYear)} km/yr` : `${fmtNum(o.miPerYear || Math.round(o.kmPerYear / 1.60934))} mi/yr`)
        : '';
      pdf.text(`${o.durationLabel || o.period || 'Recorded'}${pace ? ` | ${pace}` : ''}`, cx + 10, cardY + 33, { font: 'F2', size: 7.8, color: C.ink, maxW: cardW - 16 });
      const spanTxt = o.firstDate && o.lastDate ? `${fmtShortMonth(o.firstDate)} to ${fmtShortMonth(o.lastDate)}` : (o.period || '');
      pdf.text(spanTxt, cx + 10, cardY + 44, { font: 'F1', size: 7, color: C.muted, maxW: cardW - 16 });
    });

    y += ownH + 12;
  }

  // 4. Odometer History Chart Card (Owner-Shaded)
  if (readings.length > 0) {
    const odoH = Math.min(198, MAX_BODY_Y - y);
    pdf.rect(MARGIN_L, y, CONTENT_W, odoH, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
    pdf.text('Odometer history', MARGIN_L + 14, y + 12, { font: 'F2', size: 11.5, color: C.ink });
    pdf.drawPill(
      brandFlags.odometerRollback ? 'Rollback flagged' : `${fmtNum(lastOdoVal)} ${unit} last reading`,
      MARGIN_L + CONTENT_W - 14,
      y + 10.5,
      { tone: brandFlags.odometerRollback ? 'bad' : 'good', align: 'right', icon: true }
    );

    const chartX = MARGIN_L + 14, chartY = y + 32, chartW = CONTENT_W - 28, chartH = odoH - 86;
    pdf.rect(chartX, chartY, chartW, chartH, { fill: '#FCFDFE', stroke: C.border, lineWidth: 0.6, r: 8 });

    const pL = chartX + 38, pR = chartX + chartW - 16, pT = chartY + 18, pB = chartY + chartH - 20;
    const plotW = pR - pL, plotH = pB - pT;

    const pts = readings.map((rd, i) => ({
      date: rd.date,
      val: Number((unit === 'km' ? rd.km : rd.mi) || 0),
      t: Date.parse(rd.date) || i,
      on: rd.ownerNumber || 1,
      bad: Boolean(rd.flaggedRollback),
    }));
    const tMin = pts[0].t, tMax = pts[pts.length - 1].t, tSpan = Math.max(1, tMax - tMin);
    const maxV = Math.max(20000, ...pts.map((p) => p.val));
    const step = unit === 'km' ? 40000 : 25000;
    const yCeil = Math.ceil(maxV / step) * step;

    const coords = pts.map((p, i) => {
      const rx = pts.length <= 1 ? 0.5 : (0.65 * ((p.t - tMin) / tSpan) + 0.35 * (i / (pts.length - 1)));
      return { x: pL + rx * plotW, y: pB - (p.val / yCeil) * plotH, p };
    });

    // Shaded owner bands
    const bands = [];
    for (const c of coords) {
      const last = bands[bands.length - 1];
      if (!last || last.on !== c.p.on) bands.push({ on: c.p.on, sx: c.x, ex: c.x });
      else last.ex = c.x;
    }
    bands.forEach((b, bi) => {
      const x1 = bi === 0 ? pL : (bands[bi - 1].ex + b.sx) / 2;
      const x2 = bi === bands.length - 1 ? pR : (b.ex + bands[bi + 1].sx) / 2;
      const bw = Math.max(10, x2 - x1);
      const pal = ownerPal(b.on);
      pdf.rect(x1, pT, bw, plotH, { fill: pal.band, opacity: 'GS50' });
      if (bw >= 34) {
        pdf.text(`Owner ${b.on}`, x1 + bw / 2, pT - 11, { font: 'F2', size: 7, color: pal.text, align: 'center' });
      }
    });

    // Y Gridlines
    [0, 0.33, 0.67, 1].forEach((st) => {
      const gy = pB - st * plotH;
      const lbl = Math.round((st * yCeil) / 1000);
      pdf.line(pL, gy, pR, gy, { stroke: C.border, lineWidth: 0.6, dash: st === 0 ? null : '3 3' });
      pdf.text(lbl === 0 ? '0' : `${lbl}k`, pL - 6, gy - 3.5, { font: 'F4', size: 6.8, color: C.muted, align: 'right' });
    });

    // Segments + Circles + X Date Labels
    for (let i = 1; i < coords.length; i++) {
      pdf.line(coords[i - 1].x, coords[i - 1].y, coords[i].x, coords[i].y, {
        stroke: coords[i].p.bad ? C.redBright : C.blue,
        lineWidth: 1.8,
        dash: coords[i].p.bad ? '4 3' : null,
      });
    }
    let lastLblX = -999;
    coords.forEach((c, i) => {
      pdf.circle(c.x, c.y, 2.7, {
        fill: c.p.bad ? C.redBright : C.white,
        stroke: c.p.bad ? C.redDark : C.blue,
        lineWidth: 1.4,
      });
      const showLbl = i === 0 || i === coords.length - 1 || (c.x - lastLblX >= 52 && coords[coords.length - 1].x - c.x >= 44);
      if (showLbl) {
        lastLblX = c.x;
        pdf.text(String(c.p.date || '').slice(0, 7), c.x, pB + 5.5, { font: 'F4', size: 6.8, color: C.muted, align: 'center' });
      }
    });

    // 4-Stat Footer
    const stY = chartY + chartH + 10;
    const avgYr = kpis.avgKmPerYear
      ? (unit === 'km' ? `~${fmtNum(kpis.avgKmPerYear)} km/yr` : `~${fmtNum(kpis.avgKmPerYear / 1.60934)} mi/yr`)
      : 'Normal pace';
    const rbCnt = pts.filter((p) => p.bad).length;
    const longest = owners[0] ? (owners[0].durationLabel || owners[0].period || 'Recorded') : 'Recorded';
    const oStats = [
      { v: avgYr, l: 'average since new', col: C.ink },
      { v: String(readings.length), l: 'odometer readings', col: C.ink },
      { v: String(rbCnt), l: 'rollback signs', col: rbCnt ? C.red : C.greenDark },
      { v: longest, l: 'longest single ownership', col: C.ink },
    ];
    const colW = chartW / 4;
    oStats.forEach((st, idx) => {
      const sx = chartX + idx * colW;
      pdf.text(st.v, sx, stY, { font: 'F2', size: 11.5, color: st.col });
      pdf.text(st.l, sx, stY + 15, { font: 'F1', size: 7.2, color: C.muted });
    });
  }

  // =========================================================================
  // PAGE 2: Accident & Damage + Open Recalls | Condition Matrix | Service Strip
  // =========================================================================
  y = startNewPage();

  const topH = 270;
  const hasRecalls = recalls.length > 0;
  const colCardW = hasRecalls ? 322 : CONTENT_W;

  // Left: Accident & Damage Card
  pdf.rect(MARGIN_L, y, colCardW, topH, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
  pdf.text('Accident & damage', MARGIN_L + 14, y + 12, { font: 'F2', size: 11.5, color: C.ink });
  pdf.drawPill(
    incidents.length ? `${incidents.length} event${incidents.length === 1 ? '' : 's'}` : '0 events',
    MARGIN_L + colCardW - 14,
    y + 10.5,
    { tone: incidents.length ? 'bad' : 'good', align: 'right', icon: false }
  );

  const actInc = incidents[0] || null;
  const bpX = MARGIN_L + 12, bpY = y + 34, bpW = 124, bpH = 198;
  drawContouredBlueprint(pdf, bpX, bpY, bpW, bpH, report.bodyClass, actInc ? (actInc.zones || []) : []);

  const detX = bpX + bpW + 12;
  const detW = colCardW - (detX - MARGIN_L) - 12;
  if (actInc) {
    pdf.text(`Event 1${actInc.ownerNumber ? ` | Owner ${actInc.ownerNumber}` : ''}`, detX, y + 36, { font: 'F2', size: 7.5, color: C.muted });
    pdf.text(fmtLongDate(actInc.date), detX, y + 48, { font: 'F2', size: 13.5, color: C.ink });
    const sevStr = actInc.severity && actInc.severity !== 'unspecified'
      ? ` (${actInc.severity.charAt(0).toUpperCase() + actInc.severity.slice(1)} severity)`
      : '';
    const cleanHead = String(actInc.headline || 'Damage reported').replace(/:\s*(minor|moderate|severe)\s+damage$/i, '');
    pdf.text(`${cleanHead}${sevStr}`, detX, y + 66, { font: 'F2', size: 8.5, color: C.red, maxW: detW });

    pdf.rect(detX, y + 81, 8, 8, { fill: C.redBright, r: 2 });
    const zText = actInc.zones && actInc.zones.length ? `Damage to ${formatZonesText(actInc.zones)}` : cleanHead;
    pdf.text(zText, detX + 12, y + 81.5, { font: 'F2', size: 8.2, color: C.ink, maxW: detW - 12 });
    pdf.text(`Source: ${actInc.sourceLabel || 'Police / Insurer damage report'}`, detX, y + 94, { font: 'F1', size: 7.4, color: C.muted, maxW: detW });

    // Blue-accented inspection note
    const noteY = y + 108, noteH = 58;
    pdf.rect(detX, noteY, detW, noteH, { fill: C.softBlue, r: 6 });
    pdf.rect(detX, noteY, 2.5, noteH, { fill: C.blue, r: 1 });
    pdf.drawWrapped(
      `Have a body shop or pre-purchase mechanic inspect ${actInc.zones && actInc.zones.length ? formatZonesText(actInc.zones) : 'repaired exterior'} panels, panel gaps, paint depth, and alignment.`,
      detX + 8, noteY + 6.5, detW - 14,
      { font: 'F1', size: 7.3, color: C.ink2, lineH: 9.8, maxLines: 5 }
    );

    // 3 status pills
    const pillsY = y + 175;
    const sPills = [
      { tone: actInc.airbagDeployed ? 'bad' : 'good', txt: actInc.airbagDeployed ? 'Deployed' : 'No issues', lbl: 'Airbags' },
      { tone: actInc.structural ? 'bad' : 'good', txt: actInc.structural ? 'Flagged' : 'No issues', lbl: 'Structural' },
      { tone: brandFlags.totalLoss ? 'bad' : 'good', txt: brandFlags.totalLoss ? 'Reported' : 'No issues', lbl: 'Total loss' },
    ];
    sPills.forEach((sp, si) => {
      const sy = pillsY + si * 20;
      const pw = pdf.drawPill(sp.txt, detX, sy, { tone: sp.tone, icon: true, size: 7.2, h: 14.5, padX: 6 });
      pdf.text(sp.lbl, detX + pw + 8, sy + 3.5, { font: 'F1', size: 8, color: C.ink2 });
    });
  } else {
    pdf.rect(detX, y + 38, detW, 64, { fill: '#F0FDF4', stroke: '#BBF7D0', lineWidth: 0.7, r: 8 });
    pdf.text('No accidents or damage reported', detX + 10, y + 48, { font: 'F2', size: 9.5, color: C.greenDark });
    pdf.drawWrapped(
      'Police crash registries, salvage auctions, and North American insurance damage databases returned zero reported collisions for this VIN.',
      detX + 10, y + 63, detW - 20, { font: 'F1', size: 7.6, color: C.ink2, lineH: 10.5, maxLines: 3 }
    );
    ['Airbags', 'Structural', 'Total loss'].forEach((lbl, si) => {
      const sy = y + 118 + si * 21;
      const pw = pdf.drawPill('No issues', detX, sy, { tone: 'good', icon: true, size: 7.2, h: 14.5, padX: 6 });
      pdf.text(lbl, detX + pw + 8, sy + 3.5, { font: 'F1', size: 8, color: C.ink2 });
    });
  }

  // Right: Open Recalls Card
  if (hasRecalls) {
    const recX = MARGIN_L + colCardW + 12;
    const recW = CONTENT_W - colCardW - 12;
    pdf.rect(recX, y, recW, topH, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
    pdf.text('Open recalls', recX + 12, y + 12, { font: 'F2', size: 11.5, color: C.ink });
    pdf.drawPill(`${recalls.length} active`, recX + recW - 12, y + 10.5, { tone: 'warn', align: 'right', icon: true });

    let ry = y + 34;
    const showRecalls = recalls.slice(0, 2);
    for (const rc of showRecalls) {
      const rCardH = 88;
      pdf.rect(recX + 10, ry, recW - 20, rCardH, { fill: C.amberBg, stroke: C.amberBorder, lineWidth: 0.7, r: 8 });
      pdf.circle(recX + 21, ry + 13, 5.2, { fill: C.amber });
      pdf.text('!', recX + 21, ry + 9.2, { font: 'F2', size: 7.5, color: C.white, align: 'center' });
      if (rc.reportDate) pdf.text(rc.reportDate, recX + 31, ry + 8, { font: 'F2', size: 6.8, color: C.amberDark });
      pdf.text(rc.component || 'Safety Recall', recX + 31, ry + 18, { font: 'F2', size: 7.8, color: C.ink, maxW: recW - 48 });
      pdf.drawWrapped(rc.summary || '', recX + 31, ry + 29, recW - 48, { font: 'F1', size: 6.9, color: C.ink2, lineH: 9.5, maxLines: 4 });
      pdf.text(`Campaign #${rc.campaignNumber}`, recX + 31, ry + rCardH - 13, { font: 'F3', size: 6.8, color: C.amberDark });
      ry += rCardH + 8;
    }

    const extra = Math.max(0, recalls.length - showRecalls.length);
    const footY = y + topH - 44;
    pdf.rect(recX + 10, footY, recW - 20, 35, { fill: C.softBlue, r: 6 });
    pdf.rect(recX + 10, footY, 2.5, 35, { fill: C.blue, r: 1 });
    pdf.drawWrapped(
      `${extra > 0 ? `+${extra} additional open recalls on file. ` : ''}Recall repairs are free at any authorized Canadian ${makeHead} dealer.`,
      recX + 18, footY + 5, recW - 30,
      { font: 'F1', size: 7.1, color: C.ink2, lineH: 9.5, maxLines: 3 }
    );
  }

  y += topH + 12;

  // Middle: Condition & Title Checks Matrix (9 standardized rows by owner)
  const mCols = owners.length > 0
    ? owners.slice(0, 4).map((o) => ({ num: o.ownerNumber, hdr: `OWNER ${o.ownerNumber}` }))
    : [{ num: 1, hdr: 'STATUS' }];
  const mRows = [
    { l: 'Total loss', s: 'No total loss reported', fn: () => brandFlags.totalLoss ? { t: 'bad', x: 'Reported' } : { t: 'good', x: 'No issues' } },
    { l: 'Structural damage', s: 'Frame or unibody structural alert', fn: () => brandFlags.structural ? { t: 'bad', x: 'Reported' } : { t: 'good', x: 'No issues' } },
    { l: 'Airbag deployment', s: 'No airbag deployment reported', fn: () => brandFlags.airbag ? { t: 'bad', x: 'Deployed' } : { t: 'good', x: 'No issues' } },
    { l: 'Odometer check', s: brandFlags.odometerRollback ? 'Odometer anomaly detected' : 'No sign of a rollback', fn: () => brandFlags.odometerRollback ? { t: 'bad', x: 'Flagged' } : { t: 'good', x: 'No issues' } },
    {
      l: 'Accident / damage',
      s: incidents.length ? `${incidents.length} accident / damage event on record` : 'Zero accidents reported',
      fn: (col) => {
        const hit = incidents.some((inc) => !inc.ownerNumber || inc.ownerNumber === col.num);
        return hit ? { t: 'warn', x: 'Accident reported' } : { t: 'good', x: col.num > 1 && incidents.length ? 'No new issues' : 'No issues' };
      },
    },
    {
      l: 'Manufacturer recall',
      s: recalls.length ? 'At least 1 recall - book free repair at a dealer' : 'No open campaigns',
      fn: (col, ci) => recalls.length
        ? (ci === mCols.length - 1 ? { t: 'warn', x: 'Ask your dealer' } : { t: 'neutral', x: 'Check recalls' })
        : { t: 'good', x: 'No issues' },
    },
    { l: 'Theft / stolen status', s: 'CPIC & North American stolen vehicle registry', fn: () => brandFlags.theft ? { t: 'bad', x: 'Alert' } : { t: 'good', x: 'Clean' } },
    { l: 'Title: damage brands', s: 'Salvage, Junk, Rebuilt, Fire, Flood, Hail, Lemon', fn: () => (brandFlags.salvage || brandFlags.rebuilt || brandFlags.flood) ? { t: 'bad', x: brandFlags.titleBrandSummary } : { t: 'good', x: 'Clean' } },
    { l: 'Title: odometer brands', s: 'Not Actual Mileage, Exceeds Mechanical Limits', fn: () => brandFlags.odometerRollback ? { t: 'bad', x: 'Flagged' } : { t: 'good', x: 'Clean' } },
  ];

  const matH = 44 + mRows.length * 24.5;
  pdf.rect(MARGIN_L, y, CONTENT_W, matH, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
  pdf.text('Condition & title checks', MARGIN_L + 14, y + 11, { font: 'F2', size: 11.5, color: C.ink });
  pdf.text(owners.length ? 'by owner' : 'summary', MARGIN_L + CONTENT_W - 14, y + 13.5, { font: 'F1', size: 8, color: C.muted, align: 'right' });

  const lblW = 240;
  const cW = (CONTENT_W - 28 - lblW) / mCols.length;
  const hdrY = y + 30;
  mCols.forEach((col, ci) => {
    pdf.text(col.hdr, MARGIN_L + 14 + lblW + ci * cW + cW / 2, hdrY, { font: 'F2', size: 7.2, color: C.muted, align: 'center' });
  });
  pdf.line(MARGIN_L + 14, hdrY + 11, MARGIN_L + CONTENT_W - 14, hdrY + 11, { stroke: C.border, lineWidth: 0.6 });

  mRows.forEach((row, ri) => {
    const ry2 = hdrY + 15 + ri * 24.5;
    if (ri > 0) pdf.line(MARGIN_L + 14, ry2 - 3.5, MARGIN_L + CONTENT_W - 14, ry2 - 3.5, { stroke: '#F1F5F9', lineWidth: 0.6 });
    pdf.text(row.l, MARGIN_L + 14, ry2, { font: 'F2', size: 8.2, color: C.ink });
    pdf.text(row.s, MARGIN_L + 14, ry2 + 10, { font: 'F1', size: 6.9, color: C.muted, maxW: lblW - 8 });
    mCols.forEach((col, ci) => {
      const res = row.fn(col, ci);
      pdf.drawPill(res.x, MARGIN_L + 14 + lblW + ci * cW + cW / 2, ry2 + 2, { tone: res.t, align: 'center', icon: true, size: 7, h: 14, padX: 6 });
    });
  });

  y += matH + 12;

  // Bottom of Page 2: Service Snapshot Strip (6 emerald-top cards)
  const svcEvents = chronoEvents.filter((e) => e.category === 'service');
  if (svcEvents.length > 0 && y + 98 <= MAX_BODY_Y) {
    const snapH = 98;
    pdf.rect(MARGIN_L, y, CONTENT_W, snapH, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
    pdf.text('Service snapshot', MARGIN_L + 14, y + 11, { font: 'F2', size: 11.5, color: C.ink });
    pdf.drawPill(`${kpis.serviceRecords || svcEvents.length} service visits`, MARGIN_L + CONTENT_W - 14, y + 9.5, { tone: 'good', align: 'right', icon: false });

    const latest6 = svcEvents.slice(-6);
    const sg = 7;
    const scW = (CONTENT_W - 28 - sg * 5) / 6;
    const scY = y + 32, scH = 54;
    latest6.forEach((ev, idx) => {
      const sx = MARGIN_L + 14 + idx * (scW + sg);
      pdf.rect(sx, scY, scW, scH, { fill: C.softSlate, stroke: C.border, lineWidth: 0.6, r: 6 });
      pdf.rect(sx + 0.5, scY, scW - 1, 2.8, { fill: C.green, r: 1.4 });
      pdf.text(String(ev.date || '').slice(0, 4), sx + 7, scY + 7.5, { font: 'F2', size: 8.5, color: C.ink });
      pdf.text(`${ev.location || ev.source || 'Service'}`, sx + 7, scY + 20, { font: 'F1', size: 6.8, color: C.ink2, maxW: scW - 14 });
      const odo = unit === 'km' ? ev.km : ev.mi;
      pdf.text(odo ? `${fmtNum(odo)} ${unit}` : 'Mileage unlogged', sx + 7, scY + 39, { font: 'F2', size: 7.2, color: C.greenDark, maxW: scW - 14 });
    });
  }

  // =========================================================================
  // PAGES 3..N: Complete Owner-Grouped Detailed History + Checklist + Glossary
  // =========================================================================
  y = startNewPage();

  // Detailed History Header + Legend
  pdf.text('Detailed history', MARGIN_L, y, { font: 'F2', size: 13.5, color: C.ink });
  pdf.drawPill(`${events.length} event${events.length === 1 ? '' : 's'}`, MARGIN_L + 112, y - 0.5, { tone: 'info', icon: false, size: 7.5, h: 15 });

  const legend = [
    { col: C.blue, lbl: 'Registration' },
    { col: C.green, lbl: 'Service' },
    { col: C.emerald, lbl: 'Inspection' },
    { col: C.redBright, lbl: 'Accident / Alert' },
    { col: C.purple, lbl: 'Sale / Auction' },
  ];
  let lx = PAGE_W - MARGIN_R;
  for (let li = legend.length - 1; li >= 0; li--) {
    const it = legend[li];
    const lw = measureText(it.lbl, 'F1', 7.2);
    lx -= lw;
    pdf.text(it.lbl, lx, y + 3.5, { font: 'F1', size: 7.2, color: C.ink2 });
    lx -= 9;
    pdf.rect(lx, y + 4, 6.2, 6.2, { fill: it.col, r: 1.5 });
    lx -= 10;
  }
  y += 24;

  // Group chronologically by owner
  const ownerGroups = [];
  for (const ev of chronoEvents) {
    const on = ev.ownerNumber || 1;
    let grp = ownerGroups.find((g) => g.ownerNumber === on);
    if (!grp) {
      grp = { ownerNumber: on, rows: [] };
      ownerGroups.push(grp);
    }
    grp.rows.push(ev);
  }

  const drawOwnerHeader = (on, continued = false) => {
    const oMeta = owners.find((o) => o.ownerNumber === on) || {};
    const pal = ownerPal(on);
    const sub = [oMeta.usageType || 'Personal', oMeta.province || report.lastProvince || 'Canada', oMeta.purchasedYear ? `purchased ${oMeta.purchasedYear}` : ''].filter(Boolean).join(' · ');
    const pace = oMeta.kmPerYear
      ? (unit === 'km' ? `${fmtNum(oMeta.kmPerYear)} km/yr` : `${fmtNum(oMeta.miPerYear || Math.round(oMeta.kmPerYear / 1.60934))} mi/yr`)
      : '';
    pdf.rect(MARGIN_L, y, CONTENT_W, 22, { fill: C.softBlue, r: 7 });
    pdf.circle(MARGIN_L + 15, y + 11, 7.2, { fill: pal.solid });
    pdf.text(String(on), MARGIN_L + 15, y + 7.2, { font: 'F2', size: 8, color: C.white, align: 'center' });
    const titleStr = `Owner ${on}${continued ? ' (continued)' : ''}`;
    const tw = pdf.text(titleStr, MARGIN_L + 28, y + 6.5, { font: 'F2', size: 8.8, color: C.ink });
    pdf.text(sub, MARGIN_L + 36 + tw, y + 7, { font: 'F1', size: 7.8, color: C.muted });
    if (pace) pdf.text(pace, MARGIN_L + CONTENT_W - 10, y + 7, { font: 'F3', size: 7.8, color: C.ink2, align: 'right' });
    y += 28;
  };

  for (const grp of ownerGroups) {
    if (y + 62 > MAX_BODY_Y) y = startNewPage();
    drawOwnerHeader(grp.ownerNumber, false);

    for (let ri = 0; ri < grp.rows.length; ri++) {
      const ev = grp.rows[ri];
      const chips = Array.isArray(ev.pills) && ev.pills.length ? ev.pills : (ev.detail ? [ev.detail] : []);

      // Pre-layout pill chips to measure exact row height
      const chipStartX = MARGIN_L + 108;
      const chipMaxW = CONTENT_W - 116;
      const chipLines = [];
      let curLine = [], curLineW = 0;
      for (const rawChip of chips.slice(0, 8)) {
        const txt = truncateText(rawChip, chipMaxW - 14, 'F1', 6.9);
        const cw = measureText(txt, 'F1', 6.9) + 12;
        if (curLine.length && curLineW + 4 + cw > chipMaxW) {
          chipLines.push(curLine);
          curLine = [{ txt, cw }];
          curLineW = cw;
        } else {
          curLine.push({ txt, cw });
          curLineW += (curLine.length > 1 ? 4 : 0) + cw;
        }
      }
      if (curLine.length) chipLines.push(curLine);

      const rowH = 29 + chipLines.length * 16 + (chipLines.length ? 4 : 0);
      if (y + rowH > MAX_BODY_Y) {
        y = startNewPage();
        drawOwnerHeader(grp.ownerNumber, true);
      }

      if (ev.category === 'damage') {
        pdf.rect(MARGIN_L, y - 3, CONTENT_W, rowH + 2, { fill: C.redBg, r: 7 });
      } else if (ri > 0) {
        pdf.line(MARGIN_L + 4, y - 3, MARGIN_L + CONTENT_W - 4, y - 3, { stroke: '#F1F5F9', lineWidth: 0.65 });
      }

      // Col 1: Date + km/mi
      pdf.text(fmtMmDdYyyy(ev.date), MARGIN_L + 6, y + 3, { font: 'F3', size: 7.8, color: C.ink });
      const odo = unit === 'km' ? ev.km : ev.mi;
      pdf.text(odo ? `${fmtNum(odo)} ${unit}` : '-', MARGIN_L + 6, y + 14.5, { font: 'F3', size: 7.4, color: odo ? C.blue : C.light });

      // Col 2: Category Icon Badge
      const iconKind =
        ev.category === 'damage' ? 'damage'
        : ev.category === 'auction' || ev.category === 'listing' ? 'auction'
        : ev.category === 'service' ? (/inspect|emissions|safety|pre-delivery/i.test(ev.detail || '') ? 'inspection' : 'service')
        : 'title';
      drawBadgeIcon(pdf, MARGIN_L + 78, y + 3, 18, iconKind);

      // Col 3: Headline + Location + Rounded Pill Chips
      pdf.text(ev.headline || ev.source || 'Registry event', chipStartX, y + 2.5, { font: 'F2', size: 8.6, color: C.ink, maxW: chipMaxW });
      pdf.text(ev.location || ev.source || '', chipStartX, y + 14, { font: 'F1', size: 7.3, color: C.muted, maxW: chipMaxW });

      let cy = y + 25.5;
      for (const ln of chipLines) {
        let cx = chipStartX;
        for (const chip of ln) {
          pdf.rect(cx, cy, chip.cw, 13, { fill: ev.category === 'damage' ? '#FEE2E2' : C.neutralPill, r: 4 });
          pdf.text(chip.txt, cx + 6, cy + 3.1, { font: 'F1', size: 6.9, color: ev.category === 'damage' ? C.redDark : C.ink2 });
          cx += chip.cw + 4;
        }
        cy += 16;
      }

      y += rowH + 6;
    }
    y += 4;
  }

  // =========================================================================
  // FINAL SECTION: Before You Buy Checklist (6 Items) + Glossary + Signatures
  // =========================================================================
  const checklistH = 186;
  if (y + checklistH > MAX_BODY_Y) y = startNewPage();

  pdf.rect(MARGIN_L, y, CONTENT_W, checklistH, { fill: '#F4F8FF', stroke: '#DBEAFE', lineWidth: 0.8, r: 12 });
  pdf.text('Before you buy: Drivee Canadian checklist', MARGIN_L + 16, y + 12, { font: 'F2', size: 11.5, color: C.ink });
  pdf.text(`EST. MARKET $${fmtNum(valCad.lowCad)}-$${fmtNum(valCad.highCad)} CAD`, MARGIN_L + CONTENT_W - 16, y + 14.5, { font: 'F3', size: 7.4, color: C.blue, align: 'right' });

  const chkItems = [
    {
      t: allZones.length ? `Inspect ${formatZonesText(allZones)} repairs` : 'Inspect Canadian salt-belt rust zones',
      b: allZones.length
        ? 'Check paint thickness readings, fender bolts, radiator support, and 4-wheel alignment before buying.'
        : 'Inspect rear wheel arches, rocker pinch welds, brake lines, and subframe mounts for winter salt corrosion.',
    },
    {
      t: 'Cross-check dash mileage vs wear',
      b: `Confirm the cluster matches the ${lastOdoVal ? `${fmtNum(lastOdoVal)} ${unit}` : 'reported'} trail and aligns with pedal & seat wear.`,
    },
    {
      t: recalls.length ? `Book free dealer recall #${recalls[0].campaignNumber}` : 'Verify Transport Canada VRDB recalls',
      b: recalls.length
        ? `Any authorized Canadian ${makeHead} dealer completes all ${recalls.length} open safety recalls at $0 parts & labour.`
        : 'Double-check live Transport Canada recall campaigns prior to provincial safety certification.',
    },
    {
      t: 'Confirm Ontario UVIP & PPSA lien clearance',
      b: 'Request the official ServiceOntario UVIP (or provincial PPSA search) to verify zero active bank liens.',
    },
    {
      t: 'Match seller photo ID to ownership',
      b: 'Confirm legal owner name and VIN on the provincial ownership permit match government ID with no curbstoning.',
    },
    {
      t: 'Book a pre-purchase mobile inspection',
      b: 'Pair this dossier with a Drivee GTA Mobile Mechanic lift & OBD-II scan (drivee.ca/mechanic.html).',
    },
  ];
  const chkColW = (CONTENT_W - 44) / 2;
  chkItems.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const ix = MARGIN_L + 16 + col * (chkColW + 12);
    const iy = y + 36 + row * 47;
    pdf.circle(ix + 6, iy + 6, 6.2, { fill: C.blue });
    pdf.text(String(i + 1), ix + 6, iy + 2.5, { font: 'F2', size: 7.5, color: C.white, align: 'center' });
    pdf.text(it.t, ix + 18, iy + 0.5, { font: 'F2', size: 8.1, color: C.ink, maxW: chkColW - 20 });
    pdf.drawWrapped(it.b, ix + 18, iy + 11.5, chkColW - 20, { font: 'F1', size: 7.1, color: C.ink2, lineH: 9.5, maxLines: 3 });
  });

  y += checklistH + 14;

  // Glossary + About + Signature Sign-Off
  const glossBlockH = 205;
  if (y + glossBlockH > MAX_BODY_Y) y = startNewPage();

  pdf.rect(MARGIN_L, y, CONTENT_W, 96, { fill: C.white, stroke: C.border, lineWidth: 0.8, r: 11 });
  pdf.text('Glossary', MARGIN_L + 14, y + 11, { font: 'F2', size: 11, color: C.ink });
  const gloss = [
    { t: 'Accident indicator', b: 'A crash report filed with police, provincial registries, or insurers. Damage severity and repair quality always require a physical inspection.' },
    { t: 'Title brands', b: 'Permanent provincial/state designations (Salvage, Rebuilt, Flood, Lemon, Junk) carried on the title after severe loss or insurer write-off.' },
    { t: 'Odometer rollback / conflict', b: 'An inspection, registration, or auction odometer entry that drops below a previously recorded higher reading or flags mileage inconsistency.' },
  ];
  const gw = (CONTENT_W - 28 - 16) / 3;
  gloss.forEach((g, i) => {
    const gx = MARGIN_L + 14 + i * (gw + 8);
    pdf.rect(gx, y + 30, gw, 56, { fill: C.softSlate, r: 7 });
    pdf.text(g.t, gx + 8, y + 36, { font: 'F2', size: 8, color: C.ink });
    pdf.drawWrapped(g.b, gx + 8, y + 47, gw - 16, { font: 'F1', size: 6.9, color: C.ink2, lineH: 9.2, maxLines: 4 });
  });

  y += 108;
  pdf.rect(MARGIN_L, y, CONTENT_W, 46, { fill: C.softSlate, r: 8 });
  pdf.text('About this report', MARGIN_L + 12, y + 7, { font: 'F2', size: 8, color: C.ink });
  pdf.drawWrapped(
    `This report compiles vehicle history events reported to Canadian & North American vehicle registries, NHTSA safety recalls, and insurer/auction archives as of ${reportDate}. Independent vehicle history report by Drivee Technologies Inc. (not affiliated with CARFAX, ServiceOntario, MTO, or Transport Canada).`,
    MARGIN_L + 12, y + 17.5, CONTENT_W - 24, { font: 'F1', size: 6.9, color: C.muted, lineH: 9.4, maxLines: 3 }
  );

  // Customer & Seller Signature Lines
  y += 68;
  const sigLines = [
    { x: MARGIN_L, w: 165, lbl: 'Customer signature' },
    { x: MARGIN_L + 180, w: 74, lbl: 'Date' },
    { x: MARGIN_L + 286, w: 165, lbl: 'Seller / Dealer signature' },
    { x: MARGIN_L + 466, w: 82, lbl: 'Date' },
  ];
  sigLines.forEach((sl) => {
    pdf.line(sl.x, y, sl.x + sl.w, y, { stroke: '#CBD5E1', lineWidth: 0.8 });
    pdf.text(sl.lbl, sl.x, y + 5, { font: 'F1', size: 7.5, color: C.muted });
  });

  return pdf.toBuffer();
}

module.exports = {
  generateDriveePdfBuffer,
  isAllowedHeroPhotoUrl,
};
