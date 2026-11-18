const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const store = require('./src/store');

const PLATFORMS = {
  youtube: require('./src/platforms/youtube'),
  tiktok: require('./src/platforms/tiktok'),
  instagram: require('./src/platforms/instagram')
};

const EDITABLE = {
  youtube: ['clientId', 'clientSecret'],
  tiktok: ['clientKey', 'clientSecret', 'mode'],
  instagram: ['accessToken', 'igUserId', 'apiHost', 'apiVersion'],
  prefs: ['voice']
};

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm'];
let win;
let posting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#05090f',
    title: 'Jarvis Poster',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function openExternal(url) {
  if (/^https:\/\//i.test(url)) return shell.openExternal(url);
  return Promise.resolve();
}

function inspect(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('Not a file.');
  const ext = file.toLowerCase().split('.').pop();
  if (!VIDEO_EXT.includes(ext)) throw new Error(`Unsupported file type .${ext}. Use MP4, MOV, M4V or WEBM.`);
  return { path: file, name: path.basename(file), size: stat.size, url: pathToFileURL(file).href };
}

function splitTags(raw) {
  return String(raw || '').split(/[\s,]+/).map((t) => t.replace(/^#+/, '').trim()).filter(Boolean);
}

ipcMain.handle('settings:get', () => store.publicView());

ipcMain.handle('settings:save', (_e, section, patch) => {
  if (!EDITABLE[section]) throw new Error('Unknown section');
  const clean = {};
  for (const key of EDITABLE[section]) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] === 'string' && patch[key].trim() === '' && /secret|token/i.test(key)) continue; // blank = keep saved secret
    clean[key] = typeof patch[key] === 'string' ? patch[key].trim() : patch[key];
  }
  store.update(section, clean);
  return store.publicView();
});

ipcMain.handle('auth:connect', async (_e, platform) => {
  const p = PLATFORMS[platform];
  if (!p) throw new Error('Unknown platform');
  const account = await p.connect(store, openExternal);
  return { account, settings: store.publicView() };
});

ipcMain.handle('auth:disconnect', (_e, platform) => {
  const reset = { accessToken: '', account: '' };
  if (platform !== 'instagram') Object.assign(reset, { refreshToken: '', expiresAt: 0 });
  store.update(platform, reset);
  return store.publicView();
});

ipcMain.handle('file:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Videos', extensions: VIDEO_EXT }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return inspect(r.filePaths[0]);
});

ipcMain.handle('file:inspect', (_e, file) => inspect(file));
ipcMain.handle('history:get', () => store.getHistory());
ipcMain.handle('open:url', (_e, url) => openExternal(url));

ipcMain.handle('post:run', async (_e, job) => {
  if (posting) throw new Error('A post is already in progress.');
  const file = inspect(job.file);
  const targets = (job.platforms || []).filter((p) => PLATFORMS[p]);
  if (!targets.length) throw new Error('Choose at least one platform.');
  const tags = splitTags(job.tags);
  const hashtagLine = tags.map((t) => `#${t}`).join(' ');
  const caption = [job.caption, hashtagLine].filter(Boolean).join('\n\n');
  const payload = {
    file: file.path, size: file.size, title: job.title || job.caption.split('\n')[0] || file.name,
    caption, description: caption, tags, options: job.options || {}
  };

  posting = true;
  const started = Date.now();
  try {
    const settled = await Promise.allSettled(targets.map((p) =>
      PLATFORMS[p].post(payload, store, (pct, stage) => win.webContents.send('post:progress', { platform: p, pct, stage }))
    ));
    const results = settled.map((s, i) => s.status === 'fulfilled'
      ? { platform: targets[i], ok: true, ...s.value }
      : { platform: targets[i], ok: false, error: s.reason && s.reason.message ? s.reason.message : String(s.reason) });
    store.addHistory({ at: new Date(started).toISOString(), file: file.name, title: payload.title, results });
    return results;
  } finally {
    posting = false;
  }
});

app.setName('Jarvis Poster');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
