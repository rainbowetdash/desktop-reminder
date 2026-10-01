// 桌面提醒 — 主进程
const {
  app, BrowserWindow, ipcMain, dialog, screen, Tray, Menu,
  nativeImage, nativeTheme, net, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

if (isWin) app.setAppUserModelId('local.desktopnote.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  main();
}

function main() {
  const USER = app.getPath('userData');
  const P = {
    config: path.join(USER, 'config.json'),
    fonts: path.join(USER, 'fonts'),
    bgs: path.join(USER, 'backgrounds'),
    walls: path.join(USER, 'wallpapers'),
  };
  for (const d of [P.fonts, P.bgs, P.walls]) fs.mkdirSync(d, { recursive: true });

  const DEFAULTS = {
    title: '我的提醒',
    text: '- 周五前交报告\n- 给妈妈打电话\n- 买牛奶\n\n记得多喝水 :)',
    showDate: true,
    position: 'tr',
    fontSize: 32,
    panel: 'dark',
    panelOpacity: 0.55,
    font: 'system',
    background: { type: 'preset', id: 'dusk' },
    launchAtLogin: false,
    lastAppliedDate: '',
  };

  let win = null;
  let tray = null;
  let quitting = false;

  // ---------- 设置 ----------
  function migrateOld() {
    // 从旧版（Swift 版）迁移内容和背景图
    if (!isMac) return null;
    const old = path.join(os.homedir(), 'Library', 'Application Support', 'DesktopNote', 'config.json');
    try {
      const o = JSON.parse(fs.readFileSync(old, 'utf8'));
      const pos = { '左上': 'tl', '右上': 'tr', '居中': 'cc', '左下': 'bl', '右下': 'br' };
      const theme = { '深蓝': 'navy', '暮紫': 'dusk', '森绿': 'forest', '暖橙': 'ember', '石墨': 'graphite' };
      const c = { ...DEFAULTS };
      if (typeof o.title === 'string') c.title = o.title;
      if (typeof o.text === 'string') c.text = o.text;
      if (pos[o.position]) c.position = pos[o.position];
      if (o.fontSize) c.fontSize = Math.round(o.fontSize);
      if (typeof o.showDate === 'boolean') c.showDate = o.showDate;
      if (o.panelOpacity) c.panelOpacity = o.panelOpacity;
      if (o.backgroundPath && fs.existsSync(o.backgroundPath)) {
        const dest = path.join(P.bgs, 'bg-' + Date.now() + path.extname(o.backgroundPath));
        fs.copyFileSync(o.backgroundPath, dest);
        c.background = { type: 'image', path: dest };
      } else if (theme[o.theme]) {
        c.background = { type: 'preset', id: theme[o.theme] };
      }
      return c;
    } catch {
      return null;
    }
  }

  function loadConfig() {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(P.config, 'utf8')) };
    } catch {
      const c = migrateOld() || { ...DEFAULTS };
      saveConfig(c);
      return c;
    }
  }
  function saveConfig(c) {
    fs.writeFileSync(P.config, JSON.stringify(c, null, 2));
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // ---------- 窗口 ----------
  function themeColors() {
    const dark = nativeTheme.shouldUseDarkColors;
    return { bg: dark ? '#13151D' : '#EEF0F5', symbol: dark ? '#9AA0B4' : '#5D6378' };
  }

  function createWindow(show) {
    const t = themeColors();
    win = new BrowserWindow({
      width: 1160,
      height: 760,
      minWidth: 980,
      minHeight: 660,
      show: false,
      title: '桌面提醒',
      backgroundColor: t.bg,
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 18, y: 18 },
      ...(isWin ? { titleBarOverlay: { color: t.bg, symbolColor: t.symbol, height: 48 } } : {}),
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    win.loadFile(path.join(__dirname, 'index.html'));
    win.once('ready-to-show', () => { if (show) win.show(); });
    win.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.webContents.on('did-finish-load', () => setTimeout(checkNewDay, 1500));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  function showWin() {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  nativeTheme.on('updated', () => {
    if (isWin && win) {
      const t = themeColors();
      try { win.setTitleBarOverlay({ color: t.bg, symbolColor: t.symbol }); } catch {}
    }
  });

  function createTray() {
    const file = isMac ? 'trayTemplate.png' : 'tray.png';
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
    if (isMac) img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip('桌面提醒');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开桌面提醒', click: showWin },
      { label: '立即更新壁纸', click: () => win && win.webContents.send('auto-apply', { force: true }) },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]));
    if (!isMac) tray.on('click', showWin);
  }

  function buildMenu() {
    if (!isMac) {
      Menu.setApplicationMenu(null);
      return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: '桌面提醒',
        submenu: [
          { role: 'about', label: '关于桌面提醒' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏' },
          { role: 'hideOthers', label: '隐藏其他' },
          { type: 'separator' },
          { label: '退出桌面提醒', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
          { role: 'cut', label: '剪切' }, { role: 'copy', label: '拷贝' }, { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' }] },
    ]));
  }

  // ---------- 壁纸 ----------
  function run(cmd, args) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message || '').toString().trim()));
        else resolve(stdout);
      });
    });
  }

  async function setWallpaper(file) {
    if (isMac) {
      const script = `function run(argv){
        ObjC.import('AppKit');
        var url = $.NSURL.fileURLWithPath(argv[0]);
        var ws = $.NSWorkspace.sharedWorkspace;
        var screens = $.NSScreen.screens;
        for (var i = 0; i < screens.count; i++) {
          ws.setDesktopImageURLForScreenOptionsError(url, screens.objectAtIndex(i), $({}), null);
        }
        return 'ok';
      }`;
      await run('osascript', ['-l', 'JavaScript', '-e', script, file]);
    } else if (isWin) {
      const p = file.replace(/'/g, "''");
      const ps = [
        "$ErrorActionPreference='Stop'",
        "$k='HKCU:\\Control Panel\\Desktop'",
        "Set-ItemProperty -Path $k -Name WallpaperStyle -Value '10'",
        "Set-ItemProperty -Path $k -Name TileWallpaper -Value '0'",
        "New-ItemProperty -Path $k -Name JPEGImportQuality -Value 100 -PropertyType DWord -Force | Out-Null",
        "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class DNWall { [DllImport(\"user32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SystemParametersInfo(int a, int b, string c, int d); }'",
        `if (-not [DNWall]::SystemParametersInfo(20, 0, '${p}', 3)) { throw '系统没有接受这张壁纸' }`,
      ].join('\n');
      const enc = Buffer.from(ps, 'utf16le').toString('base64');
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc]);
    } else {
      throw new Error('这个系统暂不支持自动换壁纸');
    }
  }

  function checkNewDay() {
    const c = loadConfig();
    if (c.lastAppliedDate && c.showDate && c.lastAppliedDate !== today() && win) {
      win.webContents.send('auto-apply', {});
    }
  }

  // ---------- 字体 ----------
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

  function cssUrl(family, weights, text) {
    let u = 'https://fonts.googleapis.com/css2?family=' + family.trim().replace(/ /g, '+');
    if (weights) u += ':wght@' + weights;
    if (text) u += '&text=' + encodeURIComponent(text);
    return u + '&display=block';
  }

  async function fetchText(url) {
    const r = await net.fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('字体服务器返回 ' + r.status);
    return r.text();
  }

  function installedFonts() {
    try {
      return fs.readdirSync(P.fonts).filter((d) => fs.existsSync(path.join(P.fonts, d, 'font.css')));
    } catch {
      return [];
    }
  }

  async function downloadFont(id, family, weights, onProgress) {
    let css;
    try {
      css = await fetchText(cssUrl(family, weights));
    } catch (e) {
      throw new Error('连不上字体服务器，请检查网络后再试');
    }
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    if (!urls.length) throw new Error('没有找到这个字体的文件');
    const tmp = path.join(P.fonts, id + '.part');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const names = new Map();
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < urls.length) {
        const i = next++;
        const u = urls[i];
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await net.fetch(u, { headers: { 'User-Agent': UA } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const buf = Buffer.from(await r.arrayBuffer());
            const name = 'f' + i + path.extname(new URL(u).pathname || '.woff2');
            fs.writeFileSync(path.join(tmp, name), buf);
            names.set(u, name);
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (lastErr) throw new Error('下载中断了，请再试一次');
        done++;
        onProgress(done, urls.length);
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    const local = css.replace(/url\((https:[^)]+)\)/g, (m, u) => `url(${names.get(u)})`);
    fs.writeFileSync(path.join(tmp, 'font.css'), local);
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ id, family, weights }));
    const dest = path.join(P.fonts, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  }

  function fontCss(id) {
    const dir = path.join(P.fonts, id);
    const css = fs.readFileSync(path.join(dir, 'font.css'), 'utf8');
    return css.replace(/url\(([^)]+)\)/g, (m, name) =>
      `url("${pathToFileURL(path.join(dir, name.replace(/["']/g, ''))).href}")`);
  }

  // ---------- IPC ----------
  ipcMain.handle('config:get', () => ({ ...loadConfig(), platform: process.platform }));
  ipcMain.handle('config:save', (_e, c) => {
    const cur = loadConfig();
    const next = { ...cur, ...c };
    delete next.platform;
    saveConfig(next);
    return true;
  });

  ipcMain.handle('screen:size', () => {
    const d = screen.getPrimaryDisplay();
    return {
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
    };
  });

  ipcMain.handle('bg:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择一张图片作为背景',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const dest = path.join(P.bgs, 'bg-' + Date.now() + path.extname(src).toLowerCase());
    fs.copyFileSync(src, dest);
    return dest;
  });

  ipcMain.handle('wallpaper:apply', async (_e, bytes) => {
    try {
      const stamp = Date.now();
      const file = path.join(P.walls, `wallpaper-${stamp}.png`);
      fs.writeFileSync(file, Buffer.from(bytes));
      await setWallpaper(file);
      for (const f of fs.readdirSync(P.walls)) {
        if (f !== path.basename(file)) fs.rmSync(path.join(P.walls, f), { force: true });
      }
      const c = loadConfig();
      c.lastAppliedDate = today();
      saveConfig(c);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('login:set', (_e, on) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
    } catch {}
    const actual = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
    const c = loadConfig();
    c.launchAtLogin = actual;
    saveConfig(c);
    return actual;
  });
  ipcMain.handle('login:get', () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin);

  ipcMain.handle('fonts:installed', () => installedFonts());
  ipcMain.handle('fonts:css', (_e, id) => {
    try { return fontCss(id); } catch { return null; }
  });
  ipcMain.handle('fonts:download', async (e, { id, family, weights }) => {
    try {
      await downloadFont(id, family, weights, (done, total) => {
        if (!e.sender.isDestroyed()) e.sender.send('fonts:progress', { id, done, total });
      });
      return { ok: true };
    } catch (err) {
      fs.rmSync(path.join(P.fonts, id + '.part'), { recursive: true, force: true });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('fonts:remove', (_e, id) => {
    fs.rmSync(path.join(P.fonts, id), { recursive: true, force: true });
    return true;
  });
  ipcMain.handle('fonts:preview', async (_e, { id, family, weights, text }) => {
    try {
      const css = await fetchText(cssUrl(family, weights && weights.split(';')[0], text));
      return css.replace(/font-family:\s*'[^']+'/g, `font-family: 'pv-${id}'`);
    } catch {
      return null;
    }
  });

  // ---------- 启动 ----------
  app.on('second-instance', showWin);
  app.on('activate', showWin);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {});

  app.whenReady().then(() => {
    buildMenu();
    const startedAtLogin =
      process.argv.includes('--hidden') ||
      (isMac && os.uptime() < 240 && app.getLoginItemSettings().openAtLogin);
    createWindow(!startedAtLogin);
    createTray();
    setInterval(checkNewDay, 10 * 60 * 1000);
    powerMonitor.on('resume', () => setTimeout(checkNewDay, 5000));
    powerMonitor.on('unlock-screen', () => setTimeout(checkNewDay, 3000));
  });
}
