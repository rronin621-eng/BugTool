/* viewer.js — BUG 查看器渲染进程逻辑 */

const API_BASE = 'http://127.0.0.1:8000';

// ── 页签定义 ──────────────────────────────────────────────────────────────
const TABS = {
  // 待处理：我负责的 in_progress/deferred + 我提报且 fixed（待我验收）
  pending: { label: '待处理', statuses: ['in_progress', 'deferred', 'fixed'], role: 'mixed' },
  // 待验收：我修复的（我是 assignee）且 fixed，等提报人验收
  review:  { label: '待验收', statuses: ['fixed'], role: 'assignee' },
  closed:  { label: '已关闭', statuses: ['closed'], role: 'any' },
};

/**
 * 根据页签规则过滤 bug 列表
 * pending : assignee=我 且 status in [in_progress, deferred]
 *           OR reporter=我 且 status=fixed（别人修的等我验收）
 * review  : assignee=我 且 status=fixed（我修的等别人验收）
 * closed  : assignee=我 OR reporter=我 且 status=closed
 */
function getBugsForTab(tabKey) {
  const uid = state.currentUserId;
  return state.bugs.filter((b) => {
    const iAm = { assignee: b.assignee_id === uid, reporter: b.reporter_id === uid };
    if (tabKey === 'pending') {
      // 我负责 & 处理中/暂不处理
      if (iAm.assignee && (b.status === 'in_progress' || b.status === 'deferred')) return true;
      // 我提报 & fixed → 待我验收，归入待处理
      if (iAm.reporter && b.status === 'fixed') return true;
      return false;
    }
    if (tabKey === 'review') {
      // 我修复（我是 assignee）& fixed，等提报人验收
      return iAm.assignee && b.status === 'fixed';
    }
    if (tabKey === 'closed') {
      return (iAm.assignee || iAm.reporter) && b.status === 'closed';
    }
    return false;
  });
}

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
const elInlineActionBar   = $('inlineActionBar');
const elFloatNormalActions = $('floatNormalActions');
const elFloatAcceptActions = $('floatAcceptActions');
const elFloatBtnStatusDrop = $('floatBtnStatusDrop');
const elFloatStatusLabel   = $('floatStatusLabel');
const elFloatStatusMenu    = $('floatStatusMenu');
const elFloatBtnTransfer   = $('floatBtnTransfer');
const elFloatStatusMsg     = $('floatStatusMsg');
const elFloatBtnAcceptPass = $('floatBtnAcceptPass');
const elFloatBtnAcceptFail = $('floatBtnAcceptFail');
const elFloatAcceptMsg     = $('floatAcceptMsg');

// ── 内联操作浮层状态 ──────────────────────────────────────────────────────
let floatActionObserver = null;   // IntersectionObserver 实例
let floatActionBugId    = null;   // 当前浮层绑定的 bug id
let floatActionBug      = null;   // 当前浮层绑定的 bug 对象

// ── 工具函数 ──────────────────────────────────────────────────────────────
function statusLabel(s) {
  const map = { in_progress: '处理中', fixed: '已修复', deferred: '暂不处理', closed: '已关闭' };
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

// 判断当前用户是否是该 bug 的提报人
function isReporter(bug) {
  return bug && state.currentUserId && bug.reporter_id === state.currentUserId;
}

// 判断状态变更后 bug 是否仍属于当前页签（用于决定是否关闭卡片/详情）
function bugBelongsToCurrentTab(bug) {
  return getBugsForTab(state.activeTab).some((b) => b.id === bug.id);
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
    opt.textContent = u.display_name || u.username || `用户${u.id}`;
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
    if (silent) {
      patchCurrentTab();
    } else {
      renderCurrentTab();
    }
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
    const bugs = getBugsForTab(tabKey);
    const unreadCount = bugs.filter((b) => !state.readIds.has(b.id)).length;
    const badge = $(`badge-${tabKey}`);
    if (badge) {
      badge.textContent = unreadCount > 0 ? String(unreadCount > 99 ? '99+' : unreadCount) : '';
    }
  });
}

// ── 渲染当前页签 ───────────────────────────────────────────────────────────
function renderCurrentTab() {
  const statusOrder = { in_progress: 0, deferred: 1, fixed: 2, closed: 3 };
  const { priority, bug_type, keyword } = state.activeFilter;

  let bugs = getBugsForTab(state.activeTab)
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
  hideInlineActionBar();
  bugs.forEach((bug, index) => {
    elBugList.appendChild(buildCard(bug, index + 1));
  });
}

// ── 静默 diff 更新（轮询刷新时使用，不重建 DOM，不打断用户操作）─────────────
function patchCurrentTab() {
  const statusOrder = { in_progress: 0, deferred: 1, fixed: 2, closed: 3 };
  const { priority, bug_type, keyword } = state.activeFilter;

  const bugs = getBugsForTab(state.activeTab)
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

  // 如果列表还未初始化（空占位状态），直接全量渲染
  if (!elBugList.querySelector('.bug-card')) {
    renderCurrentTab();
    return;
  }

  // 获取当前 DOM 中已有的卡片 id 集合
  const existingIds = new Set(
    Array.from(elBugList.querySelectorAll('.bug-card')).map((c) => Number(c.dataset.id))
  );
  const newIds = new Set(bugs.map((b) => b.id));

  // 1. 移除已不在列表中的卡片（状态变化导致不再属于本页签），展开中的卡片不强制移除
  existingIds.forEach((id) => {
    if (!newIds.has(id)) {
      const card = elBugList.querySelector(`.bug-card[data-id="${id}"]`);
      if (card && !card.classList.contains('expanded')) {
        card.remove();
      }
    }
  });

  // 2. 更新已有卡片的状态标签（仅更新 status badge，不动其他 DOM）
  bugs.forEach((bug) => {
    const card = elBugList.querySelector(`.bug-card[data-id="${bug.id}"]`);
    if (card) {
      const badge = card.querySelector('.status-badge');
      if (badge) {
        const newLabel = statusLabel(bug.status);
        const newClass = `status-badge status-${bug.status}`;
        if (badge.textContent !== newLabel || badge.className !== newClass) {
          badge.textContent = newLabel;
          badge.className = newClass;
        }
      }
      // 未读状态同步
      if (!state.readIds.has(bug.id)) {
        card.classList.add('unread');
      }
    }
  });

  // 3. 追加新增的卡片（新提交的 bug）
  bugs.forEach((bug, index) => {
    if (!existingIds.has(bug.id)) {
      elBugList.appendChild(buildCard(bug, index + 1));
    }
  });
}

function buildCard(bug, index) {
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
      <div class="card-title">
        <span class="card-index">${index}</span>#${bug.id} ${escHtml(bug.title)}
      </div>
      <span class="status-badge status-${bug.status}">${statusLabel(bug.status)}</span>
    </div>
    ${desc}
    ${thumb}
    <div class="card-meta">
      <span>${bugTypeLabel(bug.bug_type)}</span>
      <span>${priorityLabel(bug.priority)}</span>
      <span>${formatDate(bug.created_at)}</span>
    </div>
    <div class="card-inline-detail"></div>
  `;

  card.addEventListener('click', (e) => {
    // 忽略内联详情区域内的点击冒泡（select、button 等）
    if (e.target.closest('.card-inline-detail') && e.target !== card.querySelector('.card-inline-detail')) return;
    toggleInlineDetail(card, bug.id);
  });
  return card;
}

// ── 内联详情展开/收起 ─────────────────────────────────────────────────────
async function toggleInlineDetail(card, bugId) {
  const detailEl = card.querySelector('.card-inline-detail');
  const isExpanded = card.classList.contains('expanded');

  // 收起其他已展开的卡片
  elBugList.querySelectorAll('.bug-card.expanded').forEach((c) => {
    if (c !== card) {
      c.classList.remove('expanded');
      c.querySelector('.card-inline-detail').innerHTML = '';
    }
  });

  // 每次切换都先隐藏浮层、断开 observer
  hideInlineActionBar();

  if (isExpanded) {
    card.classList.remove('expanded');
    detailEl.innerHTML = '';
    return;
  }

  card.classList.add('expanded');
  markRead(bugId);
  detailEl.innerHTML = '<div class="card-inline-detail-inner"><div class="inline-loading">加载中...</div></div>';

  try {
    const res = await window.bugViewerAPI.getBug(bugId);
    if (res.code !== 0 || !res.data) {
      detailEl.innerHTML = '<div class="card-inline-detail-inner"><div class="inline-loading">获取详情失败</div></div>';
      return;
    }
    renderInlineDetail(detailEl, res.data);
  } catch (e) {
    console.error('[Viewer] toggleInlineDetail error', e);
    detailEl.innerHTML = '<div class="card-inline-detail-inner"><div class="inline-loading">获取详情失败</div></div>';
  }
}

function renderInlineDetail(container, bug) {
  const screenshots = bug.screenshots || [];
  const thumbsHtml = screenshots.map((s) =>
    `<img class="detail-screenshot" src="${escHtml(screenshotUrl(s.file_path))}" alt="截图" data-src="${escHtml(screenshotUrl(s.file_path))}">`
  ).join('');

  const reporter = bug.reporter ? (bug.reporter.display_name || bug.reporter.username || `#${bug.reporter_id}`) : (bug.reporter_id || '-');
  const assignee = bug.assignee ? (bug.assignee.display_name || bug.assignee.username || `#${bug.assignee_id}`) : (bug.assignee_id ? `#${bug.assignee_id}` : '未分配');

  const collaborators = bug.collaborators || [];
  const collabNames = collaborators.map((c) => c.display_name || c.username).join('、');

  const fields = [
    { label: '类型', value: bugTypeLabel(bug.bug_type) },
    { label: '优先级', value: priorityLabel(bug.priority) },
    { label: '提报人', value: reporter },
    { label: '接收人', value: assignee },
    bug.inspection_task_id ? { label: '走查项目', value: `#${bug.inspection_task_id}` } : null,
    bug.module_id ? { label: '功能模块', value: `#${bug.module_id}` } : null,
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

  // 协作人区域
  const collabHtml = `
    <div class="collaborators-section">
      <div class="collab-header">
        <span class="detail-section-title" style="margin:0">协作人</span>
        <button class="btn-add-collab" data-bug-id="${bug.id}">+ 添加协作人</button>
      </div>
      <div class="collab-list" id="collabList-${bug.id}">
        ${collabNames
          ? collaborators.map((c) =>
              `<span class="collab-tag" data-uid="${c.id}">${escHtml(c.display_name || c.username)}<button class="collab-remove" data-uid="${c.id}" title="移除">×</button></span>`
            ).join('')
          : '<span class="collab-empty">暂无协作人</span>'
        }
      </div>
      <div class="collab-picker hidden" id="collabPicker-${bug.id}">
        <div class="collab-picker-list" id="collabPickerList-${bug.id}"></div>
        <div class="collab-picker-actions">
          <button class="collab-picker-cancel btn-cancel-sm">取消</button>
          <button class="collab-picker-confirm btn-confirm-sm">确认</button>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = `
    <div class="card-inline-detail-inner">
      <div class="inline-detail-body">
        ${thumbsHtml}
        ${descHtml}
        ${stepsHtml}
        <div class="detail-fields">${fieldsHtml}</div>
        ${collabHtml}
        <div class="status-changer-sentinel"></div>
      </div>
    </div>
  `;

  container.querySelectorAll('.detail-screenshot').forEach((img) => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      showImgOverlay(img.dataset.src);
    });
  });

  // 协作人相关事件
  bindCollaboratorUI(container, bug);

  // 绑定浮层到当前 bug，并用 observer 监测哨兵可见性
  const sentinel = container.querySelector('.status-changer-sentinel');
  bindInlineActionBar(bug, sentinel);
}

// ── 协作人 UI 绑定 ────────────────────────────────────────────────────────
function bindCollaboratorUI(container, bug) {
  let currentCollabIds = (bug.collaborators || []).map((c) => c.id);

  const btnAddCollab = container.querySelector('.btn-add-collab');
  const picker = container.querySelector(`#collabPicker-${bug.id}`);
  const pickerList = container.querySelector(`#collabPickerList-${bug.id}`);
  const btnCancel = picker && picker.querySelector('.collab-picker-cancel');
  const btnConfirm = picker && picker.querySelector('.collab-picker-confirm');

  if (!btnAddCollab || !picker) return;

  btnAddCollab.addEventListener('click', (e) => {
    e.stopPropagation();
    // 渲染候选人列表（排除当前接收人和提报人）
    const excludeIds = new Set([bug.reporter_id, bug.assignee_id].filter(Boolean));
    const candidates = state.users.filter((u) => !excludeIds.has(u.id));

    pickerList.innerHTML = candidates.map((u) => {
      const checked = currentCollabIds.includes(u.id) ? ' checked' : '';
      const name = u.display_name || u.username;
      return `<label class="collab-option"><input type="checkbox" value="${u.id}"${checked}><span>${escHtml(name)}</span></label>`;
    }).join('');

    picker.classList.toggle('hidden');
    btnAddCollab.classList.toggle('active');
  });

  if (btnCancel) {
    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.classList.add('hidden');
      btnAddCollab.classList.remove('active');
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async (e) => {
      e.stopPropagation();
      const checked = Array.from(pickerList.querySelectorAll('input[type=checkbox]:checked'))
        .map((cb) => Number(cb.value));

      picker.classList.add('hidden');
      btnAddCollab.classList.remove('active');
      btnConfirm.disabled = true;

      try {
        const res = await window.bugViewerAPI.updateCollaborators(bug.id, checked);
        if (res.code === 0) {
          currentCollabIds = checked;
          const updatedCollabs = (res.data && res.data.collaborators) || [];
          // 更新 bug 对象中的 collaborators
          bug.collaborators = updatedCollabs;
          // 重新渲染协作人标签
          const collabListEl = container.querySelector(`#collabList-${bug.id}`);
          if (collabListEl) {
            if (updatedCollabs.length === 0) {
              collabListEl.innerHTML = '<span class="collab-empty">暂无协作人</span>';
            } else {
              collabListEl.innerHTML = updatedCollabs.map((c) =>
                `<span class="collab-tag" data-uid="${c.id}">${escHtml(c.display_name || c.username)}<button class="collab-remove" data-uid="${c.id}" title="移除">×</button></span>`
              ).join('');
              // 重新绑定移除按钮
              collabListEl.querySelectorAll('.collab-remove').forEach((btn) => {
                btn.addEventListener('click', async (ev) => {
                  ev.stopPropagation();
                  const uid = Number(btn.dataset.uid);
                  const newIds = currentCollabIds.filter((id) => id !== uid);
                  const r = await window.bugViewerAPI.updateCollaborators(bug.id, newIds);
                  if (r.code === 0) {
                    currentCollabIds = newIds;
                    bug.collaborators = (r.data && r.data.collaborators) || [];
                    btn.closest('.collab-tag').remove();
                    if (currentCollabIds.length === 0) {
                      collabListEl.innerHTML = '<span class="collab-empty">暂无协作人</span>';
                    }
                  }
                });
              });
            }
          }
        }
      } catch (err) {
        console.error('[Viewer] updateCollaborators error', err);
      } finally {
        btnConfirm.disabled = false;
      }
    });
  }

  // 绑定现有协作人的移除按钮
  const collabListEl = container.querySelector(`#collabList-${bug.id}`);
  if (collabListEl) {
    collabListEl.querySelectorAll('.collab-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const uid = Number(btn.dataset.uid);
        const newIds = currentCollabIds.filter((id) => id !== uid);
        const r = await window.bugViewerAPI.updateCollaborators(bug.id, newIds);
        if (r.code === 0) {
          currentCollabIds = newIds;
          bug.collaborators = (r.data && r.data.collaborators) || [];
          btn.closest('.collab-tag').remove();
          if (currentCollabIds.length === 0) {
            collabListEl.innerHTML = '<span class="collab-empty">暂无协作人</span>';
          }
        }
      });
    });
  }
}

// ── 内联操作浮层控制 ──────────────────────────────────────────────────────
function bindInlineActionBar(bug, sentinel) {
  // 断开旧的 observer
  if (floatActionObserver) {
    floatActionObserver.disconnect();
    floatActionObserver = null;
  }

  floatActionBugId = bug.id;
  floatActionBug   = bug;

  // 决定展示模式：
  // isReviewMode   = 我是提报人 & fixed → 显示验收通过/不通过
  // isWaitingReview = 我是负责人 & fixed → 我修复了等待验收，只读
  // 否则 → 普通状态变更 + 转交
  const isReviewMode    = bug.status === 'fixed' && isReporter(bug) && bug.reporter_id !== bug.assignee_id;
  const isWaitingReview = bug.status === 'fixed' && !isReporter(bug);

  // 把哨兵变成内嵌操作区
  sentinel.className = 'status-changer';

  if (isReviewMode) {
    // 内嵌：验收操作区
    sentinel.innerHTML = `
      <div class="action-bar-row">
        <span class="action-bar-label">验收</span>
        <div class="action-bar-btns">
          <button class="btn-accept-pass" id="inlineBtnAcceptPass-${bug.id}">通过</button>
          <button class="btn-accept-fail" id="inlineBtnAcceptFail-${bug.id}">不通过</button>
        </div>
      </div>
      <div class="status-msg" id="inlineAcceptMsg-${bug.id}"></div>
    `;

    // 浮层也切换为验收模式
    elFloatNormalActions.classList.add('hidden');
    elFloatAcceptActions.classList.remove('hidden');
    elFloatAcceptMsg.textContent = '';
    elFloatAcceptMsg.className = 'status-msg';

    // 内嵌验收事件
    const inlinePass = document.getElementById(`inlineBtnAcceptPass-${bug.id}`);
    const inlineFail = document.getElementById(`inlineBtnAcceptFail-${bug.id}`);
    const inlineMsg  = document.getElementById(`inlineAcceptMsg-${bug.id}`);

    const doAccept = async (accepted, btn, msgEl) => {
      btn.disabled = true;
      msgEl.textContent = '保存中...';
      try {
        const res = await window.bugViewerAPI.acceptBug(bug.id, accepted, state.currentUserId);
        if (res.code === 0) {
          msgEl.textContent = accepted ? '验收通过' : '已退回重新处理';
          const newStatus = accepted ? 'closed' : 'in_progress';
          const idx = state.bugs.findIndex((b) => b.id === bug.id);
          if (idx !== -1) state.bugs[idx].status = newStatus;
          bug.status = newStatus;
          const card = elBugList.querySelector(`.bug-card[data-id="${bug.id}"]`);
          if (card) {
            const badge = card.querySelector('.status-badge');
            if (badge) { badge.textContent = statusLabel(newStatus); badge.className = `status-badge status-${newStatus}`; }
          }
          setTimeout(() => { updateTabBadges(); hideInlineActionBar(); renderCurrentTab(); }, 600);
        } else {
          msgEl.textContent = res.message || '操作失败';
          msgEl.className = 'status-msg error';
        }
      } catch {
        msgEl.textContent = '网络错误';
        msgEl.className = 'status-msg error';
      } finally {
        btn.disabled = false;
      }
    };

    if (inlinePass) inlinePass.addEventListener('click', (e) => { e.stopPropagation(); doAccept(true, inlinePass, inlineMsg); });
    if (inlineFail) inlineFail.addEventListener('click', (e) => { e.stopPropagation(); doAccept(false, inlineFail, inlineMsg); });

    // 浮层验收事件（重新绑，清旧handler）
    const newPassHandler = () => doAccept(true, elFloatBtnAcceptPass, elFloatAcceptMsg);
    const newFailHandler = () => doAccept(false, elFloatBtnAcceptFail, elFloatAcceptMsg);
    elFloatBtnAcceptPass.replaceWith(elFloatBtnAcceptPass.cloneNode(true));
    elFloatBtnAcceptFail.replaceWith(elFloatBtnAcceptFail.cloneNode(true));
    $('floatBtnAcceptPass').addEventListener('click', newPassHandler);
    $('floatBtnAcceptFail').addEventListener('click', newFailHandler);

  } else if (isWaitingReview) {
    // 内嵌：我修复了，等待提报人验收 → 只读提示
    sentinel.innerHTML = `
      <div class="action-bar-row waiting-review-hint">
        <span class="waiting-review-label">等待提报人验收中…</span>
      </div>
    `;
    // 浮层：隐藏两组操作，显示只读提示
    elFloatNormalActions.classList.add('hidden');
    elFloatAcceptActions.classList.add('hidden');
    // 在浮层容器内插入只读提示（若还没有）
    let floatHint = elInlineActionBar.querySelector('.waiting-review-float-hint');
    if (!floatHint) {
      floatHint = document.createElement('div');
      floatHint.className = 'waiting-review-float-hint action-bar-row';
      floatHint.innerHTML = '<span class="waiting-review-label">等待提报人验收中…</span>';
      elInlineActionBar.querySelector('.inline-action-bar-inner').appendChild(floatHint);
    }
    floatHint.style.display = 'flex';

    sentinel.addEventListener('click', (e) => e.stopPropagation());

  } else {
    // 内嵌：普通状态变更 + 转交
    // 先确保只读提示不残留
    const floatHint = elInlineActionBar.querySelector('.waiting-review-float-hint');
    if (floatHint) floatHint.style.display = 'none';
    sentinel.innerHTML = `
      <div class="action-bar-row">
        <div class="action-bar-btns">
          <div class="dropdown-wrap">
            <button class="btn-status-drop" id="inlineBtnStatusDrop-${bug.id}">
              <span id="inlineStatusLabel-${bug.id}">更改状态</span>
              <span class="drop-arrow">▾</span>
            </button>
            <div class="dropdown-menu hidden" id="inlineStatusMenu-${bug.id}"></div>
          </div>
          <button class="btn-transfer" id="inlineBtnTransfer-${bug.id}">转交</button>
        </div>
      </div>
      <div class="status-msg" id="inlineStatusMsg-${bug.id}"></div>
    `;

    // 浮层切换为普通模式
    elFloatNormalActions.classList.remove('hidden');
    elFloatAcceptActions.classList.add('hidden');
    elFloatStatusMsg.textContent = '';
    elFloatStatusMsg.className = 'status-msg';
    elFloatStatusLabel.textContent = '更改状态';

    // 阻止内嵌操作区的点击冒泡到卡片
    sentinel.addEventListener('click', (e) => e.stopPropagation());

    // 通用状态提交逻辑
    async function submitStatus(newStatus, msgEl, labelEl) {
      if (newStatus === bug.status) {
        msgEl.textContent = '状态未变更';
        msgEl.className = 'status-msg';
        return;
      }
      let comment = '';
      if (newStatus === 'deferred') {
        const reason = await promptDeferReason();
        if (reason === null) return;
        comment = reason;
      }
      msgEl.textContent = '保存中...';
      msgEl.className = 'status-msg';
      try {
        const res = await window.bugViewerAPI.updateBugStatus(bug.id, newStatus, comment, state.currentUserId);
        if (res.code === 0) {
          msgEl.textContent = '状态已更新';
          const idx = state.bugs.findIndex((b) => b.id === bug.id);
          if (idx !== -1) state.bugs[idx].status = newStatus;
          bug.status = newStatus;
          if (labelEl) labelEl.textContent = '更改状态';
          elFloatStatusLabel.textContent = '更改状态';
          elFloatStatusMsg.textContent = '状态已更新';
          const card = elBugList.querySelector(`.bug-card[data-id="${bug.id}"]`);
          if (card) {
            const badge = card.querySelector('.status-badge');
            if (badge) { badge.textContent = statusLabel(newStatus); badge.className = `status-badge status-${newStatus}`; }
          }
          setTimeout(() => {
            updateTabBadges();
            if (!bugBelongsToCurrentTab(bug)) { hideInlineActionBar(); renderCurrentTab(); }
          }, 600);
        } else {
          msgEl.textContent = res.message || '更新失败';
          msgEl.className = 'status-msg error';
        }
      } catch {
        msgEl.textContent = '网络错误';
        msgEl.className = 'status-msg error';
      }
    }

    // 通用转交逻辑
    async function doTransfer(msgEl) {
      const targetUser = await promptSelectUser('选择转交对象', state.users, bug.assignee_id);
      if (!targetUser) return;
      msgEl.textContent = '转交中...';
      msgEl.className = 'status-msg';
      try {
        const res = await window.bugViewerAPI.transferBug(bug.id, targetUser.id, state.currentUserId);
        if (res.code === 0) {
          msgEl.textContent = `已转交给 ${targetUser.display_name || targetUser.username}`;
          bug.assignee_id = targetUser.id;
          const idx = state.bugs.findIndex((b) => b.id === bug.id);
          if (idx !== -1) state.bugs[idx].assignee_id = targetUser.id;
        } else {
          msgEl.textContent = res.message || '转交失败';
          msgEl.className = 'status-msg error';
        }
      } catch {
        msgEl.textContent = '网络错误';
        msgEl.className = 'status-msg error';
      }
    }

    // 构建状态下拉菜单
    const STATUS_OPTIONS = [
      { value: 'in_progress', label: '处理中' },
      { value: 'fixed',       label: '已修复' },
      { value: 'deferred',    label: '暂不处理' },
      { value: 'closed',      label: '已关闭' },
    ];

    function buildStatusMenu(menuEl, labelEl, msgEl) {
      menuEl.innerHTML = STATUS_OPTIONS.map((opt) =>
        `<div class="dropdown-item${opt.value === bug.status ? ' active' : ''}" data-value="${opt.value}">${opt.label}</div>`
      ).join('');
      menuEl.querySelectorAll('.dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          menuEl.classList.add('hidden');
          submitStatus(item.dataset.value, msgEl, labelEl);
        });
      });
    }

    // 内嵌下拉
    const inlineDropBtn = document.getElementById(`inlineBtnStatusDrop-${bug.id}`);
    const inlineMenu    = document.getElementById(`inlineStatusMenu-${bug.id}`);
    const inlineLabel   = document.getElementById(`inlineStatusLabel-${bug.id}`);
    const inlineMsg     = document.getElementById(`inlineStatusMsg-${bug.id}`);
    const inlineTransfer = document.getElementById(`inlineBtnTransfer-${bug.id}`);

    if (inlineDropBtn && inlineMenu) {
      buildStatusMenu(inlineMenu, inlineLabel, inlineMsg);
      inlineDropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        inlineMenu.classList.toggle('hidden');
        elFloatStatusMenu.classList.add('hidden');
      });
    }
    if (inlineTransfer) {
      inlineTransfer.addEventListener('click', (e) => { e.stopPropagation(); doTransfer(inlineMsg); });
    }

    // 浮层下拉（重新绑）
    buildStatusMenu(elFloatStatusMenu, elFloatStatusLabel, elFloatStatusMsg);
    const newDropHandler = (e) => {
      e.stopPropagation();
      elFloatStatusMenu.classList.toggle('hidden');
      if (inlineMenu) inlineMenu.classList.add('hidden');
    };
    const newTransferHandler = () => doTransfer(elFloatStatusMsg);
    elFloatBtnStatusDrop.onclick = newDropHandler;
    elFloatBtnTransfer.onclick = newTransferHandler;
  }

  // 获取展开卡片中"内联详情区"的引用
  const expandedCard = sentinel.closest('.bug-card');
  const inlineDetailEl = expandedCard ? expandedCard.querySelector('.card-inline-detail') : null;
  const FLOAT_BOTTOM_DEFAULT = 10;

  // 获取浮层真实高度
  let FLOAT_HEIGHT = 100;
  {
    const wasHidden = elInlineActionBar.classList.contains('hidden');
    elInlineActionBar.classList.remove('hidden');
    elInlineActionBar.style.visibility = 'hidden';
    const h = elInlineActionBar.offsetHeight;
    if (h > 0) FLOAT_HEIGHT = h;
    if (wasHidden) elInlineActionBar.classList.add('hidden');
    elInlineActionBar.style.visibility = '';
  }

  function updateFloatBar() {
    const sentinelRect = sentinel.getBoundingClientRect();
    const listRect = elBugList.getBoundingClientRect();

    const fullyVisible = sentinelRect.top >= listRect.top && sentinelRect.bottom <= listRect.bottom;
    const isBelow = sentinelRect.bottom > listRect.bottom;

    if (fullyVisible) {
      elInlineActionBar.classList.add('hidden');
      sentinel.style.visibility = '';
    } else if (isBelow) {
      elInlineActionBar.classList.remove('hidden');
      sentinel.style.visibility = 'hidden';

      const boundaryRect = inlineDetailEl ? inlineDetailEl.getBoundingClientRect() : null;
      if (boundaryRect) {
        const windowHeight = window.innerHeight;
        const spaceAbove = windowHeight - boundaryRect.top;
        if (spaceAbove <= FLOAT_HEIGHT + FLOAT_BOTTOM_DEFAULT) {
          const newBottom = spaceAbove - FLOAT_HEIGHT;
          elInlineActionBar.style.bottom = `${Math.max(newBottom, -FLOAT_HEIGHT)}px`;
        } else {
          elInlineActionBar.style.bottom = `${FLOAT_BOTTOM_DEFAULT}px`;
        }
      }
    } else {
      elInlineActionBar.classList.add('hidden');
      sentinel.style.visibility = '';
    }
  }

  // 关闭点击其他区域时收起下拉菜单
  document.addEventListener('click', () => {
    elFloatStatusMenu.classList.add('hidden');
    if (sentinel) {
      const inlineMenu = sentinel.querySelector('.dropdown-menu');
      if (inlineMenu) inlineMenu.classList.add('hidden');
    }
  }, { once: false });

  setTimeout(updateFloatBar, 350);

  floatActionObserver = { disconnect: () => elBugList.removeEventListener('scroll', updateFloatBar) };
  elBugList.addEventListener('scroll', updateFloatBar);
  floatActionObserver.observe = () => {};
}

function hideInlineActionBar() {
  elInlineActionBar.classList.add('hidden');
  elInlineActionBar.style.bottom = '';
  elBugList.querySelectorAll('.bug-card.expanded .status-changer').forEach((el) => {
    el.style.visibility = '';
  });
  if (floatActionObserver) {
    floatActionObserver.disconnect();
    floatActionObserver = null;
  }
  floatActionBugId = null;
  floatActionBug   = null;
}

// ── 详情面板 ──────────────────────────────────────────────────────────────
async function openDetail(bugId) {
  elDetailContent.innerHTML = '<div class="loading-text">加载详情...</div>';
  elDetailPanel.classList.add('open');
  elDetailBadge.textContent = '';
  elDetailBadge.className = 'status-badge';
  state.detailOpen = true;
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

  const reporter = bug.reporter ? (bug.reporter.display_name || bug.reporter.username || `#${bug.reporter_id}`) : (bug.reporter_id || '-');
  const assignee = bug.assignee ? (bug.assignee.display_name || bug.assignee.username || `#${bug.assignee_id}`) : (bug.assignee_id ? `#${bug.assignee_id}` : '未分配');

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

  const isReviewMode    = bug.status === 'fixed' && isReporter(bug) && bug.reporter_id !== bug.assignee_id;
  const isWaitingReview = bug.status === 'fixed' && !isReporter(bug);

  const actionHtml = isReviewMode ? `
    <div class="status-changer">
      <div class="action-bar-row">
        <span class="action-bar-label">验收</span>
        <div class="action-bar-btns">
          <button class="btn-accept-pass" id="detailBtnAcceptPass">通过</button>
          <button class="btn-accept-fail" id="detailBtnAcceptFail">不通过</button>
        </div>
      </div>
      <div class="status-msg" id="detailAcceptMsg"></div>
    </div>
  ` : isWaitingReview ? `
    <div class="status-changer">
      <div class="action-bar-row waiting-review-hint">
        <span class="waiting-review-label">等待提报人验收中…</span>
      </div>
    </div>
  ` : `
    <div class="status-changer">
      <div class="action-bar-row">
        <div class="action-bar-btns">
          <div class="dropdown-wrap">
            <button class="btn-status-drop" id="detailBtnStatusDrop">
              <span id="detailStatusLabel">更改状态</span>
              <span class="drop-arrow">▾</span>
            </button>
            <div class="dropdown-menu hidden" id="detailStatusMenu"></div>
          </div>
          <button class="btn-transfer" id="detailBtnTransfer">转交</button>
        </div>
      </div>
      <div class="status-msg" id="detailStatusMsg"></div>
    </div>
  `;

  elDetailContent.innerHTML = `
    <div class="detail-title">#${bug.id} ${escHtml(bug.title)}</div>
    ${thumbsHtml}
    ${descHtml}
    ${stepsHtml}
    <div class="detail-fields">${fieldsHtml}</div>
    ${actionHtml}
  `;

  elDetailContent.querySelectorAll('.detail-screenshot').forEach((img) => {
    img.addEventListener('click', () => showImgOverlay(img.dataset.src));
  });

  if (isReviewMode) {
    const btnPass = $('detailBtnAcceptPass');
    const btnFail = $('detailBtnAcceptFail');
    const msgEl   = $('detailAcceptMsg');
    const doAccept = async (accepted, btn) => {
      btn.disabled = true;
      msgEl.textContent = '保存中...';
      try {
        const res = await window.bugViewerAPI.acceptBug(bug.id, accepted, state.currentUserId);
        if (res.code === 0) {
          msgEl.textContent = accepted ? '验收通过' : '已退回重新处理';
          const newStatus = accepted ? 'closed' : 'in_progress';
          bug.status = newStatus;
          elDetailBadge.textContent = statusLabel(newStatus);
          elDetailBadge.className = `status-badge status-${newStatus}`;
          const idx = state.bugs.findIndex((b) => b.id === bug.id);
          if (idx !== -1) state.bugs[idx].status = newStatus;
          setTimeout(() => { updateTabBadges(); if (!bugBelongsToCurrentTab(bug)) closeDetail(); }, 500);
        }
      } catch { msgEl.textContent = '网络错误'; msgEl.className = 'status-msg error'; }
      finally { btn.disabled = false; }
    };
    if (btnPass) btnPass.addEventListener('click', () => doAccept(true, btnPass));
    if (btnFail) btnFail.addEventListener('click', () => doAccept(false, btnFail));
  } else if (!isWaitingReview) {
    const STATUS_OPTIONS = [
      { value: 'in_progress', label: '处理中' },
      { value: 'fixed',       label: '已修复' },
      { value: 'deferred',    label: '暂不处理' },
      { value: 'closed',      label: '已关闭' },
    ];
    const dropBtn  = $('detailBtnStatusDrop');
    const menuEl   = $('detailStatusMenu');
    const labelEl  = $('detailStatusLabel');
    const msgEl    = $('detailStatusMsg');
    const transBtn = $('detailBtnTransfer');

    if (menuEl) {
      menuEl.innerHTML = STATUS_OPTIONS.map((opt) =>
        `<div class="dropdown-item${opt.value === bug.status ? ' active' : ''}" data-value="${opt.value}">${opt.label}</div>`
      ).join('');
      menuEl.querySelectorAll('.dropdown-item').forEach((item) => {
        item.addEventListener('click', async () => {
          menuEl.classList.add('hidden');
          const newStatus = item.dataset.value;
          if (newStatus === bug.status) return;
          let comment = '';
          if (newStatus === 'deferred') {
            const reason = await promptDeferReason();
            if (reason === null) return;
            comment = reason;
          }
          msgEl.textContent = '保存中...';
          try {
            const res = await window.bugViewerAPI.updateBugStatus(bug.id, newStatus, comment, state.currentUserId);
            if (res.code === 0) {
              msgEl.textContent = '状态已更新';
              bug.status = newStatus;
              if (labelEl) labelEl.textContent = '更改状态';
              elDetailBadge.textContent = statusLabel(newStatus);
              elDetailBadge.className = `status-badge status-${newStatus}`;
              const idx = state.bugs.findIndex((b) => b.id === bug.id);
              if (idx !== -1) state.bugs[idx].status = newStatus;
              setTimeout(() => { updateTabBadges(); if (!bugBelongsToCurrentTab(bug)) closeDetail(); }, 500);
            } else {
              msgEl.textContent = res.message || '更新失败';
              msgEl.className = 'status-msg error';
            }
          } catch { msgEl.textContent = '网络错误'; msgEl.className = 'status-msg error'; }
        });
      });
    }
    if (dropBtn) dropBtn.addEventListener('click', () => menuEl && menuEl.classList.toggle('hidden'));
    if (transBtn) {
      transBtn.addEventListener('click', async () => {
        const targetUser = await promptSelectUser('选择转交对象', state.users, bug.assignee_id);
        if (!targetUser) return;
        msgEl.textContent = '转交中...';
        try {
          const res = await window.bugViewerAPI.transferBug(bug.id, targetUser.id, state.currentUserId);
          if (res.code === 0) {
            msgEl.textContent = `已转交给 ${targetUser.display_name || targetUser.username}`;
            bug.assignee_id = targetUser.id;
          } else {
            msgEl.textContent = res.message || '转交失败';
            msgEl.className = 'status-msg error';
          }
        } catch { msgEl.textContent = '网络错误'; msgEl.className = 'status-msg error'; }
      });
    }
  }
}

function closeDetail() {
  elDetailPanel.classList.remove('open');
  state.detailOpen = false;
  state.currentDetail = null;
}

// ── 暂不处理理由弹窗 ──────────────────────────────────────────────────────
function promptDeferReason() {
  return new Promise((resolve) => {
    const existing = document.getElementById('deferReasonModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'deferReasonModal';
    modal.className = 'defer-reason-modal';
    modal.innerHTML = `
      <div class="defer-reason-dialog">
        <div class="defer-reason-title">请填写暂不处理的理由</div>
        <textarea id="deferReasonInput" class="defer-reason-textarea" placeholder="必填，说明暂不处理的原因..." rows="4"></textarea>
        <div class="defer-reason-msg hidden" id="deferReasonMsg">理由不能为空</div>
        <div class="defer-reason-actions">
          <button class="btn-cancel" id="deferReasonCancel">取消</button>
          <button class="btn-confirm" id="deferReasonConfirm">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = document.getElementById('deferReasonInput');
    const msg   = document.getElementById('deferReasonMsg');
    const btnOk = document.getElementById('deferReasonConfirm');
    const btnCa = document.getElementById('deferReasonCancel');

    setTimeout(() => input.focus(), 50);

    function cleanup() { modal.remove(); }

    btnCa.addEventListener('click', () => { cleanup(); resolve(null); });
    btnOk.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) { msg.classList.remove('hidden'); input.focus(); return; }
      cleanup();
      resolve(val);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnOk.click(); }
      if (e.key === 'Escape') { btnCa.click(); }
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) btnCa.click(); });
  });
}

// ── 选择用户弹窗（转交） ──────────────────────────────────────────────────
function promptSelectUser(title, users, excludeId) {
  return new Promise((resolve) => {
    const existing = document.getElementById('selectUserModal');
    if (existing) existing.remove();

    const candidates = users.filter((u) => u.id !== excludeId && u.id !== state.currentUserId);
    if (candidates.length === 0) { resolve(null); return; }

    const modal = document.createElement('div');
    modal.id = 'selectUserModal';
    modal.className = 'defer-reason-modal';
    modal.innerHTML = `
      <div class="defer-reason-dialog">
        <div class="defer-reason-title">${escHtml(title)}</div>
        <div class="user-pick-list" id="userPickList">
          ${candidates.map((u) =>
            `<div class="user-pick-item" data-uid="${u.id}">
              <span class="user-pick-name">${escHtml(u.display_name || u.username)}</span>
              <span class="user-pick-role">${escHtml(u.role)}</span>
            </div>`
          ).join('')}
        </div>
        <div class="defer-reason-actions">
          <button class="btn-cancel" id="userPickCancel">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const btnCa = document.getElementById('userPickCancel');
    function cleanup() { modal.remove(); }

    btnCa.addEventListener('click', () => { cleanup(); resolve(null); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { cleanup(); resolve(null); } });

    document.querySelectorAll('.user-pick-item').forEach((item) => {
      item.addEventListener('click', () => {
        const uid = Number(item.dataset.uid);
        const user = candidates.find((u) => u.id === uid);
        cleanup();
        resolve(user || null);
      });
    });
  });
}

// ── 图片预览 ──────────────────────────────────────────────────────────────
function showImgOverlay(src) {
  if (window.bugViewerAPI && window.bugViewerAPI.previewImage) {
    window.bugViewerAPI.previewImage(src);
  } else {
    window.open(src, '_blank');
  }
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

function bindChipGroup(groupId) {
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

  closeDetail();
  hideInlineActionBar();
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

  if (window.bugViewerAPI && window.bugViewerAPI.onRefresh) {
    window.bugViewerAPI.onRefresh(() => loadBugs(true));
  }
}

// ── 初始化 ────────────────────────────────────────────────────────────────
async function init() {
  loadPrefs();
  loadReadIds();

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });

  applyPinState();

  await loadUsers();
  bindEvents();

  if (state.currentUserId) {
    await loadBugs();
  }

  startPolling();
}

init();
