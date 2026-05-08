/**
 * Box-drawing and Block-element renderer.
 *
 * Glyphs in U+2500..U+259F (box drawing + block elements) are designed to
 * tile seamlessly across cells. Letting the font render them is fragile:
 *   - The font's advance width may not match our cell width exactly,
 *     leaving gaps (or overlaps) between adjacent box-drawing chars.
 *   - The font's chosen ascent/descent for these glyphs rarely matches
 *     the cell height we need for descender-safe text rendering, so
 *     vertical lines and full blocks leave gaps between rows.
 *   - Different fonts encode these glyphs with different proportions, so
 *     visual consistency is poor.
 *
 * Drawing them as canvas paths sized to the cell is the standard fix —
 * Alacritty, kitty, wezterm, Ghostty native, and Windows Terminal all do
 * this. It keeps the cell-height choice decoupled from the font's
 * box-drawing glyph design.
 */

import { drawBlockElement } from './blocks';
import { drawBoxLine } from './lines';

/**
 * Returns true if the codepoint is a box-drawing or block-element glyph
 * that we render directly. Caller should skip the font path in that case.
 */
export function isBoxOrBlock(codepoint: number): boolean {
  return codepoint >= 0x2500 && codepoint <= 0x259f;
}

/**
 * Render a box-drawing or block-element glyph into the cell at (x, y, w, h).
 * `color` is the css color string used for the foreground stroke/fill.
 * Returns true if the glyph was handled; false if the caller should fall
 * back to font rendering.
 */
export function drawBoxOrBlock(
  ctx: CanvasRenderingContext2D,
  codepoint: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): boolean {
  if (codepoint >= 0x2580 && codepoint <= 0x259f) {
    return drawBlockElement(ctx, codepoint, x, y, w, h, color);
  }
  if (codepoint >= 0x2500 && codepoint <= 0x257f) {
    return drawBoxLine(ctx, codepoint, x, y, w, h, color);
  }
  return false;
}
