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
const captionFontFamilyInput     = document.getElementById('caption-font-family');
const captionFontVariantInput    = document.getElementById('caption-font-variant');
const fontFamilyMenu             = document.getElementById('font-family-menu');
const fontFamilyStatus           = document.getElementById('font-family-status');
const downloadFontBtn            = document.getElementById('download-font-btn');
const refreshFontIndexBtn        = document.getElementById('refresh-font-index-btn');
const fontPopup                  = document.getElementById('font-popup');
const fontPopupSearch            = document.getElementById('font-popup-search');
const fontPopupClose             = document.getElementById('font-popup-close');

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeFontName(fontName) {
  return String(fontName || '').trim().replace(/\s+/g, ' ');
}

function normalizeVariant(variant) {
  return String(variant || 'regular').trim().toLowerCase();
}

function parseVariant(variant) {
  const v = normalizeVariant(variant);
  if (v === 'regular') return { weight: 400, italic: false };
  if (v === 'italic') return { weight: 400, italic: true };
  const m = v.match(/^(\d{3})(italic)?$/);
  if (m) return { weight: parseInt(m[1], 10), italic: Boolean(m[2]) };
  return { weight: 400, italic: false };
}

function variantLabel(variant) {
  const v = normalizeVariant(variant);
  if (v === 'regular') return 'Regular (400)';
  if (v === 'italic') return 'Regular Italic (400)';
  const m = v.match(/^(\d{3})(italic)?$/);
  if (!m) return variant;
  const weight = parseInt(m[1], 10);
  const names = {
    100: 'Thin',
    200: 'Extra Light',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'Semi Bold',
    700: 'Bold',
    800: 'Extra Bold',
    900: 'Black'
  };
  const label = `${names[weight] || weight} (${weight})`;
  return m[2] ? `${label} Italic` : label;
}

function buildSuggestionLabel(family, query) {
  const safeFamily = escapeHtml(family);
  if (!query) return safeFamily;

  const idx = family.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return safeFamily;

  const start = escapeHtml(family.slice(0, idx));
  const hit = escapeHtml(family.slice(idx, idx + query.length));
  const end = escapeHtml(family.slice(idx + query.length));
  return `${start}<mark>${hit}</mark>${end}`;
}

function escapeAttr(value) {
  return String(value).replace(/"/g, '&quot;');
}

function detectLocalFonts() {
  if (!document.fonts || typeof document.fonts.check !== 'function') return ['Roboto'];
  const available = LOCAL_FONT_CANDIDATES.filter((family) => document.fonts.check(`16px "${family}"`));
  if (!available.includes('Roboto')) available.unshift('Roboto');
  return available;
}

function uniqueFamilies(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function getFontSources() {
  const local = localFontFamilies.map((family) => ({ family, source: 'local' }));
  const downloaded = downloadedFontFamilies.map((entry) => ({ family: entry.family, source: 'downloaded' }));
  const google = googleFontFamilies.map((family) => ({ family, source: 'google' }));
  return uniqueFamilies([...downloaded, ...local, ...google]);
}

function getVariantOptionsForFamily(family) {
  const normalized = normalizeFontName(family).toLowerCase();
  const googleVariants = googleFontVariantsByFamily.get(normalized);
  if (googleVariants && googleVariants.length > 0) return googleVariants;
  return ['regular', '500', '700', '900', 'italic'];
}

function populateVariantSelect(preferredVariant) {
  const family = normalizeFontName(captionFontFamilyInput.value);
  const options = getVariantOptionsForFamily(family);
  const preferred = normalizeVariant(preferredVariant || captionFontVariantInput.value || 'regular');
  const selected = options.includes(preferred) ? preferred : (options.includes('regular') ? 'regular' : options[0]);

  captionFontVariantInput.innerHTML = options.map((variant) =>
    `<option value="${escapeAttr(variant)}">${escapeHtml(variantLabel(variant))}</option>`
  ).join('');
  captionFontVariantInput.value = selected;
}

function rankFontSuggestion(a, b, query) {
  if (!query) return a.family.localeCompare(b.family);
  const aName = a.family.toLowerCase();
  const bName = b.family.toLowerCase();
  const q = query.toLowerCase();
  const aStarts = aName.startsWith(q) ? 0 : 1;
  const bStarts = bName.startsWith(q) ? 0 : 1;
  if (aStarts !== bStarts) return aStarts - bStarts;
  const aIdx = aName.indexOf(q);
  const bIdx = bName.indexOf(q);
  if (aIdx !== bIdx) return aIdx - bIdx;
  return a.family.localeCompare(b.family);
}

function closeFontMenu() {
  fontPopup.classList.remove('open');
  fontFamilyMenu.innerHTML = '';
  fontSuggestions = [];
  activeFontSuggestionIndex = 0;
}

function openFontMenu() {
  if (fontSuggestions.length === 0) {
    closeFontMenu();
    return;
  }
}

function getFontQuery() {
  if (fontPopup.classList.contains('open')) {
    return normalizeFontName(fontPopupSearch.value);
  }
  return normalizeFontName(captionFontFamilyInput.value);
}

function renderFontSuggestions() {
  const query = getFontQuery();
  const sources = getFontSources();
  const filtered = query
    ? sources.filter((item) => item.family.toLowerCase().includes(query.toLowerCase()))
    : sources;

  fontSuggestions = filtered
    .sort((a, b) => rankFontSuggestion(a, b, query))
    .slice(0, 10);

  if (fontSuggestions.length === 0) {
    fontFamilyMenu.innerHTML = '<div class="font-no-results">No matching fonts</div>';
    return;
  }

  if (activeFontSuggestionIndex >= fontSuggestions.length) {
    activeFontSuggestionIndex = 0;
  }

  for (const item of fontSuggestions) {
    ensurePreviewWebFont(item.family);
  }

  const variantMeta = parseVariant(captionFontVariantInput.value || 'regular');
  const sampleWeight = variantMeta.weight || 400;
  const sampleStyle = variantMeta.italic ? 'italic' : 'normal';

  fontFamilyMenu.innerHTML = fontSuggestions.map((item, idx) => `
    <button
      class="font-family-option${idx === activeFontSuggestionIndex ? ' active' : ''}"
      type="button"
      data-family="${escapeHtml(item.family)}"
    >
      <span class="font-option-top">
        <span class="font-family-name">${buildSuggestionLabel(item.family, query)}</span>
        <span class="font-source-pill">${item.source}</span>
      </span>
      <span
        class="font-option-sample"
        style="font-family: &quot;${escapeAttr(item.family)}&quot;, Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-weight: ${sampleWeight}; font-style: ${sampleStyle};"
      >The quick brown fox jumps over the lazy dog 0123456789</span>
    </button>
  `).join('');

  openFontMenu();
}

function applyFontSuggestionByIndex(index) {
  if (!fontSuggestions[index]) return;
  captionFontFamilyInput.value = fontSuggestions[index].family;
  fontPopupSearch.value = fontSuggestions[index].family;
  populateVariantSelect();
  closeFontMenu();
  refreshFontPreview();
}

function updateFontStatus(text, isError = false) {
  fontFamilyStatus.textContent = text;
  fontFamilyStatus.style.color = isError ? 'var(--error)' : '';
}

function selectedFontHasGoogleEntry(fontFamily) {
  const normalized = normalizeFontName(fontFamily).toLowerCase();
  return googleFontVariantsByFamily.has(normalized);
}

function selectedFontIsDownloaded(fontFamily, variant = null) {
  const normalizedFamily = normalizeFontName(fontFamily).toLowerCase();
  const normalizedVariant = normalizeVariant(variant || captionFontVariantInput.value || 'regular');
  return downloadedFontFamilies.some((entry) =>
    entry.family.toLowerCase() === normalizedFamily && normalizeVariant(entry.variant) === normalizedVariant
  );
}

function selectedFontIsLocal(fontFamily) {
  const normalized = fontFamily.toLowerCase();
  return localFontFamilies.some((family) => family.toLowerCase() === normalized);
}

function getCanonicalGoogleFamily(fontFamily) {
  const normalized = normalizeFontName(fontFamily).toLowerCase();
  return googleFontFamilies.find((family) => family.toLowerCase() === normalized) || null;
}

function setPreviewFont(fontFamily) {
  // Popup rows render live font samples; keep hook for download flow.
  return normalizeFontName(fontFamily) || 'Roboto';
}

async function downloadFontFamily(family, { forPreview = false, variant = null } = {}) {
  const chosenVariant = normalizeVariant(variant || captionFontVariantInput.value || 'regular');
  const normalized = `${family.toLowerCase()}::${chosenVariant}`;
  if (inFlightPreviewDownloads.has(normalized)) return;
  inFlightPreviewDownloads.add(normalized);

  if (forPreview) {
    updateFontStatus(`Downloading "${family}" for preview...`);
  } else {
    updateFontStatus(`Downloading "${family}"...`);
  }

  try {
    const result = await window.subburnin.downloadGoogleFont(family, chosenVariant);
    downloadedFontFamilies = await window.subburnin.getDownloadedFonts();
    failedPreviewDownloads.delete(normalized);
    updateFontStatus(`Downloaded ${result.family} (${result.variant}).`);
    renderFontSuggestions();
    setPreviewFont(family);
  } catch (err) {
    if (forPreview) failedPreviewDownloads.add(normalized);
    updateFontStatus(`Download failed: ${err.message}`, true);
  } finally {
    inFlightPreviewDownloads.delete(normalized);
    updateFontButtonsState();
  }
}

function refreshFontPreview({ allowAutoDownload = true } = {}) {
  const typed = normalizeFontName(captionFontFamilyInput.value) || 'Roboto';
  setPreviewFont(typed);

  if (previewDebounceTimer) {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = null;
  }

  if (!allowAutoDownload) return;

  const canonical = getCanonicalGoogleFamily(typed);
  const variant = normalizeVariant(captionFontVariantInput.value || 'regular');
  if (!canonical) return;
  if (selectedFontIsDownloaded(canonical, variant) || selectedFontIsLocal(canonical)) return;

  const key = `${canonical.toLowerCase()}::${variant}`;
  if (failedPreviewDownloads.has(key)) return;

  previewDebounceTimer = setTimeout(() => {
    downloadFontFamily(canonical, { forPreview: true, variant });
  }, 400);
}

function openFontPopup() {
  fontPopupSearch.value = captionFontFamilyInput.value;
  renderFontSuggestions();
  fontPopup.classList.add('open');
  setTimeout(() => fontPopupSearch.focus(), 0);
}

function updateFontButtonsState() {
  const family = normalizeFontName(captionFontFamilyInput.value);
  const variant = normalizeVariant(captionFontVariantInput.value || 'regular');
  const isBusy = family && inFlightPreviewDownloads.has(`${family.toLowerCase()}::${variant}`);
  const canDownload = family && !isBusy && selectedFontHasGoogleEntry(family) && !selectedFontIsDownloaded(family, variant);
  downloadFontBtn.disabled = !canDownload;
}

async function loadFontSources(forceRefresh = false) {
  localFontFamilies = detectLocalFonts();

  try {
    const [index, downloaded] = await Promise.all([
      window.subburnin.getFontIndex(forceRefresh),
      window.subburnin.getDownloadedFonts()
    ]);

    googleFontFamilies = (index.fonts || []).map((entry) => entry.family).filter(Boolean);
    googleFontVariantsByFamily = new Map(
      (index.fonts || [])
        .filter((entry) => entry && entry.family)
        .map((entry) => [entry.family.toLowerCase(), (entry.variants || ['regular']).map(normalizeVariant)])
    );
    downloadedFontFamilies = Array.isArray(downloaded)
      ? downloaded.filter((entry) => entry && entry.family).map((entry) => ({
          family: entry.family,
          variant: normalizeVariant(entry.variant || 'regular')
        }))
      : [];

    const date = index.fetchedAt
      ? new Date(index.fetchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'unknown';
    updateFontStatus(`Default: Roboto. Google index: ${googleFontFamilies.length} fonts (updated ${date}).`);
  } catch (err) {
    googleFontFamilies = ['Roboto'];
    downloadedFontFamilies = [];
    updateFontStatus(`Could not load Google index: ${err.message}`, true);
  }

  renderFontSuggestions();
  populateVariantSelect();
  updateFontButtonsState();
  refreshFontPreview({ allowAutoDownload: false });
}

const STEPS = ['extracting', 'transcribing', 'converting', 'burning'];

let currentOutputPath = null;
let currentTheme = 'dark';
let googleFontFamilies = [];
let downloadedFontFamilies = [];
let localFontFamilies = [];
let fontSuggestions = [];
let activeFontSuggestionIndex = 0;
let previewDebounceTimer = null;
const failedPreviewDownloads = new Set();
const inFlightPreviewDownloads = new Set();
const loadedPreviewWebFonts = new Set();
let googleFontVariantsByFamily = new Map();

const LOCAL_FONT_CANDIDATES = [
  'Roboto', 'Arial', 'Helvetica', 'Helvetica Neue', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Times New Roman', 'Georgia', 'Garamond', 'Palatino',
  'Courier New', 'Monaco', 'Menlo', 'Consolas', 'Segoe UI', 'SF Pro Display'
];

function ensurePreviewWebFont(family) {
  const normalized = family.toLowerCase();
  if (!selectedFontHasGoogleEntry(family)) return;
  if (loadedPreviewWebFonts.has(normalized)) return;

  const familyQuery = encodeURIComponent(family).replace(/%20/g, '+');
  const href = `https://fonts.googleapis.com/css2?family=${familyQuery}:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400;1,700&display=swap`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  loadedPreviewWebFonts.add(normalized);
}

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
  captionFontFamilyInput.value     = config.caption_font_family     || 'Roboto';
  captionFontVariantInput.value    = normalizeVariant(config.caption_font_variant || 'regular');

  // Sync color pickers to current hex values
  COLOR_PAIRS.forEach(({ pickId, hexId }) => {
    const picker   = document.getElementById(pickId);
    const hexInput = document.getElementById(hexId);
    if (picker && hexInput && isValidHex(hexInput.value)) {
      picker.value = hexInput.value.slice(0, 7);
    }
  });

  updateModelStatus(config.model_downloaded, config.whisper_model_size, config.whisper_language);
  await loadFontSources();
  populateVariantSelect(captionFontVariantInput.value);
  renderFontSuggestions();

  settingsPanel.classList.add('open');
  overlay.classList.add('visible');
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  overlay.classList.remove('visible');
  closeFontMenu();
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
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
    caption_font_size:       parseInt(captionFontSizeInput.value, 10) || 64,
    caption_font_family:     normalizeFontName(captionFontFamilyInput.value) || 'Roboto',
    caption_font_variant:    normalizeVariant(captionFontVariantInput.value || 'regular')
  });
  closeSettings();
});

captionFontFamilyInput.addEventListener('focus', () => {
  openFontPopup();
});

captionFontFamilyInput.addEventListener('click', () => {
  openFontPopup();
});

captionFontFamilyInput.addEventListener('input', () => {
  fontPopupSearch.value = captionFontFamilyInput.value;
  populateVariantSelect();
  renderFontSuggestions();
  updateFontButtonsState();
  refreshFontPreview();
});

function handleFontPickerKeydown(event) {
  if (!fontPopup.classList.contains('open') || fontSuggestions.length === 0) {
    if (event.key === 'Enter') {
      event.preventDefault();
    }
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeFontSuggestionIndex = (activeFontSuggestionIndex + 1) % fontSuggestions.length;
    renderFontSuggestions();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeFontSuggestionIndex = (activeFontSuggestionIndex - 1 + fontSuggestions.length) % fontSuggestions.length;
    renderFontSuggestions();
    return;
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    applyFontSuggestionByIndex(activeFontSuggestionIndex);
    updateFontButtonsState();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeFontMenu();
  }
}

captionFontFamilyInput.addEventListener('keydown', handleFontPickerKeydown);
fontPopupSearch.addEventListener('keydown', handleFontPickerKeydown);

fontPopupSearch.addEventListener('input', () => {
  captionFontFamilyInput.value = normalizeFontName(fontPopupSearch.value);
  populateVariantSelect();
  renderFontSuggestions();
  updateFontButtonsState();
  refreshFontPreview();
});

fontPopupClose.addEventListener('click', closeFontMenu);
fontPopup.addEventListener('mousedown', (event) => {
  if (event.target === fontPopup) closeFontMenu();
});

fontFamilyMenu.addEventListener('mousedown', (event) => {
  const btn = event.target.closest('.font-family-option');
  if (!btn) return;
  event.preventDefault();
  const family = btn.getAttribute('data-family');
  captionFontFamilyInput.value = family || captionFontFamilyInput.value;
  fontPopupSearch.value = captionFontFamilyInput.value;
  populateVariantSelect();
  closeFontMenu();
  updateFontButtonsState();
  refreshFontPreview();
});

captionFontVariantInput.addEventListener('change', () => {
  renderFontSuggestions();
  updateFontButtonsState();
  refreshFontPreview();
});

refreshFontIndexBtn.addEventListener('click', async () => {
  refreshFontIndexBtn.disabled = true;
  updateFontStatus('Refreshing Google Fonts index...');
  try {
    await loadFontSources(true);
  } catch (err) {
    updateFontStatus(`Could not refresh index: ${err.message}`, true);
  } finally {
    refreshFontIndexBtn.disabled = false;
  }
});

downloadFontBtn.addEventListener('click', async () => {
  const family = normalizeFontName(captionFontFamilyInput.value);
  if (!family) return;
  await downloadFontFamily(family, { variant: captionFontVariantInput.value });
  refreshFontPreview({ allowAutoDownload: false });
});

// ========================================
// Init — load config and apply theme
// ========================================

(async () => {
  const config = await window.subburnin.getConfig();
  applyTheme(config.theme || 'dark');
})();
