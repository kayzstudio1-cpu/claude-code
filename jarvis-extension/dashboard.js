/* global JarvisDB */
const $ = (s) => document.querySelector(s);
let video = null;
let voice = true;

function speak(text) {
  if (!voice || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = speechSynthesis.getVoices().find((x) => /en-GB/i.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

function tagsLine() {
  return $('#tags').value.split(/[\s,]+/).map((t) => t.replace(/^#+/, '')).filter(Boolean).map((t) => `#${t}`).join(' ');
}
function fullCaption() { return [$('#caption').value.trim(), tagsLine()].filter(Boolean).join('\n\n'); }
function chosen() { return [...document.querySelectorAll('.plat input:checked')].map((i) => i.value); }

function refresh() {
  const len = fullCaption().length;
  $('#count').textContent = `${len} / 2200`;
  $('#count').style.color = len > 2200 ? 'var(--bad)' : '';
  const n = chosen().length;
  $('#go').disabled = !video || !n;
  $('#go').textContent = n === 3 ? 'POST EVERYWHERE' : n ? `POST TO ${n}` : 'PICK A PLATFORM';
  $('#hint').textContent = !video ? 'Choose a video to begin.' : !n ? 'Tick at least one platform.' : 'Ready when you are.';
  chrome.storage.local.set({ draft: { title: $('#title').value, caption: $('#caption').value, tags: $('#tags').value, platforms: chosen() } });
}

async function useFile(file) {
  if (!file || !/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { $('#hint').textContent = 'That is not a video file.'; return; }
  $('#hint').textContent = 'Saving video…';
  await JarvisDB.put('video', { blob: file, name: file.name, type: file.type || 'video/mp4' });
  video = file;
  $('#dropEmpty').classList.add('hidden');
  $('#preview').src = URL.createObjectURL(file);
  $('#preview').classList.remove('hidden');
  $('#fileMeta').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  if (!$('#title').value) $('#title').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  refresh();
}

$('#file').addEventListener('change', (e) => useFile(e.target.files[0]));
const drop = $('#drop');
drop.addEventListener('click', (e) => { if (e.target.tagName === 'VIDEO') e.preventDefault(); });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); useFile(e.dataTransfer.files[0]); });
['#title', '#caption', '#tags'].forEach((s) => $(s).addEventListener('input', refresh));
document.querySelectorAll('.plat input').forEach((i) => i.addEventListener('change', refresh));

$('#go').addEventListener('click', async () => {
  const platforms = chosen();
  $('#go').disabled = true;
  document.querySelectorAll('[data-status]').forEach((e) => { e.textContent = ''; e.className = ''; });
  speak(`Opening ${platforms.length} upload page${platforms.length > 1 ? 's' : ''}. Log in if asked, and I'll fill everything in.`);
  const r = await chrome.runtime.sendMessage({ type: 'launch', platforms, meta: { title: $('#title').value.trim(), caption: fullCaption() } });
  if (r && r.error) { $('#hint').textContent = r.error; }
  $('#go').disabled = false;
});

const LABEL = { opened: 'Opening…', working: 'Filling in…', ready: 'Ready — press Post ✓', error: 'Needs you' };
let readyCount = 0;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'status') return;
  const el = document.querySelector(`[data-status="${msg.platform}"]`);
  if (!el) return;
  el.textContent = LABEL[msg.state] || msg.state;
  el.title = msg.detail || '';
  el.className = msg.state;
  if (msg.state === 'ready' && ++readyCount === chosen().length) speak('Everything is filled in. Check each tab and press post.');
});
document.querySelectorAll('.plat em').forEach((em) => em.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'focusTab', platform: em.dataset.status });
}));

$('#voice').addEventListener('click', () => {
  voice = !voice;
  $('#voice').textContent = `Voice: ${voice ? 'on' : 'off'}`;
  chrome.storage.local.set({ voice });
});

(async () => {
  const { draft, voice: v } = await chrome.storage.local.get(['draft', 'voice']);
  if (v === false) { voice = false; $('#voice').textContent = 'Voice: off'; }
  if (draft) {
    $('#title').value = draft.title || '';
    $('#caption').value = draft.caption || '';
    $('#tags').value = draft.tags || '';
    if (draft.platforms) document.querySelectorAll('.plat input').forEach((i) => { i.checked = draft.platforms.includes(i.value); });
  }
  refresh();
  const h = new Date().getHours();
  setTimeout(() => speak(`${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}. Drop a video and I'll post it everywhere.`), 400);
})();
