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
    return ipcRenderer.invoke('bug:submit', data);
  },
  extendTimeout: () => {
    ipcRenderer.send('screenshot:extend-timeout');
  },
  setWindowLevel: (level: string) => {
    ipcRenderer.send('screenshot:set-level', level);
  },
  // 多图：添加当前图、查询数量
  addToMultiShot: (dataUrl: string) => {
    ipcRenderer.send('multishot:add', dataUrl);
  },
  getMultiShotCount: () => {
    return ipcRenderer.invoke('multishot:count');
  },
  onMultiShotRejected: (callback: (reason: string) => void) => {
    ipcRenderer.on('multishot:add-rejected', (_e, reason) => callback(reason));
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
  onListUpdated: (callback: (images: string[]) => void) => {
    ipcRenderer.on('multishot:list-updated', (_e, images) => callback(images));
  },
  remove: (index: number) => ipcRenderer.send('multishot:remove', index),
  clear: () => ipcRenderer.send('multishot:clear'),
  openCombine: () => ipcRenderer.send('multishot:open-combine'),
});

// 组合编辑器 API
contextBridge.exposeInMainWorld('combineAPI', {
  getList: () => ipcRenderer.invoke('multishot:get-list'),
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

