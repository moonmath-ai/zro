#!/usr/bin/env python3
"""Build `media/zro-logo.woff` — the ZRO brand mark as a one-glyph icon font.

Why a font at all? VS Code's model picker renders a model's `statusIcon` as a
*theme icon* (`<span class="codicon codicon-<id>">`), so it can only ever be a
font glyph — there is no API for a per-model bitmap/SVG. VS Code's `icons`
extension point lets an extension register such a glyph from its own font file
(`contributes.icons`), and the workbench then emits
`.codicon-<id>:before { content: ...; font-family: ... }` for us. That is what
makes the picker row show the ZRO mark instead of a stock codicon.

The glyph is derived from `media/icon.svg` (the same mark the activity bar and
the Marketplace listing use), so the source of truth stays the SVG: edit that
and re-run this script.

The geometry mirrors VS Code's own `codicon.ttf` so the glyph sits on the same
grid as its neighbours: unitsPerEm 300, ascent 300 / descent 0, mark scaled to
280/300 units (its 1px-wide bars in the 16px design grid land on ~1px, exactly
like the built-in icons' strokes) and centred on the em box.

Requires fontTools (`pip install fonttools`). Only run when icon.svg changes;
the generated .woff is committed so the normal build/publish path needs no
Python.

Usage: python3 scripts/build-icon-font.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "media" / "icon.svg"
OUT = ROOT / "media" / "zro-logo.woff"

# Must match `contributes.icons.zro-logo.default.fontCharacter` in package.json.
CODEPOINT = 0xE900
GLYPH_NAME = "uniE900"

# Must match VS Code's codicon.ttf so the mark lines up with the stock icons.
UPM = 300
ASCENT = 300
DESCENT = 0
# Height (in font units) the mark's bounding box is fitted to, centred on the em
# box. codicon.ttf draws its 16px icons on a 16.7px-em grid; 280/300 units is
# ~14.9px at the picker's 16px icon size, in line with its other brand glyphs.
TARGET_HEIGHT = 280


def parse_svg_rects(path: Path) -> list[tuple[float, float, float, float]]:
    """Return the (x, y, width, height) rectangles of the mark's `<path d>`.

    icon.svg is a flat run of `M x y h w v h h ±w z` rect subpaths (no curves),
    so this only needs M/h/v/H/z support.
    """
    svg = path.read_text(encoding="utf-8")
    match = re.search(r'<path[^>]*\sd="([^"]+)"', svg)
    if not match:
        raise SystemExit(f"no <path d=...> found in {path}")
    tokens = re.findall(r"[MhHvVzZ]|-?\d*\.?\d+", match.group(1))

    rects: list[tuple[float, float, float, float]] = []
    i = 0
    x = y = 0.0

    def take() -> float:
        nonlocal i
        value = float(tokens[i])
        i += 1
        return value

    while i < len(tokens):
        command = tokens[i]
        i += 1
        if command == "M":
            x, y = take(), take()
            # A subpath reads `M x y h ±w v h [h ∓w] z`: the horizontal run, the
            # vertical run, then (for mirrored rects) a segment back to the start
            # that carries no new geometry. Parse the first two, ignore the rest.
            horizontal = vertical = None
            while i < len(tokens) and tokens[i] not in "zZ":
                seg = tokens[i]
                i += 1
                if seg == "h":
                    value = take()
                elif seg == "H":
                    value = take() - x
                elif seg == "v":
                    value = take()
                    vertical = value if vertical is None else vertical
                    continue
                elif seg == "V":
                    value = take() - y
                    vertical = value if vertical is None else vertical
                    continue
                else:
                    raise SystemExit(f"unsupported path command {seg!r} in {path}")
                if horizontal is None:
                    horizontal = value
            if i < len(tokens):  # closing z
                i += 1
            if horizontal is None or vertical is None:
                raise SystemExit(f"rect at {(x, y)} is missing h/v segments in {path}")
            rects.append((min(x, x + horizontal), y, abs(horizontal), vertical))
        elif command in "zZ":
            continue
        else:
            raise SystemExit(f"unsupported path command {command!r} in {path}")
    if not rects:
        raise SystemExit(f"no rectangles parsed from {path}")
    return rects


def main() -> int:
    try:
        from fontTools.fontBuilder import FontBuilder
        from fontTools.pens.ttGlyphPen import TTGlyphPen
    except ImportError:
        print("fontTools is required: pip install fonttools", file=sys.stderr)
        return 1

    rects = parse_svg_rects(SVG)

    # Rectangles must not overlap: each becomes its own contour, and the nonzero
    # winding rule would cancel out any overlap into a hole.
    for a, ra in enumerate(rects):
        for rb in rects[a + 1 :]:
            if (
                ra[0] < rb[0] + rb[2]
                and rb[0] < ra[0] + ra[2]
                and ra[1] < rb[1] + rb[3]
                and rb[1] < ra[1] + ra[3]
            ):
                raise SystemExit(f"overlapping rects {ra} and {rb}")

    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    x1 = max(r[0] + r[2] for r in rects)
    y1 = max(r[1] + r[3] for r in rects)
    width, height = x1 - x0, y1 - y0

    scale = TARGET_HEIGHT / height
    # SVG y grows downwards, font y grows upwards, and the whole thing is
    # centred on the 0..UPM em box.
    offset_x = (UPM - width * scale) / 2 - x0 * scale
    # `offset_y - y * scale` is the mark's top edge at y0, so push the whole mark
    # down by the padding plus the part of the box above y0.
    offset_y = (UPM + TARGET_HEIGHT) / 2 + y0 * scale

    pen = TTGlyphPen(None)
    for x, y, w, h in rects:
        left = round(offset_x + x * scale)
        right = round(offset_x + (x + w) * scale)
        top = round(offset_y - y * scale)
        bottom = round(offset_y - (y + h) * scale)
        pen.moveTo((left, top))
        pen.lineTo((right, top))
        pen.lineTo((right, bottom))
        pen.lineTo((left, bottom))
        pen.closePath()

    builder = FontBuilder(UPM, isTTF=True)
    builder.setupGlyphOrder([".notdef", GLYPH_NAME])
    builder.setupCharacterMap({CODEPOINT: GLYPH_NAME})
    builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), GLYPH_NAME: pen.glyph()})
    builder.setupHorizontalMetrics({".notdef": (UPM, 0), GLYPH_NAME: (UPM, 0)})
    builder.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    builder.setupOS2(
        sTypoAscender=ASCENT,
        sTypoDescender=-DESCENT,
        usWinAscent=ASCENT,
        usWinDescent=DESCENT,
    )
    builder.setupNameTable(
        {
            "familyName": "ZRO Icons",
            "styleName": "Regular",
            "uniqueFontIdentifier": "ZRO Icons",
            "fullName": "ZRO Icons",
            "psName": "ZROIcons",
        }
    )
    builder.setupPost(keepGlyphNames=False)
    builder.font.flavor = "woff"
    builder.save(str(OUT))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {len(rects)} rects)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())