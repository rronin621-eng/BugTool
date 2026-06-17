/* stack.js — 暂存小窗渲染逻辑 */

const api = window.stackAPI;
const MAX = 5;

const elThumbList = document.getElementById('thumbList');
const elCount = document.getElementById('count');
const elBtnCombine = document.getElementById('btnCombine');
const elBtnClear = document.getElementById('btnClear');

let currentImages = [];

function render(images) {
  currentImages = images || [];
  elCount.textContent = `(${currentImages.length}/${MAX})`;

  if (currentImages.length === 0) {
    elThumbList.innerHTML = '<div class="empty-hint">暂无图片<br>截图后点「多图」加入</div>';
    elBtnCombine.disabled = true;
    return;
  }

  elBtnCombine.disabled = false;
  elThumbList.innerHTML = '';
  currentImages.forEach((dataUrl, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.innerHTML = `
      <span class="thumb-index">${index + 1}</span>
      <button class="thumb-remove" title="删除" data-index="${index}">×</button>
      <img src="${dataUrl}" alt="截图${index + 1}">
    `;
    elThumbList.appendChild(thumb);
  });

  elThumbList.querySelectorAll('.thumb-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      api.remove(idx);
    });
  });
}

elBtnCombine.addEventListener('click', () => {
  if (currentImages.length > 0) {
    api.openCombine();
  }
});

elBtnClear.addEventListener('click', () => {
  if (currentImages.length === 0) return;
  if (confirm('确定清空所有已收集的图片吗？')) {
    api.clear();
  }
});

api.onListUpdated((images) => {
  render(images);
});

// 初始加载
api.getList().then((res) => {
  render(res.images);
}).catch(() => {
  render([]);
});
