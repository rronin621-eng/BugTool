from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from services.user_service import (
    get_users, get_user, create_user, update_user, delete_user,
)
from schemas import UserCreate, UserUpdate, UserResponse, ApiResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=ApiResponse)
async def list_users(role: str = None, db: AsyncSession = Depends(get_db)):
    users = await get_users(db, role=role)
    return ApiResponse(
        data=[UserResponse.model_validate(u).model_dump() for u in users]
    )


@router.get("/{user_id}", response_model=ApiResponse)
async def get_user_detail(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await get_user(db, user_id)
    if not user:
        return ApiResponse(code=1, message="用户不存在")
    return ApiResponse(data=UserResponse.model_validate(user).model_dump())


@router.post("", response_model=ApiResponse)
async def create_user_api(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    from services.user_service import get_user_by_username
    existing = await get_user_by_username(db, user_data.username)
    if existing:
        return ApiResponse(code=1, message="用户名已存在")
    user = await create_user(db, user_data)
    return ApiResponse(data=UserResponse.model_validate(user).model_dump())


@router.put("/{user_id}", response_model=ApiResponse)
async def update_user_api(user_id: int, user_data: UserUpdate, db: AsyncSession = Depends(get_db)):
    user = await get_user(db, user_id)
    if not user:
        return ApiResponse(code=1, message="用户不存在")
    user = await update_user(db, user, user_data)
    return ApiResponse(data=UserResponse.model_validate(user).model_dump())


@router.delete("/{user_id}", response_model=ApiResponse)
async def delete_user_api(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await get_user(db, user_id)
    if not user:
        return ApiResponse(code=1, message="用户不存在")
    await delete_user(db, user)
    return ApiResponse(message="删除成功")
