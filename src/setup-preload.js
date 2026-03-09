const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  check() {
    return ipcRenderer.invoke('setup:check');
  },

  install(onProgress) {
    ipcRenderer.on('setup:progress', (_, data) => onProgress(data));
    return ipcRenderer.invoke('setup:install');
  },

  removeProgressListener() {
    ipcRenderer.removeAllListeners('setup:progress');
  },

  getConfig() {
    return ipcRenderer.invoke('ipc:get-config');
  },

  saveModelConfig(size, language) {
    return ipcRenderer.invoke('ipc:set-config', {
      whisper_model_size: size,
      whisper_language: language
    });
  },

  setCustomPath(step, value) {
    return ipcRenderer.invoke('setup:set-custom-path', step, value);
  },

  getFilePath(file) {
    const { webUtils } = require('electron');
    return webUtils.getPathForFile(file);
  },

  browseForPath(step) {
    return ipcRenderer.invoke('setup:browse-for-path', step);
  },

  cancel() {
    return ipcRenderer.invoke('setup:cancel');
  }
});
