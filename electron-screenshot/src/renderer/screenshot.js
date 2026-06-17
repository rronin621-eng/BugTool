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
  // Retina / HiDPI support
  dpr: window.devicePixelRatio || 1,
  canvasW: 0,  // logical (CSS) pixel width
  canvasH: 0,  // logical (CSS) pixel height
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

// BUG 弹窗内的预览 canvas
const bugFormCanvas = document.getElementById('bugFormCanvas');
const bugFormCtx = bugFormCanvas.getContext('2d');
const bugTextInput = document.getElementById('bugTextInput');

// ============ Init ============
const api = window.screenshotAPI;

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
    state.isSelecting = true;
    state.selectStart = { x: e.clientX, y: e.clientY };
  } else if (state.phase === 'annotate') {
    handleAnnotationStart(e);
  }
});

drawCanvas.addEventListener('mousemove', (e) => {
  if (state.phase === 'select' && state.isSelecting) {
    drawSelection(e.clientX, e.clientY);
  } else if (state.phase === 'annotate') {
    if (state.draggingTextIdx !== -1) {
      // 拖拽文字标注
      const ann = state.annotations[state.draggingTextIdx];
      ann.x = e.clientX - state.dragOffset.x;
      ann.y = e.clientY - state.dragOffset.y;
      redrawAnnotations();
    } else if (state.isDrawing) {
      handleAnnotationMove(e);
    } else if (state.currentTool === 'text') {
      // text 工具下，鼠标悬停在文字上时改变光标
      const hitIdx = hitTestTextAnnotation(e.clientX, e.clientY);
      drawCanvas.style.cursor = hitIdx !== -1 ? 'move' : 'crosshair';
    }
  }
});

drawCanvas.addEventListener('mouseup', (e) => {
  if (state.phase === 'select' && state.isSelecting) {
    state.isSelecting = false;
    finalizeSelection(e.clientX, e.clientY);
  } else if (state.phase === 'annotate') {
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

// ============ Annotation Tools ============

// 检测点击是否命中某个文字标注，返回该标注的索引，未命中返回 -1
function hitTestTextAnnotation(mx, my) {
  for (let i = state.annotations.length - 1; i >= 0; i--) {
    const ann = state.annotations[i];
    if (ann.type !== 'text') continue;
    const fontSize = Math.max(14, ann.lineWidth * 5);
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
    // 刚确认过一次输入，跳过本次 mousedown
    if (state.textJustConfirmed) {
      state.textJustConfirmed = false;
      return;
    }
    // 先检测是否命中已有文字，命中则拖拽
    const hitIdx = hitTestTextAnnotation(mx, my);
    if (hitIdx !== -1) {
      state.draggingTextIdx = hitIdx;
      state.dragOffset = {
        x: mx - state.annotations[hitIdx].x,
        y: my - state.annotations[hitIdx].y,
      };
      state.isDrawing = false;
      drawCanvas.style.cursor = 'move';
      return;
    }
    // 未命中，新建文字输入
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

  // Redraw selection border
  const { x, y, w, h } = state.selection;
  drawCtx.strokeStyle = '#1976d2';
  drawCtx.lineWidth = 1;
  drawCtx.setLineDash([4, 4]);
  drawCtx.strokeRect(x, y, w, h);
  drawCtx.setLineDash([]);

  // Redraw all annotations
  for (const ann of state.annotations) {
    drawAnnotation(drawCtx, ann);
  }
}

function drawAnnotation(ctx, ann) {
  // 复用共享标注模块；文字框仅在 text 工具激活时显示
  window.AnnotateLib.drawAnnotation(ctx, ann, state.currentTool === 'text');
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
function showTextInput(x, y) {
  textInput.classList.remove('hidden');
  textInput.style.left = x + 'px';
  textInput.style.top = y + 'px';
  textInput.value = '';

  // 降低窗口层级让输入法候选框能显示
  api.setWindowLevel('normal');

  // 延迟 focus 避免 mouseup 事件立即触发 blur
  requestAnimationFrame(() => {
    textInput.focus();
  });

  let confirmed = false;

  const handleConfirm = () => {
    if (confirmed) return;
    confirmed = true;
    const text = textInput.value.trim();
    if (text) {
      state.annotations.push({
        type: 'text',
        x: x,
        y: y + 18,
        text: text,
        color: state.drawColor,
        lineWidth: state.lineWidth,
      });
      redrawAnnotations();
    }
    textInput.classList.add('hidden');
    textInput.removeEventListener('keydown', handleKeyDown);
    textInput.removeEventListener('blur', handleBlur);
    // 恢复窗口层级
    api.setWindowLevel('screen-saver');
  };

  // blur 时用 setTimeout 给时间让 keydown 先处理
  // blur 后设置冷却标志，防止同一次点击事件立即触发新的文字输入框
  const handleBlur = () => {
    setTimeout(() => {
      state.textJustConfirmed = true;
      handleConfirm();
      // 冷却期结束后重置标志（兜底）
      setTimeout(() => { state.textJustConfirmed = false; }, 300);
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      confirmed = true;
      textInput.classList.add('hidden');
      textInput.removeEventListener('keydown', handleKeyDown);
      textInput.removeEventListener('blur', handleBlur);
      // 恢复窗口层级
      api.setWindowLevel('screen-saver');
    }
  };

  textInput.addEventListener('keydown', handleKeyDown);
  textInput.addEventListener('blur', handleBlur);
}

// ============ Export Annotated Image ============
function exportAnnotatedImage() {
  const { x, y, w, h } = state.selection;
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
    drawAnnotation(ctx, ann);
  }
  ctx.restore();

  return exportCanvas.toDataURL('image/png');
}

// ============ Toast ============
let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.classList.add('hidden'); }, 2000);
}

// ============ Toolbar Event Handlers ============
// Prevent toolbar mousedown/mouseup from bubbling into canvas handlers
document.getElementById('toolbar').addEventListener('mousedown', (e) => e.stopPropagation());
document.getElementById('toolbar').addEventListener('mouseup', (e) => e.stopPropagation());

document.getElementById('btnRect').addEventListener('click', () => setTool('rect'));
document.getElementById('btnArrow').addEventListener('click', () => setTool('arrow'));
document.getElementById('btnPen').addEventListener('click', () => setTool('pen'));
document.getElementById('btnText').addEventListener('click', () => setTool('text'));
document.getElementById('colorPicker').addEventListener('input', (e) => {
  state.drawColor = e.target.value;
});
document.getElementById('lineWidth').addEventListener('change', (e) => {
  state.lineWidth = parseInt(e.target.value);
});
document.getElementById('btnUndo').addEventListener('click', undoAnnotation);
document.getElementById('btnClear').addEventListener('click', clearAnnotations);
document.getElementById('btnCopy').addEventListener('click', copyToClipboard);
document.getElementById('btnDownload').addEventListener('click', saveToDesktop);
document.getElementById('btnMultiShot').addEventListener('click', addToMultiShot);
document.getElementById('btnBug').addEventListener('click', showBugForm);

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
  if (mode === 'record') {
    tabRecord.classList.add('active');
    tabShot.classList.remove('active');
    shotTools.classList.add('hidden');
    recordTools.classList.remove('hidden');
    // 录屏模式下隐藏标注遮罩上的标注层（保留选区边框）
  } else {
    tabShot.classList.add('active');
    tabRecord.classList.remove('active');
    recordTools.classList.add('hidden');
    shotTools.classList.remove('hidden');
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
  const btnMap = { rect: 'btnRect', arrow: 'btnArrow', pen: 'btnPen', text: 'btnText' };
  document.getElementById(btnMap[tool])?.classList.add('active');
}

function undoAnnotation() {
  if (state.annotations.length > 0) {
    state.annotations.pop();
    redrawAnnotations();
  }
}

function clearAnnotations() {
  state.annotations = [];
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
    // 查询失败时仍尝试添加，由主进程兜底拦截
  }
  const dataUrl = exportAnnotatedImage();
  api.addToMultiShot(dataUrl);
  // 主进程会关闭当前截图窗口并弹出/刷新暂存小窗
}

function cancelScreenshot() {
  api.cancel();
}

// ============ Bug Form ============
const FALLBACK_USERS = [
  { id: 1, display_name: '张三', role: 'tester' },
  { id: 2, display_name: '李四', role: 'developer' },
  { id: 3, display_name: '王五', role: 'developer' },
  { id: 4, display_name: '赵六', role: 'tester' },
];

async function loadUsers() {
  try {
    const response = await api.getUsers();
    if (response.code === 0 && response.data && response.data.length > 0) {
      state.users = response.data;
    } else {
      state.users = FALLBACK_USERS;
    }
  } catch (e) {
    console.error('Failed to load users, using fallback:', e);
    state.users = FALLBACK_USERS;
  }
  populateUserSelects();
}

function populateUserSelects() {
  const reporter = document.getElementById('bugReporter');
  const assignee = document.getElementById('bugAssignee');

  reporter.innerHTML = '';
  assignee.innerHTML = '<option value="">-- 请选择 --</option>';

  for (const user of state.users) {
    const opt1 = document.createElement('option');
    opt1.value = user.id;
    opt1.textContent = user.display_name;
    reporter.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = user.id;
    opt2.textContent = `${user.display_name} (${user.role === 'developer' ? '开发' : user.role === 'admin' ? '管理员' : '测试'})`;
    assignee.appendChild(opt2);
  }

  // Default to first user
  if (state.users.length > 0) {
    reporter.value = state.users[0].id;
  }
}

async function loadInspectionTasks() {
  try {
    const response = await api.getInspectionTasks();
    if (response.code === 0 && Array.isArray(response.data)) {
      state.inspectionTasks = response.data;
    }
  } catch (e) {
    console.error('Failed to load inspection tasks:', e);
  }
  populateInspectionTaskSelect();
}

async function loadFunctionModules() {
  try {
    const response = await api.getFunctionModules();
    if (response.code === 0 && Array.isArray(response.data)) {
      state.modules = response.data;
    }
  } catch (e) {
    console.error('Failed to load function modules:', e);
  }
  populateModuleSelect();
}

function populateInspectionTaskSelect() {
  const select = document.getElementById('bugInspectionTask');
  select.innerHTML = '<option value="">-- 不关联 --</option>';
  for (const task of state.inspectionTasks) {
    const opt = document.createElement('option');
    opt.value = task.id;
    opt.textContent = task.name;
    select.appendChild(opt);
  }

  // 选择走查项目时自动填充默认接收人和环境路径
  select.addEventListener('change', () => {
    const taskId = parseInt(select.value);
    const task = state.inspectionTasks.find(t => t.id === taskId);
    if (task) {
      if (task.default_assignee_id) {
        const assigneeSelect = document.getElementById('bugAssignee');
        assigneeSelect.value = task.default_assignee_id;
      }
      if (task.default_env_url) {
        const envUrlInput = document.getElementById('bugEnvUrl');
        if (!envUrlInput.value) {
          envUrlInput.value = task.default_env_url;
        }
      }
    }
  });
}

function populateModuleSelect() {
  const select = document.getElementById('bugModule');
  select.innerHTML = '<option value="">-- 不关联 --</option>';
  for (const module of state.modules) {
    const opt = document.createElement('option');
    opt.value = module.id;
    opt.textContent = module.name;
    select.appendChild(opt);
  }
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
  document.getElementById('bugTitle').value = `BUG截图 - ${timeStr}`;
  document.getElementById('bugDescription').value = '';
  document.getElementById('bugEnvUrl').value = '';
  document.getElementById('bugInspectionTask').value = '';
  document.getElementById('bugModule').value = '';
  document.getElementById('bugReproductionSteps').value = '';
  document.getElementById('submitStatus').classList.add('hidden');

  bugFormOverlay.classList.remove('hidden');
  // 打开录入弹窗时，通知主进程将安全超时延长到 10 分钟，防止填写途中窗口被关闭
  api.extendTimeout();
  // 降低窗口层级，让输入法候选框能正常显示
  api.setWindowLevel('normal');
  document.getElementById('bugTitle').focus();
}

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
  api.setWindowLevel('screen-saver');
  api.cancel();
});

document.getElementById('btnBugSubmit').addEventListener('click', async () => {
  const title = document.getElementById('bugTitle').value.trim();
  const bugType = document.getElementById('bugType').value;
  const priorityEl = document.getElementById('bugPriority');
  const priority = priorityEl ? priorityEl.value : 'medium';
  const reporterId = parseInt(document.getElementById('bugReporter').value);
  const assigneeId = document.getElementById('bugAssignee').value;
  const description = document.getElementById('bugDescription').value.trim();
  const envUrl = document.getElementById('bugEnvUrl').value.trim();
  const inspectionTaskId = document.getElementById('bugInspectionTask').value;
  const moduleId = document.getElementById('bugModule').value;
  const reproductionSteps = document.getElementById('bugReproductionSteps').value.trim();

  if (!title) {
    alert('请填写标题');
    return;
  }
  if (!reporterId) {
    alert('请选择录入人');
    return;
  }

  const submitBtn = document.getElementById('btnBugSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = '提交中...';

  const statusEl = document.getElementById('submitStatus');

  try {
    // 从弹窗内的 canvas 导出最终图片（包含弹窗内新增的标注）
    const dataUrl = bugFormCanvas.toDataURL('image/png');
    const result = await api.submitBug({
      title,
      description,
      bug_type: bugType,
      priority,
      reporter_id: reporterId,
      assignee_id: assigneeId ? parseInt(assigneeId) : reporterId,
      env_url: envUrl,
      inspection_task_id: inspectionTaskId ? parseInt(inspectionTaskId) : null,
      module_id: moduleId ? parseInt(moduleId) : null,
      reproduction_steps: reproductionSteps,
      imageDataUrl: dataUrl,
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
      statusEl.textContent = result.message || '提交失败';
      statusEl.className = 'submit-status error';
      statusEl.classList.remove('hidden');
    }
  } catch (e) {
    statusEl.textContent = '网络错误，请检查后端服务是否启动';
    statusEl.className = 'submit-status error';
    statusEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '提交';
  }
});

// ============ Keyboard Shortcuts ============
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!bugFormOverlay.classList.contains('hidden')) {
      // 关闭弹窗，回到截图标注界面
      bugFormOverlay.classList.add('hidden');
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
