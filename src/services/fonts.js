const fs = require('fs');
const path = require('path');
const https = require('https');
const { CONFIG_DIR } = require('./config');

const GOOGLE_FONTS_LIST_URL = 'https://gwfh.mranftl.com/api/fonts';
const GOOGLE_FONTS_DETAIL_BASE_URL = 'https://gwfh.mranftl.com/api/fonts';
const INDEX_CACHE_FILE = path.join(CONFIG_DIR, 'google-fonts-index.json');
const FONTS_DIR = path.join(CONFIG_DIR, 'fonts');
const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent': 'SubBurnIn/1.0',
          Accept: 'application/json'
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchUrl(res.headers.location));
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    ).on('error', reject);
  });
}

async function fetchJson(url) {
  const buf = await fetchUrl(url);
  return JSON.parse(buf.toString('utf8'));
}

function sanitizeFontFamily(family) {
  return String(family || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
}

function readIndexCache() {
  try {
    if (!fs.existsSync(INDEX_CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(INDEX_CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeIndexCache(index) {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(INDEX_CACHE_FILE, JSON.stringify(index, null, 2), 'utf8');
}

async function refreshGoogleFontsIndex() {
  const raw = await fetchJson(GOOGLE_FONTS_LIST_URL);
  if (!Array.isArray(raw)) throw new Error('Unexpected Google Fonts index response');

  const fonts = raw
    .filter((entry) => entry && entry.family && entry.id)
    .map((entry) => ({
      id: entry.id,
      family: entry.family,
      variants: Array.isArray(entry.variants) ? entry.variants : ['regular']
    }))
    .sort((a, b) => a.family.localeCompare(b.family));

  const index = {
    fetchedAt: Date.now(),
    fonts
  };
  writeIndexCache(index);
  return index;
}

async function getGoogleFontsIndex({ forceRefresh = false } = {}) {
  const cached = readIndexCache();
  const isFresh = cached && (Date.now() - (cached.fetchedAt || 0) < INDEX_TTL_MS);
  if (!forceRefresh && isFresh) return cached;

  try {
    return await refreshGoogleFontsIndex();
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

function listDownloadedFonts() {
  if (!fs.existsSync(FONTS_DIR)) return [];
  const files = fs.readdirSync(FONTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ttf|otf)$/i.test(entry.name))
    .map((entry) => entry.name);

  const results = [];
  const seen = new Set();
  for (const filename of files) {
    const match = filename.match(/^(.*)-([^-]+)\.(ttf|otf)$/i);
    const family = (match ? match[1] : filename.replace(/\.(ttf|otf)$/i, '')).replace(/_/g, ' ');
    const variant = (match ? match[2] : 'regular').replace(/_/g, ' ').toLowerCase();
    const key = `${family.toLowerCase()}::${variant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ family, variant, file: filename });
  }
  return results.sort((a, b) => (a.family.localeCompare(b.family) || a.variant.localeCompare(b.variant)));
}

function findGoogleFontByFamily(index, family) {
  const normalized = String(family || '').trim().toLowerCase();
  return index.fonts.find((entry) => entry.family.toLowerCase() === normalized);
}

async function downloadGoogleFont(family, subset = 'latin', variant = 'regular') {
  const index = await getGoogleFontsIndex();
  const entry = findGoogleFontByFamily(index, family);
  if (!entry) {
    throw new Error(`Google font not found: ${family}`);
  }

  const detailUrl = `${GOOGLE_FONTS_DETAIL_BASE_URL}/${encodeURIComponent(entry.id)}?subsets=${encodeURIComponent(subset)}`;
  const detail = await fetchJson(detailUrl);
  if (!detail || !Array.isArray(detail.variants) || detail.variants.length === 0) {
    throw new Error(`No downloadable variants found for ${entry.family}`);
  }

  const requestedVariant = String(variant || 'regular').toLowerCase();
  const preferredVariant = detail.variants.find((v) => String(v.id || '').toLowerCase() === requestedVariant)
    || detail.variants.find((v) => v.id === 'regular')
    || detail.variants.find((v) => v.id === detail.defVariant)
    || detail.variants[0];
  const fileUrl = preferredVariant.ttf;
  if (!fileUrl) {
    throw new Error(`No downloadable TTF file found for ${entry.family}`);
  }

  ensureDir(FONTS_DIR);
  const safeFamily = sanitizeFontFamily(entry.family).replace(/\s+/g, '_');
  const safeVariant = sanitizeFontFamily(preferredVariant.id || 'regular').replace(/\s+/g, '_');
  const filename = `${safeFamily}-${safeVariant}.ttf`;
  const destPath = path.join(FONTS_DIR, filename);
  const tmpPath = `${destPath}.tmp`;

  const fileBuf = await fetchUrl(fileUrl);
  fs.writeFileSync(tmpPath, fileBuf);
  fs.renameSync(tmpPath, destPath);

  return {
    family: entry.family,
    variant: String(preferredVariant.id || 'regular').toLowerCase(),
    path: destPath,
    file: filename
  };
}

module.exports = {
  FONTS_DIR,
  getGoogleFontsIndex,
  refreshGoogleFontsIndex,
  listDownloadedFonts,
  downloadGoogleFont
};
