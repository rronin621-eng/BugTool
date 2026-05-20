#!/bin/bash
# ============================================================
# BUG工具 — 一键停止脚本
# ============================================================

echo "=========================================="
echo "  BUG工具 关闭中..."
echo "=========================================="

# 关闭 Electron
echo "停止 Electron..."
pkill -f "electron-screenshot" 2>/dev/null
pkill -f "electron \." 2>/dev/null

# 关闭 Vite 开发服务器
echo "停止 Web 前端..."
pkill -f "vite" 2>/dev/null

# 关闭 uvicorn 后端
echo "停止后端 API..."
pkill -f "uvicorn main:app" 2>/dev/null

sleep 1

echo ""
echo "=========================================="
echo "  全部服务已关闭。"
echo "=========================================="
