# 设计文档：多图截图与组合

## 概述

在现有 Electron 截图工具基础上，新增「多图收集 → 组合编辑 → 输出」的能力。整体复用现有的截图、标注、BUG 录入基础设施，新增两个窗口（暂存小窗、组合编辑器）和若干 IPC 通道。

核心数据载体是带标注的 PNG 图像（base64 dataURL）。多图功能通过在主进程维护一个图片数组（最多 5 张）来串联各窗口。

## 架构

### 窗口与进程关系

```
主进程 (main/index.ts)
├── 截图窗口 (screenshotWindow)            — 已有，新增「多图」按钮回调
├── 暂存小窗 (stackWindow)                 — 新增，桌面右下角置顶
├── 组合编辑器窗口 (combineWindow)          — 新增，大尺寸弹窗
└── 多图状态 (multiShotStore)              — 新增，主进程内存数组，最多5张
```

### 数据流

```
1. 截图标注完成 → 点「多图」
   renderer(screenshot.js) 导出 dataURL
   → IPC: multishot:add(dataURL)
   → 主进程 push 到 multiShotStore，关闭截图窗
   → 创建/更新暂存小窗，推送最新列表

2. 暂存小窗点「生成组合图」
   → IPC: multishot:open-combine
   → 主进程创建组合编辑器窗口
   → 编辑器加载后请求 multishot:get-list 拿到所有图片

3. 组合编辑器输出（复制/保存/录入）
   → 编辑器将画布合成为单张 dataURL
   → 复用现有 screenshot:copy / screenshot:save / bug:submit
   → 成功后 IPC: multishot:clear 清空 store 并关闭小窗与编辑器
```

### 为什么在主进程存图片数组

- 截图窗口每次截图都是独立的 BrowserWindow，关闭后销毁，无法跨窗口保留状态。
- 暂存小窗、组合编辑器是不同窗口，需要共享同一份图片列表。
- 主进程作为单一数据源（single source of truth），各窗口通过 IPC 读写，避免状态不一致。

## 组件与接口

### 1. 主进程：多图状态管理（新增 `main/multishot.ts`）

```typescript
// 内存中的多图集合，最多 5 张
const MAX_IMAGES = 5;
let images: string[] = [];   // base64 dataURL 数组

export function addImage(dataUrl: string): { ok: boolean; count: number; reason?: string }
export function removeImage(index: number): number   // 返回剩余数量
export function getImages(): string[]
export function clearImages(): void
export function getCount(): number
```

窗口管理（可放在同文件或 `main/multishot-windows.ts`）：

```typescript
export function showStackWindow(): void       // 创建或更新暂存小窗
export function updateStackWindow(): void      // 推送最新列表给小窗
export function closeStackWindow(): void
export function openCombineWindow(): void      // 打开组合编辑器
export function closeCombineWindow(): void
```

### 2. IPC 通道（新增）

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `multishot:add` | renderer→main | dataUrl | 添加一张图，关闭截图窗，弹出/刷新小窗 |
| `multishot:get-list` | renderer→main (invoke) | - | 返回当前图片数组 |
| `multishot:remove` | renderer→main | index | 删除指定图，刷新小窗 |
| `multishot:clear` | renderer→main | - | 清空并关闭小窗 |
| `multishot:open-combine` | renderer→main | - | 打开组合编辑器 |
| `multishot:list-updated` | main→renderer | images[] | 通知小窗/编辑器列表已更新 |
| `multishot:count` | main→renderer | count | 截图窗口查询当前数量（用于按钮禁用态） |

复用的现有通道：`screenshot:copy`、`screenshot:save`、`bug:submit`、`users:list`、`tasks:list`、`modules:list`。

### 3. 截图工具栏（修改 `renderer/index.html` + `screenshot.js`）

- 在 `#toolbar` 的动作区（btnCopy / btnDownload / btnBug 附近）新增按钮：
  ```html
  <button id="btnMultiShot" class="tool-btn action-btn" title="加入多图">▦</button>
  ```
- `screenshot.js`：
  - 点击 `btnMultiShot` → 调 `exportAnnotatedImage()` 得到 dataURL → `api.addToMultiShot(dataUrl)` → 主进程关闭当前窗口。
  - 截图窗口加载时查询当前多图数量；达到 5 张时禁用按钮并提示。

### 4. 暂存小窗（新增 `renderer/stack/`）

文件：`stack/index.html`、`stack/stack.css`、`stack/stack.js`

- 窗口：无边框、置顶、`skipTaskbar`、尺寸约 `180×260`，定位到主显示器工作区右下角。
- 内容：
  - 顶部：标题「多图收集 (N/5)」+ 可拖拽区域（`-webkit-app-region: drag`）。
  - 中部：纵向滚动的缩略图列表，每张 hover 显示删除按钮。
  - 底部：「生成组合图」按钮（列表为空时禁用）+「清空」按钮。
- 通过 `multishot:list-updated` 接收主进程推送，重渲染缩略图与计数。

### 5. 组合编辑器（新增 `renderer/combine/`）

文件：`combine/index.html`、`combine/combine.css`、`combine/combine.js`

布局：左侧画布 + 顶部/侧边工具栏（复用截图标注的工具样式）。

- **画布渲染**：
  - 白色背景，图片按当前方向（横/竖）依次并排，统一间距（如 16px），每张图绘制阴影。
  - 维护一个 `slots` 数组，元素含 `{ dataUrl, img, scale }`；按数组顺序布局。
- **方向切换**：顶部「横向 / 竖向」切换控件，改变布局算法后重绘。
- **排序拖拽**：拖动某张图时计算其在序列中的目标插入位置，仅重排 `slots` 顺序，不允许自由落点（HTML5 drag 或鼠标事件 + 命中检测实现）。
- **缩放**：选中某图后通过滑块或拖拽角点调整其 `scale`，重新布局。
- **标注**：复用 `screenshot.js` 中的标注逻辑（矩形/箭头/画笔/文字 + 颜色/线宽 + 撤销/清除）。标注绘制在合成层之上，坐标基于最终画布。
- **文字输入**：使用与截图一致的窗口层级切换（取消置顶）保证输入法可见。
- **输出区**：复制 / 保存 / 录入 三个按钮。
  - 录入：复用现有 BUG 录入弹窗结构（可将表单做成共享片段，或在编辑器内内嵌一份相同表单）。
  - 输出时将画布（含所有图片、阴影、标注）导出为单张 PNG dataURL。

### 6. 合成与导出算法

```
1. 计算每张图缩放后的尺寸：w_i = img.width * scale_i, h_i 同理
2. 横向布局：
   canvasW = padding + Σ(w_i + gap) ；canvasH = padding*2 + max(h_i)
   每张图 y 居中，x 依次累加
   竖向布局对称处理
3. 画布填充白色背景
4. 逐张绘制：先画阴影（ctx.shadowColor/Blur/Offset），再 drawImage
5. 叠加标注层
6. canvas.toDataURL('image/png')
```

## 数据模型

主进程内存状态（无持久化）：

```typescript
interface MultiShotState {
  images: string[];        // base64 PNG dataURL，最多 5 张
}
```

组合编辑器内部状态：

```typescript
interface CombineSlot {
  dataUrl: string;
  img: HTMLImageElement;
  scale: number;           // 缩放比例，默认 1
}
interface CombineState {
  slots: CombineSlot[];
  direction: 'horizontal' | 'vertical';
  annotations: Annotation[];   // 复用截图标注结构
  selectedIndex: number;       // 当前选中图片，用于缩放
}
```

## 错误处理

- **达到上限**：`addImage` 返回 `{ ok: false, reason: 'limit' }`，截图渲染层提示「最多支持 5 张」。
- **小窗为空**：删除最后一张后主进程调用 `closeStackWindow()`，并清空 store。
- **组合编辑器打开时图片为空**：理论上不会发生（按钮禁用），兜底显示空提示并允许关闭。
- **录入/上传失败**：复用现有 `bug:submit` 的错误返回，编辑器内提示，不清空 store（便于重试）。
- **窗口销毁竞态**：所有窗口操作前检查 `!win.isDestroyed()`，与现有代码一致。

## 测试策略

本项目为 Electron 桌面工具，无既有自动化测试框架。采用手动验证为主：

1. **多图收集**：连续截 3 张分别加入，验证小窗按序显示 3 张、计数正确。
2. **上限**：加入第 6 张时按钮禁用 / 提示。
3. **删除**：删中间一张，列表顺序正确；删到 0 张小窗自动关闭。
4. **方向切换**：横向/竖向切换布局正确，间距与阴影正常。
5. **排序拖拽**：拖动改变顺序，无重叠。
6. **缩放**：选中放大/缩小，布局重新计算正确。
7. **标注**：四种工具 + 撤销 + 文字输入法显示正常。
8. **输出**：复制、保存、录入三条路径各验证一次，成功后小窗与编辑器关闭、store 清空。
9. **兼容性**：原单图「复制/保存/录入」流程不受影响。

合成算法（布局尺寸计算）是纯函数，可单独抽出做单元验证（如需引入测试，用 Node 直接跑布局函数断言尺寸）。

## 实现注意事项

- 复用现有标注绘制函数（`drawAnnotation`、`drawArrow`、`drawPenPath` 等），建议抽取为共享模块 `renderer/shared/annotate.js`，供截图与组合编辑器共用，避免复制粘贴。
- `copy-renderer` 构建脚本需同步复制新增的 `stack/` 和 `combine/` 目录及 `shared/` 文件，需更新 `package.json` 的 `copy-renderer` 命令。
- 暂存小窗与组合编辑器都需要 preload 暴露对应 API，需扩展 `preload/index.ts`。
- 组合编辑器录入 BUG 时，窗口层级与输入法问题沿用截图窗口已验证的方案（输入时取消 alwaysOnTop）。
