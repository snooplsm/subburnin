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
  caption_font_size:       64,
  caption_font_family:     'Roboto',
  caption_font_variant:    'regular'
};

function migrateLegacyModelOverride(config) {
  const override = config.whisper_model_path_override;
  if (!override) return config;

  // Legacy installs used ~/.captions. If that stale override remains, it can
  // block the valid default model path under ~/.subburnin.
  const isLegacyCaptionsPath = String(override).includes(`${path.sep}.captions${path.sep}`);
  const exists = fs.existsSync(override);
  if (isLegacyCaptionsPath && !exists) {
    const next = { ...config };
    delete next.whisper_model_path_override;
    return next;
  }
  return config;
}

function getConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULTS };
    const merged = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    return migrateLegacyModelOverride(merged);
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
