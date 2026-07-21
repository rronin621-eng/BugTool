#!/usr/bin/env node
/**
 * DMP 缺陷创建辅助脚本（Playwright + CDP 方案）
 *
 * 用法:
 *   node dmp-create.mjs <mode> <row> [storyValue] [saveMethod]
 *
 * 参数:
 *   mode       - auto（自动填表+上传，不自动保存）| manual（仅上传截图，不填表不保存）
 *   row        - pending_defects.json 里的 row 号（必填）
 *   storyValue - 关联故事的搜索词/编码（可选；auto 模式下未提供则跳过）
 *   saveMethod - 已废弃，保留占位
 *
 * 前提:
 *   1. Chrome 已开启 CDP 端口 9222
 *   2. 浏览器里已登录 DevOps/DMP
 */
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import process from 'process';
import { createRequire } from 'module';
import { execSync } from 'child_process';

// 脚本被 spawn 时 cwd 已设置为 bug-batch-dmp-v2.0.0，因此从 cwd 解析依赖
const cwdRequire = createRequire(path.join(process.cwd(), 'index.js'));

function resolveEsmEntry(pkg) {
  const pkgJsonPath = cwdRequire.resolve(`${pkg}/package.json`);
  const pkgDir = path.dirname(pkgJsonPath);
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const exp = pkgJson.exports?.['.'];
  const entry = exp?.import || exp?.default || pkgJson.module || 'index.mjs';
  return path.join(pkgDir, entry);
}

async function importFromCwd(pkg) {
  const entry = resolveEsmEntry(pkg);
  return await import(pathToFileURL(entry).href);
}

const { chromium } = await importFromCwd('playwright');

// 忽略 Chrome 扩展 service worker 导致的 Playwright 内部断言崩溃
function isServiceWorkerError(err) {
  const msg = err?.message || String(err);
  return msg.includes('"type": "service_worker"') || msg.includes('service_worker');
}
process.on('uncaughtException', (err) => {
  if (isServiceWorkerError(err)) { console.warn('[dmp-create] 忽略 Chrome service worker 错误'); return; }
  console.error('[dmp-create] uncaughtException:', err); process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (isServiceWorkerError(reason)) { console.warn('[dmp-create] 忽略 Chrome service worker rejection'); return; }
  console.error('[dmp-create] unhandledRejection:', reason); process.exit(1);
});

// ===== 加载配置（发现阶段等默认值） =====
let CONFIG = {};
try {
  const yaml = (await importFromCwd('js-yaml')).default;
  CONFIG = yaml.load(fs.readFileSync('config.yaml', 'utf-8')) || {};
} catch {
  try { CONFIG = JSON.parse(fs.readFileSync('config.yaml', 'utf-8')); } catch {}
}
const DEFAULTS = CONFIG.devops_defaults || {};
const DISCOVERY_STAGE = DEFAULTS.discovery_stage || 'dev测试';
// 发现阶段搜索词：取前缀部分（如 "dev测试" → "dev"）
const DISCOVERY_SEARCH = DISCOVERY_STAGE.replace(/测试|发布|编码|sit|sit测试|灰度/gi, '').trim() || DISCOVERY_STAGE.slice(0, 3);

// ===== helper =====
async function navigateToDefectList(page) {
  if (await page.locator('#tblnew').count() > 0) return true;
  console.log('  导航: 应用 → 研发管理(DMP)...');
  const clickText = (text) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('*')].find(e => e.textContent?.trim() === t && e.offsetParent !== null && e.children.length === 0);
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, text);
  await clickText('应用');
  await page.waitForTimeout(2000);
  await clickText('研发管理（DMP）');
  await page.waitForTimeout(5000);
  if (await page.locator('#tblnew').count() > 0) return true;
  // 真实 mouse.click 顶部"缺陷管理"图标（dispatchEvent 不导航，必须真实点击）
  console.log('  导航: 点击缺陷管理图标...');
  const coord = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => e.textContent?.trim() === '缺陷管理' && e.offsetParent !== null && e.children.length === 0);
    els.sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
    if (els[0]) { const r = els[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    return null;
  });
  if (coord) await page.mouse.click(coord.x, coord.y);
  await page.waitForTimeout(6000);
  return await page.locator('#tblnew').count() > 0;
}

async function openNewForm(page) {
  if (await page.locator('input[placeholder="名称不能为空"]:visible').count() > 0) return true;
  await navigateToDefectList(page);
  if (await page.locator('#tblnew').count() > 0) {
    console.log('  点击 #tblnew 打开新建...');
    await page.locator('#tblnew').click({ timeout: 5000 });
    await page.waitForTimeout(5000);
  }
  return await page.locator('input[placeholder="名称不能为空"]:visible').count() > 0;
}

async function fillBasedata(page, labelText, searchValue, optionText) {
  const field = page.locator('.kd-cq-field.kd-cq-basedata:visible', { hasText: labelText }).first();
  const inp = field.locator('input:visible').first();
  await inp.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await inp.fill(searchValue);
  await page.waitForTimeout(1200);
  await page.locator('.kd-cq-dropdown-menu-item:visible', { hasText: optionText || searchValue })
    .first().click({ timeout: 5000 });
  await page.waitForTimeout(500);
}

async function setStory(page, value) {
  const field = page.locator('.kd-cq-field.kd-cq-basedata:visible', { hasText: '关联故事' }).first();
  const inp = field.locator('input:visible').first();
  await inp.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await inp.fill(value);
  await page.waitForTimeout(2500);
  // 调用 setItemByNumber（需在搜索下拉打开的状态下调用）
  await page.evaluate((num) => {
    const f = [...document.querySelectorAll('.kd-cq-basedata')].find(x => x.offsetParent !== null && x.querySelector('.kd-cq-field-title-wrap')?.textContent?.trim().includes('关联故事'));
    if (!f) return;
    const fiberKey = Object.keys(f).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
    if (!fiberKey) return;
    let fiber = f[fiberKey];
    for (let i = 0; i < 20 && fiber; i++) {
      const inst = fiber.stateNode;
      if (inst && typeof inst === 'object' && typeof inst.setItemByNumber === 'function') {
        inst.setItemByNumber(num);
        return;
      }
      fiber = fiber.return;
    }
  }, value);
  await page.waitForTimeout(2000);
  console.log('  关联故事: 已设置', value);
}

// ===== main =====
const mode = process.argv[2];
const row = parseInt(process.argv[3]);
const storyValue = process.argv[4] || '';

if (!mode || !['auto', 'manual'].includes(mode)) {
  console.error('用法: node dmp-create.mjs <auto|manual> <row> [storyValue]'); process.exit(1);
}
if (!row) { console.error('缺少 row 参数'); process.exit(1); }

const defects = JSON.parse(fs.readFileSync('pending_defects.json', 'utf-8'));
const defect = defects.find(d => d.row === row);
if (!defect) { console.error(`找不到 row=${row}`); process.exit(1); }
if (defect.status === 'created') { console.log(`row=${row} 已创建: ${defect.devops_id}，跳过`); process.exit(0); }

console.log(`\n=== 模式: ${mode} | row=${row} ===`);
console.log(`标题: ${defect.title.slice(0, 40)}`);
console.log(`处理人: ${defect.handler_name} | 关联故事: ${storyValue || '(无)'}`);

const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('devops'));
if (!page) { console.error('找不到 DevOps 标签页，请确认已在 Chrome 中打开 DMP'); process.exit(1); }
await page.bringToFront();

// 检测浏览器名称，用于隐藏/恢复窗口
let _ver = '';
try { _ver = browser.version(); } catch {}
const _appName = (_ver || '').includes('Edg') ? 'Microsoft Edge' : 'Google Chrome';
let _browserHidden = false;

function hideBrowser() {
  if (_browserHidden) return;
  try {
    execSync(`osascript -e 'tell application "System Events" to set visible of process "${_appName}" to false'`, { stdio: 'ignore' });
    _browserHidden = true;
    console.log(`[browser] 已隐藏 ${_appName} 窗口，后台静默执行自动化...`);
  } catch (e) {
    console.log(`[browser] 隐藏窗口失败（继续执行）: ${e.message}`);
  }
}

function showBrowser() {
  if (!_browserHidden) return;
  try {
    execSync(`osascript -e 'tell application "${_appName}" to activate'`, { stdio: 'ignore' });
    _browserHidden = false;
    console.log(`[browser] 已恢复 ${_appName} 窗口`);
  } catch (e) {
    console.log(`[browser] 恢复窗口失败: ${e.message}`);
  }
}

// 确保任何退出路径都恢复浏览器窗口
process.on('exit', () => {
  if (_browserHidden) {
    try { execSync(`osascript -e 'tell application "${_appName}" to activate'`, { stdio: 'ignore' }); } catch {}
  }
});

hideBrowser();

let titleInput = null;

if (mode === 'manual') {
  // 手动模式：优先复用当前已打开的新建缺陷页，避免慢速导航
  titleInput = page.locator('input[placeholder="名称不能为空"]:visible').last();
  const alreadyForm = await titleInput.count() > 0;
  if (alreadyForm) {
    console.log('[manual] 检测到已打开的新建缺陷页，直接上传截图...');
  } else {
    console.log('[manual] 正在打开新建缺陷页...');
    const opened = await openNewForm(page);
    if (!opened) {
      console.error('❌ 无法自动打开新建表单。请先手动打开 DMP 新建缺陷页再试。');
      showBrowser();
      await browser.close(); process.exit(1);
    }
  }
} else {
  // 自动打开新建缺陷表单（导航到缺陷列表 + #tblnew）
  console.log('\n[0] 打开新建缺陷表单...');
  const opened = await openNewForm(page);
  if (!opened) {
    console.error('❌ 无法自动打开新建表单。');
    showBrowser();
    await browser.close(); process.exit(1);
  }
}

titleInput = page.locator('input[placeholder="名称不能为空"]:visible').last();

try {
  if (mode === 'auto') {
    // ===== 自动填字段 =====
    console.log('\n[1/6] 标题');
    await titleInput.click();
    await titleInput.fill(defect.title);

    console.log('[2/6] 描述');
    await page.evaluate((html) => {
      const ed = window.tinymce?.activeEditor || Object.values(window.tinymce?.editors || {})[0];
      if (ed) ed.setContent(html);
    }, '<p>' + defect.desc.replace(/\n/g, '</p><p>') + '</p>');

    console.log('[3/6] 处理人:', defect.handler_name);
    await fillBasedata(page, '处理人', defect.handler_name);

    console.log('[4/6] 发现阶段:', DISCOVERY_STAGE);
    await fillBasedata(page, '发现阶段', DISCOVERY_SEARCH, DISCOVERY_STAGE);

    console.log('[5/6] 备注');
    await page.locator('.kd-cq-field.kd-cq-textarea:visible', { hasText: '备注' }).first()
      .locator('textarea:visible').first().fill(defect.note);

    console.log('[6/6] 关联故事:', storyValue || '(跳过—未提供值)');
    if (storyValue) await setStory(page, storyValue);
  } else {
    console.log('\n[manual] 不自动填字段，仅上传截图，请手动填写其他信息。');
  }

  // [附件] 上传图片 —— 校验文件名出现 + 失败重试 + 换 input 索引（绝不静默丢失/传错位置）
  const imgFiles = [...(defect.screenshot_files || []), ...(defect.design_ref_files || [])]
    .map(f => 'images/' + f).filter(f => fs.existsSync(f));
  let uploadedCount = 0;
  if (imgFiles.length > 0) {
    console.log(`[附件] 上传 ${imgFiles.length} 张图片（校验+重试）`);
    for (const f of imgFiles) {
      const fname = f.split('/').pop();
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          // 第 1 次用 nth(1)（历史已知附件入口）；失败则尝试 nth(0)/nth(2)，避免传错区域
          const idx = attempt === 0 ? 1 : (attempt === 1 ? 0 : 2);
          const fileInput = page.locator('input[type=file]').nth(idx);
          if (await fileInput.count() === 0) continue;
          await fileInput.setInputFiles(f);
          await fileInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
          // 等附件区出现该文件名（最多 6s）—— 没出现视为未传成功，触发重试
          for (let j = 0; j < 15; j++) {
            await page.waitForTimeout(400);
            const has = await page.evaluate((fn) => {
              const els = [...document.querySelectorAll('*')];
              return els.some(e => e.children.length === 0 && e.textContent?.trim() === fn && e.offsetParent !== null)
                  || els.some(e => e.children.length === 0 && e.textContent?.includes(fn) && e.offsetParent !== null);
            }, fname);
            if (has) { ok = true; break; }
          }
        } catch (e) { /* 重试 */ }
      }
      console.log(`  ${ok ? '✅' : '❌'} ${fname}`);
      if (ok) uploadedCount++;
    }
    if (uploadedCount !== imgFiles.length) {
      console.log(`⚠️ 图片上传不全: ${uploadedCount}/${imgFiles.length}（可手动补传）`);
    }
  }

  console.log('\n✅ 已就绪，请用户在浏览器中检查并手动点击保存。');
  showBrowser();
  await page.screenshot({ path: `screenshots/ready_${row}.png` }).catch(()=>{});
  process.exit(0);
} catch (e) {
  console.error('\n❌ 执行失败:', e.message);
  showBrowser();
  await page.screenshot({ path: `screenshots/error_${row}.png` }).catch(()=>{});
  process.exit(1);
}
