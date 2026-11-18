// Persistent settings + post history.
// The config blob holds OAuth tokens, so it is encrypted with the OS keychain
// (Electron safeStorage) whenever the platform supports it.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  youtube: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0, account: '' },
  tiktok: { clientKey: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0, openId: '', account: '', mode: 'direct' },
  instagram: { accessToken: '', igUserId: '', apiHost: 'graph.facebook.com', apiVersion: 'v21.0', account: '' },
  prefs: { voice: true }
};

const SECRET_FIELDS = ['clientSecret', 'accessToken', 'refreshToken'];

let cache = null;

function dir() { return app.getPath('userData'); }
function encFile() { return path.join(dir(), 'config.enc'); }
function plainFile() { return path.join(dir(), 'config.json'); }
function historyFile() { return path.join(dir(), 'history.json'); }

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function merge(base, saved) {
  const out = {};
  for (const key of Object.keys(base)) out[key] = { ...base[key], ...(saved && saved[key]) };
  return out;
}

function load() {
  if (cache) return cache;
  let saved = null;
  try {
    if (fs.existsSync(encFile()) && canEncrypt()) {
      saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(encFile())));
    } else if (fs.existsSync(plainFile())) {
      saved = JSON.parse(fs.readFileSync(plainFile(), 'utf8'));
    }
  } catch (e) {
    console.error('Could not read settings, starting fresh:', e.message);
  }
  cache = merge(DEFAULTS, saved);
  return cache;
}

function persist() {
  fs.mkdirSync(dir(), { recursive: true });
  const json = JSON.stringify(cache);
  if (canEncrypt()) {
    fs.writeFileSync(encFile(), safeStorage.encryptString(json), { mode: 0o600 });
    if (fs.existsSync(plainFile())) fs.unlinkSync(plainFile());
  } else {
    fs.writeFileSync(plainFile(), json, { mode: 0o600 });
  }
}

function get(section) { return load()[section]; }

function update(section, patch) {
  const cfg = load();
  cfg[section] = { ...cfg[section], ...patch };
  persist();
  return cfg[section];
}

function isConnected(section) {
  const c = load()[section];
  if (section === 'instagram') return Boolean(c.accessToken && c.igUserId);
  return Boolean(c.accessToken);
}

// What the window is allowed to see: never secret values, only whether they are set.
function publicView() {
  const cfg = load();
  const out = { encrypted: canEncrypt() };
  for (const [section, values] of Object.entries(cfg)) {
    const view = {};
    for (const [k, v] of Object.entries(values)) {
      if (SECRET_FIELDS.includes(k)) view['has_' + k] = Boolean(v);
      else view[k] = v;
    }
    if (section !== 'prefs') view.connected = isConnected(section);
    out[section] = view;
  }
  return out;
}

function getHistory() {
  try { return JSON.parse(fs.readFileSync(historyFile(), 'utf8')); } catch { return []; }
}

function addHistory(entry) {
  const list = [entry, ...getHistory()].slice(0, 200);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(historyFile(), JSON.stringify(list, null, 2));
  return list;
}

module.exports = { get, update, isConnected, publicView, getHistory, addHistory };
