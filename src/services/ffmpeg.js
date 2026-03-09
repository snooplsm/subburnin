const { spawn } = require('child_process');
const path = require('path');

// ffmpeg-static returns a path inside app.asar, but spawn needs the real
// filesystem binary. In a packaged build the module is asarUnpacked, so we
// rewrite the path. In dev (no asar) the replace is a no-op.
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

function extractAudio(videoPath, outputWavPath, onProgress, signal = null) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', videoPath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      outputWavPath
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    let settled = false;

    const abortHandler = () => {
      try { proc.kill('SIGTERM'); } catch {}
      const err = new Error('Extraction cancelled.');
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

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (onProgress) onProgress({ stage: 'extracting', detail: data.toString() });
    });

    proc.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abortHandler);
      if (settled) return;
      if (code === 0) {
        settled = true;
        resolve(outputWavPath);
      } else {
        if (signal && signal.aborted) {
          const err = new Error('Extraction cancelled.');
          err.cancelled = true;
          settled = true;
          return reject(err);
        }
        settled = true;
        reject(new Error(`ffmpeg extractAudio failed (code ${code}): ${stderr}`));
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

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, '/')       // normalize to forward slashes first
    .replace(/:/g, '\\:')      // escape colons (Windows drive letters)
    .replace(/'/g, "\\'");     // escape single quotes
}

function burnSubBurnIn(videoPath, assPath, outputVideoPath, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    const escapedAss = escapeFilterPath(assPath);
    let assFilter = `ass=filename='${escapedAss}'`;
    if (options.fontsDir) {
      const escapedFontsDir = escapeFilterPath(options.fontsDir);
      assFilter += `:fontsdir='${escapedFontsDir}'`;
    }

    const args = [
      '-y',
      '-i', videoPath,
      '-vf', assFilter,
      '-c:v', 'libx264',
      '-crf', '18',
      '-c:a', 'copy',
      outputVideoPath
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    let settled = false;

    const abortHandler = () => {
      try { proc.kill('SIGTERM'); } catch {}
      const err = new Error('Burn cancelled.');
      err.cancelled = true;
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    if (options.signal) {
      if (options.signal.aborted) return abortHandler();
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (onProgress) onProgress({ stage: 'burning', detail: data.toString() });
    });

    proc.on('close', (code) => {
      if (options.signal) options.signal.removeEventListener('abort', abortHandler);
      if (settled) return;
      if (code === 0) {
        settled = true;
        resolve(outputVideoPath);
      } else {
        if (options.signal && options.signal.aborted) {
          const err = new Error('Burn cancelled.');
          err.cancelled = true;
          settled = true;
          return reject(err);
        }
        settled = true;
        reject(new Error(`ffmpeg burnSubBurnIn failed (code ${code}): ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      if (options.signal) options.signal.removeEventListener('abort', abortHandler);
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function createPreviewProxy(videoPath, outputMp4Path, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', videoPath,
      '-vf', "scale='min(1280,iw)':-2:flags=lanczos",
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-movflags', '+faststart',
      outputMp4Path
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (onProgress) onProgress({ stage: 'preview-proxy', detail: data.toString() });
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(outputMp4Path);
      else reject(new Error(`ffmpeg createPreviewProxy failed (code ${code}): ${stderr}`));
    });

    proc.on('error', reject);
  });
}

module.exports = { extractAudio, burnSubBurnIn, createPreviewProxy };
