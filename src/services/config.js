const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR  = path.join(os.homedir(), '.subburnin');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  whisper_model_size: 'medium',
  whisper_language: 'en',
  whisper_threads: 4,
  output_dir: '',
  theme: 'system',  // 'system' | 'dark' | 'light'
  caption_text_color:      '#FFFFFF',
  caption_highlight_color: '#CFA84E',
  caption_highlight_bg:    '#000000',
  caption_outline_color:   '#000000',
  caption_font_size:       64
};

function getConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function setConfig(partial) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const updated = { ...getConfig(), ...partial };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

module.exports = { getConfig, setConfig, CONFIG_DIR };
