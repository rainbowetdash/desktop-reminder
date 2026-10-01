#!/bin/bash
# 编译「桌面提醒」并安装到「应用程序」文件夹
set -e
cd "$(dirname "$0")"

APP="桌面提醒.app"
echo "▶ 正在编译…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -target "$(uname -m)-apple-macos13.0" -swift-version 5 -suppress-warnings -parse-as-library main.swift -o "$APP/Contents/MacOS/DesktopNote"
cp Info.plist "$APP/Contents/Info.plist"

if [ -d AppIcon.iconset ]; then
  iconutil -c icns AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"
fi

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "▶ 正在安装到「应用程序」…"
pkill -x DesktopNote 2>/dev/null || true
if rm -rf "/Applications/$APP" 2>/dev/null && cp -R "$APP" /Applications/ 2>/dev/null; then
  DEST="/Applications/$APP"
else
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/$APP"
  cp -R "$APP" "$HOME/Applications/"
  DEST="$HOME/Applications/$APP"
fi

echo "✅ 完成！已安装到：$DEST"
open "$DEST" || true
