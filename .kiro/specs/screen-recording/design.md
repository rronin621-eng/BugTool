# 设计文档：区域录屏

## 概述

在截图窗口中，框选区域后通过顶部页签切换「截图 / 录屏」。录屏使用 Electron 的屏幕采集能力（`desktopCapturer` + `getUserMedia`），将整屏视频流绘制到一个裁剪到框选区域的离屏 canvas，再用 `MediaRecorder` 录制该 canvas 流，输出 webm。录制结束后，主进程用内置 `ffmpeg-static` 将 webm 转为 mp4，最终保存到桌面或作为附件录入 BUG。

## 架构

### 录制管线

```
框选区域 (x, y, w, h)
  → desktopCapturer 获取屏幕源
  → getUserMedia 拿到整屏 MediaStream
  → <video> 播放整屏流
  → requestAnimationFrame 将 video 的 [x,y,w,h] 区域绘制到离屏 canvas
  → canvas.captureStream(fps)
  → MediaRecorder 录制 → webm Blob
  → 通过 IPC 把 webm 数据交给主进程
  → ffmpeg-static 转 mp4
  → 保存 / 上传
```

为什么用 canvas 中转：`MediaRecorder` 只能录制完整的屏幕流，无法直接录制屏幕的某一区域。通过把视频帧的指定区域画到 canvas 再录 canvas 流，即可实现"只录框选部分"。

### 进程职责

```
渲染进程 (screenshot.js / 新增 record.js)
├── 页签切换 UI
├── 屏幕流采集与区域裁剪绘制
├── MediaRecorder 录制控制（开始/暂停/停止/计时/5分钟上限）
└── 录制完成 → 把 webm ArrayBuffer 发给主进程

主进程 (ipc-handlers.ts / 新增 recording 处理)
├── 接收 webm 数据，写临时文件
├── 调用 ffmpeg-static 转 mp4
├── 保存到桌面 / 作为 BUG 附件上传
└── 清理临时文件

后端 (server/routers/uploads.py)
└── 扩展上传接口：允许 video/mp4，放宽大小限制
```

## 组件与接口

### 1. 页签 UI（修改 `renderer/index.html` + `style.css`）

- 在工具栏上方或工具栏内新增页签容器：
  ```html
  <div id="modeTabs" class="mode-tabs hidden">
    <button id="tabShot" class="mode-tab active">截图</button>
    <button id="tabRecord" class="mode-tab">录屏</button>
  </div>
  ```
- 框选完成（进入 annotate 阶段）后显示页签。
- 切到录屏页签时，隐藏标注工具与复制/保存/录入/组合按钮，显示录制控制条。

### 2. 录制控制条（新增 DOM + `record.js`）

```html
<div id="recordBar" class="record-bar hidden">
  <button id="btnRecStart">● 开始录制</button>
  <button id="btnRecPause" class="hidden">暂停</button>
  <button id="btnRecStop" class="hidden">停止</button>
  <span id="recTimer" class="hidden">00:00</span>
</div>
```

### 3. 渲染层录制逻辑（新增 `renderer/record.js`）

```javascript
// 主要函数
async function startRecording(region)   // region = {x,y,w,h} 物理像素
function pauseRecording() / resumeRecording()
function stopRecording()                 // 返回 webm Blob
// 内部：
//  - getScreenStream(): desktopCapturer + getUserMedia 拿整屏流
//  - drawLoop(): 把整屏 video 的 region 区域绘制到离屏 canvas
//  - MediaRecorder(canvas.captureStream(30))
//  - 计时器 + 5 分钟自动停止
```

注意区域坐标需从 CSS 逻辑像素换算到屏幕物理像素（乘以 devicePixelRatio），与截图裁剪逻辑一致。

### 4. IPC 通道（新增）

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `record:save-webm` | renderer→main (invoke) | ArrayBuffer | 接收 webm，转 mp4，保存到桌面 |
| `record:submit-bug` | renderer→main (invoke) | { webm: ArrayBuffer, bugData } | 转 mp4 后作为附件创建 BUG |
| `record:convert-status` | main→renderer | 状态文本 | 转换进度提示（可选） |

`preload/index.ts` 暴露 `recordAPI`：`saveRecording(arrayBuffer)`、`submitRecordingBug(data)`。

### 5. mp4 转换（主进程，依赖 `ffmpeg-static`）

```typescript
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';

function convertWebmToMp4(webmPath: string, mp4Path: string): Promise<void> {
  // ffmpeg -i input.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart output.mp4
  // -pix_fmt yuv420p 保证微信/QuickTime 等广泛兼容
}
```

- `ffmpeg-static` 作为 `dependencies` 加入 `electron-screenshot/package.json`，`npm install` 时自动下载当前平台的二进制，无需用户手动安装。
- 转换在主进程进行，避免阻塞渲染进程。

### 6. 后端上传接口扩展（修改 `server/routers/uploads.py` + `config.py`）

- 在 `allowed_types` 增加 `video/mp4`（保留原图片类型）。
- 为视频放宽大小限制：新增 `MAX_VIDEO_SIZE`（如 200MB），按文件类型选择限制。
- `Screenshot` 表可继续复用（存 file_path/file_name/file_size），mp4 也走该表；前端展示时按扩展名区分图片/视频。
- 可选：新增独立 `/uploads/video` 端点，或复用 `/uploads/screenshot` 并放宽类型校验。建议复用并改名校验逻辑，减少改动面。

## 数据流细节

### 保存到桌面
```
record.js: stopRecording() → webm Blob → arrayBuffer
  → recordAPI.saveRecording(arrayBuffer)
  → main: 写 temp.webm → ffmpeg 转 temp.mp4 → 复制到 ~/Desktop/recording_<ts>.mp4
  → 通知成功 → 关闭截图窗
```

### 录入 BUG
```
record.js: 填写表单 + webm arrayBuffer
  → recordAPI.submitRecordingBug({ webm, bugData })
  → main: 转 mp4 → POST /bugs 创建记录 → 上传 mp4 附件
  → 成功 → 关闭窗口、通知查看器刷新
```

## 错误处理

- **屏幕录制权限缺失**：getUserMedia 失败时提示"请在系统设置授予屏幕录制权限"。
- **ffmpeg 转换失败**：提示错误，保留 webm 文件到桌面作为兜底（需求 4.4）。
- **超过 5 分钟**：渲染层计时器自动调用 stopRecording 并提示。
- **文件过大上传失败**：后端返回大小超限提示；前端建议改用"保存到桌面"。
- **窗口关闭竞态**：录制中关闭窗口时，先停止 MediaRecorder 释放屏幕流，再销毁窗口。

## 测试策略

手动验证为主：

1. **页签切换**：框选后出现页签，切换不影响选区；截图页签行为不变。
2. **区域录制**：录制结果只含框选区域，无遮罩/工具栏入镜。
3. **控制**：开始/暂停/继续/停止，计时正确；5 分钟自动停止。
4. **格式**：输出文件为 mp4，能在 QuickTime、微信发送并播放。
5. **保存**：保存到桌面文件名正确、可播放。
6. **录入**：录入 BUG 后，附件能在 WEB 端/查看器访问播放。
7. **无 ffmpeg 手动安装**：全新 `npm install` 后录屏转换可用。
8. **兼容性**：截图、多图组合流程不受影响。

mp4 转换命令与坐标换算（CSS→物理像素）是关键纯逻辑点，可单独验证。

## 实现注意事项

- `ffmpeg-static` 增加约 70-80MB 体积，`npm install` 自动处理，需在 README 安装说明中提及首次安装会下载较大依赖。
- webm→mp4 用 `libx264 + yuv420p + faststart`，保证通讯软件与浏览器兼容。
- 录制临时文件放系统临时目录，转换完成后清理。
- 录屏期间截图窗口的 `alwaysOnTop` 层级需避免遮挡录制区域（录制的是屏幕实际画面，工具条应在区域外或录制开始后隐藏）。
