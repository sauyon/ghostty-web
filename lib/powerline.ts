/**
 * Powerline + Powerline-Extra glyph renderer.
 *
 * Covers U+E0B0..U+E0BF and the two bisector glyphs U+E0D2 / U+E0D4
 * from the Powerline Extra Symbols set:
 *   https://github.com/ryanoasis/powerline-extra-symbols
 *
 * Fonts that patch these in (Nerd Fonts, JetBrains Mono NF, etc.) are
 * usually close to flush with the cell, but not exactly: the font's
 * ascent/descent rarely matches the cell height we choose for
 * descender safety, leaving visible seams in a column of separators
 * or stair-stepping joins between adjacent shapes. We draw them as
 * canvas paths sized to the cell instead, mirroring what every modern
 * terminal does for the box-drawing range.
 *
 * Ports the structure of Ghostty's `src/font/sprite/draw/powerline.zig`:
 *   - filled triangles for the hard dividers and corner wedges
 *     (E0B0, E0B2, E0B8, E0BA, E0BC, E0BE),
 *   - stroked angle dividers for the soft, thin chevrons
 *     (E0B1, E0B3) at light box thickness,
 *   - "stadium"-shaped semicircle caps via cubic Beziers with the
 *     standard Kappa ≈ 0.5523 quarter-circle approximation
 *     (E0B4 filled, E0B5 inner-stroked, plus their horizontal
 *     mirrors E0B6, E0B7),
 *   - hourglass / vertical-bisector wedges with a `lightPx` gap at
 *     the midline (E0D2, E0D4),
 *   - diagonal line variants (E0B9, E0BB, E0BD, E0BF) that delegate
 *     to the box-drawing diagonals (U+2571 ╱, U+2572 ╲) so the
 *     glyph is identical to the box character that tiles with it.
 *
 * Two notes on the Canvas2D side:
 *
 *   1. "Inner stroke" (Ghostty's `innerStrokePath`) means the stroke
 *      lies inside the path rather than centered on it. Canvas2D has
 *      no built-in mode for this, so we clip to the filled region of
 *      the path before stroking. With the clip in place the half of
 *      the stroke that would lie outside gets cut, leaving a clean
 *      inside-only stroke at the natural line width.
 *
 *   2. Horizontal mirroring (Ghostty's `flipHorizontal`) is done by
 *      reflecting around the cell's vertical centerline with a
 *      save / translate / scale(-1, 1) / draw / restore block; this
 *      keeps every helper authored as if the cell sits at (0, 0).
 */

import { drawBoxOrBlock } from './box-drawing';

// Kappa: cubic-Bezier control-point factor for approximating a
// quarter-circle. (sqrt(2) - 1) * 4/3 ≈ 0.5522847498.
const ARC_K = (Math.SQRT2 - 1) * (4 / 3);

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns true if the codepoint is a Powerline glyph that we render
 * directly. Caller should skip the font path in that case.
 *
 * Covers the full Powerline Symbols block (U+E0B0..U+E0BF) plus the
 * two vertical-bisector glyphs (U+E0D2, U+E0D4) from Powerline Extra
 * Symbols. Other Private Use Area glyphs (Powerline Extras includes
 * stylized variants like leaves and lightning bolts) fall through to
 * the font.
 */
export function isPowerline(codepoint: number): boolean {
  if (codepoint >= 0xe0b0 && codepoint <= 0xe0bf) return true;
  return codepoint === 0xe0d2 || codepoint === 0xe0d4;
}

/**
 * Render a Powerline glyph into the cell at (x, y, w, h).
 *
 *   - `color` is the css color string used for the foreground stroke
 *     and fill. Both the fill style and the stroke style of the 2D
 *     context are set to this value internally.
 *   - `lightPx` is the font-derived light box-stroke thickness in CSS
 *     pixels, the same value used by `drawBoxOrBlock`. Used for the
 *     soft chevrons (E0B1, E0B3), the semicircle outlines (E0B5,
 *     E0B7), and the bisector gap (E0D2, E0D4). Defensively rounded
 *     to the nearest integer ≥ 1 inside this function.
 *
 * Returns true if the glyph was handled; false if the caller should
 * fall back to font rendering. Returns false (no draw) if `w` or `h`
 * is non-positive.
 */
export function drawPowerline(
  ctx: CanvasRenderingContext2D,
  codepoint: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  lightPx: number
): boolean {
  if (!(w > 0) || !(h > 0)) return false;
  const px = Math.max(1, Math.round(lightPx));

  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  switch (codepoint) {
    // ----- Hard dividers (filled triangles, full cell height) ---------------

    case 0xe0b0: // right-pointing triangle, hard divider
      fillTriangle(ctx, x, y, x + w, y + h / 2, x, y + h);
      return true;

    case 0xe0b2: // left-pointing triangle, hard divider
      fillTriangle(ctx, x + w, y, x, y + h / 2, x + w, y + h);
      return true;

    // ----- Soft dividers (stroked angles at light box thickness) ------------

    case 0xe0b1: // right-pointing angle, thin divider
      strokeChevron(ctx, x, y, x + w, y + h / 2, x, y + h, px);
      return true;

    case 0xe0b3: // left-pointing angle, thin divider (mirror of E0B1)
      ctx.save();
      mirrorAroundCellCenter(ctx, x, w);
      strokeChevron(ctx, x, y, x + w, y + h / 2, x, y + h, px);
      ctx.restore();
      return true;

    // ----- Semicircle caps (stadium-shaped, not true ellipses) --------------
    //
    // When the cell is taller than it is wide (the usual case) the
    // shape is a rectangle with a rounded right (or left) side and
    // straight top/bottom edges; only the corners are curved.

    case 0xe0b4:
      fillStadium(ctx, x, y, w, h, /* mirror */ false);
      return true;

    case 0xe0b5:
      innerStrokeStadium(ctx, x, y, w, h, px, /* mirror */ false);
      return true;

    case 0xe0b6:
      fillStadium(ctx, x, y, w, h, /* mirror */ true);
      return true;

    case 0xe0b7:
      innerStrokeStadium(ctx, x, y, w, h, px, /* mirror */ true);
      return true;

    // ----- Corner wedges (filled right triangles in each corner) ------------

    case 0xe0b8: // bottom-left filled corner ◣
      fillTriangle(ctx, x, y, x + w, y + h, x, y + h);
      return true;

    case 0xe0ba: // bottom-right filled corner ◢
      fillTriangle(ctx, x + w, y, x + w, y + h, x, y + h);
      return true;

    case 0xe0bc: // top-left filled corner ◤
      fillTriangle(ctx, x, y, x + w, y, x, y + h);
      return true;

    case 0xe0be: // top-right filled corner ◥
      fillTriangle(ctx, x, y, x + w, y, x + w, y + h);
      return true;

    // ----- Diagonal-line variants -------------------------------------------
    //
    // Ghostty defines these to be the same vector geometry as the
    // box-drawing diagonals U+2571 (╱) and U+2572 (╲); routing
    // through drawBoxOrBlock guarantees a powerline diagonal tiles
    // perfectly against an adjacent box-drawing diagonal.

    case 0xe0b9: // ╲, upper-left to lower-right
    case 0xe0bf: // ╲, upper-left to lower-right (same geometry as E0B9)
      return drawBoxOrBlock(ctx, 0x2572, x, y, w, h, color, px);

    case 0xe0bb: // ╱, upper-right to lower-left
    case 0xe0bd: // ╱, upper-right to lower-left (same geometry as E0BB)
      return drawBoxOrBlock(ctx, 0x2571, x, y, w, h, color, px);

    // ----- Vertical bisectors (Powerline Extra) -----------------------------

    case 0xe0d2: // ◄ filled wedge pointing right at midline
      fillBisector(ctx, x, y, w, h, px, /* mirror */ false);
      return true;

    case 0xe0d4: // ► filled wedge pointing left at midline
      fillBisector(ctx, x, y, w, h, px, /* mirror */ true);
      return true;

    default:
      return false;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function fillTriangle(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fill();
}

function strokeChevron(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineWidth: number
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

/**
 * Build the path of a "stadium" — a rectangle whose right side is
 * rounded into a half-stadium, with the rounded corners drawn as
 * cubic Beziers approximating quarter-circles (Kappa ≈ 0.5523).
 *
 * The radius is `min(w, h/2)`: equal to the half-height when the
 * cell is taller than wide (the rounded side is a full half-circle),
 * or to the cell width when the cell is wider than tall (the
 * "rounded" portion can't exceed the cell horizontally). Vertical
 * straight segment between the two rounded corners exists when
 * `h/2 > w`.
 *
 * Path is left open — the caller fills (closing the shape via the
 * implicit straight line back to the start) or strokes (leaving
 * the open path).
 */
function stadiumPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const r = Math.min(w, h / 2);
  const c = r * ARC_K;

  ctx.beginPath();
  ctx.moveTo(x, y);
  // Top-right rounded corner: (x, y) -> (x + r, y + r)
  ctx.bezierCurveTo(x + c, y, x + r, y + r - c, x + r, y + r);
  // Straight segment down the right side. Zero-length if h <= 2*r.
  ctx.lineTo(x + r, y + h - r);
  // Bottom-right rounded corner: (x + r, y + h - r) -> (x, y + h)
  ctx.bezierCurveTo(x + r, y + h - r + c, x + c, y + h, x, y + h);
}

function fillStadium(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  mirror: boolean
): void {
  if (mirror) {
    ctx.save();
    mirrorAroundCellCenter(ctx, x, w);
  }
  stadiumPath(ctx, x, y, w, h);
  ctx.closePath();
  ctx.fill();
  if (mirror) {
    ctx.restore();
  }
}

/**
 * Stroke the stadium path with an "inner stroke": the stroke lies
 * inside the filled region of the curve, not centered on it. Done
 * by clipping to the filled shape and stroking at 2× the desired
 * line width so the visible (un-clipped) inside half matches the
 * requested width.
 */
function innerStrokeStadium(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lineWidth: number,
  mirror: boolean
): void {
  if (mirror) {
    ctx.save();
    mirrorAroundCellCenter(ctx, x, w);
  }
  ctx.save();
  // Build the filled-shape clip first. closePath implicitly draws
  // the left edge back to the start.
  stadiumPath(ctx, x, y, w, h);
  ctx.closePath();
  ctx.clip();

  // Re-issue the stadium outline (without the implicit close) and
  // stroke double-wide; the half outside the clip is discarded.
  stadiumPath(ctx, x, y, w, h);
  ctx.lineWidth = lineWidth * 2;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
  if (mirror) {
    ctx.restore();
  }
}

/**
 * Filled vertical-bisector wedge. Two trapezoidal halves separated
 * by a `lightPx` horizontal gap at the midline; each half is a
 * triangle whose apex points to the cell's vertical center on
 * the right side.
 *
 * `mirror=true` flips horizontally for the right-facing E0D4 variant.
 */
function fillBisector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lightPx: number,
  mirror: boolean
): void {
  if (mirror) {
    ctx.save();
    mirrorAroundCellCenter(ctx, x, w);
  }
  const halfGap = lightPx / 2;
  const midTop = y + h / 2 - halfGap;
  const midBot = y + h / 2 + halfGap;

  // Top piece: trapezoid (0,0) → (w,0) → (w/2, mid-) → (0, mid-)
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w / 2, midTop);
  ctx.lineTo(x, midTop);
  ctx.closePath();
  ctx.fill();

  // Bottom piece: trapezoid (0,h) → (w,h) → (w/2, mid+) → (0, mid+)
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w / 2, midBot);
  ctx.lineTo(x, midBot);
  ctx.closePath();
  ctx.fill();

  if (mirror) {
    ctx.restore();
  }
}

/**
 * Reflect the canvas around the cell's vertical centerline (x + w/2).
 * Caller is responsible for `ctx.save()` before calling and
 * `ctx.restore()` after the drawing that should be mirrored — keeping
 * those out of this helper avoids allocating a closure for every
 * drawn cell, which matters on the render hot path.
 *
 * After this transform a point `(px, py)` in user code lands at
 * `(2*(x + w/2) - px, py) = (2x + w - px, py)` on screen.
 *
 * Used to derive E0B3 from E0B1, E0B6/E0B7 from E0B4/E0B5, and E0D4
 * from E0D2 — the same pattern Ghostty's powerline.zig uses via
 * `canvas.flipHorizontal()`.
 */
function mirrorAroundCellCenter(ctx: CanvasRenderingContext2D, x: number, w: number): void {
  ctx.translate(2 * x + w, 0);
  ctx.scale(-1, 1);
}
