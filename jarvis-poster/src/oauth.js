// Shared helpers: loopback OAuth sign-in (PKCE) and small HTTP utilities.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

function pkce(encoding = 'base64url') {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(verifier).digest();
  // TikTok's desktop flow expects a hex digest; Google uses the standard base64url form.
  const challenge = encoding === 'hex' ? hash.toString('hex') : hash.toString('base64url');
  return { verifier, challenge };
}

function randomState() { return crypto.randomBytes(16).toString('hex'); }

function resultPage(ok, message) {
  const color = ok ? '#3ee8ff' : '#ff5c7a';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Jarvis Poster</title></head>
<body style="background:#05090f;color:#d8f6ff;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:44px;color:${color}">${ok ? '&#10003;' : '&#10007;'}</div>
<h2 style="font-weight:500">${ok ? 'Connected. You can close this tab.' : 'Sign-in failed'}</h2>
<p style="opacity:.7">${message ? String(message).replace(/[<>&"]/g, '') : 'Return to Jarvis Poster.'}</p></div></body></html>`;
}

// Starts a one-shot local server and resolves with the ?code= the provider redirects back with.
function waitForCode(state, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const servers = [];
    let done = false;
    let failures = 0;
    const finish = (err, code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      servers.forEach((s) => s.close());
      err ? reject(err) : resolve(code);
    };
    const handler = (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const ok = !error && code && url.searchParams.get('state') === state;
      const msg = error ? (url.searchParams.get('error_description') || error) : ok ? '' : 'Security check failed (state mismatch).';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(resultPage(ok, msg));
      ok ? finish(null, code) : finish(new Error(msg));
    };
    // "localhost" can resolve to IPv4 or IPv6 depending on the browser, so listen on both.
    for (const host of ['127.0.0.1', '::1']) {
      const server = http.createServer(handler);
      server.on('error', () => {
        failures += 1;
        if (failures === 2) finish(new Error(`Port ${PORT} is busy. Close the app using it and try again.`));
      });
      server.listen(PORT, host);
      servers.push(server);
    }
    const timer = setTimeout(() => finish(new Error('Sign-in timed out after 5 minutes.')), timeoutMs);
  });
}

async function readJson(res) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const e = body.error;
    const detail = (e && (e.message || e.error_description)) || body.error_description || body.message ||
      (typeof e === 'string' ? e : '') || text.slice(0, 300);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return body;
}

async function postForm(url, fields) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  return readJson(res);
}

async function readChunk(file, start, end) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    await handle.read(buf, 0, buf.length, start);
    return buf;
  } finally {
    await handle.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mimeFor(file) {
  const ext = file.toLowerCase().split('.').pop();
  return { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4', avi: 'video/x-msvideo' }[ext] || 'video/mp4';
}

module.exports = { PORT, REDIRECT_URI, pkce, randomState, waitForCode, readJson, postForm, readChunk, sleep, mimeFor };
