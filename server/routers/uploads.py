import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Screenshot
from schemas import ScreenshotResponse, ApiResponse
from config import UPLOAD_DIR, MAX_UPLOAD_SIZE

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/screenshot", response_model=ApiResponse)
async def upload_screenshot(
    file: UploadFile = File(...),
    bug_id: int = Form(None),
    db: AsyncSession = Depends(get_db),
):
    # Validate file type
    allowed_types = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
    if file.content_type not in allowed_types:
        return ApiResponse(code=1, message=f"不支持的文件类型: {file.content_type}")

    # Read file content
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        return ApiResponse(code=1, message="文件大小超过10MB限制")

    # Generate unique filename
    ext = os.path.splitext(file.filename or "screenshot.png")[1] or ".png"
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
