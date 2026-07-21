import { pathToFileURL } from 'url';
import path from 'path';
import process from 'process';

function isServiceWorkerError(err) {
  const msg = err?.message || String(err);
  return msg.includes('"type": "service_worker"') || msg.includes('service_worker');
}

process.on('uncaughtException', (err) => {
  if (isServiceWorkerError(err)) {
    console.warn('[create-one-wrapper] 忽略 Chrome service worker 错误');
    return;
  }
  console.error('[create-one-wrapper] uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (isServiceWorkerError(reason)) {
    console.warn('[create-one-wrapper] 忽略 Chrome service worker rejection');
    return;
  }
  console.error('[create-one-wrapper] unhandledRejection:', reason);
  process.exit(1);
});

const args = process.argv.slice(2);
const skillDir = args[0];
if (!skillDir) {
  console.error('用法: node create-one-wrapper.mjs <skillDir> <row> [storyValue] [saveMethod]');
  process.exit(1);
}

process.chdir(skillDir);
// 重新构造 argv，让 create_one.mjs 看到原来的参数格式
process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];

const createOnePath = path.join(skillDir, 'scripts/create_one.mjs');
await import(pathToFileURL(createOnePath).href);
