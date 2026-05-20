from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import FunctionModule
from schemas import FunctionModuleCreate, FunctionModuleUpdate


async def get_function_modules(db: AsyncSession):
    result = await db.execute(select(FunctionModule).order_by(FunctionModule.created_at.desc()))
    return result.scalars().all()


async def get_function_module(db: AsyncSession, module_id: int):
    result = await db.execute(select(FunctionModule).where(FunctionModule.id == module_id))
    return result.scalar_one_or_none()


async def create_function_module(db: AsyncSession, data: FunctionModuleCreate):
    module = FunctionModule(**data.model_dump())
    db.add(module)
    await db.commit()
    await db.refresh(module)
    return module


async def update_function_module(db: AsyncSession, module: FunctionModule, data: FunctionModuleUpdate):
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(module, key, value)
    await db.commit()
    await db.refresh(module)
    return module


async def delete_function_module(db: AsyncSession, module: FunctionModule):
    await db.delete(module)
    await db.commit()
