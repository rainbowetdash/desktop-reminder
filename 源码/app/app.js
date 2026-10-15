// 桌面提醒 — 界面逻辑
(async function () {
  const api = window.api;
  const R = window.WallpaperRenderer;
  const $ = (id) => document.getElementById(id);
  if (api.platform === 'darwin') document.body.classList.add('mac');
  if (api.platform === 'win32') document.body.classList.add('win');

  let cfg = await api.getConfig();
  const Cal = window.Cal;
  let entries = await api.getEntries();

  // 旧版的「常驻提醒」文字并入待办列表：每一行变成一条今天的待办（没做完的会一直顺延）
  (function migrateLegacyText() {
    const raw = cfg.text || '';
    if (cfg.textMigrated) return;
    if (raw.trim()) {
      const today = Cal.todayKey();
      let t = Date.now();
      for (const line of raw.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        const pm = s.match(/^(?:[-*•·]|\d{1,3}[.、)）])\s*(.*)$/);
        const rest = pm ? pm[1] : s;
        const bm = rest.match(/^\[([ xX✓√✔]?)\]\s*(.*)$/);
        const text = (bm ? bm[2] : rest).trim();
        if (!text) continue;
        const done = !!(bm && bm[1].trim());
        entries.push({ id: Cal.uid(), date: today, kind: 'todo', text, done, doneOn: done ? today : '', createdAt: t++ });
      }
      api.saveEntries(entries);
      cfg.legacyText = raw; // 留一份备份，万一要找回
    }
    cfg.text = '';
    cfg.textMigrated = true;
    api.saveConfig((({ platform, ...rest }) => rest)(cfg));
  })();
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
    const text = (c.title || '') + (c.text || '') + entries.map((e) => e.text).join('') + R.dateString() + '0123456789•.';
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
    const bt = c.background && c.background.type;
    const image = bt === 'image' ? await loadImage(c.background.path)
      : bt === 'original' ? await loadImage(c.originalWallpaper)
      : bt === 'folder' ? await loadImage(c.lastPick) : null;
    const fo = await fontOpts(c, (c.fontSize || 32) * H / 1080);
    return R.renderWallpaper(canvas, c, W, H, { image, entries: Cal.visibleOn(entries, Cal.todayKey()), ...fo });
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
  let lastHits = [];
  async function refreshPreview() {
    const seq = ++renderSeq;
    const { w, h } = layoutPreview();
    if (w < 10 || h < 10) return;
    const dpr = window.devicePixelRatio || 1;
    const off = document.createElement('canvas');
    const res = await renderTo(off, cfg, Math.round(w * dpr), Math.round(h * dpr));
    if (seq !== renderSeq) return;
    lastHits = res.hits || [];
    preview.width = off.width;
    preview.height = off.height;
    preview.getContext('2d').drawImage(off, 0, 0);
  }

  // 点预览里的待办方块：在文字里把 [ ] 和 [x] 互相切换
  function hitAt(e) {
    const r = preview.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * preview.width;
    const py = ((e.clientY - r.top) / r.height) * preview.height;
    return lastHits.find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
  }
  preview.addEventListener('mousemove', (e) => { preview.style.cursor = hitAt(e) ? 'pointer' : ''; });
  preview.addEventListener('click', (e) => {
    const h = hitAt(e);
    if (!h) return;
    if (h.entryId) toggleEntry(h.entryId);
  });

  let autoTimer = null;
  let statusTimer = null;
  function autoApplySoon() {
    // 已经应用过壁纸的话，勾选后桌面也同步更新
    if (!cfg.lastAppliedDate) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => applyWallpaper(true), 300);
  }

  function saveEntries() { return api.saveEntries(entries); }

  // ---------- 提示条（带撤销）----------
  let toastTimer = null;
  function toast(msg, actLabel, onAct) {
    $('toastMsg').textContent = msg;
    const b = $('toastAct');
    b.hidden = !actLabel;
    b.textContent = actLabel || '';
    b.onclick = () => { $('toast').hidden = true; if (onAct) onAct(); };
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }

  // 待办的完成状态：点预览方块、今天的列表、日历里的勾选框，都走这里
  function toggleEntry(id, quiet) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    e.done = !e.done;
    e.doneOn = e.done ? Cal.todayKey() : '';
    saveEntries();
    entriesChanged(e.date);
    if (quiet || !e.done) return;
    const left = Cal.visibleOn(entries, Cal.todayKey()).filter((x) => x.kind === 'todo' && !x.done).length;
    if (!left) toast('今天的待办全部完成了', '撤销', () => toggleEntry(id, true));
    else toast(`已完成「${e.text.length > 16 ? e.text.slice(0, 16) + '…' : e.text}」`, '撤销', () => toggleEntry(id, true));
  }

  function entriesChanged(dateKey) {
    renderToday();
    if (!$('cal').hidden) renderCalendar();
    refreshPreview();
    if (dateKey === Cal.todayKey()) autoApplySoon(); // 改的是今天，桌面也同步
  }

  // 一条日历条目的一行：勾选框 + 文字（点一下可以改）+ 删除。今天的列表和日历里共用
  function entryItem(e) {
    const li = document.createElement('li');
    li.className = 'entry' + (e.kind === 'todo' && e.done ? ' done' : '');
    if (e.kind === 'todo') {
      const cb = document.createElement('button');
      cb.type = 'button';
      cb.className = 'check';
      cb.setAttribute('role', 'checkbox');
      cb.setAttribute('aria-checked', String(!!e.done));
      cb.setAttribute('aria-label', e.done ? '取消完成' : '标记完成');
      cb.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6.4l2.4 2.4 4.8-5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      cb.addEventListener('click', () => toggleEntry(e.id));
      li.appendChild(cb);
    } else {
      const dot = document.createElement('i');
      dot.className = 'bullet';
      li.appendChild(dot);
    }
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = e.text;
    txt.title = '点一下修改';
    txt.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'edit';
      input.value = e.text;
      input.maxLength = 200;
      txt.replaceWith(input);
      input.focus();
      input.select();
      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        const v = input.value.trim();
        const orig = entries.find((x) => x.id === e.id);
        if (save && v && orig && v !== orig.text) { orig.text = v; saveEntries(); entriesChanged(orig.date); }
        else { input.replaceWith(txt); }
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.isComposing) return;
        if (ev.key === 'Enter') finish(true);
        else if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    });
    li.appendChild(txt);
    if (e.late > 0 && !e.done) {
      const tag = document.createElement('span');
      tag.className = 'late-tag';
      tag.textContent = e.late === 1 ? '昨天的' : `逾期 ${e.late} 天`;
      tag.title = `原定 ${Cal.parseKey(e.date).getMonth() + 1}月${Cal.parseKey(e.date).getDate()}日，没完成，自动顺延到今天`;
      li.appendChild(tag);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = '删除';
    del.setAttribute('aria-label', '删除这一条');
    del.textContent = '×';
    del.addEventListener('click', () => {
      const idx = entries.findIndex((x) => x.id === e.id);
      if (idx < 0) return;
      const [orig] = entries.splice(idx, 1);
      saveEntries();
      entriesChanged(orig.date);
      toast('已删除', '撤销', () => { entries.splice(Math.min(idx, entries.length), 0, orig); saveEntries(); entriesChanged(orig.date); });
    });
    li.appendChild(del);
    return li;
  }

  // 主窗口里「今天」这一块
  function renderToday() {
    const key = Cal.todayKey();
    const d = Cal.parseKey(key);
    $('todayDate').textContent = `${d.getMonth() + 1}月${d.getDate()}日 星期${Cal.weekdayName(d)}`;
    const items = Cal.visibleOn(entries, key);
    const list = $('todayList');
    list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'today-empty';
      li.textContent = '今天还没有安排。在上面写一条，回车就能添加；没做完的会自动顺延到明天。想提前写以后的，点「日历」。';
      list.appendChild(li);
    }
    for (const e of items) list.appendChild(entryItem(e));
    const todos = items.filter((x) => x.kind === 'todo');
    const done = todos.filter((x) => x.done).length;
    $('todayProgress').textContent = todos.length ? `已完成 ${done}/${todos.length}` : '';
    $('todayClear').hidden = !done;
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
  const titleEl = $('title');
  titleEl.value = cfg.title || '';
  titleEl.addEventListener('input', () => { cfg.title = titleEl.value; schedule(); });

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
    if (typeof syncRotateBar === 'function') syncRotateBar();
    {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (cfg.originalWallpaper ? '' : ' swatch-add');
      b.title = cfg.originalWallpaper ? '我原来的壁纸' : '还没有找到原壁纸，点这里手动选择';
      b.setAttribute('aria-label', '我原来的壁纸');
      b.setAttribute('role', 'radio');
      if (cfg.originalWallpaper) b.style.backgroundImage = `url("${api.fileUrl(cfg.originalWallpaper)}")`;
      else b.textContent = '原壁纸';
      b.setAttribute('aria-checked', String(cfg.background.type === 'original'));
      b.addEventListener('click', async () => {
        if (!cfg.originalWallpaper) {
          const r = await api.pickOriginal();
          if (!r.ok) { if (r.error) setStatus(r.error, 'err'); return; }
          useOriginal(r.path);
        }
        cfg.background = { type: 'original' };
        renderSwatches();
        schedule();
      });
      swatches.appendChild(b);
    }
    {
      const on = cfg.background.type === 'folder';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (on && cfg.lastPick ? '' : ' swatch-add');
      b.title = '从壁纸文件夹里随机轮换';
      b.setAttribute('aria-label', '壁纸文件夹轮换');
      b.setAttribute('role', 'radio');
      if (on && cfg.lastPick) b.style.backgroundImage = `url("${api.fileUrl(cfg.lastPick)}")`;
      else b.textContent = '文件夹轮换';
      b.setAttribute('aria-checked', String(on));
      b.addEventListener('click', () => chooseFolderMode());
      swatches.appendChild(b);
    }
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

  // ---------- 文件夹轮换 ----------
  const rotateBar = $('rotateBar');
  function syncRotateBar() {
    const on = cfg.background.type === 'folder';
    rotateBar.hidden = !on;
    if (!on) return;
    const f = cfg.background.folder || cfg.rotateFolder || '';
    $('rotateFolder').textContent = f ? '\u200E' + f : '';
    $('rotateFolder').title = f;
    $('rotateMinutes').value = String(cfg.rotateMinutes ?? 30);
  }
  async function useFolder(folder) {
    const r = await api.nextPick(folder);
    if (!r.ok) { setStatus(r.error, 'err'); return false; }
    cfg.rotateFolder = folder;
    cfg.lastPick = r.path;
    cfg.background = { type: 'folder', folder };
    imageCache.delete(r.path);
    return true;
  }
  async function chooseFolderMode(forceChoose) {
    let folder = forceChoose ? '' : (cfg.background.folder || (await api.defaultFolder()));
    if (!folder) folder = await api.chooseFolder();
    if (!folder) return;
    if (!(await useFolder(folder))) return;
    syncRotateBar();
    renderSwatches();
    schedule();
  }
  $('rotateChange').addEventListener('click', () => chooseFolderMode(true));
  $('rotateMinutes').addEventListener('change', (e) => { cfg.rotateMinutes = Number(e.target.value); schedule(); });
  $('rotateNow').addEventListener('click', async () => {
    if (!(await useFolder(cfg.background.folder || cfg.rotateFolder))) return;
    renderSwatches();
    await refreshPreview();
    applyWallpaper(false);
  });

  const restoreBtn = $('restore');
  function useOriginal(p) {
    cfg.originalWallpaper = p;
    imageCache.delete(p);
    restoreBtn.hidden = !p;
  }
  // 读取系统当前壁纸；如果是你自己的壁纸就备份成「原壁纸」
  async function syncOriginal() {
    const r = await api.captureOriginal();
    if (r.ok && r.path !== cfg.originalWallpaper) useOriginal(r.path);
    else restoreBtn.hidden = !cfg.originalWallpaper;
    return r;
  }
  restoreBtn.hidden = !cfg.originalWallpaper;
  renderSwatches();

  // ---------- 应用 ----------
  const applyBtn = $('apply'), status = $('status');
  function setStatus(text, kind) {
    status.textContent = text;
    status.title = text;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }
  async function applyWallpaper(silent) {
    applyBtn.disabled = true;
    if (!silent) setStatus('正在生成壁纸…');
    try {
      screenSize = await api.screenSize();
      if (cfg.background.type === 'folder' && !cfg.lastPick) {
        if (!(await useFolder(cfg.background.folder || cfg.rotateFolder))) return;
      }
      if (cfg.background.type === 'original') {
        const r = await syncOriginal();
        if (!r.ok) { setStatus('没能读取原壁纸：' + r.error, 'err'); return; }
      }
      const c = document.createElement('canvas');
      await renderTo(c, cfg, screenSize.width, screenSize.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await api.applyWallpaper(bytes);
      if (res.ok) {
        const t = new Date();
        const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        // 这个 App 这边只要 0.2 秒；之后是系统自己切换壁纸，有一两秒的过渡
        setStatus(`已应用 ${hhmm}，系统正在切换壁纸…`, 'ok');
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => setStatus(`已应用 ${hhmm}`, 'ok'), 2500);
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
  restoreBtn.addEventListener('click', async () => {
    restoreBtn.disabled = true;
    setStatus('正在恢复原壁纸…');
    showRestored(await api.restoreWallpaper());
    restoreBtn.disabled = false;
  });
  function showRestored(r) {
    setStatus(r.ok ? '已恢复原壁纸' : '没能恢复：' + r.error, r.ok ? 'ok' : 'err');
  }
  api.onRestored(showRestored);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      applyBtn.click();
    }
    if (e.key === 'Escape' && !$('fontDrawer').hidden) closeDrawer();
    else if (e.key === 'Escape' && !$('cal').hidden) closeCal();
  });
  api.onAutoApply(async () => {
    const fresh = await api.getConfig();
    cfg = { ...cfg, ...fresh };
    applyWallpaper(true);
    refreshPreview();
  });

  // ---------- 日历提醒 ----------
  const calEl = $('cal'), calScrim = $('calScrim');
  const now0 = new Date();
  let calYear = now0.getFullYear(), calMonth = now0.getMonth();
  let calSel = Cal.todayKey();
  let calKind = 'todo';

  function openCal() {
    calEl.hidden = false;
    calScrim.hidden = false;
    renderCalendar();
    $('calInput').focus();
  }
  function closeCal() {
    calEl.hidden = true;
    calScrim.hidden = true;
    $('calOpen').focus();
  }
  function gotoDate(key) {
    const d = Cal.parseKey(key);
    calYear = d.getFullYear(); calMonth = d.getMonth(); calSel = key;
    renderCalendar();
  }

  function renderCalendar() {
    $('calTitle').textContent = `${calYear}年${calMonth + 1}月`;
    const sum = Cal.summarize(entries);
    const today = Cal.todayKey();
    const grid = $('calGrid');
    grid.innerHTML = '';
    for (const c of Cal.monthGrid(calYear, calMonth)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-cell' + (c.inMonth ? '' : ' is-out') + (c.key === today ? ' is-today' : '') + (c.key === calSel ? ' is-sel' : '');
      b.setAttribute('role', 'gridcell');
      const s = sum[c.key];
      const parts = [];
      if (s) {
        if (s.todo) parts.push(`${s.todo}条待办${s.done === s.todo ? '，已全部完成' : ''}`);
        if (s.note) parts.push(`${s.note}条提醒`);
      }
      b.setAttribute('aria-label', `${Cal.parseKey(c.key).getMonth() + 1}月${c.day}日` + (parts.length ? '，' + parts.join('，') : '，没有安排'));
      const num = document.createElement('span');
      num.textContent = c.day;
      const marks = document.createElement('span');
      marks.className = 'cal-marks';
      if (s) {
        if (s.todo) { const d = document.createElement('i'); d.className = 'dot dot-todo' + (s.done === s.todo ? ' all-done' : ''); marks.appendChild(d); }
        if (s.note) { const d = document.createElement('i'); d.className = 'dot dot-note'; marks.appendChild(d); }
        if (s.todo + s.note > 1) { const n = document.createElement('span'); n.className = 'cal-count'; n.textContent = s.todo + s.note; marks.appendChild(n); }
      }
      b.append(num, marks);
      b.addEventListener('click', () => {
        if (!c.inMonth) { gotoDate(c.key); } else { calSel = c.key; renderCalendar(); }
        $('calInput').focus();
      });
      grid.appendChild(b);
    }
    renderDay();
  }

  function renderDay() {
    const d = Cal.parseKey(calSel);
    const t = $('calDayTitle');
    t.textContent = `${d.getMonth() + 1}月${d.getDate()}日 星期${Cal.weekdayName(d)}`;
    if (calSel === Cal.todayKey()) {
      const tag = document.createElement('span');
      tag.className = 'cal-tag';
      tag.textContent = '今天';
      t.appendChild(tag);
    }
    const list = $('calList');
    list.innerHTML = '';
    const items = Cal.entriesFor(entries, calSel);
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'cal-empty';
      li.textContent = '这一天还没有安排，在下面写一条吧。';
      list.appendChild(li);
    }
    for (const e of items) list.appendChild(entryItem(e));
  }

  $('calForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = $('calInput');
    const text = input.value.trim();
    if (!text) return;
    entries.push({ id: Cal.uid(), date: calSel, kind: calKind, text, done: false, createdAt: Date.now() });
    input.value = '';
    saveEntries();
    entriesChanged(calSel);
    input.focus();
  });
  for (const b of $('calKind').children) {
    b.addEventListener('click', () => {
      calKind = b.dataset.v;
      for (const x of $('calKind').children) x.setAttribute('aria-checked', String(x === b));
    });
  }
  $('calOpen').addEventListener('click', () => { gotoDate(Cal.todayKey()); openCal(); });
  $('calClose').addEventListener('click', closeCal);
  calScrim.addEventListener('click', closeCal);
  $('calPrev').addEventListener('click', () => { const d = new Date(calYear, calMonth - 1, 1); calYear = d.getFullYear(); calMonth = d.getMonth(); renderCalendar(); });
  $('calNext').addEventListener('click', () => { const d = new Date(calYear, calMonth + 1, 1); calYear = d.getFullYear(); calMonth = d.getMonth(); renderCalendar(); });
  $('calToday').addEventListener('click', () => gotoDate(Cal.todayKey()));

  // ---------- 今天：添加、清除、分页 ----------
  let addKind = 'todo';
  $('addKind').addEventListener('click', () => {
    addKind = addKind === 'todo' ? 'note' : 'todo';
    $('addKind').dataset.v = addKind;
    $('addKind').textContent = addKind === 'todo' ? '待办' : '提醒';
    $('addInput').focus();
  });
  $('addForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = $('addInput');
    const text = input.value.trim();
    if (!text) return;
    const date = Cal.todayKey();
    entries.push({ id: Cal.uid(), date, kind: addKind, text, done: false, createdAt: Date.now() });
    input.value = '';
    saveEntries();
    entriesChanged(date);
    input.focus();
  });
  $('todayClear').addEventListener('click', () => {
    const key = Cal.todayKey();
    const ids = new Set(Cal.visibleOn(entries, key).filter((x) => x.kind === 'todo' && x.done).map((x) => x.id));
    const gone = entries.filter((x) => ids.has(x.id));
    if (!gone.length) return;
    entries = entries.filter((x) => !ids.has(x.id));
    saveEntries();
    entriesChanged(key);
    toast(`已清除 ${gone.length} 条已完成的待办`, '撤销', () => { entries.push(...gone); saveEntries(); entriesChanged(key); });
  });
  for (const b of $('tabs').children) {
    b.addEventListener('click', () => {
      for (const x of $('tabs').children) {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-selected', String(x === b));
      }
      $('paneContent').hidden = b.dataset.t !== 'content';
      $('paneStyle').hidden = b.dataset.t !== 'style';
    });
  }
  window.addEventListener('focus', () => { renderToday(); });
  renderToday();

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

  await syncOriginal();
  renderSwatches();
  refreshPreview();
})();
