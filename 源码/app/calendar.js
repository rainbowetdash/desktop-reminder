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
    if (a.kind === 'todo') {
      const da = a.due || '9999-99-99', db = b.due || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1; // 截止日越近越靠前，没设的在后
      if ((a.late || 0) !== (b.late || 0)) return (b.late || 0) - (a.late || 0);
    }
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

  // ---------- 截止日（due）----------
  // 待办可以设一个截止日 due：date 是「从哪天开始提醒」，due 是「最晚哪天要做完」。
  // 标签放在卡片上：还有 N 天 / 明天 due / 今天 due / 已逾期 N 天；
  // 没设截止日的、从以前顺延过来的，就写「昨天的 / N 天前的」。完成了不再显示标签。
  function tagFor(e, key) {
    if (!e || e.kind !== 'todo' || e.done) return null;
    if (e.due) {
      const n = diffDays(key, e.due);
      if (n > 1) return { text: `还有 ${n} 天`, level: n <= 3 ? 'soon' : 'ok' };
      if (n === 1) return { text: '明天 due', level: 'soon' };
      if (n === 0) return { text: '今天 due', level: 'today' };
      return { text: `已逾期 ${-n} 天`, level: 'late' };
    }
    if (e.late > 0) return { text: e.late === 1 ? '昨天的' : `${e.late} 天前的`, level: 'carry' };
    return null;
  }

  // ---------- 重复 ----------
  // repeat = { freq: 'daily' | 'weekdays' | 'weekly' | 'monthly', days: [0..6]（周日=0）, day: 1..31 }
  // 从条目的日期（起始日）开始，每逢符合规则的日子就出现；重复的待办每天单独算完成、不会逾期。
  function occursOn(e, key) {
    const r = e && e.repeat;
    if (!r || key < e.date) return false;
    const d = parseKey(key);
    switch (r.freq) {
      case 'daily': return true;
      case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
      case 'weekly': return (r.days || []).includes(d.getDay());
      case 'monthly': {
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return d.getDate() === Math.min(r.day || 1, last); // 31 号遇到小月，就落在月底
      }
      default: return false;
    }
  }
  function repeatLabel(r) {
    if (!r) return '';
    if (r.freq === 'daily') return '每天';
    if (r.freq === 'weekdays') return '工作日';
    if (r.freq === 'weekly') return '每周' + (r.days || []).map((n) => '日一二三四五六'[n]).join('、');
    if (r.freq === 'monthly') return `每月${r.day}号`;
    return '';
  }
  // 从下拉框的值生成规则（start 是起始日期 key）
  function repeatFromChoice(choice, start) {
    if (choice === 'daily') return { freq: 'daily' };
    if (choice === 'weekdays') return { freq: 'weekdays' };
    if (/^w[0-6]$/.test(choice)) return { freq: 'weekly', days: [Number(choice[1])] };
    if (choice === 'monthly') return { freq: 'monthly', day: parseKey(start).getDate() };
    return null;
  }

  // 某一天要显示的条目（日期就是这一天的，加上这一天正好出现的重复条目）
  function entriesFor(list, key) {
    const out = [];
    for (const e of list || []) {
      if (e.repeat) { if (occursOn(e, key)) out.push({ ...e, done: e.kind === 'todo' && e.doneOn === key, recurring: true }); }
      else if (e.date === key) out.push(e);
    }
    return out.sort(byOrder);
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
      if (e.repeat) {
        if (occursOn(e, key)) out.push({ ...e, late: 0, done: e.kind === 'todo' && e.doneOn === key, recurring: true });
        continue;
      }
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
      if (e.repeat) continue; // 重复的不算在日历圆点里（不然每天都有点）
      const s = out[e.date] || (out[e.date] = { todo: 0, done: 0, note: 0, due: 0 });
      if (e.kind === 'todo') { s.todo++; if (e.done) s.done++; } else s.note++;
      if (e.kind === 'todo' && e.due && !e.done) { // 截止日那天的格子上标一个红点
        const d = out[e.due] || (out[e.due] = { todo: 0, done: 0, note: 0, due: 0 });
        d.due++;
      }
    }
    return out;
  }

  function uid() {
    return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  window.Cal = { keyOf, todayKey, parseKey, weekdayName, monthGrid, entriesFor, visibleOn, tagFor, occursOn, repeatLabel, repeatFromChoice, byOrder, assignRanks, diffDays, summarize, uid };
})();
