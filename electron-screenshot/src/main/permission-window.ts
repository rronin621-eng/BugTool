import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

let permissionWindow: BrowserWindow | null = null;

export function openPermissionWindow(): BrowserWindow {
  if (permissionWindow && !permissionWindow.isDestroyed()) {
    permissionWindow.show();
    permissionWindow.focus();
    return permissionWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const width = 520;
  const height = 380;
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + (workArea.height - height) / 2);

  permissionWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    title: '权限设置',
    titleBarStyle: 'hiddenInset',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  const htmlPath = path.join(__dirname, '../renderer/permission.html');
  permissionWindow.loadURL('file://' + encodeURI(htmlPath));

  permissionWindow.once('ready-to-show', () => {
    permissionWindow?.show();
    permissionWindow?.focus();
  });

  permissionWindow.on('closed', () => {
    permissionWindow = null;
  });

  return permissionWindow;
}

export function closePermissionWindow(): void {
  if (permissionWindow && !permissionWindow.isDestroyed()) {
    permissionWindow.destroy();
  }
  permissionWindow = null;
}

export function isPermissionWindowOpen(): boolean {
  return permissionWindow !== null && !permissionWindow.isDestroyed();
}
