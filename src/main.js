const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Ensure homebrew bin is in PATH so whisper-cli is findable on macOS
if (process.platform === 'darwin') {
  process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;
}

const { getConfig, setConfig } = require('./services/config');
const { extractAudio, burnSubBurnIn, createPreviewProxy } = require('./services/ffmpeg');
const { transcribe } = require('./services/whisper');
const { segmentsToAss } = require('./services/converter');
const { isSetupComplete, checkDependencies, runSetup, downloadModel, getModelPath, getModelFilename } = require('./services/setup');
const {
  FONTS_DIR,
  getGoogleFontsIndex,
  refreshGoogleFontsIndex,
  listDownloadedFonts,
  downloadGoogleFont
} = require('./services/fonts');
const {
  checkDiarizationRuntime,
  installDiarizationRuntime
} = require('./services/diarization');

let activeDownloadController = null;
let activeSetupController    = null;
let activeProcessingController = null;
let activeDiarizationInstallController = null;

// --- Window factories ---

function createMainWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 540,
    resizable: false,
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  return win;
}

// --- App startup ---

async function probePermissions() {
  const config = getConfig();
  const probeDirs = [
    app.getPath('downloads'),
    app.getPath('desktop'),
    app.getPath('documents')
  ];
  if (config.output_dir && !probeDirs.includes(config.output_dir)) {
    probeDirs.push(config.output_dir);
  }
  for (const dir of probeDirs) {
    try {
      const probePath = path.join(dir, '.subburnin_probe');
      fs.writeFileSync(probePath, '');
      fs.unlinkSync(probePath);
    } catch {
      // silent — purpose is to trigger macOS permission dialog
    }
  }
}

app.whenReady().then(async () => {
  await probePermissions();
  const cfg = getConfig();
  if (isSetupComplete(cfg.whisper_model_size, cfg.whisper_language, cfg)) {
    createMainWindow();
  } else {
    createSetupWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

// --- IPC: Setup ---

ipcMain.handle('setup:browse-for-path', async (event, step) => {
  const filters = step === 'model'
    ? [{ name: 'Whisper Model', extensions: ['bin'] }, { name: 'All Files', extensions: ['*'] }]
    : [{ name: 'Executable', extensions: ['*'] }];

  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: step === 'model' ? 'Select Whisper model (.bin)' : `Select ${step} binary`,
    properties: ['openFile'],
    filters
  });

  return result.cancelled ? null : result.filePaths[0];
});

ipcMain.handle('setup:set-custom-path', (event, step, value) => {
  if (!fs.existsSync(value)) {
    return { ok: false, error: 'Path does not exist' };
  }
  if (step === 'ffmpeg') {
    setConfig({ ffmpeg_path: value });
    return { ok: true, detail: 'ffmpeg path saved' };
  }
  if (step === 'whisper') {
    setConfig({ whisper_cli_path: value });
    return { ok: true, detail: 'whisper-cli path saved' };
  }
  if (step === 'model') {
    setConfig({ whisper_model_path_override: value });
    return { ok: true, detail: 'Model path saved' };
  }
  return { ok: false, error: 'Unknown step' };
});

ipcMain.handle('setup:check', () => {
  const cfg = getConfig();
  return checkDependencies(cfg.whisper_model_size, cfg.whisper_language, cfg);
});

ipcMain.handle('setup:install', async (event) => {
  const send = (data) => event.sender.send('setup:progress', data);
  const cfg  = getConfig();

  if (activeSetupController) activeSetupController.abort();
  activeSetupController = new AbortController();
  const { signal } = activeSetupController;

  try {
    await runSetup(send, cfg.whisper_model_size, cfg.whisper_language, signal);
    activeSetupController = null;
  } catch (err) {
    activeSetupController = null;
    if (err.cancelled) return { cancelled: true };
    throw err;
  }

  // Close setup window and open main window
  const setupWin = BrowserWindow.fromWebContents(event.sender);
  createMainWindow();
  if (setupWin) setupWin.close();
});

ipcMain.handle('setup:cancel', () => {
  if (activeSetupController) {
    activeSetupController.abort();
    activeSetupController = null;
  }
});

// --- IPC: Config ---

ipcMain.handle('ipc:get-config', () => {
  const config = getConfig();
  const deps = checkDependencies(config.whisper_model_size, config.whisper_language, config);
  return { ...config, model_downloaded: deps.model };
});

ipcMain.handle('ipc:set-config', (event, partial) => setConfig(partial));

// --- IPC: Diarization runtime ---

ipcMain.handle('ipc:check-diarization', async () => {
  const status = await checkDiarizationRuntime();
  setConfig({
    diarization_runtime_ready: Boolean(status.installed),
    diarization_runtime_path: status.installed ? status.runtimePath : ''
  });
  return status;
});

ipcMain.handle('ipc:install-diarization', async (event) => {
  if (activeDiarizationInstallController) activeDiarizationInstallController.abort();
  activeDiarizationInstallController = new AbortController();
  const { signal } = activeDiarizationInstallController;

  const send = (data) => event.sender.send('diarization:install-progress', data);

  try {
    const result = await installDiarizationRuntime(send, signal);
    activeDiarizationInstallController = null;
    return result;
  } catch (err) {
    activeDiarizationInstallController = null;
    if (err && err.cancelled) return { success: false, cancelled: true, error: err.message };
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ipc:cancel-diarization-install', () => {
  if (activeDiarizationInstallController) {
    activeDiarizationInstallController.abort();
    activeDiarizationInstallController = null;
  }
  return { cancelled: true };
});

// --- IPC: Fonts ---

ipcMain.handle('ipc:get-font-index', async (event, forceRefresh = false) => {
  const index = forceRefresh
    ? await refreshGoogleFontsIndex()
    : await getGoogleFontsIndex();
  return {
    fetchedAt: index.fetchedAt,
    fonts: index.fonts
  };
});

ipcMain.handle('ipc:get-downloaded-fonts', () => {
  return listDownloadedFonts();
});

ipcMain.handle('ipc:download-google-font', async (event, family, variant = 'regular') => {
  return downloadGoogleFont(family, 'latin', variant);
});

// --- IPC: Download model ---

ipcMain.handle('ipc:download-model', async (event, size, language) => {
  const send = (data) => event.sender.send('model:download-progress', data);
  const modelPath = getModelPath(size, language);

  if (fs.existsSync(modelPath)) {
    return { success: true, message: 'Already downloaded' };
  }

  // Cancel any in-flight download first
  if (activeDownloadController) activeDownloadController.abort();
  activeDownloadController = new AbortController();
  const { signal } = activeDownloadController;

  try {
    const filename = getModelFilename(size, language);
    send({ step: 'model', status: 'downloading', message: `Downloading ${filename}...`, percent: 0 });
    await downloadModel(size, language, (d) => send({ step: 'model', status: 'downloading', ...d }), signal);
    activeDownloadController = null;
    return { success: true };
  } catch (err) {
    activeDownloadController = null;
    if (err.cancelled) return { success: false, cancelled: true, error: 'Download cancelled' };
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ipc:cancel-download', () => {
  if (activeDownloadController) {
    activeDownloadController.abort();
    activeDownloadController = null;
  }
});

// --- IPC: Open output directory ---

ipcMain.handle('ipc:open-output-dir', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('ipc:open-output-folder', (event, filePath) => {
  if (!filePath) return;
  const folderPath = path.dirname(filePath);
  shell.openPath(folderPath);
});

ipcMain.handle('ipc:reveal-file-in-folder', (event, filePath) => {
  if (!filePath) return;
  shell.showItemInFolder(filePath);
});

ipcMain.handle('ipc:cancel-processing', () => {
  if (activeProcessingController) {
    activeProcessingController.abort();
    activeProcessingController = null;
  }
  return { cancelled: true };
});

ipcMain.handle('ipc:create-preview-proxy', async (event, videoPath) => {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, error: 'Source video not found' };
  }

  try {
    const stat = fs.statSync(videoPath);
    const key = crypto
      .createHash('sha1')
      .update(`${videoPath}|${stat.size}|${stat.mtimeMs}`)
      .digest('hex')
      .slice(0, 16);

    const cacheDir = path.join(os.tmpdir(), 'subburnin-preview-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const proxyPath = path.join(cacheDir, `${key}.mp4`);

    if (!fs.existsSync(proxyPath) || fs.statSync(proxyPath).size === 0) {
      await createPreviewProxy(videoPath, proxyPath);
    }

    return { success: true, proxyPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- IPC: Process video ---

ipcMain.handle('ipc:process-video', async (event, videoPath) => {
  if (activeProcessingController) activeProcessingController.abort();
  activeProcessingController = new AbortController();
  const { signal } = activeProcessingController;

  const tmpDir = path.join(os.tmpdir(), `subburnin-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const sendProgress = (data) => event.sender.send('progress', data);

  try {
    const config = getConfig();

    const videoDir = path.dirname(videoPath);
    const videoExt = path.extname(videoPath);
    const videoBaseName = path.basename(videoPath, videoExt);
    const outputDir = config.output_dir && fs.existsSync(config.output_dir)
      ? config.output_dir
      : videoDir;
    let outputVideoPath = path.join(outputDir, `${videoBaseName}_captioned${videoExt}`);
    if (fs.existsSync(outputVideoPath)) {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
      outputVideoPath = path.join(outputDir, `${videoBaseName}_captioned_${ts}${videoExt}`);
    }

    // Step 1: Extract audio
    sendProgress({ stage: 'extracting', percent: 10, message: 'Extracting audio...' });
    const wavPath = path.join(tmpDir, 'audio.wav');
    await extractAudio(videoPath, wavPath, sendProgress, signal);

    // Step 2: Transcribe
    sendProgress({ stage: 'transcribing', percent: 35, message: 'Transcribing with Whisper...' });
    const segments = await transcribe(wavPath, tmpDir, sendProgress, signal);
    sendProgress({
      stage: 'transcribing',
      percent: 55,
      message: 'Transcription ready for preview',
      preview: {
        videoPath,
        segments
      }
    });

    // Step 3: Convert segments → karaoke ASS
    sendProgress({ stage: 'converting', percent: 70, message: 'Converting subtitles...' });
    const assContent = segmentsToAss(segments, {
      textColor:      config.caption_text_color      || '#FFFFFF',
      highlightColor: config.caption_highlight_color || '#CFA84E',
      highlightBg:    config.caption_highlight_bg    || '#000000',
      outlineColor:   config.caption_outline_color   || '#000000',
      fontSize:       config.caption_font_size       || 64,
      fontFamily:     config.caption_font_family     || 'Roboto',
      fontVariant:    config.caption_font_variant    || 'regular'
    });
    const assPath = path.join(tmpDir, 'subburnin.ass');
    fs.writeFileSync(assPath, assContent, 'utf8');
    sendProgress({
      stage: 'converting',
      percent: 75,
      message: 'ASS preview ready',
      previewAss: {
        videoPath,
        assContent
      }
    });

    // Also save ASS alongside the output video for inspection
    const assOutputPath = path.join(outputDir, `${videoBaseName}_subburnin.ass`);
    fs.writeFileSync(assOutputPath, assContent, 'utf8');

    // Step 4: Burn subburnin
    sendProgress({ stage: 'burning', percent: 80, message: 'Burning subburnin onto video...' });
    await burnSubBurnIn(videoPath, assPath, outputVideoPath, sendProgress, { fontsDir: FONTS_DIR, signal });

    sendProgress({ stage: 'done', percent: 100, message: 'Done!', outputPath: outputVideoPath });
    activeProcessingController = null;
    return { success: true, outputPath: outputVideoPath };
  } catch (err) {
    if (err && err.cancelled) {
      sendProgress({ stage: 'cancelled', message: 'Processing cancelled.' });
      activeProcessingController = null;
      return { success: false, cancelled: true, error: 'Processing cancelled.' };
    }
    sendProgress({ stage: 'error', message: err.message });
    activeProcessingController = null;
    return { success: false, error: err.message };
  } finally {
    activeProcessingController = null;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
