import { BrowserWindow, screen, desktopCapturer } from 'electron';
import * as path from 'path';

let recordWindow: BrowserWindow | null = null;
let pendingRegion: { x: number; y: number; w: number; h: number; screenW: number; screenH: number } | null = null;

export function getPendingRegion() {
  return pendingRegion;
}

// 打开录屏控制窗口，传入框选区域（物理像素）
export function openRecordWindow(region: { x: number; y: number; w: number; h: number; screenW: number; screenH: number }) {
  pendingRegion = region;

  if (recordWindow && !recordWindow.isDestroyed()) {
    recordWindow.focus();
    return;
  }

  const primary = screen.getPrimaryDisplay();
  const { width: areaW, x: areaX, y: areaY } = primary.workArea;
  const winW = 360;
  const winH = 64;
  // 顶部居中
  const x = Math.round(areaX + (areaW - winW) / 2);
  const y = areaY + 12;

  recordWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  if (process.platform === 'darwin') {
    recordWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  recordWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const htmlPath = path.join(__dirname, '../renderer/record/index.html');
  recordWindow.loadURL('file://' + encodeURI(htmlPath));

  recordWindow.on('closed', () => {
    recordWindow = null;
    pendingRegion = null;
  });
}

export function closeRecordWindow() {
  if (recordWindow && !recordWindow.isDestroyed()) {
    recordWindow.destroy();
  }
  recordWindow = null;
}

// 录制完成后扩大窗口以显示预览与保存/录入操作
export function expandRecordWindow() {
  if (recordWindow && !recordWindow.isDestroyed()) {
    const primary = screen.getPrimaryDisplay();
    const { width: areaW, height: areaH, x: areaX, y: areaY } = primary.workArea;
    const winW = 460;
    const winH = 220;
    recordWindow.setBounds({
      x: Math.round(areaX + (areaW - winW) / 2),
      y: areaY + 12,
      width: winW,
      height: winH,
    });
    recordWindow.setIgnoreMouseEvents(false);
  }
}

// 获取主屏幕采集源（供渲染层 getUserMedia 使用）
export async function getPrimaryScreenSource() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const scaleFactor = primary.scaleFactor;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
  });
  // 选择主屏
  const source = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
  return {
    id: source ? source.id : null,
    width: Math.round(width * scaleFactor),
    height: Math.round(height * scaleFactor),
  };
}

// 录制时控制窗口层级（避免出现在录制区域内时遮挡）
export function setRecordWindowVisible(visible: boolean) {
  if (recordWindow && !recordWindow.isDestroyed()) {
    if (visible) recordWindow.show();
    else recordWindow.hide();
  }
}
