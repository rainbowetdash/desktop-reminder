// 桌面提醒 — 界面逻辑
(async function () {
  const api = window.api;
  const R = window.WallpaperRenderer;
  const $ = (id) => document.getElementById(id);
  if (api.platform === 'darwin') document.body.classList.add('mac');

  let cfg = await api.getConfig();
  let screenSize = await api.screenSize();
  let installed = new Set(await api.fontsInstalled());
  const loadedFontCss = new Set();
  const imageCache = new Map();

  const POS_NAMES = {
    tl: '左上角', tc: '顶部居中', tr: '右上角',
    cl: '左侧居中', cc: '正中间', cr: '右侧居中',
    bl: '左下角', bc: '底部居中', br: '右下角',
  };

  // ---------- 字体 ----------
  function fontById(id) {
    return window.FONT_CATALOG.find((f) => f.id === id) || window.FONT_CATALOG[0];
  }

  async function ensureFontCss(id) {
    if (id === 'system' || loadedFontCss.has(id)) return true;
    const css = await api.fontCss(id);
    if (!css) return false;
    const style = document.createElement('style');
    style.dataset.font = id;
    style.textContent = css;
    document.head.appendChild(style);
    loadedFontCss.add(id);
    return true;
  }

  async function fontOpts(c, size) {
    let f = fontById(c.font);
    if (f.id !== 'system' && !installed.has(f.id)) f = fontById('system');
    if (f.id === 'system') return { family: null, bold: false };
    await ensureFontCss(f.id);
    const text = (c.title || '') + (c.text || '') + R.dateString() + '0123456789•.';
    const bold = !!(f.weights && f.weights.includes('700'));
    try {
      await document.fonts.load(`400 ${size}px "${f.family}"`, text);
      if (bold) await document.fonts.load(`700 ${size}px "${f.family}"`, text);
    } catch {}
    return { family: f.family, bold };
  }

  function loadImage(p) {
    if (!p) return Promise.resolve(null);
    if (imageCache.has(p)) return imageCache.get(p);
    const pr = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = api.fileUrl(p);
    });
    imageCache.set(p, pr);
    return pr;
  }

  async function renderTo(canvas, c, W, H) {
    const image = c.background && c.background.type === 'image' ? await loadImage(c.background.path) : null;
    const fo = await fontOpts(c, (c.fontSize || 32) * H / 1080);
    R.renderWallpaper(canvas, c, W, H, { image, ...fo });
  }

  // ---------- 预览 ----------
  const preview = $('preview');
  const wrap = $('monitorWrap');

  function layoutPreview() {
    const bezel = 18;
    const availW = wrap.clientWidth - 16 - bezel;
    const availH = wrap.clientHeight - 10 - bezel;
    const ratio = screenSize.width / screenSize.height;
    let w = availW, h = w / ratio;
    if (h > availH) { h = availH; w = h * ratio; }
    preview.style.width = Math.floor(w) + 'px';
    preview.style.height = Math.floor(h) + 'px';
    return { w: Math.floor(w), h: Math.floor(h) };
  }

  let renderSeq = 0;
  async function refreshPreview() {
    const seq = ++renderSeq;
    const { w, h } = layoutPreview();
    if (w < 10 || h < 10) return;
    const dpr = window.devicePixelRatio || 1;
    const off = document.createElement('canvas');
    await renderTo(off, cfg, Math.round(w * dpr), Math.round(h * dpr));
    if (seq !== renderSeq) return;
    preview.width = off.width;
    preview.height = off.height;
    preview.getContext('2d').drawImage(off, 0, 0);
  }

  let timer = null;
  function schedule(save = true) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      refreshPreview();
      if (save) api.saveConfig(stripCfg(cfg));
    }, 60);
  }
  function stripCfg(c) {
    const { platform, ...rest } = c;
    return rest;
  }

  new ResizeObserver(() => refreshPreview()).observe(wrap);

  // ---------- 表单 ----------
  const titleEl = $('title'), textEl = $('text');
  titleEl.value = cfg.title || '';
  textEl.value = cfg.text || '';
  titleEl.addEventListener('input', () => { cfg.title = titleEl.value; schedule(); });
  textEl.addEventListener('input', () => { cfg.text = textEl.value; schedule(); });

  // 回车时自动延续列表符号
  textEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
    const v = textEl.value, pos = textEl.selectionStart;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    const line = v.slice(lineStart, pos);
    let m = line.match(/^(\s*[-*•]\s+)(.*)$/);
    let prefix = null;
    if (m) prefix = m[2].trim() ? m[1] : '';
    else if ((m = line.match(/^(\s*)(\d{1,3})([.、)）]\s*)(.*)$/))) prefix = m[4].trim() ? m[1] + (Number(m[2]) + 1) + m[3] : '';
    if (prefix === null) return;
    e.preventDefault();
    if (prefix === '') {
      // 空的列表项：回车清掉符号
      textEl.setRangeText('', lineStart, pos, 'end');
    } else {
      textEl.setRangeText('\n' + prefix, pos, textEl.selectionEnd, 'end');
    }
    textEl.dispatchEvent(new Event('input'));
  });

  // 位置
  const posGrid = $('posGrid');
  ['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br'].forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pos-cell';
    b.dataset.v = p;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', POS_NAMES[p]);
    b.addEventListener('click', () => { cfg.position = p; syncPos(); schedule(); });
    posGrid.appendChild(b);
  });
  function syncPos() {
    for (const b of posGrid.children) b.setAttribute('aria-checked', String(b.dataset.v === cfg.position));
    $('posCaption').textContent = POS_NAMES[cfg.position] || '';
  }
  syncPos();

  // 滑块
  function bindRange(el, out, key, fmt) {
    const paint = () => {
      const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
      el.style.setProperty('--fill', pct + '%');
      out.textContent = fmt(Number(el.value));
    };
    el.value = cfg[key];
    paint();
    el.addEventListener('input', () => { cfg[key] = Number(el.value); paint(); schedule(); });
  }
  bindRange($('size'), $('sizeOut'), 'fontSize', (v) => String(v));
  bindRange($('opacity'), $('opacityOut'), 'panelOpacity', (v) => Math.round(v * 100) + '%');

  // 面板样式
  const panelSeg = $('panelSeg');
  function syncPanel() {
    for (const b of panelSeg.children) b.setAttribute('aria-checked', String(b.dataset.v === cfg.panel));
    $('opacityRow').style.visibility = cfg.panel === 'clear' ? 'hidden' : 'visible';
  }
  for (const b of panelSeg.children) {
    b.addEventListener('click', () => { cfg.panel = b.dataset.v; syncPanel(); schedule(); });
  }
  syncPanel();

  // 开关
  const showDate = $('showDate');
  showDate.checked = !!cfg.showDate;
  showDate.addEventListener('change', () => { cfg.showDate = showDate.checked; schedule(); });

  const login = $('login');
  login.checked = await api.getLogin();
  login.addEventListener('change', async () => {
    login.checked = await api.setLogin(login.checked);
  });

  // ---------- 背景 ----------
  const swatches = $('swatches');
  function renderSwatches() {
    swatches.innerHTML = '';
    for (const p of window.BG_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.setAttribute('role', 'radio');
      b.style.background = `linear-gradient(150deg, ${p.stops.join(', ')})`;
      b.setAttribute('aria-checked', String(cfg.background.type === 'preset' && cfg.background.id === p.id));
      b.addEventListener('click', () => { cfg.background = { type: 'preset', id: p.id }; renderSwatches(); schedule(); });
      swatches.appendChild(b);
    }
    if (cfg.lastImage || (cfg.background.type === 'image' && cfg.background.path)) {
      const imgPath = cfg.background.type === 'image' ? cfg.background.path : cfg.lastImage;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.title = '我的图片';
      b.setAttribute('aria-label', '我的图片');
      b.setAttribute('role', 'radio');
      b.style.backgroundImage = `url("${api.fileUrl(imgPath)}")`;
      b.setAttribute('aria-checked', String(cfg.background.type === 'image'));
      b.addEventListener('click', () => { cfg.background = { type: 'image', path: imgPath }; renderSwatches(); schedule(); });
      swatches.appendChild(b);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'swatch swatch-add';
    add.textContent = '+ 用自己的图片';
    add.addEventListener('click', async () => {
      const p = await api.pickBackground();
      if (!p) return;
      cfg.background = { type: 'image', path: p };
      cfg.lastImage = p;
      renderSwatches();
      schedule();
    });
    swatches.appendChild(add);
  }
  if (cfg.background.type === 'image') cfg.lastImage = cfg.background.path;
  renderSwatches();

  // ---------- 应用 ----------
  const applyBtn = $('apply'), status = $('status');
  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }
  async function applyWallpaper(silent) {
    applyBtn.disabled = true;
    if (!silent) setStatus('正在生成壁纸…');
    try {
      screenSize = await api.screenSize();
      const c = document.createElement('canvas');
      await renderTo(c, cfg, screenSize.width, screenSize.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await api.applyWallpaper(bytes);
      if (res.ok) {
        const t = new Date();
        setStatus(`已应用 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`, 'ok');
      } else {
        setStatus('没能换上壁纸：' + res.error, 'err');
      }
    } catch (e) {
      setStatus('没能换上壁纸：' + (e.message || e), 'err');
    } finally {
      applyBtn.disabled = false;
    }
  }
  applyBtn.addEventListener('click', async () => {
    await api.saveConfig(stripCfg(cfg));
    applyWallpaper(false);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      applyBtn.click();
    }
    if (e.key === 'Escape' && !$('fontDrawer').hidden) closeDrawer();
  });
  api.onAutoApply(async () => {
    cfg = { ...cfg, ...(await api.getConfig()) };
    applyWallpaper(true);
    refreshPreview();
  });

  // ---------- 字体库 ----------
  const drawer = $('fontDrawer'), scrim = $('fontScrim'), grid = $('fontGrid');
  let filter = 'all';
  const downloading = new Map(); // id -> {done,total}
  const errors = new Map();
  const previewLoaded = new Map(); // id -> 'ok' | 'fail' | Promise

  function syncFontName() {
    const f = fontById(cfg.font);
    const usable = f.id === 'system' || installed.has(f.id);
    $('fontName').textContent = usable ? f.name : '系统默认';
    $('fontName').style.fontFamily = usable && f.family ? R.fontStack(f.family) : '';
    if (usable && f.id !== 'system') ensureFontCss(f.id);
  }
  syncFontName();

  function openDrawer() {
    drawer.hidden = false;
    scrim.hidden = false;
    renderGrid();
    $('fontClose').focus();
  }
  function closeDrawer() {
    drawer.hidden = true;
    scrim.hidden = true;
    $('fontBtn').focus();
  }
  $('fontBtn').addEventListener('click', openDrawer);
  $('fontClose').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  for (const b of $('fontFilter').children) {
    b.addEventListener('click', () => {
      filter = b.dataset.v;
      for (const x of $('fontFilter').children) x.classList.toggle('on', x === b);
      renderGrid();
    });
  }

  async function loadPreviewFont(f) {
    if (!f.family) return 'ok';
    if (installed.has(f.id)) { await ensureFontCss(f.id); return 'local'; }
    if (previewLoaded.has(f.id)) return previewLoaded.get(f.id);
    const p = (async () => {
      const text = window.SAMPLE.zh + window.SAMPLE.en + window.SAMPLE.num;
      const css = await api.previewCss({ id: f.id, family: f.family, weights: f.weights, text });
      if (!css) return 'fail';
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      try { await document.fonts.load(`400 28px "pv-${f.id}"`, text); } catch {}
      return 'ok';
    })();
    previewLoaded.set(f.id, p);
    const r = await p;
    previewLoaded.set(f.id, r);
    return r;
  }

  function renderGrid() {
    grid.innerHTML = '';
    for (const f of window.FONT_CATALOG) {
      if (filter !== 'all' && f.kind !== filter) continue;
      grid.appendChild(fontCard(f));
    }
  }

  function fontCard(f) {
    const card = document.createElement('article');
    card.className = 'font-card';
    card.dataset.id = f.id;
    const isCurrent = cfg.font === f.id && (f.id === 'system' || installed.has(f.id));
    if (isCurrent) card.classList.add('current');

    const spec = document.createElement('div');
    spec.className = 'specimen loading';
    const zh = document.createElement('div'); zh.className = 's-zh'; zh.textContent = window.SAMPLE.zh;
    const en = document.createElement('div'); en.className = 's-en'; en.textContent = window.SAMPLE.en;
    const num = document.createElement('div'); num.className = 's-num'; num.textContent = window.SAMPLE.num;
    spec.append(zh, en, num);

    loadPreviewFont(f).then((state) => {
      if (state === 'fail') {
        spec.classList.remove('loading');
        spec.innerHTML = '<div class="s-off">连不上网络，暂时看不到这个字体的样子。联网后重新打开字体库即可。</div>';
        return;
      }
      const fam = !f.family ? null : state === 'local' ? f.family : `pv-${f.id}`;
      spec.style.fontFamily = R.fontStack(fam);
      spec.classList.remove('loading');
    });

    const meta = document.createElement('div');
    meta.className = 'font-meta';
    const info = document.createElement('div');
    info.innerHTML = `<div class="fm-name"></div><div class="fm-note"></div>`;
    info.querySelector('.fm-name').textContent = f.name;
    info.querySelector('.fm-note').textContent = f.kind === 'en' ? f.note + '（中文用系统字体）' : f.note;
    const actions = document.createElement('div');
    actions.className = 'fm-actions';
    meta.append(info, actions);
    card.append(spec, meta);
    paintActions(f, actions, isCurrent);
    return card;
  }

  function paintActions(f, el, isCurrent) {
    el.innerHTML = '';
    const have = f.id === 'system' || installed.has(f.id);
    const dl = downloading.get(f.id);
    if (dl) {
      const bar = document.createElement('div');
      bar.className = 'progress';
      bar.innerHTML = '<i></i>';
      bar.firstChild.style.width = dl.total ? (dl.done / dl.total) * 100 + '%' : '4%';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', '下载进度');
      el.appendChild(bar);
      return;
    }
    if (errors.has(f.id)) {
      const e = document.createElement('span');
      e.className = 'fm-err';
      e.textContent = errors.get(f.id);
      el.appendChild(e);
    }
    if (isCurrent) {
      const chip = document.createElement('span');
      chip.className = 'chip-current';
      chip.textContent = '使用中';
      el.appendChild(chip);
      return;
    }
    if (have) {
      if (f.id !== 'system') {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn-link';
        rm.textContent = '删除';
        rm.addEventListener('click', async () => {
          await api.removeFont(f.id);
          installed.delete(f.id);
          renderGrid();
        });
        el.appendChild(rm);
      }
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn btn-accent';
      use.textContent = '使用';
      use.addEventListener('click', () => {
        cfg.font = f.id;
        syncFontName();
        renderGrid();
        schedule();
      });
      el.appendChild(use);
    } else {
      const get = document.createElement('button');
      get.type = 'button';
      get.className = 'btn';
      get.textContent = errors.has(f.id) ? '重试' : '下载';
      get.addEventListener('click', () => startDownload(f));
      el.appendChild(get);
    }
  }

  function refreshCard(id) {
    const card = grid.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const f = fontById(id);
    paintActions(f, card.querySelector('.fm-actions'), cfg.font === id && installed.has(id));
  }

  async function startDownload(f) {
    errors.delete(f.id);
    downloading.set(f.id, { done: 0, total: 0 });
    refreshCard(f.id);
    const res = await api.downloadFont({ id: f.id, family: f.family, weights: f.weights });
    downloading.delete(f.id);
    if (res.ok) {
      installed.add(f.id);
      cfg.font = f.id;
      syncFontName();
      schedule();
      renderGrid();
    } else {
      errors.set(f.id, res.error);
      refreshCard(f.id);
    }
  }

  api.onFontProgress(({ id, done, total }) => {
    downloading.set(id, { done, total });
    const bar = grid.querySelector(`[data-id="${id}"] .progress > i`);
    if (bar) bar.style.width = (done / total) * 100 + '%';
  });

  refreshPreview();
})();
