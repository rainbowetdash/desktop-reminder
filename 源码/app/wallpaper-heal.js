// 修复「灰色壁纸」：
// macOS 给每一个桌面空间（Space，全屏 App 也算一个）各自记着「用哪张壁纸文件」。
// 我们换新壁纸时只改了当前这个空间，别的空间仍然指着以前的壁纸文件；
// 如果那些旧文件被删掉，那些空间就变成灰色（系统设置里是云朵感叹号）。
// 所以：① 旧壁纸文件不能随便删；② 对于已经被删掉、但系统还在引用的文件名，
// 用「硬链接」补回来，让它们指向当前最新的壁纸（不占额外空间）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const INDEX = path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.wallpaper', 'Store', 'Index.plist');

function plistXml() {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', INDEX], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(String(out))));
  });
}

// 读出系统里所有指向 dir 目录下文件的壁纸引用（只读，不修改系统设置）
async function referencedNames(dir) {
  const xml = await plistXml();
  const names = new Set();
  const prefix = path.resolve(dir) + path.sep;
  for (const m of xml.matchAll(/<data>([\s\S]*?)<\/data>/g)) {
    let text;
    try { text = Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('latin1'); } catch { continue; }
    for (const u of text.match(/file:\/\/\/[A-Za-z0-9%._\-\/~+]+/g) || []) {
      let p;
      try { p = decodeURIComponent(u.replace('file://', '')); } catch { continue; }
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes(path.sep)) names.add(p.slice(prefix.length));
    }
  }
  return names;
}

// 让 dir 里除 keep 之外的「旧名字」全部是指向 current 的硬链接（缺的补上，已经有的刷新成最新内容）
async function heal(dir, current, keep) {
  keep = new Set(keep || []);
  if (!fs.existsSync(current)) return { linked: 0, error: '当前壁纸文件不存在' };
  const names = new Set();
  for (const f of fs.readdirSync(dir)) if (/\.(png|jpe?g)$/i.test(f)) names.add(f);
  try { for (const n of await referencedNames(dir)) names.add(n); } catch { /* 读不到系统配置就只处理目录里已有的 */ }
  const cur = fs.statSync(current);
  let linked = 0, same = 0;
  for (const n of names) {
    if (keep.has(n) || path.join(dir, n) === current) continue;
    const dest = path.join(dir, n);
    try {
      const st = fs.statSync(dest, { throwIfNoEntry: false });
      if (st && st.ino === cur.ino && st.dev === cur.dev) { same++; continue; }
      const tmp = dest + '.lnk';
      fs.rmSync(tmp, { force: true });
      fs.linkSync(current, tmp);
      fs.renameSync(tmp, dest);
      linked++;
    } catch { /* 单个失败不影响其他 */ }
  }
  return { linked, same, total: names.size };
}

module.exports = { referencedNames, heal, INDEX };
