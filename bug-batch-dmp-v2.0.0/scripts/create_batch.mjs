#!/usr/bin/env node
/**
 * 批量创建 DevOps 缺陷（优化版：connect 一次 + goto 列表 + 事件等待 + 图片校验重试）
 *
 * 用法:
 *   node scripts/create_batch.mjs [storyValue] [saveMethod] [rows|filter]
 *
 * 参数:
 *   storyValue - 关联故事编码（如 PRJ-00761367）
 *   saveMethod - dispatch | click(默认) | enter
 *   rows/filter - 可选：
 *                  'pending'(默认，所有待创建)
 *                  '待修改' / '已修改' / '待沟通'（按标题进度筛）
 *                  '49,54,141'（指定 row 列表）
 *
 * 优化点（相比 spawnSync 版）:
 *   1. connectOverCDP 只连接一次，所有缺陷复用同一 page（省去每条重连）
 *   2. 用 page.goto(列表URL) 代替 UI 点击导航（13s → ~3s）
 *   3. 用 waitForSelector/waitForResponse 代替固定 waitForTimeout
 *   4. 图片上传：校验文件名出现 + 失败重试 + 换 input 索引（不丢不混）
 *
 * 前提: launch_cdp.mjs 已启动 Chrome（CDP 9222）且已登录 DevOps。
 */
import { chromium } from 'playwright';
import fs from 'fs';

// ===== 加载配置（发现阶段等默认值） =====
let CONFIG = {};
try {
  const yaml = (await import('js-yaml')).default || (await import('js-yaml'));
  CONFIG = yaml.load(fs.readFileSync('config.yaml', 'utf-8')) || {};
} catch {
  try { CONFIG = JSON.parse(fs.readFileSync('config.yaml', 'utf-8')); } catch {}
}
const DEFAULTS = CONFIG.devops_defaults || {};
const DISCOVERY_STAGE = DEFAULTS.discovery_stage || 'dev测试';
const DISCOVERY_SEARCH = DISCOVERY_STAGE.replace(/测试|发布|编码|sit|sit测试|灰度/gi, '').trim() || DISCOVERY_STAGE.slice(0, 3);

const storyValue = process.argv[2] || '';
const saveMethod = process.argv[3] || 'click';
const sel = process.argv[4] || 'pending';

const LIST_URL = fs.existsSync('.defect-list-url.txt')
  ? fs.readFileSync('.defect-list-url.txt', 'utf-8').trim()
  : 'https://devops.kingdee.com:8000/';

// ===== 筛选缺陷 =====
const all = JSON.parse(fs.readFileSync('pending_defects.json', 'utf-8'));
let targets;
if (/^\d+(,\d+)*$/.test(sel)) {
  const rows = sel.split(',').map(Number);
  targets = all.filter(d => rows.includes(d.row));
} else if (/^(待修改|已修改|待沟通)$/.test(sel)) {
  targets = all.filter(d => d.title.includes(`【${sel}】`));
} else {
  targets = all.filter(d => true);
}
targets = targets.filter(d => d.status === 'pending'); // 只跑未创建的
if (targets.length === 0) { console.log('没有符合条件的待创建缺陷'); process.exit(0); }

console.log(`\n==== 批量创建 ${targets.length} 条（connect-once 优化版）====`);
console.log(`关联故事: ${storyValue || '(无)'} | 保存: ${saveMethod} | 筛选: ${sel}`);
targets.forEach(d => console.log(`  - row=${d.row}: ${d.title.slice(0, 30)}`));

// ===== helpers =====
async function goToList(page) {
  if (await page.locator('#tblnew').count() > 0) return true;
  // 优先 goto（快），失败 fallback UI 导航
  try {
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    for (let i = 0; i < 10; i++) {
      if (await page.locator('#tblnew').count() > 0) return true;
      await page.waitForTimeout(800);
    }
  } catch (e) { /* fall through */ }
  console.log('  goto 未命中列表，改用 UI 导航...');
  const clickText = (t) => page.evaluate((text) => {
    const el = [...document.querySelectorAll('*')].find(e => e.textContent?.trim() === text && e.offsetParent !== null && e.children.length === 0);
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, t);
  await clickText('应用'); await page.waitForTimeout(1500);
  await clickText('研发管理（DMP）'); await page.waitForTimeout(4000);
  if (await page.locator('#tblnew').count() > 0) return true;
  const coord = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => e.textContent?.trim() === '缺陷管理' && e.offsetParent !== null && e.children.length === 0);
    els.sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
    if (els[0]) { const r = els[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    return null;
  });
  if (coord) await page.mouse.click(coord.x, coord.y);
  for (let i = 0; i < 10; i++) {
    if (await page.locator('#tblnew').count() > 0) return true;
    await page.waitForTimeout(800);
  }
  return false;
}

async function openNewForm(page) {
  if (await page.locator('input[placeholder="名称不能为空"]:visible').count() > 0) return true;
  if (!(await goToList(page))) return false;
  await page.locator('#tblnew').click({ timeout: 5000 });
  try {
    await page.locator('input[placeholder="名称不能为空"]:visible').last().waitFor({ state: 'visible', timeout: 12000 });
    await page.waitForTimeout(1500); // 表单渲染
    return true;
  } catch { return false; }
}

async function fillBasedata(page, labelText, searchValue, optionText) {
  const field = page.locator('.kd-cq-field.kd-cq-basedata:visible', { hasText: labelText }).first();
  const inp = field.locator('input:visible').first();
  await inp.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  await inp.fill(searchValue);
  // 等下拉项出现（替代固定 wait 1200）
  try {
    await page.locator('.kd-cq-dropdown-menu-item:visible').first().waitFor({ state: 'attached', timeout: 4000 });
  } catch {}
  await page.waitForTimeout(400);
  await page.locator('.kd-cq-dropdown-menu-item:visible', { hasText: optionText || searchValue })
    .first().click({ timeout: 5000 });
  await page.waitForTimeout(300);
}

async function setStory(page, value) {
  const field = page.locator('.kd-cq-field.kd-cq-basedata:visible', { hasText: '关联故事' }).first();
  const inp = field.locator('input:visible').first();
  await inp.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  await inp.fill(value);
  await page.waitForTimeout(1000); // 搜索触发
  // 调 setItemByNumber（沿 fiber 找 stateNode.setItemByNumber）
  await page.evaluate((num) => {
    const f = [...document.querySelectorAll('.kd-cq-basedata')].find(x => x.offsetParent !== null && x.querySelector('.kd-cq-field-title-wrap')?.textContent?.trim().includes('关联故事'));
    if (!f) return;
    const fiberKey = Object.keys(f).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
    if (!fiberKey) return;
    let fiber = f[fiberKey];
    for (let i = 0; i < 20 && fiber; i++) {
      const inst = fiber.stateNode;
      if (inst && typeof inst === 'object' && typeof inst.setItemByNumber === 'function') { inst.setItemByNumber(num); return; }
      fiber = fiber.return;
    }
  }, value);
  await page.waitForTimeout(1500);
}

async function uploadImages(page, defect) {
  const imgFiles = [...(defect.screenshot_files || []), ...(defect.design_ref_files || [])]
    .map(f => 'images/' + f).filter(f => fs.existsSync(f));
  if (!imgFiles.length) return { expected: 0, uploaded: 0 };
  let uploaded = 0;
  for (const f of imgFiles) {
    const fname = f.split('/').pop();
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        // 第 1 次 nth(1)（历史已知附件入口）；失败尝试 nth(0)/nth(2)，避免传错区域
        const idx = attempt === 0 ? 1 : (attempt === 1 ? 0 : 2);
        const fileInput = page.locator('input[type=file]').nth(idx);
        if (await fileInput.count() === 0) continue;
        await fileInput.setInputFiles(f);
        await fileInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        // 等附件区出现该文件名（最多 12s）；没出现视为失败，触发重试
        for (let j = 0; j < 24; j++) {
          await page.waitForTimeout(500);
          const has = await page.evaluate((fn) => {
            const els = [...document.querySelectorAll('*')];
            return els.some(e => e.children.length === 0 && e.textContent?.trim() === fn && e.offsetParent !== null)
                || els.some(e => e.children.length === 0 && e.textContent?.includes(fn) && e.offsetParent !== null);
          }, fname);
          if (has) { ok = true; break; }
        }
      } catch { /* 重试 */ }
    }
    console.log(`    ${ok ? '✅' : '❌'} ${fname}`);
    if (ok) uploaded++;
  }
  return { expected: imgFiles.length, uploaded };
}

async function syncReact(page) {
  await page.evaluate(() => {
    const trigger = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); };
    const title = document.querySelector('input[placeholder="名称不能为空"]');
    if (title) trigger(title);
    document.querySelectorAll('textarea').forEach(trigger);
    document.querySelectorAll('.kd-cq-basedata input:not([type=hidden]):not([type=file])').forEach(el => { if (el.offsetParent !== null) trigger(el); });
  });
  await page.waitForTimeout(600);
}

async function createDefect(page, defect, storyValue, saveMethod) {
  console.log(`\n--- row=${defect.row}: ${defect.title.slice(0, 30)} ---`);
  const t0 = Date.now();
  if (!(await openNewForm(page))) { console.log('  ❌ 无法打开新建表单'); return { ok: false, reason: 'no_form' }; }
  const titleInput = page.locator('input[placeholder="名称不能为空"]:visible').last();

  // 填字段
  await titleInput.click();
  await titleInput.fill(defect.title);
  await page.evaluate((html) => {
    const ed = window.tinymce?.activeEditor || Object.values(window.tinymce?.editors || {})[0];
    if (ed) ed.setContent(html);
  }, '<p>' + defect.desc.replace(/\n/g, '</p><p>') + '</p>');
  console.log('  填字段: 处理人/发现阶段/备注/关联故事...');
  await fillBasedata(page, '处理人', defect.handler_name);
  await fillBasedata(page, '发现阶段', DISCOVERY_SEARCH, DISCOVERY_STAGE);
  await page.locator('.kd-cq-field.kd-cq-textarea:visible', { hasText: '备注' }).first()
    .locator('textarea:visible').first().fill(defect.note);
  if (storyValue) await setStory(page, storyValue);

  // 附件（校验+重试，不丢不混）
  const img = await uploadImages(page, defect);
  if (img.expected > 0) console.log(`  图片: ${img.uploaded}/${img.expected}`);

  // 保存前编号（表单预分配）
  const beforeCode = await page.evaluate(() => [...document.querySelectorAll('*')].find(e => /^BT-\d+$/.test(e.textContent?.trim()||'') && e.children.length===0 && e.offsetParent!==null)?.textContent?.trim() || '');
  console.log('  保存前编号:', beforeCode || '(无)');

  // 监听保存请求（仅判断 ac=save 是否触发；其响应体是 InvokeControl，含固定 bugplans 编号，不可用作新编号）
  let saveTriggered = false;
  const respHandler = (r) => {
    try { const u = r.url(); if (u.includes('ac=save') && !u.includes('saveSetting')) saveTriggered = true; } catch {}
  };
  page.on('response', respHandler);

  await syncReact(page);
  await titleInput.click();
  await page.waitForTimeout(300);

  if (saveMethod === 'dispatch') {
    await page.evaluate(() => document.querySelector('#bar_save')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  } else if (saveMethod === 'enter') {
    await page.keyboard.press('Enter');
  } else {
    try { await page.locator('#bar_save:visible').click({ timeout: 15000 }); } catch (e) { console.log('  click 保存失败:', e.message.slice(0, 50)); }
  }

  // 立即轮询读表单新编号（趁表单跳走前，最多 8s）：读页面所有 BT-编号，filter != before 取最大
  // （保存后表单编号字段会更新为新编号；ac=save 响应不可靠，故读页面）
  let newCode = '';
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const codes = await page.evaluate(() => [...new Set([...document.querySelectorAll('*')].filter(e => /^BT-\d+$/.test(e.textContent?.trim()||'') && e.children.length===0 && e.offsetParent!==null).map(e => e.textContent.trim()))]);
    const cand = codes.filter(c => c !== beforeCode).sort();
    if (cand.length) { newCode = cand[cand.length-1]; break; }
  }
  page.off('response', respHandler);
  await page.waitForTimeout(1000);

  // fallback：如果页面跳走没读到新编号，用保存前编号（可能就是最终编号）
  if (!newCode) newCode = beforeCode;
  console.log(`  保存: ${saveTriggered ? '✅ ac=save' : '❌ 无响应'} | 编号 ${newCode || '(未取到)'} | 耗时 ${((Date.now()-t0)/1000).toFixed(1)}s`);

  if (saveTriggered) {
    defect.status = 'created';
    // defect.devops_id = newCode; // 编号读取失败（保存后页面跳走），事后对账
    return { ok: true, code: newCode, img };
  }
  await page.screenshot({ path: `screenshots/create_${defect.row}.png` });
  return { ok: false, reason: 'no_save', img };
}

// ===== main =====
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('devops'));
if (!page) { console.error('❌ 找不到 DevOps 标签页（先运行 node scripts/launch_cdp.mjs）'); process.exit(1); }
await page.bringToFront();

let ok = 0, fail = 0, consecFail = 0, stopped = false;
const failed = [], partialImg = [];
for (let i = 0; i < targets.length; i++) {
  const d = targets[i];
  console.log(`\n======== [${i+1}/${targets.length}] ========`);
  // 会话过期检测（DevOps ~30min 过期）
  const expired = await page.evaluate(() => /会话缓存丢失|重新登录|会话已过期|login/.test(document.body?.innerText || '') && !/缺陷管理|新建/.test(document.title || '')).catch(() => false);
  if (expired) { console.log('⚠️ 检测到会话过期，停止批量（请重新登录后再次运行，剩余 pending 会继续）'); stopped = true; break; }
  try {
    const r = await createDefect(page, d, storyValue, saveMethod);
    if (r.ok) {
      ok++; consecFail = 0;
      fs.writeFileSync('pending_defects.json', JSON.stringify(all, null, 2)); // 每条成功即落盘
      console.log(`  ✅✅ row=${d.row} -> ${r.code || '(编号待补)'}`);
      if (r.img.expected > 0 && r.img.uploaded < r.img.expected) {
        partialImg.push({ row: d.row, got: r.img.uploaded, need: r.img.expected });
        console.log(`  ⚠️ 图片不全(${r.img.uploaded}/${r.img.expected})，稍后用 reupload_smart 补传`);
      }
    } else {
      fail++; consecFail++;
      failed.push({ row: d.row, reason: r.reason }); console.log(`  ⚠️ row=${d.row} 失败: ${r.reason}`);
      if (consecFail >= 3) { console.log('⚠️ 连续 3 条失败，疑似会话过期/异常，停止批量'); stopped = true; break; }
    }
  } catch (e) {
    fail++; consecFail++;
    failed.push({ row: d.row, reason: e.message.slice(0, 80) });
    console.log(`  ⚠️ row=${d.row} 异常:`, e.message.slice(0, 80));
    if (consecFail >= 3) { console.log('⚠️ 连续 3 条异常，停止批量'); stopped = true; break; }
  }
  await page.waitForTimeout(1200);
}

console.log(`\n==== 完成 ====`);
if (stopped) console.log('⏹️ 批量提前停止（会话过期或连续失败），剩余 pending 下次运行继续');
console.log(`成功: ${ok} | 失败: ${fail}`);
if (failed.length) { console.log('失败:'); failed.forEach(f => console.log(`  row=${f.row}: ${f.reason}`)); }
if (partialImg.length) { console.log('图片不全(需补传):'); partialImg.forEach(p => console.log(`  row=${p.row}: ${p.got}/${p.need}`)); }
const final = JSON.parse(fs.readFileSync('pending_defects.json', 'utf-8'));
console.log(`总计: created ${final.filter(d=>d.status==='created').length} | pending ${final.filter(d=>d.status==='pending').length}`);
await browser.close();
