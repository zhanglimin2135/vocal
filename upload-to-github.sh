#!/bin/bash

# ==============================
# 一键上传到 GitHub 脚本
# ==============================

set -e

echo "========================================="
echo "  项目上传到 GitHub 脚本"
echo "========================================="
echo ""

# 检查是否已经安装了 git
if ! command -v git &> /dev/null; then
    echo "[错误] 未检测到 git，请先安装 Git："
    echo "       macOS: xcode-select --install"
    echo "       或者访问 https://git-scm.com/download/mac"
    exit 1
fi

echo "[1/6] 清理 macOS 系统文件..."
find . -name '.DS_Store' -delete 2>/dev/null || true
echo "       ✓ 已清理"

echo ""
echo "[2/6] 检查并初始化 Git 仓库..."
if [ ! -d ".git" ]; then
    git init
    echo "       ✓ 已初始化 Git 仓库"
else
    echo "       ✓ Git 仓库已存在"
fi

echo ""
echo "[3/6] 添加所有源代码文件..."
git add .
echo "       ✓ 已添加文件"

echo ""
echo "[4/6] 提交更改..."
git commit -m "feat: 添加背单词应用完整代码

- 单词选择页面
- 拼写学习模式（释义拼写/听音拼写）
- 实时统计和结果展示
- 截图功能
- 阅读练习模块" || echo "       (可能没有新文件需要提交)"

echo ""
echo "[5/6] 请输入您的 GitHub 仓库地址："
echo "       格式: https://github.com/用户名/仓库名.git"
read -p "       仓库地址: " REPO_URL

if [ -z "$REPO_URL" ]; then
    echo "[错误] 未提供仓库地址"
    exit 1
fi

# 如果已经有远程仓库，先移除
git remote remove origin 2>/dev/null || true

echo ""
echo "[6/6] 推送到 GitHub..."
git remote add origin "$REPO_URL"
git branch -M main
git push -u origin main || {
    echo ""
    echo "[错误] 推送失败！可能原因："
    echo "       1. 仓库地址错误"
    echo "       2. 仓库不存在（需要先在 GitHub 创建）"
    echo "       3. 网络问题"
    echo "       4. 权限问题（仓库是私有的且需要认证）"
    echo ""
    echo "       请检查后重试"
    exit 1
}

echo ""
echo "========================================="
echo "  ✓ 上传成功！"
echo "  现在可以访问您的 GitHub 仓库查看代码了"
echo "========================================="
