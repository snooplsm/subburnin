/**
 * First-run setup service.
 *
 * macOS  : Installs Homebrew silently if missing, then `brew install whisper-cpp`.
 *          whisper-cli ends up at /opt/homebrew/bin/whisper-cli (arm64)
 *                               or /usr/local/bin/whisper-cli (x86_64).
 *
 * Windows: Downloads whisper-blas-bin-x64.zip from the whisper.cpp GitHub release,
 *          extracts whisper-cli.exe + DLLs to ~/.subburnin/bin/.
 *
 * ffmpeg : Provided by the ffmpeg-static npm package on all platforms (no download).
 *
 * Model  : Downloaded from HuggingFace based on selected size and language.
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');

// ---------- paths ----------

const IS_WIN  = process.platform === 'win32';
const IS_MAC  = process.platform === 'darwin';
const IS_ARM  = process.arch === 'arm64';

const CAPTIONS_DIR = path.join(os.homedir(), '.subburnin');
const BIN_DIR      = path.join(CAPTIONS_DIR, 'bin');

// macOS homebrew paths
const BREW_ARM = '/opt/homebrew/bin/brew';
const BREW_X64 = '/usr/local/bin/brew';

// ---------- model helpers ----------

const MODEL_SIZE_BYTES = {
  tiny:   75000000,
  base:   142000000,
  small:  466000000,
  medium: 1500000000,
  large:  3100000000
};

function getModelFilename(size, language) {
  if (size === 'large') return 'ggml-large-v3.bin';
  // English-only model when language is 'en'
  if (language === 'en') return `ggml-${size}.en.bin`;
  return `ggml-${size}.bin`;
}

function getModelPath(size, language) {
  return path.join(CAPTIONS_DIR, getModelFilename(size, language));
}

function getModelUrl(size, language) {
  const filename = getModelFilename(size, language);
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${filename}`;
}

// Default model (used during first-run setup)
const DEFAULT_SIZE = 'medium';
const DEFAULT_LANG = 'en';
const MODEL_PATH   = getModelPath(DEFAULT_SIZE, DEFAULT_LANG);

// ---------- whisper binary ----------

function getWhisperCliPath() {
  if (IS_WIN) return path.join(BIN_DIR, 'whisper-cli.exe');
  // macOS: homebrew installs here
  const arm = '/opt/homebrew/bin/whisper-cli';
  const x64 = '/usr/local/bin/whisper-cli';
  if (fs.existsSync(arm)) return arm;
  if (fs.existsSync(x64)) return x64;
  return IS_ARM ? arm : x64; // expected path after install
}

// ---------- dependency checks ----------

function fileReady(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function checkDependencies(size, language, config) {
  const modelPath = (config && config.whisper_model_path_override)
    || (size && language ? getModelPath(size, language) : MODEL_PATH);
  const whisperPath = (config && config.whisper_cli_path) || getWhisperCliPath();
  return {
    whisperCli: fileReady(whisperPath),
    model:      fileReady(modelPath),
    modelPath,
    whisperPath
  };
}

function isSetupComplete(size, language, config) {
  const s = checkDependencies(size, language, config);
  return s.whisperCli && s.model;
}

// ---------- resumable download ----------
//
// Downloads `url` to `destPath` using HTTP Range requests so an interrupted
// download can continue from where it left off.
//
// Strategy:
//   • In-progress data is written to `destPath + '.part'`
//   • On each attempt, we stat the .part file to get bytes already received
//   • We send `Range: bytes=<offset>-` and the server (hopefully) returns 206
//   • 206  → open .part in append mode, add incoming bytes on top
//   • 200  → server ignored our Range; truncate and start fresh
//   • 416  → range not satisfiable (partial > server file); truncate and restart
//   • On success the .part file is atomically renamed to the final path
//   • On error the .part file is left on disk so the next call can resume
//
// `onProgress({ percent, downloaded, total })` — sizes in GB strings
//
function resumableDownload(url, destPath, onProgress, signal) {
  const partPath = destPath + '.part';

  return new Promise((resolve, reject) => {
    // Reject immediately if already aborted
    if (signal && signal.aborted) {
      return reject(Object.assign(new Error('Download cancelled'), { cancelled: true }));
    }

    attempt(url);

    function attempt(reqUrl) {
      // How many bytes do we already have?
      let existingBytes = 0;
      try { existingBytes = fs.statSync(partPath).size; } catch {}

      const headers = { 'User-Agent': 'SubBurnIn-App' };
      if (existingBytes > 0) headers['Range'] = `bytes=${existingBytes}-`;

      const parsed  = new URL(reqUrl);
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || 443,
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers,
        ...(signal ? { signal } : {})
      };

      const req = https.request(options, (res) => {
        // --- Redirect ---
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          res.destroy();
          return attempt(res.headers.location);
        }

        // --- Range not satisfiable: our .part is ≥ server file size ---
        if (res.statusCode === 416) {
          res.destroy();
          try { fs.unlinkSync(partPath); } catch {}
          existingBytes = 0;
          return attempt(reqUrl);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.destroy();
          return reject(new Error(`HTTP ${res.statusCode}: ${reqUrl}`));
        }

        const isResume      = res.statusCode === 206;
        const contentLength = parseInt(res.headers['content-length'], 10) || 0;
        const totalBytes    = isResume ? existingBytes + contentLength : contentLength;

        // Server returned 200 even though we sent Range — must restart
        if (!isResume && existingBytes > 0) {
          existingBytes = 0;
          try { fs.unlinkSync(partPath); } catch {}
        }

        let received = existingBytes;
        const dest   = fs.createWriteStream(partPath, { flags: isResume ? 'a' : 'w' });

        res.on('data', (chunk) => {
          received += chunk.length;
          dest.write(chunk);
          if (totalBytes > 0) {
            onProgress({
              percent:    Math.min(Math.round(received / totalBytes * 100), 99),
              downloaded: (received   / 1e9).toFixed(2),
              total:      (totalBytes / 1e9).toFixed(2),
              resumed:    isResume && existingBytes > 0
            });
          }
        });

        res.on('end', () => {
          dest.end(() => {
            try {
              fs.renameSync(partPath, destPath);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });

        const onErr = (e) => {
          res.destroy();
          dest.destroy();
          // Distinguish abort from real errors: leave .part file intact on abort
          if (e.name === 'AbortError' || e.code === 'ABORT_ERR') {
            reject(Object.assign(new Error('Download cancelled'), { cancelled: true }));
          } else {
            reject(e);
          }
        };
        res.on('error', onErr);
        dest.on('error', onErr);
      });

      req.on('error', (e) => {
        if (e.name === 'AbortError' || e.code === 'ABORT_ERR') {
          reject(Object.assign(new Error('Download cancelled'), { cancelled: true }));
        } else {
          reject(e);
        }
      });
      req.end();
    }
  });
}

function spawnAsync(cmd, args, env, onDetail) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: { ...process.env, ...env } });
    proc.stdout.on('data', (d) => onDetail && onDetail(d.toString()));
    proc.stderr.on('data', (d) => onDetail && onDetail(d.toString()));
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    proc.on('error', reject);
  });
}

// ---------- macOS: install Homebrew ----------

function installHomebrew(onDetail) {
  return new Promise((resolve, reject) => {
    const proc = spawn('/bin/bash', ['-c',
      'curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | NONINTERACTIVE=1 bash'
    ], { env: { ...process.env, NONINTERACTIVE: '1' } });
    proc.stdout.on('data', (d) => onDetail && onDetail(d.toString()));
    proc.stderr.on('data', (d) => onDetail && onDetail(d.toString()));
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('Homebrew install failed')));
    proc.on('error', reject);
  });
}

// ---------- macOS: install whisper-cpp via brew ----------

async function installWhisperMac(onProgress) {
  const brewExists = fs.existsSync(BREW_ARM) || fs.existsSync(BREW_X64);

  if (!brewExists) {
    onProgress({ step: 'whisper', status: 'installing', message: 'Installing Homebrew (one-time)...' });
    await installHomebrew((d) => onProgress({ step: 'whisper', status: 'installing', detail: d }));
  }

  const brew = fs.existsSync(BREW_ARM) ? BREW_ARM : BREW_X64;
  onProgress({ step: 'whisper', status: 'installing', message: 'Installing whisper-cpp via Homebrew...' });
  await spawnAsync(brew, ['install', 'whisper-cpp'], {},
    (d) => onProgress({ step: 'whisper', status: 'installing', detail: d }));
}

// ---------- Windows: download + extract whisper ----------

async function installWhisperWindows(onProgress, signal) {
  const WHISPER_VERSION = 'v1.8.3';
  const ZIP_URL     = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-blas-bin-x64.zip`;
  const ZIP_PATH    = path.join(CAPTIONS_DIR, 'whisper-win.zip');
  const EXTRACT_DIR = path.join(CAPTIONS_DIR, '_whisper_extract');

  fs.mkdirSync(CAPTIONS_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });

  onProgress({ step: 'whisper', status: 'installing', message: 'Downloading whisper-cpp for Windows...' });
  await resumableDownload(ZIP_URL, ZIP_PATH, ({ percent }) => {
    onProgress({ step: 'whisper', status: 'installing',
      message: `Downloading whisper-cpp... ${percent}%` });
  }, signal);

  onProgress({ step: 'whisper', status: 'installing', message: 'Extracting whisper-cpp...' });
  if (fs.existsSync(EXTRACT_DIR)) fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  await spawnAsync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Force -Path "${ZIP_PATH}" -DestinationPath "${EXTRACT_DIR}"`
  ], {}, null);

  const releaseDir = path.join(EXTRACT_DIR, 'Release');
  for (const file of fs.readdirSync(releaseDir)) {
    fs.copyFileSync(path.join(releaseDir, file), path.join(BIN_DIR, file));
  }

  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.rmSync(ZIP_PATH, { force: true });
}

// ---------- model download ----------

function downloadModel(size, language, onProgress, signal) {
  const modelPath = getModelPath(size, language);
  const modelUrl  = getModelUrl(size, language);

  fs.mkdirSync(CAPTIONS_DIR, { recursive: true });
  return resumableDownload(modelUrl, modelPath, onProgress, signal);
}

// ---------- main entry ----------

async function runSetup(onProgress, size, language, signal) {
  const sz   = size     || DEFAULT_SIZE;
  const lang = language || DEFAULT_LANG;
  const status = checkDependencies(sz, lang);

  // whisper-cli
  if (!status.whisperCli) {
    if (IS_WIN) {
      await installWhisperWindows(onProgress, signal);
    } else {
      await installWhisperMac(onProgress); // Homebrew doesn't support abort
    }
    onProgress({ step: 'whisper', status: 'done', message: 'whisper-cpp ready' });
  } else {
    onProgress({ step: 'whisper', status: 'done', message: 'whisper-cpp already installed' });
  }

  // model
  if (!status.model) {
    const filename = getModelFilename(sz, lang);
    const sizeMB   = (MODEL_SIZE_BYTES[sz] || 0) / 1e6;
    onProgress({ step: 'model', status: 'downloading',
      message: `Downloading ${filename} (~${sizeMB >= 1000 ? (sizeMB/1000).toFixed(1)+'GB' : Math.round(sizeMB)+'MB'})...`,
      percent: 0 });
    await downloadModel(sz, lang,
      (d) => onProgress({ step: 'model', status: 'downloading', ...d }),
      signal);
    onProgress({ step: 'model', status: 'done', message: 'Whisper model ready' });
  } else {
    onProgress({ step: 'model', status: 'done', message: 'Whisper model already present' });
  }
}

module.exports = {
  checkDependencies,
  isSetupComplete,
  runSetup,
  downloadModel,
  getWhisperCliPath,
  getModelPath,
  getModelFilename,
  getModelUrl,
  MODEL_PATH,
  CAPTIONS_DIR
};
