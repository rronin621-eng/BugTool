import { ipcMain, app } from 'electron';
import * as path from 'path';

// Tesseract.js worker 复用，避免每次识别都重新加载 WASM 和训练数据
let worker: any = null;
let workerInitPromise: Promise<any> | null = null;

/**
 * 获取或初始化 Tesseract worker。
 * 训练数据路径：打包后从 resources/tessdata 加载，开发时从项目 tessdata 加载。
 */
async function getWorker(): Promise<any> {
  if (worker) return worker;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = (async () => {
    // 动态 require 避免 TypeScript 类型定义缺失问题
    const { createWorker } = require('tesseract.js');

    const langPath = app.isPackaged
      ? path.join(process.resourcesPath, 'tessdata')
      : path.join(__dirname, '..', '..', 'tessdata');

    console.log('[OCR] 初始化 worker，训练数据路径:', langPath);

    worker = await createWorker(['chi_sim', 'eng'], 1, {
      langPath,
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] 识别进度: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    return worker;
  })();

  return workerInitPromise;
}

/**
 * 注册 OCR 相关 IPC 处理器。
 * 渲染层通过 screenshotAPI.ocrRecognize(dataUrl) 调用。
 */
export function setupOcrHandler(): void {
  ipcMain.handle('ocr:recognize', async (_event, dataUrl: string) => {
    try {
      const w = await getWorker();
      const { data } = await w.recognize(dataUrl);

      // 返回 words 数组：每个含 text 和 bbox {x0,y0,x1,y1}（相对于图片像素坐标）
      const words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }> = [];
      if (data.words) {
        for (const key of Object.keys(data.words)) {
          const word = data.words[key];
          if (word.text && word.text.trim()) {
            words.push({
              text: word.text,
              bbox: word.bbox,
              confidence: word.confidence,
            });
          }
        }
      }

      return { success: true, words };
    } catch (err) {
      console.error('[OCR] 识别失败:', err);
      return { success: false, words: [], error: String(err) };
    }
  });
}
