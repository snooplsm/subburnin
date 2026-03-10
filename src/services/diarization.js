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
  onProgress({ stage: 'check', message: 'Checking for local multi-speaker runtime...' });

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

  const markerAlreadyExists = fs.existsSync(RUNTIME_MARKER);
  onProgress({ stage: 'prepare', message: 'Found Python. Configuring runtime metadata...' });
  let existingInstalledAt = null;
  if (markerAlreadyExists) {
    try {
      existingInstalledAt = JSON.parse(fs.readFileSync(RUNTIME_MARKER, 'utf8')).installedAt || null;
    } catch {}
  }

  const marker = {
    installedAt: existingInstalledAt || new Date().toISOString(),
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

  onProgress({ stage: 'done', message: `Found Python ${py.version}. Multi-speaker runtime ready.` });
  return {
    success: true,
    runtimePath,
    pythonVersion: py.version,
    found: true,
    alreadyConfigured: markerAlreadyExists
  };
}

function normalizeSpeakerSegments(segments) {
  if (!Array.isArray(segments)) return [];
  const normalized = segments
    .map((segment) => {
      const startMs = Number(segment.startMs ?? segment.start_ms ?? segment.start ?? 0);
      const endMs = Number(segment.endMs ?? segment.end_ms ?? segment.end ?? 0);
      const speakerId = String(segment.speakerId ?? segment.speaker_id ?? segment.speaker ?? '').trim();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !speakerId) {
        return null;
      }
      return {
        startMs: Math.max(0, Math.round(startMs)),
        endMs: Math.max(0, Math.round(endMs)),
        speakerId
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs);

  return normalized;
}

async function runDiarization(wavPath, tmpDir, { onProgress = () => {}, signal = null } = {}) {
  const runtimeStatus = await checkDiarizationRuntime();
  if (!runtimeStatus.installed) {
    const err = new Error('Multi-speaker runtime is not configured.');
    err.code = 'RUNTIME_NOT_READY';
    throw err;
  }

  const config = getConfig();
  const helperPath = config.diarization_helper_path || path.join(DIARIZATION_DIR, 'diarize.py');
  if (!fs.existsSync(helperPath)) {
    const err = new Error(`Diarization helper not found at ${helperPath}`);
    err.code = 'HELPER_NOT_FOUND';
    throw err;
  }

  const outputPath = path.join(tmpDir, 'diarization.json');
  onProgress({ stage: 'diarization', message: 'Running multi-speaker diarization...' });

  return new Promise((resolve, reject) => {
    const args = [helperPath, '--input', wavPath, '--output', outputPath];
    const proc = spawn('python3', args, { shell: false });
    let stderr = '';
    let settled = false;

    const abortHandler = () => {
      try { proc.kill('SIGTERM'); } catch {}
      const err = new Error('Diarization cancelled.');
      err.cancelled = true;
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    if (signal) {
      if (signal.aborted) return abortHandler();
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      onProgress({ stage: 'diarization', detail: d.toString() });
    });

    proc.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abortHandler);
      if (settled) return;
      if (code !== 0) {
        settled = true;
        return reject(new Error(`Diarization helper failed (code ${code}): ${stderr}`));
      }

      if (!fs.existsSync(outputPath)) {
        settled = true;
        return reject(new Error('Diarization output file was not produced.'));
      }

      try {
        const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        const segments = normalizeSpeakerSegments(parsed.segments || parsed);
        settled = true;
        resolve({ segments, outputPath });
      } catch (err) {
        settled = true;
        reject(new Error(`Failed to parse diarization output: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', abortHandler);
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

module.exports = {
  DIARIZATION_DIR,
  RUNTIME_MARKER,
  checkDiarizationRuntime,
  installDiarizationRuntime,
  normalizeSpeakerSegments,
  runDiarization
};
