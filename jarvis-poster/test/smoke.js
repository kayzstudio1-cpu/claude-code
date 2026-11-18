// Runs each platform's posting flow against a mocked HTTP layer (no real accounts needed).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const oauth = require('../src/oauth');
oauth.sleep = async () => {};
require.cache[require.resolve('../src/oauth')].exports.sleep = async () => {};

const file = path.join(os.tmpdir(), 'jarvis-smoke.mp4');
const SIZE = 9 * 1024 * 1024 + 123;
fs.writeFileSync(file, Buffer.alloc(SIZE, 1));

function memStore(init) {
  const data = JSON.parse(JSON.stringify(init));
  return { get: (s) => data[s], update: (s, p) => Object.assign(data[s], p) };
}

let calls = [];
function mockFetch(routes) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url.split('?')[0]}`);
    for (const [re, fn] of routes) if (re.test(`${method} ${url}`)) return fn(url, opts);
    throw new Error(`Unexpected request ${method} ${url}`);
  };
}
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
const job = { file, size: SIZE, title: 'Test', caption: 'Hello #test', description: 'Hello #test', tags: ['test'], options: { privacy: 'public', shorts: true } };
const progress = [];
const onProgress = (pct, stage) => progress.push([pct, stage]);

(async () => {
  // YouTube: resumable upload in 8 MB chunks with a 308 in between.
  let received = 0;
  mockFetch([
    [/^POST https:\/\/www.googleapis.com\/upload/, (_u, o) => {
      const meta = JSON.parse(o.body);
      assert.ok(meta.snippet.title.includes('#Shorts'));
      return new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } });
    }],
    [/^PUT https:\/\/upload.example\/session/, (_u, o) => {
      received += o.body.length;
      if (received < SIZE) return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
      return json({ id: 'yt123', status: { privacyStatus: 'public' } });
    }]
  ]);
  const yt = await require('../src/platforms/youtube').post(job, memStore({ youtube: { accessToken: 'a', expiresAt: Date.now() + 1e6 } }), onProgress);
  assert.strictEqual(yt.id, 'yt123'); assert.strictEqual(received, SIZE);
  console.log('youtube ok', calls.length, 'requests');

  // TikTok direct post: creator info -> init -> single chunk (<64MB) -> status.
  let tkBytes = 0;
  mockFetch([
    [/creator_info/, () => json({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } })],
    [/video\/init/, (_u, o) => {
      const b = JSON.parse(o.body);
      assert.strictEqual(b.post_info.privacy_level, 'SELF_ONLY');
      assert.strictEqual(b.source_info.total_chunk_count, 1);
      return json({ data: { publish_id: 'p1', upload_url: 'https://tt.example/up' }, error: { code: 'ok' } });
    }],
    [/^PUT https:\/\/tt.example\/up/, (_u, o) => { tkBytes += o.body.length; return new Response(null, { status: 201 }); }],
    [/status\/fetch/, () => json({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } })]
  ]);
  const tt = await require('../src/platforms/tiktok').post(job, memStore({ tiktok: { accessToken: 'a', expiresAt: Date.now() + 1e6, mode: 'direct' } }), onProgress);
  assert.strictEqual(tkBytes, SIZE); assert.ok(tt.note.includes('SELF_ONLY'));
  const plan = require('../src/platforms/tiktok').chunkPlan(200 * 1024 * 1024 + 5);
  assert.deepStrictEqual(plan, { chunkSize: 10 * 1024 * 1024, count: 20 });
  console.log('tiktok ok', calls.length, 'requests');

  // Instagram: container -> rupload -> status poll -> publish -> permalink.
  let polls = 0;
  mockFetch([
    [/^POST https:\/\/graph.facebook.com\/v21.0\/42\/media\?|^POST https:\/\/graph.facebook.com\/v21.0\/42\/media$/, () => json({ id: 'c1', uri: 'https://rupload.facebook.com/ig-api-upload/v21.0/c1' })],
    [/^POST https:\/\/rupload/, (_u, o) => { assert.strictEqual(o.headers.file_size, String(SIZE)); return json({ success: true }); }],
    [/^GET https:\/\/graph.facebook.com\/v21.0\/c1/, () => json({ status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' })],
    [/media_publish/, () => json({ id: 'm9' })],
    [/^GET https:\/\/graph.facebook.com\/v21.0\/m9/, () => json({ permalink: 'https://instagram.com/reel/x' })]
  ]);
  const ig = await require('../src/platforms/instagram').post(job, memStore({ instagram: { accessToken: 't', igUserId: '42', apiHost: 'graph.facebook.com', apiVersion: 'v21.0' } }), onProgress);
  assert.strictEqual(ig.url, 'https://instagram.com/reel/x');
  console.log('instagram ok', calls.length, 'requests');

  fs.unlinkSync(file);
  console.log('ALL SMOKE TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
