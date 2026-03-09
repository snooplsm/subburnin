const dropZone        = document.getElementById('drop-zone');
const progressSection = document.getElementById('progress-section');
const progressFill    = document.getElementById('progress-bar-fill');
const statusMsg       = document.getElementById('status-msg');
const outputSection   = document.getElementById('output-section');
const outputPath      = document.getElementById('output-path');
const processCancelBtn = document.getElementById('process-cancel-btn');
const mainContainer   = document.querySelector('main');
const previewSection  = document.getElementById('preview-section');
const previewStatus   = document.getElementById('preview-status');
const previewVideoWrap = document.getElementById('preview-video-wrap');
const previewVideo    = document.getElementById('preview-video');
const previewCaptions = document.getElementById('preview-captions');
const previewPlayBtn  = document.getElementById('preview-play-btn');
const previewTimeline = document.getElementById('preview-timeline');
const previewTime     = document.getElementById('preview-time');
const settingsBtn     = document.getElementById('settings-btn');
const settingsPanel   = document.getElementById('settings-panel');
const overlay         = document.getElementById('overlay');
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
    queueCaptionStyleAutosave();
    refreshPreviewStyle();
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
  refreshPreviewStyle();
  queueCaptionStyleAutosave();
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
  // Manual font buttons were removed; debounce-driven auto-download handles this.
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
          variant: normalizeVariant(entry.variant || 'regular'),
          file: entry.file || '',
          path: entry.path || ''
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

async function ensureFontRuntimeState(forceRefresh = false) {
  if (fontRuntimeReady && !forceRefresh) return;
  if (fontRuntimePromise && !forceRefresh) {
    await fontRuntimePromise;
    return;
  }

  fontRuntimePromise = (async () => {
    await loadFontSources(forceRefresh);
    fontRuntimeReady = true;
  })();

  try {
    await fontRuntimePromise;
  } finally {
    fontRuntimePromise = null;
  }
}

const STEPS = ['extracting', 'transcribing', 'converting', 'burning'];

let currentOutputPath = null;
let currentTheme = 'dark';
let isProcessingActive = false;
let currentSourceVideoPath = null;
let currentPreviewVideoPath = null;
let previewSegments = [];
let previewAssEvents = [];
let previewTickTimer = null;
let isPreviewSeeking = false;
let wasPlayingBeforeSeek = false;
let previewControlsHideTimer = null;
let previewProxyInFlight = false;
const previewProxyAttempted = new Set();
const localPreviewFontFaceKeys = new Set();
let localPreviewFontStyleEl = null;
let captionStyleAutosaveTimer = null;
let generalSettingsAutosaveTimer = null;
let fontRuntimeReady = false;
let fontRuntimePromise = null;
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

function toFileUrl(filePath) {
  if (!filePath) return '';
  const normalized = String(filePath).replace(/\\/g, '/');
  const withPrefix = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  return encodeURI(withPrefix);
}

function formatPreviewTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}

function getPreviewRenderMetrics() {
  const wrap = document.getElementById('preview-video-wrap');
  const wrapW = wrap ? wrap.clientWidth : (previewVideo.clientWidth || 0);
  const wrapH = wrap ? wrap.clientHeight : (previewVideo.clientHeight || 0);
  const vw = previewVideo.videoWidth || 0;
  const vh = previewVideo.videoHeight || 0;

  if (!wrapW || !wrapH || !vw || !vh) {
    return { renderW: wrapW || 0, renderH: wrapH || 0, offsetX: 0, offsetY: 0 };
  }

  const scale = Math.min(wrapW / vw, wrapH / vh);
  const renderW = vw * scale;
  const renderH = vh * scale;
  const offsetX = (wrapW - renderW) / 2;
  const offsetY = (wrapH - renderH) / 2;
  return { renderW, renderH, offsetX, offsetY };
}

function applyPreviewCaptionLayout() {
  if (!previewCaptions) return;
  const { renderW, renderH, offsetX, offsetY } = getPreviewRenderMetrics();
  if (!renderW || !renderH) return;

  const sidePad = Math.round(renderW * 0.05);
  const bottomPad = Math.round(renderH * 0.05);
  previewCaptions.style.left = `${Math.round(offsetX + sidePad)}px`;
  previewCaptions.style.right = `${Math.round(offsetX + sidePad)}px`;
  previewCaptions.style.bottom = `${Math.round(offsetY + bottomPad)}px`;
}

function sanitizeCssFontToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getPreviewFontAlias(family, variant) {
  return `SBPreview_${sanitizeCssFontToken(family)}_${sanitizeCssFontToken(variant || 'regular')}`;
}

function ensureLocalPreviewFontFace(family, variant) {
  const fam = normalizeFontName(family).toLowerCase();
  const varId = normalizeVariant(variant || 'regular');
  const entry = downloadedFontFamilies.find((it) =>
    normalizeFontName(it.family).toLowerCase() === fam && normalizeVariant(it.variant) === varId && it.path
  );
  if (!entry) return null;

  const key = `${fam}::${varId}`;
  const alias = getPreviewFontAlias(entry.family, entry.variant);
  if (!localPreviewFontFaceKeys.has(key)) {
    if (!localPreviewFontStyleEl) {
      localPreviewFontStyleEl = document.createElement('style');
      localPreviewFontStyleEl.id = 'preview-local-font-faces';
      document.head.appendChild(localPreviewFontStyleEl);
    }
    const fontUrl = toFileUrl(entry.path);
    localPreviewFontStyleEl.textContent += `
@font-face {
  font-family: '${alias}';
  src: url('${fontUrl}') format('truetype');
  font-display: swap;
}
`;
    localPreviewFontFaceKeys.add(key);
  }
  return alias;
}

function assTimeToMs(ts) {
  // ASS format: H:MM:SS.cc
  const m = String(ts || '').trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const cs = parseInt(m[4], 10);
  return (((h * 60 + mm) * 60 + s) * 1000) + cs * 10;
}

function parseAssDialogueLine(line) {
  const m = line.match(/^Dialogue:\s*\d+,([^,]+),([^,]+),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/);
  if (!m) return null;
  return {
    start: assTimeToMs(m[1]),
    end: assTimeToMs(m[2]),
    text: m[3] || ''
  };
}

function parseAssPreviewChunks(text) {
  const chunks = [];
  const highlightRe = /\{\\1c[^}]*\\bord[^}]*\\3c[^}]*\\shad0\}([\s\S]*?)\{\\r\}/g;
  let last = 0;
  let m;
  while ((m = highlightRe.exec(text)) !== null) {
    if (m.index > last) {
      const plain = text.slice(last, m.index).replace(/\{[^}]*\}/g, '');
      if (plain) chunks.push({ text: plain, active: false });
    }
    chunks.push({ text: m[1] || '', active: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const tail = text.slice(last).replace(/\{[^}]*\}/g, '');
    if (tail) chunks.push({ text: tail, active: false });
  }
  if (chunks.length === 0) {
    const plain = text.replace(/\{[^}]*\}/g, '');
    if (plain) chunks.push({ text: plain, active: false });
  }
  return chunks;
}

function parseAssPreviewEvents(assContent) {
  const lines = String(assContent || '').split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue;
    const dlg = parseAssDialogueLine(line);
    if (!dlg || dlg.end <= dlg.start) continue;
    events.push({
      start: dlg.start,
      end: dlg.end,
      chunks: parseAssPreviewChunks(dlg.text)
    });
  }
  return events;
}

function extFromPath(filePath) {
  const m = String(filePath || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? `.${m[1]}` : '';
}

function mimeFromExt(ext) {
  const map = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo'
  };
  return map[ext] || 'video/mp4';
}

function likelyNeedsPreviewProxy(videoPath) {
  const ext = extFromPath(videoPath);
  if (ext === '.mkv' || ext === '.avi') return true;
  const mime = mimeFromExt(ext);
  const support = previewVideo.canPlayType(mime);
  return !support;
}

function getPreviewStyle() {
  const variant = parseVariant(captionFontVariantInput.value || 'regular');
  const fontFamily = normalizeFontName(captionFontFamilyInput.value) || 'Roboto';
  ensurePreviewWebFont(fontFamily);
  const localAlias = ensureLocalPreviewFontFace(fontFamily, captionFontVariantInput.value || 'regular');
  const renderFamily = localAlias || fontFamily;
  return {
    fontFamily: renderFamily,
    fontSize: parseInt(captionFontSizeInput.value, 10) || 64,
    textColor: captionTextColorInput.value || '#FFFFFF',
    highlightColor: captionHighlightColorInput.value || '#CFA84E',
    highlightBg: captionHighlightBgInput.value || '#000000',
    outlineColor: captionOutlineColorInput.value || '#000000',
    weight: variant.weight || 400,
    italic: variant.italic
  };
}

function getCurrentCaptionStylePartial() {
  return {
    caption_text_color: captionTextColorInput.value || '#FFFFFF',
    caption_highlight_color: captionHighlightColorInput.value || '#CFA84E',
    caption_highlight_bg: captionHighlightBgInput.value || '#000000',
    caption_outline_color: captionOutlineColorInput.value || '#000000',
    caption_font_size: parseInt(captionFontSizeInput.value, 10) || 64,
    caption_font_family: normalizeFontName(captionFontFamilyInput.value) || 'Roboto',
    caption_font_variant: normalizeVariant(captionFontVariantInput.value || 'regular')
  };
}

function queueCaptionStyleAutosave() {
  if (captionStyleAutosaveTimer) clearTimeout(captionStyleAutosaveTimer);
  captionStyleAutosaveTimer = setTimeout(() => {
    captionStyleAutosaveTimer = null;
    window.subburnin.setConfig(getCurrentCaptionStylePartial()).catch(() => {});
  }, 250);
}

function syncColorPickersFromHexInputs() {
  COLOR_PAIRS.forEach(({ pickId, hexId }) => {
    const picker = document.getElementById(pickId);
    const hexInput = document.getElementById(hexId);
    if (picker && hexInput && isValidHex(hexInput.value)) {
      picker.value = hexInput.value.slice(0, 7);
    }
  });
}

function queueGeneralSettingsAutosave() {
  if (generalSettingsAutosaveTimer) clearTimeout(generalSettingsAutosaveTimer);
  generalSettingsAutosaveTimer = setTimeout(() => {
    generalSettingsAutosaveTimer = null;
    window.subburnin.setConfig({
      whisper_threads: parseInt(threadsInput.value, 10) || 4,
      output_dir: outputDirInput.value.trim()
    }).catch(() => {});
  }, 300);
}

function applyCaptionStyleFromConfig(config) {
  if (!config) return;
  captionTextColorInput.value = config.caption_text_color || '#FFFFFF';
  captionHighlightColorInput.value = config.caption_highlight_color || '#CFA84E';
  captionHighlightBgInput.value = config.caption_highlight_bg || '#000000';
  captionOutlineColorInput.value = config.caption_outline_color || '#000000';
  captionFontSizeInput.value = config.caption_font_size || 64;
  captionFontFamilyInput.value = config.caption_font_family || 'Roboto';
  captionFontVariantInput.value = normalizeVariant(config.caption_font_variant || 'regular');
  fontPopupSearch.value = captionFontFamilyInput.value;
  syncColorPickersFromHexInputs();
}

function refreshPreviewStyle() {
  if (!previewSection.classList.contains('visible')) return;
  const ms = (previewVideo.currentTime || 0) * 1000;
  renderPreviewAt(ms);
}

function mergePreviewTokens(tokens) {
  const words = [];
  for (const token of (tokens || [])) {
    if (!token || !token.text) continue;
    if (token.text.startsWith('[_') || token.text.trim() === '') continue;

    const trimmed = token.text.trim();
    const hasSpace = token.text.startsWith(' ');
    const isPuncOrSymbol = /^[^a-zA-ZÀ-ÿ0-9]/.test(trimmed);
    const isAttached = words.length > 0 && !hasSpace && isPuncOrSymbol;

    if (isAttached) {
      words[words.length - 1].text += trimmed;
      words[words.length - 1].end = Number(token.offsets?.to) || words[words.length - 1].end;
    } else {
      const display = words.length > 0 && !hasSpace ? ` ${trimmed}` : token.text;
      const start = Number(token.offsets?.from) || 0;
      const end = Number(token.offsets?.to) || start + 1;
      words.push({ text: display, start, end });
    }
  }
  return words;
}

function buildPreviewSegments(rawSegments) {
  const out = [];
  for (const segment of (rawSegments || [])) {
    if (!segment || !segment.offsets) continue;
    const segStart = Math.max(0, Number(segment.offsets.from) || 0);
    const segEnd = Math.max(segStart + 1, Number(segment.offsets.to) || segStart + 1);
    const words = mergePreviewTokens(segment.tokens);
    if (words.length === 0) continue;

    for (let i = 0; i < words.length; i++) {
      const nextStart = i + 1 < words.length ? words[i + 1].start : segEnd;
      words[i].start = Math.max(segStart, words[i].start);
      words[i].end = Math.max(words[i].start + 1, Math.min(segEnd, nextStart));
    }

    out.push({
      start: segStart,
      end: segEnd,
      words,
      text: words.map((w) => w.text).join('')
    });
  }
  return out;
}

function findActivePreviewSegment(timeMs) {
  if (previewSegments.length === 0) return null;
  const idx = previewSegments.findIndex((segment) => timeMs >= segment.start && timeMs < segment.end);
  if (idx >= 0) return previewSegments[idx];
  for (let i = previewSegments.length - 1; i >= 0; i--) {
    if (timeMs >= previewSegments[i].start) return previewSegments[i];
  }
  return previewSegments[0];
}

function findActiveAssEvent(timeMs) {
  if (previewAssEvents.length === 0) return null;
  const idx = previewAssEvents.findIndex((event) => timeMs >= event.start && timeMs < event.end);
  if (idx >= 0) return previewAssEvents[idx];
  return null;
}

function renderPreviewAt(timeMs) {
  if (!previewCaptions) return;
  applyPreviewCaptionLayout();
  const assEvent = findActiveAssEvent(timeMs);
  const segment = assEvent ? null : findActivePreviewSegment(timeMs);
  if (!assEvent && !segment) {
    previewCaptions.innerHTML = '';
    return;
  }

  const style = getPreviewStyle();
  const { renderH } = getPreviewRenderMetrics();
  const previewHeight = renderH || previewVideo.clientHeight || 540;
  // Neutral mapping from ASS PlayResY (1080) into current preview viewport.
  const assScalePx = (style.fontSize * previewHeight) / 1080;
  const previewFontPx = Math.max(12, Math.round(assScalePx));
  const line = document.createElement('div');
  line.className = 'preview-caption-line';
  line.style.fontFamily = `"${style.fontFamily}", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  line.style.fontSize = `${previewFontPx}px`;
  line.style.color = style.textColor;
  line.style.fontWeight = String(style.weight);
  line.style.fontStyle = style.italic ? 'italic' : 'normal';
  line.style.textShadow = `0 0 1px ${style.outlineColor}, 0 0 2px ${style.outlineColor}, 0 1px 2px rgba(0,0,0,.65)`;

  if (assEvent) {
    assEvent.chunks.forEach((chunk) => {
      const span = document.createElement('span');
      span.className = `preview-word${chunk.active ? ' active' : ''}`;
      span.textContent = chunk.text;
      if (chunk.active) {
        span.style.color = style.highlightColor;
        span.style.background = style.highlightBg;
      }
      line.appendChild(span);
    });
  } else {
    const activeWordIdx = segment.words.findIndex((word) => timeMs >= word.start && timeMs < word.end);
    segment.words.forEach((word, idx) => {
      const span = document.createElement('span');
      span.className = `preview-word${idx === activeWordIdx ? ' active' : ''}`;
      span.textContent = word.text;
      if (idx === activeWordIdx) {
        span.style.color = style.highlightColor;
        span.style.background = style.highlightBg;
      }
      line.appendChild(span);
    });
  }

  previewCaptions.innerHTML = '';
  previewCaptions.appendChild(line);
}

function updatePreviewTimeUi() {
  if (!previewVideo) return;
  const current = previewVideo.currentTime || 0;
  const duration = Number.isFinite(previewVideo.duration) ? previewVideo.duration : 0;

  if (!isPreviewSeeking && previewTimeline) {
    previewTimeline.value = String(Math.round(current * 1000));
  }
  if (previewTime) {
    previewTime.textContent = `${formatPreviewTime(current)} / ${formatPreviewTime(duration)}`;
  }
  renderPreviewAt(current * 1000);
}

function stopPreviewTick() {
  if (!previewTickTimer) return;
  cancelAnimationFrame(previewTickTimer);
  previewTickTimer = null;
}

function showPreviewControlsTemporarily() {
  if (!previewVideoWrap) return;
  previewVideoWrap.classList.add('controls-visible');
  if (previewControlsHideTimer) clearTimeout(previewControlsHideTimer);
  previewControlsHideTimer = setTimeout(() => {
    previewVideoWrap.classList.remove('controls-visible');
    previewControlsHideTimer = null;
  }, 1200);
}

function clearPreviewControlsTimer() {
  if (previewControlsHideTimer) {
    clearTimeout(previewControlsHideTimer);
    previewControlsHideTimer = null;
  }
}

function startPreviewTick() {
  stopPreviewTick();
  const loop = () => {
    updatePreviewTimeUi();
    if (!previewVideo.paused && !previewVideo.ended) {
      previewTickTimer = requestAnimationFrame(loop);
    } else {
      previewTickTimer = null;
    }
  };
  previewTickTimer = requestAnimationFrame(loop);
}

async function ensurePreviewProxy(videoPath) {
  if (!videoPath || previewProxyInFlight) return null;
  const key = String(videoPath);
  if (previewProxyAttempted.has(key)) return null;
  previewProxyAttempted.add(key);
  previewProxyInFlight = true;

  showPreviewStatus('Creating preview-compatible video (veryfast, low bitrate)…');
  try {
    const result = await window.subburnin.createPreviewProxy(videoPath);
    if (result && result.success && result.proxyPath) return result.proxyPath;
    showPreviewStatus(`Preview proxy failed: ${result?.error || 'unknown error'}`);
    return null;
  } catch (err) {
    showPreviewStatus(`Preview proxy failed: ${err.message}`);
    return null;
  } finally {
    previewProxyInFlight = false;
  }
}

async function applyPreviewVideoSource(videoPath) {
  if (!previewVideo || !videoPath) return;
  currentPreviewVideoPath = videoPath;
  let sourcePath = videoPath;
  if (likelyNeedsPreviewProxy(videoPath)) {
    const proxyPath = await ensurePreviewProxy(videoPath);
    if (proxyPath) sourcePath = proxyPath;
  }
  if (sourcePath !== videoPath) {
    showPreviewStatus('Using preview proxy (veryfast, low bitrate) for playback');
  }

  const src = toFileUrl(sourcePath);
  if (previewVideo.src !== src || previewVideo.dataset.sourcePath !== sourcePath) {
    previewVideo.dataset.sourcePath = sourcePath;
    previewVideo.dataset.originalPath = videoPath;
    previewVideo.src = src;
    previewVideo.load();
  }
}

function showPreviewStatus(text) {
  if (previewStatus) previewStatus.textContent = text;
}

function setupPreviewFromTranscription(videoPath, segments) {
  currentSourceVideoPath = videoPath || currentSourceVideoPath;
  if (currentSourceVideoPath) applyPreviewVideoSource(currentSourceVideoPath);

  previewSegments = buildPreviewSegments(segments);
  previewSection.classList.add('visible');
  if (previewSegments.length > 0) {
    showPreviewStatus(`Ready · ${previewSegments.length} caption segments`);
  } else {
    showPreviewStatus('Ready · no caption segments found');
  }
  updatePreviewTimeUi();
}

function setupPreviewFromAss(videoPath, assContent) {
  currentSourceVideoPath = videoPath || currentSourceVideoPath;
  if (currentSourceVideoPath) applyPreviewVideoSource(currentSourceVideoPath);
  previewAssEvents = parseAssPreviewEvents(assContent);
  if (previewAssEvents.length > 0) {
    showPreviewStatus(`ASS preview ready · ${previewAssEvents.length} events`);
  } else {
    showPreviewStatus('ASS preview ready');
  }
  updatePreviewTimeUi();
}

function enterWorkMode() {
  if (!mainContainer) return;
  mainContainer.classList.add('work-mode');
  mainContainer.scrollTo({ top: 0, behavior: 'smooth' });
}

function leaveWorkMode() {
  if (!mainContainer) return;
  mainContainer.classList.remove('work-mode');
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

async function startProcessing(filePath) {
  if (isProcessingActive) {
    await window.subburnin.cancelProcessing().catch(() => {});
    resetForNextRun();
  }
  try {
    const config = await window.subburnin.getConfig();
    applyCaptionStyleFromConfig(config);
    await ensureFontRuntimeState();
  } catch {}
  isProcessingActive = true;
  setProcessingCancelVisible(false);
  enterWorkMode();
  currentSourceVideoPath = filePath;
  applyPreviewVideoSource(filePath);
  previewSegments = [];
  previewAssEvents = [];
  previewCaptions.innerHTML = '';
  dropZone.style.display = 'none';
  previewSection.classList.add('visible');
  showPreviewStatus('Transcribing… preview will appear once captions are ready.');

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
    isProcessingActive = false;
    setProcessingCancelVisible(false);
    if (result.success) {
      currentOutputPath = result.outputPath;
      showSuccess(result.outputPath);
    } else if (result.cancelled) {
      showError('Processing cancelled.');
      setTimeout(() => resetForNextRun(), 120);
    } else {
      showError(result.error);
    }
  }).catch((err) => {
    isProcessingActive = false;
    setProcessingCancelVisible(false);
    showError(err.message || String(err));
  });
}

function updateProgress(data) {
  const { stage, percent, message } = data;
  const cancelStages = new Set(['transcribing', 'converting', 'burning']);
  setProcessingCancelVisible(isProcessingActive && cancelStages.has(stage));

  if (data.preview && Array.isArray(data.preview.segments)) {
    setupPreviewFromTranscription(data.preview.videoPath || currentSourceVideoPath, data.preview.segments);
  }
  if (data.previewAss && data.previewAss.assContent) {
    setupPreviewFromAss(data.previewAss.videoPath || currentSourceVideoPath, data.previewAss.assContent);
  }

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
  dropZone.classList.remove('processing');
  isProcessingActive = false;
  setProcessingCancelVisible(false);
  showPreviewStatus('Ready · showing transcription preview');
}

function showError(msg) {
  statusMsg.textContent = `Error: ${msg}`;
  statusMsg.className = 'error';
  dropZone.classList.remove('processing');
  isProcessingActive = false;
  setProcessingCancelVisible(false);
  showPreviewStatus('Preview unavailable due to processing error');
}

function setProcessingCancelVisible(visible) {
  if (!processCancelBtn) return;
  processCancelBtn.classList.toggle('visible', Boolean(visible));
  processCancelBtn.disabled = false;
}

function resetForNextRun() {
  dropZone.style.display = '';
  dropZone.classList.remove('processing');
  progressSection.classList.remove('visible');
  outputSection.classList.remove('visible');
  previewSection.classList.remove('visible');
  statusMsg.textContent = '';
  statusMsg.className = '';
  resetSteps();
  currentOutputPath = null;
  currentSourceVideoPath = null;
  currentPreviewVideoPath = null;
  previewSegments = [];
  previewAssEvents = [];
  isProcessingActive = false;
  setProcessingCancelVisible(false);
  stopPreviewTick();
  previewVideo.pause();
  previewVideo.removeAttribute('src');
  previewVideo.dataset.sourcePath = '';
  previewVideo.dataset.originalPath = '';
  previewVideo.load();
  previewCaptions.innerHTML = '';
  previewProxyAttempted.clear();
  previewProxyInFlight = false;
  previewVideoWrap.classList.remove('controls-visible');
  clearPreviewControlsTimer();
  showPreviewStatus('Waiting for transcription…');
  window.subburnin.removeProgressListener();
  leaveWorkMode();
}

// ========================================
// Output actions
// ========================================

outputPath.addEventListener('click', () => {
  if (currentOutputPath) {
    window.subburnin.revealFileInFolder(currentOutputPath);
  }
});

processCancelBtn.addEventListener('click', async () => {
  if (!isProcessingActive) return;
  processCancelBtn.disabled = true;
  statusMsg.textContent = 'Cancelling processing...';
  statusMsg.className = '';
  try {
    await window.subburnin.cancelProcessing();
  } catch {}
});

previewPlayBtn.addEventListener('click', async () => {
  if (!previewVideo.src) return;
  if (previewVideo.paused) {
    try {
      await previewVideo.play();
      previewPlayBtn.textContent = '❚❚';
      startPreviewTick();
    } catch {
      showPreviewStatus('Could not start preview playback');
    }
  } else {
    previewVideo.pause();
    previewPlayBtn.textContent = '▶';
    stopPreviewTick();
  }
});

previewTimeline.addEventListener('input', () => {
  if (!previewVideo.src) return;
  const target = Number(previewTimeline.value || 0) / 1000;
  if (typeof previewVideo.fastSeek === 'function') {
    previewVideo.fastSeek(target);
  } else {
    previewVideo.currentTime = target;
  }
  if (previewTime) {
    const duration = Number.isFinite(previewVideo.duration) ? previewVideo.duration : 0;
    previewTime.textContent = `${formatPreviewTime(target)} / ${formatPreviewTime(duration)}`;
  }
  renderPreviewAt(target * 1000);
  updatePreviewTimeUi();
});

previewTimeline.addEventListener('change', () => {
  if (!previewVideo.src) return;
  const target = Number(previewTimeline.value || 0) / 1000;
  previewVideo.currentTime = target;
  isPreviewSeeking = false;
  if (wasPlayingBeforeSeek) {
    previewVideo.play().catch(() => {});
  }
  wasPlayingBeforeSeek = false;
  updatePreviewTimeUi();
});

previewTimeline.addEventListener('pointerdown', () => {
  if (!previewVideo.src) return;
  wasPlayingBeforeSeek = !previewVideo.paused && !previewVideo.ended;
  isPreviewSeeking = true;
  previewVideo.pause();
});

previewTimeline.addEventListener('pointerup', () => {
  if (!previewVideo.src) return;
  isPreviewSeeking = false;
  if (wasPlayingBeforeSeek) {
    previewVideo.play().catch(() => {});
  }
  wasPlayingBeforeSeek = false;
});

previewVideo.addEventListener('loadedmetadata', () => {
  const duration = Number.isFinite(previewVideo.duration) ? previewVideo.duration : 0;
  previewTimeline.max = String(Math.max(1, Math.round(duration * 1000)));
  previewTimeline.value = '0';
  previewPlayBtn.textContent = '▶';
  previewVideoWrap.classList.remove('is-playing');
  previewVideoWrap.classList.add('controls-visible');
  clearPreviewControlsTimer();
  applyPreviewCaptionLayout();
  updatePreviewTimeUi();
});

previewVideo.addEventListener('play', () => {
  previewPlayBtn.textContent = '❚❚';
  previewVideoWrap.classList.add('is-playing');
  showPreviewControlsTemporarily();
  startPreviewTick();
});

previewVideo.addEventListener('pause', () => {
  previewPlayBtn.textContent = '▶';
  previewVideoWrap.classList.remove('is-playing');
  previewVideoWrap.classList.add('controls-visible');
  clearPreviewControlsTimer();
  stopPreviewTick();
  updatePreviewTimeUi();
});

previewVideo.addEventListener('ended', () => {
  previewPlayBtn.textContent = '▶';
  previewVideoWrap.classList.remove('is-playing');
  previewVideoWrap.classList.add('controls-visible');
  clearPreviewControlsTimer();
  stopPreviewTick();
  updatePreviewTimeUi();
});

previewVideoWrap.addEventListener('mousemove', () => {
  if (previewVideo.paused || previewVideo.ended) return;
  showPreviewControlsTemporarily();
});

previewVideo.addEventListener('timeupdate', updatePreviewTimeUi);

window.addEventListener('resize', () => {
  applyPreviewCaptionLayout();
  updatePreviewTimeUi();
});

previewVideo.addEventListener('error', async () => {
  const original = previewVideo.dataset.originalPath || currentPreviewVideoPath || currentSourceVideoPath;
  if (!original) return;
  const proxyPath = await ensurePreviewProxy(original);
  if (proxyPath) {
    const currentTime = previewVideo.currentTime || 0;
    previewVideo.dataset.sourcePath = proxyPath;
    previewVideo.src = toFileUrl(proxyPath);
    previewVideo.load();
    previewVideo.currentTime = currentTime;
    showPreviewStatus('Using preview proxy (veryfast, low bitrate) for playback');
  }
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
  fontPopupSearch.value = captionFontFamilyInput.value;
  syncColorPickersFromHexInputs();

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
threadsInput.addEventListener('input', queueGeneralSettingsAutosave);
threadsInput.addEventListener('change', queueGeneralSettingsAutosave);
outputDirInput.addEventListener('input', queueGeneralSettingsAutosave);
outputDirInput.addEventListener('change', queueGeneralSettingsAutosave);

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
  queueCaptionStyleAutosave();
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
  queueCaptionStyleAutosave();
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
  refreshPreviewStyle();
  queueCaptionStyleAutosave();
});

captionFontVariantInput.addEventListener('change', () => {
  renderFontSuggestions();
  updateFontButtonsState();
  refreshFontPreview();
  refreshPreviewStyle();
  queueCaptionStyleAutosave();
});

[
  captionTextColorInput,
  captionHighlightColorInput,
  captionHighlightBgInput,
  captionOutlineColorInput,
  captionFontSizeInput,
  captionFontFamilyInput
].forEach((input) => {
  input.addEventListener('input', refreshPreviewStyle);
  input.addEventListener('change', refreshPreviewStyle);
  input.addEventListener('input', queueCaptionStyleAutosave);
  input.addEventListener('change', queueCaptionStyleAutosave);
});

// ========================================
// Init — load config and apply theme
// ========================================

(async () => {
  const config = await window.subburnin.getConfig();
  applyCaptionStyleFromConfig(config);
  applyTheme(config.theme || 'dark');
  ensureFontRuntimeState().then(() => {
    populateVariantSelect(captionFontVariantInput.value);
    renderFontSuggestions();
    refreshFontPreview({ allowAutoDownload: false });
    refreshPreviewStyle();
  }).catch(() => {});
  // Periodic background refresh so users don't need a manual refresh button.
  setInterval(() => {
    ensureFontRuntimeState(true).catch(() => {});
  }, 6 * 60 * 60 * 1000);
})();
