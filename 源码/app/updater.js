// 自动更新：每隔一天检查一次 GitHub 上的最新版本；
// 有新版本 → 先弹窗问用户 → 同意后下载 → 校验 → 覆盖安装 → 自动重启。
// macOS：下载 dmg，挂载后把新的 .app 复制出来，退出旧 App，替换，再打开。出错会自动还原旧版。
// Windows：下载安装包，退出后静默运行（/S），再打开。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const DAY = 24 * 3600 * 1000;
const REPO = 'rainbowetdash/desktop-reminder';
const API = process.env.DR_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

function parseVer(v) { return String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0); }
function newerThan(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, ...(opts || {}) }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').toString().trim()));
      else resolve(stdout.toString());
    });
  });
}

// bash 单引号转义
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function pickAsset(assets, version) {
  let want = '';
  if (process.platform === 'darwin') want = `DesktopReminder-${version}-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg`;
  else if (process.platform === 'win32') want = `DesktopReminder-${version}-windows-setup.exe`;
  const a = (assets || []).find((x) => x.name === want);
  if (!a) return null;
  return {
    name: a.name,
    url: a.browser_download_url,
    size: a.size,
    sha256: /^sha256:([0-9a-f]{64})$/i.test(a.digest || '') ? a.digest.slice(7).toLowerCase() : '',
  };
}

module.exports = function setupUpdater(ctx) {
  const { app, dialog, net, shell, BrowserWindow, ipcMain, getWin, loadConfig, saveConfig, requestQuit, onStateChange } = ctx;
  const currentVersion = () => process.env.DR_FAKE_VERSION || app.getVersion();

  let busy = false;
  let pending = null; // 用户选了「以后再说」的新版本信息，托盘菜单里会一直提示

  async function fetchLatest() {
    const res = await net.fetch(API, { headers: { 'User-Agent': 'desktop-reminder', Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('无法识别版本号');
    return { latest, notes: String(j.body || '').trim(), asset: pickAsset(j.assets, latest) };
  }

  // ---------- 更新进度窗口 ----------
  let pwin = null;
  let pstate = null;
  let abortCtl = null;
  function pushState(st) {
    pstate = { ...(pstate || {}), ...st };
    if (pwin && !pwin.isDestroyed() && pwin.webContents && !pwin.webContents.isLoading()) pwin.webContents.send('update:progress', pstate);
    const dl = pstate.stage === 'download' && pstate.total ? pstate.got / pstate.total : null;
    onStateChange({ downloading: pstate.stage === 'download' ? (dl === null ? 0 : dl) : null });
    const w = getWin();
    try { if (w) w.setProgressBar(dl === null ? -1 : dl); } catch {}
  }
  function openProgress(version) {
    pstate = { stage: 'download', version, from: currentVersion(), got: 0, total: 0, speed: 0 };
    if (pwin && !pwin.isDestroyed()) pwin.close();
    pwin = new BrowserWindow({
      width: 460, height: 290, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: '更新桌面提醒', show: false, alwaysOnTop: true,
      backgroundColor: '#EEF0F5',
      webPreferences: { preload: path.join(__dirname, 'update-preload.js'), contextIsolation: true, sandbox: false },
    });
    pwin.setMenuBarVisibility(false);
    pwin.loadFile(path.join(__dirname, 'update.html'));
    pwin.once('ready-to-show', () => pwin && pwin.show());
    pwin.webContents.on('did-finish-load', () => { if (pstate) pwin.webContents.send('update:progress', pstate); });
    // 下载中关窗口 = 取消更新
    pwin.on('close', () => { if (abortCtl && pstate && pstate.stage === 'download') abortCtl.abort(); });
    pwin.on('closed', () => { pwin = null; });
  }
  function closeProgress() { if (pwin && !pwin.isDestroyed()) { pstate = null; pwin.destroy(); } pwin = null; }
  if (ipcMain) ipcMain.on('update:cancel', () => { if (abortCtl) abortCtl.abort(); });

  // ---------- 下载 ----------
  async function download(asset) {
    const dir = path.join(os.tmpdir(), 'desktop-reminder-update');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, asset.name);
    abortCtl = new AbortController();
    const res = await net.fetch(asset.url, { headers: { 'User-Agent': 'desktop-reminder' }, signal: abortCtl.signal });
    if (!res.ok || !res.body) throw new Error('下载失败：HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(dest);
    let got = 0, lastT = Date.now(), lastGot = 0, speed = 0;
    pushState({ stage: 'download', total, got: 0, speed: 0 });
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (now - lastT >= 400) { // 约每 0.4 秒刷新一次进度和速度
        const inst = ((got - lastGot) / (now - lastT)) * 1000;
        speed = speed ? speed * 0.6 + inst * 0.4 : inst;
        lastT = now; lastGot = got;
        pushState({ got, total, speed });
      }
    }
    abortCtl = null;
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    pushState({ stage: 'verify', got, total });
    if (asset.size && got !== asset.size) throw new Error(`下载不完整（${got} / ${asset.size} 字节）`);
    const sum = hash.digest('hex');
    if (asset.sha256 && sum !== asset.sha256) throw new Error('下载的文件校验不通过，已放弃安装');
    return dest;
  }

  // ---------- 安装 ----------
  const relaunchArgs = (version) => [...process.argv.slice(1).filter((a) => !a.startsWith('--updated=')), `--updated=${version}`];

  async function installMac(dmg, version) {
    const exe = app.getPath('exe'); // …/桌面提醒.app/Contents/MacOS/Electron
    const dest = path.resolve(exe, '..', '..', '..');
    if (!dest.endsWith('.app')) throw new Error('当前不是正式安装的 App，不能自动覆盖安装');
    try { fs.accessSync(path.dirname(dest), fs.constants.W_OK); } catch { throw new Error(`没有权限修改 ${path.dirname(dest)}，请手动下载安装`); }
    const work = path.dirname(dmg);
    const mnt = path.join(work, 'mnt');
    fs.mkdirSync(mnt, { recursive: true });
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-mountpoint', mnt, dmg]);
    const staged = path.join(work, 'staged', path.basename(dest));
    try {
      const src = fs.readdirSync(mnt).find((f) => f.endsWith('.app'));
      if (!src) throw new Error('安装包里没有找到应用');
      const ver = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(mnt, src, 'Contents', 'Info.plist')])).trim();
      if (ver !== version) throw new Error(`安装包版本是 ${ver}，和预期的 ${version} 不一致`);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      await run('/usr/bin/ditto', [path.join(mnt, src), staged]);
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mnt, '-force']).catch(() => {});
    }
    // 退出后由脚本完成替换：先把旧版挪开，复制新版；失败就还原旧版；最后重新打开
    const script = path.join(work, 'swap.sh');
    fs.writeFileSync(script, `#!/bin/bash
PID=$1; STAGED=$2; DEST=$3; shift 3
for i in $(seq 1 60); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
rm -rf "$DEST.old"
if mv "$DEST" "$DEST.old"; then
  if /usr/bin/ditto "$STAGED" "$DEST"; then rm -rf "$DEST.old"; else rm -rf "$DEST"; mv "$DEST.old" "$DEST"; fi
fi
rm -rf "$STAGED"
/usr/bin/open -a "$DEST" --args "$@" || ( "$DEST/Contents/MacOS/Electron" "$@" >/dev/null 2>&1 & )
`, { mode: 0o755 });
    spawn('/bin/bash', [script, String(process.pid), staged, dest, ...relaunchArgs(version)], { detached: true, stdio: 'ignore' }).unref();
  }

  function installWin(setup, version) {
    const script = path.join(path.dirname(setup), 'swap.cmd');
    const args = relaunchArgs(version).map((a) => `"${a}"`).join(' ');
    fs.writeFileSync(script, `@echo off\r\ntimeout /t 3 /nobreak >nul\r\n"${setup}" /S\r\ntimeout /t 2 /nobreak >nul\r\nstart "" "${process.execPath}" ${args}\r\n`);
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }

  // ---------- 流程：询问 → 下载 → 安装 ----------
  // 是不是「正式装好的 App」：开发时用 electron . 运行的不能覆盖自己。
  // 注意不能只看 app.isPackaged——我们的 macOS 安装包里程序文件就叫 Electron，Electron 会误以为是开发模式，
  // 导致 isPackaged 一直是 false（2.10.0 的 bug：下载完只弹「开发模式不会覆盖安装」）。
  function canSelfInstall() {
    if (process.defaultApp) return false;
    if (app.isPackaged) return true;
    if (process.platform === 'darwin') return /\.app\/Contents\/MacOS\/[^/]+$/.test(process.execPath) && fs.existsSync(path.join(process.resourcesPath, 'app'));
    return false;
  }

  async function downloadAndInstall(info) {
    try {
      openProgress(info.latest);
      const file = await download(info.asset);
      if (!canSelfInstall() && !process.env.DR_UPDATE_FORCE_INSTALL) {
        closeProgress();
        onStateChange({ downloading: null });
        await dialog.showMessageBox({ type: 'info', message: '下载完成（开发模式不会覆盖安装）', detail: file });
        return;
      }
      pushState({ stage: 'install' });
      if (process.platform === 'darwin') await installMac(file, info.latest);
      else if (process.platform === 'win32') installWin(file, info.latest);
      else throw new Error('这个系统暂不支持自动安装');
      pending = null;
      pushState({ stage: 'restart' });
      setTimeout(() => requestQuit(), 1500); // 让用户看到「即将重启」；退出后由脚本接手：替换并重新打开
    } catch (e) {
      const cancelled = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      abortCtl = null;
      closeProgress();
      onStateChange({ downloading: null });
      try { fs.rmSync(path.join(os.tmpdir(), 'desktop-reminder-update'), { recursive: true, force: true }); } catch {} // 清掉没用的下载
      if (cancelled) return;
      const b = await dialog.showMessageBox({ type: 'warning', message: '更新没有成功', detail: (e.message || String(e)) + '\n\n当前版本不受影响，可以继续使用。', buttons: ['打开下载页手动安装', '关闭'], defaultId: 1, cancelId: 1 });
      if (b.response === 0) shell.openExternal(RELEASES_URL);
    }
  }

  async function promptAndUpdate(info) {
    busy = true; // 弹窗和下载期间，不再触发别的检查
    try { await promptAndUpdateInner(info); } finally { busy = false; }
  }

  async function promptAndUpdateInner(info) {
    const mb = info.asset && info.asset.size ? `（约 ${(info.asset.size / 1048576).toFixed(0)} MB）` : '';
    const notes = info.notes ? '\n\n更新内容：\n' + info.notes.slice(0, 400) : '';
    let resp = 0;
    if (!process.env.DR_UPDATE_AUTO_ACCEPT) {
      const b = await dialog.showMessageBox({
        type: 'info',
        message: `发现新版本 ${info.latest}`,
        detail: `当前版本 ${currentVersion()}${notes}\n\n同意后会自动下载${mb}并覆盖安装，完成后 App 会自动重启。`,
        buttons: info.asset ? ['下载并安装', '以后再说', '跳过这个版本'] : ['去下载页', '以后再说', '跳过这个版本'],
        defaultId: 0,
        cancelId: 1,
      });
      resp = b.response;
    }
    if (resp === 2) {
      saveConfig({ skipVersion: info.latest });
      pending = null;
      onStateChange({});
      return;
    }
    if (resp === 1) { pending = info; onStateChange({}); return; }
    if (!info.asset) { shell.openExternal(RELEASES_URL); return; }
    await downloadAndInstall(info);
  }

  // ---------- 对外：手动检查 / 自动检查 ----------
  async function checkNow() {
    if (busy) return;
    busy = true;
    let info;
    try { info = await fetchLatest(); } catch (e) {
      busy = false;
      dialog.showMessageBox({ type: 'warning', message: '检查更新失败', detail: '请检查网络后再试。\n' + (e.message || e) });
      return;
    }
    busy = false;
    saveConfig({ lastUpdateCheck: Date.now() });
    if (!newerThan(info.latest, currentVersion())) {
      pending = null;
      onStateChange({});
      dialog.showMessageBox({ type: 'info', message: '已是最新版本', detail: '当前版本 ' + currentVersion() });
      return;
    }
    await promptAndUpdate(info);
  }

  async function autoCheck() {
    const c = loadConfig();
    if (c.autoUpdate === false || busy) return;
    if (Date.now() - (c.lastUpdateCheck || 0) < DAY) return; // 间隔一天
    let info;
    try { info = await fetchLatest(); } catch { return; } // 没网就算了，过一会儿再试
    saveConfig({ lastUpdateCheck: Date.now() });
    if (!newerThan(info.latest, currentVersion())) { pending = null; onStateChange({}); return; }
    if (c.skipVersion === info.latest) return;
    await promptAndUpdate(info);
  }

  function start() {
    const first = process.env.DR_UPDATE_NOW ? 3000 : 30000;
    setTimeout(autoCheck, first);
    setInterval(autoCheck, 30 * 60 * 1000); // 每半小时看一眼是不是该检查了
  }

  return {
    start,
    checkNow,
    autoCheck,
    getPending: () => pending,
    isBusy: () => busy,
    resumeCheck: () => setTimeout(autoCheck, 10000),
  };
};

module.exports.newerThan = newerThan;
module.exports.pickAsset = pickAsset;
