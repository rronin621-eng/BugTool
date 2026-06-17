import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DATABASE_URL = f"sqlite+aiosqlite:///{os.path.join(BASE_DIR, 'bug_tool.db')}"

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
]

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB（图片）
MAX_VIDEO_SIZE = 200 * 1024 * 1024  # 200MB（视频）

os.makedirs(UPLOAD_DIR, exist_ok=True)
