import { ipcMain, clipboard, nativeImage, BrowserWindow, Notification } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

let apiBase = 'http://localhost:8000/api/v1';

export function setupIpcHandlers(apiBaseUrl: string) {
  apiBase = apiBaseUrl;

  // Remove existing handlers to avoid "handler already registered" error
  ipcMain.removeHandler('screenshot:copy');
  ipcMain.removeHandler('screenshot:save');
  ipcMain.removeHandler('bug:submit');
  ipcMain.removeHandler('users:list');
  ipcMain.removeHandler('tasks:list');
  ipcMain.removeHandler('modules:list');
  ipcMain.removeHandler('bugs:list');
  ipcMain.removeHandler('bug:get');
  ipcMain.removeHandler('bug:update-status');
  ipcMain.removeHandler('image:preview');

  // Close screenshot window (use destroy for reliable cleanup)
  ipcMain.on('screenshot:cancel', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.destroy();
    }
  });

  // Copy image to clipboard, close window, show notification
  ipcMain.handle('screenshot:copy', (event, dataUrl: string) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(image);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.destroy();
      new Notification({ title: 'BUG截图工具', body: '已复制到剪贴板' }).show();
      return { success: true };
    } catch (err) {
      console.error('[IPC] copy error:', err);
      return { success: false };
    }
  });

  // Save screenshot to desktop, close window, show notification
  ipcMain.handle('screenshot:save', (event, dataUrl: string, filename: string) => {
    try {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const desktopPath = require('os').homedir();
      const savePath = path.join(desktopPath, 'Desktop', filename);
      fs.writeFileSync(savePath, buffer);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.destroy();
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
  ipcMain.handle('bug:update-status', async (_event, bugId: number, status: string, comment?: string) => {
    try {
      return await httpRequest('PUT', `${apiBase}/bugs/${bugId}/status`, { status, comment });
    } catch (err: any) {
      return { code: 1, message: err.message, data: null };
    }
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

function uploadFile(url: string, filePath: string, bugId: number): Promise<any> {
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
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`
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
