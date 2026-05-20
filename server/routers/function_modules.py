from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from services.function_module_service import (
    get_function_modules, get_function_module,
    create_function_module, update_function_module, delete_function_module,
)
from schemas import FunctionModuleCreate, FunctionModuleUpdate, FunctionModuleResponse, ApiResponse

router = APIRouter(prefix="/function-modules", tags=["function-modules"])


@router.get("", response_model=ApiResponse)
async def list_function_modules(db: AsyncSession = Depends(get_db)):
    modules = await get_function_modules(db)
    return ApiResponse(data=[FunctionModuleResponse.model_validate(m).model_dump() for m in modules])


@router.get("/{module_id}", response_model=ApiResponse)
async def get_module(module_id: int, db: AsyncSession = Depends(get_db)):
    module = await get_function_module(db, module_id)
    if not module:
        return ApiResponse(code=1, message="功能模块不存在")
    return ApiResponse(data=FunctionModuleResponse.model_validate(module).model_dump())


@router.post("", response_model=ApiResponse)
async def create_module(data: FunctionModuleCreate, db: AsyncSession = Depends(get_db)):
    module = await create_function_module(db, data)
    return ApiResponse(data=FunctionModuleResponse.model_validate(module).model_dump())


@router.put("/{module_id}", response_model=ApiResponse)
async def update_module(module_id: int, data: FunctionModuleUpdate, db: AsyncSession = Depends(get_db)):
    module = await get_function_module(db, module_id)
    if not module:
        return ApiResponse(code=1, message="功能模块不存在")
    module = await update_function_module(db, module, data)
    return ApiResponse(data=FunctionModuleResponse.model_validate(module).model_dump())


@router.delete("/{module_id}", response_model=ApiResponse)
async def delete_module(module_id: int, db: AsyncSession = Depends(get_db)):
    module = await get_function_module(db, module_id)
    if not module:
        return ApiResponse(code=1, message="功能模块不存在")
    await delete_function_module(db, module)
    return ApiResponse(message="删除成功")
