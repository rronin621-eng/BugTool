from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from models import Bug, BugHistory, Screenshot, User
from schemas import BugCreate, BugUpdate, BugStatusUpdate, UserResponse, ScreenshotResponse, BugHistoryResponse
from typing import Optional


async def get_bugs(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    bug_type: Optional[str] = None,
    priority: Optional[str] = None,
    reporter_id: Optional[int] = None,
    assignee_id: Optional[int] = None,
    inspection_task_id: Optional[int] = None,
    module_id: Optional[int] = None,
    keyword: Optional[str] = None,
):
    query = select(Bug)
    count_query = select(func.count(Bug.id))

    if status:
        query = query.where(Bug.status == status)
        count_query = count_query.where(Bug.status == status)
    if bug_type:
        query = query.where(Bug.bug_type == bug_type)
        count_query = count_query.where(Bug.bug_type == bug_type)
    if priority:
        query = query.where(Bug.priority == priority)
        count_query = count_query.where(Bug.priority == priority)
    if reporter_id:
        query = query.where(Bug.reporter_id == reporter_id)
        count_query = count_query.where(Bug.reporter_id == reporter_id)
    if assignee_id:
        query = query.where(Bug.assignee_id == assignee_id)
        count_query = count_query.where(Bug.assignee_id == assignee_id)
    if inspection_task_id:
        query = query.where(Bug.inspection_task_id == inspection_task_id)
        count_query = count_query.where(Bug.inspection_task_id == inspection_task_id)
    if module_id:
        query = query.where(Bug.module_id == module_id)
        count_query = count_query.where(Bug.module_id == module_id)
    if keyword:
        kw = f"%{keyword}%"
        query = query.where(or_(Bug.title.like(kw), Bug.description.like(kw)))
        count_query = count_query.where(or_(Bug.title.like(kw), Bug.description.like(kw)))

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    offset = (page - 1) * page_size
    query = query.order_by(Bug.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(query)
    bugs = result.scalars().all()

    return bugs, total


async def get_bug(db: AsyncSession, bug_id: int):
    result = await db.execute(select(Bug).where(Bug.id == bug_id))
    return result.scalar_one_or_none()


async def get_bug_detail(db: AsyncSession, bug_id: int):
    bug = await get_bug(db, bug_id)
    if not bug:
        return None

    # Get reporter
    reporter_result = await db.execute(select(User).where(User.id == bug.reporter_id))
    reporter = reporter_result.scalar_one_or_none()

    # Get assignee
    assignee = None
    if bug.assignee_id:
        assignee_result = await db.execute(select(User).where(User.id == bug.assignee_id))
        assignee = assignee_result.scalar_one_or_none()

    # Get screenshots
    ss_result = await db.execute(select(Screenshot).where(Screenshot.bug_id == bug_id))
    screenshots = ss_result.scalars().all()

    # Get history
    hist_result = await db.execute(
        select(BugHistory).where(BugHistory.bug_id == bug_id).order_by(BugHistory.created_at)
    )
    history = hist_result.scalars().all()

    # Build detail dict manually
    from schemas import BugResponse
    detail = BugResponse.model_validate(bug).model_dump()
    detail["reporter"] = UserResponse.model_validate(reporter).model_dump() if reporter else None
    detail["assignee"] = UserResponse.model_validate(assignee).model_dump() if assignee else None
    detail["screenshots"] = [ScreenshotResponse.model_validate(s).model_dump() for s in screenshots]
    detail["history"] = [BugHistoryResponse.model_validate(h).model_dump() for h in history]

    return detail


async def create_bug(db: AsyncSession, bug_data: BugCreate):
    bug = Bug(**bug_data.model_dump())
    db.add(bug)
    await db.commit()
    await db.refresh(bug)

    # Create initial history record
    history = BugHistory(
        bug_id=bug.id,
        from_status=None,
        to_status="new",
        operator_id=bug.reporter_id,
        comment="BUG创建",
    )
    db.add(history)
    await db.commit()

    return bug


async def update_bug(db: AsyncSession, bug: Bug, bug_data: BugUpdate):
    update_data = bug_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(bug, key, value)
    await db.commit()
    await db.refresh(bug)
    return bug


async def update_bug_status(db: AsyncSession, bug: Bug, status_data: BugStatusUpdate, operator_id: int):
    from_status = bug.status
    to_status = status_data.status

    bug.status = to_status
    history = BugHistory(
        bug_id=bug.id,
        from_status=from_status,
        to_status=to_status,
        operator_id=operator_id,
        comment=status_data.comment,
    )
    db.add(history)
    await db.commit()
    await db.refresh(bug)
    return bug


async def delete_bug(db: AsyncSession, bug: Bug):
    # Delete related screenshots and history
    await db.execute(select(Screenshot).where(Screenshot.bug_id == bug.id))
    ss_result = await db.execute(select(Screenshot).where(Screenshot.bug_id == bug.id))
    for ss in ss_result.scalars().all():
        await db.delete(ss)

    hist_result = await db.execute(select(BugHistory).where(BugHistory.bug_id == bug.id))
    for h in hist_result.scalars().all():
        await db.delete(h)

    await db.delete(bug)
    await db.commit()
