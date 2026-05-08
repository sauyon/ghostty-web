/**
 * Block element renderer (U+2580..U+259F).
 *
 * Ports the structure of Ghostty's `block.zig`: named fraction constants
 * (`block.zig:19-28`), a generic `block(alignment, wFrac, hFrac)` helper
 * (`block.zig:111-152`), a `quadrant({tl, tr, bl, br})` helper for the
 * multi-corner combinations (`block.zig:168-177`), and a shade helper
 * for ░▒▓ that maps to the same alpha levels Ghostty bakes into its
 * sprite atlas (`common.zig:42-51`: 0x40 / 0x80 / 0xc0 = 0.251 / 0.502
 * / 0.753).
 */

// Named fractions, matching block.zig:19-28.
const ONE_EIGHTH = 1 / 8;
const ONE_QUARTER = 1 / 4;
const THREE_EIGHTHS = 3 / 8;
const HALF = 1 / 2;
const FIVE_EIGHTHS = 5 / 8;
const THREE_QUARTERS = 3 / 4;
const SEVEN_EIGHTHS = 7 / 8;

/**
 * Where in the cell to anchor a partial-cell `block`.
 *   - `'upper'`: full width, anchored to the cell top.
 *   - `'lower'`: full width, anchored to the cell bottom.
 *   - `'left'`:  full height, anchored to the cell left.
 *   - `'right'`: full height, anchored to the cell right.
 *
 * Mirrors Ghostty's `Alignment` named constants (`common.zig:92-95`).
 */
type Alignment = 'upper' | 'lower' | 'left' | 'right';

interface Quads {
  tl?: boolean;
  tr?: boolean;
  bl?: boolean;
  br?: boolean;
}

/**
 * Fill a fractional sub-rectangle of the cell, anchored per `alignment`.
 * Sizes are given as fractions of the cell so the same call shape works
 * for halves, eighths, and full-cell rendering.
 */
function block(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cw: number,
  ch: number,
  color: string,
  alignment: Alignment,
  wFrac: number,
  hFrac: number
): void {
  const w = cw * wFrac;
  const h = ch * hFrac;
  let dx = 0;
  let dy = 0;
  switch (alignment) {
    case 'upper':
      dx = (cw - w) / 2;
      dy = 0;
      break;
    case 'lower':
      dx = (cw - w) / 2;
      dy = ch - h;
      break;
    case 'left':
      dx = 0;
      dy = (ch - h) / 2;
      break;
    case 'right':
      dx = cw - w;
      dy = (ch - h) / 2;
      break;
  }
  ctx.fillStyle = color;
  ctx.fillRect(ox + dx, oy + dy, w, h);
}

/**
 * Fill any subset of the cell's four 2x2 quadrants. Ports Ghostty's
 * `quadrant` (`block.zig:168-177`) for the ▖▗▘▙▚▛▜▝▞▟ family.
 */
function quadrant(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  q: Quads
): void {
  ctx.fillStyle = color;
  const hw = w / 2;
  const hh = h / 2;
  if (q.tl) ctx.fillRect(x, y, hw, hh);
  if (q.tr) ctx.fillRect(x + hw, y, hw, hh);
  if (q.bl) ctx.fillRect(x, y + hh, hw, hh);
  if (q.br) ctx.fillRect(x + hw, y + hh, hw, hh);
}

/**
 * Fill the entire cell at a fractional opacity. Used for ░▒▓.
 */
function fullShade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number
): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Draw a U+2580..U+259F glyph into the cell at (x, y, w, h).
 * Returns true if the codepoint was handled.
 */
export function drawBlockElement(
  ctx: CanvasRenderingContext2D,
  cp: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): boolean {
  switch (cp) {
    // ▀▄▌▐ — halves.
    case 0x2580: // ▀ upper half
      block(ctx, x, y, w, h, color, 'upper', 1, HALF);
      return true;
    case 0x2584: // ▄ lower half
      block(ctx, x, y, w, h, color, 'lower', 1, HALF);
      return true;
    case 0x258c: // ▌ left half
      block(ctx, x, y, w, h, color, 'left', HALF, 1);
      return true;
    case 0x2590: // ▐ right half
      block(ctx, x, y, w, h, color, 'right', HALF, 1);
      return true;

    // ▔▕ — top and right one-eighth strokes.
    case 0x2594: // ▔ upper 1/8
      block(ctx, x, y, w, h, color, 'upper', 1, ONE_EIGHTH);
      return true;
    case 0x2595: // ▕ right 1/8
      block(ctx, x, y, w, h, color, 'right', ONE_EIGHTH, 1);
      return true;

    // ▁▂▃▅▆▇ — lower-eighths family. Each fills the bottom n/8 of the cell.
    case 0x2581: // ▁ lower 1/8
      block(ctx, x, y, w, h, color, 'lower', 1, ONE_EIGHTH);
      return true;
    case 0x2582: // ▂ lower 2/8
      block(ctx, x, y, w, h, color, 'lower', 1, ONE_QUARTER);
      return true;
    case 0x2583: // ▃ lower 3/8
      block(ctx, x, y, w, h, color, 'lower', 1, THREE_EIGHTHS);
      return true;
    case 0x2585: // ▅ lower 5/8
      block(ctx, x, y, w, h, color, 'lower', 1, FIVE_EIGHTHS);
      return true;
    case 0x2586: // ▆ lower 6/8
      block(ctx, x, y, w, h, color, 'lower', 1, THREE_QUARTERS);
      return true;
    case 0x2587: // ▇ lower 7/8
      block(ctx, x, y, w, h, color, 'lower', 1, SEVEN_EIGHTHS);
      return true;

    // █ full block.
    case 0x2588:
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      return true;

    // ▉▊▋▍▎▏ — left-eighths family. Each fills the left n/8 of the cell.
    case 0x2589: // ▉ left 7/8
      block(ctx, x, y, w, h, color, 'left', SEVEN_EIGHTHS, 1);
      return true;
    case 0x258a: // ▊ left 6/8
      block(ctx, x, y, w, h, color, 'left', THREE_QUARTERS, 1);
      return true;
    case 0x258b: // ▋ left 5/8
      block(ctx, x, y, w, h, color, 'left', FIVE_EIGHTHS, 1);
      return true;
    case 0x258d: // ▍ left 3/8
      block(ctx, x, y, w, h, color, 'left', THREE_EIGHTHS, 1);
      return true;
    case 0x258e: // ▎ left 2/8
      block(ctx, x, y, w, h, color, 'left', ONE_QUARTER, 1);
      return true;
    case 0x258f: // ▏ left 1/8
      block(ctx, x, y, w, h, color, 'left', ONE_EIGHTH, 1);
      return true;

    // ░▒▓ — shades.
    case 0x2591: // ░ light shade
      fullShade(ctx, x, y, w, h, color, 0.25);
      return true;
    case 0x2592: // ▒ medium shade
      fullShade(ctx, x, y, w, h, color, 0.5);
      return true;
    case 0x2593: // ▓ dark shade
      fullShade(ctx, x, y, w, h, color, 0.75);
      return true;

    // ▖▗▘▝ — single-quadrant blocks.
    case 0x2596: // ▖ lower-left
      quadrant(ctx, x, y, w, h, color, { bl: true });
      return true;
    case 0x2597: // ▗ lower-right
      quadrant(ctx, x, y, w, h, color, { br: true });
      return true;
    case 0x2598: // ▘ upper-left
      quadrant(ctx, x, y, w, h, color, { tl: true });
      return true;
    case 0x259d: // ▝ upper-right
      quadrant(ctx, x, y, w, h, color, { tr: true });
      return true;

    // ▙▚▛▜▞▟ — multi-quadrant combinations.
    case 0x2599: // ▙
      quadrant(ctx, x, y, w, h, color, { tl: true, bl: true, br: true });
      return true;
    case 0x259a: // ▚
      quadrant(ctx, x, y, w, h, color, { tl: true, br: true });
      return true;
    case 0x259b: // ▛
      quadrant(ctx, x, y, w, h, color, { tl: true, tr: true, bl: true });
      return true;
    case 0x259c: // ▜
      quadrant(ctx, x, y, w, h, color, { tl: true, tr: true, br: true });
      return true;
    case 0x259e: // ▞
      quadrant(ctx, x, y, w, h, color, { tr: true, bl: true });
      return true;
    case 0x259f: // ▟
      quadrant(ctx, x, y, w, h, color, { tr: true, bl: true, br: true });
      return true;
  }
  return false;
}
