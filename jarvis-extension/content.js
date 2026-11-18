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

  /* ---------- finding things, including inside shadow DOM and same-site iframes ---------- */
  function roots() {
    const list = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try { if (f.contentDocument) list.push(f.contentDocument); } catch { /* other site */ }
    }
    return list;
  }
  function deepAll(selector) {
    const out = [];
    const walk = (root) => {
      out.push(...root.querySelectorAll(selector));
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    roots().forEach(walk);
    return out;
  }
  function deep(selector) {
    for (const r of roots()) { const el = r.querySelector(selector); if (el) return el; }
    return deepAll(selector)[0] || null;
  }
  const firstOf = (...selectors) => { for (const s of selectors) { const el = deep(s); if (el) return el; } return null; };

  function byText(selector, re, scope) {
    const els = scope ? [...scope.querySelectorAll(selector)] : deepAll(selector);
    return els.find((el) => visible(el) && re.test((el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim()));
  }

  let step = 'starting';
  async function waitFor(fn, timeout, slowHint) {
    const start = Date.now();
    let hinted = false;
    while (Date.now() - start < timeout) {
      try { const v = fn(); if (v) return v; } catch { /* keep waiting */ }
      if (!hinted && slowHint && Date.now() - start > 15000) {
        hinted = true;
        banner(slowHint, 'If you\'re logged in and can see the upload page, click "Copy report" and paste it to Claude.', 'warn');
      }
      await sleep(400);
    }
    return null;
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
    const doc = el.ownerDocument;
    doc.execCommand('selectAll', false, null);
    doc.execCommand('insertText', false, text);
    const got = (el.innerText || el.value || '').replace(/\s+/g, ' ');
    if (!got.includes(text.replace(/\s+/g, ' ').slice(0, 15))) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }

  function bytesFromBase64(data) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j += 1) bytes[j] = bin.charCodeAt(j);
    return bytes;
  }

  /* ---------- diagnostics the user can paste to Claude ---------- */
  function report() {
    const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return JSON.stringify({
      jarvis: chrome.runtime.getManifest().version,
      platform: job && job.platform,
      step,
      url: location.origin + location.pathname,
      fileInputs: deepAll('input[type=file]').map((i) => `${i.accept || '*'}${visible(i) ? '' : ' (hidden)'}${i.closest('[role=dialog]') ? ' in-dialog' : ''}`),
      textBoxes: deepAll('[contenteditable="true"], textarea').filter(visible).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} [${e.getAttribute('aria-label') || e.getAttribute('placeholder') || ''}]`),
      dialogs: deepAll('[role=dialog]').filter(visible).length,
      buttons: deepAll('button, [role=button], a[role=link]').filter(visible).map(label).filter(Boolean).slice(0, 30),
      iconLabels: [...new Set(deepAll('svg[aria-label]').map((s) => s.getAttribute('aria-label')))].slice(0, 25),
      iframes: document.querySelectorAll('iframe').length
    }, null, 1);
  }

  /* ---------- on-page banner ---------- */
  let bannerText;
  let bannerSub;
  let caption = '';
  let job = null;
  function banner(text, sub = '', kind = '') {
    if (!bannerText) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .b{font:14px/1.4 system-ui,sans-serif;background:#0b1424;color:#e6f7ff;border:1px solid #3ee8ff;border-radius:12px;
           padding:12px 14px;width:310px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
        .h{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.04em}
        .d{width:9px;height:9px;border-radius:50%;background:#3ee8ff;box-shadow:0 0 8px #3ee8ff}
        .b.ok .d{background:#4dffa6;box-shadow:0 0 8px #4dffa6}
        .b.warn{border-color:#ffb547}.b.warn .d{background:#ffb547}
        .b.err{border-color:#ff5c7a}.b.err .d{background:#ff5c7a}
        .t{margin-top:6px}.s{margin-top:4px;color:#9bb7c6;font-size:12.5px}
        .r{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
        button{font:600 12px system-ui;border-radius:7px;border:1px solid #3ee8ff;background:#123047;color:#e6f7ff;padding:6px 10px;cursor:pointer}
        button.x{margin-left:auto;border-color:transparent;background:none;color:#9bb7c6}</style>
        <div class="b"><div class="h"><span class="d"></span>JARVIS</div><div class="t"></div><div class="s"></div>
        <div class="r"><button class="c">Copy caption</button><button class="rep">Copy report</button><button class="x">Hide</button></div></div>`;
      document.documentElement.append(host);
      bannerText = root.querySelector('.t');
      bannerSub = root.querySelector('.s');
      const copy = async (btn, text, done) => {
        try { await navigator.clipboard.writeText(text); btn.textContent = done; } catch { prompt('Copy this:', text); }
      };
      root.querySelector('.c').onclick = (e) => copy(e.target, caption, 'Caption copied ✓');
      root.querySelector('.rep').onclick = (e) => copy(e.target, report(), 'Report copied ✓');
      root.querySelector('.x').onclick = () => host.remove();
      banner.box = root.querySelector('.b');
    }
    banner.box.className = `b ${kind}`;
    bannerText.textContent = text;
    bannerSub.textContent = sub;
  }

  const progress = (state, detail) => send({ type: 'progress', state, detail }).catch(() => {});
  function at(name, text, sub) { step = name; banner(text, sub || ''); }

  async function loadVideo() {
    const info = await send({ type: 'videoInfo' });
    const parts = [];
    for (let i = 0; i < info.chunks; i += 1) {
      const { data } = await send({ type: 'chunk', i });
      parts.push(bytesFromBase64(data));
      banner('Loading your video…', `${Math.round(((i + 1) / info.chunks) * 100)}%`);
    }
    return new File(parts, info.name, { type: info.type || 'video/mp4' });
  }

  const LOGIN_WAIT = 10 * 60 * 1000;
  const captionBox = (scope) => {
    const all = scope ? [...scope.querySelectorAll('[contenteditable="true"], [role="textbox"]')] : deepAll('[contenteditable="true"], [role="textbox"]');
    return all.find(visible);
  };

  /* ---------- TikTok ---------- */
  const TT_UPLOAD = ['https://www.tiktok.com/tiktokstudio/upload', 'https://www.tiktok.com/upload', 'https://www.tiktok.com/creator-center/upload'];
  const ttOnUpload = () => /upload/i.test(location.pathname);
  const ttOnLogin = () => /login|signup|passport/i.test(location.pathname);

  // TikTok often drops you on the feed or a menu page (e.g. after logging in). Steer back to the upload page.
  function ttSteer() {
    if (ttOnUpload() || ttOnLogin()) return false;
    const tries = Number(sessionStorage.getItem('jarvisTT') || 0);
    if (tries >= TT_UPLOAD.length) return false;
    sessionStorage.setItem('jarvisTT', String(tries + 1));
    banner('Taking you to TikTok\'s upload page…');
    location.assign(TT_UPLOAD[tries]);
    return true;
  }

  function dropOn(target, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }

  const ttEditor = () => firstOf('.public-DraftEditor-content[contenteditable="true"]', '[data-contents] [contenteditable="true"]') || captionBox();
  const ttStarted = () => ttEditor() || /uploaded|uploading/i.test(document.body.innerText.slice(0, 20000)) && !/select video to upload/i.test(document.body.innerText.slice(0, 5000));
  // TikTok shows a "Log in" prompt (even on the upload page) when the session is missing or expired.
  const ttNeedsLogin = () => Boolean(byText('button, [role="button"], a, div', /^(log in|login|create account)$/i));
  const ttFailed = () => byText('button, [role="button"]', /^retry$/i);

  async function ttWaitForLogin() {
    if (!ttNeedsLogin()) return;
    step = 'login';
    banner('Please log in to TikTok in this tab.', "TikTok isn't letting this browser upload until you log in. I'll carry on by myself once you're in.", 'warn');
    await progress('working', 'Waiting for you to log in to TikTok');
    const ok = await waitFor(() => !ttNeedsLogin(), LOGIN_WAIT);
    if (!ok) throw new Error('Still not logged in to TikTok. Log in, then press POST EVERYWHERE again.');
    await sleep(2000);
    if (!ttOnUpload()) { location.assign(TT_UPLOAD[0]); await sleep(60000); }
  }

  async function tiktok(file, meta) {
    at('find-upload', 'Looking for the TikTok upload button…', 'Log in if TikTok asks you to.');
    let steerAt = Date.now() + 4000;
    const input = await waitFor(() => {
      const found = firstOf('input[type=file][accept*="video"]', 'input[type=file]');
      if (found) return found;
      // Give a page a few seconds to settle (SPA redirects), then steer to the upload page.
      if (Date.now() > steerAt) { steerAt = Infinity; if (ttSteer()) return null; }
      if (!ttOnUpload() && !ttOnLogin()) steerAt = Math.min(steerAt, Date.now() + 4000);
      return null;
    }, LOGIN_WAIT, "I can't find TikTok's upload button yet.");
    if (!input) throw new Error("Couldn't find TikTok's upload button.");
    sessionStorage.removeItem('jarvisTT');
    await ttWaitForLogin();
    at('add-video', 'Adding your video…');
    setFiles(deep('input[type=file][accept*="video"]') || deep('input[type=file]') || input, file);

    // Backup: if TikTok ignored the file, drop it onto the upload area like a drag-and-drop.
    if (!(await waitFor(ttStarted, 8000))) {
      at('drop-fallback', 'Trying another way to add the video…');
      let zone = input.parentElement;
      for (let i = 0; i < 4 && zone && !visible(zone); i += 1) zone = zone.parentElement;
      const target = byText('div, button, [role="button"]', /select (a )?video|drag and drop|select file/i) || zone || document.body;
      dropOn(target, file);
      if (!(await waitFor(ttStarted, 8000))) {
        throw new Error('TikTok didn\'t accept the video automatically. Click "Select video" and pick it yourself. The caption is ready under "Copy caption".');
      }
    }

    at('find-caption', 'Video added ✓ Adding your caption…');
    const editor = await waitFor(ttEditor, 120000, 'Video added ✓ but I can\'t find the caption box.');
    if (!editor) throw new Error("Video added ✓ but I couldn't find the caption box. Paste the caption yourself.");
    await sleep(2500); // TikTok fills in the file name first; wait so we replace it
    typeInto(editor, meta.caption);
    // Make sure the upload didn't fail behind our back (e.g. a "Retry" button after a session problem).
    await sleep(3000);
    if (ttFailed() || ttNeedsLogin()) {
      throw new Error(ttNeedsLogin()
        ? "TikTok logged you out during the upload. Log in to TikTok, then press POST EVERYWHERE again."
        : 'TikTok says the upload failed (it shows "Retry"). Click Retry, or press POST EVERYWHERE again.');
    }
  }

  /* ---------- Instagram ---------- */
  async function instagram(file, meta) {
    at('find-create', 'Looking for Instagram\'s Create button…', 'Log in if Instagram asks you to.');
    const create = await waitFor(() => {
      const icon = deep('svg[aria-label="New post"], svg[aria-label="Create"], svg[aria-label="New Post"]');
      return icon && icon.closest('a, [role="button"], [role="link"], button');
    }, LOGIN_WAIT, "I can't find Instagram's Create (+) button yet.");
    if (!create) throw new Error("Couldn't find Instagram's Create button.");
    create.click();
    await sleep(1200);
    const postItem = byText('a, [role="button"], [role="link"], [role="menuitem"], span', /^Post$/);
    if (postItem) { (postItem.closest('a, [role="button"], [role="link"], [role="menuitem"]') || postItem).click(); await sleep(1200); }

    at('find-upload', 'Opening Instagram\'s upload window…');
    const input = await waitFor(() => firstOf('[role="dialog"] input[type=file]', 'form[enctype] input[type=file]', 'input[type=file][accept*="video"]'), 30000,
      "Instagram's upload window didn't open.");
    if (!input) throw new Error("Couldn't open Instagram's upload window. Click Create → Post, then try again.");
    setFiles(input, file);
    at('next-steps', 'Video added ✓ Moving to the caption step…');

    const okBtn = await waitFor(() => byText('[role="dialog"] button, [role="dialog"] [role="button"]', /^OK$/), 6000);
    if (okBtn) okBtn.click();
    for (let n = 0; n < 2; n += 1) {
      step = `next-${n + 1}`;
      const next = await waitFor(() => byText('[role="dialog"] [role="button"], [role="dialog"] button', /^Next$/), 90000,
        'Video added ✓ waiting for the Next button…');
      if (!next) throw new Error('Video added ✓ but I got stuck on the Next button. Click Next and paste the caption.');
      next.click();
      await sleep(2000);
    }
    at('find-caption', 'Adding your caption…');
    const editor = await waitFor(() => firstOf('[role="dialog"] [contenteditable="true"][aria-label*="caption" i]', '[aria-label*="caption" i][contenteditable="true"]') ||
      captionBox(deep('[role="dialog"]')), 30000, "Can't find the caption box yet.");
    if (!editor) throw new Error("Couldn't find the caption box. Paste the caption yourself.");
    typeInto(editor, meta.caption);
  }

  /* ---------- YouTube Studio ---------- */
  let thumbMissed = false;
  async function youtube(file, meta) {
    at('find-upload', 'Looking for YouTube\'s upload window…', 'Log in if Google asks you to.');
    let input = await waitFor(() => firstOf('ytcp-uploads-dialog input[type=file]', 'ytcp-uploads-file-picker input[type=file]', 'input[type=file][name="Filedata"]'), 6000);
    if (!input) {
      const createBtn = await waitFor(() => firstOf('#create-icon', 'ytcp-button#create-icon', '[aria-label="Create"]'), LOGIN_WAIT,
        "I can't find YouTube Studio's Create button yet.");
      if (!createBtn) throw new Error("Couldn't find YouTube Studio's Create button.");
      createBtn.click();
      const item = await waitFor(() => firstOf('#text-item-0') || byText('tp-yt-paper-item, ytcp-ve, [role="menuitem"]', /upload videos?/i), 10000);
      if (item) item.click();
      input = await waitFor(() => firstOf('ytcp-uploads-dialog input[type=file]', 'ytcp-uploads-file-picker input[type=file]', 'input[type=file][name="Filedata"]', 'input[type=file]'), 20000,
        "YouTube's upload window didn't open.");
    }
    if (!input) throw new Error("Couldn't open YouTube's upload window. Click Create → Upload videos, then try again.");
    setFiles(input, file);
    at('find-title', 'Video added ✓ Adding title and description…');
    const title = await waitFor(() => firstOf('#title-textarea #textbox', 'ytcp-social-suggestions-textbox#title-textarea [contenteditable="true"]'), 120000,
      'Video added ✓ waiting for the title box…');
    if (!title) throw new Error("Video added ✓ but I couldn't find the title box.");
    await sleep(1500);
    typeInto(title, (meta.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 100));
    const desc = firstOf('#description-textarea #textbox', 'ytcp-social-suggestions-textbox#description-textarea [contenteditable="true"]');
    if (desc) typeInto(desc, meta.caption);
    const notForKids = deep('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
    if (notForKids) notForKids.click();
    if (meta.thumb) await youtubeThumb();
  }

  // Best effort: custom thumbnails need a verified YouTube channel, so a miss is not an error.
  async function youtubeThumb() {
    step = 'thumbnail';
    try {
      const r = await send({ type: 'thumb' });
      if (!r) return;
      const input = await waitFor(() => firstOf('ytcp-thumbnails-compact-editor-uploader input[type=file]', 'ytcp-uploads-dialog input#file-loader', 'ytcp-uploads-dialog input[type=file][accept*="image"]'), 15000);
      if (input) setFiles(input, new File([bytesFromBase64(r.data)], 'thumbnail.jpg', { type: 'image/jpeg' }));
      else thumbMissed = true;
    } catch { thumbMissed = true; }
  }

  const FILLERS = { tiktok, instagram, youtube };
  const HOSTS = { tiktok: 'www.tiktok.com', instagram: 'www.instagram.com', youtube: 'studio.youtube.com' };
  const FINISH = {
    tiktok: 'Check the details, then press Post.',
    instagram: 'Check the details, then press Share.',
    youtube: 'Click Next through the steps, choose Public, then Publish.'
  };

  (async () => {
    // The job is saved as the tab opens, so retry briefly in case this page loaded first.
    for (let i = 0; i < 6 && !job; i += 1) {
      job = await send({ type: 'getJob' }).catch(() => null);
      if (!job) await sleep(500);
    }
    if (!job || HOSTS[job.platform] !== location.hostname) return;
    caption = job.meta.caption;
    try {
      await progress('working', 'Filling in the upload form');
      step = 'load-video';
      const file = await loadVideo();
      await FILLERS[job.platform](file, job.meta);
      step = 'done';
      banner('Ready to post ✓', FINISH[job.platform] + (thumbMissed ? ' Add the thumbnail you downloaded from Jarvis yourself.' : ''), 'ok');
      await progress('ready', FINISH[job.platform]);
    } catch (err) {
      banner(err.message, 'Use "Copy caption" to paste it yourself, or "Copy report" and send it to Claude so it can fix this.', 'err');
      await progress('error', err.message);
    }
  })();
})();
