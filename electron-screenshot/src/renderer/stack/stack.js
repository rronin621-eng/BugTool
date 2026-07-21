/* stack.js — 截图收集浮窗渲染逻辑 */

const api = window.stackAPI;

const elThumbList = document.getElementById('thumbList');
const elCount = document.getElementById('count');
const elBtnCombine = document.getElementById('btnCombine');
const elBtnClear = document.getElementById('btnClear');

let currentImages = [];
let currentTextInfo = [];
let selectedSet = new Set(); // 多选索引集合

function render(data) {
  // 兼容旧版：data 可能是数组，也可能是 { images, textInfo }
  if (Array.isArray(data)) {
    currentImages = data;
    currentTextInfo = data.map(() => ({ hasText: false, textContent: '' }));
  } else {
    currentImages = (data && data.images) || [];
    currentTextInfo = (data && data.textInfo) || currentImages.map(() => ({ hasText: false, textContent: '' }));
  }

  const MAX = 10;
  elCount.textContent = `(${currentImages.length}/${MAX})`;

  // 清理已不存在的选中项
  const newSelected = new Set();
  for (const idx of selectedSet) {
    if (idx < currentImages.length) newSelected.add(idx);
  }
  selectedSet = newSelected;
  updateCombineBtn();

  if (currentImages.length === 0) {
    elThumbList.innerHTML = '<div class="empty-hint">暂无图片<br>截图后点 ✓ 即可加入</div>';
    return;
  }

  elThumbList.innerHTML = '';
  currentImages.forEach((dataUrl, index) => {
    const info = currentTextInfo[index] || { hasText: false, textContent: '' };
    const isSelected = selectedSet.has(index);

    const thumb = document.createElement('div');
    thumb.className = 'thumb' + (isSelected ? ' selected' : '');
    thumb.dataset.index = String(index);

    // 多选框
    const checkboxWrap = document.createElement('div');
    checkboxWrap.className = 'thumb-checkbox-wrap';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'thumb-checkbox';
    checkbox.checked = isSelected;
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedSet.add(index);
        thumb.classList.add('selected');
      } else {
        selectedSet.delete(index);
        thumb.classList.remove('selected');
      }
      updateCombineBtn();
    });
    checkboxWrap.appendChild(checkbox);

    // 图片容器
    const imgWrap = document.createElement('div');
    imgWrap.className = 'thumb-img-wrap';

    const indexLabel = document.createElement('span');
    indexLabel.className = 'thumb-index';
    indexLabel.textContent = String(index + 1);

    // hover 操作按钮组
    const actions = document.createElement('div');
    actions.className = 'thumb-actions';

    // 编辑按钮
    const btnEdit = document.createElement('button');
    btnEdit.className = 'thumb-action-btn';
    btnEdit.setAttribute('data-tip', '继续编辑');
    btnEdit.innerHTML = '✏️';
    btnEdit.addEventListener('click', (e) => {
      e.stopPropagation();
      api.editImage(index);
    });

    // 复制图片按钮
    const btnCopyImg = document.createElement('button');
    btnCopyImg.className = 'thumb-action-btn';
    btnCopyImg.setAttribute('data-tip', '复制图片');
    btnCopyImg.innerHTML = '📋';
    btnCopyImg.addEventListener('click', (e) => {
      e.stopPropagation();
      api.copySingle(index);
    });

    // 复制文字按钮（仅有文字时显示）
    if (info.hasText) {
      const btnCopyText = document.createElement('button');
      btnCopyText.className = 'thumb-action-btn';
      btnCopyText.setAttribute('data-tip', '复制文字');
      btnCopyText.innerHTML = 'T';
      btnCopyText.style.fontWeight = '700';
      btnCopyText.style.fontSize = '11px';
      btnCopyText.addEventListener('click', (e) => {
        e.stopPropagation();
        api.copyText(index);
      });
      actions.appendChild(btnEdit);
      actions.appendChild(btnCopyImg);
      actions.appendChild(btnCopyText);
    } else {
      actions.appendChild(btnEdit);
      actions.appendChild(btnCopyImg);
    }

    // 删除按钮
    const btnRemove = document.createElement('button');
    btnRemove.className = 'thumb-action-btn remove-btn';
    btnRemove.setAttribute('data-tip', '删除');
    btnRemove.innerHTML = '×';
    btnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      api.remove(index);
    });
    actions.appendChild(btnRemove);

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = `截图${index + 1}`;
    img.addEventListener('click', () => {
      api.previewImage(index);
    });

    imgWrap.appendChild(indexLabel);
    imgWrap.appendChild(actions);
    imgWrap.appendChild(img);

    thumb.appendChild(checkboxWrap);
    thumb.appendChild(imgWrap);

    elThumbList.appendChild(thumb);
  });
}

function updateCombineBtn() {
  const count = selectedSet.size;
  elBtnCombine.disabled = count < 2;
  if (count >= 2) {
    elBtnCombine.textContent = `生成组合图 (${count})`;
  } else {
    elBtnCombine.textContent = '生成组合图';
  }
  // 同步选中状态到主进程
  api.setCombineSelected(Array.from(selectedSet).sort((a, b) => a - b));
}

elBtnCombine.addEventListener('click', () => {
  if (selectedSet.size >= 2) {
    api.combineSelected();
  }
});

elBtnClear.addEventListener('click', () => {
  if (currentImages.length === 0) return;
  if (confirm('确定清空所有已收集的图片吗？')) {
    api.clear();
  }
});

api.onListUpdated((data) => {
  render(data);
});

// 初始加载
api.getList().then((res) => {
  render(res);
}).catch(() => {
  render({ images: [], textInfo: [] });
});
