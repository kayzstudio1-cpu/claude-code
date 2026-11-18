// TikTok Content Posting API: Login Kit (desktop, PKCE) + chunked FILE_UPLOAD.
// Mode "direct" publishes to the profile; mode "inbox" sends it to the TikTok app's drafts.
const { REDIRECT_URI, pkce, randomState, waitForCode, readJson, postForm, readChunk, sleep, mimeFor } = require('../oauth');

const API = 'https://open.tiktokapis.com';
const SCOPES = 'user.info.basic,video.upload,video.publish';
const MAX_SINGLE = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;

async function connect(store, openExternal) {
  const cfg = store.get('tiktok');
  if (!cfg.clientKey || !cfg.clientSecret) throw new Error('Add your TikTok Client Key and Client Secret in Settings first.');
  const { verifier, challenge } = pkce('hex');
  const state = randomState();
  const url = `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
    client_key: cfg.clientKey, scope: SCOPES, response_type: 'code', redirect_uri: REDIRECT_URI,
    state, code_challenge: challenge, code_challenge_method: 'S256'
  })}`;
  const pending = waitForCode(state);
  await openExternal(url);
  const code = await pending;
  const tok = await postForm(`${API}/v2/oauth/token/`, {
    client_key: cfg.clientKey, client_secret: cfg.clientSecret, code, grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI, code_verifier: verifier
  });
  if (!tok.access_token) throw new Error(tok.error_description || 'TikTok did not return a token.');
  store.update('tiktok', {
    accessToken: tok.access_token, refreshToken: tok.refresh_token, openId: tok.open_id,
    expiresAt: Date.now() + (tok.expires_in || 86400) * 1000
  });
  let account = 'TikTok account';
  try {
    const me = await readJson(await fetch(`${API}/v2/user/info/?fields=display_name`, {
      headers: { Authorization: `Bearer ${tok.access_token}` }
    }));
    account = (me.data && me.data.user && me.data.user.display_name) || account;
  } catch { /* cosmetic */ }
  store.update('tiktok', { account });
  return account;
}

async function accessToken(store) {
  const cfg = store.get('tiktok');
  if (!cfg.accessToken) throw new Error('TikTok is not connected.');
  if (cfg.expiresAt - 60000 > Date.now()) return cfg.accessToken;
  const tok = await postForm(`${API}/v2/oauth/token/`, {
    client_key: cfg.clientKey, client_secret: cfg.clientSecret, grant_type: 'refresh_token', refresh_token: cfg.refreshToken
  });
  if (!tok.access_token) throw new Error('TikTok session expired. Reconnect in Settings.');
  store.update('tiktok', { accessToken: tok.access_token, refreshToken: tok.refresh_token || cfg.refreshToken, expiresAt: Date.now() + tok.expires_in * 1000 });
  return tok.access_token;
}

async function api(token, path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body || {})
  });
  const json = await readJson(res);
  if (json.error && json.error.code && json.error.code !== 'ok') throw new Error(`TikTok: ${json.error.message || json.error.code}`);
  return json.data || {};
}

const PRIVACY = { public: 'PUBLIC_TO_EVERYONE', unlisted: 'MUTUAL_FOLLOW_FRIENDS', private: 'SELF_ONLY' };

function chunkPlan(size) {
  if (size <= MAX_SINGLE) return { chunkSize: size, count: 1 };
  // The last chunk absorbs the remainder (TikTok allows it to be up to 128 MB).
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

async function post({ file, size, caption, options }, store, progress) {
  const token = await accessToken(store);
  const mode = store.get('tiktok').mode;
  const { chunkSize, count } = chunkPlan(size);
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count };
  let note = '';
  let init;

  if (mode === 'inbox') {
    progress(2, 'Preparing draft upload');
    init = await api(token, '/v2/post/publish/inbox/video/init/', { source_info });
  } else {
    progress(2, 'Checking creator settings');
    const creator = await api(token, '/v2/post/publish/creator_info/query/');
    const allowed = creator.privacy_level_options || [];
    let privacy = PRIVACY[options.privacy] || 'PUBLIC_TO_EVERYONE';
    if (allowed.length && !allowed.includes(privacy)) {
      const fallback = allowed.includes('SELF_ONLY') ? 'SELF_ONLY' : allowed[0];
      note = `TikTok allowed ${fallback} instead of ${privacy} (unaudited apps can only post privately).`;
      privacy = fallback;
    }
    init = await api(token, '/v2/post/publish/video/init/', {
      post_info: { title: caption.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
      source_info
    });
  }

  for (let i = 0; i < count; i += 1) {
    const start = i * chunkSize;
    const end = i === count - 1 ? size : start + chunkSize;
    const body = await readChunk(file, start, end);
    const res = await fetch(init.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': mimeFor(file), 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
      body
    });
    if (!res.ok && res.status !== 206) throw new Error(`TikTok chunk upload failed (HTTP ${res.status}).`);
    progress(5 + Math.round(((i + 1) / count) * 75), 'Uploading');
  }

  progress(85, 'TikTok is processing');
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(5000);
    const s = await api(token, '/v2/post/publish/status/fetch/', { publish_id: init.publish_id });
    if (s.status === 'FAILED') throw new Error(`TikTok processing failed: ${s.fail_reason || 'unknown reason'}`);
    if (s.status === 'SEND_TO_USER_INBOX') {
      progress(100, 'Sent to drafts');
      return { id: init.publish_id, note: 'Open the TikTok app inbox to finish posting.' };
    }
    if (s.status === 'PUBLISH_COMPLETE') {
      progress(100, 'Published');
      const id = s.publicaly_available_post_id && s.publicaly_available_post_id[0];
      return { id: id || init.publish_id, note };
    }
  }
  return { id: init.publish_id, note: 'Uploaded; TikTok is still processing. Check your profile shortly.' };
}

module.exports = { name: 'TikTok', connect, post, chunkPlan };
