// 壁纸绘制：预览和真正的壁纸用同一套代码
(function () {
  const FALLBACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC",system-ui,sans-serif';

  function fontStack(family) {
    return (family ? `"${family}", ` : '') + FALLBACK;
  }

  function dateString() {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日  星期${'日一二三四五六'[d.getDay()]}`;
  }

  // 待办框：行首（可在 - 或 1. 之后）写 [ ] 或 [x]
  const BOX = /^\[([ xX✓√✔]?)\]\s*(.*)$/;

  function parseLines(text) {
    return (text || '').split('\n').map((raw, idx) => {
      const t = raw.trim();
      if (!t) return { kind: 'gap' };
      const pm = t.match(/^(?:[-*•·]|\d{1,3}[.、)）])\s*(.*)$/);
      const bm = (pm ? pm[1] : t).match(BOX);
      if (bm) return { kind: 'todo', done: bm[1].trim() !== '', body: bm[2], idx };
      let m = t.match(/^[-*•·]\s*(.*)$/);
      if (m) return { kind: 'bullet', marker: '•', body: m[1] };
      m = t.match(/^(\d{1,3})[.、)）]\s*(.*)$/);
      if (m) return { kind: 'num', marker: m[1] + '.', body: m[2] };
      return { kind: 'plain', body: t };
    });
  }

  const NO_START = '，。、！？；：）》」』】,.!?;:)]}%';

  function wrap(ctx, text, maxW) {
    if (!text) return [''];
    const tokens = text.match(/[A-Za-z0-9À-ɏ'’_\-.,:;!?%/@#&+=()[\]"]+|\s+|[\s\S]/gu) || [];
    const out = [];
    let line = '';
    for (const tok of tokens) {
      const cand = line + tok;
      if (ctx.measureText(cand).width <= maxW || !line) {
        if (!line && /^\s+$/.test(tok)) continue;
        if (ctx.measureText(tok).width > maxW) {
          // 超长的单词按字拆
          for (const ch of tok) {
            if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
            else line += ch;
          }
        } else {
          line = cand;
        }
      } else if (NO_START.includes(tok)) {
        line = cand; // 标点不放行首
      } else {
        out.push(line.trimEnd());
        line = /^\s+$/.test(tok) ? '' : tok;
      }
    }
    if (line) out.push(line.trimEnd());
    return out.length ? out : [''];
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function paintBackground(ctx, W, H, bg, img) {
    if (bg && (bg.type === 'image' || bg.type === 'original' || bg.type === 'folder') && img && img.naturalWidth) {
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return;
    }
    const preset = window.BG_PRESETS.find((p) => p.id === (bg && bg.id)) || window.BG_PRESETS[0];
    const g = ctx.createLinearGradient(W * 0.15, 0, W * 0.6, H);
    preset.stops.forEach((c, i) => g.addColorStop(i / (preset.stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = ctx.createRadialGradient(W * 0.82, H * 0.12, 0, W * 0.82, H * 0.12, Math.max(W, H) * 0.6);
    r.addColorStop(0, preset.glow);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * cfg: 设置；W/H：像素尺寸；opts: { image, family, bold }
   */
  function renderWallpaper(canvas, cfg, W, H, opts) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 背景先画到一张单独的画布上，方便做毛玻璃
    const bgc = document.createElement('canvas');
    bgc.width = W; bgc.height = H;
    paintBackground(bgc.getContext('2d'), W, H, cfg.background, opts.image);
    ctx.drawImage(bgc, 0, 0);

    const base = (cfg.fontSize || 32) * H / 1080;
    const stack = fontStack(opts.family);
    const titleWeight = opts.bold ? 700 : (opts.family ? 400 : 600);
    const F = {
      title: `${titleWeight} ${base * 1.45}px ${stack}`,
      date: `400 ${base * 0.68}px ${stack}`,
      body: `400 ${base}px ${stack}`,
    };

    const maxTextW = W * (cfg.position && cfg.position[1] === 'c' ? 0.42 : 0.34);
    const lines = parseLines(cfg.text);
    // 日历里属于这一天的条目，接在常驻内容后面
    const extra = (opts && opts.entries) || [];
    if (extra.length) {
      if (lines.some((l) => l.kind !== 'gap')) lines.push({ kind: 'divider', body: '今日安排' });
      for (const e of extra) {
        lines.push(e.kind === 'todo'
          ? { kind: 'todo', done: !!e.done, body: e.text, idx: -1, entryId: e.id }
          : { kind: 'bullet', marker: '•', body: e.text });
      }
    }

    ctx.font = F.body;
    const bulletIndent = base * 1.1;
    let numIndent = 0;
    for (const l of lines) if (l.kind === 'num') numIndent = Math.max(numIndent, ctx.measureText(l.marker).width + base * 0.5);

    // 排版
    const todoIndent = base * 1.4;
    const rows = []; // {font, text, x(offset), h, color, marker}
    let natural = 0;
    const title = (cfg.title || '').trim();
    if (title) {
      ctx.font = F.title;
      for (const t of wrap(ctx, title, maxTextW)) {
        natural = Math.max(natural, ctx.measureText(t).width);
        rows.push({ font: F.title, text: t, x: 0, h: base * 1.45 * 1.28, role: 'title' });
      }
    }
    const todos = lines.filter((l) => l.kind === 'todo');
    const doneCount = todos.filter((l) => l.done).length;
    if (cfg.showDate || todos.length) {
      ctx.font = F.date;
      let d = cfg.showDate ? dateString() : '';
      if (todos.length) d += (d ? '  ·  ' : '') + `已完成 ${doneCount}/${todos.length}`;
      natural = Math.max(natural, ctx.measureText(d).width);
      rows.push({ font: F.date, text: d, x: 0, h: base * 0.68 * 1.5, role: 'sub', gapBefore: base * 0.05 });
    }
    const headGap = rows.length ? base * 0.7 : 0;
    let first = true;
    ctx.font = F.body;
    for (const l of lines) {
      if (l.kind === 'gap') { rows.push({ gap: base * 0.55 }); continue; }
      if (l.kind === 'divider') {
        ctx.font = F.date;
        natural = Math.max(natural, ctx.measureText(l.body).width);
        rows.push({ font: F.date, text: l.body, x: 0, h: base * 0.68 * 1.5, role: 'sub', gapBefore: base * 0.55 });
        ctx.font = F.body;
        first = false;
        continue;
      }
      const indent = l.kind === 'bullet' ? bulletIndent : l.kind === 'num' ? numIndent : l.kind === 'todo' ? todoIndent : 0;
      const parts = wrap(ctx, l.body, maxTextW - indent);
      parts.forEach((p, i) => {
        natural = Math.max(natural, indent + ctx.measureText(p).width);
        rows.push({
          font: F.body, text: p, x: indent, h: base * 1.48, role: 'body',
          marker: i === 0 && l.kind !== 'plain' && l.kind !== 'todo' ? l.marker : null,
          markerKind: l.kind,
          todo: l.kind === 'todo' ? { done: l.done, first: i === 0, line: l.idx, entryId: l.entryId } : null,
          gapBefore: first ? headGap : (i === 0 ? base * 0.28 : 0),
        });
        first = false;
      });
    }
    if (first && rows.length) rows.push({ gap: 0 });

    const padX = base * 1.15, padY = base * 1.0;
    const innerW = Math.min(maxTextW, Math.max(natural, base * 7));
    const pw = innerW + padX * 2;
    let contentH = 0;
    for (const r of rows) contentH += (r.gap || 0) + (r.gapBefore || 0) + (r.h || 0);
    const ph = contentH + padY * 2;

    const mx = W * 0.045, top = H * 0.065, bottom = H * 0.085;
    const pos = cfg.position || 'tr';
    const x = pos[1] === 'l' ? mx : pos[1] === 'c' ? (W - pw) / 2 : W - pw - mx;
    const y = pos[0] === 't' ? top : pos[0] === 'c' ? (H - ph) / 2 : H - ph - bottom;

    // 面板
    const style = cfg.panel || 'dark';
    const alpha = cfg.panelOpacity == null ? 0.55 : cfg.panelOpacity;
    const radius = base * 0.85;
    let ink = '#FFFFFF', sub = 'rgba(255,255,255,0.62)', mark = 'rgba(255,255,255,0.55)';
    if (style === 'dark' || style === 'light') {
      const blur = Math.max(4, base * 0.9);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = base * 1.6;
      ctx.shadowOffsetY = base * 0.35;
      roundRectPath(ctx, x, y, pw, ph, radius);
      ctx.fillStyle = 'rgba(0,0,0,0.01)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRectPath(ctx, x, y, pw, ph, radius);
      ctx.clip();
      ctx.filter = `blur(${blur}px) saturate(1.25)`;
      const m = blur * 3;
      ctx.drawImage(bgc, x - m, y - m, pw + m * 2, ph + m * 2, x - m, y - m, pw + m * 2, ph + m * 2);
      ctx.filter = 'none';
      ctx.fillStyle = style === 'dark' ? `rgba(14,16,26,${alpha})` : `rgba(250,250,253,${alpha})`;
      ctx.fillRect(x, y, pw, ph);
      ctx.restore();

      roundRectPath(ctx, x + 0.5, y + 0.5, pw - 1, ph - 1, radius);
      ctx.lineWidth = Math.max(1, base * 0.035);
      ctx.strokeStyle = style === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.55)';
      ctx.stroke();
      if (style === 'light') {
        ink = '#1D2030'; sub = 'rgba(29,32,48,0.58)'; mark = 'rgba(29,32,48,0.45)';
      }
    }

    // 文字
    ctx.textBaseline = 'alphabetic';
    if (style === 'clear') {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = base * 0.45;
      ctx.shadowOffsetY = base * 0.06;
    }
    const hits = [];
    const accent = '#5B7CFA';
    let cy = y + padY;
    for (const r of rows) {
      cy += (r.gap || 0) + (r.gapBefore || 0);
      if (!r.h) continue;
      const size = parseFloat(r.font.split(' ')[1]);
      const baseline = cy + (r.h - size) / 2 + size * 0.86;
      ctx.font = r.font;
      if (r.marker) {
        ctx.fillStyle = mark;
        if (r.markerKind === 'bullet') {
          ctx.beginPath();
          ctx.arc(x + padX + base * 0.28, baseline - size * 0.33, base * 0.13, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillText(r.marker, x + padX, baseline);
        }
      }
      const done = !!(r.todo && r.todo.done);
      if (r.todo && r.todo.first) {
        const bs = base * 0.66;
        const bx = x + padX + base * 0.04, by = baseline - size * 0.86 + (r.h - bs) / 2 + base * 0.02;
        ctx.save();
        ctx.shadowColor = 'transparent';
        roundRectPath(ctx, bx, by, bs, bs, bs * 0.24);
        if (done) {
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = bs * 0.14;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(bx + bs * 0.24, by + bs * 0.53);
          ctx.lineTo(bx + bs * 0.43, by + bs * 0.72);
          ctx.lineTo(bx + bs * 0.77, by + bs * 0.30);
          ctx.stroke();
        } else {
          ctx.strokeStyle = mark;
          ctx.lineWidth = Math.max(1.2, base * 0.07);
          ctx.stroke();
        }
        ctx.restore();
        hits.push({ line: r.todo.line, entryId: r.todo.entryId, x: bx - base * 0.3, y: cy, w: bs + base * 0.6, h: r.h });
      }
      ctx.save();
      if (done) ctx.globalAlpha = 0.42;
      ctx.fillStyle = r.role === 'sub' ? sub : ink;
      ctx.fillText(r.text, x + padX + r.x, baseline);
      if (done && r.text) {
        const tw = ctx.measureText(r.text).width;
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, base * 0.05);
        ctx.beginPath();
        ctx.moveTo(x + padX + r.x, baseline - size * 0.3);
        ctx.lineTo(x + padX + r.x + tw, baseline - size * 0.3);
        ctx.stroke();
      }
      ctx.restore();
      cy += r.h;
    }
    ctx.shadowColor = 'transparent';
    return { panel: { x, y, w: pw, h: ph }, hits, progress: { done: doneCount, total: todos.length } };
  }

  window.WallpaperRenderer = { renderWallpaper, paintBackground, fontStack, dateString };
})();
