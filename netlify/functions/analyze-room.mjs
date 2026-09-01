// Netlify Function + Gemini Vision.
// Keep GEMINI_API_KEY server-side. Never put it in Shopify HTML/browser JS.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_BASE64_LENGTH = 3_600_000; // Keep request size reasonable.

const THEMES = [
  { handle: 'black-gold', name: 'Black & Gold/Copper' },
  { handle: 'black-white', name: 'Black & White/Silver' },
  { handle: 'blue-navy', name: 'Blue & Navy' },
  { handle: 'copper', name: 'Beige/Copper Gold' },
  { handle: 'brown-and-gold', name: 'Brown' },
  { handle: 'green-cushions', name: 'Green & Emerald' },
  { handle: 'yellow', name: 'Yellow & Mustard' },
  { handle: 'pink', name: 'Pink' },
  { handle: 'purple', name: 'Purple' },
  { handle: 'grey', name: 'Grey' },
  { handle: 'teal-sea-green', name: 'Teal & Sea Green' },
  { handle: 'red-burgundy', name: 'Maroon & Burgundy' },
  { handle: 'white-gold', name: 'White Gold' },
  { handle: 'tropical', name: 'Tropical & Animal Prints' }
];

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function originFor(request) {
  const origin = request.headers.get('origin');
  if (allowedOrigins.includes('*')) return '*';
  return origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || 'null';
}

function jsonResponse(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': originFor(request),
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    }
  });
}

function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI returned invalid JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export default async (request) => {
  if (request.method === 'OPTIONS') return jsonResponse({ ok: true }, 200, request);
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, request);
  if (!process.env.GEMINI_API_KEY) return jsonResponse({ error: 'GEMINI_API_KEY is not configured' }, 500, request);

  try {
    const payload = await request.json();
    const image = String(payload?.image || '');
    const mimeType = String(payload?.mimeType || '');

    if (!/^image\/(jpeg|png|webp)$/i.test(mimeType)) {
      return jsonResponse({ error: 'Please send a JPEG, PNG or WEBP image.' }, 400, request);
    }
    if (!image || image.length > MAX_BASE64_LENGTH) {
      return jsonResponse({ error: 'Image is too large. Please upload a smaller photo.' }, 413, request);
    }

    const themeText = THEMES.map(t => `${t.handle}: ${t.name}`).join('\n');
    const prompt = `You are Rizaries' visual interior shopping assistant. Analyze this room photo and return ONLY JSON.
Focus on visible room context, not tiny details. Do not invent exact products.

Return:
- room_type: one of bedroom, living room, dining room, office, hallway, outdoor, other
- style: short label
- mood: short phrase
- dominant_color: common color name
- secondary_color: common color name
- floor_color: common color name
- furniture: up to 5 visible furniture/decor categories
- recommended_collection_handles: rank up to 4 exact handles that best fit the whole room, considering colors + style + furniture
- harmony_recommendation: pick EXACTLY 2 color-harmony types from this fixed list, choosing whichever 2 genuinely suit this room's specific style, mood and furniture — not a generic default: Complementary, Analogous, Triadic, Monochromatic, Split Complementary, Tetradic, Square
- harmony_reasoning: an object with those same 2 harmony type names as keys, each mapped to one short sentence (max 18 words) explaining why it fits THIS room specifically, referencing something you actually see

Allowed collections:
${themeText}

JSON shape:
{"room_type":"","style":"","mood":"","dominant_color":"","secondary_color":"","floor_color":"","furniture":[],"recommended_collection_handles":[],"harmony_recommendation":[],"harmony_reasoning":{}}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: mimeType, data: image } }
              ]
            }],
            generationConfig: {
              temperature: 0.3,
              topP: 0.8,
              maxOutputTokens: 500,
              responseMimeType: 'application/json'
            }
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Gemini error:', response.status, JSON.stringify(raw?.error || raw));
      const status = response.status === 429 ? 429 : 502;
      return jsonResponse({ error: status === 429 ? 'AI is temporarily busy. Please try again in a moment.' : 'AI provider error' }, status, request);
    }

    const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const result = extractJson(text);
    const allowedHandles = new Set(THEMES.map(t => t.handle));

    result.recommended_collection_handles = Array.isArray(result.recommended_collection_handles)
      ? result.recommended_collection_handles.filter(h => allowedHandles.has(String(h))).slice(0, 4)
      : [];
    result.furniture = Array.isArray(result.furniture) ? result.furniture.slice(0, 5) : [];

    const allowedHarmonies = new Set(['Complementary', 'Analogous', 'Triadic', 'Monochromatic', 'Split Complementary', 'Tetradic', 'Square']);
    result.harmony_recommendation = Array.isArray(result.harmony_recommendation)
      ? result.harmony_recommendation.filter(h => allowedHarmonies.has(String(h))).slice(0, 2)
      : [];
    const reasoningIn = result.harmony_reasoning && typeof result.harmony_reasoning === 'object' ? result.harmony_reasoning : {};
    result.harmony_reasoning = {};
    for (const type of result.harmony_recommendation) {
      if (typeof reasoningIn[type] === 'string') {
        result.harmony_reasoning[type] = reasoningIn[type].slice(0, 160);
      }
    }

    return jsonResponse(result, 200, request);
  } catch (error) {
    console.error('Room analysis failed:', error?.message || error);
    if (error?.name === 'AbortError') return jsonResponse({ error: 'AI analysis timed out. Please try again.' }, 504, request);
    return jsonResponse({ error: 'Could not analyze the image.' }, 500, request);
  }
};
