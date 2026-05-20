from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from database import get_db
from services.bug_service import (
    get_bugs, get_bug, get_bug_detail, create_bug,
    update_bug, update_bug_status, delete_bug,
)
from schemas import (
    BugCreate, BugUpdate, BugStatusUpdate, BugResponse,
    BugDetailResponse, ApiResponse,
)

router = APIRouter(prefix="/bugs", tags=["bugs"])


@router.get("", response_model=ApiResponse)
async def list_bugs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    bug_type: Optional[str] = None,
    priority: Optional[str] = None,
    reporter_id: Optional[int] = None,
    assignee_id: Optional[int] = None,
    inspection_task_id: Optional[int] = None,
    module_id: Optional[int] = None,
    keyword: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    bugs, total = await get_bugs(
        db, page=page, page_size=page_size, status=status,
        bug_type=bug_type, priority=priority,
        reporter_id=reporter_id, assignee_id=assignee_id,
        inspection_task_id=inspection_task_id, module_id=module_id,
        keyword=keyword,
    )
    return ApiResponse(data={
        "items": [BugResponse.model_validate(b).model_dump() for b in bugs],
        "total": total,
        "page": page,
        "page_size": page_size,
    })


@router.get("/{bug_id}", response_model=ApiResponse)
async def get_bug_detail_api(bug_id: int, db: AsyncSession = Depends(get_db)):
    bug = await get_bug_detail(db, bug_id)
    if not bug:
        return ApiResponse(code=1, message="BUG不存在")
    return ApiResponse(data=bug)


@router.post("", response_model=ApiResponse)
async def create_bug_api(bug_data: BugCreate, db: AsyncSession = Depends(get_db)):
    bug = await create_bug(db, bug_data)
    return ApiResponse(data=BugResponse.model_validate(bug).model_dump())


@router.put("/{bug_id}", response_model=ApiResponse)
async def update_bug_api(bug_id: int, bug_data: BugUpdate, db: AsyncSession = Depends(get_db)):
    bug = await get_bug(db, bug_id)
    if not bug:
        return ApiResponse(code=1, message="BUG不存在")
    bug = await update_bug(db, bug, bug_data)
    return ApiResponse(data=BugResponse.model_validate(bug).model_dump())


@router.put("/{bug_id}/status", response_model=ApiResponse)
async def update_bug_status_api(
    bug_id: int, status_data: BugStatusUpdate, db: AsyncSession = Depends(get_db)
):
    bug = await get_bug(db, bug_id)
    if not bug:
        return ApiResponse(code=1, message="BUG不存在")
    # Use reporter_id as default operator if not provided
    operator_id = status_data.comment and bug.reporter_id or bug.reporter_id
    bug = await update_bug_status(db, bug, status_data, operator_id)
    return ApiResponse(data=BugResponse.model_validate(bug).model_dump())


@router.delete("/{bug_id}", response_model=ApiResponse)
async def delete_bug_api(bug_id: int, db: AsyncSession = Depends(get_db)):
    bug = await get_bug(db, bug_id)
    if not bug:
        return ApiResponse(code=1, message="BUG不存在")
    await delete_bug(db, bug)
    return ApiResponse(message="删除成功")
