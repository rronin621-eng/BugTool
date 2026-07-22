import { ipcMain, clipboard, nativeImage, BrowserWindow, Notification, app, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { destroyAllScreenshotWindows, unregisterScreenshotWindow, registerScreenshotWindow } from './screenshot-registry';
import { submitBugToDmp, DmpSubmitData } from './dmp-submitter';
import { getDmpConfig } from './dmp-config';
import { getDmpBrowserConfig } from './dmp-browser-config';
import { submitBugViaBrowser, DmpBrowserSubmitData, launchDmpBrowser, testDmpConnection } from './dmp-browser-runner';
import {
  addImage, removeImage, getImages, clearImages, getCount, getMaxImages,
  getTextInfo, setCombineSelected, getSelectedImageDataUrls, replaceImage,
  showStackWindow, updateStackWindow, closeStackWindow, showToastToStack,
  openCombineWindow, closeCombineWindow, setCombineAlwaysOnTop,
} from './multishot';
import {
  openRecordWindow, closeRecordWindow, expandRecordWindow,
  getPendingRegion, getPrimaryScreenSource,
} from './record-window';
import { execFile } from 'child_process';
let ffmpegPath: string = require('ffmpeg-static');
// 打包后 ffmpeg-static 二进制位于 asar.unpacked，需将路径中的 app.asar 替换
if (app.isPackaged && ffmpegPath) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

let apiBase = 'http://localhost:8000/api/v1';

export function setupIpcHandlers(apiBaseUrl: string) {
  apiBase = apiBaseUrl;

  // Remove existing handlers to avoid "handler already registered" error
  const safeRemove = (channel: string) => {
    try { ipcMain.removeHandler(channel); } catch {}
  };
  safeRemove('screenshot:copy');
  safeRemove('screenshot:save');
  safeRemove('bug:submit');
  safeRemove('users:list');
  safeRemove('tasks:list');
  safeRemove('modules:list');
  safeRemove('bugs:list');
  safeRemove('bug:get');
  safeRemove('bug:update-status');
  safeRemove('bug:transfer');
  safeRemove('bug:update-collaborators');
  safeRemove('bug:accept');
  safeRemove('image:preview');
  safeRemove('multishot:get-list');
  safeRemove('multishot:count');
  safeRemove('multishot:copy-single');
  safeRemove('multishot:copy-text');
  safeRemove('multishot:preview');
  safeRemove('multishot:edit');
  safeRemove('combine:copy');
  safeRemove('combine:save');
  safeRemove('combine:get-list');
  safeRemove('record:get-region');
  safeRemove('record:get-screen-source');
  safeRemove('record:save');
  safeRemove('record:submit-bug');
  safeRemove('dmp-browser:launch');
  safeRemove('dmp-browser:test');
  safeRemove('multishot:submit-dmp');

  // ============================================================
  // 多图功能 IPC
  // ============================================================

  // 添加一张图到多图收集（来自截图窗口），保持截图窗口不关闭，弹出/刷新小窗
  ipcMain.on('multishot:add', (event, data: { dataUrl: string; hasText?: boolean; textContent?: string }) => {
    const { dataUrl, hasText = false, textContent = '' } = data;
    const result = addImage(dataUrl, hasText, textContent);
    if (result.ok) {
      // 并行：主进程写入剪贴板（更可靠）+ 系统通知
      try {
        const image = nativeImage.createFromDataURL(dataUrl);
        clipboard.writeImage(image);
      } catch {}
      new Notification({ title: 'BUG截图工具', body: `已复制到剪贴板（${result.count}/${getMaxImages()}）` }).show();
      // 弹出或刷新暂存小窗
      showStackWindow();
      updateStackWindow();
      event.sender.send('multishot:add-accepted', { count: result.count, max: getMaxImages() });
    } else {
      // 已达上限，通知来源窗口
      event.sender.send('multishot:add-rejected', result.reason);
    }
  });

  // 查询当前图片列表（含文字信息）
  ipcMain.handle('multishot:get-list', () => {
    return {
      images: getImages(),
      textInfo: getTextInfo(),
      max: getMaxImages(),
    };
  });

  // 查询当前数量
  ipcMain.handle('multishot:count', () => {
    return { count: getCount(), max: getMaxImages() };
  });

  // 删除指定索引的图片
  ipcMain.on('multishot:remove', (_event, index: number) => {
    const remaining = removeImage(index);
    if (remaining === 0) {
      closeStackWindow();
      clearImages();
    } else {
      updateStackWindow();
    }
  });

  // 复制单张图片到剪贴板（不关闭窗口）
  ipcMain.handle('multishot:copy-single', (_event, index: number) => {
    const imgs = getImages();
    if (index < 0 || index >= imgs.length) return { success: false };
    try {
      const image = nativeImage.createFromDataURL(imgs[index]);
      clipboard.writeImage(image);
      new Notification({ title: 'BUG截图工具', body: '图片已复制到剪贴板' }).show();
      return { success: true };
    } catch (err) {
      console.error('[IPC] multishot:copy-single error:', err);
      return { success: false };
    }
  });

  // 复制图片中的文字到剪贴板
  ipcMain.handle('multishot:copy-text', (_event, index: number) => {
    const textInfoArr = getTextInfo();
    if (index < 0 || index >= textInfoArr.length) return { success: false };
    const info = textInfoArr[index];
    if (!info.hasText || !info.textContent) return { success: false, message: '该图片无文字' };
    try {
      clipboard.writeText(info.textContent);
      new Notification({ title: 'BUG截图工具', body: '文字已复制到剪贴板' }).show();
      return { success: true };
    } catch (err) {
      console.error('[IPC] multishot:copy-text error:', err);
      return { success: false };
    }
  });

  // 设置选中要组合的图片索引
  ipcMain.on('multishot:set-combine-selected', (_event, indices: number[]) => {
    setCombineSelected(indices);
  });

  // 用选中的图片打开组合编辑器
  ipcMain.on('multishot:combine-selected', () => {
    const selected = getSelectedImageDataUrls();
    if (selected.length < 2) return;
    openCombineWindow();
  });

  // 清空所有图片并关闭小窗
  ipcMain.on('multishot:clear', () => {
    clearImages();
    closeStackWindow();
  });

  // 从浮窗提交选中的截图到 DMP（支持单选和多选）
  ipcMain.handle('multishot:submit-dmp', async (_event, data: { indices: number[] }) => {
    const allImages = getImages();
    const allTextInfo = getTextInfo();
    const indices = (data.indices || []).filter(i => i >= 0 && i < allImages.length);
    if (indices.length === 0) {
      return { success: false, message: '未选择图片' };
    }

    const selectedImages = indices.map(i => allImages[i]);
    const selectedTexts = indices.map(i => allTextInfo[i]);

    // 生成标题和描述：有文字标注时优先使用，否则自动生成标题
    const allTextContents = selectedTexts
      .filter(t => t && t.hasText && t.textContent)
      .map(t => t.textContent);
    let title: string;
    let description = '';
    if (allTextContents.length > 0) {
      title = allTextContents[0].trim();
      if (allTextContents.length > 1) {
        description = allTextContents.join('\n');
      }
    } else {
      const now = new Date();
      title = `DMP缺陷 - ${now.toLocaleString('zh-CN', { hour12: false })}`;
    }

    // 1) 检查 DMP 连接
    const testResult = await testDmpConnection();
    if (!testResult.success) {
      return { success: false, message: '未连接 DMP，请先登录并打开缺陷列表' };
    }
    if (!testResult.isInDefectList) {
      return { success: false, message: '请先打开缺陷列表页' };
    }

    // 2) 提交到 DMP
    let browserResult: { success: boolean; message: string };
    try {
      browserResult = await submitBugViaBrowser({
        title,
        description,
        imageDataUrls: selectedImages,
        dmpForm: {
          project_name: '',
          module_path: '',
          defect_type: '功能缺陷',
          discovery_stage: 'dev测试',
          priority: '中',
          source: '测试',
          test_env: '',
          story_value: '',
          handler_id: '',
          note_extra: '',
        },
        mode: 'manual',
      });
    } catch (err: any) {
      browserResult = { success: false, message: err.message || 'DMP 浏览器自动化异常' };
    }

    // 3) 提交成功后从浮窗移除已提交的图片
    if (browserResult.success) {
      // 降序删除，避免索引错位
      indices.sort((a, b) => b - a).forEach(i => removeImage(i));
      if (getCount() === 0) {
        closeStackWindow();
      } else {
        updateStackWindow();
      }
    }

    return browserResult;
  });

  // 打开组合编辑器（使用所有图片，向后兼容）
  ipcMain.on('multishot:open-combine', () => {
    if (getCount() === 0) return;
    openCombineWindow();
  });

  // 组合编辑器输出成功后，清空 store 并关闭小窗与编辑器
  ipcMain.on('multishot:finish', () => {
    clearImages();
    closeStackWindow();
    closeCombineWindow();
  });

  // 关闭组合编辑器（取消）
  ipcMain.on('multishot:close-combine', () => {
    closeCombineWindow();
  });

  // 组合编辑器窗口层级控制（文字输入时）
  ipcMain.on('combine:set-level', (_event, level: string) => {
    setCombineAlwaysOnTop(level !== 'normal');
  });

  // ============================================================
  // 录屏功能 IPC
  // ============================================================

  // 截图窗口请求开始录屏：关闭截图窗，打开录制控制窗
  ipcMain.on('record:start', (event, region: any) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.destroy();
    openRecordWindow(region);
  });

  // 录制窗口查询框选区域
  ipcMain.handle('record:get-region', () => {
    return getPendingRegion();
  });

  // 录制窗口查询屏幕采集源
  ipcMain.handle('record:get-screen-source', async () => {
    return await getPrimaryScreenSource();
  });

  // 录制结束，窗口扩展以显示保存/录入
  ipcMain.on('record:expand', () => {
    expandRecordWindow();
  });

  // 关闭录制窗口
  ipcMain.on('record:close', () => {
    closeRecordWindow();
  });

  // 保存录屏：接收 webm，转 mp4，存桌面
  ipcMain.handle('record:save', async (_event, buffer: ArrayBuffer) => {
    try {
      const mp4Path = await processRecording(buffer);
      const now = new Date();
      const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const destName = `recording_${ts}.mp4`;
      const destPath = path.join(require('os').homedir(), 'Desktop', destName);
      fs.copyFileSync(mp4Path, destPath);
      try { fs.unlinkSync(mp4Path); } catch {}
      new Notification({ title: 'BUG截图工具', body: `录屏已保存到桌面：${destName}` }).show();
      closeRecordWindow();
      return { success: true };
    } catch (err: any) {
      console.error('[Record] save error:', err);
      return { success: false, message: err.message || '保存失败' };
    }
  });

  // 录入录屏 BUG：转 mp4 → 创建 BUG → 上传 mp4 附件
  ipcMain.handle('record:submit-bug', async (_event, data: any) => {
    try {
      const mp4Path = await processRecording(data.webm);

      const bugResponse = await httpRequest('POST', `${apiBase}/bugs`, {
        title: data.title,
        description: data.description,
        bug_type: data.bug_type,
        priority: data.priority,
        reporter_id: data.reporter_id,
        assignee_id: data.assignee_id || null,
        env_url: data.env_url || '',
        inspection_task_id: data.inspection_task_id || null,
        module_id: data.module_id || null,
        reproduction_steps: data.reproduction_steps || '',
      });

      if (bugResponse.code !== 0) {
        try { fs.unlinkSync(mp4Path); } catch {}
        return { success: false, message: bugResponse.message || '创建BUG失败' };
      }

      const bugId = bugResponse.data.id;
      const uploadResult = await uploadFile(`${apiBase}/uploads/screenshot`, mp4Path, bugId, 'video/mp4');
      try { fs.unlinkSync(mp4Path); } catch {}

      if (uploadResult.code !== 0) {
        return { success: true, bug_id: bugId, message: 'BUG已创建，但视频上传失败' };
      }

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('viewer:refresh');
      });
      closeRecordWindow();
      return { success: true, bug_id: bugId, message: 'BUG录入成功' };
    } catch (err: any) {
      console.error('[Record] submit error:', err);
      return { success: false, message: err.message || '提交失败' };
    }
  });

  // 组合编辑器获取图片列表（优先使用选中的子集）
  ipcMain.handle('combine:get-list', () => {
    const selected = getSelectedImageDataUrls();
    if (selected.length >= 2) {
      return { images: selected, max: getMaxImages() };
    }
    return { images: getImages(), max: getMaxImages() };
  });

  // 组合图复制到剪贴板，完成后清空并关闭
  ipcMain.handle('combine:copy', (_event, dataUrl: string) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(image);
      new Notification({ title: 'BUG截图工具', body: '组合图已复制到剪贴板' }).show();
      clearImages();
      closeStackWindow();
      closeCombineWindow();
      return { success: true };
    } catch (err) {
      console.error('[IPC] combine:copy error:', err);
      return { success: false };
    }
  });

  // 组合图保存到桌面，完成后清空并关闭
  ipcMain.handle('combine:save', (_event, dataUrl: string, filename: string) => {
    try {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const savePath = path.join(require('os').homedir(), 'Desktop', filename);
      fs.writeFileSync(savePath, buffer);
      new Notification({ title: 'BUG截图工具', body: `组合图已保存到桌面：${filename}` }).show();
      clearImages();
      closeStackWindow();
      closeCombineWindow();
      return { success: true };
    } catch (err) {
      console.error('[IPC] combine:save error:', err);
      return { success: false };
    }
  });


  // Close screenshot window (use destroy for reliable cleanup)
  // Also destroys all other screenshot overlay windows (multi-monitor support)
  ipcMain.on('screenshot:cancel', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.destroy();
    // Destroy all remaining per-display screenshot windows
    destroyAllScreenshotWindows();
  });

  // User started selecting on one display: keep only that window, close all others
  ipcMain.on('screenshot:focus-display', (event) => {
    const activeWin = BrowserWindow.fromWebContents(event.sender);
    if (activeWin && !activeWin.isDestroyed()) {
      // Temporarily unregister the active window so destroyAll won't touch it
      unregisterScreenshotWindow(activeWin);
      destroyAllScreenshotWindows();
      // Re-register so future cancel/copy/save still closes it
      registerScreenshotWindow(activeWin);
    } else {
      destroyAllScreenshotWindows();
    }
  });

  // Copy image to clipboard, close ALL screenshot windows, show notification
  ipcMain.handle('screenshot:copy', (event, dataUrl: string) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(image);
      destroyAllScreenshotWindows();
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) win.destroy();
      new Notification({ title: 'BUG截图工具', body: '已复制到剪贴板' }).show();
      return { success: true };
    } catch (err) {
      console.error('[IPC] copy error:', err);
      return { success: false };
    }
  });

  // Save screenshot to desktop, close ALL screenshot windows, show notification
  ipcMain.handle('screenshot:save', (event, dataUrl: string, filename: string) => {
    try {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const desktopPath = require('os').homedir();
      const savePath = path.join(desktopPath, 'Desktop', filename);
      fs.writeFileSync(savePath, buffer);
      destroyAllScreenshotWindows();
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) win.destroy();
      new Notification({ title: 'BUG截图工具', body: `已保存到桌面：${filename}` }).show();
      return { success: true };
    } catch (err) {
      console.error('[IPC] save error:', err);
      return { success: false };
    }
  });

  // Submit bug with screenshot
  ipcMain.handle('bug:submit', async (_event, data: {
    title: string;
    description: string;
    bug_type: string;
    reporter_id: number;
    assignee_id?: number;
    env_url?: string;
    inspection_task_id?: number;
    module_id?: number;
    reproduction_steps?: string;
    imageDataUrl: string;
  }) => {
    try {
      // Step 1: Create bug record
      const bugResponse = await httpRequest('POST', `${apiBase}/bugs`, {
        title: data.title,
        description: data.description,
        bug_type: data.bug_type,
        reporter_id: data.reporter_id,
        assignee_id: data.assignee_id || null,
        env_url: data.env_url || '',
        inspection_task_id: data.inspection_task_id || null,
        module_id: data.module_id || null,
        reproduction_steps: data.reproduction_steps || '',
      });

      if (bugResponse.code !== 0) {
        return { success: false, message: bugResponse.message || '创建BUG失败' };
      }

      const bugId = bugResponse.data.id;

      // Step 2: Convert dataUrl to file and upload screenshot
      const base64Data = data.imageDataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Save temp file
      const tempDir = path.join(require('os').tmpdir(), 'bug-screenshot-tool');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFile = path.join(tempDir, `screenshot_${Date.now()}.png`);
      fs.writeFileSync(tempFile, buffer);

      // Upload screenshot using multipart/form-data
      const uploadResult = await uploadFile(`${apiBase}/uploads/screenshot`, tempFile, bugId);

      // Cleanup temp file
      try { fs.unlinkSync(tempFile); } catch {}

      if (uploadResult.code !== 0) {
        return { success: true, bug_id: bugId, message: 'BUG已创建，但截图上传失败' };
      }

      // Notify viewer window to refresh
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('viewer:refresh');
        }
      });

      return { success: true, bug_id: bugId, message: 'BUG录入成功' };
    } catch (err: any) {
      return { success: false, message: err.message || '提交失败' };
    }
  });

  // Submit screenshot bug to local system AND optionally to Kingdee DMP
  ipcMain.handle('bug:submit-with-dmp', async (_event, data: {
    title: string;
    description: string;
    bug_type: string;
    reporter_id: number;
    assignee_id?: number;
    env_url?: string;
    inspection_task_id?: number;
    module_id?: number;
    reproduction_steps?: string;
    reporter_name?: string;
    assignee_name?: string;
    imageDataUrl: string;
  }) => {
    const dmpConfig = getDmpConfig();
    let localResult: { success: boolean; bug_id?: number; message: string } | null = null;
    let dmpResult: { success: boolean; dmpBugId?: string | number; message: string } | null = null;

    // 1) 本地系统录入（除非配置明确关闭）
    if (dmpConfig.submitToLocal !== false) {
      try {
        const bugResponse = await httpRequest('POST', `${apiBase}/bugs`, {
          title: data.title,
          description: data.description,
          bug_type: data.bug_type,
          reporter_id: data.reporter_id,
          assignee_id: data.assignee_id || null,
          env_url: data.env_url || '',
          inspection_task_id: data.inspection_task_id || null,
          module_id: data.module_id || null,
          reproduction_steps: data.reproduction_steps || '',
        });

        if (bugResponse.code === 0) {
          const bugId = bugResponse.data.id;
          const base64Data = data.imageDataUrl.replace(/^data:image\/png;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const tempDir = path.join(require('os').tmpdir(), 'bug-screenshot-tool');
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const tempFile = path.join(tempDir, `screenshot_${Date.now()}.png`);
          fs.writeFileSync(tempFile, buffer);
          const uploadResult = await uploadFile(`${apiBase}/uploads/screenshot`, tempFile, bugId);
          try { fs.unlinkSync(tempFile); } catch {}

          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('viewer:refresh');
          });

          localResult = {
            success: true,
            bug_id: bugId,
            message: uploadResult.code === 0 ? '本地 BUG 录入成功' : '本地 BUG 已创建，截图上传失败',
          };
        } else {
          localResult = { success: false, message: bugResponse.message || '本地创建 BUG 失败' };
        }
      } catch (err: any) {
        localResult = { success: false, message: err.message || '本地提交失败' };
      }
    }

    // 2) DMP 录入（如果启用）
    if (dmpConfig.enabled && dmpConfig.apiUrl) {
      try {
        dmpResult = await submitBugToDmp({
          title: data.title,
          description: data.description,
          bug_type: data.bug_type,
          priority: undefined,
          reporter_name: data.reporter_name,
          assignee_name: data.assignee_name,
          env_url: data.env_url,
          imageDataUrl: data.imageDataUrl,
        });
      } catch (err: any) {
        dmpResult = { success: false, message: err.message || 'DMP 提交异常' };
      }
    }

    // 3) 汇总返回结果
    if (dmpResult) {
      if (dmpResult.success) {
        return {
          success: true,
          message: localResult?.success
            ? `本地 BUG #${localResult.bug_id} 录入成功，DMP #${dmpResult.dmpBugId} 录入成功`
            : `DMP #${dmpResult.dmpBugId} 录入成功（本地：${localResult?.message || '未启用'}）`,
        };
      } else {
        return {
          success: localResult?.success ?? false,
          message: `DMP 失败：${dmpResult.message}；本地：${localResult?.message || '未提交'}`,
        };
      }
    }

    // 没有 DMP 配置时，只返回本地结果
    return localResult || { success: false, message: '未提交到任何系统' };
  });

  // Submit screenshot bug via DMP browser automation (bug-batch-dmp skill)
  ipcMain.handle('bug:submit-dmp-browser', async (_event, data: {
    title: string;
    description?: string;
    imageDataUrl: string;
    dmpForm: any;
    mode?: 'auto' | 'manual';
  }) => {
    // 显示浮窗并展示提交中提示
    showStackWindow();
    // 等待浮窗加载完成后发送 toast
    setTimeout(() => {
      showToastToStack('正在提交到 DMP...', 120000);
    }, 300);

    // 仅提交到 DMP 浏览器自动化系统
    let browserResult: { success: boolean; devopsId?: string; message: string } | null = null;
    try {
      browserResult = await submitBugViaBrowser({
        title: data.title,
        description: data.description,
        imageDataUrl: data.imageDataUrl,
        dmpForm: data.dmpForm,
        mode: data.mode,
      });
    } catch (err: any) {
      browserResult = { success: false, message: err.message || 'DMP 浏览器自动化异常' };
    }

    if (browserResult.success) {
      showToastToStack(`DMP 缺陷创建成功：${browserResult.devopsId || ''}`, 4000);
      // 浮窗无图片时，延迟关闭
      if (getCount() === 0) {
        setTimeout(() => {
          closeStackWindow();
        }, 4000);
      }
      return {
        success: true,
        message: `DMP 缺陷创建成功：${browserResult.devopsId || ''}`,
      };
    } else {
      showToastToStack(`DMP 创建失败：${browserResult.message}`, 6000);
      // 浮窗无图片时，延迟关闭
      if (getCount() === 0) {
        setTimeout(() => {
          closeStackWindow();
        }, 6000);
      }
      return {
        success: false,
        message: `DMP 创建失败：${browserResult.message}`,
      };
    }
  });

  // Launch Chrome and open DMP login page
  ipcMain.handle('dmp-browser:launch', async () => {
    try {
      return await launchDmpBrowser();
    } catch (err: any) {
      return { success: false, message: err.message || '启动 DMP 浏览器失败' };
    }
  });

  // Test DMP connection via CDP
  ipcMain.handle('dmp-browser:test', async () => {
    try {
      return await testDmpConnection();
    } catch (err: any) {
      return { success: false, message: err.message || '链接测试失败' };
    }
  });

  // Save/load DMP form defaults (so user does not need to edit config files)
  const dmpDefaultsPath = path.join(require('os').homedir(), 'Library', 'Application Support', 'BUG工具', 'dmp-form-defaults.json');
  ipcMain.handle('dmp-form:save-defaults', async (_event, data: Record<string, any>) => {
    try {
      const dir = path.dirname(dmpDefaultsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dmpDefaultsPath, JSON.stringify(data, null, 2));
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });
  ipcMain.handle('dmp-form:load-defaults', async () => {
    try {
      if (!fs.existsSync(dmpDefaultsPath)) return { success: true, data: {} };
      const raw = fs.readFileSync(dmpDefaultsPath, 'utf-8');
      return { success: true, data: JSON.parse(raw) };
    } catch (err: any) {
      return { success: false, message: err.message, data: {} };
    }
  });

  // Get users list
  ipcMain.handle('users:list', async () => {
    try {
      const response = await httpRequest('GET', `${apiBase}/users`);
      return response;
    } catch (err: any) {
      return { code: 1, message: err.message, data: [] };
    }
  });

  // Get active inspection tasks
  ipcMain.handle('tasks:list', async () => {
    try {
      const response = await httpRequest('GET', `${apiBase}/inspection-tasks?status=active`);
      return response;
    } catch (err: any) {
      return { code: 1, message: err.message, data: [] };
    }
  });

  // Get function modules
  ipcMain.handle('modules:list', async () => {
    try {
      const response = await httpRequest('GET', `${apiBase}/function-modules`);
      return response;
    } catch (err: any) {
      return { code: 1, message: err.message, data: [] };
    }
  });

  // Get bug list (for viewer)
  ipcMain.handle('bugs:list', async (_event, params: {
    assignee_id?: number;
    reporter_id?: number;
    status?: string;
    page?: number;
    page_size?: number;
  }) => {
    try {
      const query = new URLSearchParams();
      if (params.assignee_id) query.set('assignee_id', String(params.assignee_id));
      if (params.reporter_id) query.set('reporter_id', String(params.reporter_id));
      if (params.status) query.set('status', params.status);
      query.set('page', String(params.page ?? 1));
      query.set('page_size', String(params.page_size ?? 50));
      return await httpRequest('GET', `${apiBase}/bugs?${query}`);
    } catch (err: any) {
      return { code: 1, message: err.message, data: { items: [], total: 0 } };
    }
  });

  // Get single bug detail (for viewer)
  ipcMain.handle('bug:get', async (_event, bugId: number) => {
    try {
      return await httpRequest('GET', `${apiBase}/bugs/${bugId}`);
    } catch (err: any) {
      return { code: 1, message: err.message, data: null };
    }
  });

  // Update bug status (for viewer)
  ipcMain.handle('bug:update-status', async (_event, bugId: number, status: string, comment?: string, operatorId?: number) => {
    try {
      return await httpRequest('PUT', `${apiBase}/bugs/${bugId}/status`, { status, comment, operator_id: operatorId });
    } catch (err: any) {
      return { code: 1, message: err.message, data: null };
    }
  });

  // Transfer bug to another assignee
  ipcMain.handle('bug:transfer', async (_event, bugId: number, assigneeId: number, operatorId?: number, comment?: string) => {
    try {
      return await httpRequest('PUT', `${apiBase}/bugs/${bugId}/transfer`, {
        assignee_id: assigneeId,
        operator_id: operatorId,
        comment: comment || '',
      });
    } catch (err: any) {
      return { code: 1, message: err.message, data: null };
    }
  });

  // Update bug collaborators
  ipcMain.handle('bug:update-collaborators', async (_event, bugId: number, userIds: number[]) => {
    try {
      return await httpRequest('PUT', `${apiBase}/bugs/${bugId}/collaborators`, { user_ids: userIds });
    } catch (err: any) {
      return { code: 1, message: err.message, data: null };
    }
  });

  // Accept or reject bug (reporter verifies fixed bug)
  ipcMain.handle('bug:accept', async (_event, bugId: number, accepted: boolean, operatorId?: number, comment?: string) => {
    try {
      const status = accepted ? 'closed' : 'in_progress';
      const note = comment || (accepted ? '验收通过' : '验收不通过，重新处理');
      return await httpRequest('PUT', `${apiBase}/bugs/${bugId}/status`, {
        status,
        comment: note,
        operator_id: operatorId,
      });
    } catch (err: any) {
      return { code: 1, message: err.message, data: null };
    }
  });

  // 打开编辑窗口（复用截图标注页）
  ipcMain.handle('multishot:edit', (_event, index: number) => {
    const imgs = getImages();
    if (index < 0 || index >= imgs.length) return;
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
    // 窗口大小为屏幕工作区的 70%，居中显示
    const winW = Math.round(screenW * 0.7);
    const winH = Math.round(screenH * 0.7);
    const winX = Math.round((screenW - winW) / 2);
    const winY = Math.round((screenH - winH) / 2);
    const editWin = new BrowserWindow({
      width: winW,
      height: winH,
      x: winX,
      y: winY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreen: false,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/index.js'),
      },
    });
    if (process.platform === 'darwin') {
      editWin.setAlwaysOnTop(true, 'floating');
    }
    editWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    editWin.show();
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    editWin.loadURL('file://' + encodeURI(htmlPath));
    editWin.webContents.on('did-finish-load', () => {
      editWin.webContents.send('edit:start', { editIndex: index, dataUrl: imgs[index] });
    });
  });

  // 替换指定索引的图片
  ipcMain.on('multishot:replace', (event, data: { index: number; dataUrl: string; hasText?: boolean; textContent?: string }) => {
    const { index, dataUrl, hasText = false, textContent = '' } = data;
    const ok = replaceImage(index, dataUrl, hasText, textContent);
    if (ok) {
      try {
        const image = nativeImage.createFromDataURL(dataUrl);
        clipboard.writeImage(image);
      } catch {}
      new Notification({ title: 'BUG截图工具', body: '图片已编辑并复制到剪贴板' }).show();
      updateStackWindow();
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.destroy();
  });

  // 打开图片预览（根据暂存小窗索引）
  ipcMain.handle('multishot:preview', (_event, index: number) => {
    const imgs = getImages();
    if (index < 0 || index >= imgs.length) return;
    const { screen } = require('electron');
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const previewWin = new BrowserWindow({
      width,
      height,
      frame: false,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const htmlPath = path.join(__dirname, '../renderer/img-preview.html');
    previewWin.loadURL('file://' + htmlPath + '?src=' + encodeURIComponent(imgs[index]));
  });

  // Open fullscreen image preview window
  ipcMain.handle('image:preview', (_event, imageUrl: string) => {
    const { screen } = require('electron');
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const previewWin = new BrowserWindow({
      width,
      height,
      frame: false,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const htmlPath = path.join(__dirname, '../renderer/img-preview.html');
    previewWin.loadURL('file://' + htmlPath + '?src=' + encodeURIComponent(imageUrl));
  });
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// 将渲染层传来的 webm（ArrayBuffer）转换为 mp4，返回 mp4 临时文件路径
function processRecording(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const tempDir = path.join(require('os').tmpdir(), 'bug-screenshot-tool');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const webmPath = path.join(tempDir, `rec_${Date.now()}.webm`);
      const mp4Path = path.join(tempDir, `rec_${Date.now()}.mp4`);
      fs.writeFileSync(webmPath, Buffer.from(buffer));

      // libx264 + yuv420p + faststart 保证微信/QuickTime/浏览器广泛兼容
      const args = [
        '-i', webmPath,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-y', mp4Path,
      ];
      execFile(ffmpegPath, args, (error) => {
        try { fs.unlinkSync(webmPath); } catch {}
        if (error) {
          console.error('[Record] ffmpeg convert failed:', error);
          // 兜底：把 webm 留到桌面，避免丢失
          try {
            const fallback = path.join(require('os').homedir(), 'Desktop', `recording_${Date.now()}.webm`);
            fs.writeFileSync(fallback, Buffer.from(buffer));
          } catch {}
          reject(new Error('视频格式转换失败，已保留原始文件到桌面'));
          return;
        }
        resolve(mp4Path);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function httpRequest(method: string, url: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = (urlObj.protocol === 'https:' ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ code: -1, message: 'Invalid response', data: null });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function uploadFile(url: string, filePath: string, bugId: number, contentType: string = 'image/png'): Promise<any> {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const urlObj = new URL(url);

    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    // Build multipart form data
    const parts: Buffer[] = [];

    // bug_id field
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="bug_id"\r\n\r\n${bugId}\r\n`
    ));

    // file field
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`
    ));
    parts.push(fileContent);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ code: -1, message: 'Invalid response', data: null });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
