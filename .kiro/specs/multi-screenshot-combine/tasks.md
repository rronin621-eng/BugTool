# 实现任务清单：多图截图与组合

- [x] 1. 抽取共享标注模块，供截图与组合编辑器复用
  - 从 `renderer/screenshot.js` 中抽出标注绘制相关纯函数（`drawAnnotation`、`drawArrow`、`drawPenPath`）到新文件 `renderer/shared/annotate.js`
  - 在 `screenshot.js` 中改为引用共享模块，确保现有截图标注功能不受影响
  - 更新 `package.json` 的 `copy-renderer` 脚本，复制 `shared/` 目录到 dist
  - _需求: 5.1, 5.2, 5.3_

- [x] 2. 主进程多图状态管理模块
  - 新建 `main/multishot.ts`，实现内存图片数组（最多 5 张）：`addImage`、`removeImage`、`getImages`、`clearImages`、`getCount`
  - `addImage` 在达到 5 张上限时返回失败标记
  - _需求: 1.3, 1.5, 2.5_

- [x] 3. 主进程暂存小窗的创建与管理
  - 在 `main/multishot.ts`（或新建 `main/multishot-windows.ts`）实现 `showStackWindow`、`updateStackWindow`、`closeStackWindow`
  - 小窗为无边框、置顶、skipTaskbar，定位到主显示器工作区右下角
  - 图片列表变化时通过 `multishot:list-updated` 推送最新数据给小窗
  - 列表清空时自动关闭小窗
  - _需求: 2.1, 2.2, 2.6_

- [x] 4. 注册多图相关 IPC 通道
  - 在 IPC 注册处新增：`multishot:add`、`multishot:get-list`、`multishot:remove`、`multishot:clear`、`multishot:open-combine`、`multishot:count`
  - `multishot:add` 添加图片后关闭来源截图窗、弹出/刷新小窗
  - 在 `preload/index.ts` 暴露对应的渲染层 API（截图、小窗、编辑器各自需要的方法）
  - _需求: 1.2, 1.3, 2.4, 3.2, 3.4_

- [x] 5. 截图工具栏新增「多图」按钮
  - 在 `renderer/index.html` 的 `#toolbar` 动作区新增「多图」按钮
  - 在 `screenshot.js` 绑定点击：导出当前带标注图像 → 调用多图添加 API → 关闭当前截图窗
  - 截图窗加载时查询当前数量，达到 5 张时禁用按钮并提示「最多支持 5 张」
  - _需求: 1.1, 1.2, 1.4, 1.5_

- [x] 6. 暂存小窗界面与交互
  - 新建 `renderer/stack/index.html`、`stack/stack.css`、`stack/stack.js`
  - 顶部标题显示「多图收集 (N/5)」并设为可拖拽区域
  - 中部纵向缩略图列表，每张 hover 显示删除按钮，点击删除调用对应 API
  - 底部「生成组合图」按钮（列表空时禁用）与「清空」按钮（带确认提示）
  - 接收 `multishot:list-updated` 推送后重渲染列表与计数
  - _需求: 2.3, 2.4, 2.5, 2.7, 3.1, 3.2, 3.3, 3.4_

- [x] 7. 主进程组合编辑器窗口管理
  - 实现 `openCombineWindow`、`closeCombineWindow`，创建大尺寸编辑器窗口
  - 编辑器加载后通过 `multishot:get-list` 获取所有图片
  - _需求: 3.2, 4.1_

- [x] 8. 组合编辑器 — 画布布局与方向切换
  - 新建 `renderer/combine/index.html`、`combine/combine.css`、`combine/combine.js`
  - 实现白底画布，图片按方向并排、统一间距、每张带阴影
  - 提供「横向 / 竖向」切换控件，切换后即时重新布局
  - 实现布局尺寸计算（横向/竖向画布宽高与每张图位置）
  - _需求: 4.1, 4.2, 4.5_

- [x] 9. 组合编辑器 — 拖拽排序与缩放
  - 实现拖动图片仅调整前后顺序（重排序列，不自由摆放、不重叠）
  - 实现选中图片后缩放该图大小并重新布局
  - _需求: 4.3, 4.4_

- [x] 10. 组合编辑器 — 标注功能
  - 接入共享标注模块，提供矩形/箭头/画笔/文字、颜色/线宽、撤销/清除
  - 文字输入时切换窗口层级，保证输入法候选框可见
  - _需求: 5.1, 5.2, 5.3, 5.4_

- [x] 11. 组合编辑器 — 合成导出与输出操作
  - 实现将画布（图片 + 阴影 + 标注）合成为单张 PNG dataURL
  - 提供「复制到剪贴板」「保存到桌面」「录入 BUG」三个按钮，复用现有 IPC
  - 录入 BUG 复用现有表单结构，把组合图作为附件
  - 成功后清空多图 store、关闭小窗与编辑器
  - _需求: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 12. 构建脚本更新与整体联调
  - 更新 `package.json` 的 `copy-renderer`，复制 `stack/`、`combine/`、`shared/` 到 dist
  - 重新构建并按测试策略手动验证全流程，确认原单图流程不受影响
  - _需求: 7.1, 7.2, 7.3_
