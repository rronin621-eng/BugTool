import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Screenshot
from schemas import ScreenshotResponse, ApiResponse
from config import UPLOAD_DIR, MAX_UPLOAD_SIZE, MAX_VIDEO_SIZE

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/screenshot", response_model=ApiResponse)
async def upload_screenshot(
    file: UploadFile = File(...),
    bug_id: int = Form(None),
    db: AsyncSession = Depends(get_db),
):
    # Validate file type（图片 + mp4 视频）
    image_types = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
    video_types = {"video/mp4"}
    allowed_types = image_types | video_types
    if file.content_type not in allowed_types:
        return ApiResponse(code=1, message=f"不支持的文件类型: {file.content_type}")

    # Read file content
    content = await file.read()
    is_video = file.content_type in video_types
    size_limit = MAX_VIDEO_SIZE if is_video else MAX_UPLOAD_SIZE
    if len(content) > size_limit:
        limit_mb = size_limit // (1024 * 1024)
        return ApiResponse(code=1, message=f"文件大小超过{limit_mb}MB限制")

    # Generate unique filename
    default_name = "recording.mp4" if is_video else "screenshot.png"
    ext = os.path.splitext(file.filename or default_name)[1] or (".mp4" if is_video else ".png")
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    # Save file
    with open(file_path, "wb") as f:
        f.write(content)

    # Save to database
    screenshot = Screenshot(
        bug_id=bug_id,
        file_path=f"/uploads/{filename}",
        file_name=file.filename or filename,
        file_size=len(content),
    )
    db.add(screenshot)
    await db.commit()
    await db.refresh(screenshot)

    return ApiResponse(data=ScreenshotResponse.model_validate(screenshot).model_dump())


@router.delete("/{screenshot_id}", response_model=ApiResponse)
async def delete_screenshot(screenshot_id: int, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    result = await db.execute(select(Screenshot).where(Screenshot.id == screenshot_id))
    screenshot = result.scalar_one_or_none()
    if not screenshot:
        return ApiResponse(code=1, message="截图不存在")

    # Delete file from disk
    file_full_path = os.path.join(UPLOAD_DIR, os.path.basename(screenshot.file_path))
    if os.path.exists(file_full_path):
        os.remove(file_full_path)

    await db.delete(screenshot)
    await db.commit()
    return ApiResponse(message="删除成功")
