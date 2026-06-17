/* record.js — 录屏控制窗口逻辑 */

const api = window.recordAPI;

const MAX_DURATION = 5 * 60; // 5 分钟（秒）

const state = {
  region: null,
  screenStream: null,
  canvas: null,
  ctx: null,
  video: null,
  rafId: null,
  recorder: null,
  chunks: [],
  startTime: 0,
  elapsedBeforePause: 0,
  paused: false,
  timerId: null,
  recordedBlob: null,
};

// DOM
const elStart = document.getElementById('btnStart');
const elPause = document.getElementById('btnPause');
const elStop = document.getElementById('btnStop');
const elTimer = document.getElementById('timer');
const elStatus = document.getElementById('status');
const elClose = document.getElementById('btnClose');
const elCtrlBar = document.getElementById('ctrlBar');
const elResultPanel = document.getElementById('resultPanel');
const elPreview = document.getElementById('preview');
const elResultStatus = document.getElementById('resultStatus');
const elBugFormOverlay = document.getElementById('bugFormOverlay');

// ============ 初始化：打开即自动开始录制 ============
(async function init() {
  state.region = await api.getRegion();
  if (!state.region) {
    elStatus.textContent = '未获取到录制区域';
    return;
  }
  beginRecording();
})();

// ============ 获取屏幕流 ============
async function getScreenStream() {
  // 优先使用 getDisplayMedia（由主进程处理器自动选择主屏）
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    return s;
  } catch (e) {
    // 回退到旧的 chromeMediaSource 方式
    const src = await api.getScreenSource();
    if (!src || !src.id) throw new Error('无法获取屏幕源');
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: src.id,
          minWidth: src.width,
          maxWidth: src.width,
          minHeight: src.height,
          maxHeight: src.height,
        },
      },
    });
  }
}

// ============ 开始录制 ============
async function beginRecording() {
  if (!state.region) { elStatus.textContent = '无录制区域'; return; }
  try {
    elStatus.textContent = '准备中...';
    state.screenStream = await getScreenStream();

    state.video = document.createElement('video');
    state.video.srcObject = state.screenStream;
    state.video.muted = true;
    await state.video.play();

    const r = state.region;
    state.canvas = document.createElement('canvas');
    state.canvas.width = r.w;
    state.canvas.height = r.h;
    state.ctx = state.canvas.getContext('2d');

    // 实际视频分辨率可能与屏幕物理像素有差异，按比例换算裁剪区域
    const track = state.screenStream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    const vidW = settings.width || (state.region.screenW || 0);
    const vidH = settings.height || (state.region.screenH || 0);
    const ratioX = (vidW && state.region.screenW) ? vidW / state.region.screenW : 1;
    const ratioY = (vidH && state.region.screenH) ? vidH / state.region.screenH : 1;
    const cropX = r.x * ratioX, cropY = r.y * ratioY, cropW = r.w * ratioX, cropH = r.h * ratioY;

    // 绘制循环：把整屏视频的区域裁剪到 canvas
    const draw = () => {
      if (state.video && state.video.readyState >= 2) {
        state.ctx.drawImage(state.video, cropX, cropY, cropW, cropH, 0, 0, r.w, r.h);
      }
      state.rafId = requestAnimationFrame(draw);
    };
    draw();

    const canvasStream = state.canvas.captureStream(30);
    let mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

    state.recorder = new MediaRecorder(canvasStream, { mimeType: mime });
    state.chunks = [];
    state.recorder.ondataavailable = (e) => { if (e.data.size > 0) state.chunks.push(e.data); };
    state.recorder.onstop = onRecordingStopped;
    state.recorder.start(1000);

    state.startTime = Date.now();
    state.elapsedBeforePause = 0;
    state.paused = false;
    startTimer();

    elStart.classList.add('hidden');
    elPause.classList.remove('hidden');
    elStop.classList.remove('hidden');
    elTimer.classList.remove('hidden');
    elStatus.textContent = '';
  } catch (err) {
    console.error('[Record] start failed', err);
    elStatus.textContent = '录制失败：请检查屏幕录制权限';
  }
}

// 保留手动开始按钮（兜底，正常不显示）
elStart.addEventListener('click', beginRecording);

// ============ 暂停/继续 ============
elPause.addEventListener('click', () => {
  if (!state.recorder) return;
  if (state.paused) {
    state.recorder.resume();
    state.paused = false;
    state.startTime = Date.now();
    elPause.textContent = '⏸';
    startTimer();
  } else {
    state.recorder.pause();
    state.paused = true;
    state.elapsedBeforePause += (Date.now() - state.startTime) / 1000;
    elPause.textContent = '▶';
    stopTimer();
  }
});

// ============ 停止 ============
elStop.addEventListener('click', () => stopRecording());

function stopRecording() {
  if (state.recorder && state.recorder.state !== 'inactive') {
    state.recorder.stop();
  }
  stopTimer();
  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.screenStream) state.screenStream.getTracks().forEach((t) => t.stop());
}

function onRecordingStopped() {
  state.recordedBlob = new Blob(state.chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(state.recordedBlob);
  elPreview.src = url;
  // 切换到结果面板，扩大窗口
  elCtrlBar.classList.add('hidden');
  elResultPanel.classList.remove('hidden');
  api.expand();
}

// ============ 计时 ============
function currentElapsed() {
  return state.elapsedBeforePause + (state.paused ? 0 : (Date.now() - state.startTime) / 1000);
}

function startTimer() {
  stopTimer();
  state.timerId = setInterval(() => {
    const sec = Math.floor(currentElapsed());
    elTimer.textContent = fmt(sec);
    if (sec >= MAX_DURATION) {
      elStatus.textContent = '已达 5 分钟上限';
      stopRecording();
    }
  }, 250);
}

function stopTimer() {
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ============ 关闭 / 放弃 ============
elClose.addEventListener('click', () => { stopRecording(); api.close(); });
document.getElementById('btnDiscard').addEventListener('click', () => api.close());

// ============ 保存到桌面 ============
document.getElementById('btnSave').addEventListener('click', async () => {
  if (!state.recordedBlob) return;
  elResultStatus.textContent = '处理中（转换 mp4）...';
  const buf = await state.recordedBlob.arrayBuffer();
  const res = await api.save(buf);
  if (res && res.success) {
    elResultStatus.textContent = '已保存';
  } else {
    elResultStatus.textContent = (res && res.message) || '保存失败';
  }
});

// ============ 录入 BUG ============
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
  document.getElementById('bugTitle').value = `录屏BUG - ${now.toLocaleString('zh-CN', { hour12: false })}`;
  elBugFormOverlay.classList.remove('hidden');
});

document.getElementById('btnBugCancel').addEventListener('click', () => {
  elBugFormOverlay.classList.add('hidden');
});

document.getElementById('btnBugSubmit').addEventListener('click', async () => {
  const title = document.getElementById('bugTitle').value.trim();
  const reporterId = parseInt(document.getElementById('bugReporter').value);
  if (!title) { setSubmit('请填写标题', true); return; }
  if (!reporterId) { setSubmit('请选择录入人', true); return; }
  if (!state.recordedBlob) { setSubmit('无录制内容', true); return; }

  const btn = document.getElementById('btnBugSubmit');
  btn.disabled = true; btn.textContent = '提交中...';
  setSubmit('处理中（转换 mp4 并上传）...', false);

  const assigneeVal = document.getElementById('bugAssignee').value;
  const taskVal = document.getElementById('bugInspectionTask').value;
  const moduleVal = document.getElementById('bugModule').value;
  const buf = await state.recordedBlob.arrayBuffer();

  try {
    const res = await api.submitBug({
      webm: buf,
      title,
      description: document.getElementById('bugDescription').value.trim(),
      bug_type: document.getElementById('bugType').value,
      priority: document.getElementById('bugPriority').value,
      reporter_id: reporterId,
      assignee_id: assigneeVal ? parseInt(assigneeVal) : reporterId,
      inspection_task_id: taskVal ? parseInt(taskVal) : null,
      module_id: moduleVal ? parseInt(moduleVal) : null,
    });
    if (res && res.success) {
      setSubmit(res.message || 'BUG录入成功', false);
      // 主进程会关闭窗口
    } else {
      setSubmit((res && res.message) || '提交失败', true);
      btn.disabled = false; btn.textContent = '提交 BUG';
    }
  } catch (err) {
    setSubmit('提交失败：' + (err.message || '网络错误'), true);
    btn.disabled = false; btn.textContent = '提交 BUG';
  }
});

function setSubmit(msg, isError) {
  const el = document.getElementById('submitStatus');
  el.textContent = msg;
  el.className = 'submit-status' + (isError ? ' error' : '');
  el.classList.remove('hidden');
}
