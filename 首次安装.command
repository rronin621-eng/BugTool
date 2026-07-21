#!/bin/bash
# ============================================================
# BUG工具 — 首次安装脚本
# 从 Git clone 后双击此文件完成环境初始化
# 如果提示无权限，在终端运行: chmod +x 首次安装.command && ./首次安装.command
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "  BUG工具 — 环境初始化"
echo "=========================================="
echo ""

# 补充 Node.js 常见安装位置到 PATH（双击启动时 PATH 精简）
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null
for d in "/usr/local/bin" "/opt/homebrew/bin" "$HOME/.local/node/bin" "$HOME/.volta/bin" "/usr/local/opt/node/bin"; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
if [ -d "$HOME/.nvm/versions/node" ]; then
  latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
  [ -n "$latest" ] && PATH="$HOME/.nvm/versions/node/$latest/bin:$PATH"
fi
export PATH

# 修复所有脚本的执行权限
echo "[1/5] 修复文件权限..."
chmod +x "$ROOT/启动BUG工具.command" 2>/dev/null
chmod +x "$ROOT/首次安装.command" 2>/dev/null
chmod +x "$ROOT/start.sh" 2>/dev/null
chmod +x "$ROOT/stop.sh" 2>/dev/null
echo "   ✅ 权限已修复"

# 检查 Node.js
echo "[2/5] 检查 Node.js..."
if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  echo "   ✅ Node.js $NODE_VER"
else
  echo "   ❌ 未找到 Node.js，请先安装 Node.js >= 18"
  echo "      下载地址: https://nodejs.org/"
  read -p "按回车键退出..."
  exit 1
fi

# 检查 Python3
echo "[3/5] 检查 Python3..."
if command -v python3 &>/dev/null; then
  PY_VER=$(python3 --version)
  echo "   ✅ $PY_VER"
else
  echo "   ❌ 未找到 Python3，请先安装"
  read -p "按回车键退出..."
  exit 1
fi

# 安装依赖
echo "[4/5] 安装项目依赖..."
echo "   → Python 依赖..."
pip3 install -r "$ROOT/server/requirements.txt" -q 2>/dev/null
pip3 install greenlet -q 2>/dev/null

echo "   → Web 前端依赖..."
cd "$ROOT/web" && npm install --silent 2>/dev/null

echo "   → Electron 依赖..."
cd "$ROOT/electron-screenshot" && npm install --silent 2>/dev/null

# 构建 Electron
echo "[5/5] 构建 Electron..."
cd "$ROOT/electron-screenshot" && npm run build 2>/dev/null

# 初始化示例数据
echo ""
echo "[额外] 初始化示例数据..."
cd "$ROOT/server" && python3 seed_data.py

echo ""
echo "=========================================="
echo "  ✅ 初始化完成！"
echo ""
echo "  现在可以双击「启动BUG工具.command」启动应用"
echo "=========================================="
echo ""
read -p "按回车键关闭..."
