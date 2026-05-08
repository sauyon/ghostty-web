/**
 * Box drawing line renderer (U+2500..U+257F).
 *
 * Covers four sub-families:
 *   - Orthogonal lines, corners, T-junctions, crosses, stubs, double-line
 *     variants — described by directional weights in the EDGES table and
 *     drawn by `drawEdges`.
 *   - Quarter-circle arcs (╭╮╯╰) — drawn as cubic Bezier curves so they
 *     join cleanly to neighboring straight cells.
 *   - Dashed/dotted horizontal & vertical lines — drawn with integer-pixel
 *     gap distribution so they tile cleanly across cells of any width.
 *   - Diagonals (╱╲╳) — drawn with sub-pixel overshoot so the diagonal
 *     reaches the cell corner exactly under anti-aliasing.
 *
 * Ports the algorithm from Ghostty native's `box.zig:linesChar`. The
 * junction-aware arm endpoints (`up_bottom`, `down_top`, `left_right`,
 * `right_left`) are what make weighted corners and T-junctions look
 * correct: a heavy crossbar fully covers a light arm, a double-line
 * corner forms a clean inner "L" instead of two crossing parallels, etc.
 */

import { D, H, L, N, heavyThickness } from './common';
import type { Weight } from './common';

interface Edges {
  l: Weight;
  r: Weight;
  u: Weight;
  d: Weight;
}

// Codepoint → directional weights for the orthogonal box-drawing glyphs.
// biome-ignore format: aligned table is more readable than reflowed
const EDGES = new Map<number, Edges>([
  [0x2500, { l: L, r: L, u: N, d: N }], // ─
  [0x2501, { l: H, r: H, u: N, d: N }], // ━
  [0x2502, { l: N, r: N, u: L, d: L }], // │
  [0x2503, { l: N, r: N, u: H, d: H }], // ┃
  [0x250c, { l: N, r: L, u: N, d: L }], // ┌
  [0x250d, { l: N, r: H, u: N, d: L }], // ┍
  [0x250e, { l: N, r: L, u: N, d: H }], // ┎
  [0x250f, { l: N, r: H, u: N, d: H }], // ┏
  [0x2510, { l: L, r: N, u: N, d: L }], // ┐
  [0x2511, { l: H, r: N, u: N, d: L }], // ┑
  [0x2512, { l: L, r: N, u: N, d: H }], // ┒
  [0x2513, { l: H, r: N, u: N, d: H }], // ┓
  [0x2514, { l: N, r: L, u: L, d: N }], // └
  [0x2515, { l: N, r: H, u: L, d: N }], // ┕
  [0x2516, { l: N, r: L, u: H, d: N }], // ┖
  [0x2517, { l: N, r: H, u: H, d: N }], // ┗
  [0x2518, { l: L, r: N, u: L, d: N }], // ┘
  [0x2519, { l: H, r: N, u: L, d: N }], // ┙
  [0x251a, { l: L, r: N, u: H, d: N }], // ┚
  [0x251b, { l: H, r: N, u: H, d: N }], // ┛
  [0x251c, { l: N, r: L, u: L, d: L }], // ├
  [0x251d, { l: N, r: H, u: L, d: L }], // ┝
  [0x251e, { l: N, r: L, u: H, d: L }], // ┞
  [0x251f, { l: N, r: L, u: L, d: H }], // ┟
  [0x2520, { l: N, r: L, u: H, d: H }], // ┠
  [0x2521, { l: N, r: H, u: H, d: L }], // ┡
  [0x2522, { l: N, r: H, u: L, d: H }], // ┢
  [0x2523, { l: N, r: H, u: H, d: H }], // ┣
  [0x2524, { l: L, r: N, u: L, d: L }], // ┤
  [0x2525, { l: H, r: N, u: L, d: L }], // ┥
  [0x2526, { l: L, r: N, u: H, d: L }], // ┦
  [0x2527, { l: L, r: N, u: L, d: H }], // ┧
  [0x2528, { l: L, r: N, u: H, d: H }], // ┨
  [0x2529, { l: H, r: N, u: H, d: L }], // ┩
  [0x252a, { l: H, r: N, u: L, d: H }], // ┪
  [0x252b, { l: H, r: N, u: H, d: H }], // ┫
  [0x252c, { l: L, r: L, u: N, d: L }], // ┬
  [0x252d, { l: H, r: L, u: N, d: L }], // ┭
  [0x252e, { l: L, r: H, u: N, d: L }], // ┮
  [0x252f, { l: H, r: H, u: N, d: L }], // ┯
  [0x2530, { l: L, r: L, u: N, d: H }], // ┰
  [0x2531, { l: H, r: L, u: N, d: H }], // ┱
  [0x2532, { l: L, r: H, u: N, d: H }], // ┲
  [0x2533, { l: H, r: H, u: N, d: H }], // ┳
  [0x2534, { l: L, r: L, u: L, d: N }], // ┴
  [0x2535, { l: H, r: L, u: L, d: N }], // ┵
  [0x2536, { l: L, r: H, u: L, d: N }], // ┶
  [0x2537, { l: H, r: H, u: L, d: N }], // ┷
  [0x2538, { l: L, r: L, u: H, d: N }], // ┸
  [0x2539, { l: H, r: L, u: H, d: N }], // ┹
  [0x253a, { l: L, r: H, u: H, d: N }], // ┺
  [0x253b, { l: H, r: H, u: H, d: N }], // ┻
  [0x253c, { l: L, r: L, u: L, d: L }], // ┼
  [0x253d, { l: H, r: L, u: L, d: L }], // ┽
  [0x253e, { l: L, r: H, u: L, d: L }], // ┾
  [0x253f, { l: H, r: H, u: L, d: L }], // ┿
  [0x2540, { l: L, r: L, u: H, d: L }], // ╀
  [0x2541, { l: L, r: L, u: L, d: H }], // ╁
  [0x2542, { l: L, r: L, u: H, d: H }], // ╂
  [0x2543, { l: H, r: L, u: H, d: L }], // ╃
  [0x2544, { l: L, r: H, u: H, d: L }], // ╄
  [0x2545, { l: H, r: L, u: L, d: H }], // ╅
  [0x2546, { l: L, r: H, u: L, d: H }], // ╆
  [0x2547, { l: H, r: H, u: H, d: L }], // ╇
  [0x2548, { l: H, r: H, u: L, d: H }], // ╈
  [0x2549, { l: H, r: L, u: H, d: H }], // ╉
  [0x254a, { l: L, r: H, u: H, d: H }], // ╊
  [0x254b, { l: H, r: H, u: H, d: H }], // ╋
  [0x2550, { l: D, r: D, u: N, d: N }], // ═
  [0x2551, { l: N, r: N, u: D, d: D }], // ║
  [0x2552, { l: N, r: D, u: N, d: L }], // ╒
  [0x2553, { l: N, r: L, u: N, d: D }], // ╓
  [0x2554, { l: N, r: D, u: N, d: D }], // ╔
  [0x2555, { l: D, r: N, u: N, d: L }], // ╕
  [0x2556, { l: L, r: N, u: N, d: D }], // ╖
  [0x2557, { l: D, r: N, u: N, d: D }], // ╗
  [0x2558, { l: N, r: D, u: L, d: N }], // ╘
  [0x2559, { l: N, r: L, u: D, d: N }], // ╙
  [0x255a, { l: N, r: D, u: D, d: N }], // ╚
  [0x255b, { l: D, r: N, u: L, d: N }], // ╛
  [0x255c, { l: L, r: N, u: D, d: N }], // ╜
  [0x255d, { l: D, r: N, u: D, d: N }], // ╝
  [0x255e, { l: N, r: D, u: L, d: L }], // ╞
  [0x255f, { l: N, r: L, u: D, d: D }], // ╟
  [0x2560, { l: N, r: D, u: D, d: D }], // ╠
  [0x2561, { l: D, r: N, u: L, d: L }], // ╡
  [0x2562, { l: L, r: N, u: D, d: D }], // ╢
  [0x2563, { l: D, r: N, u: D, d: D }], // ╣
  [0x2564, { l: D, r: D, u: N, d: L }], // ╤
  [0x2565, { l: L, r: L, u: N, d: D }], // ╥
  [0x2566, { l: D, r: D, u: N, d: D }], // ╦
  [0x2567, { l: D, r: D, u: L, d: N }], // ╧
  [0x2568, { l: L, r: L, u: D, d: N }], // ╨
  [0x2569, { l: D, r: D, u: D, d: N }], // ╩
  [0x256a, { l: D, r: D, u: L, d: L }], // ╪
  [0x256b, { l: L, r: L, u: D, d: D }], // ╫
  [0x256c, { l: D, r: D, u: D, d: D }], // ╬
  [0x2574, { l: L, r: N, u: N, d: N }], // ╴
  [0x2575, { l: N, r: N, u: L, d: N }], // ╵
  [0x2576, { l: N, r: L, u: N, d: N }], // ╶
  [0x2577, { l: N, r: N, u: N, d: L }], // ╷
  [0x2578, { l: H, r: N, u: N, d: N }], // ╸
  [0x2579, { l: N, r: N, u: H, d: N }], // ╹
  [0x257a, { l: N, r: H, u: N, d: N }], // ╺
  [0x257b, { l: N, r: N, u: N, d: H }], // ╻
  [0x257c, { l: L, r: H, u: N, d: N }], // ╼
  [0x257d, { l: N, r: N, u: L, d: H }], // ╽
  [0x257e, { l: H, r: L, u: N, d: N }], // ╾
  [0x257f, { l: N, r: N, u: H, d: L }], // ╿
]);

// Dashed lines: number of dashes per stroke, weight, and orientation.
interface Dashed {
  count: 2 | 3 | 4;
  weight: Weight;
  vertical: boolean;
}

// biome-ignore format: aligned table
const DASHED = new Map<number, Dashed>([
  [0x2504, { count: 3, weight: L, vertical: false }], // ┄
  [0x2505, { count: 3, weight: H, vertical: false }], // ┅
  [0x2506, { count: 3, weight: L, vertical: true }], // ┆
  [0x2507, { count: 3, weight: H, vertical: true }], // ┇
  [0x2508, { count: 4, weight: L, vertical: false }], // ┈
  [0x2509, { count: 4, weight: H, vertical: false }], // ┉
  [0x250a, { count: 4, weight: L, vertical: true }], // ┊
  [0x250b, { count: 4, weight: H, vertical: true }], // ┋
  [0x254c, { count: 2, weight: L, vertical: false }], // ╌
  [0x254d, { count: 2, weight: H, vertical: false }], // ╍
  [0x254e, { count: 2, weight: L, vertical: true }], // ╎
  [0x254f, { count: 2, weight: H, vertical: true }], // ╏
]);

// Quarter-circle arcs. Corner identifies which quadrant of the cell
// holds the arc, matching Ghostty's `Corner` enum.
type Corner = 'tl' | 'tr' | 'bl' | 'br';

const ARC = new Map<number, Corner>([
  // ╭ down and right: arc lives in the BOTTOM-RIGHT quadrant, connecting
  // a stroke going DOWN out of the cell to a stroke going RIGHT.
  [0x256d, 'br'],
  [0x256e, 'bl'], // ╮ down-left
  [0x256f, 'tl'], // ╯ up-left
  [0x2570, 'tr'], // ╰ up-right
]);

/**
 * Draw a U+2500..U+257F glyph into the cell at (x, y, w, h).
 * `lightPx` is the font-derived light stroke thickness in CSS pixels.
 * Returns true if the codepoint was handled.
 */
export function drawBoxLine(
  ctx: CanvasRenderingContext2D,
  cp: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  lightPx: number
): boolean {
  if (cp === 0x2571 || cp === 0x2572 || cp === 0x2573) {
    drawDiagonal(ctx, cp, x, y, w, h, color, lightPx);
    return true;
  }

  const arc = ARC.get(cp);
  if (arc !== undefined) {
    drawArc(ctx, arc, x, y, w, h, color, lightPx);
    return true;
  }

  const dash = DASHED.get(cp);
  if (dash !== undefined) {
    drawDashed(ctx, dash, x, y, w, h, color, lightPx);
    return true;
  }

  const e = EDGES.get(cp);
  if (e === undefined) return false;

  drawEdges(ctx, e, x, y, w, h, color, lightPx);
  return true;
}

// ----------------------------------------------------------------------------
// Orthogonal box drawing
//
// Ports Ghostty's `box.zig:linesChar` (lines 399-636). Each of the four
// arms (up/right/down/left) is drawn as one or two rectangles. The key
// detail is the junction-aware endpoint of each arm:
//
//   - `up_bottom` is how far DOWN from the cell top the up-arm extends.
//     It's the bottom of the up rectangle.
//   - `down_top` is how far DOWN the down-arm starts.
//   - `left_right` and `right_left` are the analogous values along x.
//
// These are computed so that:
//   - a heavy crossbar fully covers a light perpendicular arm at the join,
//   - a light arm stops at the top/left edge of the perpendicular crossbar
//     in symmetric junctions (so we don't double-paint the crossbar),
//   - in double-line corners, each parallel of the double stroke stops at
//     the inner edge of the orthogonal stroke, forming a clean inner "L".

function drawEdges(
  ctx: CanvasRenderingContext2D,
  e: Edges,
  ox: number,
  oy: number,
  w: number,
  h: number,
  color: string,
  lt: number
): void {
  const ht = heavyThickness(lt);

  // Horizontal stroke positions (y coordinates).
  const h_light_top = (h - lt) / 2;
  const h_light_bottom = h_light_top + lt;
  const h_heavy_top = (h - ht) / 2;
  const h_heavy_bottom = h_heavy_top + ht;
  const h_double_top = h_light_top - lt;
  const h_double_bottom = h_light_bottom + lt;

  // Vertical stroke positions (x coordinates).
  const v_light_left = (w - lt) / 2;
  const v_light_right = v_light_left + lt;
  const v_heavy_left = (w - ht) / 2;
  const v_heavy_right = v_heavy_left + ht;
  const v_double_left = v_light_left - lt;
  const v_double_right = v_light_right + lt;

  // Bottom of the up-arm.
  let up_bottom: number;
  if (e.l === H || e.r === H) {
    up_bottom = h_heavy_bottom;
  } else if (e.l !== e.r || e.d === e.u) {
    up_bottom = e.l === D || e.r === D ? h_double_bottom : h_light_bottom;
  } else if (e.l === N && e.r === N) {
    up_bottom = h_light_bottom;
  } else {
    up_bottom = h_light_top;
  }

  // Top of the down-arm.
  let down_top: number;
  if (e.l === H || e.r === H) {
    down_top = h_heavy_top;
  } else if (e.l !== e.r || e.u === e.d) {
    down_top = e.l === D || e.r === D ? h_double_top : h_light_top;
  } else if (e.l === N && e.r === N) {
    down_top = h_light_top;
  } else {
    down_top = h_light_bottom;
  }

  // Right edge of the left-arm.
  let left_right: number;
  if (e.u === H || e.d === H) {
    left_right = v_heavy_right;
  } else if (e.u !== e.d || e.l === e.r) {
    left_right = e.u === D || e.d === D ? v_double_right : v_light_right;
  } else if (e.u === N && e.d === N) {
    left_right = v_light_right;
  } else {
    left_right = v_light_left;
  }

  // Left edge of the right-arm.
  let right_left: number;
  if (e.u === H || e.d === H) {
    right_left = v_heavy_left;
  } else if (e.u !== e.d || e.r === e.l) {
    right_left = e.u === D || e.d === D ? v_double_left : v_light_left;
  } else if (e.u === N && e.d === N) {
    right_left = v_light_left;
  } else {
    right_left = v_light_right;
  }

  ctx.fillStyle = color;
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.fillRect(ox + x0, oy + y0, x1 - x0, y1 - y0);
  };

  // UP arm.
  switch (e.u) {
    case L:
      rect(v_light_left, 0, v_light_right, up_bottom);
      break;
    case H:
      rect(v_heavy_left, 0, v_heavy_right, up_bottom);
      break;
    case D: {
      const left_bottom = e.l === D ? h_light_top : up_bottom;
      const right_bottom = e.r === D ? h_light_top : up_bottom;
      rect(v_double_left, 0, v_light_left, left_bottom);
      rect(v_light_right, 0, v_double_right, right_bottom);
      break;
    }
  }

  // RIGHT arm.
  switch (e.r) {
    case L:
      rect(right_left, h_light_top, w, h_light_bottom);
      break;
    case H:
      rect(right_left, h_heavy_top, w, h_heavy_bottom);
      break;
    case D: {
      const top_left = e.u === D ? v_light_right : right_left;
      const bottom_left = e.d === D ? v_light_right : right_left;
      rect(top_left, h_double_top, w, h_light_top);
      rect(bottom_left, h_light_bottom, w, h_double_bottom);
      break;
    }
  }

  // DOWN arm.
  switch (e.d) {
    case L:
      rect(v_light_left, down_top, v_light_right, h);
      break;
    case H:
      rect(v_heavy_left, down_top, v_heavy_right, h);
      break;
    case D: {
      const left_top = e.l === D ? h_light_bottom : down_top;
      const right_top = e.r === D ? h_light_bottom : down_top;
      rect(v_double_left, left_top, v_light_left, h);
      rect(v_light_right, right_top, v_double_right, h);
      break;
    }
  }

  // LEFT arm.
  switch (e.l) {
    case L:
      rect(0, h_light_top, left_right, h_light_bottom);
      break;
    case H:
      rect(0, h_heavy_top, left_right, h_heavy_bottom);
      break;
    case D: {
      const top_right = e.u === D ? v_light_left : left_right;
      const bottom_right = e.d === D ? v_light_left : left_right;
      rect(0, h_double_top, top_right, h_light_top);
      rect(0, h_light_bottom, bottom_right, h_double_bottom);
      break;
    }
  }
}

// ----------------------------------------------------------------------------
// Arcs (╭╮╯╰)
//
// Ports Ghostty's arc drawing (box.zig:691-777). The arc is a cubic
// Bezier with control fraction 0.25 inside a quadrant of the cell. The
// radius reaches the cell-edge midpoint (r = min(w,h)/2), so the arc
// joins flush to a straight `─` or `│` in the next cell.

function drawArc(
  ctx: CanvasRenderingContext2D,
  corner: Corner,
  ox: number,
  oy: number,
  w: number,
  h: number,
  color: string,
  lt: number
): void {
  const center_x = (w - lt) / 2 + lt / 2;
  const center_y = (h - lt) / 2 + lt / 2;
  const r = Math.min(w, h) / 2;
  const s = 0.25; // control point fraction toward the corner

  ctx.save();
  ctx.translate(ox, oy);
  ctx.strokeStyle = color;
  ctx.lineWidth = lt;
  ctx.lineCap = 'butt';
  ctx.beginPath();

  switch (corner) {
    case 'tl':
      ctx.moveTo(center_x, 0);
      ctx.lineTo(center_x, center_y - r);
      ctx.bezierCurveTo(
        center_x,
        center_y - s * r,
        center_x - s * r,
        center_y,
        center_x - r,
        center_y
      );
      ctx.lineTo(0, center_y);
      break;
    case 'tr':
      ctx.moveTo(center_x, 0);
      ctx.lineTo(center_x, center_y - r);
      ctx.bezierCurveTo(
        center_x,
        center_y - s * r,
        center_x + s * r,
        center_y,
        center_x + r,
        center_y
      );
      ctx.lineTo(w, center_y);
      break;
    case 'bl':
      ctx.moveTo(center_x, h);
      ctx.lineTo(center_x, center_y + r);
      ctx.bezierCurveTo(
        center_x,
        center_y + s * r,
        center_x - s * r,
        center_y,
        center_x - r,
        center_y
      );
      ctx.lineTo(0, center_y);
      break;
    case 'br':
      ctx.moveTo(center_x, h);
      ctx.lineTo(center_x, center_y + r);
      ctx.bezierCurveTo(
        center_x,
        center_y + s * r,
        center_x + s * r,
        center_y,
        center_x + r,
        center_y
      );
      ctx.lineTo(w, center_y);
      break;
  }

  ctx.stroke();
  ctx.restore();
}

// ----------------------------------------------------------------------------
// Dashed lines
//
// Ports Ghostty's `dashHorizontal`/`dashVertical` (box.zig:779-895). The
// dashes are sized so that:
//   - half-sized gaps sit on either side of the run, so adjacent dashed
//     cells tile into one continuous dashed line,
//   - leftover sub-pixels are distributed to dash widths (not gaps), so
//     irregularity hides in dash length rather than gap spacing.

function drawDashed(
  ctx: CanvasRenderingContext2D,
  dash: Dashed,
  ox: number,
  oy: number,
  w: number,
  h: number,
  color: string,
  lt: number
): void {
  ctx.fillStyle = color;
  const t = dash.weight === H ? heavyThickness(lt) : lt;
  const count = dash.count;
  // Use light thickness as the desired gap so dashes look balanced
  // against the stroke weight of neighboring lines.
  const desired_gap = lt;

  if (dash.vertical) {
    drawDashRun(ctx, ox + (w - t) / 2, oy, t, h, count, desired_gap, true);
  } else {
    drawDashRun(ctx, ox, oy + (h - t) / 2, w, t, count, desired_gap, false);
  }
}

function drawDashRun(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
  desired_gap: number,
  vertical: boolean
): void {
  const span = vertical ? h : w;

  // Below this size the dashes degenerate to nothing — fall back to a
  // solid line so the run still tiles with its neighbors.
  if (span < count + count) {
    ctx.fillRect(x, y, w, h);
    return;
  }

  // Cap the gap so dashes never shrink below half the available run.
  const gap_width = Math.min(desired_gap, Math.floor(span / (2 * count)));
  const total_gap = gap_width * count; // half-gaps on each side + gaps between
  const total_dash = Math.floor(span - total_gap);
  const dash_width = Math.floor(total_dash / count);
  let extra = total_dash - dash_width * count;

  // Start half a gap in so the run is centered.
  let pos = Math.floor(gap_width / 2);
  for (let i = 0; i < count; i++) {
    let len = dash_width;
    if (extra > 0) {
      extra -= 1;
      len += 1;
    }
    if (vertical) {
      ctx.fillRect(x, y + pos, w, len);
    } else {
      ctx.fillRect(x + pos, y, len, h);
    }
    pos += len + gap_width;
  }
}

// ----------------------------------------------------------------------------
// Diagonals
//
// Ports Ghostty's diagonal-line code (box.zig:638-688). The line
// overshoots each corner by a fraction of a pixel along the slope so
// that anti-aliasing covers the cell corner exactly and adjacent
// diagonals tile without 1-pixel gaps at the join.

function drawDiagonal(
  ctx: CanvasRenderingContext2D,
  cp: number,
  ox: number,
  oy: number,
  w: number,
  h: number,
  color: string,
  lt: number
): void {
  const slope_x = Math.min(1, w / h);
  const slope_y = Math.min(1, h / w);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.strokeStyle = color;
  ctx.lineWidth = lt;
  ctx.lineCap = 'butt';
  ctx.beginPath();

  if (cp === 0x2571 || cp === 0x2573) {
    // ╱ ╳: forward slash (top-right to bottom-left, with overshoot).
    ctx.moveTo(w + 0.5 * slope_x, -0.5 * slope_y);
    ctx.lineTo(-0.5 * slope_x, h + 0.5 * slope_y);
  }
  if (cp === 0x2572 || cp === 0x2573) {
    // ╲ ╳: back slash (top-left to bottom-right, with overshoot).
    ctx.moveTo(-0.5 * slope_x, -0.5 * slope_y);
    ctx.lineTo(w + 0.5 * slope_x, h + 0.5 * slope_y);
  }

  ctx.stroke();
  ctx.restore();
}
