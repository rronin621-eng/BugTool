from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from config import CORS_ORIGINS, UPLOAD_DIR
from database import init_db
from routers import users, bugs, uploads
from routers import inspection_tasks, function_modules

app = FastAPI(title="BUG录入系统", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files for uploaded screenshots
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Routers
app.include_router(users.router, prefix="/api/v1")
app.include_router(bugs.router, prefix="/api/v1")
app.include_router(uploads.router, prefix="/api/v1")
app.include_router(inspection_tasks.router, prefix="/api/v1")
app.include_router(function_modules.router, prefix="/api/v1")


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok"}


# WEB 管理端静态托管（打包模式）：放在所有 API 路由之后挂载，避免覆盖 /api、/uploads
WEB_DIST = os.environ.get("BUGTOOL_WEB_DIST")
if WEB_DIST and os.path.isdir(WEB_DIST):
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
else:
    @app.get("/")
    async def root():
        return {"message": "BUG录入系统 API", "version": "1.0.0"}
