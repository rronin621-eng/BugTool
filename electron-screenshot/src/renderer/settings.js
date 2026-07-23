/* settings.js — 快捷键设置页面渲染逻辑 */

const api = window.settingsAPI;

const elInput = document.getElementById('shortcutInput');
const elError = document.getElementById('errorMsg');
const btnSave = document.getElementById('btnSave');
const btnReset = document.getElementById('btnReset');

let currentAccelerator = '';
let pendingAccelerator = '';

function displayAccel(accel) {
  return accel
    .replace(/CommandOrControl/g, 'Cmd')
    .replace(/Alt/g, 'Option')
    .replace(/Shift/g, 'Shift')
    .replace(/Plus/g, '+');
}

async function init() {
  try {
    currentAccelerator = await api.getShortcut();
    elInput.value = displayAccel(currentAccelerator);
  } catch (e) {
    elError.textContent = '加载当前快捷键失败';
  }
}

function setPending(accel) {
  pendingAccelerator = accel;
  elInput.value = displayAccel(accel);
  elError.textContent = '';
  btnSave.disabled = (accel === currentAccelerator);
}

// 解析按键事件为 accelerator 格式
function parseKeyEvent(e) {
  const modifiers = [];
  if (e.metaKey) modifiers.push('CommandOrControl');
  if (e.ctrlKey && !e.metaKey) modifiers.push('CommandOrControl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');

  const keyMap = {
    Space: 'Space',
    Tab: 'Tab',
    Escape: 'Escape',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };

  let key = '';
  if (keyMap[e.code]) {
    key = keyMap[e.code];
  } else if (/^Key[A-Z]$/.test(e.code)) {
    key = e.code.replace('Key', '');
  } else if (/^Digit[0-9]$/.test(e.code)) {
    key = e.code.replace('Digit', '');
  } else if (/^F(1[0-2]|[1-9])$/.test(e.code)) {
    key = e.code;
  } else if (e.code === 'Equal') {
    key = 'Plus';
  }

  if (!key) return null;
  if (modifiers.length === 0) return null; // 必须带修饰键

  const order = ['CommandOrControl', 'Alt', 'Shift'];
  const sorted = modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...sorted, key].join('+');
}

// 输入框捕获按键
elInput.addEventListener('focus', () => {
  elInput.classList.add('recording');
});

elInput.addEventListener('blur', () => {
  elInput.classList.remove('recording');
});

elInput.addEventListener('keydown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const accel = parseKeyEvent(e);
  if (accel) {
    setPending(accel);
  }
});

// 恢复默认
btnReset.addEventListener('click', async () => {
  try {
    const def = await api.getDefaultShortcut();
    setPending(def);
  } catch (e) {
    elError.textContent = '获取默认快捷键失败';
  }
});

// 保存
btnSave.addEventListener('click', async () => {
  if (!pendingAccelerator) return;
  btnSave.disabled = true;
  elError.textContent = '';
  try {
    const result = await api.saveShortcut(pendingAccelerator);
    if (result && result.success) {
      currentAccelerator = pendingAccelerator;
      elError.textContent = '保存成功';
      elError.style.color = '#22c55e';
      setTimeout(() => {
        elError.textContent = '';
        elError.style.color = '';
      }, 2000);
    } else {
      elError.textContent = (result && result.message) || '保存失败';
      btnSave.disabled = false;
    }
  } catch (e) {
    elError.textContent = '保存异常：' + (e && e.message);
    btnSave.disabled = false;
  }
});

init();
