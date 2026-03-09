const { spawn } = require('child_process');
const path = require('path');

// ffmpeg-static returns a path inside app.asar, but spawn needs the real
// filesystem binary. In a packaged build the module is asarUnpacked, so we
// rewrite the path. In dev (no asar) the replace is a no-op.
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

function extractAudio(videoPath, outputWavPath, onProgress) {
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

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (onProgress) onProgress({ stage: 'extracting', detail: data.toString() });
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(outputWavPath);
      else reject(new Error(`ffmpeg extractAudio failed (code ${code}): ${stderr}`));
    });

    proc.on('error', reject);
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

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (onProgress) onProgress({ stage: 'burning', detail: data.toString() });
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(outputVideoPath);
      else reject(new Error(`ffmpeg burnSubBurnIn failed (code ${code}): ${stderr}`));
    });

    proc.on('error', reject);
  });
}

module.exports = { extractAudio, burnSubBurnIn };
