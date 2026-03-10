const startBtn      = document.getElementById('start-btn');
const cancelBtn     = document.getElementById('cancel-btn');
const errorMsg      = document.getElementById('error-msg');
const progressWrap  = document.getElementById('progress-wrap');
const progressFill  = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const modelSizeEl   = document.getElementById('setup-model-size');
const languageEl    = document.getElementById('setup-language');
const installDiarizationBtn = document.getElementById('install-diarization-btn');
const cancelDiarizationBtn  = document.getElementById('cancel-diarization-btn');
const diarizationEnabledToggle = document.getElementById('diarization-enabled');

let diarizationInstallInFlight = false;

// Apply theme from config if available
(async () => {
  try {
    const config = await window.setup.getConfig();
    let theme = (config && config.theme) || 'system';
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch {}
})();

// ── Helpers ───────────────────────────────────────────────────

function setStep(step, status, detail) {
  const row  = document.getElementById(`row-${step}`);
  const icon = document.getElementById(`icon-${step}`);
  const det  = document.getElementById(`detail-${step}`);
  if (!row) return;
  row.className = `step-row ${status}${step === 'diarization' ? ' optional' : ''}`;
  const icons = { pending: '⏳', installing: '🔄', downloading: '🔄', done: '✓', error: '❌' };
  if (icon) icon.textContent = icons[status] || '⏳';
  if (det && detail) det.textContent = detail;
}

function showProgress(percent, label) {
  progressWrap.classList.add('visible');
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

async function refreshDiarizationStatus() {
  try {
    const config = await window.setup.getConfig();
    const status = await window.setup.checkDiarizationRuntime();
    if (status.installed) {
      const py = status.pythonVersion ? ` (Python ${status.pythonVersion})` : '';
      setStep('diarization', 'done', `Found${py} · runtime ready`);
      diarizationEnabledToggle.disabled = false;
      diarizationEnabledToggle.checked = Boolean(config.diarization_enabled);
      installDiarizationBtn.textContent = 'Re-check';
      installDiarizationBtn.disabled = false;
      cancelDiarizationBtn.style.display = 'none';
      return;
    }

    diarizationEnabledToggle.checked = Boolean(config.diarization_enabled);
    diarizationEnabledToggle.disabled = true;

    if (status.status === 'missing_python') {
      setStep('diarization', 'error', 'Python 3 not found. Install Python to enable diarization.');
      installDiarizationBtn.textContent = 'Retry Check';
    } else {
      const py = status.pythonFound && status.pythonVersion ? `Found Python ${status.pythonVersion}. ` : '';
      setStep('diarization', 'pending', `${py}Click Set up to configure runtime.`);
      installDiarizationBtn.textContent = 'Set up';
    }
    installDiarizationBtn.disabled = false;
    cancelDiarizationBtn.style.display = 'none';
  } catch (err) {
    setStep('diarization', 'error', `Status check failed: ${err.message}`);
    installDiarizationBtn.textContent = 'Retry Check';
    installDiarizationBtn.disabled = false;
    cancelDiarizationBtn.style.display = 'none';
  }
}

installDiarizationBtn.addEventListener('click', async () => {
  if (diarizationInstallInFlight) return;
  diarizationInstallInFlight = true;
  installDiarizationBtn.disabled = true;
  diarizationEnabledToggle.disabled = true;
  cancelDiarizationBtn.style.display = '';
  cancelDiarizationBtn.disabled = false;
  setStep('diarization', 'installing', 'Setting up multi-speaker runtime...');

  window.setup.removeDiarizationInstallProgressListener();
  try {
    const result = await window.setup.installDiarizationRuntime((data) => {
      const msg = data && (data.message || data.detail || data.stage);
      if (msg) setStep('diarization', 'installing', msg);
    });

    if (result && result.cancelled) {
      setStep('diarization', 'pending', 'Setup cancelled.');
    } else if (result && result.success) {
      const py = result.pythonVersion ? `Python ${result.pythonVersion}` : 'Python';
      setStep('diarization', 'done', `Found ${py} · runtime ready`);
    } else {
      setStep('diarization', 'error', result?.error || 'Setup failed.');
    }
  } catch (err) {
    setStep('diarization', 'error', err.message || String(err));
  } finally {
    diarizationInstallInFlight = false;
    window.setup.removeDiarizationInstallProgressListener();
    installDiarizationBtn.disabled = false;
    cancelDiarizationBtn.style.display = 'none';
    await refreshDiarizationStatus();
  }
});

cancelDiarizationBtn.addEventListener('click', async () => {
  cancelDiarizationBtn.disabled = true;
  try {
    await window.setup.cancelDiarizationInstall();
  } catch {}
});

diarizationEnabledToggle.addEventListener('change', async () => {
  const enabled = Boolean(diarizationEnabledToggle.checked);
  try {
    await window.setup.setConfig({ diarization_enabled: enabled });
  } catch (err) {
    diarizationEnabledToggle.checked = !enabled;
    setStep('diarization', 'error', `Could not save toggle: ${err.message || String(err)}`);
  }
});

// ── Gear + path-row logic ─────────────────────────────────────

['ffmpeg', 'whisper', 'model'].forEach((step) => {
  const gear    = document.getElementById(`gear-${step}`);
  const pathRow = document.getElementById(`path-row-${step}`);
  const input   = document.getElementById(`path-input-${step}`);
  const saveBtn = pathRow && pathRow.querySelector('.step-path-save');

  if (!gear || !pathRow || !input || !saveBtn) return;

  // Toggle path row open/closed
  gear.addEventListener('click', () => {
    const open = pathRow.style.display === 'flex';
    pathRow.style.display = open ? 'none' : 'flex';
    gear.classList.toggle('active', !open);
    if (!open) input.focus();
  });

  // Update button label as user types
  function refreshBtn() {
    saveBtn.textContent = input.value.trim() ? 'Use this path' : 'Browse';
  }
  input.addEventListener('input', () => {
    refreshBtn();
    input.style.borderColor = '';
  });
  refreshBtn(); // initial state

  // Drag a file onto the input — fill path, don't trigger video pipeline
  input.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  input.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    input.value = window.setup.getFilePath(file);
    refreshBtn();
    input.style.borderColor = '';
  });

  // Save / Browse
  saveBtn.addEventListener('click', async () => {
    if (!input.value.trim()) {
      // Browse mode — open file picker then auto-apply
      const chosen = await window.setup.browseForPath(step);
      if (!chosen) return;
      input.value = chosen;
      refreshBtn();
    }
    // Apply (always runs after browse fills the value, or when user clicked "Use this path")
    await applyPath(step, input, saveBtn, gear, pathRow);
  });
});

async function applyPath(step, input, saveBtn, gear, pathRow) {
  const val = input.value.trim();
  if (!val) return;

  const result = await window.setup.setCustomPath(step, val);
  if (result.ok) {
    setStep(step, 'done', result.detail || 'Path set');
    pathRow.style.display = 'none';
    gear.classList.remove('active');
  } else {
    input.style.borderColor = 'var(--error)';
    setTimeout(() => { input.style.borderColor = ''; }, 1500);
  }
}

// ── Install ───────────────────────────────────────────────────

cancelBtn.addEventListener('click', async () => {
  cancelBtn.disabled = true;
  progressLabel.textContent = 'Cancelling...';
  await window.setup.cancel();
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  cancelBtn.style.display = '';
  cancelBtn.disabled = false;
  errorMsg.classList.remove('visible');

  const size     = modelSizeEl.value;
  const language = languageEl.value;

  try { await window.setup.saveModelConfig(size, language); } catch {}

  modelSizeEl.disabled = true;
  languageEl.disabled  = true;

  const status = await window.setup.check();

  setStep('whisper', status.whisperCli ? 'done' : 'pending',
    status.whisperCli ? 'Already installed' : 'Waiting...');
  setStep('model', status.model ? 'done' : 'pending',
    status.model ? 'Already present' : 'Waiting...');

  try {
    const result = await window.setup.install((data) => {
      const { step, status: s, message, detail, percent, downloaded, total, resumed } = data;
      if (step === 'whisper') {
        setStep('whisper', s, message || detail);
      } else if (step === 'model') {
        setStep('model', s, message);
        if (s === 'downloading' && percent !== undefined) {
          showProgress(percent,
            `${downloaded} / ${total} GB  (${percent}%)${resumed ? ' (resuming)' : ''}`);
        }
        if (s === 'done') showProgress(100, 'Download complete');
      }
    });

    cancelBtn.style.display = 'none';

    if (result && result.cancelled) {
      progressLabel.textContent = 'Paused — click Install & Download to resume.';
      modelSizeEl.disabled = false;
      languageEl.disabled  = false;
      startBtn.disabled = false;
      startBtn.textContent = 'Resume';
      return;
    }

    startBtn.textContent = 'Launching…';
  } catch (err) {
    cancelBtn.style.display = 'none';
    modelSizeEl.disabled = false;
    languageEl.disabled  = false;
    errorMsg.textContent = err.message || String(err);
    errorMsg.classList.add('visible');
    startBtn.disabled = false;
    startBtn.textContent = 'Retry';
  }
});

refreshDiarizationStatus();
