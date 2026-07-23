# BUG 工具 — 截图标注与 DMP 缺陷录入工具

一款面向测试/开发人员的 macOS 效率工具，专注于**快捷键截图 → 标注 → 一键提交 DMP 缺陷**的完整闭环。

> 当前主线能力已从「本地 BUG 管理系统」演进为「截图标注 + 金蝶 DMP 缺陷提交工具」，保留后端与 WEB 管理端作为历史模块。

---

## 主要功能

| 功能 | 说明 |
|------|------|
| 🚀 快捷键截图 | 自定义全局快捷键唤起截图，框选任意区域 |
| ✏️ 实时标注 | 矩形、箭头、画笔、文字；支持字号/颜色选择与文字再编辑 |
| 🐛 一键提 BUG | 已连接 DMP 并打开缺陷列表页时，截图后直接提交 |
| 📦 浮窗收集 | 未满足提交条件时，截图暂存右下角浮窗，支持单选/多选批量提交 |
| 🖼️ 组合编辑 | 多选截图进入组合编辑器，拼接/排列后生成一张组合图 |
| ⌨️ 自定义快捷键 | 托盘菜单进入「快捷键设置」，自由设定全局截图快捷键 |
| 🔔 统一 Toast | 提交进度、附件上传等状态在屏幕偏下方居中实时提示 |

---

## 核心流程

1. 按快捷键唤起截图工具，框选需要截图的区域
2. 在截图上添加标注（矩形、箭头、画笔、文字）
3. 点击 **「提BUG」**
   - 已连接 DMP 且在缺陷列表页：直接提交，截图窗口立即关闭
   - 未连接或不在缺陷列表页：保存到右下角浮窗，并提示连接 DMP
4. 文字标注会自动带入 DMP 缺陷标题和描述
5. 浮窗中可继续选择单张或多张截图批量提交

### 标题前缀规则

- 标题前缀固定为：`【灵基】`
- 若截图上有文字标注，第一个文字标注作为标题；多个文字标注拼接为描述
- 若无文字标注，标题自动生成：`DMP缺陷 - 2026/7/22 17:02:25`

---

## 系统架构

| 端 | 技术栈 | 用途 |
|----|--------|------|
| Electron 截图工具 | Electron · TypeScript | 截图、标注、DMP 提交、浮窗、组合编辑器 |
| 后端 API | Python · FastAPI · SQLite · SQLAlchemy | 历史本地 BUG 数据存储 |
| WEB 管理端 | Vue 3 · Vite · Element Plus · Pinia | 历史 BUG 列表管理 |

---

## 快速开始

### 环境要求

- macOS（Apple Silicon / arm64）
- Node.js >= 18
- Python >= 3.9
- Google Chrome 或 Microsoft Edge（DMP 自动化需要，Safari 不支持）

### 安装依赖

```bash
# 后端
cd server && pip3 install -r requirements.txt

# WEB 端
cd web && npm install

# Electron 截图工具
cd electron-screenshot && npm install
```

### 启动

```bash
# 终端1：后端（端口 8000）
cd server
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000

# 终端2：WEB 端（端口 5173）
cd web
npm run dev

# 终端3：Electron 截图工具
cd electron-screenshot
npm run dev
```

---

## 打包为独立应用

```bash
./build-app.sh
```

产物：`dist-app/BUG工具-<版本>-arm64.dmg`（Apple Silicon）。

最终用户无需安装 Node.js、Python 或任何依赖，双击即用。

### 首次打开

1. 双击 `.dmg`，把「BUG工具」拖入「应用程序」文件夹
2. 右键点击「BUG工具」→ 选择「打开」→ 再点「打开」以绕过 Gatekeeper
3. 授予**屏幕录制权限**：系统设置 → 隐私与安全性 → 屏幕录制 → 勾选 BUG工具
4. 应用会自动启动内置后端服务

---

## 快捷键

| 操作 | 默认快捷键 |
|------|-----------|
| 唤起截图 | `Cmd/Ctrl + Shift + A`（可自定义） |
| 撤销标注 | `Cmd/Ctrl + Z` |
| 确认文字输入 | `Enter` |
| 删除选中文字标注 | `Delete` / `Backspace` |
| 退出当前层级 | `Esc` |

---

## 功能特性

### 截图标注
- 矩形框、箭头、画笔、文字工具
- 文字工具支持子栏：字号（大/中/小）、颜色选择、编辑、删除
- 文字标注可拖动、双击编辑、选中后删除
- 撤销、清空标注

### DMP 提交
- 自动检测 DMP 连接状态和缺陷列表页
- 已连接且在缺陷列表页时直接提交，不经过浮窗
- 浮窗支持单选/多选批量提交
- 提交进度实时 Toast 反馈
- 上传截图到附件时提示「正在添加截图到附件」

### 浮窗与组合编辑
- 右下角浮窗收集截图
- 支持多选后批量提交或生成组合图
- 组合编辑器支持拖动排序、删除、导出
- 组合编辑器窗口带系统关闭/最小化/最大化按钮

---

## 数据存储

打包应用的数据库存放在：

```
~/Library/Application Support/bug-screenshot-tool/
├── bug_tool.db        # 数据库
└── uploads/           # 截图/录屏文件
```

快捷键配置存放在：

```
~/Library/Application Support/BUG工具/shortcut-config.json
```

---

## 注意事项

- 端口固定：后端 `8000`，WEB `5173`
- SQLite 单机部署，不适合多人高并发写入
- DMP 自动化依赖 Chrome/Edge 的 CDP，请确保浏览器已登录 DMP 并打开缺陷列表页
- 截图文件存放在 `server/uploads/`，不进版本库

---

## 项目结构

```
bugTool/
├── server/                    # FastAPI 后端
├── web/                       # Vue 3 WEB 管理端
├── electron-screenshot/       # Electron 截图工具
│   └── src/
│       ├── main/              # 主进程（截图、IPC、窗口管理、快捷键）
│       ├── preload/           # 预加载脚本
│       └── renderer/          # 渲染进程（截图标注、浮窗、组合编辑器）
├── 启动BUG工具.command         # macOS 双击启动器
├── start.sh
├── stop.sh
└── build-app.sh               # 一键打包脚本
```
