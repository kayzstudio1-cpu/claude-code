importScripts('db.js');

const UPLOAD_URLS = {
  tiktok: 'https://www.tiktok.com/tiktokstudio/upload',
  instagram: 'https://www.instagram.com/',
  youtube: 'https://studio.youtube.com/'
};
const CHUNK = 4 * 1024 * 1024;
let cachedVideo = null;

chrome.action.onClicked.addListener(openDashboard);

async function openDashboard() {
  const url = chrome.runtime.getURL('dashboard.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) chrome.tabs.update(existing.id, { active: true });
  else chrome.tabs.create({ url });
}

// Jobs are keyed by tab id so only tabs Jarvis opened get filled in.
async function getJobs() { return (await chrome.storage.session.get('jobs')).jobs || {}; }
async function setJobs(jobs) { await chrome.storage.session.set({ jobs }); }

function notify(update) {
  chrome.runtime.sendMessage({ type: 'status', ...update }).catch(() => {});
}

async function loadVideo() {
  if (!cachedVideo) cachedVideo = await JarvisDB.get('video');
  if (!cachedVideo) throw new Error('No video selected. Pick one in the Jarvis dashboard.');
  return cachedVideo;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function launch({ platforms, meta }) {
  cachedVideo = null;
  await loadVideo();
  const jobs = {};
  let first = true;
  for (const platform of platforms) {
    const tab = await chrome.tabs.create({ url: UPLOAD_URLS[platform], active: first });
    first = false;
    jobs[tab.id] = { platform, meta, state: 'opened' };
    notify({ platform, state: 'opened', detail: 'Upload page opened' });
  }
  await setJobs(jobs);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'launch':
        await launch(msg);
        return { ok: true };
      case 'getJob': {
        const jobs = await getJobs();
        const job = sender.tab && jobs[sender.tab.id];
        return job && job.state !== 'ready' ? job : null;
      }
      case 'videoInfo': {
        const v = await loadVideo();
        return { name: v.name, type: v.type, size: v.blob.size, chunks: Math.ceil(v.blob.size / CHUNK) };
      }
      case 'chunk': {
        const v = await loadVideo();
        const part = v.blob.slice(msg.i * CHUNK, (msg.i + 1) * CHUNK);
        return { data: toBase64(await part.arrayBuffer()) };
      }
      case 'progress': {
        const jobs = await getJobs();
        const job = sender.tab && jobs[sender.tab.id];
        if (!job) return null;
        job.state = msg.state;
        await setJobs(jobs);
        notify({ platform: job.platform, state: msg.state, detail: msg.detail });
        return { ok: true };
      }
      case 'focusTab': {
        const jobs = await getJobs();
        const id = Object.keys(jobs).find((k) => jobs[k].platform === msg.platform);
        if (id) chrome.tabs.update(Number(id), { active: true }).catch(() => {});
        return { ok: Boolean(id) };
      }
      default:
        return null;
    }
  })().then(reply, (err) => reply({ error: err.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const jobs = await getJobs();
  if (jobs[tabId]) { delete jobs[tabId]; await setJobs(jobs); }
});
