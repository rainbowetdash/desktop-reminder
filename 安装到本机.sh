#!/bin/bash
# 把刚打包好的新版装到这台 Mac，并在后台重新打开（不弹窗口，托盘里能找到）。
# 用法：先 NO_INSTALL=1 bash 源码/build-mac.sh，发布并验证没问题后，再 bash 安装到本机.sh
# 回退：上一个版本会备份在 源码/work/previous/，手动拖回「应用程序」即可。
set -euo pipefail
cd "$(dirname "$0")"
HOST=$(uname -m); [ "$HOST" = x86_64 ] && HOST=x64
SRC="源码/work/$HOST/桌面提醒.app"
APP="/Applications/桌面提醒.app"
[ -d "$SRC" ] || { echo "❌ 没找到打包产物 $SRC，请先 NO_INSTALL=1 bash 源码/build-mac.sh"; exit 1; }
NEW=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$SRC/Contents/Info.plist")
WANT=$(grep -o '"version": "[^"]*"' 源码/app/package.json | head -1 | sed 's/.*: "//;s/"//')
[ "$NEW" = "$WANT" ] || { echo "❌ 打包产物是 $NEW，但 package.json 是 $WANT，先重新打包"; exit 1; }
OLD=$([ -d "$APP" ] && /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" || echo "无")
if [ "$OLD" = "$NEW" ]; then echo "✅ 本机已经是 $NEW，不用重复安装"; exit 0; fi
# 备份旧版，万一要回退
if [ -d "$APP" ]; then mkdir -p 源码/work/previous && rm -rf "源码/work/previous/桌面提醒-$OLD.app" && ditto "$APP" "源码/work/previous/桌面提醒-$OLD.app"; fi
# 先让 App 正常退出（数据都是即时保存的），再替换
osascript -e 'tell application id "local.desktopnote.app" to quit' >/dev/null 2>&1 || true
sleep 2
pkill -f "桌面提醒.app/Contents/MacOS" 2>/dev/null || true
sleep 1
rm -rf "$APP"
ditto "$SRC" "$APP"
open -g -a "$APP" --args --hidden
sleep 3
NOW=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
if pgrep -f "桌面提醒.app/Contents/MacOS" >/dev/null; then echo "✅ 已从 $OLD 更新到 $NOW，并已在后台运行（点托盘图标打开窗口）"; else echo "⚠️ 已安装 $NOW，但没能自动启动，请手动打开"; exit 1; fi
