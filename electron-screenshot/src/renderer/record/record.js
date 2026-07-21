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

