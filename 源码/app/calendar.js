// 日历提醒：和界面无关的日期、条目逻辑
(function () {
  const pad = (n) => String(n).padStart(2, '0');

  function keyOf(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function todayKey() { return keyOf(new Date()); }
  function parseKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function weekdayName(d) { return '日一二三四五六'[d.getDay()]; }

  // 月历：周一开头，固定 6 行 × 7 列
  function monthGrid(year, month) {
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(year, month, 1 - lead + i);
      return { key: keyOf(d), day: d.getDate(), inMonth: d.getMonth() === month };
    });
  }

  // 某一天要显示的条目：待办在前、提醒在后，同类按添加顺序
  function entriesFor(list, key) {
    return (list || [])
      .filter((e) => e.date === key)
      .sort((a, b) => (a.kind === b.kind ? (a.createdAt || 0) - (b.createdAt || 0) : a.kind === 'todo' ? -1 : 1));
  }

  function diffDays(fromKey, toKey) {
    const a = parseKey(fromKey), b = parseKey(toKey);
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  }

  // 某一天桌面上要显示的全部内容：
  //  1. 日期就是这一天的条目；
  //  2. 以前的、还没完成的待办——自动顺延到今天，带上 late（逾期天数）；
  //  3. 以前的待办如果恰好是今天完成的，今天还留着（划掉），明天就消失。
  // 返回的是副本（带 late 和按这一天算出的 done），要改数据请按 id 找原条目。
  function visibleOn(list, key) {
    const out = [];
    for (const e of list || []) {
      if (e.date === key) out.push({ ...e, late: 0 });
      else if (e.kind === 'todo' && e.date < key) {
        const late = diffDays(e.date, key);
        if (!e.done) out.push({ ...e, late });
        else if (e.doneOn === key) out.push({ ...e, done: true, late });
      }
    }
    return out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'todo' ? -1 : 1;
      if (a.kind === 'todo' && a.late !== b.late) return b.late - a.late; // 越久远的越靠前
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  // 每个日期的概况，用来画日历上的小圆点
  function summarize(list) {
    const out = {};
    for (const e of list || []) {
      const s = out[e.date] || (out[e.date] = { todo: 0, done: 0, note: 0 });
      if (e.kind === 'todo') { s.todo++; if (e.done) s.done++; } else s.note++;
    }
    return out;
  }

  function uid() {
    return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  window.Cal = { keyOf, todayKey, parseKey, weekdayName, monthGrid, entriesFor, visibleOn, diffDays, summarize, uid };
})();
