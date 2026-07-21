"""
打包入口：供 PyInstaller 打包后直接运行的后端启动脚本。
通过 uvicorn 以编程方式启动 FastAPI 应用，监听 127.0.0.1:8000。
数据目录与 WEB 静态目录由环境变量 BUGTOOL_DATA_DIR / BUGTOOL_WEB_DIST 注入（Electron 设置）。
"""
import os
import sys
import uvicorn

# 确保打包后能正确定位到 main 模块所在目录
if getattr(sys, "frozen", False):
    # PyInstaller 运行时，资源解包目录
    base = sys._MEIPASS  # type: ignore
    sys.path.insert(0, base)
else:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import app  # noqa: E402


def main():
    port = int(os.environ.get("BUGTOOL_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
