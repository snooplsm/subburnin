#!/bin/bash
# Converts assets/icon.png (1024x1024) → assets/icon.icns + assets/icon.ico
# Composites the source image onto a white background first.
# Requires macOS built-in sips and iconutil tools.

SRC="assets/icon.png"
ICONSET="assets/AppIcon.iconset"
DEST="assets/icon.icns"
FLAT="assets/icon_flat.png"   # temp: source composited on white

if [ ! -f "$SRC" ]; then
  echo "⚠️  $SRC not found — skipping icon build."
  echo "   Place a 1024x1024 PNG at $SRC and re-run: npm run make-icon"
  exit 0
fi

# Flatten onto white background using sips
# sips --addIcon pads with alpha; we use a two-step approach:
# 1. Create a 1024×1024 white PNG via Python (no extra deps)
# 2. Composite the source on top with sips
python3 - "$SRC" "$FLAT" <<'PY'
import sys
from PIL import Image

src_path, out_path = sys.argv[1], sys.argv[2]
src = Image.open(src_path).convert("RGBA").resize((1024, 1024), Image.LANCZOS)
bg  = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
bg.paste(src, (0, 0), src)
bg.convert("RGB").save(out_path, "PNG")
PY

# Fallback: if Pillow not available, use sips padding (white via ColorSync)
if [ ! -f "$FLAT" ]; then
  cp "$SRC" "$FLAT"
  sips -p 1024 1024 --padColor FFFFFF "$FLAT" > /dev/null
fi

mkdir -p "$ICONSET"

sips -z 16   16   "$FLAT" --out "$ICONSET/icon_16x16.png"      > /dev/null
sips -z 32   32   "$FLAT" --out "$ICONSET/icon_16x16@2x.png"   > /dev/null
sips -z 32   32   "$FLAT" --out "$ICONSET/icon_32x32.png"      > /dev/null
sips -z 64   64   "$FLAT" --out "$ICONSET/icon_32x32@2x.png"   > /dev/null
sips -z 128  128  "$FLAT" --out "$ICONSET/icon_128x128.png"    > /dev/null
sips -z 256  256  "$FLAT" --out "$ICONSET/icon_128x128@2x.png" > /dev/null
sips -z 256  256  "$FLAT" --out "$ICONSET/icon_256x256.png"    > /dev/null
sips -z 512  512  "$FLAT" --out "$ICONSET/icon_256x256@2x.png" > /dev/null
sips -z 512  512  "$FLAT" --out "$ICONSET/icon_512x512.png"    > /dev/null
sips -z 1024 1024 "$FLAT" --out "$ICONSET/icon_512x512@2x.png" > /dev/null

iconutil -c icns "$ICONSET" -o "$DEST"
rm -rf "$ICONSET" "$FLAT"
echo "✓ Created $DEST"

# Generate Windows .ico using ffmpeg-static.
# Build from PNG source (not .icns) to avoid malformed outputs on some ffmpeg builds.
FFMPEG=$(node -e "process.stdout.write(require('ffmpeg-static'))" 2>/dev/null)
if [ -n "$FFMPEG" ]; then
  "$FFMPEG" -y -i "$SRC" -vf "scale=256:256:flags=lanczos" "assets/icon.ico" > /dev/null 2>&1
  if file "assets/icon.ico" | grep -q "256x256"; then
    echo "✓ Created assets/icon.ico"
  else
    echo "⚠️  assets/icon.ico was generated but does not include a 256x256 layer."
    echo "   Windows build may fail. Re-run npm run make-icon and verify assets/icon.ico."
  fi
fi
