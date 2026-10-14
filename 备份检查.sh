#!/bin/bash
# 检查本地和 GitHub 云端是否一致。用法：bash 备份检查.sh
cd "$(dirname "$0")"
git fetch -q origin 2>&1 || { echo "❌ 连不上 GitHub"; exit 2; }
branch=$(git symbolic-ref --short HEAD)
ahead=$(git rev-list --count "origin/$branch..HEAD" 2>/dev/null || echo "?")
behind=$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null || echo "?")
dirty=$(git status --porcelain | wc -l | tr -d ' ')
echo "分支：$branch   本地比云端多 $ahead 个提交，少 $behind 个   未提交的改动：$dirty 个文件"
echo "云端最新：$(gh api repos/rainbowetdash/desktop-reminder/commits/$branch -q '.sha[0:7]+" "+.commit.message' 2>/dev/null | head -1)"
echo "本地最新：$(git log -1 --format='%h %s')"
[ -f .git/auto-push.log ] && echo "最近一次自动推送：$(tail -1 .git/auto-push.log)"
if [ "$ahead" = 0 ] && [ "$dirty" = 0 ]; then echo "✅ 云端备份是最新的"; exit 0; fi
[ "$ahead" != 0 ] && echo "⚠️  有提交还没推到云端：git push origin $branch"
[ "$dirty" != 0 ] && echo "⚠️  有改动还没提交（提交后会自动推送）"
exit 1
