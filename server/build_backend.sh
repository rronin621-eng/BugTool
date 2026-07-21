#!/bin/bash
# ============================================================
# 用 PyInstaller 将后端打包为独立可执行文件 bugtool-server
# 产物目录: server/dist/bugtool-server/
# 用法: cd server && ./build_backend.sh
# ============================================================
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "[后端打包] 检查 PyInstaller..."
if ! python3 -c "import PyInstaller" 2>/dev/null; then
  echo "[后端打包] 安装 PyInstaller..."
  pip3 install pyinstaller
fi

echo "[后端打包] 确保依赖已安装..."
pip3 install -r requirements.txt >/dev/null 2>&1 || true
pip3 install greenlet >/dev/null 2>&1 || true

echo "[后端打包] 清理旧产物..."
rm -rf build dist *.spec

echo "[后端打包] 开始打包（单目录模式）..."
python3 -m PyInstaller \
  --name bugtool-server \
  --onedir \
  --noconfirm \
  --clean \
  --collect-all uvicorn \
  --collect-all fastapi \
  --collect-all starlette \
  --collect-all pydantic \
  --collect-all pydantic_core \
  --collect-all anyio \
  --collect-all aiosqlite \
  --collect-all sqlalchemy \
  --collect-all aiofiles \
  --collect-all multipart \
  --hidden-import greenlet \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  --add-data "seed_data.py:." \
  run.py

echo ""
echo "[后端打包] ✅ 完成：server/dist/bugtool-server/bugtool-server"
echo "[后端打包] 可执行文件: $ROOT/dist/bugtool-server/bugtool-server"
