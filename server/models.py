from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, func
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    role = Column(String(20), default="tester")  # tester / developer / admin
    created_at = Column(DateTime, server_default=func.now())


class InspectionTask(Base):
    __tablename__ = "inspection_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, default="")
    status = Column(String(20), default="active")  # active / ended
    default_assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    default_env_url = Column(String(500), default="")
    created_at = Column(DateTime, server_default=func.now())


class FunctionModule(Base):
    __tablename__ = "function_modules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class Bug(Base):
    __tablename__ = "bugs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    bug_type = Column(String(20), nullable=False)  # ui / functional / performance / security / other
    status = Column(String(20), default="new")  # new / in_progress / fixed / closed
    priority = Column(String(20), default="medium")  # low / medium / high / critical
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    env_url = Column(String(500), default="")  # bug所处的环境链接
    inspection_task_id = Column(Integer, ForeignKey("inspection_tasks.id"), nullable=True)
    module_id = Column(Integer, ForeignKey("function_modules.id"), nullable=True)
    reproduction_steps = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Screenshot(Base):
    __tablename__ = "screenshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bug_id = Column(Integer, ForeignKey("bugs.id"), nullable=True)
    file_path = Column(String(500), nullable=False)
    file_name = Column(String(200), nullable=False)
    file_size = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class BugHistory(Base):
    __tablename__ = "bug_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bug_id = Column(Integer, ForeignKey("bugs.id"), nullable=False)
    from_status = Column(String(20), nullable=True)
    to_status = Column(String(20), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    comment = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())
