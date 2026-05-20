from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from database import get_db
from services.inspection_task_service import (
    get_inspection_tasks, get_inspection_task,
    create_inspection_task, update_inspection_task, delete_inspection_task,
)
from schemas import InspectionTaskCreate, InspectionTaskUpdate, InspectionTaskResponse, ApiResponse

router = APIRouter(prefix="/inspection-tasks", tags=["inspection-tasks"])


@router.get("", response_model=ApiResponse)
async def list_inspection_tasks(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    tasks = await get_inspection_tasks(db, status=status)
    return ApiResponse(data=[InspectionTaskResponse.model_validate(t).model_dump() for t in tasks])


@router.get("/{task_id}", response_model=ApiResponse)
async def get_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await get_inspection_task(db, task_id)
    if not task:
        return ApiResponse(code=1, message="走查项目不存在")
    return ApiResponse(data=InspectionTaskResponse.model_validate(task).model_dump())


@router.post("", response_model=ApiResponse)
async def create_task(data: InspectionTaskCreate, db: AsyncSession = Depends(get_db)):
    task = await create_inspection_task(db, data)
    return ApiResponse(data=InspectionTaskResponse.model_validate(task).model_dump())


@router.put("/{task_id}", response_model=ApiResponse)
async def update_task(task_id: int, data: InspectionTaskUpdate, db: AsyncSession = Depends(get_db)):
    task = await get_inspection_task(db, task_id)
    if not task:
        return ApiResponse(code=1, message="走查项目不存在")
    task = await update_inspection_task(db, task, data)
    return ApiResponse(data=InspectionTaskResponse.model_validate(task).model_dump())


@router.delete("/{task_id}", response_model=ApiResponse)
async def delete_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await get_inspection_task(db, task_id)
    if not task:
        return ApiResponse(code=1, message="走查项目不存在")
    await delete_inspection_task(db, task)
    return ApiResponse(message="删除成功")
