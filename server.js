// Quote Ledger — tiny server for self-hosting.
// Serves public/index.html and proxies Claude calls so your API key never reaches the browser.
// No dependencies: needs Node 18+ (built-in fetch).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const PASSCODE = process.env.DEMO_PASSCODE || '';           // optional: require ?key=... to use the AI features
const LIMIT = parseInt(process.env.RATE_LIMIT_PER_HOUR || '60', 10); // AI calls per visitor IP per hour
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '8000', 10);
// Optional alternative: Hugging Face Inference Providers (OpenAI-compatible router). Used when HF_TOKEN is set and ANTHROPIC_API_KEY is not.
const HF_TOKEN = process.env.HF_TOKEN || '';
const HF_MODEL = process.env.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct';
const HF_VISION = process.env.HF_VISION === '1';      // set to 1 only if HF_MODEL accepts images (e.g. a "-VL" model)
const HF_MAX_TOKENS = parseInt(process.env.HF_MAX_TOKENS || '4000', 10);
const PROVIDER = API_KEY ? 'anthropic' : HF_TOKEN ? 'huggingface' : 'none';
const ACTIVE_MODEL = PROVIDER === 'huggingface' ? HF_MODEL : MODEL;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};

const hits = new Map();
function limited(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  h.push(now); hits.set(ip, h); return h.length > LIMIT;
}
function send(res, code, obj) { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(obj)); }
function extractJSON(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}

async function claude(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 25e6) req.destroy(); });
  req.on('end', async () => {
    try {
      if (PROVIDER === 'none') return send(res, 503, {code: 'not_configured', error: 'Set ANTHROPIC_API_KEY or HF_TOKEN on the server.'});
      if (PASSCODE && req.headers['x-demo-key'] !== PASSCODE) return send(res, 401, {code: 'not_granted', error: 'This demo needs a passcode. Open the link with ?key=<passcode>.'});
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, {code: 'rate_limited', error: 'Too many requests — try again later.'});
      const {input, images, wantJson} = JSON.parse(body || '{}');
      const content = [];
      for (const im of images || []) if (im && im.data) content.push({type: 'image', source: {type: 'base64', media_type: im.mediaType || 'image/jpeg', data: im.data}});
      const messages = Array.isArray(input)
        ? input.map((m, i) => ({role: m.role, content: i === input.length - 1 && content.length ? [...content, {type: 'text', text: String(m.content)}] : String(m.content)}))
        : [{role: 'user', content: [...content, {type: 'text', text: String(input || '')}]}];
      if (PROVIDER === 'huggingface') {
        const toOA = m => {
          if (typeof m.content === 'string') return {role: m.role, content: m.content};
          const parts = m.content.flatMap(b => b.type === 'text' ? [{type: 'text', text: b.text}] : HF_VISION ? [{type: 'image_url', image_url: {url: 'data:' + b.source.media_type + ';base64,' + b.source.data}}] : []);
          return {role: m.role, content: HF_VISION ? parts : parts.map(x => x.text).join('\n')};
        };
        const sys = wantJson ? [{role: 'system', content: 'Reply with a single valid JSON object only. No prose, no markdown fences.'}] : [];
        const hr = await fetch((process.env.HF_BASE_URL || 'https://router.huggingface.co') + '/v1/chat/completions', {
          method: 'POST',
          headers: {'authorization': 'Bearer ' + HF_TOKEN, 'content-type': 'application/json'},
          body: JSON.stringify({model: HF_MODEL, messages: [...sys, ...messages.map(toOA)], max_tokens: HF_MAX_TOKENS, temperature: 0.2}),
        });
        const hj = await hr.json().catch(() => ({}));
        if (!hr.ok) {
          const msg = (hj.error && (hj.error.message || hj.error)) || 'Hugging Face error ' + hr.status;
          if (hr.status === 402) return send(res, 429, {code: 'rate_limited', error: 'Hugging Face free monthly credits are used up. Add credit on huggingface.co or wait for next month.'});
          return send(res, hr.status === 429 ? 429 : 502, {code: hr.status === 429 ? 'rate_limited' : 'upstream_error', error: String(msg)});
        }
        const text = (hj.choices && hj.choices[0] && hj.choices[0].message && hj.choices[0].message.content) || '';
        const out = {text, truncated: hj.choices && hj.choices[0] && hj.choices[0].finish_reason === 'length'};
        if (wantJson) { out.json = extractJSON(text); if (!out.json) return send(res, 502, {code: 'bad_json', error: 'The model did not return valid JSON. Try again, or use a larger model.'}); }
        return send(res, 200, out);
      }
      const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
        method: 'POST',
        headers: {'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
        body: JSON.stringify({model: MODEL, max_tokens: MAX_TOKENS, messages}),
      });
      const j = await r.json();
      if (!r.ok) return send(res, r.status === 429 ? 429 : 502, {code: r.status === 429 ? 'rate_limited' : 'upstream_error', error: (j.error && j.error.message) || 'Claude API error ' + r.status});
      const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const out = {text, truncated: j.stop_reason === 'max_tokens'};
      if (wantJson) { out.json = extractJSON(text); if (!out.json) return send(res, 502, {code: 'bad_json', error: 'Claude did not return valid JSON. Try again.'}); }
      send(res, 200, out);
    } catch (e) { send(res, 500, {code: 'server_error', error: String(e && e.message || e)}); }
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, PROVIDER !== 'none' ? 200 : 503, {ok: PROVIDER !== 'none', provider: PROVIDER, passcode: !!PASSCODE, model: ACTIVE_MODEL, images: PROVIDER === 'anthropic' || HF_VISION});
  if (req.method === 'POST' && url.pathname === '/api/claude') return claude(req, res);
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'});
    res.end(data);
  });
}).listen(PORT, () => console.log(`Quote Ledger running on port ${PORT} · provider ${PROVIDER} · model ${ACTIVE_MODEL} · AI ${PROVIDER !== 'none' ? 'enabled' : 'DISABLED (set ANTHROPIC_API_KEY or HF_TOKEN)'}${PASSCODE ? ' · passcode required' : ''}`));
