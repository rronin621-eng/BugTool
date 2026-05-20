from pydantic import BaseModel
from typing import Optional, Union, Any
from datetime import datetime


# ============ User Schemas ============
class UserBase(BaseModel):
    username: str
    display_name: str
    role: str = "tester"


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None


class UserResponse(UserBase):
    id: int
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ============ InspectionTask Schemas ============
class InspectionTaskCreate(BaseModel):
    name: str
    description: str = ""
    status: str = "active"
    default_assignee_id: Optional[int] = None
    default_env_url: str = ""


class InspectionTaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    default_assignee_id: Optional[int] = None
    default_env_url: Optional[str] = None


class InspectionTaskResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status: str
    default_assignee_id: Optional[int] = None
    default_env_url: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ============ FunctionModule Schemas ============
class FunctionModuleCreate(BaseModel):
    name: str


class FunctionModuleUpdate(BaseModel):
    name: Optional[str] = None


class FunctionModuleResponse(BaseModel):
    id: int
    name: str
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ============ Bug Schemas ============
class BugCreate(BaseModel):
    title: str
    description: str = ""
    bug_type: str  # ui / functional / performance / security / other
    priority: str = "medium"
    reporter_id: int
    assignee_id: Optional[int] = None
    env_url: str = ""
    inspection_task_id: Optional[int] = None
    module_id: Optional[int] = None
    reproduction_steps: str = ""


class BugUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    bug_type: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[int] = None
    env_url: Optional[str] = None
    inspection_task_id: Optional[int] = None
    module_id: Optional[int] = None
    reproduction_steps: Optional[str] = None


class BugStatusUpdate(BaseModel):
    status: str  # in_progress / fixed / closed / deferred
    comment: str = ""
    operator_id: Optional[int] = None  # 操作人（转交时指定）


class BugTransferRequest(BaseModel):
    assignee_id: int  # 新接收人
    operator_id: Optional[int] = None
    comment: str = ""


class BugCollaboratorUpdate(BaseModel):
    user_ids: list  # 协作人 user_id 列表（全量更新）


class BugResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    bug_type: str
    status: str
    priority: str
    reporter_id: int
    assignee_id: Optional[int] = None
    env_url: Optional[str] = None
    inspection_task_id: Optional[int] = None
    module_id: Optional[int] = None
    reproduction_steps: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BugDetailResponse(BugResponse):
    reporter: Optional[UserResponse] = None
    assignee: Optional[UserResponse] = None
    screenshots: list = []
    history: list = []
    collaborators: list = []  # [UserResponse, ...]

    model_config = {"from_attributes": True}


# ============ Screenshot Schemas ============
class ScreenshotResponse(BaseModel):
    id: int
    bug_id: Optional[int] = None
    file_path: str
    file_name: str
    file_size: int = 0
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ============ BugHistory Schemas ============
class BugHistoryResponse(BaseModel):
    id: int
    bug_id: int
    from_status: Optional[str] = None
    to_status: str
    operator_id: int
    comment: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ============ Common Schemas ============
class ApiResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: Optional[Any] = None


class PaginatedResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: Optional[dict] = None
