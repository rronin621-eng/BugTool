import { screen } from 'electron';
import { execFile } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface DisplayScreenshot {
  /** base64 data URL of the screenshot for this display */
  imageData: string;
  /** The display's bounds in logical (CSS) pixels */
  bounds: { x: number; y: number; width: number; height: number };
  /** The display's scale factor (e.g. 2 for Retina) */
  scaleFactor: number;
  /** 1-based display index as used by screencapture -D */
  displayIndex: number;
}

/**
 * Capture all connected displays individually.
 * Returns an array of DisplayScreenshot, one per display, in display order.
 * On macOS uses `screencapture -D <n>` for each display.
 * On other platforms falls back to desktopCapturer per source.
 */
export async function takeScreenshots(): Promise<DisplayScreenshot[] | null> {
  try {
    const displays = screen.getAllDisplays();
    console.log(`[Screenshot] Found ${displays.length} display(s)`);
    displays.forEach((d, i) => {
      console.log(`[Screenshot]   Display ${i + 1}: ${d.bounds.width}x${d.bounds.height} at (${d.bounds.x},${d.bounds.y}) scale=${d.scaleFactor}`);
    });

    if (process.platform === 'darwin') {
      return await macCaptureAllDisplays(displays);
    } else {
      return await desktopCapturerAllDisplays(displays);
    }
  } catch (err) {
    console.error('[Screenshot] takeScreenshots error:', err);
    return null;
  }
}

/**
 * macOS: use `screencapture -D <n>` for each display.
 * Display indices for screencapture are 1-based, where 1 = main display.
 * We map Electron display order to screencapture indices by putting primary first.
 */
async function macCaptureAllDisplays(displays: Electron.Display[]): Promise<DisplayScreenshot[] | null> {
  const primary = screen.getPrimaryDisplay();

  // Sort: primary display first (index 1), then others
  const sorted = [
    primary,
    ...displays.filter(d => d.id !== primary.id),
  ];

  const results: DisplayScreenshot[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const display = sorted[i];
    const displayIndex = i + 1; // screencapture is 1-based
    const tmpFile = path.join(os.tmpdir(), `bug-screenshot-display${displayIndex}-${Date.now()}.png`);

    const imageData = await new Promise<string | null>((resolve) => {
      // -x: no sound, -D: display index (1=main), -t png
      execFile('/usr/sbin/screencapture', ['-x', '-D', String(displayIndex), '-t', 'png', tmpFile], async (error) => {
        if (error) {
          console.error(`[Screenshot] screencapture -D ${displayIndex} failed:`, error);
          resolve(null);
          return;
        }
        try {
          const buffer = await readFile(tmpFile);
          const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
          console.log(`[Screenshot] Display ${displayIndex} captured, data length: ${dataUrl.length}`);
          await unlink(tmpFile).catch(() => {});
          resolve(dataUrl);
        } catch (readErr) {
          console.error(`[Screenshot] Failed to read display ${displayIndex} file:`, readErr);
          await unlink(tmpFile).catch(() => {});
          resolve(null);
        }
      });
    });

    if (!imageData) {
      console.warn(`[Screenshot] Display ${displayIndex} capture failed, skipping`);
      continue;
    }

    results.push({
      imageData,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      displayIndex,
    });
  }

  if (results.length === 0) return null;
  return results;
}

/**
 * Non-macOS fallback: use desktopCapturer to get each screen source.
 */
async function desktopCapturerAllDisplays(displays: Electron.Display[]): Promise<DisplayScreenshot[] | null> {
  const { desktopCapturer } = require('electron');

  // Request large enough thumbnails to cover the largest display
  const maxW = Math.max(...displays.map(d => Math.round(d.bounds.width * d.scaleFactor)));
  const maxH = Math.max(...displays.map(d => Math.round(d.bounds.height * d.scaleFactor)));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH },
  });

  console.log(`[Screenshot] desktopCapturer got ${sources.length} source(s)`);
  if (sources.length === 0) return null;

  const results: DisplayScreenshot[] = [];
  const primary = screen.getPrimaryDisplay();
  const sorted = [primary, ...displays.filter(d => d.id !== primary.id)];

  for (let i = 0; i < sorted.length; i++) {
    const display = sorted[i];
    const source = sources[i] ?? sources[0];
    const thumbnail = source.thumbnail;
    if (thumbnail.isEmpty()) continue;
    results.push({
      imageData: thumbnail.toDataURL(),
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      displayIndex: i + 1,
    });
  }

  return results.length > 0 ? results : null;
}
