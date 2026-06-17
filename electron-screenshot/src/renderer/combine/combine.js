/* combine.js — 组合图编辑器 */

const api = window.combineAPI;

// ============ 状态 ============
const state = {
  slots: [],            // { dataUrl, img, scale }
  direction: 'horizontal',
  selectedIndex: -1,
  // 标注
  currentTool: null,    // null=选择/拖动模式; 'rect'|'arrow'|'pen'|'text'
  drawColor: '#ff0000',
  lineWidth: 3,
  annotations: [],
  isDrawing: false,
  drawStart: { x: 0, y: 0 },
  currentPath: [],
  // 图片拖动排序
  draggingSlot: -1,
  dragPointer: { x: 0, y: 0 },
  // 布局缓存
  layout: [],           // 每张图的 { x, y, w, h }
  canvasW: 0,
  canvasH: 0,
  displayScale: 1,      // 画布自适应基础缩放比例
  viewZoom: 1,          // 用户手动视图缩放倍数
};

const GAP = 40;
const PADDING = 48;
const SHADOW_BLUR = 18;
const MAX_DISPLAY_W = 1080;
const MAX_DISPLAY_H = 560;

// ============ DOM ============
const canvas = document.getElementById('combineCanvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvasWrap');
const textInput = document.getElementById('textInput');
const toast = document.getElementById('toast');
const bugFormOverlay = document.getElementById('bugFormOverlay');

// ============ 初始化 ============
api.getList().then(async (res) => {
  const images = res.images || [];
  await Promise.all(images.map((dataUrl) => loadSlot(dataUrl)));
  relayout();
});

function loadSlot(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      state.slots.push({ dataUrl, img, scale: 1 });
      resolve();
    };
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
}

// ============ 布局计算 ============
function computeLayout() {
  const n = state.slots.length;
  const layout = [];
  if (n === 0) {
    state.canvasW = 400;
    state.canvasH = 300;
    state.layout = [];
    return;
  }

  const sizes = state.slots.map((s) => ({
    w: s.img.width * s.scale,
    h: s.img.height * s.scale,
  }));

  if (state.direction === 'horizontal') {
    const totalW = sizes.reduce((sum, s) => sum + s.w, 0) + GAP * (n - 1);
    const maxH = Math.max(...sizes.map((s) => s.h));
    state.canvasW = PADDING * 2 + totalW;
    state.canvasH = PADDING * 2 + maxH;
    let x = PADDING;
    sizes.forEach((s) => {
      const y = PADDING + (maxH - s.h) / 2;
      layout.push({ x, y, w: s.w, h: s.h });
      x += s.w + GAP;
    });
  } else {
    const totalH = sizes.reduce((sum, s) => sum + s.h, 0) + GAP * (n - 1);
    const maxW = Math.max(...sizes.map((s) => s.w));
    state.canvasW = PADDING * 2 + maxW;
    state.canvasH = PADDING * 2 + totalH;
    let y = PADDING;
    sizes.forEach((s) => {
      const x = PADDING + (maxW - s.w) / 2;
      layout.push({ x, y, w: s.w, h: s.h });
      y += s.h + GAP;
    });
  }
  state.layout = layout;
}

function relayout() {
  computeLayout();
  canvas.width = state.canvasW;
  canvas.height = state.canvasH;

  // 计算 CSS 显示缩放，避免画布过大超出视口
  const scaleW = MAX_DISPLAY_W / state.canvasW;
  const scaleH = MAX_DISPLAY_H / state.canvasH;
  state.displayScale = Math.min(1, scaleW, scaleH);
  const finalScale = state.displayScale * state.viewZoom;
  canvas.style.width = state.canvasW * finalScale + 'px';
  canvas.style.height = state.canvasH * finalScale + 'px';

  const zoomLabel = document.getElementById('viewZoomLabel');
  if (zoomLabel) zoomLabel.textContent = Math.round(finalScale * 100) + '%';

  redraw();
}

// ============ 绘制 ============
function redraw() {
  // 白底
  ctx.clearRect(0, 0, state.canvasW, state.canvasH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, state.canvasW, state.canvasH);

  // 逐张绘制（带阴影）
  state.slots.forEach((slot, i) => {
    const r = state.layout[i];
    if (!r) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = SHADOW_BLUR;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(slot.img, r.x, r.y, r.w, r.h);
    ctx.restore();

    // 选中描边
    if (i === state.selectedIndex) {
      ctx.save();
      ctx.strokeStyle = '#1a6cff';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      ctx.setLineDash([]);
      ctx.restore();
    }
  });

  // 标注层
  state.annotations.forEach((ann) => {
    window.AnnotateLib.drawAnnotation(ctx, ann, state.currentTool === 'text');
  });
}

// 仅导出图像（不含选中框）
function exportImage() {
  state.selectedIndex = -1;
  redraw();
  return canvas.toDataURL('image/png');
}

// ============ 坐标转换 ============
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * sx,
    y: (e.clientY - rect.top) * sy,
  };
}

function hitTestSlot(x, y) {
  for (let i = state.layout.length - 1; i >= 0; i--) {
    const r = state.layout[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

// ============ 鼠标交互 ============
canvas.addEventListener('mousedown', (e) => {
  const pos = getCanvasPos(e);

  if (state.currentTool) {
    // 标注模式
    if (state.currentTool === 'text') {
      showTextInput(e, pos);
      return;
    }
    state.isDrawing = true;
    state.drawStart = pos;
    if (state.currentTool === 'pen') state.currentPath = [pos];
    return;
  }

  // 选择/拖动模式
  const idx = hitTestSlot(pos.x, pos.y);
  state.selectedIndex = idx;
  if (idx !== -1) {
    state.draggingSlot = idx;
    state.dragPointer = pos;
  }
  redraw();
});

canvas.addEventListener('mousemove', (e) => {
  const pos = getCanvasPos(e);

  if (state.isDrawing && state.currentTool) {
    redraw();
    if (state.currentTool === 'pen') {
      state.currentPath.push(pos);
      drawPreviewPen();
    } else if (state.currentTool === 'rect') {
      drawPreviewRect(pos);
    } else if (state.currentTool === 'arrow') {
      drawPreviewArrow(pos);
    }
    return;
  }

  if (state.draggingSlot !== -1) {
    state.dragPointer = pos;
    // 实时计算目标插入位置并预览（简单重排）
    const target = computeDropIndex(pos);
    if (target !== -1 && target !== state.draggingSlot) {
      moveSlot(state.draggingSlot, target);
      state.draggingSlot = target;
      state.selectedIndex = target;
      relayout();
    }
  }
});

canvas.addEventListener('mouseup', (e) => {
  const pos = getCanvasPos(e);

  if (state.isDrawing && state.currentTool) {
    state.isDrawing = false;
    if (state.currentTool === 'rect') {
      state.annotations.push({ type: 'rect', x1: state.drawStart.x, y1: state.drawStart.y, x2: pos.x, y2: pos.y, color: state.drawColor, lineWidth: state.lineWidth });
    } else if (state.currentTool === 'arrow') {
      state.annotations.push({ type: 'arrow', x1: state.drawStart.x, y1: state.drawStart.y, x2: pos.x, y2: pos.y, color: state.drawColor, lineWidth: state.lineWidth });
    } else if (state.currentTool === 'pen') {
      if (state.currentPath.length > 1) {
        state.annotations.push({ type: 'pen', points: [...state.currentPath], color: state.drawColor, lineWidth: state.lineWidth });
      }
      state.currentPath = [];
    }
    redraw();
    return;
  }

  state.draggingSlot = -1;
});

// 计算拖动落点对应的目标索引（基于各图中心）
function computeDropIndex(pos) {
  const n = state.layout.length;
  for (let i = 0; i < n; i++) {
    const r = state.layout[i];
    if (state.direction === 'horizontal') {
      const center = r.x + r.w / 2;
      if (pos.x < center) return i;
    } else {
      const center = r.y + r.h / 2;
      if (pos.y < center) return i;
    }
  }
  return n - 1;
}

function moveSlot(from, to) {
  if (from === to) return;
  const [s] = state.slots.splice(from, 1);
  state.slots.splice(to, 0, s);
}

// ============ 标注预览 ============
function drawPreviewRect(pos) {
  ctx.save();
  ctx.strokeStyle = state.drawColor;
  ctx.lineWidth = state.lineWidth;
  const rx = Math.min(state.drawStart.x, pos.x);
  const ry = Math.min(state.drawStart.y, pos.y);
  ctx.strokeRect(rx, ry, Math.abs(pos.x - state.drawStart.x), Math.abs(pos.y - state.drawStart.y));
  ctx.restore();
}
function drawPreviewArrow(pos) {
  ctx.save();
  ctx.strokeStyle = state.drawColor;
  ctx.fillStyle = state.drawColor;
  ctx.lineWidth = state.lineWidth;
  window.AnnotateLib.drawArrow(ctx, state.drawStart.x, state.drawStart.y, pos.x, pos.y, state.lineWidth);
  ctx.restore();
}
function drawPreviewPen() {
  ctx.save();
  ctx.strokeStyle = state.drawColor;
  ctx.lineWidth = state.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  window.AnnotateLib.drawPenPath(ctx, state.currentPath, state.lineWidth);
  ctx.restore();
}

// ============ 文字标注 ============
function showTextInput(e, pos) {
  textInput.classList.remove('hidden');
  textInput.style.left = e.clientX + 'px';
  textInput.style.top = e.clientY + 'px';
  textInput.value = '';
  api.setWindowLevel('normal');
  requestAnimationFrame(() => textInput.focus());

  let confirmed = false;
  const finish = () => {
    if (confirmed) return;
    confirmed = true;
    const text = textInput.value.trim();
    if (text) {
      state.annotations.push({ type: 'text', x: pos.x, y: pos.y + 18, text, color: state.drawColor, lineWidth: state.lineWidth });
      redraw();
    }
    textInput.classList.add('hidden');
    textInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('blur', onBlur);
    api.setWindowLevel('screen-saver');
  };
  const onBlur = () => setTimeout(finish, 120);
  const onKey = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
    else if (ev.key === 'Escape') { confirmed = true; textInput.classList.add('hidden'); textInput.removeEventListener('keydown', onKey); textInput.removeEventListener('blur', onBlur); api.setWindowLevel('screen-saver'); }
  };
  textInput.addEventListener('keydown', onKey);
  textInput.addEventListener('blur', onBlur);
}

// ============ 工具栏事件 ============
function setTool(tool) {
  // 再次点击同一工具则取消（回到选择模式）
  state.currentTool = state.currentTool === tool ? null : tool;
  document.querySelectorAll('.topbar-tools .tool-btn').forEach((b) => b.classList.remove('active'));
  if (state.currentTool) {
    const map = { rect: 'btnRect', arrow: 'btnArrow', pen: 'btnPen', text: 'btnText' };
    document.getElementById(map[state.currentTool]).classList.add('active');
    state.selectedIndex = -1;
    redraw();
  }
}

document.getElementById('btnRect').addEventListener('click', () => setTool('rect'));
document.getElementById('btnArrow').addEventListener('click', () => setTool('arrow'));
document.getElementById('btnPen').addEventListener('click', () => setTool('pen'));
document.getElementById('btnText').addEventListener('click', () => setTool('text'));

document.getElementById('colorPicker').addEventListener('input', (e) => { state.drawColor = e.target.value; });
document.getElementById('lineWidth').addEventListener('change', (e) => { state.lineWidth = parseInt(e.target.value); });

document.getElementById('btnUndo').addEventListener('click', () => {
  if (state.annotations.length > 0) { state.annotations.pop(); redraw(); }
});
document.getElementById('btnClear').addEventListener('click', () => { state.annotations = []; redraw(); });

document.getElementById('btnDirH').addEventListener('click', () => setDirection('horizontal'));
document.getElementById('btnDirV').addEventListener('click', () => setDirection('vertical'));

function setDirection(dir) {
  state.direction = dir;
  document.getElementById('btnDirH').classList.toggle('active', dir === 'horizontal');
  document.getElementById('btnDirV').classList.toggle('active', dir === 'vertical');
  relayout();
}

document.getElementById('btnZoomIn').addEventListener('click', () => zoomSelected(1.1));
document.getElementById('btnZoomOut').addEventListener('click', () => zoomSelected(1 / 1.1));

function zoomSelected(factor) {
  if (state.selectedIndex < 0) { showToastMsg('请先点击选中一张图片'); return; }
  const slot = state.slots[state.selectedIndex];
  slot.scale = Math.max(0.2, Math.min(3, slot.scale * factor));
  relayout();
}

// 视图缩放（只改变显示大小，不影响导出）
document.getElementById('btnViewZoomIn').addEventListener('click', () => setViewZoom(state.viewZoom * 1.2));
document.getElementById('btnViewZoomOut').addEventListener('click', () => setViewZoom(state.viewZoom / 1.2));

function setViewZoom(z) {
  state.viewZoom = Math.max(0.3, Math.min(4, z));
  document.getElementById('viewZoomLabel').textContent = Math.round(state.displayScale * state.viewZoom * 100) + '%';
  relayout();
}

// ============ Toast ============
let toastTimer = null;
function showToastMsg(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 1800);
}

// ============ 输出操作 ============
document.getElementById('btnCopy').addEventListener('click', async () => {
  const dataUrl = exportImage();
  await api.copyToClipboard(dataUrl);
});

document.getElementById('btnSave').addEventListener('click', async () => {
  const dataUrl = exportImage();
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  await api.saveToDesktop(dataUrl, `combine_${ts}.png`);
});

document.getElementById('btnClose').addEventListener('click', () => api.close());

// ESC / Ctrl+Z
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bugFormOverlay.classList.contains('hidden')) {
    api.close();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    if (state.annotations.length > 0) { state.annotations.pop(); redraw(); }
  }
});

// ============ BUG 录入 ============
const FALLBACK_USERS = [
  { id: 1, display_name: '张三', role: 'tester' },
  { id: 2, display_name: '李四', role: 'developer' },
];
let users = [];

async function loadFormData() {
  try {
    const r = await api.getUsers();
    users = (r.code === 0 && r.data && r.data.length) ? r.data : FALLBACK_USERS;
  } catch { users = FALLBACK_USERS; }
  const reporter = document.getElementById('bugReporter');
  const assignee = document.getElementById('bugAssignee');
  reporter.innerHTML = '';
  assignee.innerHTML = '<option value="">-- 请选择 --</option>';
  users.forEach((u) => {
    const o1 = document.createElement('option'); o1.value = u.id; o1.textContent = u.display_name; reporter.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = u.id; o2.textContent = u.display_name; assignee.appendChild(o2);
  });
  if (users.length) reporter.value = users[0].id;

  try {
    const t = await api.getInspectionTasks();
    if (t.code === 0 && Array.isArray(t.data)) {
      const sel = document.getElementById('bugInspectionTask');
      t.data.forEach((task) => { const o = document.createElement('option'); o.value = task.id; o.textContent = task.name; sel.appendChild(o); });
    }
  } catch {}
  try {
    const m = await api.getFunctionModules();
    if (m.code === 0 && Array.isArray(m.data)) {
      const sel = document.getElementById('bugModule');
      m.data.forEach((mod) => { const o = document.createElement('option'); o.value = mod.id; o.textContent = mod.name; sel.appendChild(o); });
    }
  } catch {}
}

document.getElementById('btnBug').addEventListener('click', async () => {
  await loadFormData();
  const now = new Date();
  document.getElementById('bugTitle').value = `组合图BUG - ${now.toLocaleString('zh-CN', { hour12: false })}`;
  bugFormOverlay.classList.remove('hidden');
  api.setWindowLevel('normal');
});

document.getElementById('btnBugCancel').addEventListener('click', () => {
  bugFormOverlay.classList.add('hidden');
  api.setWindowLevel('screen-saver');
});

document.getElementById('btnBugSubmit').addEventListener('click', async () => {
  const title = document.getElementById('bugTitle').value.trim();
  const reporterId = parseInt(document.getElementById('bugReporter').value);
  if (!title) { showToastMsg('请填写标题'); return; }
  if (!reporterId) { showToastMsg('请选择录入人'); return; }

  const assigneeVal = document.getElementById('bugAssignee').value;
  const taskVal = document.getElementById('bugInspectionTask').value;
  const moduleVal = document.getElementById('bugModule').value;

  const btn = document.getElementById('btnBugSubmit');
  btn.disabled = true; btn.textContent = '提交中...';
  const statusEl = document.getElementById('submitStatus');

  const dataUrl = exportImage();
  try {
    const result = await api.submitBug({
      title,
      description: document.getElementById('bugDescription').value.trim(),
      bug_type: document.getElementById('bugType').value,
      priority: document.getElementById('bugPriority').value,
      reporter_id: reporterId,
      assignee_id: assigneeVal ? parseInt(assigneeVal) : reporterId,
      env_url: document.getElementById('bugEnvUrl').value.trim(),
      inspection_task_id: taskVal ? parseInt(taskVal) : null,
      module_id: moduleVal ? parseInt(moduleVal) : null,
      reproduction_steps: document.getElementById('bugReproductionSteps').value.trim(),
      imageDataUrl: dataUrl,
    });
    if (result.success) {
      statusEl.textContent = result.message || 'BUG录入成功';
      statusEl.className = 'submit-status';
      setTimeout(() => api.finish(), 1000);
    } else {
      statusEl.textContent = result.message || '提交失败';
      statusEl.className = 'submit-status error';
      btn.disabled = false; btn.textContent = '提交 BUG';
    }
    statusEl.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = '提交失败：' + (err.message || '网络错误');
    statusEl.className = 'submit-status error';
    statusEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = '提交 BUG';
  }
});
