#!/bin/bash
# ============================================================
# BUG工具 — 双击启动（macOS .command）
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$ROOT/electron-screenshot/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ELECTRON_DIR="$ROOT/electron-screenshot"

echo "=========================================="
echo "  BUG工具 启动中..."
echo "=========================================="

# ── 1. 后端 API（后台运行）──────────────────────
echo "[1/3] 启动后端 API (端口 8000)..."
cd "$ROOT/server"
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 &
SERVER_PID=$!
sleep 2

# 检查后端是否启动成功
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "❌ 后端启动失败！请检查 Python 依赖是否安装。"
  echo "   运行: cd server && pip3 install -r requirements.txt"
  read -p "按回车键退出..."
  exit 1
fi
echo "   ✅ 后端已启动 (PID: $SERVER_PID)"

# ── 2. Web 前端（后台运行）──────────────────────
echo "[2/3] 启动 Web 前端 (端口 5173)..."
cd "$ROOT/web"
npx vite --port 5173 &
WEB_PID=$!
sleep 2

if ! kill -0 $WEB_PID 2>/dev/null; then
  echo "❌ Web 前端启动失败！请检查 npm 依赖是否安装。"
  echo "   运行: cd web && npm install"
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
# 确保彻底关闭
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "vite.*5173" 2>/dev/null
echo "✅ 已全部关闭。"
sleep 1
