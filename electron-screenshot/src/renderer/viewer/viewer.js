/* viewer.js — BUG 查看器渲染进程逻辑 */

const API_BASE = 'http://127.0.0.1:8000';

// ── 页签定义 ──────────────────────────────────────────────────────────────
const TABS = {
  pending: { label: '待处理', statuses: ['new', 'in_progress'] },
  review:  { label: '待验收', statuses: ['fixed'] },
  closed:  { label: '已关闭', statuses: ['closed'] },
};

// ── 状态 ──────────────────────────────────────────────────────────────────
const state = {
  users: [],
  currentUserId: null,
  bugs: [],           // all fetched bugs (no status filter)
  activeTab: 'pending',
  detailOpen: false,
  currentDetail: null,
  isPinned: false,
  readIds: new Set(), // bug ids already read (from localStorage)
  pollTimer: null,
  filterOpen: false,
  activeFilter: { priority: '', bug_type: '', keyword: '' },
};

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const elUserSelect    = $('userSelect');
const elBugCount      = $('bugCount');
const elBugList       = $('bugList');
const elDetailPanel   = $('detailPanel');
const elDetailBadge   = $('detailBadge');
const elDetailContent = $('detailContent');
const elBtnClose      = $('btnClose');
const elBtnRefresh    = $('btnRefresh');
const elBtnPin        = $('btnPin');
const elBtnFilter     = $('btnFilter');
const elFilterDrawer  = $('filterDrawer');
const elBtnDetailBack = $('btnDetailBack');

// ── 工具函数 ──────────────────────────────────────────────────────────────
function statusLabel(s) {
  const map = { new: '新建', in_progress: '处理中', fixed: '已修复', closed: '已关闭' };
  return map[s] || s;
}

function bugTypeLabel(t) {
  const map = { ui: 'UI', functional: '功能', performance: '性能', security: '安全', other: '其他' };
  return map[t] || t;
}

function priorityLabel(p) {
  const map = { low: '低', medium: '中', high: '高', critical: '严重' };
  return map[p] || p;
}

function formatDate(s) {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d)) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function screenshotUrl(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  return `${API_BASE}/${filePath.replace(/^\//, '')}`;
}

function mergeAndDedup(arr1, arr2) {
  const map = new Map();
  [...arr1, ...arr2].forEach((b) => map.set(b.id, b));
  return Array.from(map.values());
}

// ── 持久化偏好 ────────────────────────────────────────────────────────────
function savePrefs() {
  localStorage.setItem('viewer_userId', state.currentUserId ?? '');
  localStorage.setItem('viewer_activeTab', state.activeTab);
  localStorage.setItem('viewer_isPinned', String(state.isPinned));
}

function loadPrefs() {
  const uid = localStorage.getItem('viewer_userId');
  state.currentUserId = uid ? Number(uid) : null;

  const tab = localStorage.getItem('viewer_activeTab');
  if (tab && TABS[tab]) state.activeTab = tab;

  const pinned = localStorage.getItem('viewer_isPinned');
  state.isPinned = pinned === 'true';
}

function saveReadIds() {
  const arr = Array.from(state.readIds);
  // keep last 500 to avoid unbounded growth
  const trimmed = arr.slice(-500);
  localStorage.setItem('viewer_readIds', JSON.stringify(trimmed));
}

function loadReadIds() {
  try {
    const raw = localStorage.getItem('viewer_readIds');
    if (raw) {
      const arr = JSON.parse(raw);
      state.readIds = new Set(arr);
    }
  } catch {}
}

function markRead(bugId) {
  if (!state.readIds.has(bugId)) {
    state.readIds.add(bugId);
    saveReadIds();
    // remove unread dot from card if visible
    const card = elBugList.querySelector(`.bug-card[data-id="${bugId}"]`);
    if (card) card.classList.remove('unread');
    // update badge counts
    updateTabBadges();
  }
}

// ── 加载用户 ──────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const res = await window.bugViewerAPI.getUsers();
    if (res.code === 0 && Array.isArray(res.data)) {
      state.users = res.data;
      populateUserSelect();
    }
  } catch (e) {
    console.error('[Viewer] loadUsers error', e);
  }
}

function populateUserSelect() {
  elUserSelect.innerHTML = '<option value="">-- 选择用户 --</option>';
  state.users.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.username || u.name || `用户${u.id}`;
    elUserSelect.appendChild(opt);
  });
  if (state.currentUserId) {
    elUserSelect.value = String(state.currentUserId);
  }
}

// ── 加载 Bug 列表 ─────────────────────────────────────────────────────────
async function loadBugs(silent = false) {
  if (!state.currentUserId) return;

  if (!silent) {
    elBugList.innerHTML = '<div class="loading-text">加载中...</div>';
    elBugCount.textContent = '';
  }

  try {
    const baseParams = { page_size: 100 };
    const [res1, res2] = await Promise.all([
      window.bugViewerAPI.getBugs({ ...baseParams, assignee_id: state.currentUserId }),
      window.bugViewerAPI.getBugs({ ...baseParams, reporter_id: state.currentUserId }),
    ]);

    const list1 = res1.code === 0 ? (res1.data?.items ?? []) : [];
    const list2 = res2.code === 0 ? (res2.data?.items ?? []) : [];
    state.bugs = mergeAndDedup(list1, list2);

    updateTabBadges();
    renderCurrentTab();
  } catch (e) {
    console.error('[Viewer] loadBugs error', e);
    if (!silent) {
      elBugList.innerHTML = '<div class="hint-text">加载失败，请检查网络连接</div>';
    }
  }
}

// ── 页签徽章 ──────────────────────────────────────────────────────────────
function updateTabBadges() {
  Object.keys(TABS).forEach((tabKey) => {
    const statuses = TABS[tabKey].statuses;
    const bugs = state.bugs.filter((b) => statuses.includes(b.status));
    const unreadCount = bugs.filter((b) => !state.readIds.has(b.id)).length;
    const badge = $(`badge-${tabKey}`);
    if (badge) {
      badge.textContent = unreadCount > 0 ? String(unreadCount > 99 ? '99+' : unreadCount) : '';
    }
  });
}

// ── 渲染当前页签 ───────────────────────────────────────────────────────────
function renderCurrentTab() {
  const statuses = TABS[state.activeTab].statuses;
  const statusOrder = { new: 0, in_progress: 1, fixed: 2, closed: 3 };
  const { priority, bug_type, keyword } = state.activeFilter;

  let bugs = state.bugs
    .filter((b) => statuses.includes(b.status))
    .filter((b) => !priority || b.priority === priority)
    .filter((b) => !bug_type || b.bug_type === bug_type)
    .filter((b) => !keyword || (b.title && b.title.includes(keyword)) || (b.description && b.description.includes(keyword)))
    .sort((a, b) => {
      const diff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (diff !== 0) return diff;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  const total = bugs.length;
  const allTotal = state.bugs.length;
  const hasFilter = priority || bug_type || keyword;
  elBugCount.textContent = allTotal > 0
    ? (hasFilter ? `筛选 ${total} / ${allTotal} 条` : `共 ${allTotal} 条`)
    : '';

  if (!state.currentUserId) {
    elBugList.innerHTML = '<div class="hint-text">请选择用户以加载 BUG 列表</div>';
    return;
  }

  if (total === 0) {
    elBugList.innerHTML = `<div class="card-empty">${hasFilter ? '无匹配结果，请调整筛选条件' : '此分类暂无 BUG'}</div>`;
    return;
  }

  elBugList.innerHTML = '';
  bugs.forEach((bug) => {
    elBugList.appendChild(buildCard(bug));
  });
}

function buildCard(bug) {
  const card = document.createElement('div');
  card.className = 'bug-card';
  card.dataset.id = bug.id;

  const isUnread = !state.readIds.has(bug.id);
  if (isUnread) card.classList.add('unread');

  const thumb = bug.screenshots && bug.screenshots.length > 0
    ? `<img class="card-thumb" src="${escHtml(screenshotUrl(bug.screenshots[0].file_path))}" alt="截图" loading="lazy">`
    : '';

  const desc = bug.description
    ? `<div class="card-desc">${escHtml(bug.description)}</div>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <div class="card-title">#${bug.id} ${escHtml(bug.title)}</div>
      <span class="status-badge status-${bug.status}">${statusLabel(bug.status)}</span>
    </div>
    ${desc}
    ${thumb}
    <div class="card-meta">
      <span>${bugTypeLabel(bug.bug_type)}</span>
      <span>${priorityLabel(bug.priority)}</span>
      <span>${formatDate(bug.created_at)}</span>
    </div>
  `;

  card.addEventListener('click', () => openDetail(bug.id));
  return card;
}

// ── 详情面板 ──────────────────────────────────────────────────────────────
async function openDetail(bugId) {
  elDetailContent.innerHTML = '<div class="loading-text">加载详情...</div>';
  elDetailPanel.classList.add('open');
  elDetailBadge.textContent = '';
  elDetailBadge.className = 'status-badge';
  state.detailOpen = true;

  // Mark as read when opening
  markRead(bugId);

  try {
    const res = await window.bugViewerAPI.getBug(bugId);
    if (res.code !== 0 || !res.data) {
      elDetailContent.innerHTML = '<div class="hint-text">获取详情失败</div>';
      return;
    }
    const bug = res.data;
    state.currentDetail = bug;
    renderDetail(bug);
  } catch (e) {
    console.error('[Viewer] openDetail error', e);
    elDetailContent.innerHTML = '<div class="hint-text">获取详情失败</div>';
  }
}

function renderDetail(bug) {
  elDetailBadge.textContent = statusLabel(bug.status);
  elDetailBadge.className = `status-badge status-${bug.status}`;

  const screenshots = bug.screenshots || [];
  const thumbsHtml = screenshots.map((s) =>
    `<img class="detail-screenshot" src="${escHtml(screenshotUrl(s.file_path))}" alt="截图" data-src="${escHtml(screenshotUrl(s.file_path))}">`
  ).join('');

  const reporter = bug.reporter ? (bug.reporter.username || bug.reporter.name || `#${bug.reporter_id}`) : (bug.reporter_id || '-');
  const assignee = bug.assignee ? (bug.assignee.username || bug.assignee.name || `#${bug.assignee_id}`) : (bug.assignee_id ? `#${bug.assignee_id}` : '未分配');

  const fields = [
    { label: '类型', value: bugTypeLabel(bug.bug_type) },
    { label: '优先级', value: priorityLabel(bug.priority) },
    { label: '提报人', value: reporter },
    { label: '接收人', value: assignee },
    bug.inspection_task_id ? { label: '走查项目', value: `#${bug.inspection_task_id}` } : null,
    bug.module_id ? { label: '功能模块', value: `#${bug.module_id}` } : null,
    bug.env_url ? { label: '环境链接', value: bug.env_url } : null,
    { label: '创建时间', value: formatDate(bug.created_at) },
  ].filter(Boolean);

  const fieldsHtml = fields.map((f) =>
    `<div class="detail-field"><span class="detail-field-label">${escHtml(f.label)}</span><span class="detail-field-value">${escHtml(String(f.value))}</span></div>`
  ).join('');

  const descHtml = bug.description
    ? `<div class="detail-section-title">描述</div><div class="detail-desc">${escHtml(bug.description)}</div>`
    : '';

  const stepsHtml = bug.reproduction_steps
    ? `<div class="detail-section-title">复现步骤</div><div class="detail-steps">${escHtml(bug.reproduction_steps)}</div>`
    : '';

  elDetailContent.innerHTML = `
    <div class="detail-title">#${bug.id} ${escHtml(bug.title)}</div>
    ${thumbsHtml}
    ${descHtml}
    ${stepsHtml}
    <div class="detail-fields">${fieldsHtml}</div>
    <div class="status-changer">
      <div class="detail-section-title">变更状态</div>
      <div class="status-row">
        <select class="status-select" id="newStatusSelect">
          <option value="new"${bug.status === 'new' ? ' selected' : ''}>新建</option>
          <option value="in_progress"${bug.status === 'in_progress' ? ' selected' : ''}>处理中</option>
          <option value="fixed"${bug.status === 'fixed' ? ' selected' : ''}>已修复</option>
          <option value="closed"${bug.status === 'closed' ? ' selected' : ''}>已关闭</option>
        </select>
        <button class="btn-confirm" id="btnConfirmStatus">确认</button>
      </div>
      <div class="status-msg" id="statusMsg"></div>
    </div>
  `;

  elDetailContent.querySelectorAll('.detail-screenshot').forEach((img) => {
    img.addEventListener('click', () => showImgOverlay(img.dataset.src));
  });

  const btnConfirm = $('btnConfirmStatus');
  const statusSelect = $('newStatusSelect');
  const statusMsg = $('statusMsg');

  btnConfirm.addEventListener('click', async () => {
    const newStatus = statusSelect.value;
    if (newStatus === bug.status) {
      statusMsg.textContent = '状态未变更';
      statusMsg.className = 'status-msg';
      return;
    }
    btnConfirm.disabled = true;
    statusMsg.textContent = '保存中...';
    statusMsg.className = 'status-msg';
    try {
      const res = await window.bugViewerAPI.updateBugStatus(bug.id, newStatus);
      if (res.code === 0) {
        statusMsg.textContent = '状态已更新';
        statusMsg.className = 'status-msg';
        const idx = state.bugs.findIndex((b) => b.id === bug.id);
        if (idx !== -1) state.bugs[idx].status = newStatus;
        bug.status = newStatus;
        elDetailBadge.textContent = statusLabel(newStatus);
        elDetailBadge.className = `status-badge status-${newStatus}`;
        setTimeout(() => {
          updateTabBadges();
          // If current tab no longer contains this bug, close detail
          const tabStatuses = TABS[state.activeTab].statuses;
          if (!tabStatuses.includes(newStatus)) {
            closeDetail();
          }
        }, 500);
      } else {
        statusMsg.textContent = res.message || '更新失败';
        statusMsg.className = 'status-msg error';
      }
    } catch (e) {
      statusMsg.textContent = '网络错误';
      statusMsg.className = 'status-msg error';
    } finally {
      btnConfirm.disabled = false;
    }
  });
}

function closeDetail() {
  elDetailPanel.classList.remove('open');
  state.detailOpen = false;
  state.currentDetail = null;
}

// ── 图片预览 ──────────────────────────────────────────────────────────────
function showImgOverlay(src) {
  let overlay = $('imgOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'imgOverlay';
    const img = document.createElement('img');
    overlay.appendChild(img);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => overlay.classList.remove('open'));
  }
  overlay.querySelector('img').src = src;
  overlay.classList.add('open');
}

// ── 置顶按钮 ──────────────────────────────────────────────────────────────
function applyPinState() {
  elBtnPin.classList.toggle('pinned', state.isPinned);
  elBtnPin.title = state.isPinned ? '取消置顶' : '置顶';
  if (window.bugViewerAPI && window.bugViewerAPI.setAlwaysOnTop) {
    window.bugViewerAPI.setAlwaysOnTop(state.isPinned);
  }
}

// ── 筛选面板 ──────────────────────────────────────────────────────────────
function toggleFilterDrawer() {
  state.filterOpen = !state.filterOpen;
  elFilterDrawer.classList.toggle('open', state.filterOpen);
  elBtnFilter.classList.toggle('active', state.filterOpen);
}

function closeFilterDrawer() {
  state.filterOpen = false;
  elFilterDrawer.classList.remove('open');
  elBtnFilter.classList.remove('active');
}

function bindChipGroup(groupId, filterKey) {
  const group = $(groupId);
  if (!group) return;
  group.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function getChipValue(groupId) {
  const active = $(groupId) && $(groupId).querySelector('.chip.active');
  return active ? active.dataset.value : '';
}

function setChipValue(groupId, value) {
  const group = $(groupId);
  if (!group) return;
  group.querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.value === value);
  });
}

function syncFilterUI() {
  setChipValue('filterPriority', state.activeFilter.priority);
  setChipValue('filterType', state.activeFilter.bug_type);
  const kw = $('filterKeyword');
  if (kw) kw.value = state.activeFilter.keyword;
}

function hasActiveFilter() {
  const { priority, bug_type, keyword } = state.activeFilter;
  return !!(priority || bug_type || keyword);
}

// ── 轮询刷新（每 30s 静默刷新） ────────────────────────────────────────────
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    loadBugs(true); // silent
  }, 30000);
}

// ── 页签切换 ──────────────────────────────────────────────────────────────
function switchTab(tabKey) {
  state.activeTab = tabKey;
  savePrefs();

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });

  // Close detail panel when switching tabs
  closeDetail();
  renderCurrentTab();
}

// ── 事件绑定 ──────────────────────────────────────────────────────────────
function bindEvents() {
  elBtnClose.addEventListener('click', () => window.close());
  elBtnRefresh.addEventListener('click', () => loadBugs());

  elBtnPin.addEventListener('click', () => {
    state.isPinned = !state.isPinned;
    savePrefs();
    applyPinState();
  });

  // 筛选面板
  elBtnFilter.addEventListener('click', () => toggleFilterDrawer());
  $('btnFilterClose').addEventListener('click', () => closeFilterDrawer());
  bindChipGroup('filterPriority');
  bindChipGroup('filterType');

  $('btnFilterReset').addEventListener('click', () => {
    state.activeFilter = { priority: '', bug_type: '', keyword: '' };
    syncFilterUI();
    elBtnFilter.classList.remove('active');
    renderCurrentTab();
  });

  $('btnFilterApply').addEventListener('click', () => {
    state.activeFilter.priority = getChipValue('filterPriority');
    state.activeFilter.bug_type = getChipValue('filterType');
    const kw = $('filterKeyword');
    state.activeFilter.keyword = kw ? kw.value.trim() : '';
    elBtnFilter.classList.toggle('active', hasActiveFilter());
    closeFilterDrawer();
    renderCurrentTab();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  elUserSelect.addEventListener('change', () => {
    const val = elUserSelect.value;
    state.currentUserId = val ? Number(val) : null;
    savePrefs();
    if (state.currentUserId) {
      loadBugs();
    } else {
      state.bugs = [];
      updateTabBadges();
      elBugList.innerHTML = '<div class="hint-text">请选择用户以加载 BUG 列表</div>';
      elBugCount.textContent = '';
    }
  });

  elBtnDetailBack.addEventListener('click', closeDetail);

  // 主进程推送刷新事件（截图提交后）
  if (window.bugViewerAPI && window.bugViewerAPI.onRefresh) {
    window.bugViewerAPI.onRefresh(() => loadBugs(true));
  }
}

// ── 初始化 ────────────────────────────────────────────────────────────────
async function init() {
  loadPrefs();
  loadReadIds();

  // Sync active tab UI
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });

  // Apply pin state (pinned=false by default, user must activate)
  applyPinState();

  await loadUsers();
  bindEvents();

  if (state.currentUserId) {
    await loadBugs();
  }

  startPolling();
}

document.addEventListener('DOMContentLoaded', init);
