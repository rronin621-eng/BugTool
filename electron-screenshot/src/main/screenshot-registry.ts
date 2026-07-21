/**
 * Shared registry for tracking active screenshot overlay windows.
 * This avoids circular imports between index.ts and ipc-handlers.ts.
 */
import { BrowserWindow } from 'electron';

const _windows: Set<BrowserWindow> = new Set();

export function registerScreenshotWindow(win: BrowserWindow) {
  _windows.add(win);
  win.on('closed', () => _windows.delete(win));
}

export function unregisterScreenshotWindow(win: BrowserWindow) {
  _windows.delete(win);
}

/**
 * Destroy all currently tracked screenshot overlay windows.
 * Safe to call multiple times — already-destroyed windows are ignored.
 */
export function destroyAllScreenshotWindows() {
  const wins = [..._windows];
  _windows.clear();
  for (const w of wins) {
    if (!w.isDestroyed()) w.destroy();
  }
}

export function getScreenshotWindowCount() {
  return _windows.size;
}
