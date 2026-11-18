// YouTube Data API v3: Google OAuth (desktop loopback + PKCE) and resumable video upload.
const { REDIRECT_URI, pkce, randomState, waitForCode, readJson, postForm, readChunk, mimeFor } = require('../oauth');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KB

async function connect(store, openExternal) {
  const cfg = store.get('youtube');
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('Add your Google OAuth Client ID and Client Secret in Settings first.');
  const { verifier, challenge } = pkce('base64url');
  const state = randomState();
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256'
  })}`;
  const pending = waitForCode(state);
  await openExternal(url);
  const code = await pending;
  const tok = await postForm(TOKEN_URL, {
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code', code_verifier: verifier
  });
  store.update('youtube', {
    accessToken: tok.access_token, refreshToken: tok.refresh_token || cfg.refreshToken,
    expiresAt: Date.now() + (tok.expires_in || 3600) * 1000
  });
  let account = 'YouTube channel';
  try {
    const me = await readJson(await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tok.access_token}` }
    }));
    if (me.items && me.items[0]) account = me.items[0].snippet.title;
  } catch { /* name is cosmetic */ }
  store.update('youtube', { account });
  return account;
}

async function accessToken(store) {
  const cfg = store.get('youtube');
  if (!cfg.accessToken) throw new Error('YouTube is not connected.');
  if (cfg.expiresAt - 60000 > Date.now()) return cfg.accessToken;
  if (!cfg.refreshToken) throw new Error('YouTube session expired. Reconnect in Settings.');
  const tok = await postForm(TOKEN_URL, {
    client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken, grant_type: 'refresh_token'
  });
  store.update('youtube', { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 });
  return tok.access_token;
}

async function post({ file, size, title, description, tags, options }, store, progress) {
  const token = await accessToken(store);
  progress(2, 'Opening upload session');
  let finalTitle = (title || 'New video').replace(/[<>]/g, '');
  if (options.shorts && !/#shorts/i.test(finalTitle + description)) finalTitle = `${finalTitle} #Shorts`;
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': mimeFor(file)
    },
    body: JSON.stringify({
      snippet: { title: finalTitle.slice(0, 100), description: description.slice(0, 5000), tags: tags.slice(0, 30), categoryId: '22' },
      status: { privacyStatus: options.privacy || 'public', selfDeclaredMadeForKids: false }
    })
  });
  if (!init.ok) await readJson(init);
  const location = init.headers.get('location');
  if (!location) throw new Error('YouTube did not return an upload URL.');

  let offset = 0;
  let stalls = 0;
  while (offset < size) {
    const end = Math.min(offset + CHUNK, size);
    const body = await readChunk(file, offset, end);
    const res = await fetch(location, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeFor(file), 'Content-Range': `bytes ${offset}-${end - 1}/${size}` },
      body
    });
    if (res.status === 308) {
      const range = res.headers.get('range');
      const next = range ? parseInt(range.split('-')[1], 10) + 1 : 0;
      stalls = next > offset ? 0 : stalls + 1;
      if (stalls > 3) throw new Error('YouTube upload stalled.');
      offset = next;
      progress(5 + Math.round((offset / size) * 90), 'Uploading');
      continue;
    }
    const video = await readJson(res);
    progress(100, 'Published');
    return { id: video.id, url: `https://youtu.be/${video.id}`, note: `Privacy: ${video.status && video.status.privacyStatus}` };
  }
  throw new Error('YouTube upload ended without a response.');
}

module.exports = { name: 'YouTube', connect, post };
