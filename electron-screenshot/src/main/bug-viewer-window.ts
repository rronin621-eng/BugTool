import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

let viewerWindow: BrowserWindow | null = null;

// Register IPC handler for renderer to toggle always-on-top
ipcMain.removeHandler('viewer:set-always-on-top');
ipcMain.handle('viewer:set-always-on-top', (_event, value: boolean) => {
  setViewerAlwaysOnTop(value);
});

export function toggleBugViewer() {
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    if (viewerWindow.isVisible()) {
      viewerWindow.hide();
    } else {
      viewerWindow.show();
      viewerWindow.focus();
    }
    return;
  }

  viewerWindow = new BrowserWindow({
    width: 480,
    height: 600,
    minWidth: 360,
    minHeight: 400,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  viewerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const htmlPath = path.join(__dirname, '../renderer/viewer/index.html');
  viewerWindow.loadURL('file://' + encodeURI(htmlPath));


  viewerWindow.on('closed', () => {
    viewerWindow = null;
  });
}

export function setViewerAlwaysOnTop(value: boolean) {
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.setAlwaysOnTop(value);
  }
}
