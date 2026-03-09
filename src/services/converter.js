/**
 * Convert whisper transcription segments to styled ASS with per-word highlighting.
 *
 * Normal words  : Roboto, white, thin black outline, drop shadow
 * Highlighted   : champagne-gold text inside a thick black rounded-pill border (\bord)
 *
 * One non-overlapping Dialogue line per word — the active word gets inline
 * \1c + \bord + \3c overrides; \r resets for all other words in the same line.
 *
 * Timing heuristic: each word's lineStart is clamped to ≥ the previous word's
 * lineEnd so subburnin never appear before their predecessor finishes.
 */

// Pill border width in pixels (at PlayResX 1920). Scales with font size.
const HIGHLIGHT_BORD = 18;
const MIN_WORD_DURATION_MS = 70;

// Patterns whisper generates for music, noise, silence — skip these segments entirely
const HALLUCINATION_RE = /^\s*[\[(]?\s*(music|song|singing|applause|laughter|noise|silence|background|instrumental|inaudible|blank.?audio|no.?speech|♪|🎵)[^\])\n]*[\])]?\s*$/i;

/**
 * Convert a hex color string to ASS format (&HAABBGGRR&).
 *
 * Accepts:
 *   #RRGGBB   — fully opaque
 *   #RRGGBBAA — AA is 0-255 opacity (0=opaque, 255=transparent), same sense as CSS alpha
 *               but ASS stores it inverted: AA 0x00 = opaque, 0xFF = transparent.
 *               We keep the CSS convention so AA=FF means fully transparent in both.
 *
 * @param {string} hex  e.g. '#CFA84E' or '#CFA84ECC'
 * @returns {string}    e.g. '&H004EA8CF&' or '&H334EA8CF&'
 */
function hexToAss(hex) {
  const h = hex.replace('#', '').toUpperCase();
  const r  = h.substring(0, 2);
  const g  = h.substring(2, 4);
  const b  = h.substring(4, 6);
  // 8-digit hex: last two are alpha (CSS: FF=opaque → ASS: 00=opaque, so invert)
  const aa = h.length === 8 ? (255 - parseInt(h.substring(6, 8), 16)).toString(16).padStart(2, '0').toUpperCase() : '00';
  return `&H${aa}${b}${g}${r}&`;
}

function sanitizeAssFontName(fontFamily) {
  return String(fontFamily || 'Roboto').replace(/,/g, ' ').trim() || 'Roboto';
}

function parseVariant(variant) {
  const v = String(variant || 'regular').toLowerCase();
  if (v === 'regular') return { weight: 400, italic: false };
  if (v === 'italic') return { weight: 400, italic: true };
  const m = v.match(/^(\d{3})(italic)?$/);
  if (m) return { weight: parseInt(m[1], 10), italic: Boolean(m[2]) };
  return { weight: 400, italic: false };
}

function buildAssHeader(textColor, outlineColor, fontSize, fontFamily, fontVariant) {
  const primaryAss = `&H00${textColor.replace('#', '').toUpperCase()
    .replace(/(..)(..)(..)/, '$3$2$1')}&`;
  const outlineAss = `&H00${outlineColor.replace('#', '').toUpperCase()
    .replace(/(..)(..)(..)/, '$3$2$1')}&`;
  // Use hexToAss for correctness
  const primaryFull = hexToAss(textColor);
  const outlineFull = hexToAss(outlineColor);
  const assFontFamily = sanitizeAssFontName(fontFamily);
  const variant = parseVariant(fontVariant);
  const bold = variant.weight >= 700 ? -1 : 0;
  const italic = variant.italic ? -1 : 0;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${assFontFamily},${fontSize},${primaryFull},${primaryFull},${outlineFull},${outlineFull},${bold},${italic},0,0,100,100,0,0,1,2,2,2,20,20,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/** Convert millisecond offset to ASS timestamp H:MM:SS.cc */
function msToAss(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Merge whisper tokens into display words.
 *
 * Attach rule: only attach to the previous word when the token starts with a
 * punctuation/symbol character (., , ! ? ' " : ; — etc.).  Tokens starting
 * with a letter or digit are ALWAYS treated as new words — even when they lack
 * a leading space, which happens because whisper.cpp timing tokens ([_TT_N])
 * are filtered out just before them, stripping the visual gap.
 *
 * When a letter/digit token has no leading space and is NOT the first word we
 * add a space ourselves so the display text flows correctly.
 */
function mergeTokensIntoWords(tokens) {
  const words = [];
  for (const token of tokens) {
    if (token.text.startsWith('[_') || token.text.trim() === '') continue;
    const trimmed  = token.text.trim();
    const hasSpace = token.text.startsWith(' ');

    // Only attach punctuation/symbols — never a token that starts with a letter
    // or digit, even if it has no leading space after a filtered timing token.
    const isPuncOrSymbol = /^[^a-zA-ZÀ-ÿ0-9]/.test(trimmed);
    const isAttached     = words.length > 0 && !hasSpace && isPuncOrSymbol;

    if (isAttached) {
      words[words.length - 1].text      += trimmed;
      words[words.length - 1].offsets.to = token.offsets.to;
    } else {
      // Restore a leading space when the token has none but isn't the first word
      const text = words.length > 0 && !hasSpace ? ' ' + trimmed : token.text;
      words.push({ text, offsets: { ...token.offsets } });
    }
  }
  return words;
}

/**
 * Normalize word timing inside a segment.
 *
 * Whisper word offsets near the beginning can be noisy (too early, overlapping,
 * zero-length). This pass enforces:
 * - starts never move backward
 * - starts/ends stay within segment bounds
 * - each word has a minimum visible duration
 */
function normalizeWordTimings(words, segStart, segEnd) {
  const out = [];
  let prevEnd = segStart;

  for (let i = 0; i < words.length; i++) {
    const rawStart = Number(words[i].offsets.from);
    const nextRawStart = i + 1 < words.length ? Number(words[i + 1].offsets.from) : NaN;
    const rawTo = Number(words[i].offsets.to);

    const startBase = Number.isFinite(rawStart) ? rawStart : prevEnd;
    let start = Math.max(segStart, prevEnd, startBase);

    const fallbackEnd = Number.isFinite(rawTo) ? rawTo : segEnd;
    const proposedEnd = Number.isFinite(nextRawStart) ? nextRawStart : fallbackEnd;
    let end = Math.max(proposedEnd, start + MIN_WORD_DURATION_MS);

    // Reserve enough room for remaining words to keep durations valid.
    const remaining = words.length - i - 1;
    const latestEnd = Math.max(start + MIN_WORD_DURATION_MS, segEnd - remaining * MIN_WORD_DURATION_MS);
    end = Math.min(end, latestEnd, segEnd);

    if (end <= start) {
      end = Math.min(segEnd, start + MIN_WORD_DURATION_MS);
    }
    if (end <= start) {
      // Degenerate segment: force strictly increasing timestamps.
      end = start + 1;
    }

    out.push({ start: Math.round(start), end: Math.round(end) });
    prevEnd = end;
  }

  return out;
}

/**
 * Build ASS from whisper JSON segments (each with a tokens array).
 *
 * @param {Array}  segments - parsed whisper transcription array
 * @param {object} options  - optional style overrides
 * @param {string} options.textColor      - HTML hex e.g. '#FFFFFF'
 * @param {string} options.highlightColor - HTML hex e.g. '#CFA84E'
 * @param {string} options.highlightBg    - HTML hex e.g. '#000000'
 * @param {string} options.outlineColor   - HTML hex e.g. '#000000'
 * @param {number} options.fontSize       - e.g. 64
 * @returns {string} ASS file content
 */
function segmentsToAss(segments, options = {}) {
  const textColor      = options.textColor      || '#FFFFFF';
  const highlightColor = options.highlightColor || '#CFA84E';
  const highlightBg    = options.highlightBg    || '#000000';
  const outlineColor   = options.outlineColor   || '#000000';
  const fontSize       = options.fontSize       || 64;
  const fontFamily     = options.fontFamily     || 'Roboto';
  const fontVariant    = options.fontVariant    || 'regular';

  const highlightAss = hexToAss(highlightColor);
  const highlightBgAss = hexToAss(highlightBg);

  const header = buildAssHeader(textColor, outlineColor, fontSize, fontFamily, fontVariant);

  const dialogueLines = [];

  for (const segment of segments) {
    // Skip segments that are music, noise, or silence annotations
    if (HALLUCINATION_RE.test(segment.text)) continue;

    const segStart = Math.max(0, Number(segment.offsets.from) || 0);
    const segEndRaw = Number(segment.offsets.to);
    const segEnd = Math.max(segStart + MIN_WORD_DURATION_MS, Number.isFinite(segEndRaw) ? segEndRaw : segStart + MIN_WORD_DURATION_MS);

    // Merge sub-word tokens (apostrophes, punctuation) into their parent word
    const words = mergeTokensIntoWords(segment.tokens);

    if (words.length === 0) continue;

    const wordTexts = words.map((w) => w.text);
    const wordTimings = normalizeWordTimings(words, segStart, segEnd);

    for (let i = 0; i < words.length; i++) {
      const lineStart = wordTimings[i].start;
      const lineEnd   = wordTimings[i].end;

      // Build full segment text; only the active word gets the highlight tags.
      let text = '';
      for (let j = 0; j < wordTexts.length; j++) {
        if (j === i) {
          text += `{\\1c${highlightAss}\\bord${HIGHLIGHT_BORD}\\3c${highlightBgAss}\\shad0}${wordTexts[j]}{\\r}`;
        } else {
          text += wordTexts[j];
        }
      }

      dialogueLines.push(
        `Dialogue: 0,${msToAss(lineStart)},${msToAss(lineEnd)},Default,,0,0,0,,${text}`
      );
    }
  }

  return header + dialogueLines.join('\n') + '\n';
}

module.exports = { segmentsToAss, hexToAss };
