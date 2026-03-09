const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('subburnin', {
  processVideo(filePath, onProgress) {
    ipcRenderer.on('progress', (event, data) => onProgress(data));
    return ipcRenderer.invoke('ipc:process-video', filePath);
  },

  removeProgressListener() {
    ipcRenderer.removeAllListeners('progress');
  },

  getConfig() {
    return ipcRenderer.invoke('ipc:get-config');
  },

  setConfig(partial) {
    return ipcRenderer.invoke('ipc:set-config', partial);
  },

  openOutputDir(filePath) {
    return ipcRenderer.invoke('ipc:open-output-dir', filePath);
  },

  getFilePath(file) {
    return webUtils.getPathForFile(file);
  },

  downloadModel(size, language, onProgress) {
    ipcRenderer.on('model:download-progress', (event, data) => onProgress(data));
    return ipcRenderer.invoke('ipc:download-model', size, language);
  },

  removeModelProgressListener() {
    ipcRenderer.removeAllListeners('model:download-progress');
  },

  cancelDownload() {
    return ipcRenderer.invoke('ipc:cancel-download');
  },

  getFontIndex(forceRefresh = false) {
    return ipcRenderer.invoke('ipc:get-font-index', forceRefresh);
  },

  getDownloadedFonts() {
    return ipcRenderer.invoke('ipc:get-downloaded-fonts');
  },

  downloadGoogleFont(family, variant = 'regular') {
    return ipcRenderer.invoke('ipc:download-google-font', family, variant);
  }
});
