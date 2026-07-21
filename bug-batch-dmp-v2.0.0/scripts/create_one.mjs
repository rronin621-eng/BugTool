#!/usr/bin/env node
/**
 * 一键创建单条 DevOps 缺陷（Playwright + CDP 方案）
 *
 * 用法:
 *   node scripts/create_one.mjs <row> [storyValue] [saveMethod]
 *
 * 参数:
 *   row        - pending_defects.json 里的 row 号（必填）
 *   storyValue - 关联故事的搜索词/编码（可选；今天拿不到就不传，会跳过）
 *   saveMethod - dispatch(默认) | click | enter
 *
 * 前提:
 *   1. 已通过 scripts/launch_cdp.mjs 启动 Chrome（CDP 端口 9222）
 *   2. 浏览器里已登录 DevOps 并打开了「新建缺陷」表单
 *
 * 流程: 填标题/描述/处理人/发现阶段/备注/关联故事 → 保存 → 取编号 → 更新 json
 * 失败时会 dump 所有字段值和错误，便于定位。
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
const row = parseInt(process.argv[2]);
const storyValue = process.argv[3] || '';
const saveMethod = process.argv[4] || 'click';

if (!row) { console.error('用法: node scripts/create_one.mjs <row> [storyValue] [saveMethod]'); process.exit(1); }

const defects = JSON.parse(fs.readFileSync('pending_defects.json', 'utf-8'));
const defect = defects.find(d => d.row === row);
if (!defect) { console.error(`找不到 row=${row}`); process.exit(1); }
if (defect.status === 'created') { console.log(`row=${row} 已创建: ${defect.devops_id}，跳过`); process.exit(0); }

console.log(`\n=== 创建 row=${row} ===`);
console.log(`标题: ${defect.title.slice(0, 40)}`);
console.log(`处理人: ${defect.handler_name} | 关联故事: ${storyValue || '(无)'} | 保存方式: ${saveMethod}`);

const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('devops'));
if (!page) { console.error('找不到 DevOps 标签页（先运行 launch_cdp.mjs）'); process.exit(1); }
await page.bringToFront();

// 自动打开新建缺陷表单（导航到缺陷列表 + #tblnew）
console.log('\n[0] 打开新建缺陷表单...');
const opened = await openNewForm(page);
if (!opened) {
  console.error('❌ 无法自动打开新建表单。');
  await browser.close(); process.exit(1);
}
const titleInput = page.locator('input[placeholder="名称不能为空"]:visible').last();

try {
  // ===== 填字段 =====
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
          // 等附件区出现该文件名（最多 12s）—— 没出现视为未传成功，触发重试
          for (let j = 0; j < 24; j++) {
            await page.waitForTimeout(500);
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
      console.log(`⚠️ 图片上传不全: ${uploadedCount}/${imgFiles.length}（仍将尝试保存，事后可用 reupload_smart 补传）`);
    }
  }

  // verify（一次性 dump，不来回验证）
  const v = await page.evaluate(() => {
    const get = (lt) => {
      const f = [...document.querySelectorAll('.kd-cq-field')].filter(x => x.offsetParent !== null).find(x => {
        const t = x.querySelector('.kd-cq-field-title-wrap')?.textContent?.trim();
        return t === lt || t === lt + '*';
      });
      const inp = f?.querySelector('input:not([type=hidden]):not([type=file])');
      const ta = f?.querySelector('textarea');
      return (inp?.offsetParent !== null ? inp?.value : '') || (ta?.offsetParent !== null ? ta?.value : '') || '(空)';
    };
    return { 标题: get('标题')?.slice(0,30), 处理人: get('处理人'), 发阶段: get('发现阶段'), 关联故事: get('关联故事'), 备注: get('备注')?.slice(0,20) };
  });
  console.log('verify:', JSON.stringify(v));

  // ===== 保存 =====
  console.log(`\n[保存] 方法=${saveMethod}`);
  let beforeCode = '';
  for (let i = 0; i < 10; i++) {
    beforeCode = await page.evaluate(() => [...document.querySelectorAll('*')].find(e => /^BT-\d+$/.test(e.textContent?.trim()||'') && e.children.length===0 && e.offsetParent!==null)?.textContent?.trim() || '');
    if (beforeCode) break;
    await page.waitForTimeout(500);
  }
  console.log('保存前编码:', beforeCode);

  const responses = [];
  let saveBody = '';
  const allRespCodes = new Set();
  page.on('response', async (r) => {
    try {
      const t = await r.text();
      const u = r.url();
      responses.push({ method: r.request().method(), url: u.slice(-55), status: r.status(), body: t.slice(0, 150) });
      if (u.includes('ac=save') && !u.includes('saveSetting')) saveBody = t;
      const ms = t.match(/BT-\d+/g);
      if (ms) ms.forEach(c => allRespCodes.add(c));
    } catch(e) { responses.push({ method: r.request().method(), url: r.url().slice(-55), status: r.status(), body: '[read failed]' }); }
  });

  await titleInput.click(); // focus 表单
  await page.waitForTimeout(300);

  // 同步 React 状态（fill 后需触发 input/change/blur，否则保存不发请求）
  await page.evaluate(() => {
    const trigger = (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    const title = document.querySelector('input[placeholder="名称不能为空"]');
    if (title) trigger(title);
    document.querySelectorAll('textarea').forEach(trigger);
    document.querySelectorAll('.kd-cq-basedata input:not([type=hidden]):not([type=file])').forEach(el => {
      if (el.offsetParent !== null) trigger(el);
    });
  });
  await page.waitForTimeout(1000);

  if (saveMethod === 'dispatch') {
    await page.evaluate(() => document.querySelector('#bar_save')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  } else if (saveMethod === 'click') {
    try { await page.locator('#bar_save:visible').click({ timeout: 15000 }); }
    catch (e) { console.log('click 失败:', e.message.slice(0, 60)); }
  } else if (saveMethod === 'enter') {
    await page.keyboard.press('Enter');
  }
  // 轮询读表单编号（保存成功后、表单关闭前，编号会更新为新编号）
  let savedCode = '';
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    const c = await page.evaluate(() => [...document.querySelectorAll('*')].find(e => /^BT-\d+$/.test(e.textContent?.trim()||'') && e.children.length === 0 && e.offsetParent !== null)?.textContent?.trim() || '');
    if (c && c !== beforeCode) { savedCode = c; console.log('读到新编号:', savedCode); break; }
  }
  await page.waitForTimeout(2500);

  // ===== 检查结果 =====
  const after = await page.evaluate(() => {
    const codes = [...new Set([...document.querySelectorAll('*')]
      .filter(e => /^BT-\d+$/.test(e.textContent?.trim()||'') && e.children.length===0 && e.offsetParent!==null)
      .map(e => e.textContent.trim()))];
    const errs = [...new Set([...document.querySelectorAll('[class*="valid-tip"],[role="alert"]')]
      .filter(e => e.offsetParent!==null && e.textContent?.trim())
      .map(e => e.textContent.trim().slice(0, 40)))];
    return { codes, errs, hasTitle: [...document.querySelectorAll('input[placeholder="名称不能为空"]')].filter(e => e.offsetParent!==null).length };
  });
  console.log('保存后编码:', after.codes);
  console.log('表单还在:', after.hasTitle > 0);
  console.log('错误:', after.errs);
  console.log('请求数:', responses.length);
  responses.forEach((r,i) => console.log(`  [${i}] ${r.method} ${r.status} ${r.url} | ${r.body.replace(/\s+/g,' ').slice(0, 80)}`));

  await page.screenshot({ path: `screenshots/create_${row}.png` });

  // ===== 判断成功 =====
  const emptyErr = after.errs.some(e => e.includes('不能为空'));
  // 检查是否有缺陷保存 API 调用（ac=save，排除 saveSetting）
  const hasSaveApi = responses.some(r => r.url.includes('ac=save') && !r.url.includes('saveSetting') && !r.url.includes('saveSetting'));
  console.log('[调试] saveBody(1200):', saveBody.slice(0, 1200));
  console.log('[调试] 响应中的编号:', [...allRespCodes].sort());
  if (hasSaveApi && !emptyErr) {
    // 优先从 ac=save 响应取编号，否则用响应中最大的新编号
    const m = saveBody.match(/BT-\d+/);
    const newCode = m ? m[0] : ([...allRespCodes].filter(c => c !== beforeCode).sort().pop() || savedCode || (after.codes.filter(c => c !== beforeCode).sort().pop() || after.codes[0]));
    defect.status = 'created';
    defect.devops_id = newCode;
    fs.writeFileSync('pending_defects.json', JSON.stringify(defects, null, 2));
    console.log(`\n✅✅✅ 成功创建: ${newCode}（已更新 pending_defects.json）`);
  } else {
    console.log('\n❌ 创建未成功。请检查上面的 verify、错误信息和截图 screenshots/create_' + row + '.png');
    console.log('   常见原因: 关联故事为空(必填)、保存方式无效、字段定位失败');
    console.log('   hasSaveApi=' + hasSaveApi + ' emptyErr=' + emptyErr);
  }
} catch (e) {
  console.log('\n❌ 脚本异常:', e.message);
  await page.screenshot({ path: `screenshots/error_${row}.png` }).catch(()=>{});
} finally {
  await browser.close();
}
