import { BrowserWindow, screen } from 'electron';

let toastWindow: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;

const TOAST_W = 420;
const TOAST_H = 48;

/**
 * 屏幕偏下方居中显示 toast 提示，持续 duration 毫秒后自动隐藏。
 */
export function showToastWindow(msg: string, duration: number = 3000): void {
  const primary = screen.getPrimaryDisplay();
  const { width: areaW, height: areaH, x: areaX, y: areaY } = primary.workArea;
  const x = Math.round(areaW / 2 - TOAST_W / 2 + areaX);
  const y = Math.round(areaH - TOAST_H - 80 + areaY);

  const html = `<html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; overflow: hidden; }
    #toast {
      display: flex; align-items: center; justify-content: center;
      height: 100%; padding: 0 24px;
      background: rgba(30, 30, 30, 0.92);
      color: #fff; font-size: 14px; font-family: -apple-system, "PingFang SC", sans-serif;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      opacity: 1; transition: opacity 0.2s ease;
    }
    #toast.hidden { opacity: 0; }
  </style></head><body><div id="toast"></div></body></html>`;

  if (!toastWindow || toastWindow.isDestroyed()) {
    toastWindow = new BrowserWindow({
      width: TOAST_W,
      height: TOAST_H,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    toastWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    toastWindow.on('closed', () => { toastWindow = null; });
  } else {
    toastWindow.setPosition(x, y);
  }

  // 清除上一次的隐藏定时器
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  const showJs = `var el = document.getElementById('toast'); el.textContent = ${JSON.stringify(msg)}; el.classList.remove('hidden');`;

  const doShow = () => {
    if (!toastWindow || toastWindow.isDestroyed()) return;
    toastWindow.webContents.executeJavaScript(showJs);
    if (!toastWindow.isVisible()) {
      toastWindow.showInactive();
    }
  };

  if (toastWindow.webContents.isLoading()) {
    toastWindow.webContents.once('did-finish-load', doShow);
  } else {
    doShow();
  }

  // duration 毫秒后淡出隐藏
  hideTimer = setTimeout(() => {
    if (toastWindow && !toastWindow.isDestroyed()) {
      toastWindow.webContents.executeJavaScript('document.getElementById("toast").classList.add("hidden");');
      setTimeout(() => {
        if (toastWindow && !toastWindow.isDestroyed()) {
          toastWindow.hide();
        }
      }, 250);
    }
  }, duration);
}

export function closeToastWindow(): void {
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.destroy();
  }
  toastWindow = null;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}
