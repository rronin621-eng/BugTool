import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, screen, Notification, ipcMain } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import { takeScreenshots, DisplayScreenshot } from './screenshot';
import { setupIpcHandlers } from './ipc-handlers';
import { toggleBugViewer, setViewerAlwaysOnTop } from './bug-viewer-window';
import { registerScreenshotWindow, destroyAllScreenshotWindows, getScreenshotWindowCount } from './screenshot-registry';
import { loadShortcutConfig, saveShortcutConfig, getDefaultShortcutConfig, displayAccelerator } from './shortcut-config';
import { openSettingsWindow } from './settings-window';
import {
  getAllPermissions,
  getMissingPermissions,
  allRequiredPermissionsGranted,
  openSystemPreferences,
  requestScreenRecording,
  requestAccessibility,
} from './permission-checker';
import { openPermissionWindow, closePermissionWindow, isPermissionWindowOpen } from './permission-window';

// Single instance lock - MUST be called before app.whenReady
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let screenshotWindow: BrowserWindow | null = null;  // primary/active window for IPC (set-level, extend-timeout)
let tray: Tray | null = null;
let screenshotInProgress = false;  // guard against concurrent calls
let backendProc: ChildProcess | null = null;  // 打包模式下拉起的后端进程

const API_BASE = 'http://127.0.0.1:8000/api/v1';

// ── 后端服务管理（仅打包模式）─────────────────────────
function startBackend(): void {
  if (!app.isPackaged) {
    // 开发模式：后端由外部 uvicorn / start.sh 启动，这里不处理
    console.log('[Backend] dev mode, backend managed externally');
    return;
  }
  const resources = process.resourcesPath;
  const backendBin = path.join(resources, 'backend', 'bugtool-server');
  const userData = app.getPath('userData');
  const webDist = path.join(resources, 'web-dist');

  console.log(`[Backend] spawning: ${backendBin}`);
  backendProc = spawn(backendBin, [], {
    env: {
      ...process.env,
      BUGTOOL_DATA_DIR: userData,
      BUGTOOL_WEB_DIST: webDist,
      BUGTOOL_PORT: '8000',
    },
    stdio: 'ignore',
  });
  backendProc.on('error', (err) => console.error('[Backend] spawn error:', err));
  backendProc.on('exit', (code) => console.log(`[Backend] exited: ${code}`));
}

function stopBackend(): void {
  if (backendProc && !backendProc.killed) {
    try { backendProc.kill(); } catch {}
    backendProc = null;
  }
}

// 轮询后端 health，直到就绪或超时
function waitForBackend(timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get('http://127.0.0.1:8000/api/v1/health', (res) => {
        res.resume();
        if (res.statusCode === 200) { resolve(true); return; }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1500, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

// Prevent Electron from showing its default "A JavaScript error occurred in the main process" dialog
// Log errors to console instead
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason: any) => {
  const msg = String(reason?.message || reason);
  // Playwright 连接已运行的 Chrome 时，某些扩展的 service worker 会触发内部断言，不影响实际自动化
  if (msg.includes('"type": "service_worker"') || msg.includes('service_worker')) {
    console.warn('[DMP-Browser] 忽略 Chrome service worker 内部事件');
    return;
  }
  console.error('[Main] Unhandled rejection:', reason);
});

function buildTrayMenu() {
  const accel = getRegisteredAccelerator();
  return Menu.buildFromTemplate([
    { label: `截图 (${displayAccelerator(accel)})`, click: () => startScreenshot() },
    { label: '打开 BUG 查看器', click: () => toggleBugViewer() },
    { type: 'separator' },
    { label: '快捷键设置...', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: '打开管理页面', click: () => {
      const { shell } = require('electron');
      shell.openExternal(app.isPackaged ? 'http://127.0.0.1:8000' : 'http://localhost:5173');
    }},
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

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
  tray.setToolTip('BUG截图工具');
  tray.setContextMenu(buildTrayMenu());
  // macOS: single click shows context menu (no screenshot on click to avoid accidental trigger)
  if (process.platform === 'darwin') {
    tray.on('click', () => tray!.popUpContextMenu());
  }
}

function updateTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu());
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

function broadcastPermissionStatus() {
  const permissions = getAllPermissions();
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('permission:update', permissions);
    }
  });
}

function setupPermissionIpc() {
  ipcMain.handle('permission:get-status', () => {
    return getAllPermissions();
  });

  ipcMain.handle('permission:open-preferences', (_event, type: string) => {
    if (type === 'screen' || type === 'accessibility') {
      openSystemPreferences(type);
    }
  });

  ipcMain.handle('permission:request', (_event, type: string) => {
    if (type === 'screen') {
      const granted = requestScreenRecording();
      broadcastPermissionStatus();
      return granted;
    }
    if (type === 'accessibility') {
      const granted = requestAccessibility();
      broadcastPermissionStatus();
      return granted;
    }
    return false;
  });
}

async function startScreenshot() {
  if (getScreenshotWindowCount() > 0 || screenshotWindow) {
    screenshotWindow?.focus();
    return;
  }
  if (screenshotInProgress) return;

  // 截图前强制检查屏幕录制权限
  if (!allRequiredPermissionsGranted()) {
    openPermissionWindow();
    return;
  }

  screenshotInProgress = true;

  try {
    console.log('[Screenshot] Starting screenshot capture...');
    // Temporarily lower viewer window so it doesn't block screenshot annotation
    setViewerAlwaysOnTop(false);
    const displayShots = await takeScreenshots();
    if (!displayShots || displayShots.length === 0) {
      console.error('[Screenshot] Failed to capture screen. Check screen recording permission.');
      showNotification('截图失败', '无法捕获屏幕图像，请检查屏幕录制权限。');
      setViewerAlwaysOnTop(true);
      screenshotInProgress = false;
      return;
    }

    console.log(`[Screenshot] Capture success for ${displayShots.length} display(s), creating windows...`);

    const { ipcMain } = require('electron');

    let safetyTimer = setTimeout(() => {
      console.log('[Screenshot] Safety timeout - auto closing all windows');
      destroyAllScreenshotWindows();
      screenshotWindow = null;
      screenshotInProgress = false;
      setViewerAlwaysOnTop(true);
    }, 60000);

    const extendHandler = () => {
      clearTimeout(safetyTimer);
      safetyTimer = setTimeout(() => {
        console.log('[Screenshot] Extended safety timeout - auto closing');
        destroyAllScreenshotWindows();
        screenshotWindow = null;
        screenshotInProgress = false;
        setViewerAlwaysOnTop(true);
      }, 10 * 60 * 1000);
    };

    const setLevelHandler = (_event: any, level: string) => {
      // Apply to the active (first/primary) screenshot window
      const win = screenshotWindow;
      if (win && !win.isDestroyed()) {
        if (level === 'normal') {
          win.setAlwaysOnTop(false);
        } else {
          win.setAlwaysOnTop(true, 'screen-saver');
        }
      }
    };

    const FORM_WIDTH = 1050;
    const FORM_HEIGHT = 640;
    let formModeOriginalBounds: Electron.Rectangle | null = null;

    const enterFormModeHandler = () => {
      const win = screenshotWindow;
      if (!win || win.isDestroyed()) return;

      // 关闭其他显示器的截图窗口，只保留当前弹窗窗口
      for (const w of allWins) {
        if (w !== win && !w.isDestroyed()) {
          w.close();
        }
      }

      formModeOriginalBounds = win.getBounds();
      const { screen } = require('electron');
      const display = screen.getDisplayMatching(formModeOriginalBounds);
      const workArea = display.workArea;
      const x = Math.round(workArea.x + (workArea.width - FORM_WIDTH) / 2);
      const y = Math.round(workArea.y + (workArea.height - FORM_HEIGHT) / 2);

      win.setBounds({ x, y, width: FORM_WIDTH, height: FORM_HEIGHT });
      win.setAlwaysOnTop(false);
      win.setResizable(true);
      win.setMovable(true);
      win.setMinimizable(true);
      win.setMaximizable(true);
      win.setSkipTaskbar(false);
      win.setVisibleOnAllWorkspaces(false);
      win.focus();
      console.log('[Screenshot] Entered form mode');
    };

    const exitFormModeHandler = () => {
      const win = screenshotWindow;
      if (!win || win.isDestroyed()) return;
      if (formModeOriginalBounds) {
        win.setBounds(formModeOriginalBounds);
      }
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setResizable(false);
      win.setMovable(false);
      win.setMinimizable(false);
      win.setMaximizable(false);
      win.setSkipTaskbar(true);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      formModeOriginalBounds = null;
      console.log('[Screenshot] Exited form mode');
    };

    ipcMain.on('screenshot:extend-timeout', extendHandler);
    ipcMain.on('screenshot:set-level', setLevelHandler);
    ipcMain.on('screenshot:enter-form-mode', enterFormModeHandler);
    ipcMain.on('screenshot:exit-form-mode', exitFormModeHandler);

    // Track how many windows have finished closing
    let closedCount = 0;
    const onWindowClosed = () => {
      closedCount++;
      if (closedCount >= displayShots.length) {
        // All windows closed — clean up IPC listeners
        clearTimeout(safetyTimer);
        ipcMain.removeListener('screenshot:extend-timeout', extendHandler);
        ipcMain.removeListener('screenshot:set-level', setLevelHandler);
        ipcMain.removeListener('screenshot:enter-form-mode', enterFormModeHandler);
        ipcMain.removeListener('screenshot:exit-form-mode', exitFormModeHandler);
        screenshotWindow = null;
        screenshotInProgress = false;
        setViewerAlwaysOnTop(true);
      }
    };

    const htmlPath = path.join(__dirname, '../renderer/index.html');
    const allWins: BrowserWindow[] = [];

    // Create one overlay window per display
    for (const shot of displayShots) {
      const { bounds, imageData } = shot;

      const win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreen: false,
        hasShadow: false,
        enableLargerThanScreen: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/index.js'),
        },
      });

      if (process.platform === 'darwin') {
        win.setAlwaysOnTop(true, 'screen-saver');
      }
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
      win.show();

      win.loadURL('file://' + encodeURI(htmlPath));
      win.webContents.on('did-finish-load', () => {
        console.log(`[Screenshot] Window for display ${shot.displayIndex} loaded, sending image...`);
        win.webContents.send('screenshot:start', imageData);
      });

      win.on('closed', onWindowClosed);

      registerScreenshotWindow(win);
      allWins.push(win);
    }

    // screenshotWindow points to the primary window for IPC like set-level / extend-timeout
    screenshotWindow = allWins[0] ?? null;

  } catch (err) {
    console.error('[Screenshot] Error:', err);
    showNotification('截图错误', String(err));
    screenshotInProgress = false;
    setViewerAlwaysOnTop(true);
  }
}

let registeredAccelerator = '';
let appInitializationFinished = false;

function registerShortcut(accelerator: string) {
  globalShortcut.unregisterAll();
  registeredAccelerator = '';

  const ret = globalShortcut.register(accelerator, () => {
    console.log(`[Shortcut] ${accelerator} triggered`);
    startScreenshot();
  });
  if (!ret) {
    console.error(`[Shortcut] Global shortcut ${accelerator} registration failed - may be in use by another app`);
    new Notification({ title: 'BUG工具', body: `快捷键 ${displayAccelerator(accelerator)} 注册失败，可能已被其他应用占用。` }).show();
  } else {
    registeredAccelerator = accelerator;
    console.log(`[Shortcut] ${accelerator} registered successfully`);
  }
}

function getRegisteredAccelerator(): string {
  return registeredAccelerator || getDefaultShortcutConfig().accelerator;
}

function finishAppInitialization() {
  if (appInitializationFinished) return;
  appInitializationFinished = true;

  createTray();
  const shortcutConfig = loadShortcutConfig();
  registerShortcut(shortcutConfig.accelerator);

  // 快捷键设置 IPC
  ipcMain.handle('settings:get-shortcut', () => {
    return getRegisteredAccelerator();
  });
  ipcMain.handle('settings:get-default-shortcut', () => {
    return getDefaultShortcutConfig().accelerator;
  });
  ipcMain.handle('settings:save-shortcut', (_event, accelerator: string) => {
    try {
      saveShortcutConfig({ accelerator });
      registerShortcut(accelerator);
      updateTrayMenu();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || '保存失败' };
    }
  });

  console.log('[Main] 开始注册 IPC handlers...');
  try {
    setupIpcHandlers(API_BASE);
    console.log('[Main] IPC handlers 注册完成');
  } catch (err: any) {
    console.error('[Main] IPC handlers 注册失败:', err);
    new Notification({ title: 'BUG工具', body: '内部通信初始化失败：' + err.message }).show();
  }

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

  console.log(`[App] BUG截图工具已启动，按 ${displayAccelerator(getRegisteredAccelerator())} 截图`);

  // 注册屏幕采集处理器：录屏时 getDisplayMedia 自动选择主屏
  const { session, desktopCapturer } = require('electron');
  session.defaultSession.setDisplayMediaRequestHandler((_request: any, callback: any) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources: any[]) => {
      const primary = screen.getPrimaryDisplay();
      const source = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
      callback({ video: source, audio: false });
    }).catch(() => {
      callback({});
    });
  });
}

async function ensurePermissionsThenInit() {
  // 非 macOS 平台无需检查这些权限
  if (process.platform !== 'darwin') {
    finishAppInitialization();
    return;
  }

  setupPermissionIpc();

  if (allRequiredPermissionsGranted()) {
    finishAppInitialization();
    return;
  }

  const missing = getMissingPermissions();
  console.warn('[Permission] 缺少必要权限:', missing.map((p) => p.name).join(', '));

  const win = openPermissionWindow();

  const onContinue = () => {
    closePermissionWindow();
    finishAppInitialization();
  };

  ipcMain.once('permission:continue', onContinue);

  // 如果用户直接关闭权限窗口，根据当前权限状态决定继续初始化还是退出应用
  win.on('closed', () => {
    ipcMain.removeListener('permission:continue', onContinue);
    if (allRequiredPermissionsGranted()) {
      finishAppInitialization();
    } else {
      console.log('[Permission] 用户关闭权限窗口且权限未授予，应用退出');
      app.quit();
    }
  });
}

app.whenReady().then(async () => {
  // 打包模式：先拉起内置后端并等待就绪
  startBackend();
  if (app.isPackaged) {
    const ok = await waitForBackend();
    if (!ok) {
      console.error('[Backend] failed to become ready');
      new Notification({ title: 'BUG工具', body: '后端服务启动失败，请重试或联系支持。' }).show();
    }
  }

  await ensurePermissionsThenInit();
});

app.on('before-quit', () => {
  // 关闭内置后端进程
  stopBackend();
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
