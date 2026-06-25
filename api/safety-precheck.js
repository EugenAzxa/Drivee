// Safety PreCheck — vision-LLM endpoint for the Ontario Safety Standards
// Certificate pre-inspection feature. Mirrors /api/claude.js style (CORS,
// origin allowlist, env-var key) but locks the system prompt server-side
// so callers can't override the inspector persona, and forces the response
// into a strict JSON schema so the client never has to parse free-form text.

var ALLOWED_AREAS = [
  'tires', 'rust', 'lights', 'windshield', 'dashboard',
  'brakes', 'exhaust', 'odometer', 'interior', 'engine', 'body'
];

var ALLOWED_ORIGINS = [
  'https://drivee.ca',
  'https://www.drivee.ca',
  'http://localhost',
  'http://127.0.0.1'
];

var MODEL      = 'claude-sonnet-4-6';
var MAX_TOKENS = 700;

var SYSTEM_PROMPT =
  'You are an Ontario vehicle safety pre-inspector. Assess only what is ' +
  'visible in the photo for the named area. Be conservative — if unclear, ' +
  'return "unknown" and set image_quality_ok=false with a retake_reason. ' +
  'Never claim to replace a licensed inspection. Return only the JSON ' +
  'schema provided, with no surrounding prose, no markdown code fences, ' +
  'and no commentary.';

// Per-area prompt fragment describing what a pass / caution / fail looks like.
// Kept here so future tuning lives server-side rather than in the client.
var AREA_GUIDANCE = {
  tires:     'Look at tread depth, sidewall damage, uneven wear, bulges, cracks. Ontario SSC fails tires below 1.5mm tread on a passenger vehicle.',
  rust:      'Look for perforating rust on rocker panels, frame, suspension mounts, brake/fuel lines. Surface rust = caution; rust-through holes near structural mounts = fail.',
  lights:    'Verify headlights, signals, brake lights, plate light look intact and lit if photographed at night. Cracked or missing lenses = fail.',
  windshield: 'Look for cracks, chips, pitting, and obstructions in the driver\'s primary sight line. A crack longer than ~30cm or any damage in the driver wiper sweep = fail.',
  dashboard: 'Identify any illuminated warning lights (engine, ABS, airbag, brake, TPMS). Active airbag/brake/SRS lights = fail. Engine light = caution unless confirmed.',
  brakes:    'Inspect pad thickness through the wheel, rotor condition, hose/line corrosion. Rotor scoring or pads under ~3mm = caution; metal-on-metal or torn hose = fail.',
  exhaust:   'Look for rust holes, missing heat shields, disconnected joints, missing catalytic converter or muffler. Any leak before the catalytic converter = fail.',
  odometer:  'Read the displayed kilometres. Do not infer condition — just return the number in findings and set verdict=pass if a reading is legible, unknown otherwise.',
  interior:  'Check seatbelt presence + retraction, seat anchoring, dashboard integrity. Missing or non-retracting belts, unbolted seats = fail.',
  engine:    'Look for visible fluid leaks (oil, coolant, brake), damaged belts, missing battery hold-down. Active leaks at engine block or master cylinder = caution to fail.',
  body:      'Look for panel damage that could harm pedestrians (sharp edges, missing bumper covers), broken mirrors, missing fenders. Sharp protrusions = fail.'
};

function buildUserText(area) {
  var guidance = AREA_GUIDANCE[area] || '';
  return (
    'AREA: ' + area + '\n' +
    'INSPECTION GUIDANCE: ' + guidance + '\n\n' +
    'Return a single JSON object with EXACTLY this schema and no other keys:\n' +
    '{\n' +
    '  "area": "' + area + '",\n' +
    '  "verdict": "pass" | "caution" | "fail" | "unknown",\n' +
    '  "confidence": number between 0 and 1,\n' +
    '  "findings": [array of short plain-English observations],\n' +
    '  "estimated_repair_cost_cad": { "low": number, "high": number },\n' +
    '  "image_quality_ok": boolean,\n' +
    '  "retake_reason": string or null\n' +
    '}\n\n' +
    'If you cannot see the area clearly, set verdict="unknown", ' +
    'image_quality_ok=false, and provide a one-sentence retake_reason. ' +
    'Cost estimates are in Canadian dollars; if no repair is needed use ' +
    '{"low":0,"high":0}.'
  );
}

// Lift JSON from Claude's text response. Handles bare JSON, fenced JSON,
// or JSON wrapped in commentary the model occasionally adds.
function extractJson(text) {
  if (!text) return null;
  // Strip ```json ... ``` fences if present
  var fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  var candidate = fenced ? fenced[1] : text;
  // Find first { ... last } block
  var first = candidate.indexOf('{');
  var last  = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch (e) {
    return null;
  }
}

function normaliseResult(area, raw) {
  // Clamp / type-guard everything so the client can render without if-checks.
  var allowedVerdicts = ['pass', 'caution', 'fail', 'unknown'];
  var verdict = allowedVerdicts.indexOf(raw && raw.verdict) !== -1 ? raw.verdict : 'unknown';
  var confidence = (raw && typeof raw.confidence === 'number') ? raw.confidence : 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;
  var findings = (raw && Array.isArray(raw.findings)) ? raw.findings.filter(function(f) {
    return typeof f === 'string' && f.length > 0 && f.length < 240;
  }).slice(0, 8) : [];
  var cost = (raw && raw.estimated_repair_cost_cad) || {};
  var costLow  = typeof cost.low  === 'number' && cost.low  >= 0 ? Math.round(cost.low)  : 0;
  var costHigh = typeof cost.high === 'number' && cost.high >= costLow ? Math.round(cost.high) : costLow;
  var qualityOk = raw && raw.image_quality_ok !== false;
  var retakeReason = (raw && typeof raw.retake_reason === 'string') ? raw.retake_reason : null;
  return {
    area: area,
    verdict: verdict,
    confidence: confidence,
    findings: findings,
    estimated_repair_cost_cad: { low: costLow, high: costHigh },
    image_quality_ok: !!qualityOk,
    retake_reason: retakeReason
  };
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || req.headers.referer || '';
  var allowed = ALLOWED_ORIGINS.some(function(o) { return origin.indexOf(o) === 0; });

  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on server' });

  var body = req.body || {};
  var area = (body.area || '').toString().toLowerCase();
  var imageBase64 = body.image_base64;
  var mediaType   = body.media_type || 'image/jpeg';

  if (ALLOWED_AREAS.indexOf(area) === -1) {
    return res.status(400).json({ error: 'Unknown inspection area' });
  }
  if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 200) {
    return res.status(400).json({ error: 'Missing or invalid image' });
  }
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mediaType) === -1) {
    return res.status(400).json({ error: 'Unsupported media type' });
  }

  var anthropicBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text',  text: buildUserText(area) }
      ]
    }]
  };

  try {
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    });
    var data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: (data && data.error && data.error.message) || 'Upstream error' });
    }
    var text = (data && data.content && data.content[0] && data.content[0].text) || '';
    var parsed = extractJson(text);
    if (!parsed) {
      return res.status(502).json({ error: 'Model returned unparseable output', raw: text.slice(0, 400) });
    }
    return res.status(200).json(normaliseResult(area, parsed));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach inspector' });
  }
};
