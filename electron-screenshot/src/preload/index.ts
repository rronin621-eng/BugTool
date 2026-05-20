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
  updateBugStatus: (bugId: number, status: string, comment?: string) =>
    ipcRenderer.invoke('bug:update-status', bugId, status, comment),
  getUsers: () => ipcRenderer.invoke('users:list'),
  onRefresh: (callback: () => void) => {
    ipcRenderer.on('viewer:refresh', () => callback());
  },
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('viewer:set-always-on-top', value),
  previewImage: (imageUrl: string) => ipcRenderer.invoke('image:preview', imageUrl),
});

