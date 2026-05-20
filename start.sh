#!/bin/bash
# ============================================================
# BUG工具 — 一键启动脚本
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$ROOT/electron-screenshot/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ELECTRON_DIR="$ROOT/electron-screenshot"

echo "=========================================="
echo "  BUG工具 启动中..."
echo "=========================================="

# ── 1. 后端 API ──────────────────────────────
echo "[1/3] 启动后端 API (端口 8000)..."
osascript -e "tell application \"Terminal\" to do script \"cd '$ROOT/server' && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000; exec bash\""
sleep 2

# ── 2. Web 前端 ──────────────────────────────
echo "[2/3] 启动 Web 前端 (端口 5173)..."
osascript -e "tell application \"Terminal\" to do script \"cd '$ROOT/web' && npm run dev; exec bash\""
sleep 2

# ── 3. Electron（直接调用可执行文件，退出时无残留父进程）──
echo "[3/3] 启动 Electron 截图工具..."
cd "$ELECTRON_DIR"
"$ELECTRON" .

# Electron 退出后自动关闭后端和 Web
echo "正在关闭后端和 Web 服务..."
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "vite" 2>/dev/null
echo "已全部关闭。"
