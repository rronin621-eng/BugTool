from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import InspectionTask
from schemas import InspectionTaskCreate, InspectionTaskUpdate
from typing import Optional


async def get_inspection_tasks(db: AsyncSession, status: Optional[str] = None):
    query = select(InspectionTask).order_by(InspectionTask.created_at.desc())
    if status:
        query = query.where(InspectionTask.status == status)
    result = await db.execute(query)
    return result.scalars().all()


async def get_inspection_task(db: AsyncSession, task_id: int):
    result = await db.execute(select(InspectionTask).where(InspectionTask.id == task_id))
    return result.scalar_one_or_none()


async def create_inspection_task(db: AsyncSession, data: InspectionTaskCreate):
    task = InspectionTask(**data.model_dump())
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


async def update_inspection_task(db: AsyncSession, task: InspectionTask, data: InspectionTaskUpdate):
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)
    await db.commit()
    await db.refresh(task)
    return task


async def delete_inspection_task(db: AsyncSession, task: InspectionTask):
    await db.delete(task)
    await db.commit()
