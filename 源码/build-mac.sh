#!/bin/bash
# 在 Mac 上把「桌面提醒」打包成 dmg（Apple 芯片 + Intel 两个版本），并安装到本机
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
cd "$(dirname "$0")"
ROOT="$(pwd)"
VER_E=41.0.0
VER=2.0.0
NAME="桌面提醒"
OUT="$ROOT/../桌面提醒安装包"
WORK="$ROOT/work"
mkdir -p "$OUT" "$WORK"

echo "== 开始 $(date)"
for ARCH in arm64 x64; do
  echo "== [$ARCH] 下载 Electron"
  ZIP="$WORK/electron-$ARCH.zip"
  if [ ! -s "$ZIP" ]; then
    curl -fsSL --retry 3 -o "$ZIP.tmp" "https://github.com/electron/electron/releases/download/v$VER_E/electron-v$VER_E-darwin-$ARCH.zip"
    mv "$ZIP.tmp" "$ZIP"
  fi
  D="$WORK/$ARCH"
  rm -rf "$D"; mkdir -p "$D"
  ditto -x -k "$ZIP" "$D"
  APP="$D/$NAME.app"
  mv "$D/Electron.app" "$APP"
  C="$APP/Contents"
  rm -f "$C/Resources/default_app.asar"
  ditto "$ROOT/app" "$C/Resources/app"
  cp "$ROOT/app/assets/icon.icns" "$C/Resources/electron.icns"
  # 只保留中英文语言包，减小体积
  find "$C/Frameworks/Electron Framework.framework/Versions/A/Resources" -maxdepth 1 -name "*.lproj" \
    ! -name "en.lproj" ! -name "zh_CN.lproj" ! -name "zh_TW.lproj" ! -name "Base.lproj" -exec rm -rf {} + 2>/dev/null || true
  PB=/usr/libexec/PlistBuddy
  P="$C/Info.plist"
  $PB -c "Set :CFBundleName $NAME" "$P"
  $PB -c "Set :CFBundleDisplayName $NAME" "$P" 2>/dev/null || $PB -c "Add :CFBundleDisplayName string $NAME" "$P"
  $PB -c "Set :CFBundleIdentifier local.desktopnote.app" "$P"
  $PB -c "Set :CFBundleShortVersionString $VER" "$P"
  $PB -c "Set :CFBundleVersion $VER" "$P"
  $PB -c "Add :LSApplicationCategoryType string public.app-category.productivity" "$P" 2>/dev/null || true
  $PB -c "Set :NSHumanReadableCopyright MIT" "$P" 2>/dev/null || true
  xattr -cr "$APP"
  echo "== [$ARCH] 签名"
  codesign --force --deep --sign - "$APP"
  codesign --verify --deep "$APP" && echo "签名校验通过"

  echo "== [$ARCH] 生成 dmg"
  STAGE="$WORK/stage-$ARCH"
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  ditto "$APP" "$STAGE/$NAME.app"
  ln -s /Applications "$STAGE/应用程序"
  cp "$ROOT/打不开？看这里.txt" "$STAGE/"
  if [ "$ARCH" = arm64 ]; then LABEL="Apple芯片"; else LABEL="Intel芯片"; fi
  DMG="$OUT/$NAME-$VER-Mac-$LABEL.dmg"
  rm -f "$DMG"
  hdiutil create -volname "$NAME" -srcfolder "$STAGE" -ov -format UDZO -fs HFS+ "$DMG" >/dev/null
  echo "已生成：$DMG"
done

if ls "$ROOT"/winparts/part-* >/dev/null 2>&1; then
  cat "$ROOT"/winparts/part-* > "$OUT/桌面提醒-$VER-Windows安装包.exe"
  cp "$ROOT/Windows安装说明.txt" "$OUT/"
  echo "已放好 Windows 安装包"
fi

echo "== 安装到本机"
HOST=$(uname -m); [ "$HOST" = x86_64 ] && HOST=x64
pkill -x DesktopNote 2>/dev/null || true
pkill -f "$NAME.app/Contents/MacOS/Electron" 2>/dev/null || true
sleep 1
rm -rf "/Applications/$NAME.app"
ditto "$WORK/$HOST/$NAME.app" "/Applications/$NAME.app"
open "/Applications/$NAME.app" || true
echo "== 全部完成 $(date)"
