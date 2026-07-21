#!/usr/bin/env node
/**
 * 智能补传：自动找出有图片但未上传完整的已创建缺陷
 *
 * 用法: node scripts/reupload_smart.mjs [rows]
 *
 * 参数: rows - 可选，指定行号（逗号分隔）。不传则自动检测所有有图片文件的已创建缺陷。
 */
import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('devops'));
if (!page) { console.error('无 DevOps 页面'); process.exit(1); }
await page.bringToFront();

const defects = JSON.parse(fs.readFileSync('pending_defects.json', 'utf-8'));
// 智能检测：有图片文件的已创建缺陷（可通过 CLI 参数指定行号）
const sel = process.argv[2] || '';
let pending;
if (/^\d+(,\d+)*$/.test(sel)) {
  const needRows = sel.split(',').map(Number);
  pending = needRows.map(r => defects.find(d => d.row === r)).filter(d => d && (d.screenshot_files?.length || d.design_ref_files?.length));
} else {
  pending = defects.filter(d => d.status === 'created' && (d.screenshot_files?.length || d.design_ref_files?.length));
}

console.log(`\n==== 智能补传 ${pending.length} 条（打开任意编辑页面，自动匹配）====`);
pending.forEach(d => console.log(`  - ${d.desc.slice(0, 25)}`));
console.log('\n打开任意一条编辑页面，脚本自动匹配标题上传图片。\n');

const done = new Set();

while (done.size < pending.length) {
  const remain = pending.filter(d => !done.has(d.row));
  console.log(`\n剩余 ${remain.length} 条，请打开任意一条编辑页面，等待中...`);
  remain.forEach(d => console.log(`  - ${d.desc.slice(0, 25)}`));

  // 等编辑页面打开
  while (true) {
    try {
      const cnt = await page.locator('input[placeholder="名称不能为空"]:visible').count().catch(() => 0);
      if (cnt > 0) break;
    } catch(e) {}
    await new Promise(r => setTimeout(r, 2000));
  }

  // 读当前编辑页面的标题，匹配缺陷
  const curTitle = await page.locator('input[placeholder="名称不能为空"]:visible').last().inputValue().catch(() => '');
  const match = pending.find(d => d.desc && curTitle.includes(d.desc.slice(0, 12)));

  if (!match) {
    console.log(`⚠️ 当前页面（${curTitle.slice(0, 25)}）不在补传列表，请打开列表中的缺陷。`);
    // 等用户关闭/换页面
    await new Promise(r => setTimeout(r, 5000));
    continue;
  }

  console.log(`✅ 匹配: row=${match.row} (${match.desc.slice(0, 20)})`);
  done.add(match.row);

  // 上传图片（幂等：已有跳过，缺的才传，带校验+重试）
  const imgFiles = [...(match.screenshot_files || []), ...(match.design_ref_files || [])].map(f => 'images/' + f).filter(f => fs.existsSync(f));
  for (const f of imgFiles) {
    const fname = f.split('/').pop();
    // 检查是否已存在（幂等，避免重复附件）
    const already = await page.evaluate((n) => document.body.innerText.includes(n), fname);
    if (already) { console.log(`  ✅ 已存在，跳过: ${fname}`); continue; }
    console.log(`  补传: ${fname}`);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const idx = attempt === 0 ? 1 : (attempt === 1 ? 0 : 2);
        const fileInput = page.locator('input[type=file]').nth(idx);
        if (await fileInput.count() === 0) continue;
        await fileInput.setInputFiles(f);
        await fileInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        for (let j = 0; j < 24; j++) {
          await page.waitForTimeout(500);
          const hasAttach = await page.evaluate((fn) => document.body.innerText.includes(fn), fname);
          if (hasAttach) { ok = true; break; }
        }
      } catch(e) { /* 重试 */ }
    }
    console.log(`    ${ok ? '✅ 已上传' : '❌ 失败'}`);
  }

  // React 同步 + 保存
  console.log('  保存...');
  await page.evaluate(() => {
    const trigger = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); };
    const title = document.querySelector('input[placeholder="名称不能为空"]');
    if (title) trigger(title);
    document.querySelectorAll('textarea').forEach(trigger);
    document.querySelectorAll('.kd-cq-basedata input:not([type=hidden]):not([type=file])').forEach(el => { if (el.offsetParent !== null) trigger(el); });
  });
  await page.waitForTimeout(1000);
  await page.locator('input[placeholder="名称不能为空"]:visible').last().click();
  await page.locator('#bar_save').click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(10000);
  console.log('✅ 保存完成');
  await new Promise(r => setTimeout(r, 2000));
}

console.log('\n==== 全部补传完成 ====');
await browser.close();
