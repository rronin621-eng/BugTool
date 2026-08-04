// ============ State ============
const state = {
  phase: 'select', // 'select' | 'annotate'
  screenshotImage: null,
  selection: { x: 0, y: 0, w: 0, h: 0 },
  isSelecting: false,
  selectStart: { x: 0, y: 0 },
  currentTool: 'rect', // 'rect' | 'arrow' | 'pen' | 'text'
  drawColor: '#ff0000',
  lineWidth: 3,
  annotations: [],
  isDrawing: false,
  drawStart: { x: 0, y: 0 },
  currentPath: [],
  users: [],
  inspectionTasks: [],
  modules: [],
  defaultReporterId: null,
  // 文字拖拽
  draggingTextIdx: -1,
  dragOffset: { x: 0, y: 0 },
  // 文字输入刚确认冷却标志，防止 blur 后立即触发新输入
  textJustConfirmed: false,
  // 文字子栏设置
  textFontSize: 20,       // 默认中号字
  textColor: '#ff0000',  // 文字默认颜色
  selectedTextIdx: -1,   // 当前选中的文字标注索引
  // Retina / HiDPI support
  dpr: window.devicePixelRatio || 1,
  canvasW: 0,  // logical (CSS) pixel width
  canvasH: 0,  // logical (CSS) pixel height
  // 选框调整
  resizingHandle: null,   // 当前拖动的手柄 id
  resizeOrigin: null,     // resize 开始时的选区快照 { x,y,w,h }
  resizeStart: null,      // resize 开始时的鼠标坐标 { x,y }
  ocrMode: false,         // OCR 文字识别模式
};

// ============ DOM Elements ============
const overlay = document.getElementById('overlay');
const bgCanvas = document.getElementById('bgCanvas');
const drawCanvas = document.getElementById('drawCanvas');
const bgCtx = bgCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');
const selectionInfo = document.getElementById('selectionInfo');
const selectionSize = document.getElementById('selectionSize');
const toolbar = document.getElementById('toolbar');
const bugFormOverlay = document.getElementById('bugFormOverlay');
const textInput = document.getElementById('textInput');
const ocrTextLayer = document.getElementById('ocrTextLayer');

// 文字子栏元素
const textSubToolbar = document.getElementById('textSubToolbar');
const textColorPicker = document.getElementById('textColorPicker');
const btnTextEdit = document.getElementById('btnTextEdit');
const btnTextDelete = document.getElementById('btnTextDelete');

// BUG 弹窗内的预览 canvas
const bugFormCanvas = document.getElementById('bugFormCanvas');
const bugFormCtx = bugFormCanvas.getContext('2d');
const bugTextInput = document.getElementById('bugTextInput');

// ============ Init ============
const api = window.screenshotAPI;

// 编辑模式状态
let _editMode = false;
let _editIndex = -1;

api.onScreenshotStart((imageDataUrl) => {
  const img = new Image();
  img.onload = () => {
    state.screenshotImage = img;
    initCanvas(img);
    overlay.classList.remove('hidden');
  };
  img.src = imageDataUrl;
});

function initCanvas(img) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = state.dpr;

  state.canvasW = w;
  state.canvasH = h;

  // Set canvas physical size to native resolution for sharp rendering on Retina
  bgCanvas.width = w * dpr;
  bgCanvas.height = h * dpr;
  bgCanvas.style.width = w + 'px';
  bgCanvas.style.height = h + 'px';
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawCanvas.width = w * dpr;
  drawCanvas.height = h * dpr;
  drawCanvas.style.width = w + 'px';
  drawCanvas.style.height = h + 'px';
  drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Draw screenshot scaled to CSS pixel size (scale transform handles Retina upscaling)
  bgCtx.drawImage(img, 0, 0, w, h);

  // Draw dimming overlay
  bgCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  bgCtx.fillRect(0, 0, w, h);

  state.phase = 'select';
}

// Scale factor from logical (CSS) pixels to screenshot image pixels
function imgScaleX() {
  return state.screenshotImage.width / state.canvasW;
}
function imgScaleY() {
  return state.screenshotImage.height / state.canvasH;
}

// 暴露给录屏模块：返回框选区域（屏幕物理像素）及屏幕信息
window.getCaptureRegion = function () {
  const s = state.selection;
  if (!s || s.w <= 0 || s.h <= 0) return null;
  return {
    x: Math.round(s.x * imgScaleX()),
    y: Math.round(s.y * imgScaleY()),
    w: Math.round(s.w * imgScaleX()),
    h: Math.round(s.h * imgScaleY()),
    screenW: state.screenshotImage ? state.screenshotImage.width : 0,
    screenH: state.screenshotImage ? state.screenshotImage.height : 0,
  };
};

// ============ Selection ============
drawCanvas.addEventListener('mousedown', (e) => {
  if (state.phase === 'select') {
    // Notify main process to close all other display overlay windows
    api.focusThisDisplay();
    state.isSelecting = true;
    state.selectStart = { x: e.clientX, y: e.clientY };
  } else if (state.phase === 'annotate') {
    // 先检测是否命中手柄
    const handle = hitTestHandle(e.clientX, e.clientY);
    if (handle) {
      state.resizingHandle = handle.id;
      state.resizeOrigin = { ...state.selection };
      state.resizeStart = { x: e.clientX, y: e.clientY };
      return;
    }
    handleAnnotationStart(e);
  }
});

drawCanvas.addEventListener('mousemove', (e) => {
  if (state.phase === 'select' && state.isSelecting) {
    drawSelection(e.clientX, e.clientY);
  } else if (state.phase === 'annotate') {
    // 手柄 resize
    if (state.resizingHandle) {
      applyResize(e.clientX, e.clientY);
      return;
    }
    // 光标：悬停在手柄上时切换光标
    const handle = hitTestHandle(e.clientX, e.clientY);
    if (handle) {
      drawCanvas.style.cursor = handle.cursor;
    } else if (state.draggingTextIdx !== -1) {
      drawCanvas.style.cursor = 'move';
    } else {
      if (state.currentTool === 'text') {
        const hitIdx = hitTestTextAnnotation(e.clientX, e.clientY);
        drawCanvas.style.cursor = hitIdx !== -1 ? 'move' : 'crosshair';
      }
    }
    if (state.draggingTextIdx !== -1) {
      const ann = state.annotations[state.draggingTextIdx];
      ann.x = e.clientX - state.dragOffset.x;
      ann.y = e.clientY - state.dragOffset.y;
      redrawAnnotations();
    } else if (state.isDrawing) {
      handleAnnotationMove(e);
    }
  }
});

drawCanvas.addEventListener('mouseup', (e) => {
  if (state.phase === 'select' && state.isSelecting) {
    state.isSelecting = false;
    finalizeSelection(e.clientX, e.clientY);
  } else if (state.phase === 'annotate') {
    if (state.resizingHandle) {
      state.resizingHandle = null;
      state.resizeOrigin = null;
      state.resizeStart = null;
      positionToolbar();
      return;
    }
    if (state.draggingTextIdx !== -1) {
      state.draggingTextIdx = -1;
      drawCanvas.style.cursor = 'crosshair';
    } else if (state.isDrawing) {
      handleAnnotationEnd(e);
    }
  }
});

function drawSelection(mx, my) {
  const x = Math.min(state.selectStart.x, mx);
  const y = Math.min(state.selectStart.y, my);
  const w = Math.abs(mx - state.selectStart.x);
  const h = Math.abs(my - state.selectStart.y);
  const cw = state.canvasW;
  const ch = state.canvasH;

  drawCtx.clearRect(0, 0, cw, ch);

  // Redraw the full screenshot
  bgCtx.clearRect(0, 0, cw, ch);
  bgCtx.drawImage(state.screenshotImage, 0, 0, cw, ch);

  // Redraw dimming with cutout
  bgCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  bgCtx.fillRect(0, 0, cw, ch);
  bgCtx.clearRect(x, y, w, h);

  // FIX: scale source coordinates from CSS pixels to image pixels
  // The screenshot image is at native resolution (e.g. 2880x1800 on Retina),
  // but x,y,w,h are in CSS/logical pixels (e.g. 1440x900).
  // We must convert source coords to image pixel space.
  const sx = x * imgScaleX();
  const sy = y * imgScaleY();
  const sw = w * imgScaleX();
  const sh = h * imgScaleY();
  bgCtx.drawImage(state.screenshotImage, sx, sy, sw, sh, x, y, w, h);

  // Draw selection border
  drawCtx.strokeStyle = '#1976d2';
  drawCtx.lineWidth = 2;
  drawCtx.setLineDash([4, 4]);
  drawCtx.strokeRect(x, y, w, h);
  drawCtx.setLineDash([]);

  // Update selection info
  selectionInfo.classList.remove('hidden');
  selectionInfo.style.left = (x + w + 5) + 'px';
  selectionInfo.style.top = (y - 20) + 'px';
  selectionSize.textContent = `${w} × ${h}`;
}

// 编辑模式：接收已有图片，直接进入标注页面
api.onEditStart((data) => {
  _editMode = true;
  _editIndex = data.editIndex;
  const img = new Image();
  img.onload = () => {
    state.screenshotImage = img;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = state.dpr;
    state.canvasW = w;
    state.canvasH = h;

    // 初始化 canvas
    bgCanvas.width = w * dpr;  bgCanvas.height = h * dpr;
    bgCanvas.style.width = w + 'px';  bgCanvas.style.height = h + 'px';
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCanvas.width = w * dpr;  drawCanvas.height = h * dpr;
    drawCanvas.style.width = w + 'px';  drawCanvas.style.height = h + 'px';
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 编辑模式：填充深色背景
    bgCtx.fillStyle = '#1e1e2e';
    bgCtx.fillRect(0, 0, w, h);

    // 保持原始宽高比，居中绘制图片（留出底部工具栏空间）
    const padX = 20;
    const padTop = 16;
    const padBottom = 52; // 底部工具栏空间
    const availW = w - padX * 2;
    const availH = h - padTop - padBottom;
    const imgAspect = img.width / img.height;
    const availAspect = availW / availH;
    let drawW, drawH, drawX, drawY;
    if (imgAspect > availAspect) {
      drawW = availW;
      drawH = availW / imgAspect;
    } else {
      drawH = availH;
      drawW = availH * imgAspect;
    }
    drawX = (w - drawW) / 2;
    drawY = padTop + (availH - drawH) / 2;

    // 存储编辑模式下的图片绘制区域，用于正确导出
    state._editDrawRegion = { x: drawX, y: drawY, w: drawW, h: drawH };

    bgCtx.drawImage(img, 0, 0, img.width, img.height, drawX, drawY, drawW, drawH);
    drawCtx.clearRect(0, 0, w, h);

    state.annotations = [];
    state.selection = { x: drawX, y: drawY, w: drawW, h: drawH };
    state.phase = 'annotate';

    overlay.classList.remove('hidden');
    toolbar.classList.remove('hidden');

    // 隐藏编辑模式下不需要的按钮
    const modeTabs = document.getElementById('modeTabs');
    if (modeTabs) modeTabs.style.display = 'none';
    if (modeTabs && modeTabs.nextElementSibling && modeTabs.nextElementSibling.classList.contains('toolbar-divider')) {
      modeTabs.nextElementSibling.style.display = 'none';
    }

    // 工具栏固定到底部居中
    requestAnimationFrame(() => {
      toolbar.style.left = ((w - toolbar.offsetWidth) / 2) + 'px';
      toolbar.style.top = (h - 44) + 'px';
    });

    loadUsers();
    loadInspectionTasks();
    loadFunctionModules();
  };
  img.onerror = () => {
    console.error('[Edit] Failed to load image data');
    api.cancel();
  };
  img.src = data.dataUrl;
});

function finalizeSelection(mx, my) {
  const x = Math.min(state.selectStart.x, mx);
  const y = Math.min(state.selectStart.y, my);
  const w = Math.abs(mx - state.selectStart.x);
  const h = Math.abs(my - state.selectStart.y);

  if (w < 10 || h < 10) {
    // Selection too small, reset
    bgCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    bgCtx.drawImage(state.screenshotImage, 0, 0, state.canvasW, state.canvasH);
    bgCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    bgCtx.fillRect(0, 0, state.canvasW, state.canvasH);
    drawCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    selectionInfo.classList.add('hidden');
    return;
  }

  state.selection = { x, y, w, h };
  state.phase = 'annotate';
  drawCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  selectionInfo.classList.add('hidden');

  // Show toolbar FIRST (so offsetWidth is measurable), then position it
  toolbar.classList.remove('hidden');
  positionToolbar();
  redrawAnnotations(); // 绘制选框边框与手柄

  // Load users for bug form
  loadUsers();
  loadInspectionTasks();
  loadFunctionModules();
}

function positionToolbar() {
  const { x, y, w, h } = state.selection;
  const toolbarW = toolbar.offsetWidth;
  const toolbarH = 40; // approximate toolbar height

  // Default: place toolbar centered below the selection
  let toolbarX = x + (w - toolbarW) / 2;
  let toolbarY = y + h + 8;

  // If toolbar goes below screen, place it above selection
  if (toolbarY + toolbarH > window.innerHeight) {
    toolbarY = y - toolbarH - 8;
  }

  // Clamp horizontal position to keep toolbar fully on screen
  if (toolbarX < 8) toolbarX = 8;
  if (toolbarX + toolbarW > window.innerWidth - 8) {
    toolbarX = window.innerWidth - toolbarW - 8;
  }

  toolbar.style.left = toolbarX + 'px';
  toolbar.style.top = toolbarY + 'px';
}

// ============ Selection Resize Handles ============

const HANDLE_R = 5; // 手柄半径（CSS 像素）

// 8 个手柄定义，每个含 id 和光标样式
function getHandles() {
  const { x, y, w, h } = state.selection;
  const cx = x + w / 2, cy = y + h / 2;
  return [
    { id: 'nw', px: x,      py: y,      cursor: 'nwse-resize' },
    { id: 'n',  px: cx,     py: y,      cursor: 'ns-resize'   },
    { id: 'ne', px: x + w,  py: y,      cursor: 'nesw-resize' },
    { id: 'e',  px: x + w,  py: cy,     cursor: 'ew-resize'   },
    { id: 'se', px: x + w,  py: y + h,  cursor: 'nwse-resize' },
    { id: 's',  px: cx,     py: y + h,  cursor: 'ns-resize'   },
    { id: 'sw', px: x,      py: y + h,  cursor: 'nesw-resize' },
    { id: 'w',  px: x,      py: cy,     cursor: 'ew-resize'   },
  ];
}

function hitTestHandle(mx, my) {
  if (state.phase !== 'annotate') return null;
  for (const h of getHandles()) {
    if (Math.abs(mx - h.px) <= HANDLE_R + 3 && Math.abs(my - h.py) <= HANDLE_R + 3) return h;
  }
  return null;
}

function drawHandles() {
  for (const h of getHandles()) {
    drawCtx.save();
    drawCtx.beginPath();
    drawCtx.arc(h.px, h.py, HANDLE_R, 0, Math.PI * 2);
    drawCtx.fillStyle = '#fff';
    drawCtx.shadowColor = 'rgba(0,0,0,0.4)';
    drawCtx.shadowBlur = 4;
    drawCtx.fill();
    drawCtx.shadowBlur = 0;
    drawCtx.strokeStyle = '#1976d2';
    drawCtx.lineWidth = 1.5;
    drawCtx.stroke();
    drawCtx.restore();
  }
}

function redrawSelectionBackground() {
  const { x, y, w, h } = state.selection;
  const cw = state.canvasW, ch = state.canvasH;
  bgCtx.clearRect(0, 0, cw, ch);
  bgCtx.drawImage(state.screenshotImage, 0, 0, cw, ch);
  bgCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  bgCtx.fillRect(0, 0, cw, ch);
  bgCtx.clearRect(x, y, w, h);
  const sx = x * imgScaleX(), sy = y * imgScaleY(),
        sw = w * imgScaleX(), sh = h * imgScaleY();
  bgCtx.drawImage(state.screenshotImage, sx, sy, sw, sh, x, y, w, h);
}

function applyResize(mx, my) {
  const o = state.resizeOrigin;
  const dx = mx - state.resizeStart.x;
  const dy = my - state.resizeStart.y;
  const id = state.resizingHandle;
  const MIN = 20;

  let { x, y, w, h } = o;
  if (id.includes('e')) { w = Math.max(MIN, o.w + dx); }
  if (id.includes('s')) { h = Math.max(MIN, o.h + dy); }
  if (id.includes('w')) { const nw = Math.max(MIN, o.w - dx); x = o.x + (o.w - nw); w = nw; }
  if (id.includes('n')) { const nh = Math.max(MIN, o.h - dy); y = o.y + (o.h - nh); h = nh; }

  state.selection = { x, y, w, h };
  redrawSelectionBackground();
  redrawAnnotations();
}

// ============ Annotation Tools ============

// 检测点击是否命中某个文字标注，返回该标注的索引，未命中返回 -1
function hitTestTextAnnotation(mx, my) {
  for (let i = state.annotations.length - 1; i >= 0; i--) {
    const ann = state.annotations[i];
    if (ann.type !== 'text') continue;
    const fontSize = ann.fontSize || Math.max(14, ann.lineWidth * 5);
    const textWidth = ann.text.length * fontSize * 0.6;
    const textHeight = fontSize;
    // 命中区域：文字包围盒 + 8px padding
    if (
      mx >= ann.x - 8 && mx <= ann.x + textWidth + 8 &&
      my >= ann.y - textHeight - 4 && my <= ann.y + 8
    ) {
      return i;
    }
  }
  return -1;
}

function handleAnnotationStart(e) {
  const { x: selX, y: selY, w: selW, h: selH } = state.selection;
  const mx = e.clientX;
  const my = e.clientY;

  // Only allow drawing inside selection
  if (mx < selX || mx > selX + selW || my < selY || my > selY + selH) return;

  if (state.currentTool === 'text') {
    // 如果文字输入框正在显示，点击其他地方 = 同步确认当前输入，不创建新输入框
    if (state._confirmTextInput) {
      state._confirmTextInput();
      return;
    }
    // 先检测是否命中已有文字，命中则选中并拖拽
    const hitIdx = hitTestTextAnnotation(mx, my);
    if (hitIdx !== -1) {
      // 选中该文字
      state.selectedTextIdx = hitIdx;
      updateTextEditButtons();
      state.draggingTextIdx = hitIdx;
      state.dragOffset = {
        x: mx - state.annotations[hitIdx].x,
        y: my - state.annotations[hitIdx].y,
      };
      state.isDrawing = false;
      drawCanvas.style.cursor = 'move';
      redrawAnnotations();
      return;
    }
    // 未命中：取消选中，新建文字输入
    state.selectedTextIdx = -1;
    updateTextEditButtons();
    redrawAnnotations();
    showTextInput(mx, my);
    state.isDrawing = false;
    return;
  }

  state.isDrawing = true;
  state.drawStart = { x: mx, y: my };

  if (state.currentTool === 'pen') {
    state.currentPath = [{ x: mx, y: my }];
  }
}

function handleAnnotationMove(e) {
  const mx = e.clientX;
  const my = e.clientY;

  if (state.currentTool === 'pen') {
    state.currentPath.push({ x: mx, y: my });
    redrawAnnotations();
    drawPenPreview();
  } else if (state.currentTool === 'rect') {
    redrawAnnotations();
    drawRectPreview(mx, my);
  } else if (state.currentTool === 'arrow') {
    redrawAnnotations();
    drawArrowPreview(mx, my);
  }
}

function handleAnnotationEnd(e) {
  const mx = e.clientX;
  const my = e.clientY;
  state.isDrawing = false;

  if (state.currentTool === 'rect') {
    state.annotations.push({
      type: 'rect',
      x1: state.drawStart.x, y1: state.drawStart.y,
      x2: mx, y2: my,
      color: state.drawColor,
      lineWidth: state.lineWidth,
    });
  } else if (state.currentTool === 'arrow') {
    state.annotations.push({
      type: 'arrow',
      x1: state.drawStart.x, y1: state.drawStart.y,
      x2: mx, y2: my,
      color: state.drawColor,
      lineWidth: state.lineWidth,
    });
  } else if (state.currentTool === 'pen') {
    if (state.currentPath.length > 1) {
      state.annotations.push({
        type: 'pen',
        points: [...state.currentPath],
        color: state.drawColor,
        lineWidth: state.lineWidth,
      });
    }
    state.currentPath = [];
  }

  redrawAnnotations();
}

function redrawAnnotations() {
  drawCtx.clearRect(0, 0, state.canvasW, state.canvasH);

  // 编辑模式不画选区边框和拖拽把手，但画图片区域边框
  if (!_editMode) {
    const { x, y, w, h } = state.selection;
    drawCtx.strokeStyle = '#1976d2';
    drawCtx.lineWidth = 1.5;
    drawCtx.setLineDash([4, 4]);
    drawCtx.strokeRect(x, y, w, h);
    drawCtx.setLineDash([]);
    drawHandles();
  } else if (state._editDrawRegion) {
    // 编辑模式：画一个细边框标识图片区域
    const { x, y, w, h } = state._editDrawRegion;
    drawCtx.strokeStyle = 'rgba(137, 180, 250, 0.6)';
    drawCtx.lineWidth = 2;
    drawCtx.setLineDash([]);
    drawCtx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  }

  // Redraw all annotations，选中文字高亮显示
  for (let i = 0; i < state.annotations.length; i++) {
    const ann = state.annotations[i];
    const isSelected = (i === state.selectedTextIdx);
    const showBox = state.currentTool === 'text';
    drawAnnotation(drawCtx, ann, showBox, isSelected);
  }
}

function drawAnnotation(ctx, ann, showBox, isSelected) {
  // 复用共享标注模块；文字框在 text 工具激活或被选中时显示
  const show = showBox !== undefined ? showBox : (state.currentTool === 'text');
  window.AnnotateLib.drawAnnotation(ctx, ann, show, isSelected);
}

function drawRectPreview(mx, my) {
  const rx = Math.min(state.drawStart.x, mx);
  const ry = Math.min(state.drawStart.y, my);
  const rw = Math.abs(mx - state.drawStart.x);
  const rh = Math.abs(my - state.drawStart.y);

  drawCtx.save();
  drawCtx.strokeStyle = state.drawColor;
  drawCtx.lineWidth = state.lineWidth;
  drawCtx.strokeRect(rx, ry, rw, rh);
  drawCtx.restore();
}

function drawArrowPreview(mx, my) {
  drawCtx.save();
  drawCtx.strokeStyle = state.drawColor;
  drawCtx.fillStyle = state.drawColor;
  drawCtx.lineWidth = state.lineWidth;
  drawArrow(drawCtx, state.drawStart.x, state.drawStart.y, mx, my, state.lineWidth);
  drawCtx.restore();
}

function drawPenPreview() {
  if (state.currentPath.length < 2) return;
  drawCtx.save();
  drawCtx.strokeStyle = state.drawColor;
  drawCtx.lineWidth = state.lineWidth;
  drawPenPath(drawCtx, state.currentPath, state.lineWidth);
  drawCtx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, lineWidth) {
  window.AnnotateLib.drawArrow(ctx, x1, y1, x2, y2, lineWidth);
}

function drawPenPath(ctx, points, lineWidth) {
  window.AnnotateLib.drawPenPath(ctx, points, lineWidth);
}

// ============ Text Annotation ============
function showTextInput(x, y, editIdx) {
  // editIdx >= 0 表示编辑已有文字
  const isEdit = (editIdx !== undefined && editIdx >= 0 && editIdx < state.annotations.length);
  const existingAnn = isEdit ? state.annotations[editIdx] : null;

  textInput.classList.remove('hidden');
  textInput.style.left = x + 'px';
  textInput.style.top = y + 'px';
  textInput.value = isEdit ? existingAnn.text : '';
  // 使用当前子栏字号设置输入框字体大小
  textInput.style.fontSize = state.textFontSize + 'px';
  textInput.style.color = state.textColor;

  // 降低窗口层级让输入法候选框能显示
  api.setWindowLevel('normal');

  // 延迟 focus 避免 mouseup 事件立即触发 blur
  requestAnimationFrame(() => {
    textInput.focus();
    if (isEdit) textInput.select();
  });

  let confirmed = false;

  const handleConfirm = () => {
    if (confirmed) return;
    confirmed = true;
    const text = textInput.value.trim();
    if (text) {
      if (isEdit) {
        // 编辑模式：更新已有文字
        existingAnn.text = text;
        existingAnn.color = state.textColor;
        existingAnn.fontSize = state.textFontSize;
      } else {
        // 新建文字
        state.annotations.push({
          type: 'text',
          x: x,
          y: y + 18,
          text: text,
          color: state.textColor,
          lineWidth: state.lineWidth,
          fontSize: state.textFontSize,
        });
      }
      redrawAnnotations();
    }
    textInput.classList.add('hidden');
    textInput.removeEventListener('keydown', handleKeyDown);
    textInput.removeEventListener('blur', handleBlur);
    // 恢复窗口层级
    api.setWindowLevel('screen-saver');
    // 清除全局确认引用
    state._confirmTextInput = null;
  };

  // 保存到全局，以便点击画布其他位置时同步触发确认
  state._confirmTextInput = handleConfirm;

  // blur 时同步确认（不再延迟，不再需要冷却标志）
  const handleBlur = () => {
    handleConfirm();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      confirmed = true;
      textInput.classList.add('hidden');
      textInput.removeEventListener('keydown', handleKeyDown);
      textInput.removeEventListener('blur', handleBlur);
      api.setWindowLevel('screen-saver');
      state._confirmTextInput = null;
    }
  };

  textInput.addEventListener('keydown', handleKeyDown);
  textInput.addEventListener('blur', handleBlur);
}

// ============ Export Annotated Image ============
function exportAnnotatedImage() {
  const { x, y, w, h } = state.selection;

  if (_editMode && state._editDrawRegion) {
    // 编辑模式：图片居中绘制，使用不同的坐标映射
    const region = state._editDrawRegion;
    const editScaleX = state.screenshotImage.width / region.w;
    const editScaleY = state.screenshotImage.height / region.h;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = state.screenshotImage.width;
    exportCanvas.height = state.screenshotImage.height;
    const ctx = exportCanvas.getContext('2d');

    // 绘制完整原始图片
    ctx.drawImage(state.screenshotImage, 0, 0);

    // 绘制标注（从画布坐标转换到图片坐标）
    ctx.save();
    ctx.scale(editScaleX, editScaleY);
    ctx.translate(-region.x, -region.y);
    for (const ann of state.annotations) {
      drawAnnotation(ctx, ann, false);
    }
    ctx.restore();

    return exportCanvas.toDataURL('image/png');
  }

  // 正常截图模式
  const scaleX = imgScaleX();
  const scaleY = imgScaleY();

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = w * scaleX;
  exportCanvas.height = h * scaleY;
  const ctx = exportCanvas.getContext('2d');

  // Draw original screenshot (cropped, at original resolution)
  ctx.drawImage(
    state.screenshotImage,
    x * scaleX, y * scaleY, w * scaleX, h * scaleY,
    0, 0, w * scaleX, h * scaleY
  );

  // Draw annotations scaled
  ctx.save();
  ctx.scale(scaleX, scaleY);
  ctx.translate(-x, -y);
  for (const ann of state.annotations) {
    drawAnnotation(ctx, ann, false);
  }
  ctx.restore();

  return exportCanvas.toDataURL('image/png');
}

// ============ Toast ============
let _toastTimer = null;
function showToast(msg, duration = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.classList.add('hidden'); }, duration);
}

// ============ Toolbar Event Handlers ============
// Prevent toolbar mousedown/mouseup from bubbling into canvas handlers
document.getElementById('toolbar').addEventListener('mousedown', (e) => e.stopPropagation());
document.getElementById('toolbar').addEventListener('mouseup', (e) => e.stopPropagation());

document.getElementById('btnRect').addEventListener('click', () => setTool('rect'));
document.getElementById('btnArrow').addEventListener('click', () => setTool('arrow'));
document.getElementById('btnPen').addEventListener('click', () => setTool('pen'));
document.getElementById('btnText').addEventListener('click', () => setTool('text'));
document.getElementById('btnOCR').addEventListener('click', () => setTool('ocr'));
document.getElementById('colorPicker').addEventListener('input', (e) => {
  state.drawColor = e.target.value;
});
document.getElementById('lineWidth').addEventListener('change', (e) => {
  state.lineWidth = parseInt(e.target.value);
});
document.getElementById('btnUndo').addEventListener('click', undoAnnotation);
document.getElementById('btnClear').addEventListener('click', clearAnnotations);

// 文字子栏：字号选择
document.querySelectorAll('.text-size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.text-size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.textFontSize = parseInt(btn.dataset.size);
    // 如果选中了文字，同步更新其字号
    if (state.selectedTextIdx >= 0 && state.selectedTextIdx < state.annotations.length) {
      const ann = state.annotations[state.selectedTextIdx];
      if (ann.type === 'text') {
        ann.fontSize = state.textFontSize;
        redrawAnnotations();
      }
    }
  });
});

// 文字子栏：颜色选择
if (textColorPicker) {
  textColorPicker.addEventListener('input', (e) => {
    state.textColor = e.target.value;
    // 如果选中了文字，同步更新其颜色
    if (state.selectedTextIdx >= 0 && state.selectedTextIdx < state.annotations.length) {
      const ann = state.annotations[state.selectedTextIdx];
      if (ann.type === 'text') {
        ann.color = state.textColor;
        redrawAnnotations();
      }
    }
  });
}

// 文字子栏：编辑/删除按钮
if (btnTextEdit) {
  btnTextEdit.addEventListener('click', editSelectedText);
}
if (btnTextDelete) {
  btnTextDelete.addEventListener('click', deleteSelectedText);
}

// 双击文字进入编辑模式
drawCanvas.addEventListener('dblclick', (e) => {
  if (state.phase !== 'annotate' || state.currentTool !== 'text') return;
  const hitIdx = hitTestTextAnnotation(e.clientX, e.clientY);
  if (hitIdx !== -1) {
    state.selectedTextIdx = hitIdx;
    updateTextEditButtons();
    redrawAnnotations();
    editSelectedText();
  }
});

// 键盘删除：选中文字后按 Delete/Backspace 删除
document.addEventListener('keydown', (e) => {
  if (state.phase !== 'annotate' || state.currentTool !== 'text') return;
  if (state.selectedTextIdx < 0) return;
  // 文本输入框激活时不拦截
  if (document.activeElement === textInput) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelectedText();
  }
});
document.getElementById('btnCopy').addEventListener('click', copyToClipboard);
document.getElementById('btnDownload').addEventListener('click', saveToDesktop);
document.getElementById('btnMultiShot').addEventListener('click', addToMultiShot);

// 标记：由「提BUG」流程触发的多图添加，不显示「已加入多图」toast
let _suppressMultiShotToast = false;

// 提BUG按钮：一键快速手动提交到 DMP
async function quickManualSubmit() {
  const dataUrl = exportAnnotatedImage();
  const textAnnotations = state.annotations.filter(a => a.type === 'text');
  const hasText = textAnnotations.length > 0;
  const textContent = textAnnotations.map(a => a.text).join('\n');

  // 生成标题和描述：有文字标注时优先使用，否则自动生成标题
  let title;
  let description = '';
  if (textAnnotations.length > 0) {
    title = textAnnotations[0].text.trim();
    if (textAnnotations.length > 1) {
      description = textContent;
    }
  } else {
    const now = new Date();
    title = `DMP缺陷 - ${now.toLocaleString('zh-CN', { hour12: false })}`;
  }

  // 1. 检查 DMP 连接
  const testResult = await api.testDmpConnection();
  if (!testResult.success) {
    // 未连接：保存到浮窗、打开 DMP、提示用户
    _suppressMultiShotToast = true;
    api.addToMultiShot({ dataUrl, hasText, textContent });
    showToast('请登录 DMP 并打开缺陷列表后再提BUG');
    await api.launchDmpBrowser();
    api.cancel();
    return;
  }

  // 2. 已连接但不在缺陷列表页
  if (!testResult.isInDefectList) {
    _suppressMultiShotToast = true;
    api.addToMultiShot({ dataUrl, hasText, textContent });
    showToast('请登录 DMP 并打开缺陷列表后再提BUG');
    await api.launchDmpBrowser();
    api.cancel();
    return;
  }

  // 3. 已连接且在缺陷列表页：fire-and-forget 提交，立即退出截图
  // 不等待提交结果，进度提示由主进程通过浮窗 toast 展示
  api.submitBug({
    title,
    description,
    imageDataUrl: dataUrl,
    mode: 'manual',
    dmpForm: {
      project_name: '',
      module_path: '',
      defect_type: '功能缺陷',
      discovery_stage: 'dev测试',
      priority: '中',
      source: '测试',
      test_env: '',
      story_value: '',
      handler_id: '',
      note_extra: '',
    }
  }).catch(() => {});
  // 立即退出截图模式，提交进度由浮窗 toast 显示
  api.cancel();
}

document.getElementById('btnBug').addEventListener('click', quickManualSubmit);
document.getElementById('btnConfirm').addEventListener('click', confirmAndContinue);

// ============ 截图/录屏 模式页签 ============
const tabShot = document.getElementById('tabShot');
const tabRecord = document.getElementById('tabRecord');
const shotTools = document.getElementById('shotTools');
const recordTools = document.getElementById('recordTools');

if (tabShot && tabRecord) {
  tabShot.addEventListener('click', () => switchMode('shot'));
  tabRecord.addEventListener('click', () => switchMode('record'));
}

function switchMode(mode) {
  const btnConfirm = document.getElementById('btnConfirm');
  if (mode === 'record') {
    tabRecord.classList.add('active');
    tabShot.classList.remove('active');
    shotTools.classList.add('hidden');
    recordTools.classList.remove('hidden');
    if (btnConfirm) btnConfirm.classList.add('hidden');
  } else {
    tabShot.classList.add('active');
    tabRecord.classList.remove('active');
    recordTools.classList.add('hidden');
    shotTools.classList.remove('hidden');
    if (btnConfirm) btnConfirm.classList.remove('hidden');
  }
}

// 开始录制：把框选区域交给主进程，由主进程关闭截图窗并打开录制控制窗
document.getElementById('btnRecStart').addEventListener('click', () => {
  const region = window.getCaptureRegion ? window.getCaptureRegion() : null;
  if (!region) { showToast('请先框选录制区域'); return; }
  window.recordAPI.startRegionRecording(region);
});
document.getElementById('btnCancel').addEventListener('click', cancelScreenshot);

function setTool(tool) {
  state.currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btnMap = { rect: 'btnRect', arrow: 'btnArrow', pen: 'btnPen', text: 'btnText', ocr: 'btnOCR' };
  document.getElementById(btnMap[tool])?.classList.add('active');

  // 文字工具激活时显示子栏并定位到 T 按钮下方，否则隐藏并取消选中
  if (tool === 'text') {
    // 动态定位：获取 T 按钮位置，子栏居中在其下方
    const btnTextEl = document.getElementById('btnText');
    if (btnTextEl) {
      const rect = btnTextEl.getBoundingClientRect();
      textSubToolbar.style.left = (rect.left + rect.width / 2) + 'px';
      textSubToolbar.style.top = (rect.bottom + 6) + 'px';
    }
    textSubToolbar.classList.remove('hidden');
  } else {
    textSubToolbar.classList.add('hidden');
    state.selectedTextIdx = -1;
    updateTextEditButtons();
    redrawAnnotations();
  }

  // OCR 模式：显示文字层供选中；其他工具：隐藏文字层
  if (tool === 'ocr') {
    state.ocrMode = true;
    if (ocrTextLayer.children.length > 0) {
      // 已有识别结果，直接显示
      ocrTextLayer.classList.remove('hidden');
      ocrTextLayer.classList.add('active');
    } else {
      // 首次进入 OCR 模式：触发识别
      runOcr();
    }
  } else {
    state.ocrMode = false;
    ocrTextLayer.classList.remove('active');
    ocrTextLayer.classList.add('hidden');
  }
}

// ============ OCR 文字识别 ============
async function runOcr() {
  if (!state.screenshotImage || state.selection.w <= 0) return;

  showToast('正在识别文字...', 60000);

  try {
    // 从选区裁取原始截图（不含标注）传给 OCR
    const { x, y, w, h } = state.selection;
    const sx = x * imgScaleX(), sy = y * imgScaleY();
    const sw = w * imgScaleX(), sh = h * imgScaleY();

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = Math.round(sw);
    tmpCanvas.height = Math.round(sh);
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(state.screenshotImage, sx, sy, sw, sh, 0, 0, sw, sh);
    const dataUrl = tmpCanvas.toDataURL('image/png');

    const result = await api.ocrRecognize(dataUrl);
    if (!result.success || !result.words || result.words.length === 0) {
      showToast('未识别到文字');
      return;
    }

    // 定位文字层到选区区域
    ocrTextLayer.style.left = x + 'px';
    ocrTextLayer.style.top = y + 'px';
    ocrTextLayer.style.width = w + 'px';
    ocrTextLayer.style.height = h + 'px';
    ocrTextLayer.innerHTML = '';

    const scaleX = imgScaleX();
    const scaleY = imgScaleY();

    // 逐词渲染透明文字，按 bbox 坐标定位（相对于选区左上角）
    for (const word of result.words) {
      const div = document.createElement('div');
      div.className = 'ocr-word';
      div.textContent = word.text;
      const cssX = word.bbox.x0 / scaleX;
      const cssY = word.bbox.y0 / scaleY;
      const cssW = (word.bbox.x1 - word.bbox.x0) / scaleX;
      const cssH = (word.bbox.y1 - word.bbox.y0) / scaleY;
      div.style.left = cssX + 'px';
      div.style.top = cssY + 'px';
      div.style.width = cssW + 'px';
      div.style.fontSize = Math.max(10, cssH * 0.8) + 'px';
      ocrTextLayer.appendChild(div);
    }

    ocrTextLayer.classList.remove('hidden');
    ocrTextLayer.classList.add('active');
    showToast('识别完成，可直接选中文字复制');
  } catch (err) {
    console.error('[OCR] 识别失败:', err);
    showToast('文字识别失败');
  }
}

// 更新编辑/删除按钮状态
function updateTextEditButtons() {
  const hasSelection = state.selectedTextIdx >= 0 && state.selectedTextIdx < state.annotations.length;
  if (btnTextEdit) btnTextEdit.disabled = !hasSelection;
  if (btnTextDelete) btnTextDelete.disabled = !hasSelection;
}

// 编辑选中文字
function editSelectedText() {
  if (state.selectedTextIdx < 0) return;
  const ann = state.annotations[state.selectedTextIdx];
  if (!ann || ann.type !== 'text') return;
  // 用文字原始位置弹出编辑框
  showTextInput(ann.x, ann.y - 18, state.selectedTextIdx);
}

// 删除选中文字
function deleteSelectedText() {
  if (state.selectedTextIdx < 0) return;
  state.annotations.splice(state.selectedTextIdx, 1);
  state.selectedTextIdx = -1;
  updateTextEditButtons();
  redrawAnnotations();
}

function undoAnnotation() {
  if (state.annotations.length > 0) {
    state.annotations.pop();
    state.selectedTextIdx = -1;
    updateTextEditButtons();
    redrawAnnotations();
  }
}

function clearAnnotations() {
  state.annotations = [];
  state.selectedTextIdx = -1;
  updateTextEditButtons();
  redrawAnnotations();
}

async function copyToClipboard() {
  const dataUrl = exportAnnotatedImage();
  await api.copyToClipboard(dataUrl);
}

async function saveToDesktop() {
  const dataUrl = exportAnnotatedImage();
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  await api.saveToDesktop(dataUrl, `screenshot_${ts}.png`);
  // Main process will close the window and show system notification
}

// 多图：将当前带标注的截图加入暂存小窗
async function addToMultiShot() {
  try {
    const { count, max } = await api.getMultiShotCount();
    if (count >= max) {
      showToast(`最多支持 ${max} 张`);
      return;
    }
  } catch {
    // 查询失败时仍尝试添加，由主进程兆底拦截
  }
  const dataUrl = exportAnnotatedImage();
  const textAnnotations = state.annotations.filter(a => a.type === 'text');
  const hasText = textAnnotations.length > 0;
  const textContent = textAnnotations.map(a => a.text).join('\n');
  api.addToMultiShot({ dataUrl, hasText, textContent });
}

// 完成按钮：加入多图浮窗（主进程负责复制剪贴板 + 系统通知）+ 关闭截图窗口
async function confirmAndContinue() {
  const dataUrl = exportAnnotatedImage();
  const textAnnotations = state.annotations.filter(a => a.type === 'text');
  const hasText = textAnnotations.length > 0;
  const textContent = textAnnotations.map(a => a.text).join('\n');

  if (_editMode && _editIndex >= 0) {
    // 编辑模式：替换原图
    api.replaceInMultiShot({ index: _editIndex, dataUrl, hasText, textContent });
    _editMode = false;
    _editIndex = -1;
  } else {
    // 正常模式：添加到多图
    api.addToMultiShot({ dataUrl, hasText, textContent });
  }
  api.cancel();
}

function cancelScreenshot() {
  api.cancel();
}

// 多图添加成功回调：显示提示
api.onMultiShotAccepted((data) => {
  if (_suppressMultiShotToast) {
    _suppressMultiShotToast = false;
    return;
  }
  showToast(`已加入多图 (${data.count}/${data.max})`);
});

// 多图添加被拒绝回调
api.onMultiShotRejected((reason) => {
  if (reason === 'limit') showToast('多图已达上限');
});

// ============ Bug Form ============
const FALLBACK_USERS = [
  { id: 1, display_name: '张三', role: 'tester' },
  { id: 2, display_name: '李四', role: 'developer' },
  { id: 3, display_name: '王五', role: 'developer' },
  { id: 4, display_name: '赵六', role: 'tester' },
];

async function loadUsers() {
  // DMP 模式不再需要本地用户列表
  state.users = [];
}

function populateUserSelects() {
  // 已废弃：不再使用本地用户选择器
}

async function loadInspectionTasks() {
  // DMP 模式不再需要本地走查项目
  state.inspectionTasks = [];
}

async function loadFunctionModules() {
  // DMP 模式不再需要本地功能模块
  state.modules = [];
}

function populateInspectionTaskSelect() {
  // 已废弃
}

function populateModuleSelect() {
  // 已废弃
}

// BUG 弹窗内标注状态
const bugFormState = {
  annotations: [],
  currentTool: 'rect',
  drawColor: '#ff0000',
  lineWidth: 3,
  isDrawing: false,
  drawStart: { x: 0, y: 0 },
  currentPath: [],
};

let bugFormBaseImage = null;

function getBugFormCanvasPos(e) {
  const rect = bugFormCanvas.getBoundingClientRect();
  const scaleX = bugFormCanvas.width / rect.width;
  const scaleY = bugFormCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function showBugForm() {
  // Hide screenshot canvas — user should feel they've exited screenshot mode
  overlay.classList.add('hidden');
  toolbar.classList.add('hidden');
  // 退出截图模式的光标
  document.body.style.cursor = 'default';

  // 导出当前带标注的截图作为弹窗内 canvas 的底图
  const dataUrl = exportAnnotatedImage();
  bugFormBaseImage = new Image();
  bugFormBaseImage.onload = () => {
    bugFormCanvas.width = bugFormBaseImage.width;
    bugFormCanvas.height = bugFormBaseImage.height;
    bugFormCtx.drawImage(bugFormBaseImage, 0, 0);
  };
  bugFormBaseImage.src = dataUrl;

  // 重置弹窗内标注状态
  bugFormState.annotations = [];
  bugFormState.currentTool = 'rect';
  bugFormState.drawColor = state.drawColor;
  bugFormState.lineWidth = state.lineWidth;
  updateBugFormToolbarUI();

  // Set default title with timestamp
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { hour12: false });
  document.getElementById('bugTitle').value = `DMP缺陷 - ${timeStr}`;
  document.getElementById('bugDescription').value = '';
  document.getElementById('submitStatus').classList.add('hidden');

  // 重置 DMP 连接检查面板
  resetDmpConnectionPanel();

  // 加载上次保存的 DMP 默认值
  loadDmpFormDefaults();
  // 根据默认缺陷类型更新「关联故事」必填状态
  updateStoryRequired();

  bugFormOverlay.classList.remove('hidden');
  bugFormOverlay.classList.add('form-mode');
  // 打开录入弹窗时，通知主进程将安全超时延长到 10 分钟，防止填写途中窗口被关闭
  api.extendTimeout();
  // 降低窗口层级，让输入法候选框能正常显示
  api.setWindowLevel('normal');
  // 转换为普通可拖动窗口
  api.enterFormMode();
}

// DMP 连接检查
let dmpConnected = false;

function resetDmpConnectionPanel() {
  dmpConnected = false;
  document.getElementById('dmpConnectIcon').textContent = '🔴';
  document.getElementById('dmpConnectText').textContent = '未连接 DMP';
  document.getElementById('dmpFormContent').classList.add('hidden');
  document.getElementById('btnBugSubmit').disabled = true;
  document.getElementById('dmpConnectMsg').classList.add('hidden');
}

function setDmpConnected(connected, message) {
  dmpConnected = connected;
  const icon = document.getElementById('dmpConnectIcon');
  const text = document.getElementById('dmpConnectText');
  const formContent = document.getElementById('dmpFormContent');
  const submitBtn = document.getElementById('btnBugSubmit');
  const msgEl = document.getElementById('dmpConnectMsg');

  if (connected) {
    icon.textContent = '🟢';
    text.textContent = 'DMP 连接正常';
    formContent.classList.remove('hidden');
    submitBtn.disabled = false;
    msgEl.textContent = message || '连接成功，请填写下方缺陷信息';
    msgEl.className = 'submit-status success';
  } else {
    icon.textContent = '🔴';
    text.textContent = '未连接 DMP';
    formContent.classList.add('hidden');
    submitBtn.disabled = true;
    msgEl.textContent = message || '连接失败';
    msgEl.className = 'submit-status error';
  }
  msgEl.classList.remove('hidden');
}

document.getElementById('btnDmpLaunch').addEventListener('click', async () => {
  const btn = document.getElementById('btnDmpLaunch');
  btn.disabled = true;
  btn.textContent = '正在打开...';
  try {
    const result = await api.launchDmpBrowser();
    if (!result.success) {
      alert(result.message || '打开 DMP 失败');
      return;
    }
    // 打开浏览器后，退出截图蒙层状态，避免遮挡浏览器窗口
    overlay.classList.add('hidden');
    toolbar.classList.add('hidden');
    document.body.style.cursor = 'default';
    api.setWindowLevel('normal');
  } catch (e) {
    console.error('打开 DMP 失败', e);
    alert('打开 DMP 失败：' + (e.message || '未知错误'));
  } finally {
    btn.disabled = false;
    btn.textContent = '打开 DMP 并登录';
  }
});

document.getElementById('btnDmpTest').addEventListener('click', async () => {
  const btn = document.getElementById('btnDmpTest');
  btn.disabled = true;
  btn.textContent = '测试中...';
  try {
    const result = await api.testDmpConnection();
    setDmpConnected(result.success, result.message);
  } catch (e) {
    console.error('链接测试失败', e);
    setDmpConnected(false, '链接测试失败：' + (e.message || '未知错误'));
  } finally {
    btn.disabled = false;
    btn.textContent = '链接测试';
  }
});

function updateBugFormToolbarUI() {
  document.querySelectorAll('.bug-form-preview-toolbar .tool-btn').forEach(b => b.classList.remove('active'));
  const btnMap = { rect: 'btnBugRect', arrow: 'btnBugArrow', pen: 'btnBugPen', text: 'btnBugText' };
  document.getElementById(btnMap[bugFormState.currentTool])?.classList.add('active');
  document.getElementById('bugColorPicker').value = bugFormState.drawColor;
  document.getElementById('bugLineWidth').value = String(bugFormState.lineWidth);
}

function setBugFormTool(tool) {
  bugFormState.currentTool = tool;
  updateBugFormToolbarUI();
}

// ============ Bug Form Canvas Annotation ============
bugFormCanvas.addEventListener('mousedown', (e) => {
  if (bugFormState.currentTool === 'text') {
    const pos = getBugFormCanvasPos(e);
    showBugFormTextInput(pos.x, pos.y);
    return;
  }
  bugFormState.isDrawing = true;
  const pos = getBugFormCanvasPos(e);
  bugFormState.drawStart = pos;
  if (bugFormState.currentTool === 'pen') {
    bugFormState.currentPath = [pos];
  }
});

bugFormCanvas.addEventListener('mousemove', (e) => {
  if (!bugFormState.isDrawing) return;
  const pos = getBugFormCanvasPos(e);
  redrawBugFormAnnotations();
  if (bugFormState.currentTool === 'pen') {
    bugFormState.currentPath.push(pos);
    drawBugFormPenPreview();
  } else if (bugFormState.currentTool === 'rect') {
    drawBugFormRectPreview(pos.x, pos.y);
  } else if (bugFormState.currentTool === 'arrow') {
    drawBugFormArrowPreview(pos.x, pos.y);
  }
});

bugFormCanvas.addEventListener('mouseup', (e) => {
  if (!bugFormState.isDrawing) return;
  bugFormState.isDrawing = false;
  const pos = getBugFormCanvasPos(e);

  if (bugFormState.currentTool === 'rect') {
    bugFormState.annotations.push({
      type: 'rect',
      x1: bugFormState.drawStart.x, y1: bugFormState.drawStart.y,
      x2: pos.x, y2: pos.y,
      color: bugFormState.drawColor,
      lineWidth: bugFormState.lineWidth,
    });
  } else if (bugFormState.currentTool === 'arrow') {
    bugFormState.annotations.push({
      type: 'arrow',
      x1: bugFormState.drawStart.x, y1: bugFormState.drawStart.y,
      x2: pos.x, y2: pos.y,
      color: bugFormState.drawColor,
      lineWidth: bugFormState.lineWidth,
    });
  } else if (bugFormState.currentTool === 'pen') {
    if (bugFormState.currentPath.length > 1) {
      bugFormState.annotations.push({
        type: 'pen',
        points: [...bugFormState.currentPath],
        color: bugFormState.drawColor,
        lineWidth: bugFormState.lineWidth,
      });
    }
    bugFormState.currentPath = [];
  }
  redrawBugFormAnnotations();
});

function redrawBugFormAnnotations() {
  if (!bugFormBaseImage) return;
  bugFormCtx.clearRect(0, 0, bugFormCanvas.width, bugFormCanvas.height);
  bugFormCtx.drawImage(bugFormBaseImage, 0, 0);
  for (const ann of bugFormState.annotations) {
    drawAnnotation(bugFormCtx, ann);
  }
}

function drawBugFormRectPreview(mx, my) {
  const rx = Math.min(bugFormState.drawStart.x, mx);
  const ry = Math.min(bugFormState.drawStart.y, my);
  const rw = Math.abs(mx - bugFormState.drawStart.x);
  const rh = Math.abs(my - bugFormState.drawStart.y);
  bugFormCtx.save();
  bugFormCtx.strokeStyle = bugFormState.drawColor;
  bugFormCtx.lineWidth = bugFormState.lineWidth;
  bugFormCtx.strokeRect(rx, ry, rw, rh);
  bugFormCtx.restore();
}

function drawBugFormArrowPreview(mx, my) {
  bugFormCtx.save();
  bugFormCtx.strokeStyle = bugFormState.drawColor;
  bugFormCtx.fillStyle = bugFormState.drawColor;
  bugFormCtx.lineWidth = bugFormState.lineWidth;
  drawArrow(bugFormCtx, bugFormState.drawStart.x, bugFormState.drawStart.y, mx, my, bugFormState.lineWidth);
  bugFormCtx.restore();
}

function drawBugFormPenPreview() {
  if (bugFormState.currentPath.length < 2) return;
  bugFormCtx.save();
  bugFormCtx.strokeStyle = bugFormState.drawColor;
  bugFormCtx.lineWidth = bugFormState.lineWidth;
  drawPenPath(bugFormCtx, bugFormState.currentPath, bugFormState.lineWidth);
  bugFormCtx.restore();
}

function showBugFormTextInput(x, y) {
  const rect = bugFormCanvas.getBoundingClientRect();
  const scaleX = rect.width / bugFormCanvas.width;
  const scaleY = rect.height / bugFormCanvas.height;
  const screenX = rect.left + x * scaleX;
  const screenY = rect.top + y * scaleY;

  bugTextInput.classList.remove('hidden');
  bugTextInput.style.left = screenX + 'px';
  bugTextInput.style.top = screenY + 'px';
  bugTextInput.value = '';

  requestAnimationFrame(() => {
    bugTextInput.focus();
  });

  let confirmed = false;

  const handleConfirm = () => {
    if (confirmed) return;
    confirmed = true;
    const text = bugTextInput.value.trim();
    if (text) {
      bugFormState.annotations.push({
        type: 'text',
        x: x,
        y: y + 18,
        text: text,
        color: bugFormState.drawColor,
        lineWidth: bugFormState.lineWidth,
      });
      redrawBugFormAnnotations();
    }
    bugTextInput.classList.add('hidden');
    cleanup();
  };

  const handleBlur = () => {
    setTimeout(handleConfirm, 150);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      confirmed = true;
      bugTextInput.classList.add('hidden');
      cleanup();
    }
  };

  const cleanup = () => {
    bugTextInput.removeEventListener('keydown', handleKeyDown);
    bugTextInput.removeEventListener('blur', handleBlur);
  };

  bugTextInput.addEventListener('keydown', handleKeyDown);
  bugTextInput.addEventListener('blur', handleBlur);
}

// ============ Bug Form Toolbar Events ============
document.querySelector('.bug-form-preview-toolbar').addEventListener('mousedown', (e) => e.stopPropagation());

document.getElementById('btnBugRect').addEventListener('click', () => setBugFormTool('rect'));
document.getElementById('btnBugArrow').addEventListener('click', () => setBugFormTool('arrow'));
document.getElementById('btnBugPen').addEventListener('click', () => setBugFormTool('pen'));
document.getElementById('btnBugText').addEventListener('click', () => setBugFormTool('text'));
document.getElementById('bugColorPicker').addEventListener('input', (e) => {
  bugFormState.drawColor = e.target.value;
});
document.getElementById('bugLineWidth').addEventListener('change', (e) => {
  bugFormState.lineWidth = parseInt(e.target.value);
});
document.getElementById('btnBugUndo').addEventListener('click', () => {
  if (bugFormState.annotations.length > 0) {
    bugFormState.annotations.pop();
    redrawBugFormAnnotations();
  }
});
document.getElementById('btnBugClear').addEventListener('click', () => {
  bugFormState.annotations = [];
  redrawBugFormAnnotations();
});

document.getElementById('btnBugCancel').addEventListener('click', () => {
  bugFormOverlay.classList.add('hidden');
  bugFormOverlay.classList.remove('form-mode');
  api.exitFormMode();
  api.setWindowLevel('screen-saver');
  api.cancel();
});

document.getElementById('btnBugSubmit').addEventListener('click', async () => {
  if (!dmpConnected) {
    alert('请先通过「链接测试」确认 DMP 已连接');
    return;
  }
  await submitDmp('auto');
});

document.getElementById('btnDmpManualSubmit').addEventListener('click', async () => {
  await submitDmp('manual');
});

async function submitDmp(mode) {
  const title = document.getElementById('bugTitle').value.trim();
  const description = document.getElementById('bugDescription').value.trim();

  // DMP 表单字段
  const dmpProjectName = document.getElementById('dmpProjectName').value.trim();
  const dmpModulePath = document.getElementById('dmpModulePath').value.trim();
  const dmpDefectType = document.getElementById('dmpDefectType').value;
  const dmpDiscoveryStage = document.getElementById('dmpDiscoveryStage').value;
  const dmpPriority = document.getElementById('dmpPriority').value;
  const dmpTestEnv = document.getElementById('dmpTestEnv').value.trim();
  const dmpSource = document.getElementById('dmpSource').value;
  const dmpStoryValue = document.getElementById('dmpStoryValue').value.trim();
  const dmpHandlerId = document.getElementById('dmpHandlerId').value.trim();
  const dmpNoteExtra = document.getElementById('dmpNoteExtra').value.trim();

  const isInteraction = dmpDefectType === '交互体验';

  if (!title) {
    alert('请填写标题');
    return;
  }
  // 自动模式校验 DMP 必填字段；手动模式跳过
  if (mode === 'auto' && (!dmpProjectName || !dmpModulePath || !dmpTestEnv || (!isInteraction && !dmpStoryValue) || !dmpHandlerId)) {
    const storyHint = isInteraction ? '' : '、关联故事';
    alert(`请填写 DMP 必填信息（项目名称、模块路径、测试环境${storyHint}、处理人工号）`);
    return;
  }

  // 保存 DMP 默认值，下次自动填充
  saveDmpFormDefaults();

  const submitBtn = document.getElementById(mode === 'manual' ? 'btnDmpManualSubmit' : 'btnBugSubmit');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = '提交中...';

  const statusEl = document.getElementById('submitStatus');

  try {
    // 从弹窗内的 canvas 导出最终图片（包含弹窗内新增的标注）
    const dataUrl = bugFormCanvas.toDataURL('image/png');
    const result = await api.submitBug({
      title,
      description,
      imageDataUrl: dataUrl,
      mode,
      dmpForm: {
        project_name: dmpProjectName,
        module_path: dmpModulePath,
        defect_type: dmpDefectType,
        discovery_stage: dmpDiscoveryStage,
        priority: dmpPriority,
        source: dmpSource,
        test_env: dmpTestEnv,
        story_value: dmpStoryValue,
        handler_id: dmpHandlerId,
        note_extra: dmpNoteExtra,
      },
    });

    if (result.success) {
      statusEl.textContent = result.message;
      statusEl.className = 'submit-status success';
      statusEl.classList.remove('hidden');

      setTimeout(() => {
        bugFormOverlay.classList.add('hidden');
        api.cancel(); // Close screenshot window after success
      }, 1500);
    } else {
      const errMsg = result.message || '提交失败';
      statusEl.textContent = errMsg;
      statusEl.className = 'submit-status error';
      statusEl.classList.remove('hidden');
      showToast(errMsg.length > 50 ? errMsg.slice(0, 50) + '...' : errMsg);
    }
  } catch (e) {
    const errMsg = '提交失败：' + (e.message || '网络错误');
    statusEl.textContent = errMsg;
    statusEl.className = 'submit-status error';
    statusEl.classList.remove('hidden');
    showToast(errMsg.length > 50 ? errMsg.slice(0, 50) + '...' : errMsg);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// DMP 表单默认值记忆
async function saveDmpFormDefaults() {
  try {
    await api.saveDmpFormDefaults({
      project_name: document.getElementById('dmpProjectName').value.trim(),
      module_path: document.getElementById('dmpModulePath').value.trim(),
      defect_type: document.getElementById('dmpDefectType').value,
      discovery_stage: document.getElementById('dmpDiscoveryStage').value,
      priority: document.getElementById('dmpPriority').value,
      source: document.getElementById('dmpSource').value,
      test_env: document.getElementById('dmpTestEnv').value.trim(),
      story_value: document.getElementById('dmpStoryValue').value.trim(),
      handler_id: document.getElementById('dmpHandlerId').value.trim(),
      note_extra: document.getElementById('dmpNoteExtra').value.trim(),
    });
  } catch (e) {
    console.error('保存 DMP 默认值失败', e);
  }
}

async function loadDmpFormDefaults() {
  try {
    const res = await api.loadDmpFormDefaults();
    if (res && res.success && res.data) {
      const d = res.data;
      if (d.project_name) document.getElementById('dmpProjectName').value = d.project_name;
      if (d.module_path) document.getElementById('dmpModulePath').value = d.module_path;
      if (d.defect_type) document.getElementById('dmpDefectType').value = d.defect_type;
      if (d.discovery_stage) document.getElementById('dmpDiscoveryStage').value = d.discovery_stage;
      if (d.priority) document.getElementById('dmpPriority').value = d.priority;
      if (d.source) document.getElementById('dmpSource').value = d.source;
      if (d.test_env) document.getElementById('dmpTestEnv').value = d.test_env;
      if (d.story_value) document.getElementById('dmpStoryValue').value = d.story_value;
      if (d.handler_id) document.getElementById('dmpHandlerId').value = d.handler_id;
      if (d.note_extra) document.getElementById('dmpNoteExtra').value = d.note_extra;
    }
  } catch (e) {
    console.error('加载 DMP 默认值失败', e);
  }
}

// 根据缺陷类型动态调整「关联故事」是否必填
function updateStoryRequired() {
  const defectType = document.getElementById('dmpDefectType').value;
  const label = document.getElementById('dmpStoryLabel');
  if (defectType === '交互体验') {
    label.innerHTML = '关联故事';
  } else {
    label.innerHTML = '关联故事 <span class="required">*</span>';
  }
}

document.getElementById('dmpDefectType').addEventListener('change', updateStoryRequired);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!bugFormOverlay.classList.contains('hidden')) {
      // 关闭弹窗，回到截图标注界面
      bugFormOverlay.classList.add('hidden');
      bugFormOverlay.classList.remove('form-mode');
      api.exitFormMode();
      overlay.classList.remove('hidden');
      toolbar.classList.remove('hidden');
      document.body.style.cursor = 'crosshair';
      api.setWindowLevel('screen-saver');
      positionToolbar();
    } else {
      api.cancel();
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undoAnnotation();
  }
});
