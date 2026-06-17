import { screen } from 'electron';
import { execFile } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export async function takeScreenshot(): Promise<string | null> {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    const scaleFactor = primaryDisplay.scaleFactor;

    console.log(`[Screenshot] Display: ${width}x${height}, scale: ${scaleFactor}`);

    if (process.platform === 'darwin') {
      // Use macOS native screencapture command - much more reliable than desktopCapturer
      return await macScreenCapture();
    } else {
      // Fallback to desktopCapturer for other platforms
      return await desktopCapturerFallback(width, height, scaleFactor);
    }
  } catch (err) {
    console.error('[Screenshot] takeScreenshot error:', err);
    return null;
  }
}

async function macScreenCapture(): Promise<string | null> {
  const tmpFile = path.join(os.tmpdir(), `bug-screenshot-${Date.now()}.png`);

  return new Promise((resolve) => {
    // -x: no sound, -t png: format (不加 -C，避免把鼠标光标拍进截图)
    // This captures the entire main display
    execFile('/usr/sbin/screencapture', ['-x', '-t', 'png', tmpFile], async (error) => {
      if (error) {
        console.error('[Screenshot] screencapture failed:', error);
        resolve(null);
        return;
      }

      try {
        const buffer = await readFile(tmpFile);
        const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
        console.log(`[Screenshot] macOS screencapture success, data length: ${dataUrl.length}`);
        // Clean up temp file
        await unlink(tmpFile).catch(() => {});
        resolve(dataUrl);
      } catch (readErr) {
        console.error('[Screenshot] Failed to read screenshot file:', readErr);
        await unlink(tmpFile).catch(() => {});
        resolve(null);
      }
    });
  });
}

async function desktopCapturerFallback(width: number, height: number, scaleFactor: number): Promise<string | null> {
  const { desktopCapturer } = require('electron');
  const thumbnailWidth = Math.round(width * scaleFactor);
  const thumbnailHeight = Math.round(height * scaleFactor);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
  });

  console.log(`[Screenshot] Got ${sources.length} source(s)`);

  if (sources.length === 0) {
    console.error('[Screenshot] No screen sources found');
    return null;
  }

  const primarySource = sources[0];
  const thumbnail = primarySource.thumbnail;

  if (thumbnail.isEmpty()) {
    console.error('[Screenshot] Thumbnail is empty - screen recording permission needed');
    return null;
  }

  const dataUrl = thumbnail.toDataURL();
  console.log(`[Screenshot] Data URL length: ${dataUrl.length}`);
  return dataUrl;
}
