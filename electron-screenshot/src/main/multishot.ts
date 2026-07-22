import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

// ============================================================
// 多图状态管理 — 主进程内存中的图片集合（最多 10 张）
// ============================================================

const MAX_IMAGES = 10;
let images: string[] = [];
let imageTextInfo: { hasText: boolean; textContent: string }[] = [];
let selectedIndices: number[] = [];

let stackWindow: BrowserWindow | null = null;
let combineWindow: BrowserWindow | null = null;

export function getMaxImages(): number {
  return MAX_IMAGES;
}

export function getCount(): number {
  return images.length;
}

export function getImages(): string[] {
  return images.slice();
}

export function getTextInfo(): { hasText: boolean; textContent: string }[] {
  return imageTextInfo.slice();
}

export function addImage(
  dataUrl: string,
  hasText = false,
  textContent = ''
): { ok: boolean; count: number; reason?: string } {
  if (images.length >= MAX_IMAGES) {
    return { ok: false, count: images.length, reason: 'limit' };
  }
  images.push(dataUrl);
  imageTextInfo.push({ hasText, textContent });
  return { ok: true, count: images.length };
}

export function removeImage(index: number): number {
  if (index >= 0 && index < images.length) {
    images.splice(index, 1);
    imageTextInfo.splice(index, 1);
    selectedIndices = selectedIndices
      .filter(i => i !== index)
      .map(i => (i > index ? i - 1 : i));
  }
  return images.length;
}

export function clearImages(): void {
  images = [];
  imageTextInfo = [];
  selectedIndices = [];
}

export function setCombineSelected(indices: number[]): void {
  selectedIndices = [...indices];
}

export function getCombineSelected(): number[] {
  return selectedIndices.slice();
}

export function getSelectedImageDataUrls(): string[] {
  return selectedIndices
    .filter(i => i >= 0 && i < images.length)
    .map(i => images[i]);
}

export function replaceImage(index: number, dataUrl: string, hasText = false, textContent = ''): boolean {
  if (index < 0 || index >= images.length) return false;
  images[index] = dataUrl;
  imageTextInfo[index] = { hasText, textContent };
  return true;
}

// ============================================================
// 暂存小窗管理
// ============================================================

export function showStackWindow(): void {
  if (stackWindow && !stackWindow.isDestroyed()) {
    stackWindow.show();
    stackWindow.focus();
    updateStackWindow();
    return;
  }

  const primary = screen.getPrimaryDisplay();
  const { width: areaW, height: areaH, x: areaX, y: areaY } = primary.workArea;
  const winW = 230;
  const winH = 420;
  // 定位到工作区右下角，留 16px 边距
  const x = areaX + areaW - winW - 16;
  const y = areaY + areaH - winH - 16;

  stackWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  if (process.platform === 'darwin') {
    stackWindow.setAlwaysOnTop(true, 'floating');
  }
  stackWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const htmlPath = path.join(__dirname, '../renderer/stack/index.html');
  stackWindow.loadURL('file://' + encodeURI(htmlPath));

  stackWindow.webContents.on('did-finish-load', () => {
    updateStackWindow();
  });

  stackWindow.on('closed', () => {
    stackWindow = null;
  });
}

export function updateStackWindow(): void {
  if (stackWindow && !stackWindow.isDestroyed()) {
    stackWindow.webContents.send('multishot:list-updated', images, imageTextInfo);
  }
}

export function showToastToStack(msg: string, duration?: number): void {
  if (stackWindow && !stackWindow.isDestroyed()) {
    stackWindow.webContents.send('multishot:show-toast', msg, duration);
  }
}

export function closeStackWindow(): void {
  if (stackWindow && !stackWindow.isDestroyed()) {
    stackWindow.destroy();
  }
  stackWindow = null;
}

// ============================================================
// 组合编辑器窗口管理
// ============================================================

export function openCombineWindow(): void {
  if (combineWindow && !combineWindow.isDestroyed()) {
    combineWindow.show();
    combineWindow.focus();
    return;
  }

  const primary = screen.getPrimaryDisplay();
  const { width: areaW, height: areaH } = primary.workArea;
  const winW = Math.min(1200, Math.round(areaW * 0.9));
  const winH = Math.min(820, Math.round(areaH * 0.9));

  combineWindow = new BrowserWindow({
    width: winW,
    height: winH,
    titleBarStyle: 'hiddenInset',
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    movable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  if (process.platform === 'darwin') {
    combineWindow.setAlwaysOnTop(true, 'floating');
  }
  combineWindow.center();

  const htmlPath = path.join(__dirname, '../renderer/combine/index.html');
  combineWindow.loadURL('file://' + encodeURI(htmlPath));

  combineWindow.on('closed', () => {
    combineWindow = null;
  });
}

export function closeCombineWindow(): void {
  if (combineWindow && !combineWindow.isDestroyed()) {
    combineWindow.destroy();
  }
  combineWindow = null;
}

// 组合编辑器窗口层级控制（文字输入时取消置顶以显示输入法）
export function setCombineAlwaysOnTop(value: boolean): void {
  if (combineWindow && !combineWindow.isDestroyed()) {
    if (value) {
      combineWindow.setAlwaysOnTop(true, 'floating');
    } else {
      combineWindow.setAlwaysOnTop(false);
    }
  }
}
