#!/bin/bash

# TradingAgents 同步脚本
# 从原始仓库拉取更新，并推送到个人仓库

set -e

echo "🔄 开始同步 TradingAgents..."

# 拉取原始仓库的更新
echo "📥 从原始仓库拉取更新..."
git fetch origin

# 检查是否有更新
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    echo "✅ 已经是最新版本"
else
    echo "🔃 合并原始仓库的更新..."
    git merge origin/main -m "Merge upstream changes from TauricResearch/TradingAgents"
fi

# 推送到个人仓库
echo "📤 推送到个人仓库..."
git push personal main

echo "✨ 同步完成！"
echo ""
echo "当前状态:"
git status --short
