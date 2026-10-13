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

  window.Cal = { keyOf, todayKey, parseKey, weekdayName, monthGrid, entriesFor, summarize, uid };
})();
