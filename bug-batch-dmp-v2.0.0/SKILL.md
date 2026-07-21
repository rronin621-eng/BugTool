---
name: bug-batch-dmp
description: 从飞书/腾讯文档/金山文档/本地Excel读取BUG记录，自动在金蝶DMP批量创建缺陷单。提取表格数据→自动填充表单→上传附件，单条约20秒。
---

# BUG批量录入DMP

## 数据源策略

按数据源选择最优提取方式：

| 数据源 | 推荐脚本 | 图片 | 说明 |
|--------|---------|------|------|
| **飞书** | `extract_feishu.py`（API）| ✅ 自动下载 | 飞书 API 能通过 fileToken 自动下载嵌入图片 |
| **腾讯文档** | `extract_tencent.py`（API）| ✅ 自动下载 | 需配置腾讯开放平台 API 凭证 |
| **金山文档** | `extract_wps.py`（API）| ✅ 自动下载 | 需配置 WPS 开放平台 API 凭证 |
| **本地 Excel** | `extract_excel.py` | ✅ 自动提取嵌入图片 + 支持外部目录 | 自动提取 .xlsx 内嵌图片，也支持外部 images/ 目录匹配 |

> ⚠️ 各平台导出 xlsx 时嵌入图片可能丢失。如果导出的 .xlsx 保留了嵌入图片，本地 Excel 脚本也能自动提取。

### 提取脚本一览

| 脚本 | 输入 | 输出 |
|------|------|------|
| `scripts/extract_feishu.py` | wiki token | pending_defects.json + images/ |
| `scripts/extract_tencent.py` | 腾讯文档 URL | pending_defects.json + images/ |
| `scripts/extract_wps.py` | 金山文档 URL | pending_defects.json + images/ |
| `scripts/extract_excel.py` | Excel 文件路径 | pending_defects.json + images/（嵌入图片自动提取）|

所有脚本共享 `scripts/utils.py` 的构建逻辑，输出统一格式的 `pending_defects.json`，下游创建流程不区分来源。

### 统一输出格式

```json
{
  "row": 2,
  "module": "模块名",
  "title": "【待修改】【模块名】问题描述",
  "desc": "问题描述",
  "handler_name": "姓名",
  "handler_id": "工号",
  "note": "备注\n走查人XXX",
  "screenshot_files": [],
  "design_ref_files": [],
  "status": "pending"
}
```

---

## 触发场景

当用户说以下内容时触发此 Skill：
- "帮我把飞书/腾讯/金山/Excel 表格的缺陷填到 DevOps"
- "批量创建缺陷单"
- "从在线表格创建 DevOps 缺陷"
- 发送飞书/腾讯/金山文档链接并要求创建缺陷

---

## ⚠️ 人工确认节点（执行前必做）

Agent 执行此 Skill 时，**严禁自行猜测以下信息**，必须停下来向用户确认：

### 首次使用（config.yaml 未配置或为空）

Agent 必须先提取数据，然后**一次性集中确认**：

1. **处理人 → 工号映射**
   - Agent 列出表格中所有处理人姓名
   - 用户提供每个姓名对应的 DevOps 工号
   - Agent 生成 `handler_mapping` 写入 config.yaml

2. **默认值与必填项确认**
   - 模块路径、发现阶段、优先级、缺陷类型、测试环境等
   - **关联故事编码**（必填，搜索 API 不可用。若表格有该列则用表格值，否则问用户）
   - 其他 DevOps 必填字段

   > ⚠️ 关联故事编码可能每批不同。若用户本次提供的编码与 config 默认值不同，以本次为准。

3. **列名映射确认** — 推断列名 → DevOps 字段的映射，用户确认或修正

4. **标题/备注模板确认** — 展示模板预览，用户确认或修改

### 执行中遇到新值

发现 config.yaml 未覆盖的新值时，**暂停并询问**：

1. **新处理人**："row 145 处理人'王五'不在映射表，工号是？"
2. **新模块**：表格中出现未配置的模块路径
3. **数据异常**：处理人字段不像人名、必填字段为空 → 暂停询问

### 确认呈现原则

- **批量展示，不逐条问**：首次配置时一次性列出所有待确认项
- **静默复用已知值**：config 已有的映射直接使用不重复问
- **只问不确定的**：只询问 config 未覆盖的新值

---

## 工作流程

### 第 1 步：识别数据源

根据用户提供的链接或文件判断数据源类型：

| 用户输入 | 数据源 | 提取脚本 |
|---------|--------|----------|
| 飞书 wiki 链接 | 飞书 | `extract_feishu.py --wiki-token TOKEN` |
| 腾讯文档链接 | 腾讯文档 | `extract_tencent.py --doc-url URL` |
| 金山文档链接 | 金山文档 | `extract_wps.py --doc-url URL` |
| 本地 .xlsx 文件 | 本地 Excel | `extract_excel.py --input PATH` |

### 第 2 步：读取配置

读取 `config.yaml` 获取：
- 列名映射（所有数据源共用 `column_mapping` 配置块）
- DevOps 表单默认值（含发现阶段 `discovery_stage`）
- 处理人 → 工号映射
- 对应数据源的 API 凭证

### 第 3 步：提取数据

所有提取脚本支持以下通用参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--config` | `config.yaml` | 配置文件路径 |
| `--output` | `pending_defects.json` | 输出文件路径 |
| `--images-dir` | `images` | 图片输出目录 |

运行对应脚本，输出 `pending_defects.json`：

```bash
# 飞书
python3 scripts/extract_feishu.py --wiki-token TOKEN --config config.yaml
# 腾讯文档
python3 scripts/extract_tencent.py --doc-url URL --config config.yaml
# 金山文档
python3 scripts/extract_wps.py --doc-url URL --config config.yaml
# 本地 Excel
python3 scripts/extract_excel.py --input file.xlsx --config config.yaml
```

### 第 4 步：填充 DevOps 表单

使用 Playwright + Chrome CDP 或 browser-use MCP 自动化填充：

1. **启动浏览器**：`node scripts/launch_cdp.mjs`（首次需手动登录，登录态保存在 `.browser-profile/`）
2. **手动打开** DevOps「新建缺陷」页面
3. **逐条创建**：`node scripts/create_one.mjs ROW [storyValue] [saveMethod]`
   - 或批量：`node scripts/create_batch.mjs [storyValue] [saveMethod]`
4. 填充字段：标题、描述、处理人、关联故事、备注、附件
5. 保存 → 创建下一条

---

## 关键技术细节

### DevOps 表单字段操作（金蝶苍穹平台 kd-cq-* 组件）

```javascript
// 设置标题（execCommand 确保 React 状态同步）
component.execCommand('insertText', false, title)

// 设置处理人/发现阶段/关联故事（basedata 搜索型组件）
// fill 关键词 → 选 .kd-cq-dropdown-menu-item
component.onBaseDataSelectItem(personId, false)

// 设置缺陷描述（TinyMCE 富文本编辑器）
tinymce.get('editor_id').setContent(htmlContent)

// 上传文件：使用 browser-use upload_file 或 Playwright setInputFiles
```

### 字段映射规则

**必填字段**（默认值来自 `config.yaml` 的 `devops_defaults`）：
- 标题 ← 由 `title_template` 模板生成
- 缺陷描述 ← 在线表格"问题描述"列
- 测试环境、项目名称、模块路径、缺陷类型、发现阶段、优先级、来源 ← config 默认值
- 关联故事 ← **必填**，搜索 API 不可用，需用户提供故事编码

**动态字段**（来自在线表格）：
- 处理人 ← "处理人"列（通过 `handler_mapping` 映射工号）
- 备注 ← "备注" + "走查人" + 设计稿参考文字
- 附件 ← "问题截图" + "设计稿参考"（图片文件）

### 字段定位方式

| 字段 | Playwright 定位 |
|------|----------------|
| 标题 | `input[placeholder="名称不能为空"]:visible` |
| 描述 | `window.tinymce.activeEditor.setContent(html)` |
| basedata 类型字段 | `.kd-cq-field.kd-cq-basedata:visible` → fill → 选下拉项 |
| 备注 | `.kd-cq-field.kd-cq-textarea:visible` |
| 保存按钮 | `#bar_save`（`<div>` 元素，非 `<button>`） |

---

## 配置说明

详见 `config.yaml.example`：

| 配置块 | 用途 |
|--------|------|
| `column_mapping` | 列名映射（所有数据源共用） |
| `devops_defaults` | DevOps 表单默认值（项目名称、模块路径、发现阶段等） |
| `handler_mapping` | 处理人姓名 → 工号映射 |
| `feishu_api` | 飞书 API 凭证（app_id / app_secret） |
| `tencent_api` | 腾讯文档 API 凭证（client_id / client_secret） |
| `wps_api` | 金山文档 API 凭证（client_id / client_secret） |
| `title_template` | 标题格式模板 |
| `note_template` | 备注格式模板 |

---

## 踩坑记录

### 金蝶苍穹平台通用

1. **所有定位必须加 `:visible`**：重新打开表单后 DOM 会残留旧实例，`.first()` 会定位到隐藏元素导致超时
2. **basedata 是搜索型，不是点击展开**：必须 `fill` 关键词触发搜索，第一项通常是"新增"要跳过
3. **保存按钮 `#bar_save`**：是 `<div>` 不是 `<button>`，需要用 `dispatchEvent` 模拟 click
4. **缺陷编号动态分配**：表单打开时的编号 ≠ 最终保存的编号，以保存后系统分配的为准
5. **"我处理的"列表过滤**：缺陷列表默认只显示当前用户的缺陷，需关闭此过滤才能搜索其他人的

### browser-use MCP 专属

- **click 超时**：工具栏按钮的 click 操作会超时 5000ms，用 `evaluate_script` + `dispatchEvent` 代替
- **upload_file**：必须用"上传文件"按钮的 uid，不要用隐藏的 file input
- **双击打开编辑**：通过 `evaluate_script` 选中行 checkbox + `dispatchEvent('dblclick')`

### Playwright + CDP 方案

- **启动**：`node scripts/launch_cdp.mjs`，用系统 Chrome 暴露 CDP 端口 9222（支持 macOS/Linux/Windows）
- **登录态**：保存在 `.browser-profile/`，下次复用
- **会话过期**：操作超过 ~30 分钟触发"会话缓存丢失，请重新登录"
- **关联故事搜索 API 返回空**：`getLookUpList` 始终返回空数组。已通过 `setItemByNumber` 方法绕过搜索直接设值，需用户提供故事编码

---

## 错误处理

1. **API 认证失败**：检查对应平台的凭证是否正确，应用是否已发布
2. **处理人找不到**：使用 `handler_mapping.default` 指派的默认处理人
3. **图片下载失败**：记录错误，继续处理其他缺陷
4. **DevOps 保存失败**：检查必填字段是否完整，重试一次

---

## 环境要求

- **Node.js** >= 18（Playwright 浏览器自动化）
- **Python** >= 3.8（数据提取脚本）
- **Python 依赖**：`pip install -r requirements.txt`（requests, pyyaml, openpyxl）
- **Node.js 依赖**：`npm install`（playwright）
- **Chrome**：系统已安装 Google Chrome（CDP 方案，自动检测 macOS/Linux/Windows 路径）
