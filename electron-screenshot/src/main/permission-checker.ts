import { systemPreferences, shell } from 'electron';

export type PermissionStatus = 'granted' | 'not-determined' | 'denied' | 'restricted' | 'unknown';

export interface PermissionItem {
  id: string;
  name: string;
  description: string;
  status: PermissionStatus;
  required: boolean;
  preferencePane: 'screen' | 'accessibility';
}

function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function checkScreenRecording(): PermissionStatus {
  if (!isMacOS()) return 'granted';
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    return status as PermissionStatus;
  } catch (err) {
    console.error('[Permission] 检查屏幕录制权限失败:', err);
    return 'unknown';
  }
}

export function checkAccessibility(): PermissionStatus {
  if (!isMacOS()) return 'granted';
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    return trusted ? 'granted' : 'denied';
  } catch (err) {
    console.error('[Permission] 检查辅助功能权限失败:', err);
    return 'unknown';
  }
}

export function requestScreenRecording(): boolean {
  if (!isMacOS()) return true;
  // macOS 屏幕录制权限没有编程请求 API，只能引导用户前往系统设置授予
  // 这里返回当前状态，真正的授权动作由 openSystemPreferences('screen') 完成
  return checkScreenRecording() === 'granted';
}

export function requestAccessibility(): boolean {
  if (!isMacOS()) return true;
  try {
    // 传入 true 会弹出系统授权提示（如果尚未授权）
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    return trusted;
  } catch (err) {
    console.error('[Permission] 请求辅助功能权限失败:', err);
    return false;
  }
}

export function openSystemPreferences(pane: 'screen' | 'accessibility'): void {
  if (!isMacOS()) return;
  const urls: Record<string, string> = {
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  };
  const url = urls[pane];
  if (url) {
    shell.openExternal(url);
  }
}

export function getAllPermissions(): PermissionItem[] {
  return [
    {
      id: 'screen',
      name: '屏幕录制',
      description: '用于捕获屏幕任意区域进行截图和标注',
      status: checkScreenRecording(),
      required: true,
      preferencePane: 'screen',
    },
    {
      id: 'accessibility',
      name: '辅助功能',
      description: '用于注册全局快捷键（如 Cmd/Ctrl+Shift+A 唤起截图）',
      status: checkAccessibility(),
      required: true,
      preferencePane: 'accessibility',
    },
  ];
}

export function getMissingPermissions(): PermissionItem[] {
  return getAllPermissions().filter((p) => p.status !== 'granted');
}

export function allRequiredPermissionsGranted(): boolean {
  return getMissingPermissions().length === 0;
}
