import { chromium } from 'playwright';
import fs from 'fs';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('devops'));
if (!page) { console.error('无 DevOps 页'); process.exit(1); }
await page.bringToFront();
const LIST_URL = fs.readFileSync('.defect-list-url.txt', 'utf-8').trim();
const data = JSON.parse(fs.readFileSync('pending_defects.json', 'utf-8'));

const sel = process.argv[2] || '';
// 默认：检查所有有图片文件的已创建缺陷（可通过 CLI 参数指定行号）
let checkRows;
if (/^\d+(,\d+)*$/.test(sel)) {
  checkRows = sel.split(',').map(Number);
} else {
  checkRows = data.filter(d => d.status === 'created' && (d.screenshot_files?.length || d.design_ref_files?.length)).map(d => d.row);
}
const targets = data.filter(d => checkRows.includes(d.row) && d.status === 'created');

async function goToList(page) {
  if (await page.locator('#tblnew').count() > 0) return true;
  try { await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch {}
  for (let i = 0; i < 10; i++) { if (await page.locator('#tblnew').count() > 0) break; await page.waitForTimeout(800); }
  if (await page.locator('#tblnew').count() > 0) return true;
  const clickText = async (t) => page.evaluate((text) => {
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
  for (let i = 0; i < 12; i++) { if (await page.locator('#tblnew').count() > 0) return true; await page.waitForTimeout(800); }
  return false;
}

async function openEdit(page, title) {
  await goToList(page);
  const search = page.locator('input[placeholder*="搜索缺陷"]').first();
  await search.click({ clickCount: 3 }); await page.keyboard.press('Backspace');
  await search.fill(title.slice(0, 15));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  // 双击第一数据行
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr,[role=row]')].filter(e => e.offsetParent !== null);
    const r = rows[1];
    if (r) { const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true }); r.dispatchEvent(ev); }
  });
  try { await page.locator('input[placeholder="名称不能为空"]:visible').last().waitFor({ state: 'visible', timeout: 10000 }); await page.waitForTimeout(1500); return true; }
  catch { return false; }
}

async function uploadMissing(page, files) {
  let up = 0;
  for (const f of files) {
    const fn = f.split('/').pop();
    let ok = false;
    for (let a = 0; a < 3 && !ok; a++) {
      try {
        const idx = a === 0 ? 1 : (a === 1 ? 0 : 2);
        const fi = page.locator('input[type=file]').nth(idx);
        if (await fi.count() === 0) continue;
        await fi.setInputFiles(f);
        await fi.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        for (let j = 0; j < 24; j++) { await page.waitForTimeout(500); const has = await page.evaluate((n) => document.body.innerText.includes(n), fn); if (has) { ok = true; break; } }
      } catch {}
    }
    if (ok) up++;
  }
  return up;
}

console.log(`\n==== 核查 ${targets.length} 条缺陷附件 ====`);
const report = [];
for (const d of targets) {
  const imgs = [...(d.screenshot_files || []), ...(d.design_ref_files || [])].map(f => 'images/' + f).filter(f => fs.existsSync(f));
  console.log(`\nrow=${d.row}: ${d.title.slice(0, 25)}`);
  if (imgs.length === 0) { console.log('  无图片文件，跳过'); continue; }
  const opened = await openEdit(page, d.title);
  if (!opened) { console.log('  ❌ 打不开编辑页（可能搜索未命中）'); report.push({ row: d.row, ok: false, reason: 'no_edit' }); continue; }
  // 检查每个预期文件是否已在页面
  const present = [];
  for (const f of imgs) {
    const fn = f.split('/').pop();
    const has = await page.evaluate((n) => document.body.innerText.includes(n), fn);
    present.push(has);
  }
  const presentCount = present.filter(Boolean).length;
  const missing = imgs.filter((_, i) => !present[i]);
  console.log(`  附件已有: ${presentCount}/${imgs.length}` + (missing.length ? ` → 缺 ${missing.length}，补传` : ' ✅'));
  let fixed = 0;
  if (missing.length) {
    fixed = await uploadMissing(page, missing);
    console.log(`  补传: ${fixed}/${missing.length}`);
    if (fixed > 0) {
      await page.evaluate(() => { const t = document.querySelector('input[placeholder="名称不能为空"]'); if (t) { t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); t.dispatchEvent(new Event('blur', { bubbles: true })); } });
      await page.waitForTimeout(500);
      try { await page.locator('#bar_save:visible').click({ timeout: 10000 }); } catch {}
      await page.waitForTimeout(3000);
    }
  }
  report.push({ row: d.row, need: imgs.length, had: presentCount, fixed });
}
console.log('\n==== 报告 ====');
console.log(JSON.stringify(report, null, 2));
fs.writeFileSync('attachment_report.json', JSON.stringify(report, null, 2));
console.log('已写 attachment_report.json');
process.exit(0);
