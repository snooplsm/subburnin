const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, getConfig, setConfig } = require('./config');

const DIARIZATION_DIR = path.join(CONFIG_DIR, 'diarization');
const RUNTIME_MARKER = path.join(DIARIZATION_DIR, 'runtime.json');

function ensureDiarizationDir() {
  fs.mkdirSync(DIARIZATION_DIR, { recursive: true });
}

function probePython3() {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['--version'], { shell: false });
    let out = '';
    let err = '';

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', () => resolve({ ok: false, version: null }));
    proc.on('close', (code) => {
      if (code !== 0) return resolve({ ok: false, version: null });
      const text = (out || err).trim();
      const m = text.match(/Python\s+([\d.]+)/i);
      resolve({ ok: true, version: m ? m[1] : text || 'unknown' });
    });
  });
}

async function checkDiarizationRuntime() {
  const cfg = getConfig();
  const py = await probePython3();

  const markerExists = fs.existsSync(RUNTIME_MARKER);
  const installed = Boolean(py.ok && markerExists);
  const runtimePath = installed ? DIARIZATION_DIR : '';

  const status = installed ? 'ready' : (py.ok ? 'not_installed' : 'missing_python');
  const details = {
    status,
    installed,
    pythonFound: py.ok,
    pythonVersion: py.version,
    runtimePath: runtimePath || cfg.diarization_runtime_path || '',
    markerPath: RUNTIME_MARKER
  };

  return details;
}

async function installDiarizationRuntime(onProgress = () => {}, signal = null) {
  ensureDiarizationDir();
  onProgress({ stage: 'check', message: 'Checking Python runtime...' });

  const py = await probePython3();
  if (!py.ok) {
    const err = new Error('python3 not found. Install Python 3 to enable diarization.');
    err.code = 'MISSING_PYTHON';
    throw err;
  }

  if (signal && signal.aborted) {
    const err = new Error('Diarization install cancelled.');
    err.cancelled = true;
    throw err;
  }

  onProgress({ stage: 'prepare', message: 'Preparing diarization runtime directory...' });
  const marker = {
    installedAt: new Date().toISOString(),
    pythonVersion: py.version,
    version: 1
  };
  fs.writeFileSync(RUNTIME_MARKER, JSON.stringify(marker, null, 2), 'utf8');

  const runtimePath = DIARIZATION_DIR;
  setConfig({
    diarization_runtime_ready: true,
    diarization_runtime_path: runtimePath,
    diarization_model_info: marker
  });

  onProgress({ stage: 'done', message: 'Diarization runtime ready.' });
  return {
    success: true,
    runtimePath,
    pythonVersion: py.version
  };
}

module.exports = {
  DIARIZATION_DIR,
  RUNTIME_MARKER,
  checkDiarizationRuntime,
  installDiarizationRuntime
};
