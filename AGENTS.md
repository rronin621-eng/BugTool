# BUG录入与走查管理工具 — 项目全局文档

> 供 AI 助手、新会话、或协作开发者快速理解整个系统，可直接作为上下文输入。
> 最后更新：2026-05-20

---

## 一、系统定位

这是一套**三端联动**的内部 BUG 管理工具，专为 UI 走查场景设计：

| 端 | 技术栈 | 用途 |
|----|--------|------|
| **后端 API** (`server/`) | Python · FastAPI · SQLite · SQLAlchemy | 数据存储与业务逻辑 |
| **WEB 管理端** (`web/`) | Vue 3 · Vite · Element Plus · Pinia | BUG 列表管理、详情查看、人员/模块维护 |
| **Electron 截图工具** (`electron-screenshot/`) | Electron · TypeScript | 截图 → 标注 → 提交 BUG；悬浮 BUG 查看器 |

**核心使用流程：**
1. 测试人员按 `Ctrl+Shift+A` 唤起截图工具
2. 框选区域 → 在截图上标注（矩形框/箭头/画笔/文字）
3. 点击「录入」填写表单 → 提交，截图自动上传到后端
4. 开发人员打开 BUG 查看器（托盘菜单）查看待处理 BUG，更新状态
5. 管理人员在 WEB 端统一查看、筛选、管理所有 BUG

---

## 二、目录结构

```
bugTool/
├── server/                    # FastAPI 后端
│   ├── main.py                # 应用入口，注册路由与中间件
│   ├── models.py              # SQLAlchemy ORM 模型（5张表）
│   ├── schemas.py             # Pydantic 请求/响应模型
│   ├── database.py            # 数据库连接与初始化（aiosqlite）
│   ├── config.py              # 配置：端口、CORS、上传目录、DB路径
│   ├── requirements.txt       # Python 依赖
│   ├── routers/               # 路由层（每个实体一个文件）
│   │   ├── bugs.py
│   │   ├── users.py
│   │   ├── inspection_tasks.py
│   │   ├── function_modules.py
│   │   └── uploads.py
│   ├── services/              # 业务逻辑层（与路由解耦）
│   │   ├── bug_service.py
│   │   ├── user_service.py
│   │   ├── inspection_task_service.py
│   │   └── function_module_service.py
│   └── uploads/               # 截图文件存储目录（已 gitignore）
│
├── web/                       # Vue 3 WEB 管理端
│   ├── src/
│   │   ├── App.vue            # 根组件：侧边栏导航（可折叠）
│   │   ├── main.ts            # 入口，挂载 app + router + pinia
│   │   ├── router/index.ts    # 路由配置（5个页面）
│   │   ├── types/index.ts     # 全局 TS 类型 + 枚举常量
│   │   ├── api/               # axios 封装的 API 请求
│   │   │   ├── index.ts       # axios 实例（baseURL=http://127.0.0.1:8000/api/v1）
│   │   │   ├── bugs.ts
│   │   │   ├── users.ts
│   │   │   ├── inspection_tasks.ts
│   │   │   └── function_modules.ts
│   │   ├── stores/            # Pinia stores（对应各实体）
│   │   │   ├── bug.ts
│   │   │   ├── user.ts
│   │   │   ├── inspection_task.ts
│   │   │   └── function_module.ts
│   │   ├── views/             # 页面组件
│   │   │   ├── BugList.vue    # BUG列表 + 左侧项目栏 + 列头筛选
│   │   │   ├── BugDetail.vue  # BUG详情 + 状态流转 + 操作面板
│   │   │   ├── UserManage.vue
│   │   │   ├── InspectionTaskManage.vue
│   │   │   └── FunctionModuleManage.vue
│   │   └── components/
│   │       └── BugStatusTag.vue  # 状态胶囊标签组件
│   └── vite.config.ts
│
├── electron-screenshot/       # Electron 截图工具
│   ├── src/
│   │   ├── main/
│   │   │   ├── index.ts           # 主进程入口：托盘、快捷键、单实例锁
│   │   │   ├── screenshot.ts      # 截图逻辑（desktopCapturer）
│   │   │   ├── ipc-handlers.ts    # IPC 通道注册（与后端 HTTP 通信）
│   │   │   └── bug-viewer-window.ts  # BUG查看器窗口管理
│   │   ├── preload/
│   │   │   └── index.ts           # contextBridge 暴露 api 给渲染进程
│   │   └── renderer/
│   │       ├── index.html         # 截图标注界面 + BUG录入弹窗
│   │       ├── screenshot.js      # 截图/标注/表单交互逻辑（纯 JS）
│   │       ├── style.css          # 截图工具样式（亮色）
│   │       └── viewer/
│   │           ├── index.html     # BUG查看器界面（筛选抽屉、三页签）
│   │           ├── viewer.js      # 查看器交互逻辑
│   │           └── viewer.css     # 查看器样式（暗色主题，Catppuccin Mocha）
│   ├── package.json
│   └── tsconfig.json
│
├── start.sh                   # 一键启动脚本（启动三端）
├── stop.sh                    # 一键停止脚本
├── BUG工具.app/               # macOS .app 封装（可直接双击启动）
└── AGENTS.md                  # 本文档
```

---

## 三、数据库模型（SQLite）

数据库文件：`server/bug_tool.db`（已 gitignore）

### 5 张表

```
users               — 用户（测试员 / 开发者 / 管理员）
inspection_tasks    — 走查项目（关联默认负责人和默认环境URL）
function_modules    — 功能模块
bugs                — BUG主表
screenshots         — 截图附件（一个BUG可有多张）
bug_history         — BUG状态变更历史
```

### 枚举值

| 字段 | 可选值 |
|------|--------|
| `User.role` | `tester` / `developer` / `admin` |
| `InspectionTask.status` | `active`（进行中） / `ended`（已结束） |
| `Bug.bug_type` | `ui` / `functional` / `performance` / `security` / `other` |
| `Bug.status` | `new` / `in_progress` / `fixed` / `closed` |
| `Bug.priority` | `low` / `medium` / `high` / `critical` |

### 关键字段说明

**`inspection_tasks` 表**（走查项目）：
- `default_assignee_id` — 截图提交 BUG 时的默认接收人
- `default_env_url` — 截图提交时预填的环境链接
- 这两个字段是后续迭代中通过 `ALTER TABLE ADD COLUMN` 手动迁移加入的

**`bugs` 表**：
- `reporter_id` — 录入人（必填）
- `assignee_id` — 接收人（可选）
- `inspection_task_id` / `module_id` — 外键关联，均可为 null
- `env_url` — 问题所在的环境页面 URL

---

## 四、后端 API

**运行地址：** `http://127.0.0.1:8000`  
**启动命令：** `cd server && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000`

### 主要端点

```
GET    /api/v1/health                       # 健康检查
GET    /api/v1/users                        # 用户列表
POST   /api/v1/users                        # 创建用户
PUT    /api/v1/users/{id}                   # 更新用户
DELETE /api/v1/users/{id}                   # 删除用户

GET    /api/v1/bugs                         # BUG列表（支持分页/筛选）
POST   /api/v1/bugs                         # 创建BUG
GET    /api/v1/bugs/{id}                    # BUG详情（含截图、历史）
PUT    /api/v1/bugs/{id}/status             # 变更BUG状态

POST   /api/v1/uploads/screenshot           # 上传截图（multipart/form-data）
GET    /uploads/{filename}                  # 静态文件访问截图

GET    /api/v1/inspection-tasks             # 走查项目列表（?status=active）
POST   /api/v1/inspection-tasks             # 创建走查项目
PUT    /api/v1/inspection-tasks/{id}        # 更新走查项目
DELETE /api/v1/inspection-tasks/{id}        # 删除走查项目

GET    /api/v1/function-modules             # 功能模块列表
POST   /api/v1/function-modules             # 创建功能模块
DELETE /api/v1/function-modules/{id}        # 删除功能模块
```

### 统一响应格式

```json
{ "code": 0, "message": "ok", "data": { ... } }
```

分页响应的 `data` 结构：
```json
{ "items": [...], "total": 100, "page": 1, "page_size": 20 }
```

### CORS 配置

允许来自 `http://localhost:5173` 和 `http://127.0.0.1:5173` 的请求（见 `config.py`）。  
如果 WEB 端端口变化，需要同步更新 `CORS_ORIGINS`。

---

## 五、WEB 端架构

**运行地址：** `http://localhost:5173`  
**启动命令：** `cd web && npm run dev`

### 路由

| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | → 重定向 `/bugs` | |
| `/bugs` | `BugList.vue` | BUG列表，主工作页 |
| `/bugs/:id` | `BugDetail.vue` | BUG详情 |
| `/users` | `UserManage.vue` | 用户管理 |
| `/inspection-tasks` | `InspectionTaskManage.vue` | 走查项目管理（独立页面，BugList侧边栏也可操作） |
| `/function-modules` | `FunctionModuleManage.vue` | 功能模块管理 |

### BugList.vue 功能说明

这是最复杂的页面，包含：
1. **左侧项目栏**（`project-sidebar`，190px）
   - 显示所有走查项目，点击快速筛选
   - 「全部项目」选项
   - 每个项目 hover 显示编辑/删除按钮
   - 顶部「+」新建项目按钮
2. **顶部标题栏**：页面标题 + 总条数 + 新建BUG按钮
3. **筛选栏**：功能模块下拉 + 关键词搜索
4. **表格**：Element Plus el-table，支持列头筛选（`:filters` + `:filter-method`）
   - 可筛选列：类型、状态、优先级、功能模块、录入人、接收人
   - 可排序列：ID、优先级、创建时间
5. **新建BUG弹窗**：分四组字段（基础信息/人员/关联/描述）
6. **新建/编辑项目弹窗**：含默认负责人、默认环境路径

### App.vue 侧边栏

- 宽度：展开 `210px` / 收起 `60px`，通过 `collapsed` ref 控制
- 主题色：`#16192a` 深色背景，激活态蓝色 `#7aadff`
- Logo：蓝紫渐变圆角方块图标
- 收起按钮：悬浮在侧边栏右边缘（`right: -14px`），点击切换状态
- Element Plus `el-menu :collapse` 属性控制图标收起模式

### 状态管理（Pinia）

每个实体一个 store，均提供 `loadXxx()` 方法：
- `useBugStore()` — `bugs[]`, `total`, `loading`, `loadBugs(params)`
- `useUserStore()` — `users[]`, `loadUsers()`
- `useInspectionTaskStore()` — `tasks[]`, `loadTasks()`
- `useFunctionModuleStore()` — `modules[]`, `loadModules()`

---

## 六、Electron 截图工具架构

**启动方式：** 直接调用 Electron 二进制（**不要用 `npm start`**，会导致退出残留父进程）
```bash
./electron-screenshot/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

**构建命令：** `cd electron-screenshot && npm run build`（输出到 `dist/`）

### 主进程模块

| 文件 | 职责 |
|------|------|
| `main/index.ts` | 应用入口：单实例锁、托盘创建、全局快捷键 `Ctrl+Shift+A`、隐藏主窗口 |
| `main/screenshot.ts` | 使用 `desktopCapturer` 捕获全屏，返回 base64 图像数据 |
| `main/ipc-handlers.ts` | 注册所有 IPC 通道，通过原生 `http` 模块调用后端 API |
| `main/bug-viewer-window.ts` | 管理 BUG 查看器窗口的创建/显示/隐藏/销毁 |

### IPC 通道列表

| 通道名 | 方向 | 说明 |
|--------|------|------|
| `screenshot:start` | main→renderer | 传送截图 base64 数据 |
| `screenshot:cancel` | renderer→main | 取消截图，销毁窗口 |
| `screenshot:copy` | renderer→main | 复制到剪贴板 |
| `screenshot:save` | renderer→main | 保存到桌面 |
| `bug:submit` | renderer→main | 提交BUG（含截图上传） |
| `users:list` | renderer→main | 获取用户列表 |
| `tasks:list` | renderer→main | 获取活跃走查项目 |
| `modules:list` | renderer→main | 获取功能模块 |
| `bugs:list` | renderer→main | 获取BUG列表（查看器用） |
| `bug:get` | renderer→main | 获取BUG详情 |
| `bug:update-status` | renderer→main | 更新BUG状态 |
| `viewer:set-always-on-top` | renderer→main | 控制查看器置顶 |
| `viewer:refresh` | main→renderer | 通知查看器刷新数据 |

### 退出问题（重要）

macOS 上 `app.quit()` 在有未关闭 BrowserWindow 时会挂起。  
**解决方案（已实施）**：在 `before-quit` 事件中强制 `destroy()` 所有窗口：

```typescript
app.on('before-quit', () => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.destroy();
  });
});
```

### BUG 查看器窗口

- 尺寸：`480×600`，无边框（`frame: false`），常置顶（`alwaysOnTop: true`）
- 功能：三个页签（待处理/待验收/已关闭） + 用户选择器 + 筛选抽屉
- 筛选维度：优先级 chips、类型 chips、关键词搜索
- 样式：暗色主题（Catppuccin Mocha 配色），`viewer.css`
- 截图时临时取消置顶（避免遮挡截图），截图完成后恢复

### 截图标注工具

渲染进程（纯 HTML+JS，无框架）：
- 工具：矩形框、箭头、画笔、文字
- 颜色选择器 + 线宽选择
- 撤销（Ctrl+Z） + 清除标注
- 动作：复制到剪贴板、保存到桌面、录入BUG
- BUG 录入弹窗左侧显示截图预览（可继续标注），右侧填写表单

---

## 七、启动与运维

### 一键启动（推荐）

```bash
cd /Users/ronin/Desktop/bugTool
./start.sh
```

`start.sh` 做了三件事：
1. 在新 Terminal 窗口启动后端：`python3 -m uvicorn main:app --host 127.0.0.1 --port 8000`
2. 在新 Terminal 窗口启动 Web：`npm run dev`
3. 前台运行 Electron（直接调用二进制）
4. Electron 退出后自动 `pkill uvicorn` 和 `pkill vite`

### macOS .app 启动

```
双击 桌面/BUG工具.app
```

与 `start.sh` 逻辑相同，封装在 `BUG工具.app/Contents/MacOS/launcher` 脚本中。

### 手动启动

```bash
# 终端1：后端
cd /Users/ronin/Desktop/bugTool/server
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000

# 终端2：WEB端
cd /Users/ronin/Desktop/bugTool/web
npm run dev

# 终端3：Electron
cd /Users/ronin/Desktop/bugTool/electron-screenshot
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

### 停止

```bash
./stop.sh
# 或手动：
pkill -f "uvicorn main:app"
pkill -f "vite"
# Electron：点托盘菜单「退出」
```

### 首次运行（新机器）

```bash
# 后端依赖
cd server && pip3 install -r requirements.txt

# WEB端依赖
cd web && npm install

# Electron 依赖
cd electron-screenshot && npm install && npm run build
```

### macOS 屏幕录制权限

截图功能需要屏幕录制权限：  
`系统设置 → 隐私与安全 → 屏幕录制 → 勾选 Electron`

---

## 八、已知注意事项

1. **端口固定**：后端 `8000`，WEB `5173`。CORS 配置、Electron `API_BASE`、vite代理均硬编码这两个端口。
2. **SQLite 不支持并发写入**：不适合多人同时高频提交 BUG。如需扩展，迁移至 PostgreSQL 只需改 `DATABASE_URL`。
3. **数据库迁移**：当前无迁移框架（Alembic）。新增字段用 Python 脚本执行 `ALTER TABLE ADD COLUMN`，已有字段需手动迁移。
4. **截图文件**：存放在 `server/uploads/`，已 gitignore，不会进版本库。通过 `/uploads/{filename}` 静态文件路由访问。
5. **单机部署**：所有服务运行在本机，WEB 端通过 `127.0.0.1:8000` 访问后端，不支持远程多人使用（需加 `--host 0.0.0.0` 并修改 CORS）。

---

## 九、UI 设计规范

### WEB 端（Element Plus + 自定义样式）

- **背景**：主内容区 `#f4f6fb`，侧边栏 `#16192a`，卡片 `#fff`
- **主色**：蓝色 `#3b82f6` / `#5b8af5`
- **边框**：`#eaecf0`
- **文字层级**：标题 `#1e293b`，正文 `#334155`，辅助 `#64748b`，占位 `#94a3b8`
- **状态色**：new=蓝、in_progress=橙、fixed=绿、closed=灰
- **优先级色**：critical=红、high=橙、medium=黄、low=绿

### BUG 查看器（原生 CSS 暗色主题）

基于 Catppuccin Mocha 配色：
- `--bg: #1e1e2e`，`--bg-card: #2a2a3e`
- `--accent: #89b4fa`（蓝色高亮）
- `--danger: #f38ba8`，`--success: #a6e3a1`

### Electron 截图工具（亮色）

- 工具栏：白色圆角卡片，`box-shadow`
- 按钮：蓝色渐变主操作，红色渐变录入按钮
- 弹窗：毛玻璃遮罩 `backdrop-filter: blur(8px)`，白色圆角 14px

---

## 十、常见开发任务

### 新增一个 BUG 字段

1. `server/models.py` — 在 `Bug` 类添加 Column
2. `server/schemas.py` — 在 Create/Update/Response Schema 添加字段
3. 运行迁移脚本（Python `ALTER TABLE bugs ADD COLUMN ...`）
4. `web/src/types/index.ts` — 在 `Bug` interface 添加字段
5. `web/src/views/BugList.vue` — 在表格和新建弹窗中添加
6. `web/src/views/BugDetail.vue` — 在详情页展示
7. `electron-screenshot/src/renderer/index.html` — 在录入弹窗添加表单项
8. `electron-screenshot/src/renderer/screenshot.js` — 读取新字段并加入提交 payload

### 新增一个 API 路由

1. `server/routers/` — 新建路由文件，定义 APIRouter
2. `server/services/` — 新建 service 文件，封装数据库操作
3. `server/main.py` — `import` 并 `include_router`

### 修改 Electron 渲染层后重新构建

```bash
cd electron-screenshot && npm run build
```

构建脚本：`tsc && cp src/renderer/* dist/renderer/`（TypeScript 主进程编译 + 复制渲染层静态文件）

---

*此文档由 Qoder AI 根据代码自动生成，如有功能变更请同步更新本文件。*
