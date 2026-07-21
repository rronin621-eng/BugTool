#!/usr/bin/env node
/**
 * 启动 Chrome 浏览器（CDP 调试模式）
 *
 * 用法:
 *   node scripts/launch_cdp.mjs [URL]
 *
 * 自动检测 macOS / Linux / Windows 的 Chrome 路径。
 * 登录态保存在 .browser-profile/，下次复用。
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const url = process.argv[2] || 'https://devops.kingdee.com:8000/';

// 跨平台 Chrome 路径检测
function findChrome() {
  const platform = process.platform;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
    win32: [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
  };
  const paths = candidates[platform] || [];
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  // fallback: 尝试 PATH 中的 chrome/google-chrome
  return platform === 'win32' ? 'chrome' : 'google-chrome';
}

const chromePath = findChrome();
const chrome = spawn(chromePath, [
  '--remote-debugging-port=9222',
  `--user-data-dir=${process.cwd()}/.browser-profile`,
  '--no-first-run',
  '--no-default-browser-check',
  url
], { stdio: 'ignore', detached: false });

console.log(`[launch_cdp] Chrome 路径: ${chromePath}`);
console.log(`[launch_cdp] Chrome 启动, PID=${chrome.pid}`);
console.log(`[launch_cdp] CDP 端口: 9222`);
console.log(`[launch_cdp] 初始 URL: ${url}`);
console.log(`[launch_cdp] 浏览器保持运行中... 操作到「新建缺陷弹窗」打开后回复 Agent。`);

chrome.on('exit', (code) => {
  console.log(`[launch_cdp] Chrome 退出, code=${code}`);
  process.exit(0);
});

// 保持进程
await new Promise(() => {});
