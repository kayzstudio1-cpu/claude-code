// Runs on TikTok, Instagram and YouTube Studio, but only acts in tabs that Jarvis opened.
// It puts the video and caption into the site's own upload form; you press Post yourself.
(() => {
  if (window.top !== window || window.__jarvisRan) return;
  window.__jarvisRan = true;

  const send = (msg) => chrome.runtime.sendMessage(msg).then((r) => {
    if (r && r.error) throw new Error(r.error);
    return r;
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.getClientRects().length > 0;

  async function waitFor(fn, timeout = 60000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch { /* keep waiting */ }
      await sleep(400);
    }
    return null;
  }

  function byText(selector, re, root = document) {
    return [...root.querySelectorAll(selector)].find((el) => visible(el) && re.test((el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim()));
  }

  function setFiles(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeInto(el, text) {
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    const got = (el.innerText || el.value || '').replace(/\s+/g, ' ');
    if (!got.includes(text.replace(/\s+/g, ' ').slice(0, 15))) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }

  /* ---------- on-page banner ---------- */
  let bannerText;
  let bannerSub;
  let caption = '';
  function banner(text, sub = '', kind = '') {
    if (!bannerText) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .b{font:14px/1.4 system-ui,sans-serif;background:#0b1424;color:#e6f7ff;border:1px solid #3ee8ff;border-radius:12px;
           padding:12px 14px;width:300px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
        .h{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.04em}
        .d{width:9px;height:9px;border-radius:50%;background:#3ee8ff;box-shadow:0 0 8px #3ee8ff}
        .b.ok .d{background:#4dffa6;box-shadow:0 0 8px #4dffa6}.b.err{border-color:#ff5c7a}.b.err .d{background:#ff5c7a}
        .t{margin-top:6px}.s{margin-top:4px;color:#9bb7c6;font-size:12.5px}
        .r{display:flex;gap:6px;margin-top:10px}
        button{font:600 12px system-ui;border-radius:7px;border:1px solid #3ee8ff;background:#123047;color:#e6f7ff;padding:6px 10px;cursor:pointer}
        button.x{margin-left:auto;border-color:transparent;background:none;color:#9bb7c6}</style>
        <div class="b"><div class="h"><span class="d"></span>JARVIS</div><div class="t"></div><div class="s"></div>
        <div class="r"><button class="c">Copy caption</button><button class="x">Hide</button></div></div>`;
      document.documentElement.append(host);
      bannerText = root.querySelector('.t');
      bannerSub = root.querySelector('.s');
      root.querySelector('.c').onclick = async (e) => {
        await navigator.clipboard.writeText(caption).catch(() => {});
        e.target.textContent = 'Copied ✓';
      };
      root.querySelector('.x').onclick = () => host.remove();
      banner.box = root.querySelector('.b');
    }
    banner.box.className = `b ${kind}`;
    bannerText.textContent = text;
    bannerSub.textContent = sub;
  }

  const report = (state, detail) => send({ type: 'progress', state, detail }).catch(() => {});

  async function loadVideo() {
    const info = await send({ type: 'videoInfo' });
    const parts = [];
    for (let i = 0; i < info.chunks; i += 1) {
      const { data } = await send({ type: 'chunk', i });
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j += 1) bytes[j] = bin.charCodeAt(j);
      parts.push(bytes);
      banner('Loading your video…', `${Math.round(((i + 1) / info.chunks) * 100)}%`);
    }
    return new File(parts, info.name, { type: info.type || 'video/mp4' });
  }

  const LOGIN_WAIT = 10 * 60 * 1000;

  /* ---------- TikTok ---------- */
  async function tiktok(file, meta) {
    banner('Waiting for the TikTok upload page…', 'Log in if TikTok asks you to.');
    const input = await waitFor(() => document.querySelector('input[type=file][accept*="video"]') || document.querySelector('input[type=file]'), LOGIN_WAIT);
    if (!input) throw new Error("Couldn't find TikTok's upload button.");
    setFiles(input, file);
    banner('Video added. Adding caption…');
    const editor = await waitFor(() => document.querySelector('.public-DraftEditor-content[contenteditable="true"]') ||
      [...document.querySelectorAll('[contenteditable="true"]')].find(visible), 120000);
    if (!editor) throw new Error("Video added, but I couldn't find the caption box. Paste the caption yourself.");
    await sleep(2000); // TikTok fills in the file name first; wait so we replace it
    typeInto(editor, meta.caption);
  }

  /* ---------- Instagram ---------- */
  async function instagram(file, meta) {
    banner('Waiting for Instagram…', 'Log in if Instagram asks you to.');
    const create = await waitFor(() => {
      const icon = document.querySelector('svg[aria-label="New post"], svg[aria-label="Create"]');
      return icon && icon.closest('a, [role="button"], button');
    }, LOGIN_WAIT);
    if (!create) throw new Error("Couldn't find Instagram's Create button.");
    create.click();
    await sleep(900);
    const postItem = byText('a, [role="button"], [role="menuitem"], span', /^Post$/);
    if (postItem) { postItem.click(); await sleep(900); }

    const input = await waitFor(() => document.querySelector('div[role="dialog"] input[type=file], form[enctype] input[type=file]'), 30000);
    if (!input) throw new Error("Couldn't open Instagram's upload window.");
    setFiles(input, file);
    banner('Video added. Moving to the caption step…');

    const okBtn = await waitFor(() => byText('div[role="dialog"] button, div[role="dialog"] [role="button"]', /^OK$/), 6000);
    if (okBtn) okBtn.click();
    for (let step = 0; step < 2; step += 1) {
      const next = await waitFor(() => byText('div[role="dialog"] [role="button"], div[role="dialog"] button', /^Next$/), 90000);
      if (!next) throw new Error('Video added, but I got stuck on the Next button. Click Next and paste the caption.');
      next.click();
      await sleep(1800);
    }
    const editor = await waitFor(() => document.querySelector('div[role="dialog"] [contenteditable="true"][aria-label*="caption" i]') ||
      [...document.querySelectorAll('div[role="dialog"] [contenteditable="true"]')].find(visible), 30000);
    if (!editor) throw new Error("Couldn't find the caption box. Paste the caption yourself.");
    typeInto(editor, meta.caption);
  }

  /* ---------- YouTube Studio ---------- */
  async function youtube(file, meta) {
    banner('Waiting for YouTube Studio…', 'Log in if Google asks you to.');
    let input = await waitFor(() => document.querySelector('ytcp-uploads-dialog input[type=file]'), 3000);
    if (!input) {
      const createBtn = await waitFor(() => document.querySelector('#create-icon, ytcp-button#create-icon'), LOGIN_WAIT);
      if (!createBtn) throw new Error("Couldn't find YouTube Studio's Create button.");
      createBtn.click();
      const item = await waitFor(() => byText('tp-yt-paper-item, ytcp-ve, [role="menuitem"]', /upload videos?/i), 10000);
      if (item) item.click();
      input = await waitFor(() => document.querySelector('ytcp-uploads-dialog input[type=file], input[type=file][name="Filedata"]'), 20000);
    }
    if (!input) throw new Error("Couldn't open YouTube's upload window.");
    setFiles(input, file);
    banner('Video added. Adding title and description…');
    const title = await waitFor(() => document.querySelector('#title-textarea #textbox'), 120000);
    if (!title) throw new Error("Video added, but I couldn't find the title box.");
    await sleep(1500);
    typeInto(title, (meta.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 100));
    const desc = document.querySelector('#description-textarea #textbox');
    if (desc) typeInto(desc, meta.caption);
    const notForKids = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
    if (notForKids) notForKids.click();
  }

  const FILLERS = { tiktok, instagram, youtube };
  const HOSTS = { tiktok: 'www.tiktok.com', instagram: 'www.instagram.com', youtube: 'studio.youtube.com' };
  const FINISH = {
    tiktok: 'Check the details, then press Post.',
    instagram: 'Check the details, then press Share.',
    youtube: 'Click Next through the steps, choose Public, then Publish.'
  };

  (async () => {
    const job = await send({ type: 'getJob' }).catch(() => null);
    if (!job || HOSTS[job.platform] !== location.hostname) return;
    caption = job.meta.caption;
    try {
      await report('working', 'Filling in the upload form');
      const file = await loadVideo();
      await FILLERS[job.platform](file, job.meta);
      banner('Ready to post ✓', FINISH[job.platform], 'ok');
      await report('ready', FINISH[job.platform]);
    } catch (err) {
      banner(err.message, 'Use "Copy caption" below to paste it yourself.', 'err');
      await report('error', err.message);
    }
  })();
})();
