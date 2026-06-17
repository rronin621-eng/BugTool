# 实现任务清单：区域录屏

- [x] 1. 引入 ffmpeg-static 依赖
  - 在 `electron-screenshot/package.json` 的 dependencies 加入 `ffmpeg-static`
  - 运行 npm install 验证当前平台二进制下载成功
  - _需求: 4.2_

- [x] 2. 后端上传接口扩展支持 mp4
  - 修改 `server/routers/uploads.py`：`allowed_types` 增加 `video/mp4`
  - 在 `server/config.py` 新增视频大小上限 `MAX_VIDEO_SIZE`，上传时按类型选择限制
  - 验证 mp4 文件能成功上传并入库（复用 screenshots 表）
  - _需求: 5.3, 6.1_

- [x] 3. 截图/录屏页签 UI
  - 在 `renderer/index.html` 框选后区域新增「截图 / 录屏」页签容器
  - 在 `style.css` 添加页签样式
  - 在 `screenshot.js` 实现页签切换：录屏页签隐藏标注/复制/保存/录入/组合，显示录制控制条
  - 切换时保持已框选区域不变
  - _需求: 1.1, 1.2, 1.3, 1.4_

- [x] 4. 录制控制条 UI
  - 新增录制控制条 DOM（开始/暂停/停止/计时）
  - 添加控制条样式
  - _需求: 3.1, 3.2_

- [x] 5. 区域屏幕录制逻辑
  - 新增 `renderer/record.js`：用 desktopCapturer + getUserMedia 获取整屏流
  - 将整屏视频帧的框选区域绘制到离屏 canvas，captureStream 后用 MediaRecorder 录制
  - 区域坐标从 CSS 逻辑像素换算到物理像素
  - _需求: 2.1, 2.2, 2.3, 2.4_

- [x] 6. 录制控制与计时
  - 实现开始/暂停/继续/停止逻辑，实时更新计时显示
  - 达到 5 分钟自动停止并提示
  - 停止后得到 webm Blob
  - _需求: 3.2, 3.3, 3.4_

- [x] 7. mp4 转换（主进程）
  - 在主进程实现 webm→mp4 转换函数，使用 ffmpeg-static（libx264 + yuv420p + faststart）
  - 转换期间向渲染层反馈「处理中」状态
  - 转换失败时保留 webm 兜底并提示
  - _需求: 4.1, 4.3, 4.4_

- [x] 8. 录屏 IPC 通道与 preload
  - 新增 `record:save-webm`、`record:submit-bug` 等 IPC 处理
  - 在 `preload/index.ts` 暴露 `recordAPI`
  - _需求: 5.1, 5.2, 5.3_

- [x] 9. 录屏输出操作（保存/录入）
  - 录制完成后界面显示「保存到桌面」「录入 BUG」（不含复制）
  - 保存：转 mp4 写入桌面并提示文件名
  - 录入：复用 BUG 录入表单，mp4 作为附件上传创建 BUG
  - _需求: 5.1, 5.2, 5.3, 5.4_

- [x] 10. 构建脚本更新与整体联调
  - 更新 `copy-renderer` 复制 `record.js`
  - README 安装说明补充「首次安装会下载较大的 ffmpeg 依赖」
  - 重新构建并按测试策略验证全流程，确认截图/多图流程不受影响
  - _需求: 6.1, 6.2, 6.3_
