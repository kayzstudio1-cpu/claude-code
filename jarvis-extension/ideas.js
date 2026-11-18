/* global JarvisDB, refresh, video, LanguageModel */
// Title / caption / hashtag ideas and thumbnail suggestions.
// Text ideas use Chrome's built-in AI (Gemini Nano, runs on this computer for free) when the
// computer supports it, and fall back to proven hook templates when it doesn't.
(() => {
  const q = (s) => document.querySelector(s);
  const note = (t) => { q('#aiNote').textContent = t; };

  /* ================= text ideas ================= */
  const SCHEMA = {
    type: 'object',
    properties: {
      titles: { type: 'array', items: { type: 'string' } },
      captions: { type: 'array', items: { type: 'string' } },
      hashtags: { type: 'array', items: { type: 'string' } }
    },
    required: ['titles', 'captions', 'hashtags']
  };

  async function aiIdeas(topic, draft) {
    if (typeof LanguageModel === 'undefined') return null;
    const lang = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
    const availability = await LanguageModel.availability(lang);
    if (availability === 'unavailable') return null;
    if (availability !== 'available') note("Downloading Chrome's free built-in AI (one time only)…");
    const session = await LanguageModel.create({
      ...lang,
      initialPrompts: [{ role: 'system', content: 'You are an expert short-form video strategist for TikTok, Instagram Reels and YouTube Shorts. You write punchy, honest hooks without clickbait lies.' }],
      monitor(m) { m.addEventListener('downloadprogress', (e) => note(`Downloading Chrome's free built-in AI… ${Math.round(e.loaded * 100)}%`)); }
    });
    try {
      note('Thinking…');
      const raw = await session.prompt(
        `Video topic: ${topic}\n${draft ? `Creator's draft caption: ${draft}\n` : ''}` +
        'Write 5 scroll-stopping titles (under 70 characters, no quotation marks), ' +
        '3 captions for TikTok and Instagram (a strong hook first line, 2-3 short lines total, end with a call to action, no hashtags), ' +
        'and 12 relevant hashtags without the # sign. Reply as JSON.',
        { responseConstraint: SCHEMA }
      );
      const data = JSON.parse(raw);
      if (!data.titles || !data.titles.length) return null;
      return data;
    } finally {
      session.destroy();
    }
  }

  const STOP = new Set('the a an and or but for with from that this have has had your you my our their about into over under just very what when how why who are was were will can its it is to of in on at by as be me i we they them so do does did not no yes more most some any all'.split(' '));

  function shuffle(a) { return a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]); }

  function templateIdeas(topic) {
    const t = topic.trim().replace(/[.!?]+$/, '');
    const T = t.charAt(0).toUpperCase() + t.slice(1);
    const titles = shuffle([
      `${T} (you need to see this)`,
      `${T} in 60 seconds`,
      `The truth about ${t}`,
      `${T}: what nobody tells you`,
      `Watch this before you try ${t}`,
      `${T} changed everything`,
      `Why ${t} actually works`,
      `${T}, step by step`
    ]).slice(0, 5).map((s) => s.slice(0, 100));
    const captions = [
      `${T} 👇\n\nSave this so you don't lose it, and follow for more.`,
      `Nobody talks about this: ${t}.\n\nWould you try it? Tell me in the comments 👇`,
      `POV: ${t} ✨\n\nSend this to someone who needs to see it.`
    ];
    const words = [...new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))];
    const joined = words.length > 1 ? [words.slice(0, 2).join('')] : [];
    const hashtags = [...words, ...joined, 'fyp', 'foryou', 'viral', 'reels', 'shorts', 'trending', 'explorepage'].slice(0, 12);
    return { titles, captions, hashtags };
  }

  function button(cls, text, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', () => { onClick(b); b.classList.add('used'); });
    return b;
  }

  function render(ideas) {
    const titles = q('#titleIdeas');
    const caps = q('#captionIdeas');
    const tags = q('#tagIdeas');
    titles.innerHTML = '<h3>Titles: click to use</h3>';
    caps.innerHTML = '<h3>Captions: click to use</h3>';
    tags.innerHTML = '';
    for (const t of ideas.titles.slice(0, 6)) {
      titles.append(button('idea', t, () => { q('#title').value = t.slice(0, 100); refresh(); redrawThumbs(); }));
    }
    for (const c of ideas.captions.slice(0, 4)) {
      caps.append(button('idea', c, () => { q('#caption').value = c; refresh(); }));
    }
    for (const raw of ideas.hashtags.slice(0, 15)) {
      const h = String(raw).replace(/^#+/, '').replace(/\s+/g, '');
      if (!h) continue;
      tags.append(button('tag', `#${h}`, () => {
        const have = q('#tags').value.split(/[\s,]+/).map((x) => x.replace(/^#+/, '').toLowerCase());
        if (!have.includes(h.toLowerCase())) q('#tags').value = [q('#tags').value.trim(), h].filter(Boolean).join(', ');
        refresh();
      }));
    }
  }

  q('#suggest').addEventListener('click', async () => {
    const topic = q('#topic').value.trim() || q('#caption').value.split('\n')[0].trim() || q('#title').value.trim();
    if (!topic) { note('Type what the video is about first.'); q('#topic').focus(); return; }
    q('#suggest').disabled = true;
    try {
      let ideas = null;
      try { ideas = await aiIdeas(topic, q('#caption').value.trim()); } catch (e) { console.warn('Built-in AI failed', e); }
      if (ideas) note("Written by Chrome's built-in AI. Click again for fresh ideas.");
      else { ideas = templateIdeas(topic); note('Quick ideas from hook templates (Chrome AI not available on this computer). Click again to reshuffle.'); }
      render(ideas);
    } finally {
      q('#suggest').disabled = false;
    }
  });

  /* ================= thumbnails ================= */
  let frames = [];
  let selected = -1;

  const once = (el, ev) => new Promise((res, rej) => {
    el.addEventListener(ev, res, { once: true });
    el.addEventListener('error', () => rej(new Error('Could not read this video.')), { once: true });
  });

  function score(canvas) {
    const s = document.createElement('canvas');
    s.width = 48; s.height = 48;
    const c = s.getContext('2d', { willReadFrequently: true });
    c.drawImage(canvas, 0, 0, 48, 48);
    const d = c.getImageData(0, 0, 48, 48).data;
    const L = new Float32Array(48 * 48);
    let sum = 0;
    for (let i = 0; i < L.length; i += 1) { L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += L[i]; }
    const mean = sum / L.length;
    let varSum = 0;
    let edges = 0;
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 48; x += 1) {
        const v = L[y * 48 + x];
        varSum += (v - mean) ** 2;
        if (x < 47) edges += Math.abs(v - L[y * 48 + x + 1]);
        if (y < 47) edges += Math.abs(v - L[(y + 1) * 48 + x]);
      }
    }
    const contrast = Math.sqrt(varSum / L.length);
    const sharp = edges / L.length;
    const exposure = Math.abs(mean - 130);
    return contrast + sharp * 1.5 - exposure * 0.6 - (mean < 35 ? 80 : 0);
  }

  async function findFrames() {
    if (!video) return;
    q('#frames').disabled = true;
    q('#thumbNote').textContent = 'Scanning your video for the best moments…';
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = URL.createObjectURL(video);
    try {
      await once(v, 'loadedmetadata');
      const dur = v.duration || 1;
      const N = 14;
      const found = [];
      for (let i = 1; i <= N; i += 1) {
        v.currentTime = Math.min(dur - 0.05, (dur * i) / (N + 1));
        await once(v, 'seeked');
        const scale = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        found.push({ canvas: c, t: v.currentTime, score: score(c) });
        q('#thumbNote').textContent = `Scanning your video… ${Math.round((i / N) * 100)}%`;
      }
      found.sort((a, b) => b.score - a.score);
      frames = [];
      for (const f of found) {
        if (frames.every((g) => Math.abs(g.t - f.t) > dur / 10)) frames.push(f);
        if (frames.length === 4) break;
      }
      selected = -1;
      redrawThumbs();
      q('#thumbNote').textContent = 'Best moments from your video. Click one to choose it. Jarvis will try to add it to YouTube for you.';
      q('#thumbActions').classList.add('hidden');
    } catch (e) {
      q('#thumbNote').textContent = e.message;
    } finally {
      URL.revokeObjectURL(v.src);
      q('#frames').disabled = false;
    }
  }

  function wrap(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function compose(frame, W, H, withText) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const fw = frame.width;
    const fh = frame.height;
    const cover = Math.max(W / fw, H / fh);
    const contain = Math.min(W / fw, H / fh);
    // Blurred fill so vertical clips still look full in a 16:9 thumbnail.
    ctx.filter = 'blur(28px) brightness(0.55)';
    ctx.drawImage(frame, (W - fw * cover) / 2, (H - fh * cover) / 2, fw * cover, fh * cover);
    ctx.filter = 'none';
    const s = cover / contain < 1.4 ? cover : contain;
    ctx.drawImage(frame, (W - fw * s) / 2, (H - fh * s) / 2, fw * s, fh * s);

    const title = (q('#title').value || '').trim().toUpperCase();
    if (withText && title) {
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(0, H * 0.45, W, H * 0.55);
      let size = Math.round(Math.min(W, H) * 0.14);
      let lines;
      do {
        ctx.font = `900 ${size}px "Arial Black", Impact, "Segoe UI", system-ui, sans-serif`;
        lines = wrap(ctx, title, W * 0.9);
        size -= 4;
      } while ((lines.length > 3 || lines.length * size * 1.1 > H * 0.45) && size > 20);
      size += 4;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineJoin = 'round';
      const lh = size * 1.08;
      let y = H - H * 0.06 - (lines.length - 1) * lh;
      lines.forEach((ln, i) => {
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = '#000';
        ctx.strokeText(ln, W / 2, y);
        ctx.fillStyle = i === lines.length - 1 && lines.length > 1 ? '#ffe14d' : '#fff';
        ctx.fillText(ln, W / 2, y);
        y += lh;
      });
    }
    return c;
  }

  function redrawThumbs() {
    if (!frames.length) return;
    const box = q('#thumbs');
    box.innerHTML = '';
    const withText = q('#thumbText').checked;
    frames.forEach((f, i) => {
      const preview = compose(f.canvas, 640, 360, withText);
      preview.title = `Moment at ${f.t.toFixed(1)}s`;
      if (i === selected) preview.classList.add('sel');
      preview.addEventListener('click', () => choose(i));
      box.append(preview);
    });
    if (selected >= 0) saveSelected();
  }

  const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));

  async function saveSelected() {
    const blob = await toBlob(compose(frames[selected].canvas, 1280, 720, q('#thumbText').checked));
    await JarvisDB.put('thumb', blob);
    window.jarvisThumb = true;
  }

  async function choose(i) {
    selected = i;
    [...q('#thumbs').children].forEach((c, k) => c.classList.toggle('sel', k === i));
    q('#thumbActions').classList.remove('hidden');
    await saveSelected();
  }

  async function download(W, H, name) {
    if (selected < 0) return;
    const blob = await toBlob(compose(frames[selected].canvas, W, H, q('#thumbText').checked));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  q('#frames').addEventListener('click', findFrames);
  q('#thumbText').addEventListener('change', redrawThumbs);
  let t;
  q('#title').addEventListener('input', () => { clearTimeout(t); t = setTimeout(redrawThumbs, 300); });
  q('#dlYt').addEventListener('click', () => download(1280, 720, 'youtube-thumbnail.jpg'));
  q('#dlCover').addEventListener('click', () => download(1080, 1920, 'cover-1080x1920.jpg'));

  document.addEventListener('jarvis:video', () => {
    frames = [];
    selected = -1;
    window.jarvisThumb = false;
    JarvisDB.put('thumb', null);
    q('#thumbs').innerHTML = '';
    q('#thumbActions').classList.add('hidden');
    q('#frames').disabled = false;
    if (!q('#topic').value) q('#topic').value = video.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    findFrames();
  });
})();
