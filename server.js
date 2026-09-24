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
      if (!API_KEY) return send(res, 503, {code: 'not_configured', error: 'ANTHROPIC_API_KEY is not set on the server.'});
      if (PASSCODE && req.headers['x-demo-key'] !== PASSCODE) return send(res, 401, {code: 'not_granted', error: 'This demo needs a passcode. Open the link with ?key=<passcode>.'});
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, {code: 'rate_limited', error: 'Too many requests — try again later.'});
      const {input, images, wantJson} = JSON.parse(body || '{}');
      const content = [];
      for (const im of images || []) if (im && im.data) content.push({type: 'image', source: {type: 'base64', media_type: im.mediaType || 'image/jpeg', data: im.data}});
      const messages = Array.isArray(input)
        ? input.map((m, i) => ({role: m.role, content: i === input.length - 1 && content.length ? [...content, {type: 'text', text: String(m.content)}] : String(m.content)}))
        : [{role: 'user', content: [...content, {type: 'text', text: String(input || '')}]}];
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
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, API_KEY ? 200 : 503, {ok: !!API_KEY, passcode: !!PASSCODE, model: MODEL});
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
}).listen(PORT, () => console.log(`Quote Ledger running on port ${PORT} · model ${MODEL} · AI ${API_KEY ? 'enabled' : 'DISABLED (set ANTHROPIC_API_KEY)'}${PASSCODE ? ' · passcode required' : ''}`));
