// Instagram Graph API: publish a Reel from a local file using the resumable upload endpoint.
// Needs an Instagram professional (Business/Creator) account, its IG user ID and an access token
// with instagram_content_publish (Facebook Login) or instagram_business_content_publish (Instagram Login).
const fs = require('fs');
const { readJson, sleep } = require('../oauth');

function base(cfg) {
  const host = cfg.apiHost === 'graph.instagram.com' ? 'graph.instagram.com' : 'graph.facebook.com';
  return `https://${host}/${cfg.apiVersion || 'v21.0'}`;
}

async function connect(store) {
  const cfg = store.get('instagram');
  if (!cfg.accessToken || !cfg.igUserId) throw new Error('Paste your Instagram access token and IG user ID in Settings first.');
  const me = await readJson(await fetch(`${base(cfg)}/${encodeURIComponent(cfg.igUserId)}?fields=username&access_token=${encodeURIComponent(cfg.accessToken)}`));
  const account = me.username ? `@${me.username}` : 'Instagram account';
  store.update('instagram', { account });
  return account;
}

async function post({ file, size, caption, options }, store, progress) {
  const cfg = store.get('instagram');
  if (!cfg.accessToken || !cfg.igUserId) throw new Error('Instagram is not connected.');
  const token = cfg.accessToken;

  progress(2, 'Creating Reel container');
  const params = new URLSearchParams({
    media_type: 'REELS', upload_type: 'resumable', caption: caption.slice(0, 2200),
    share_to_feed: String(options.shareToFeed !== false), access_token: token
  });
  const container = await readJson(await fetch(`${base(cfg)}/${encodeURIComponent(cfg.igUserId)}/media`, { method: 'POST', body: params }));
  const uploadUri = container.uri || `https://rupload.facebook.com/ig-api-upload/${cfg.apiVersion || 'v21.0'}/${container.id}`;

  progress(10, 'Uploading');
  const body = await fs.promises.readFile(file);
  const up = await fetch(uploadUri, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(size) },
    body
  });
  await readJson(up);
  progress(70, 'Instagram is processing');

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(5000);
    const s = await readJson(await fetch(`${base(cfg)}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`));
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram processing failed: ${s.status || s.status_code}`);
    progress(Math.min(90, 70 + attempt), 'Instagram is processing');
    if (attempt === 119) throw new Error('Instagram took too long to process the video.');
  }

  progress(95, 'Publishing');
  const pub = await readJson(await fetch(`${base(cfg)}/${encodeURIComponent(cfg.igUserId)}/media_publish`, {
    method: 'POST', body: new URLSearchParams({ creation_id: container.id, access_token: token })
  }));
  let url;
  try {
    const m = await readJson(await fetch(`${base(cfg)}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`));
    url = m.permalink;
  } catch { /* optional */ }
  progress(100, 'Published');
  return { id: pub.id, url };
}

module.exports = { name: 'Instagram', connect, post };
