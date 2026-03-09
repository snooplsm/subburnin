const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { getWhisperCliPath, getModelPath } = require('./setup');

function transcribe(wavPath, tmpDir, onProgress) {
  return new Promise((resolve, reject) => {
    const config   = getConfig();
    const size     = config.whisper_model_size || 'medium';
    const language = config.whisper_language   || 'en';
    const threads  = config.whisper_threads    || 4;

    const modelPath  = config.whisper_model_path_override || getModelPath(size, language);
    const whisperCli = config.whisper_cli_path            || getWhisperCliPath();

    if (!fs.existsSync(whisperCli)) {
      return reject(new Error(
        `whisper-cli not found at ${whisperCli}. Please run first-time setup.`
      ));
    }

    if (!fs.existsSync(modelPath)) {
      return reject(new Error(
        `Whisper model not found: ${path.basename(modelPath)}. ` +
        `Open Settings and click "Download Model" to fetch it.`
      ));
    }

    const outputPrefix = path.join(tmpDir, 'subburnin');

    const args = [
      '-m', modelPath,
      '-t', String(threads),
      '--output-json-full',
      '--output-file', outputPrefix,
      '--suppress-nst',
      '--no-prints',
      '-l', language === 'auto' ? 'auto' : language,
      wavPath
    ];

    if (onProgress) onProgress({ stage: 'transcribing', detail: 'Starting whisper transcription...' });

    const proc = spawn(whisperCli, args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (onProgress) onProgress({ stage: 'transcribing', detail: data.toString() });
    });

    proc.stdout.on('data', (data) => {
      if (onProgress) onProgress({ stage: 'transcribing', detail: data.toString() });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`whisper-cli failed (code ${code}): ${stderr}`));
      }

      const jsonPath = outputPrefix + '.json';
      if (!fs.existsSync(jsonPath)) {
        return reject(new Error(`whisper-cli did not produce JSON at ${jsonPath}`));
      }

      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (e) {
        return reject(new Error(`Failed to parse whisper JSON: ${e.message}`));
      }

      const segments = parsed.transcription;
      if (!segments || segments.length === 0) {
        return reject(new Error('Transcription returned empty result. Check the audio and model.'));
      }

      resolve(segments);
    });

    proc.on('error', reject);
  });
}

module.exports = { transcribe };
