const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('subburnin', {
  processVideo(filePath, optionsOrOnProgress, maybeOnProgress) {
    const onProgress = typeof optionsOrOnProgress === 'function'
      ? optionsOrOnProgress
      : maybeOnProgress;
    const options = typeof optionsOrOnProgress === 'function'
      ? {}
      : (optionsOrOnProgress || {});

    ipcRenderer.on('progress', (event, data) => onProgress(data));
    return ipcRenderer.invoke('ipc:process-video', filePath, options);
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

  checkDiarizationRuntime() {
    return ipcRenderer.invoke('ipc:check-diarization');
  },

  installDiarizationRuntime(onProgress) {
    ipcRenderer.on('diarization:install-progress', (event, data) => onProgress(data));
    return ipcRenderer.invoke('ipc:install-diarization');
  },

  removeDiarizationInstallProgressListener() {
    ipcRenderer.removeAllListeners('diarization:install-progress');
  },

  cancelDiarizationInstall() {
    return ipcRenderer.invoke('ipc:cancel-diarization-install');
  },

  openOutputDir(filePath) {
    return ipcRenderer.invoke('ipc:open-output-dir', filePath);
  },

  openOutputFolder(filePath) {
    return ipcRenderer.invoke('ipc:open-output-folder', filePath);
  },

  revealFileInFolder(filePath) {
    return ipcRenderer.invoke('ipc:reveal-file-in-folder', filePath);
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

  cancelProcessing() {
    return ipcRenderer.invoke('ipc:cancel-processing');
  },

  getFontIndex(forceRefresh = false) {
    return ipcRenderer.invoke('ipc:get-font-index', forceRefresh);
  },

  getDownloadedFonts() {
    return ipcRenderer.invoke('ipc:get-downloaded-fonts');
  },

  downloadGoogleFont(family, variant = 'regular') {
    return ipcRenderer.invoke('ipc:download-google-font', family, variant);
  },

  createPreviewProxy(videoPath) {
    return ipcRenderer.invoke('ipc:create-preview-proxy', videoPath);
  }
});
