/**
 * 金蝶 DMP 浏览器自动化执行器
 *
 * 把截图工具提交的缺陷数据写入 bug-batch-dmp-v2.0.0 的 pending_defects.json，
 * 根据弹窗填写的 DMP 字段动态生成 config.yaml，
 * 然后调用 create_one.mjs 自动打开 Chrome 填表创建缺陷。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import { getDmpBrowserConfig } from './dmp-browser-config';

// 用户提供的 DMP 入口链接
export const DMP_ENTRY_URL = 'https://devops.kingdee.com:8000/?formId=home_page&code=17845991817a3d4cc6b5ea9ea7b8dced';

export interface DmpFormValues {
  project_name: string;
  module_path: string;
  defect_type: string;
  discovery_stage: string;
  priority: string;
  source: string;
  test_env: string;
  story_value: string;
  handler_id: string;
  note_extra?: string;
}

export interface DmpBrowserSubmitData {
  title: string;
  description?: string;
  bug_type?: string;
  priority?: string;
  reporter_name?: string;
  assignee_name?: string;
  env_url?: string;
  imageDataUrl: string; // data:image/png;base64,...
  dmpForm: DmpFormValues;
  mode?: 'auto' | 'manual';
}

export interface DmpBrowserSubmitResult {
  success: boolean;
  message: string;
  devopsId?: string;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function findSkillDir(configSkillDir?: string): string | null {
  if (configSkillDir && fs.existsSync(configSkillDir)) return configSkillDir;

  const candidates = [
    path.join(process.resourcesPath || '', '..', '..', '..', 'bug-batch-dmp-v2.0.0'),
    path.join(process.resourcesPath || '', 'bug-batch-dmp-v2.0.0'),
    path.join(process.cwd(), 'bug-batch-dmp-v2.0.0'),
    path.join(process.cwd(), '..', 'bug-batch-dmp-v2.0.0'),
    path.join(require('os').homedir(), 'Documents', 'bugTool', 'bug-batch-dmp-v2.0.0'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

/**
 * 根据弹窗填写的值生成 config.yaml
 */
function generateConfigYaml(skillDir: string, form: DmpFormValues, handlerName: string) {
  const configPath = path.join(skillDir, 'config.yaml');
  const lines: string[] = [];
  lines.push('column_mapping:');
  lines.push('  module: "模块"');
  lines.push('  screenshot: "问题截图"');
  lines.push('  description: "问题描述"');
  lines.push('  design_ref: "设计稿参考"');
  lines.push('  reviewer: "走查人"');
  lines.push('  progress: "进度"');
  lines.push('  handler: "处理人"');
  lines.push('  note: "备注"');
  lines.push('');
  lines.push('devops_defaults:');
  lines.push(`  project_name: "${form.project_name}"`);
  lines.push(`  module_path: "${form.module_path}"`);
  lines.push(`  defect_type: "${form.defect_type}"`);
  lines.push(`  discovery_stage: "${form.discovery_stage}"`);
  lines.push(`  priority: "${form.priority}"`);
  lines.push(`  source: "${form.source}"`);
  lines.push(`  test_env: "${form.test_env}"`);
  lines.push(`  project_team: "${form.project_name}"`);
  lines.push(`  related_story: "${form.story_value}"`);
  lines.push('');
  lines.push('handler_mapping:');
  lines.push(`  "${handlerName}": "${form.handler_id}"`);
  lines.push(`  default: "${handlerName}"`);
  lines.push('');
  lines.push('title_template: "【待修改】【{module}】{description}"');
  lines.push('');
  lines.push('note_template: |');
  lines.push('  {original_note}');
  lines.push('  走查人{reviewer}');
  lines.push('  {design_ref_text}');
  if (form.note_extra) {
    lines.push(`  ${form.note_extra.replace(/\n/g, '\n  ')}`);
  }

  fs.writeFileSync(configPath, lines.join('\n'), 'utf-8');
}

/**
 * 生成 pending_defects.json 格式的一条记录
 */
function buildPendingDefect(
  row: number,
  data: DmpBrowserSubmitData,
  imageFileName: string
): Record<string, any> {
  const form = data.dmpForm;
  const moduleName = form.module_path || '通用模块';
  // 没有本地用户姓名，使用处理人工号作为处理人搜索词
  const handlerName = form.handler_id || data.assignee_name || data.reporter_name || '';
  const title = `【待修改】【${moduleName}】${data.title}`;
  const noteLines: string[] = [];
  if (data.description) noteLines.push(data.description);
  if (form.note_extra) noteLines.push(form.note_extra);

  return {
    row,
    module: moduleName,
    title,
    desc: data.description || data.title,
    handler_name: handlerName,
    handler_id: form.handler_id || '',
    note: noteLines.join('\n'),
    screenshot_files: [imageFileName],
    design_ref_files: [],
    status: 'pending',
  };
}

export async function submitBugViaBrowser(data: DmpBrowserSubmitData): Promise<DmpBrowserSubmitResult> {
  const config = getDmpBrowserConfig();
  const skillDir = findSkillDir(config.skillDir);
  const mode = data.mode || 'auto';

  if (!config.enabled) {
    return { success: false, message: 'DMP 浏览器自动化未启用' };
  }
  if (!skillDir) {
    return { success: false, message: `找不到 bug-batch-dmp 目录，请确认项目旁边存在 bug-batch-dmp-v2.0.0 文件夹` };
  }

  const form = data.dmpForm;
  // 自动模式需要校验 DMP 必填字段；手动模式只要求标题和截图
  if (mode === 'auto') {
    const isInteraction = form.defect_type === '交互体验';
    if (!form.project_name || !form.module_path || (!isInteraction && !form.story_value) || !form.handler_id) {
      const storyHint = isInteraction ? '' : '、关联故事';
      return { success: false, message: `DMP 必填信息不完整（项目名称、模块路径${storyHint}、处理人工号）` };
    }
  }

  const skillImagesDir = path.join(skillDir, 'images');
  const pendingPath = path.join(skillDir, 'pending_defects.json');
  ensureDir(skillImagesDir);

  // 1) 保存截图到 skill 的 images 目录
  const imageFileName = `screenshot_${Date.now()}.png`;
  const imagePath = path.join(skillImagesDir, imageFileName);
  try {
    fs.writeFileSync(imagePath, dataUrlToBuffer(data.imageDataUrl));
  } catch (err: any) {
    return { success: false, message: `保存截图失败：${err.message}` };
  }

  // 2) 生成/覆盖 config.yaml（使用弹窗中的 DMP 字段）
  const handlerName = form.handler_id || data.assignee_name || data.reporter_name || '';
  generateConfigYaml(skillDir, form, handlerName);

  // 3) 读取/创建 pending_defects.json
  let pending: any[] = [];
  try {
    if (fs.existsSync(pendingPath)) {
      pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
      if (!Array.isArray(pending)) pending = [];
    }
  } catch {
    pending = [];
  }

  const row = pending.length > 0 ? Math.max(...pending.map((d) => d.row || 0)) + 1 : 1;
  const defect = buildPendingDefect(row, data, imageFileName);
  pending.push(defect);
  fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));

  // 4) 调用 dmp-create.mjs（auto=自动填表+上传；manual=仅上传截图，均不自动保存）
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '../scripts/dmp-create.mjs');
    if (!fs.existsSync(scriptPath)) {
      resolve({ success: false, message: `找不到脚本：${scriptPath}` });
      return;
    }

    const args = [mode, String(row), form.story_value || ''];
    console.log(`[DMP-Browser] 执行：node ${scriptPath} ${args.join(' ')}`);

    // 使用 Electron 自身的 Node 运行时执行脚本，避免生产环境没有系统 node 命令
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: skillDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 60 秒超时保护，防止脚本卡住导致 UI 一直显示"提交中..."
    const timeoutId = setTimeout(() => {
      console.error('[DMP-Browser] dmp-create 执行超时（60秒），强制终止');
      try { child.kill('SIGKILL'); } catch {}
      resolve({ success: false, message: 'DMP 创建执行超时（60秒），请检查 Chrome 是否已登录并打开 CDP。如果停留在 DMP 首页无反应，请把 bug-batch-dmp-v2.0.0/screenshots 目录下的截图发给我。' });
    }, 60000);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({ success: false, message: `启动 dmp-create 失败：${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      const output = stdout + stderr;
      console.log('[DMP-Browser] dmp-create 输出：\n' + output);

      if (code === 0 && output.includes('已就绪')) {
        const msg = mode === 'manual'
          ? '已打开 DMP 新建缺陷页并上传截图，请检查并手动点击保存'
          : '已自动填写 DMP 表单并上传截图，请检查并手动点击保存';
        resolve({ success: true, message: msg });
      } else {
        resolve({ success: false, message: `DMP 创建未成功，请检查 Chrome 是否已登录并打开 CDP。输出：${output.slice(0, 200)}` });
      }
    });
  });
}

export interface LaunchDmpBrowserResult {
  success: boolean;
  message: string;
  browserType?: 'chrome' | 'safari' | 'edge' | 'other';
}

/**
 * 启动系统默认浏览器并打开 DMP 登录页。
 * - Chrome/Edge/Chromium/Brave：通过 CDP 打开新标签页并激活窗口
 * - Safari：用系统 open 命令打开（不支持后续 CDP 自动化，会提示用户）
 */
export async function launchDmpBrowser(): Promise<LaunchDmpBrowserResult> {
  const config = getDmpBrowserConfig();
  const skillDir = findSkillDir(config.skillDir);
  if (!skillDir) {
    return { success: false, message: `找不到 bug-batch-dmp 目录，请确认项目旁边存在 bug-batch-dmp-v2.0.0 文件夹` };
  }

  const defaultBundleId = getDefaultBrowserBundleId();
  console.log('[DMP-Browser] 系统默认浏览器 bundle ID:', defaultBundleId);

  // Safari 不支持 CDP/Playwright，只能打开页面，无法自动录入
  if (defaultBundleId === 'com.apple.safari') {
    try {
      spawn('open', [DMP_ENTRY_URL], { detached: true, stdio: 'ignore' }).unref();
      activateApplication('Safari');
      return {
        success: true,
        browserType: 'safari',
        message: '已用 Safari 打开 DMP 页面。注意：Safari 不支持自动录入缺陷，如需自动录入请把默认浏览器设为 Google Chrome 或 Microsoft Edge。',
      };
    } catch (err: any) {
      return { success: false, message: `打开 Safari 失败：${err.message}` };
    }
  }

  const playwright = loadPlaywright(skillDir);
  if (!playwright) {
    return { success: false, message: '加载 Playwright 失败，请确认 bug-batch-dmp-v2.0.0/node_modules/playwright-core 存在' };
  }

  // Chrome/Edge/Chromium/Brave 等支持 CDP 的浏览器
  const browserType: LaunchDmpBrowserResult['browserType'] = isChromeFamily(defaultBundleId) ? 'chrome' : 'edge';

  // 1) 如果 CDP 已能连通，直接打开一个新标签页到 DMP
  let existingBrowser: any;
  try {
    existingBrowser = await playwright.chromium.connectOverCDP('http://localhost:9222');
    const context = existingBrowser.contexts()[0];
    if (context) {
      const page = await context.newPage();
      await page.goto(DMP_ENTRY_URL);
      activateDefaultBrowser(defaultBundleId);
      return { success: true, browserType, message: '已在浏览器中打开 DMP 页面，请完成登录' };
    }
  } catch {
    // CDP 未启动，继续启动新浏览器
  } finally {
    try { await existingBrowser?.close(); } catch {}
  }

  // 2) 查找浏览器可执行文件
  const browserPath = findBrowserExecutable(defaultBundleId);
  if (!browserPath) {
    return {
      success: false,
      message: `找不到默认浏览器对应的可执行文件。请确认已安装 Google Chrome 或 Microsoft Edge，并将其放在「应用程序」文件夹中。`,
    };
  }

  // 3) 启动浏览器（CDP 模式）
  // 使用独立的 user-data-dir，这样即使已有 Chrome 在运行，也会启动一个独立的 CDP 实例
  const appName = isChromeFamily(defaultBundleId) ? 'Google Chrome' : 'Microsoft Edge';
  const userDataDir = path.join(skillDir, '.browser-profile');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const browserProcess = spawn(browserPath, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--new-window',
    DMP_ENTRY_URL,
  ], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  browserProcess.unref();

  // 4) 等待 CDP 端口可用，确认浏览器真的启动了
  const connected = await waitForCdp(playwright, 20000);
  if (!connected) {
    return {
      success: false,
      message: `浏览器启动失败，请确认 ${appName} 已安装在「应用程序」文件夹中。`,
    };
  }

  activateDefaultBrowser(defaultBundleId);
  return { success: true, browserType, message: '已启动浏览器并打开 DMP 登录页，请在浏览器中完成登录' };
}

function getDefaultBrowserBundleId(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const plistPath = path.join(require('os').homedir(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist');
    const jsonStr = execSync(`plutil -convert json "${plistPath}" -o -`, { encoding: 'utf-8' });
    const data = JSON.parse(jsonStr);
    const handlers = data.LSHandlers || [];
    const handler = handlers.find((h: any) => h.LSHandlerURLScheme === 'http' || h.LSHandlerURLScheme === 'https');
    return handler?.LSHandlerRoleAll || null;
  } catch (err: any) {
    console.error('[DMP-Browser] 读取默认浏览器失败:', err.message);
    return null;
  }
}

function isChromeFamily(bundleId: string | null): boolean {
  if (!bundleId) return false;
  const chromeIds = [
    'com.google.chrome',
    'com.google.chrome.canary',
    'org.chromium.chromium',
    'com.brave.browser',
  ];
  return chromeIds.includes(bundleId);
}

function isEdgeFamily(bundleId: string | null): boolean {
  if (!bundleId) return false;
  return bundleId === 'com.microsoft.edgemac';
}

function isCdpBrowser(bundleId: string | null): boolean {
  return isChromeFamily(bundleId) || isEdgeFamily(bundleId);
}

function findBrowserExecutable(defaultBundleId: string | null): string | null {
  if (isChromeFamily(defaultBundleId)) {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Users/ronin/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    for (const p of candidates) if (fs.existsSync(p)) return p;
  }
  if (isEdgeFamily(defaultBundleId)) {
    const p = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    if (fs.existsSync(p)) return p;
  }
  // 默认回退：任意找一个支持 CDP 的浏览器
  return findAnyCdpBrowser();
}

function findAnyCdpBrowser(): string | null {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

function activateDefaultBrowser(bundleId: string | null) {
  if (!bundleId) return;
  const nameMap: Record<string, string> = {
    'com.google.chrome': 'Google Chrome',
    'com.google.chrome.canary': 'Google Chrome Canary',
    'com.microsoft.edgemac': 'Microsoft Edge',
    'org.chromium.chromium': 'Chromium',
    'com.brave.browser': 'Brave Browser',
  };
  activateApplication(nameMap[bundleId]);
}

function activateApplication(appName: string | undefined) {
  if (!appName) return;
  try {
    execSync(`osascript -e 'tell application "${appName}" to activate'`, { stdio: 'ignore' });
  } catch (err: any) {
    console.error('[DMP-Browser] 激活窗口失败:', err.message);
  }
}

function loadPlaywright(skillDir: string): any {
  try {
    return require(path.join(skillDir, 'node_modules', 'playwright-core'));
  } catch (err: any) {
    console.error('[DMP-Browser] 加载 Playwright 失败:', err.message);
    return null;
  }
}

async function waitForCdp(playwright: any, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let browser: any;
    try {
      browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      try { await browser?.close(); } catch {}
    }
  }
  return false;
}

/**
 * 测试 DMP 链接。
 * 通过 CDP 连接 Chrome，检查是否能访问 DMP 页面。
 */
export async function testDmpConnection(): Promise<{ success: boolean; message: string }> {
  const config = getDmpBrowserConfig();
  const skillDir = findSkillDir(config.skillDir);
  if (!skillDir) {
    return { success: false, message: `找不到 bug-batch-dmp 目录，请确认项目旁边存在 bug-batch-dmp-v2.0.0 文件夹` };
  }

  const playwright = loadPlaywright(skillDir);
  if (!playwright) {
    return { success: false, message: '加载 Playwright 失败，请确认 bug-batch-dmp-v2.0.0/node_modules/playwright-core 存在' };
  }

  let browser: any;
  try {
    browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  } catch (err: any) {
    return { success: false, message: `无法连接到 Chrome 调试端口（9222），请先点击「打开 DMP 并登录」：${err.message}` };
  }

  try {
    const contexts = browser.contexts();
    if (!contexts || contexts.length === 0) {
      return { success: false, message: 'Chrome 没有打开的上下文' };
    }

    const pages = contexts[0].pages();
    const dmpPages = pages.filter((p: any) => {
      const url = p.url();
      return url && url.includes('devops.kingdee.com');
    });

    if (dmpPages.length === 0) {
      return { success: false, message: 'Chrome 中没有找到 DMP 页面，请先点击「打开 DMP 并登录」' };
    }

    // 检查页面是否加载完成（不是 about:blank）
    for (const page of dmpPages) {
      try {
        const url = page.url();
        if (url.includes('login') || url.includes('cas')) {
          return { success: false, message: '检测到当前是登录页，请先完成 DMP 登录' };
        }
        // 等待一下页面状态
        const readyState = await page.evaluate('document.readyState').catch(() => 'unknown');
        if (readyState !== 'complete') {
          return { success: false, message: 'DMP 页面仍在加载中，请稍后再试' };
        }
      } catch {
        // 继续检查下一个页面
      }
    }

    return { success: true, message: `DMP 链接正常（已打开 ${dmpPages.length} 个 DMP 标签页）` };
  } catch (err: any) {
    return { success: false, message: `链接测试异常：${err.message}` };
  } finally {
    try { await browser.close(); } catch {}
  }
}
