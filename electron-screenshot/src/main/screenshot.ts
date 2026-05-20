import { desktopCapturer, screen } from 'electron';

export async function takeScreenshot(): Promise<string | null> {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    const scaleFactor = primaryDisplay.scaleFactor;
    const thumbnailWidth = Math.round(width * scaleFactor);
    const thumbnailHeight = Math.round(height * scaleFactor);

    console.log(`[Screenshot] Display: ${width}x${height}, scale: ${scaleFactor}, thumbnail: ${thumbnailWidth}x${thumbnailHeight}`);

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
  } catch (err) {
    console.error('[Screenshot] takeScreenshot error:', err);
    return null;
  }
}
