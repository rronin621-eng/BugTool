import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.join(require('os').homedir(), 'Library', 'Application Support', 'BUG工具');
const CONFIG_PATH = path.join(CONFIG_DIR, 'shortcut-config.json');

export interface ShortcutConfig {
  accelerator: string;
}

const DEFAULT_CONFIG: ShortcutConfig = {
  accelerator: 'CommandOrControl+Shift+A',
};

/**
 * 将用户友好的键位描述转换为 Electron accelerator 格式。
 * 支持：Cmd/Ctrl/Alt/Shift + 字母/数字/F1-F12/Plus/Space/Tab/Esc/Enter/Backspace/Delete/Up/Down/Left/Right
 */
export function normalizeAccelerator(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const parts = raw.split(/[\s+]+/).filter(Boolean);
  const modifiers: string[] = [];
  let key: string | null = null;

  const MODIFIER_MAP: Record<string, string> = {
    cmd: 'CommandOrControl',
    command: 'CommandOrControl',
    ctrl: 'CommandOrControl',
    control: 'CommandOrControl',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
  };

  const KEY_MAP: Record<string, string> = {
    space: 'Space',
    ' ': 'Space',
    tab: 'Tab',
    esc: 'Escape',
    escape: 'Escape',
    enter: 'Enter',
    return: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    plus: 'Plus',
    '+': 'Plus',
    '=': 'Plus',
  };

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIER_MAP[lower]) {
      if (!modifiers.includes(MODIFIER_MAP[lower])) {
        modifiers.push(MODIFIER_MAP[lower]);
      }
      continue;
    }
    if (KEY_MAP[lower]) {
      key = KEY_MAP[lower];
      continue;
    }
    if (/^[a-z0-9]$/i.test(part)) {
      key = part.toUpperCase();
      continue;
    }
    if (/^f(1[0-2]|[1-9])$/i.test(part)) {
      key = part.toUpperCase();
      continue;
    }
    // 未知键
    return null;
  }

  if (!key) return null;

  // Electron accelerator 习惯顺序：Ctrl/Alt/Shift/Cmd + Key
  const order = ['CommandOrControl', 'Alt', 'Shift'];
  const sortedModifiers = modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...sortedModifiers, key].join('+');
}

/**
 * 将 Electron accelerator 格式转换为用户可读的显示文本。
 */
export function displayAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl/g, process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
    .replace(/Shift/g, 'Shift')
    .replace(/Alt/g, process.platform === 'darwin' ? 'Option' : 'Alt')
    .replace(/Plus/g, '+');
}

/**
 * 读取快捷键配置，不存在则返回默认配置。
 */
export function loadShortcutConfig(): ShortcutConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accelerator === 'string' && parsed.accelerator.length > 0) {
      return { accelerator: parsed.accelerator };
    }
  } catch (e) {
    console.error('[ShortcutConfig] load failed:', e);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * 保存快捷键配置。
 */
export function saveShortcutConfig(config: ShortcutConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('[ShortcutConfig] save failed:', e);
    throw e;
  }
}

/**
 * 获取默认快捷键。
 */
export function getDefaultShortcutConfig(): ShortcutConfig {
  return { ...DEFAULT_CONFIG };
}
