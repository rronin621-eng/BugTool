process.on('uncaughtException', (err) => {
  console.error('[Worker Uncaught]', err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[Worker UnhandledRejection]', err && err.stack || err);
});

// 关键修复：删除 process.versions.electron，使 isElectron() 返回 false
// 这让 getEnvironment() 返回 "node" 而非 "electron"
// 从而让 loadLanguage 用 fs.readFile 加载本地语言文件，而非 node-fetch
if (process.versions && process.versions.electron) {
  delete process.versions.electron;
}

const fs = require('fs');
const path = require('path');

// 覆盖 fetch 作为后备（WASM 加载可能用到）
const customFetch = function(url, opts) {
  console.log('[Worker] fetch called with:', url);
  var filePath = null;
  if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('file://')) {
    filePath = path.resolve(url);
  } else if (typeof url === 'string' && url.startsWith('file://')) {
    filePath = url.slice(7);
  }
  if (filePath) {
    try {
      const data = fs.readFileSync(filePath);
      return Promise.resolve({ ok: true, status: 200, url: 'file://' + filePath, arrayBuffer: () => Promise.resolve(data.buffer) });
    } catch (e) { return Promise.reject(e); }
  }
  return Promise.reject(new Error('Unsupported fetch URL: ' + url));
};
Object.defineProperty(globalThis, 'fetch', { value: customFetch, writable: true, configurable: true });
WebAssembly.instantiateStreaming = undefined;

require('tesseract.js/src/worker-script/node/index.js');
