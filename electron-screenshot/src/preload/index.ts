import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('screenshotAPI', {
  onScreenshotStart: (callback: (imageData: string) => void) => {
    ipcRenderer.on('screenshot:start', (_event, imageData) => callback(imageData));
  },
  cancel: () => {
    ipcRenderer.send('screenshot:cancel');
  },
  copyToClipboard: (dataUrl: string) => {
    return ipcRenderer.invoke('screenshot:copy', dataUrl);
  },
  saveToDesktop: (dataUrl: string, filename: string) => {
    return ipcRenderer.invoke('screenshot:save', dataUrl, filename);
  },
  submitBug: (data: any) => {
    return ipcRenderer.invoke('bug:submit-dmp-browser', data);
  },
  launchDmpBrowser: () => {
    return ipcRenderer.invoke('dmp-browser:launch');
  },
  testDmpConnection: () => {
    return ipcRenderer.invoke('dmp-browser:test');
  },
  saveDmpFormDefaults: (data: any) => {
    return ipcRenderer.invoke('dmp-form:save-defaults', data);
  },
  loadDmpFormDefaults: () => {
    return ipcRenderer.invoke('dmp-form:load-defaults');
  },
  extendTimeout: () => {
    ipcRenderer.send('screenshot:extend-timeout');
  },
  setWindowLevel: (level: string) => {
    ipcRenderer.send('screenshot:set-level', level);
  },
  enterFormMode: () => {
    ipcRenderer.send('screenshot:enter-form-mode');
  },
  exitFormMode: () => {
    ipcRenderer.send('screenshot:exit-form-mode');
  },
  // Called when user starts selecting on this display — closes all other overlay windows
  focusThisDisplay: () => {
    ipcRenderer.send('screenshot:focus-display');
  },
  // 多图：添加当前图、查询数量
  addToMultiShot: (data: { dataUrl: string; hasText?: boolean; textContent?: string }) => {
    ipcRenderer.send('multishot:add', data);
  },
  getMultiShotCount: () => {
    return ipcRenderer.invoke('multishot:count');
  },
  onMultiShotAccepted: (callback: (data: { count: number; max: number }) => void) => {
    ipcRenderer.on('multishot:add-accepted', (_e, data) => callback(data));
  },
  onMultiShotRejected: (callback: (reason: string) => void) => {
    ipcRenderer.on('multishot:add-rejected', (_e, reason) => callback(reason));
  },
  // 编辑模式
  onEditStart: (callback: (data: { editIndex: number; dataUrl: string }) => void) => {
    ipcRenderer.on('edit:start', (_e, data) => callback(data));
  },
  replaceInMultiShot: (data: { index: number; dataUrl: string; hasText?: boolean; textContent?: string }) => {
    ipcRenderer.send('multishot:replace', data);
  },
  getUsers: () => {
    return ipcRenderer.invoke('users:list');
  },
  getInspectionTasks: () => {
    return ipcRenderer.invoke('tasks:list');
  },
  getFunctionModules: () => {
    return ipcRenderer.invoke('modules:list');
  },
});

contextBridge.exposeInMainWorld('bugViewerAPI', {
  getBugs: (params: any) => ipcRenderer.invoke('bugs:list', params),
  getBug: (bugId: number) => ipcRenderer.invoke('bug:get', bugId),
  updateBugStatus: (bugId: number, status: string, comment?: string, operatorId?: number) =>
    ipcRenderer.invoke('bug:update-status', bugId, status, comment, operatorId),
  transferBug: (bugId: number, assigneeId: number, operatorId?: number, comment?: string) =>
    ipcRenderer.invoke('bug:transfer', bugId, assigneeId, operatorId, comment),
  updateCollaborators: (bugId: number, userIds: number[]) =>
    ipcRenderer.invoke('bug:update-collaborators', bugId, userIds),
  acceptBug: (bugId: number, accepted: boolean, operatorId?: number, comment?: string) =>
    ipcRenderer.invoke('bug:accept', bugId, accepted, operatorId, comment),
  getUsers: () => ipcRenderer.invoke('users:list'),
  onRefresh: (callback: () => void) => {
    ipcRenderer.on('viewer:refresh', () => callback());
  },
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('viewer:set-always-on-top', value),
  previewImage: (imageUrl: string) => ipcRenderer.invoke('image:preview', imageUrl),
});

// 暂存小窗 API
contextBridge.exposeInMainWorld('stackAPI', {
  getList: () => ipcRenderer.invoke('multishot:get-list'),
  onListUpdated: (callback: (data: { images: string[]; textInfo: { hasText: boolean; textContent: string }[] }) => void) => {
    ipcRenderer.on('multishot:list-updated', (_e, images, textInfo) => callback({ images, textInfo }));
  },
  remove: (index: number) => ipcRenderer.send('multishot:remove', index),
  clear: () => ipcRenderer.send('multishot:clear'),
  openCombine: () => ipcRenderer.send('multishot:open-combine'),
  copySingle: (index: number) => ipcRenderer.invoke('multishot:copy-single', index),
  copyText: (index: number) => ipcRenderer.invoke('multishot:copy-text', index),
  setCombineSelected: (indices: number[]) => ipcRenderer.send('multishot:set-combine-selected', indices),
  combineSelected: () => ipcRenderer.send('multishot:combine-selected'),
  previewImage: (index: number) => ipcRenderer.invoke('multishot:preview', index),
  editImage: (index: number) => ipcRenderer.invoke('multishot:edit', index),
});

// 录屏 API
contextBridge.exposeInMainWorld('recordAPI', {
  // 截图窗口：请求开始录屏（传入框选区域）
  startRegionRecording: (region: any) => ipcRenderer.send('record:start', region),
  // 录制窗口：
  getRegion: () => ipcRenderer.invoke('record:get-region'),
  getScreenSource: () => ipcRenderer.invoke('record:get-screen-source'),
  expand: () => ipcRenderer.send('record:expand'),
  close: () => ipcRenderer.send('record:close'),
  save: (buffer: ArrayBuffer) => ipcRenderer.invoke('record:save', buffer),
  submitBug: (data: any) => ipcRenderer.invoke('record:submit-bug', data),
  getUsers: () => ipcRenderer.invoke('users:list'),
  getInspectionTasks: () => ipcRenderer.invoke('tasks:list'),
  getFunctionModules: () => ipcRenderer.invoke('modules:list'),
});

// 组合编辑器 API
contextBridge.exposeInMainWorld('combineAPI', {
  getList: () => ipcRenderer.invoke('combine:get-list'),
  copyToClipboard: (dataUrl: string) => ipcRenderer.invoke('combine:copy', dataUrl),
  saveToDesktop: (dataUrl: string, filename: string) => ipcRenderer.invoke('combine:save', dataUrl, filename),
  submitBug: (data: any) => ipcRenderer.invoke('bug:submit', data),
  getUsers: () => ipcRenderer.invoke('users:list'),
  getInspectionTasks: () => ipcRenderer.invoke('tasks:list'),
  getFunctionModules: () => ipcRenderer.invoke('modules:list'),
  finish: () => ipcRenderer.send('multishot:finish'),
  close: () => ipcRenderer.send('multishot:close-combine'),
  setWindowLevel: (level: string) => ipcRenderer.send('combine:set-level', level),
});

