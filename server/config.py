import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 数据目录：打包运行时由 Electron 注入 BUGTOOL_DATA_DIR（用户可写目录）；
# 开发模式回退到 server 目录本身，保持原有行为不变。
DATA_DIR = os.environ.get("BUGTOOL_DATA_DIR", BASE_DIR)
os.makedirs(DATA_DIR, exist_ok=True)

UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DATABASE_URL = f"sqlite+aiosqlite:///{os.path.join(DATA_DIR, 'bug_tool.db')}"

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB（图片）
MAX_VIDEO_SIZE = 200 * 1024 * 1024  # 200MB（视频）

os.makedirs(UPLOAD_DIR, exist_ok=True)
