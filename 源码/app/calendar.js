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

  // 排序规则：拖动排过先后的（有 rank）按 rank 从小到大，越靠前越重要；
  // 没排过的（比如新加的）排在后面：标了重要的在前，待办在提醒前，越逾期越靠前，最后按添加顺序
  function byOrder(a, b) {
    const ra = Number.isFinite(a.rank) ? a.rank : Infinity;
    const rb = Number.isFinite(b.rank) ? b.rank : Infinity;
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (!!a.important !== !!b.important) return a.important ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'todo' ? -1 : 1;
    if (a.kind === 'todo' && (a.late || 0) !== (b.late || 0)) return (b.late || 0) - (a.late || 0);
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  // 把一组条目按给定的 id 顺序重新排列。
  // 第一步：先给还没排过名次的条目都补上名次，顺序就是它们现在在屏幕上的先后，所以界面不会跳动；
  // 第二步：这组条目原来占着哪些名次，就在它们之间重新分配，
  //         这样和其他条目的相对先后不会乱（今天的列表、日历里某一天的列表都用这一个）。
  // key 是「现在算哪一天」，默认今天。返回被改动的条数。
  function assignRanks(list, orderedIds, key) {
    list = list || [];
    key = key || todayKey();
    let n = 0;
    const shown = visibleOn(list, key).map((e) => e.id);
    const rest = list.filter((e) => !shown.includes(e.id))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)))
      .map((e) => e.id);
    let top = Math.max(0, ...list.map((e) => e.rank).filter(Number.isFinite));
    for (const id of [...shown, ...rest]) {
      const e = list.find((x) => x.id === id);
      if (e && !Number.isFinite(e.rank)) { top += 1000; e.rank = top; n++; }
    }
    const items = orderedIds.map((id) => list.find((x) => x.id === id)).filter(Boolean);
    const slots = items.map((e) => e.rank).sort((x, y) => x - y);
    items.forEach((e, i) => { if (e.rank !== slots[i]) { e.rank = slots[i]; n++; } });
    return n;
  }

  // 某一天要显示的条目
  function entriesFor(list, key) {
    return (list || []).filter((e) => e.date === key).sort(byOrder);
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
    return out.sort(byOrder);
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

  window.Cal = { keyOf, todayKey, parseKey, weekdayName, monthGrid, entriesFor, visibleOn, byOrder, assignRanks, diffDays, summarize, uid };
})();
