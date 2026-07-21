#!/bin/bash
# ============================================================
# BUG工具 — 一键打包为独立 macOS 应用（Apple Silicon / arm64）
# 产物：dist-app/BUG工具-*.dmg
# ============================================================
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "  BUG工具 打包中（arm64）..."
echo "=========================================="

# ── 1. 构建 WEB 静态文件 ──────────────────────
echo "[1/4] 构建 WEB 管理端..."
cd "$ROOT/web"
npm run build

# ── 2. PyInstaller 打包后端 ───────────────────
echo "[2/4] 打包后端可执行文件..."
cd "$ROOT/server"
./build_backend.sh

# ── 3. 构建 Electron 渲染层 ───────────────────
echo "[3/4] 构建 Electron 渲染层..."
cd "$ROOT/electron-screenshot"
npm run build

# ── 4. electron-builder 出包 ──────────────────
echo "[4/4] electron-builder 打包 .dmg..."
npx electron-builder --mac --arm64

echo ""
echo "=========================================="
echo "  ✅ 打包完成！"
echo "  产物目录: $ROOT/dist-app/"
echo "=========================================="
ls -lh "$ROOT/dist-app/"*.dmg 2>/dev/null || true
