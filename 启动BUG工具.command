#!/bin/bash
# ============================================================
# BUG工具 — 双击启动（macOS .command）
# 首次从 Git clone 后可能需要: chmod +x 启动BUG工具.command
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$ROOT/electron-screenshot/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ELECTRON_DIR="$ROOT/electron-screenshot"

echo "=========================================="
echo "  BUG工具 启动中..."
echo "=========================================="

# ── 定位 Node.js ─────────────────────────────────
# 双击 .command 时 PATH 很精简，需主动补充常见 node 安装位置
setup_node_path() {
  # 尝试加载用户 shell 配置（nvm 等）
  [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null
  [ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null
  [ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null

  # 补充常见安装位置到 PATH
  local candidates=(
    "/usr/local/bin"
    "/opt/homebrew/bin"
    "$HOME/.local/node/bin"
    "$HOME/.volta/bin"
    "/usr/local/opt/node/bin"
  )
  for d in "${candidates[@]}"; do
    [ -d "$d" ] && PATH="$d:$PATH"
  done
  # nvm 默认版本目录
  if [ -d "$HOME/.nvm/versions/node" ]; then
    local latest
    latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "$latest" ] && PATH="$HOME/.nvm/versions/node/$latest/bin:$PATH"
  fi
  export PATH
}

setup_node_path

# 检查 node 是否可用
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 Node.js！"
  echo "   Web 管理端需要 Node.js 才能运行。"
  echo "   请先安装 Node.js（建议 LTS 版）：https://nodejs.org/"
  echo "   安装后重新双击本文件即可。"
  read -p "按回车键退出..."
  exit 1
fi
echo "[环境] Node.js: $(node -v)  ($(command -v node))"

# ── 0. 环境检测与依赖自动安装 ──────────────────────
check_and_install() {
  local need_install=0

  # 检查 Python 依赖
  if ! python3 -c "import uvicorn" 2>/dev/null; then
    echo "[准备] 安装 Python 依赖..."
    pip3 install -r "$ROOT/server/requirements.txt" -q 2>/dev/null
    pip3 install greenlet -q 2>/dev/null
    need_install=1
  fi

  # 检查 Web 端 node_modules
  if [ ! -d "$ROOT/web/node_modules" ]; then
    echo "[准备] 安装 Web 前端依赖..."
    cd "$ROOT/web" && npm install --silent 2>/dev/null
    need_install=1
  fi

  # 检查 Electron node_modules
  if [ ! -d "$ROOT/electron-screenshot/node_modules" ]; then
    echo "[准备] 安装 Electron 依赖..."
    cd "$ELECTRON_DIR" && npm install --silent 2>/dev/null
    need_install=1
  fi

  # 检查 Electron 是否已构建
  if [ ! -f "$ELECTRON_DIR/dist/main/index.js" ]; then
    echo "[准备] 构建 Electron..."
    cd "$ELECTRON_DIR" && npm run build 2>/dev/null
    need_install=1
  fi

  # 初始化示例数据（数据库为空时自动填充）
  if [ -f "$ROOT/server/seed_data.py" ]; then
    cd "$ROOT/server" && python3 seed_data.py
  fi

  if [ $need_install -eq 1 ]; then
    echo "[准备] ✅ 依赖安装完成"
    echo ""
  fi
}

check_and_install

# ── 1. 后端 API（后台运行）──────────────────────
echo "[1/3] 启动后端 API (端口 8000)..."
cd "$ROOT/server"
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 &
SERVER_PID=$!
sleep 2

# 检查后端是否启动成功
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "❌ 后端启动失败！"
  echo "   请手动运行: cd server && pip3 install -r requirements.txt"
  read -p "按回车键退出..."
  exit 1
fi
echo "   ✅ 后端已启动 (PID: $SERVER_PID)"

# ── 2. Web 前端（后台运行）──────────────────────
echo "[2/3] 启动 Web 前端 (端口 5173)..."
cd "$ROOT/web"
# 直接调用本地 vite 二进制，避免依赖 npx 在 PATH 中
if [ -f "$ROOT/web/node_modules/.bin/vite" ]; then
  "$ROOT/web/node_modules/.bin/vite" --port 5173 &
else
  npm run dev &
fi
WEB_PID=$!
sleep 3

if ! kill -0 $WEB_PID 2>/dev/null; then
  echo "❌ Web 前端启动失败！"
  echo "   请手动运行: cd web && npm install"
  kill $SERVER_PID 2>/dev/null
  read -p "按回车键退出..."
  exit 1
fi
echo "   ✅ Web 前端已启动 (PID: $WEB_PID)"

# ── 3. Electron 截图工具（前台运行）──────────────
echo "[3/3] 启动 Electron 截图工具..."
echo "=========================================="
echo "  ✅ 全部启动完成！"
echo "  📋 Web管理页: http://localhost:5173"
echo "  📸 截图快捷键: Ctrl+Shift+A"
echo "  🛑 关闭此窗口或 Ctrl+C 停止所有服务"
echo "=========================================="

cd "$ELECTRON_DIR"
"$ELECTRON" .

# ── Electron 退出后清理 ──────────────────────────
echo ""
echo "正在关闭后端和 Web 服务..."
kill $SERVER_PID 2>/dev/null
kill $WEB_PID 2>/dev/null
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "vite.*5173" 2>/dev/null
echo "✅ 已全部关闭。"
sleep 1
