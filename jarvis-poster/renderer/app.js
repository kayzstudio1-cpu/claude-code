/* global jarvis */
const PLATFORMS = [
  { id: 'tiktok', name: 'TikTok', badge: 'TT', cls: 'tt' },
  { id: 'instagram', name: 'Instagram Reels', badge: 'IG', cls: 'ig' },
  { id: 'youtube', name: 'YouTube', badge: 'YT', cls: 'yt' }
];
const ALIASES = { tiktok: ['tiktok', 'tik tok', 'tt'], instagram: ['instagram', 'insta', 'ig', 'reels', 'reel'], youtube: ['youtube', 'yt', 'shorts', 'you tube'] };

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = { settings: null, file: null, selected: new Set(), busy: false };

/* ---------- voice + log ---------- */
function speak(text) {
  if (!state.settings || !state.settings.prefs.voice || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02; u.pitch = 0.95;
  const voice = speechSynthesis.getVoices().find((v) => /en-GB/i.test(v.lang)) || speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

function log(text, kind = '', who = 'JARVIS') {
  const line = document.createElement('div');
  line.className = `line ${who === 'YOU' ? 'me' : ''}`;
  const w = document.createElement('span'); w.className = 'who'; w.textContent = who;
  const t = document.createElement('span'); t.className = kind; t.textContent = text;
  line.append(w, t);
  $('#log').append(line);
  $('#log').scrollTop = $('#log').scrollHeight;
}
function say(text, kind) { log(text, kind); speak(text); }

function setCore(mode, label) {
  $('#core').className = `core ${mode || ''}`;
  $('#coreStatus').textContent = label;
}

/* ---------- views ---------- */
function show(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'history') renderHistory();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

/* ---------- platforms panel ---------- */
function renderPlatforms() {
  const wrap = $('#platforms');
  wrap.innerHTML = '';
  for (const p of PLATFORMS) {
    const s = state.settings[p.id];
    const card = document.createElement('div');
    card.className = 'pcard';
    card.dataset.platform = p.id;
    card.innerHTML = `<span class="pl-badge ${p.cls}">${p.badge}</span><span class="name"></span><span class="toggle"></span>
      <span class="acct"></span><div class="bar"><i></i></div><div class="stage"></div>`;
    $('.name', card).textContent = p.name;
    $('.acct', card).textContent = s.connected ? (s.account || 'Connected') : 'Not connected — set up in Accounts';
    if (!s.connected) { card.classList.add('disabled'); state.selected.delete(p.id); }
    card.classList.toggle('selected', state.selected.has(p.id));
    card.addEventListener('click', () => {
      if (state.busy) return;
      if (!s.connected) { show('accounts'); return; }
      state.selected.has(p.id) ? state.selected.delete(p.id) : state.selected.add(p.id);
      card.classList.toggle('selected', state.selected.has(p.id));
      updateLaunch();
    });
    wrap.append(card);
  }
  updateLaunch();
}

function updateLaunch() {
  const ready = state.file && state.selected.size > 0 && !state.busy;
  $('#launch').disabled = !ready;
  const n = state.selected.size;
  $('#launch').textContent = n === 3 ? 'POST EVERYWHERE' : n ? `POST TO ${n} PLATFORM${n > 1 ? 'S' : ''}` : 'POST EVERYWHERE';
  $('#launchHint').textContent = state.busy ? 'Posting in progress…'
    : !state.file ? 'Add a video to begin.'
    : !n ? 'Select at least one connected platform.'
    : 'Ready when you are.';
}

/* ---------- file handling ---------- */
function setFile(info) {
  state.file = info;
  $('#dropEmpty').classList.add('hidden');
  const v = $('#preview');
  v.src = info.url;
  v.classList.remove('hidden');
  $('#fileMeta').textContent = `${info.name} · ${info.size >= 1048576 ? (info.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(info.size / 1024)) + ' KB'}`;
  if (!$('#title').value) $('#title').value = info.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  updateLaunch();
  log(`Video loaded: ${info.name}`);
}

const dz = $('#dropzone');
dz.addEventListener('click', async (e) => {
  if (e.target.tagName === 'VIDEO') return;
  const info = await jarvis.pickFile().catch((err) => { say(err.message, 'err'); return null; });
  if (info) setFile(info);
});
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter') dz.click(); });
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
dz.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  try { setFile(await jarvis.inspectDropped(f)); } catch (err) { say(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

function updateCounter() {
  const tags = $('#tags').value.split(/[\s,]+/).filter(Boolean).map((t) => `#${t.replace(/^#+/, '')}`).join(' ');
  const len = $('#caption').value.length + (tags ? tags.length + 2 : 0);
  $('#counter').textContent = `${len} / 2200`;
  $('#counter').classList.toggle('over', len > 2200);
}
$('#caption').addEventListener('input', updateCounter);
$('#tags').addEventListener('input', updateCounter);

/* ---------- posting ---------- */
function cleanError(msg) { return String(msg).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

async function launch() {
  if (state.busy) return;
  if (!state.file) { say('I need a video first. Drop one into the content panel.', 'err'); return; }
  if (!state.selected.size) { say('No platforms selected.', 'err'); return; }
  const targets = [...state.selected];
  state.busy = true;
  updateLaunch();
  setCore('busy', 'TRANSMITTING');
  const names = targets.map((t) => PLATFORMS.find((p) => p.id === t).name);
  say(`Deploying to ${names.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`);
  for (const t of targets) {
    const card = $(`.pcard[data-platform="${t}"]`);
    card.classList.remove('done', 'failed');
    card.classList.add('running');
    $('.stage', card).textContent = 'Queued';
    $('.bar i', card).style.width = '0%';
  }
  try {
    const results = await jarvis.post({
      file: state.file.path,
      title: $('#title').value.trim(),
      caption: $('#caption').value.trim(),
      tags: $('#tags').value,
      platforms: targets,
      options: { privacy: $('#privacy').value, shorts: $('#shorts').checked, shareToFeed: $('#shareToFeed').checked }
    });
    let ok = 0;
    for (const r of results) {
      const card = $(`.pcard[data-platform="${r.platform}"]`);
      const name = PLATFORMS.find((p) => p.id === r.platform).name;
      card.classList.remove('running');
      card.classList.add(r.ok ? 'done' : 'failed');
      if (r.ok) {
        ok += 1;
        $('.stage', card).textContent = `✓ Done${r.note ? ' — ' + r.note : ''}`;
        log(`${name}: posted${r.url ? ' → ' + r.url : ''}${r.note ? ' (' + r.note + ')' : ''}`, 'ok');
      } else {
        $('.stage', card).textContent = `✗ ${r.error}`;
        log(`${name}: ${r.error}`, 'err');
      }
    }
    const failed = results.length - ok;
    setCore(failed && !ok ? 'error' : '', failed ? 'PARTIAL SUCCESS' : 'MISSION COMPLETE');
    speak(failed ? `${ok} of ${results.length} posts went out. Check the log for the rest.` : 'All posts are live.');
  } catch (err) {
    setCore('error', 'FAULT');
    say(cleanError(err.message), 'err');
    $$('.pcard.running').forEach((c) => c.classList.remove('running'));
  } finally {
    state.busy = false;
    updateLaunch();
  }
}
$('#launch').addEventListener('click', launch);

jarvis.onProgress(({ platform, pct, stage }) => {
  const card = $(`.pcard[data-platform="${platform}"]`);
  if (!card) return;
  $('.bar i', card).style.width = `${pct}%`;
  $('.stage', card).textContent = `${stage} · ${pct}%`;
});

/* ---------- accounts ---------- */
function fillAccounts() {
  for (const card of $$('.account')) {
    const p = card.dataset.platform;
    const s = state.settings[p];
    for (const input of $$('[data-key]', card)) {
      const k = input.dataset.key;
      if (input.type === 'password') {
        input.value = '';
        input.placeholder = s[`has_${k}`] ? '•••••••• saved (leave blank to keep)' : '';
      } else if (s[k] !== undefined) {
        input.value = s[k];
      }
    }
    const st = $('[data-state]', card);
    st.textContent = s.connected ? (s.account || 'Connected') : 'Not connected';
    st.classList.toggle('on', s.connected);
  }
  $('#encNote').textContent = state.settings.encrypted ? ', encrypted with your system keychain' : '';
}

function collect(card) {
  const patch = {};
  for (const input of $$('[data-key]', card)) patch[input.dataset.key] = input.value;
  return patch;
}

async function connect(platform, card) {
  const name = PLATFORMS.find((p) => p.id === platform).name.replace(' Reels', '');
  const btn = card && $('[data-connect]', card);
  if (btn) btn.disabled = true;
  try {
    if (card) state.settings = await jarvis.saveSettings(platform, collect(card));
    if (platform !== 'instagram') say(`Opening ${name} sign-in in your browser.`);
    const r = await jarvis.connect(platform);
    state.settings = r.settings;
    state.selected.add(platform);
    say(`${name} connected as ${r.account}.`, 'ok');
  } catch (err) {
    say(`${name}: ${cleanError(err.message)}`, 'err');
  } finally {
    if (btn) btn.disabled = false;
    fillAccounts();
    renderPlatforms();
  }
}

for (const card of $$('.account')) {
  const p = card.dataset.platform;
  $('[data-save]', card).addEventListener('click', async () => {
    state.settings = await jarvis.saveSettings(p, collect(card));
    fillAccounts();
    log(`${p} settings saved.`, 'ok');
  });
  $('[data-connect]', card).addEventListener('click', () => connect(p, card));
  $('[data-disconnect]', card).addEventListener('click', async () => {
    state.settings = await jarvis.disconnect(p);
    fillAccounts();
    renderPlatforms();
    log(`${p} disconnected.`);
  });
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-href]');
  if (a) { e.preventDefault(); jarvis.openUrl(a.dataset.href); }
});

/* ---------- history ---------- */
async function renderHistory() {
  const list = await jarvis.history();
  const wrap = $('#historyList');
  wrap.innerHTML = '';
  if (!list.length) { wrap.innerHTML = '<p class="muted">No missions yet.</p>'; return; }
  for (const h of list) {
    const el = document.createElement('div');
    el.className = 'hitem';
    el.innerHTML = '<div class="top"><b></b><span class="when"></span></div><ul></ul>';
    $('b', el).textContent = h.title || h.file;
    $('.when', el).textContent = new Date(h.at).toLocaleString();
    for (const r of h.results) {
      const li = document.createElement('li');
      li.className = r.ok ? 'ok' : 'bad';
      li.textContent = `${r.platform}: ${r.ok ? 'posted' : r.error}`;
      if (r.ok && r.url) {
        const a = document.createElement('a');
        a.dataset.href = r.url; a.textContent = ` ${r.url}`;
        li.append(a);
      }
      el.querySelector('ul').append(li);
    }
    wrap.append(el);
  }
}

/* ---------- command bar ---------- */
function mentioned(text) {
  if (/\b(everywhere|all|every platform|all platforms)\b/.test(text)) return PLATFORMS.map((p) => p.id);
  return Object.entries(ALIASES).filter(([, words]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(text))).map(([id]) => id);
}

async function handleCommand(raw) {
  const text = raw.toLowerCase().trim();
  if (!text) return;
  log(raw, '', 'YOU');
  const targets = mentioned(text);

  if (/^(help|\?|what can you do)/.test(text)) {
    say('Commands: post everywhere, post to tiktok and youtube, select instagram, connect youtube, status, open accounts, history, voice off.');
  } else if (/\b(post|publish|upload|send|launch|deploy)\b/.test(text)) {
    if (targets.length) {
      const usable = targets.filter((t) => state.settings[t].connected);
      const missing = targets.filter((t) => !state.settings[t].connected);
      if (missing.length) log(`Not connected: ${missing.join(', ')}`, 'err');
      state.selected = new Set(usable);
      renderPlatforms();
    }
    await launch();
  } else if (/\b(connect|link|sign in|login|log in)\b/.test(text) && targets.length) {
    show('accounts');
    await connect(targets[0], $(`.account[data-platform="${targets[0]}"]`));
  } else if (/\b(select|use|only|choose|toggle)\b/.test(text) && targets.length) {
    state.selected = new Set(targets.filter((t) => state.settings[t].connected));
    renderPlatforms();
    say(`Selected: ${[...state.selected].join(', ') || 'nothing connected yet'}.`);
  } else if (/\bstatus\b/.test(text)) {
    const on = PLATFORMS.filter((p) => state.settings[p.id].connected).map((p) => p.name);
    say(on.length ? `Connected to ${on.join(', ')}.${state.file ? ' Video loaded and ready.' : ' No video loaded.'}` : 'No platforms connected yet. Open Accounts to set them up.');
  } else if (/\b(account|settings|setup|set up)\b/.test(text)) {
    show('accounts'); say('Opening accounts.');
  } else if (/\b(history|log)\b/.test(text)) {
    show('history'); say('Here is the mission log.');
  } else if (/\b(home|mission|back)\b/.test(text)) {
    show('mission');
  } else if (/\b(voice on|unmute)\b/.test(text)) {
    await setVoice(true); say('Voice restored.');
  } else if (/\b(voice off|mute|be quiet)\b/.test(text)) {
    await setVoice(false); log('Voice muted.');
  } else if (/\bclear\b/.test(text)) {
    $('#log').innerHTML = '';
  } else if (/\b(hello|hi|hey)\b/.test(text)) {
    say('At your service. Drop a video and tell me where it should go.');
  } else {
    say("I didn't catch that. Type help to see what I can do.");
  }
}
$('#commandForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#commandInput').value;
  $('#commandInput').value = '';
  handleCommand(v);
});

async function setVoice(on) {
  state.settings = await jarvis.saveSettings('prefs', { voice: on });
  if (!on && window.speechSynthesis) speechSynthesis.cancel();
  $('#voiceToggle').textContent = `Voice: ${on ? 'on' : 'off'}`;
}
$('#voiceToggle').addEventListener('click', () => setVoice(!state.settings.prefs.voice));

/* ---------- boot ---------- */
function tick() {
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

(async function boot() {
  tick(); setInterval(tick, 15000);
  state.settings = await jarvis.getSettings();
  for (const p of PLATFORMS) if (state.settings[p.id].connected) state.selected.add(p.id);
  $('#voiceToggle').textContent = `Voice: ${state.settings.prefs.voice ? 'on' : 'off'}`;
  renderPlatforms();
  fillAccounts();
  updateCounter();
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const connected = PLATFORMS.filter((p) => state.settings[p.id].connected).length;
  const msg = connected
    ? `${greet}. ${connected} platform${connected > 1 ? 's' : ''} online. Drop a video when you're ready.`
    : `${greet}. Let's connect your accounts first — open the Accounts tab.`;
  // Voices load asynchronously in Chromium; wait briefly so the greeting uses a real voice.
  setTimeout(() => say(msg), 400);
})();
