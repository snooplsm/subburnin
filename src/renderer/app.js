const dropZone        = document.getElementById('drop-zone');
const progressSection = document.getElementById('progress-section');
const progressFill    = document.getElementById('progress-bar-fill');
const statusMsg       = document.getElementById('status-msg');
const outputSection   = document.getElementById('output-section');
const outputPath      = document.getElementById('output-path');
const openBtn         = document.getElementById('open-btn');
const resetBtn        = document.getElementById('reset-btn');
const settingsBtn     = document.getElementById('settings-btn');
const settingsPanel   = document.getElementById('settings-panel');
const overlay         = document.getElementById('overlay');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const closeSettingsBtn= document.getElementById('close-settings-btn');
const modelSizeInput  = document.getElementById('model-size-input');
const languageInput   = document.getElementById('language-input');
const threadsInput    = document.getElementById('threads-input');
const outputDirInput  = document.getElementById('output-dir-input');
const themeBtn        = document.getElementById('theme-btn');
const modelStatusDot  = document.getElementById('model-status-dot');
const modelStatusText = document.getElementById('model-status-text');
const downloadModelBtn    = document.getElementById('download-model-btn');
const cancelDownloadBtn   = document.getElementById('cancel-download-btn');
const modelDownloadProgress = document.getElementById('model-download-progress');
const captionTextColorInput      = document.getElementById('caption-text-color');
const captionHighlightColorInput = document.getElementById('caption-highlight-color');
const captionHighlightBgInput    = document.getElementById('caption-highlight-bg');
const captionOutlineColorInput   = document.getElementById('caption-outline-color');
const captionFontSizeInput       = document.getElementById('caption-font-size');

// Bidirectional sync: native color picker ↔ hex text field
const COLOR_PAIRS = [
  { pickId: 'caption-text-color-pick',       hexId: 'caption-text-color' },
  { pickId: 'caption-highlight-color-pick',  hexId: 'caption-highlight-color' },
  { pickId: 'caption-highlight-bg-pick',     hexId: 'caption-highlight-bg' },
  { pickId: 'caption-outline-color-pick',    hexId: 'caption-outline-color' }
];

function isValidHex(val) {
  return /^#([0-9a-f]{6}([0-9a-f]{2})?)$/i.test(val);
}

COLOR_PAIRS.forEach(({ pickId, hexId }) => {
  const picker = document.getElementById(pickId);
  const hexInput = document.getElementById(hexId);
  if (!picker || !hexInput) return;

  // Picker → hex field (only 6-digit; alpha must be typed manually)
  picker.addEventListener('input', () => {
    hexInput.value = picker.value.toUpperCase();
    hexInput.style.borderColor = '';
  });

  // Hex field → picker (use first 6 digits for the swatch)
  hexInput.addEventListener('input', () => {
    const val = hexInput.value.trim();
    if (isValidHex(val)) {
      picker.value = val.slice(0, 7);
      hexInput.style.borderColor = '';
    } else {
      hexInput.style.borderColor = val.length > 1 ? 'var(--error)' : '';
    }
  });
});

const STEPS = ['extracting', 'transcribing', 'converting', 'burning'];

let currentOutputPath = null;
let currentTheme = 'dark';

// ========================================
// Theme
// ========================================

function resolvedTheme(theme) {
  if (theme === 'system' || !theme) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(theme) {
  currentTheme = theme;
  const resolved = resolvedTheme(theme);
  document.documentElement.setAttribute('data-theme', resolved);
  // Cycle: system → dark → light → system
  if (theme === 'system') {
    themeBtn.textContent = resolved === 'dark' ? '☀' : '☾';
    themeBtn.title = 'Using system theme — click to override';
  } else if (theme === 'dark') {
    themeBtn.textContent = '☀';
    themeBtn.title = 'Dark theme — click for light';
  } else {
    themeBtn.textContent = '☾';
    themeBtn.title = 'Light theme — click for system';
  }
}

themeBtn.addEventListener('click', async () => {
  const cycle = { system: 'dark', dark: 'light', light: 'system' };
  const next = cycle[currentTheme] || 'dark';
  applyTheme(next);
  await window.subburnin.setConfig({ theme: next });
});

// ========================================
// Drag & Drop
// ========================================

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (!file) return;

  const allowed = ['.mp4', '.mov', '.mkv', '.avi', '.webm'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    showError(`Unsupported file type: ${ext}`);
    return;
  }

  startProcessing(window.subburnin.getFilePath(file));
});

// ========================================
// Whole-app drag & drop overlay
// ========================================

let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  if (settingsPanel.classList.contains('open')) return;
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  dragCounter++;
  document.body.classList.add('body-drag-over');
});

document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    document.body.classList.remove('body-drag-over');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('body-drag-over');

  if (settingsPanel.classList.contains('open')) return;

  // Don't double-process if the drop was on the existing drop zone
  if (e.target === dropZone || dropZone.contains(e.target)) return;

  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file) return;

  const allowed = ['.mp4', '.mov', '.mkv', '.avi', '.webm'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    showError(`Unsupported file type: ${ext}`);
    return;
  }

  startProcessing(window.subburnin.getFilePath(file));
});

// ========================================
// Processing
// ========================================

function startProcessing(filePath) {
  dropZone.classList.add('processing');
  progressSection.classList.add('visible');
  outputSection.classList.remove('visible');
  statusMsg.className = '';
  currentOutputPath = null;

  resetSteps();
  window.subburnin.removeProgressListener();

  window.subburnin.processVideo(filePath, (data) => {
    updateProgress(data);
  }).then((result) => {
    if (result.success) {
      currentOutputPath = result.outputPath;
      showSuccess(result.outputPath);
    } else {
      showError(result.error);
    }
  }).catch((err) => {
    showError(err.message || String(err));
  });
}

function updateProgress(data) {
  const { stage, percent, message } = data;

  if (percent !== undefined) {
    progressFill.style.width = `${percent}%`;
  }

  if (message) {
    statusMsg.textContent = message;
    statusMsg.className = '';
  }

  const stageOrder = { extracting: 0, transcribing: 1, converting: 2, burning: 3, done: 4 };
  const currentIdx = stageOrder[stage] ?? -1;

  STEPS.forEach((step, idx) => {
    const el = document.getElementById(`step-${step}`);
    if (idx < currentIdx) {
      el.className = 'step done';
    } else if (idx === currentIdx) {
      el.className = 'step active';
    } else {
      el.className = 'step';
    }
  });
}

function resetSteps() {
  STEPS.forEach((step) => {
    document.getElementById(`step-${step}`).className = 'step';
  });
  progressFill.style.width = '0%';
}

function showSuccess(filePath) {
  progressFill.style.width = '100%';
  STEPS.forEach((step) => {
    document.getElementById(`step-${step}`).className = 'step done';
  });
  statusMsg.textContent = 'Subtitles burned successfully!';
  outputPath.textContent = filePath;
  outputSection.classList.add('visible');
}

function showError(msg) {
  statusMsg.textContent = `Error: ${msg}`;
  statusMsg.className = 'error';
  dropZone.classList.remove('processing');
}

// ========================================
// Output buttons
// ========================================

openBtn.addEventListener('click', () => {
  if (currentOutputPath) {
    window.subburnin.openOutputDir(currentOutputPath);
  }
});

resetBtn.addEventListener('click', () => {
  dropZone.classList.remove('processing');
  progressSection.classList.remove('visible');
  outputSection.classList.remove('visible');
  statusMsg.textContent = '';
  resetSteps();
  currentOutputPath = null;
  window.subburnin.removeProgressListener();
});

// ========================================
// Settings
// ========================================

settingsBtn.addEventListener('click', openSettings);
overlay.addEventListener('click', closeSettings);
closeSettingsBtn.addEventListener('click', closeSettings);

async function openSettings() {
  const config = await window.subburnin.getConfig();

  modelSizeInput.value  = config.whisper_model_size || 'medium';
  languageInput.value   = config.whisper_language   || 'en';
  threadsInput.value    = config.whisper_threads     || 4;
  outputDirInput.value  = config.output_dir          || '';

  captionTextColorInput.value      = config.caption_text_color      || '#FFFFFF';
  captionHighlightColorInput.value = config.caption_highlight_color || '#CFA84E';
  captionHighlightBgInput.value    = config.caption_highlight_bg    || '#000000';
  captionOutlineColorInput.value   = config.caption_outline_color   || '#000000';
  captionFontSizeInput.value       = config.caption_font_size       || 64;

  // Sync color pickers to current hex values
  COLOR_PAIRS.forEach(({ pickId, hexId }) => {
    const picker   = document.getElementById(pickId);
    const hexInput = document.getElementById(hexId);
    if (picker && hexInput && isValidHex(hexInput.value)) {
      picker.value = hexInput.value.slice(0, 7);
    }
  });

  updateModelStatus(config.model_downloaded, config.whisper_model_size, config.whisper_language);

  settingsPanel.classList.add('open');
  overlay.classList.add('visible');
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  overlay.classList.remove('visible');
}

function updateModelStatus(downloaded, size, language) {
  if (downloaded) {
    modelStatusDot.className = 'model-status-dot ready';
    modelStatusText.textContent = `${getModelLabel(size, language)} — ready`;
    downloadModelBtn.textContent = 'Re-download';
    downloadModelBtn.disabled = false;
  } else {
    modelStatusDot.className = 'model-status-dot missing';
    modelStatusText.textContent = `${getModelLabel(size, language)} — not downloaded`;
    downloadModelBtn.textContent = 'Download';
    downloadModelBtn.disabled = false;
  }
}

function getModelLabel(size, language) {
  if (size === 'large') return 'ggml-large-v3';
  return language === 'en' ? `ggml-${size}.en` : `ggml-${size}`;
}

// Refresh model status when dropdowns change
modelSizeInput.addEventListener('change', checkModelStatus);
languageInput.addEventListener('change', checkModelStatus);

async function checkModelStatus() {
  // Save current selections then fetch updated config
  const size = modelSizeInput.value;
  const language = languageInput.value;
  await window.subburnin.setConfig({ whisper_model_size: size, whisper_language: language });
  const config = await window.subburnin.getConfig();
  updateModelStatus(config.model_downloaded, size, language);
}

// Download model button
downloadModelBtn.addEventListener('click', startModelDownload);

cancelDownloadBtn.addEventListener('click', async () => {
  cancelDownloadBtn.style.display = 'none';
  cancelDownloadBtn.disabled = true;
  modelDownloadProgress.textContent = 'Cancelling...';
  await window.subburnin.cancelDownload();
  window.subburnin.removeModelProgressListener();
});

async function startModelDownload() {
  const size     = modelSizeInput.value;
  const language = languageInput.value;

  downloadModelBtn.style.display  = 'none';
  cancelDownloadBtn.style.display = '';
  cancelDownloadBtn.disabled      = false;
  modelDownloadProgress.className = 'visible';
  modelDownloadProgress.textContent = 'Starting download...';

  window.subburnin.removeModelProgressListener();

  window.subburnin.downloadModel(size, language, (data) => {
    if (data.step === 'model') {
      if (data.percent !== undefined) {
        const resumeNote = data.resumed ? ' (resuming)' : '';
        modelDownloadProgress.textContent =
          `${data.downloaded}GB / ${data.total}GB — ${data.percent}%${resumeNote}`;
      } else if (data.message) {
        modelDownloadProgress.textContent = data.message;
      }
    }
  }).then((result) => {
    window.subburnin.removeModelProgressListener();
    cancelDownloadBtn.style.display = 'none';
    downloadModelBtn.style.display  = '';

    if (result.success) {
      modelDownloadProgress.textContent = 'Download complete!';
      updateModelStatus(true, size, language);
    } else if (result.cancelled) {
      modelDownloadProgress.textContent = 'Download paused — click Download to resume.';
      downloadModelBtn.textContent = 'Resume';
      downloadModelBtn.disabled = false;
    } else {
      modelDownloadProgress.textContent = `Error: ${result.error}`;
      downloadModelBtn.disabled = false;
    }
  }).catch((err) => {
    window.subburnin.removeModelProgressListener();
    cancelDownloadBtn.style.display = 'none';
    downloadModelBtn.style.display  = '';
    modelDownloadProgress.textContent = `Error: ${err.message}`;
    downloadModelBtn.disabled = false;
  });
}

saveSettingsBtn.addEventListener('click', async () => {
  await window.subburnin.setConfig({
    whisper_model_size:      modelSizeInput.value,
    whisper_language:        languageInput.value,
    whisper_threads:         parseInt(threadsInput.value, 10) || 4,
    output_dir:              outputDirInput.value.trim(),
    caption_text_color:      captionTextColorInput.value,
    caption_highlight_color: captionHighlightColorInput.value,
    caption_highlight_bg:    captionHighlightBgInput.value,
    caption_outline_color:   captionOutlineColorInput.value,
    caption_font_size:       parseInt(captionFontSizeInput.value, 10) || 64
  });
  closeSettings();
});

// ========================================
// Init — load config and apply theme
// ========================================

(async () => {
  const config = await window.subburnin.getConfig();
  applyTheme(config.theme || 'dark');
})();
