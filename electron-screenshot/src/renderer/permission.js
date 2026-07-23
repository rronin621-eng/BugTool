const permissionList = document.getElementById('permissionList');
const btnContinue = document.getElementById('btnContinue');
const btnRetry = document.getElementById('btnRetry');

const ICONS = {
  screen: '📷',
  accessibility: '⌨️',
};

function statusClass(status) {
  return status === 'granted' ? 'granted' : 'missing';
}

function statusText(status) {
  switch (status) {
    case 'granted': return '已授权';
    case 'not-determined': return '未授权';
    case 'denied': return '已拒绝';
    case 'restricted': return '受限制';
    default: return '未知';
  }
}

function renderPermissions(permissions) {
  if (!permissionList) return;
  permissionList.innerHTML = '';

  let allGranted = true;

  for (const p of permissions) {
    if (p.status !== 'granted') {
      allGranted = false;
    }

    const item = document.createElement('div');
    item.className = 'permission-item';
    item.innerHTML = `
      <div class="permission-icon ${p.id}">${ICONS[p.id] || '🔒'}</div>
      <div class="permission-info">
        <div class="permission-name">
          ${p.name}
          <span class="permission-status ${statusClass(p.status)}">${statusText(p.status)}</span>
        </div>
        <div class="permission-desc">${p.description}</div>
        <div class="permission-actions">
          <button class="btn btn-primary" data-pane="${p.preferencePane}" ${p.status === 'granted' ? 'disabled' : ''}>
            ${p.status === 'granted' ? '已开启' : '打开设置'}
          </button>
        </div>
      </div>
    `;

    const openBtn = item.querySelector('button[data-pane]');
    if (openBtn && p.status !== 'granted') {
      openBtn.addEventListener('click', () => {
        window.permissionAPI.openSystemPreferences(p.preferencePane);
      });
    }

    permissionList.appendChild(item);
  }

  if (btnContinue) {
    btnContinue.disabled = !allGranted;
    btnContinue.textContent = allGranted ? '继续' : '请先授权';
  }
}

async function refreshPermissions() {
  try {
    const permissions = await window.permissionAPI.getPermissions();
    renderPermissions(permissions);
  } catch (err) {
    console.error('[Permission] 刷新权限状态失败:', err);
  }
}

if (btnContinue) {
  btnContinue.addEventListener('click', () => {
    window.permissionAPI.continue();
  });
}

if (btnRetry) {
  btnRetry.addEventListener('click', () => {
    refreshPermissions();
  });
}

// 启动时立即刷新一次
refreshPermissions();

// 每 1.5 秒轮询一次权限状态
setInterval(refreshPermissions, 1500);

// 监听主进程主动推送的权限更新
if (window.permissionAPI.onPermissionUpdate) {
  window.permissionAPI.onPermissionUpdate(() => {
    refreshPermissions();
  });
}
