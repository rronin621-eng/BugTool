/**
 * 金蝶 DMP 系统接入配置
 *
 * 说明：
 * 1. 开发模式：在 electron-screenshot 目录下创建 dmp-config.json 文件
 * 2. 打包模式：把 dmp-config.json 放到 BUG工具.app/Contents/Resources/ 同级目录，
 *    即与打包后的可执行文件同一目录
 *
 * dmp-config.json 示例：
 * {
 *   "enabled": true,
 *   "apiUrl": "https://dmp.example.com/api/bug/create",
 *   "method": "POST",
 *   "headers": {
 *     "Authorization": "Bearer xxxxx",
 *     "X-App-Key": "your-app-key"
 *   },
 *   "fieldMapping": {
 *     "title": "title",
 *     "description": "description",
 *     "imageBase64": "screenshot"
 *   }
 * }
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface DmpFieldMapping {
  title?: string;
  description?: string;
  imageBase64?: string; // 截图以 base64 放到 JSON 的字段名
  imageUrl?: string;    // 截图以 URL 方式提交的字段名（需要本地上传后再填）
  bugType?: string;
  priority?: string;
  reporter?: string;
  assignee?: string;
  envUrl?: string;
  [key: string]: string | undefined;
}

export interface DmpConfig {
  enabled: boolean;
  apiUrl: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  /** 字段映射：key=本地字段, value=DMP接口字段名 */
  fieldMapping: DmpFieldMapping;
  /** 是否同时提交到本地 BUG 系统 */
  submitToLocal: boolean;
}

const DEFAULT_CONFIG: DmpConfig = {
  enabled: false,
  apiUrl: '',
  method: 'POST',
  headers: {},
  fieldMapping: {
    title: 'title',
    description: 'description',
    imageBase64: 'screenshot',
  },
  submitToLocal: true,
};

let cachedConfig: DmpConfig | undefined = undefined;

export function getDmpConfig(): DmpConfig {
  if (cachedConfig !== undefined) return cachedConfig;

  const candidates: string[] = [];

  // 开发模式：electron-screenshot 目录
  candidates.push(path.join(__dirname, '../../dmp-config.json'));

  // 打包模式：可执行文件所在目录 / Resources 目录
  if (app && app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'dmp-config.json'));
    candidates.push(path.join(path.dirname(process.execPath), 'dmp-config.json'));
  }

  for (const configPath of candidates) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const merged: DmpConfig = { ...DEFAULT_CONFIG, ...parsed };
        cachedConfig = merged;
        console.log(`[DMP] 已加载配置：${configPath}`);
        return merged;
      }
    } catch (err) {
      console.error(`[DMP] 读取配置失败 ${configPath}:`, err);
    }
  }

  cachedConfig = DEFAULT_CONFIG;
  return DEFAULT_CONFIG;
}

export function resetDmpConfigCache() {
  cachedConfig = undefined;
}
