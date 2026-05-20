import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, screen, Notification } from 'electron';
import * as path from 'path';
import { takeScreenshot } from './screenshot';
import { setupIpcHandlers } from './ipc-handlers';
import { toggleBugViewer, setViewerAlwaysOnTop } from './bug-viewer-window';

// Single instance lock - MUST be called before app.whenReady
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let screenshotWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let screenshotInProgress = false;  // guard against concurrent calls

const API_BASE = 'http://127.0.0.1:8000/api/v1';

// Prevent Electron from showing its default "A JavaScript error occurred in the main process" dialog
// Log errors to console instead
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

function createTray() {
  // Load tray icon from assets
  const iconPath = path.join(__dirname, '../assets/tray-icon.png');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    // Mark as template image so macOS adapts it to light/dark menu bar automatically
    icon.setTemplateImage(true);
  } catch {
    // Fallback to embedded icon if file not found
    icon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwQAADsEBuJFr7QAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC4xNkRpr/UAAAB5SURBVDhPxZDRDYAgDERxBEdxFEdxFEdxFEdwBN6gKGhiKN6lU+Gee7OXYmYHQPy/JvlZR0YAGMBqgAL0p4MWWGsB1lpvML8GGmCtBdhqgQXWYsCaBNZigLUG2GqBBVZiwJoE1mKAtQbYaoEFVmLAmgTWYoC1BthqgQVWYsCaBNZigLUG2IDaLwI/0gJ8LwAAAABJRU5ErkJggg==',
        'base64'
      )
    );
  }

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '截图 (Ctrl+Shift+A)', click: () => startScreenshot() },
    { label: '打开 BUG 查看器', click: () => toggleBugViewer() },
    { type: 'separator' },
    { label: '打开管理页面', click: () => {
      const { shell } = require('electron');
      shell.openExternal('http://localhost:5173');
    }},
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);

  tray.setToolTip('BUG截图工具');
  tray.setContextMenu(contextMenu);
  // macOS: single click shows context menu (no screenshot on click to avoid accidental trigger)
  if (process.platform === 'darwin') {
    tray.on('click', () => tray!.popUpContextMenu());
  }
}

function showNotification(title: string, body: string) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch {
    // Fallback: just log
    console.error(`[Notification] ${title}: ${body}`);
  }
}

async function startScreenshot() {
  if (screenshotWindow) {
    screenshotWindow.focus();
    return;
  }
  if (screenshotInProgress) return;
  screenshotInProgress = true;

  try {
    console.log('[Screenshot] Starting screenshot capture...');
    // Temporarily lower viewer window so it doesn't block screenshot annotation
    setViewerAlwaysOnTop(false);
    const imageData = await takeScreenshot();
    if (!imageData) {
      console.error('[Screenshot] Failed to capture screen. Check screen recording permission.');
      showNotification('截图失败', '无法捕获屏幕图像，请检查屏幕录制权限。');
      setViewerAlwaysOnTop(true);
      screenshotInProgress = false;
      return;
    }

    console.log('[Screenshot] Capture success, creating window...');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    screenshotWindow = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      // IMPORTANT: Do NOT use kiosk/fullscreen on macOS, it will lock the screen
      fullscreen: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/index.js'),
      },
    });

    // 在 macOS 上使用 screen-saver 层级，可覆盖菜单栏和 Dock
    if (process.platform === 'darwin') {
      screenshotWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    screenshotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 设置完层级后再精确定位到全屏（含菜单栏），y:0 确保从最顶部开始
    screenshotWindow.setBounds({ x: 0, y: 0, width, height });
    screenshotWindow.show();

    const htmlPath = path.join(__dirname, '../renderer/index.html');
    screenshotWindow.loadURL('file://' + encodeURI(htmlPath));
    screenshotWindow.webContents.on('did-finish-load', () => {
      console.log('[Screenshot] Window loaded, sending image data...');
      screenshotWindow?.webContents.send('screenshot:start', imageData);
    });

    // Safety timeout: auto-close after 60s to prevent being stuck
    // Can be extended via 'screenshot:extend-timeout' IPC when bug form is open
    let safetyTimer = setTimeout(() => {
      if (screenshotWindow) {
        console.log('[Screenshot] Safety timeout - auto closing');
        screenshotWindow.destroy();
        screenshotWindow = null;
      }
    }, 60000);

    // Allow renderer to extend the timeout (e.g. when bug form overlay is open)
    const { ipcMain } = require('electron');
    const extendHandler = () => {
      clearTimeout(safetyTimer);
      safetyTimer = setTimeout(() => {
        if (screenshotWindow) {
          console.log('[Screenshot] Extended safety timeout - auto closing');
          screenshotWindow.destroy();
          screenshotWindow = null;
        }
      }, 10 * 60 * 1000); // 10 minutes
    };
    ipcMain.on('screenshot:extend-timeout', extendHandler);

    screenshotWindow.on('closed', () => {
      clearTimeout(safetyTimer);
      ipcMain.removeListener('screenshot:extend-timeout', extendHandler);
      screenshotWindow = null;
      screenshotInProgress = false;
      // Restore viewer always-on-top after screenshot window closes
      setViewerAlwaysOnTop(true);
    });

    // Open devtools for debugging (remove in production)
    // screenshotWindow.webContents.openDevTools({ mode: 'detach' });
  } catch (err) {
    console.error('[Screenshot] Error:', err);
    showNotification('截图错误', String(err));
    screenshotInProgress = false;
    setViewerAlwaysOnTop(true);
  }
}

function registerShortcut() {
  const ret = globalShortcut.register('CommandOrControl+Shift+A', () => {
    console.log('[Shortcut] Ctrl+Shift+A triggered');
    startScreenshot();
  });
  if (!ret) {
    console.error('[Shortcut] Global shortcut registration failed - may be in use by another app');
  } else {
    console.log('[Shortcut] Ctrl+Shift+A registered successfully');
  }
}

app.whenReady().then(() => {
  createTray();
  registerShortcut();
  setupIpcHandlers(API_BASE);

  // Hidden main window to keep app running
  mainWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.on('close', (e) => {
    e.preventDefault();
  });

  // Log screen recording permission status (no blocking dialog)
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    const status = systemPreferences.getMediaAccessStatus('screen');
    console.log(`[Permission] Screen recording status: ${status}`);
    if (status !== 'granted') {
      console.warn('[Permission] Screen recording not granted. Screenshot may fail.');
      console.warn('[Permission] Go to: System Preferences → Privacy & Security → Screen Recording');
    }
  }

  console.log('[App] BUG截图工具已启动，按 Ctrl+Shift+A 截图');
});

app.on('before-quit', () => {
  // 强制销毁所有窗口，确保 app.quit() 能顺利完成
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.destroy();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running in tray mode
});
