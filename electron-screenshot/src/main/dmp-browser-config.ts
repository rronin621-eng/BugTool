/**
 * 金蝶 DMP 浏览器自动化配置
 *
 * 说明：
 * 1. 开发模式：在 electron-screenshot 目录下创建 dmp-browser-config.json
 * 2. 打包模式：把 dmp-browser-config.json 放到 BUG工具.app/Contents/Resources/
 *
 * dmp-browser-config.json 示例：
 * {
 *   "enabled": true,
 *   "skillDir": "/Users/ronin/Documents/bugTool/bug-batch-dmp-v2.0.0",
 *   "storyValue": "PRJ-00761367",
 *   "saveMethod": "click",
 *   "chromeCdpUrl": "http://localhost:9222"
 * }
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface DmpBrowserConfig {
  /** 是否启用浏览器自动化方案 */
  enabled: boolean;
  /** bug-batch-dmp-v2.0.0 目录绝对路径 */
  skillDir: string;
  /** DMP 关联故事编码（必填） */
  storyValue: string;
  /** 保存方式：dispatch | click | enter */
  saveMethod: 'dispatch' | 'click' | 'enter';
  /** Chrome CDP 地址 */
  chromeCdpUrl: string;
}

const DEFAULT_CONFIG: DmpBrowserConfig = {
  enabled: true,
  skillDir: path.join(app.getAppPath ? app.getAppPath() : process.cwd(), '..', '..', 'bug-batch-dmp-v2.0.0'),
  storyValue: '',
  saveMethod: 'click',
  chromeCdpUrl: 'http://localhost:9222',
};

let cachedConfig: DmpBrowserConfig | undefined = undefined;

export function getDmpBrowserConfig(): DmpBrowserConfig {
  if (cachedConfig !== undefined) return cachedConfig;

  const candidates: string[] = [];
  candidates.push(path.join(__dirname, '../../dmp-browser-config.json'));
  if (app && app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'dmp-browser-config.json'));
    candidates.push(path.join(path.dirname(process.execPath), 'dmp-browser-config.json'));
  }

  for (const configPath of candidates) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const merged: DmpBrowserConfig = { ...DEFAULT_CONFIG, ...parsed };
        cachedConfig = merged;
        console.log(`[DMP-Browser] 已加载配置：${configPath}`);
        return merged;
      }
    } catch (err) {
      console.error(`[DMP-Browser] 读取配置失败 ${configPath}:`, err);
    }
  }

  cachedConfig = DEFAULT_CONFIG;
  return DEFAULT_CONFIG;
}

export function resetDmpBrowserConfigCache() {
  cachedConfig = undefined;
}
