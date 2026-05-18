/**
 * Tests for the Powerline glyph renderer.
 *
 * Same approach as box-drawing.test.ts: happy-dom's CanvasRenderingContext2D
 * doesn't rasterize, so we test against a recording stub that captures
 * every drawing call as a structured op. This catches:
 *   - coverage gaps (every codepoint isPowerline accepts should produce
 *     at least one fill or stroke),
 *   - dispatch correctness (codepoints outside the supported set must
 *     not be claimed),
 *   - structural correctness on a few hand-picked glyphs (chevron
 *     thickness, stadium curvature, mirror-pair symmetry, bisector
 *     gap width).
 */

import { describe, expect, test } from 'bun:test';
import { type RecordingOp, makeRecordingCtx } from './canvas-recorder';
import { drawPowerline, isPowerline } from './powerline';

// Standard cell for tests: 10×20 (tall and narrow, typical of a
// terminal) with a 1px light stroke.
const CW = 10;
const CH = 20;
const LT = 1;
const COLOR = '#fff';

function draw(cp: number, w = CW, h = CH, lightPx = LT) {
  const ctx = makeRecordingCtx();
  const handled = drawPowerline(ctx, cp, 0, 0, w, h, COLOR, lightPx);
  return { ctx, handled };
}

// All Powerline glyphs we claim to render.
const SUPPORTED: number[] = [...Array.from({ length: 16 }, (_, i) => 0xe0b0 + i), 0xe0d2, 0xe0d4];

/**
 * Locate the start of the horizontal-mirror envelope: a save followed
 * immediately by translate + scale(-1, 1). Returns the index of the
 * save, or -1 if no such envelope is present. drawPowerline sets
 * fillStyle/strokeStyle before dispatching, so the envelope rarely
 * sits at index 0.
 */
function mirrorIndex(ops: RecordingOp[]): number {
  for (let i = 0; i < ops.length - 2; i++) {
    const a = ops[i];
    const b = ops[i + 1];
    const c = ops[i + 2];
    if (
      a.kind === 'save' &&
      b.kind === 'translate' &&
      c.kind === 'scale' &&
      c.x === -1 &&
      c.y === 1
    ) {
      return i;
    }
  }
  return -1;
}

// ----------------------------------------------------------------------------
// isPowerline membership
// ----------------------------------------------------------------------------

describe('isPowerline', () => {
  test('accepts the full Powerline Symbols block U+E0B0..U+E0BF', () => {
    for (let cp = 0xe0b0; cp <= 0xe0bf; cp++) {
      expect(isPowerline(cp)).toBe(true);
    }
  });

  test('accepts the two Powerline-Extra bisector glyphs U+E0D2, U+E0D4', () => {
    expect(isPowerline(0xe0d2)).toBe(true);
    expect(isPowerline(0xe0d4)).toBe(true);
  });

  test('rejects neighbors and unrelated PUA codepoints', () => {
    // Just outside the Powerline block.
    expect(isPowerline(0xe0af)).toBe(false);
    expect(isPowerline(0xe0c0)).toBe(false);
    // Adjacent to the bisector pair.
    expect(isPowerline(0xe0d1)).toBe(false);
    expect(isPowerline(0xe0d3)).toBe(false);
    expect(isPowerline(0xe0d5)).toBe(false);
    // Plain ASCII and box-drawing must not be claimed.
    expect(isPowerline(0x20)).toBe(false);
    expect(isPowerline(0x2500)).toBe(false);
    expect(isPowerline(0x2588)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Coverage: every supported codepoint must produce at least one
// fill or stroke op, and report `handled = true`.
// ----------------------------------------------------------------------------

describe('drawPowerline coverage', () => {
  for (const cp of SUPPORTED) {
    test(`U+${cp.toString(16).toUpperCase().padStart(4, '0')} renders`, () => {
      const { ctx, handled } = draw(cp);
      expect(handled).toBe(true);
      const visibleOps = ctx.ops.filter((o) => o.kind === 'fill' || o.kind === 'stroke');
      expect(visibleOps.length).toBeGreaterThan(0);
    });
  }

  test('unsupported codepoints in the powerline-ish range return false', () => {
    // E0C0..E0D1 and E0D3 / E0D5 etc. are not handled by Ghostty.
    // We mainly care that the function doesn't crash and reports
    // `handled=false` so the caller falls back to the font.
    for (const cp of [0xe0c0, 0xe0c5, 0xe0d1, 0xe0d3, 0xe0d5]) {
      const { handled } = draw(cp);
      expect(handled).toBe(false);
    }
  });

  test('returns false for zero-area cells without drawing anything', () => {
    {
      const { ctx, handled } = draw(0xe0b0, 0, CH);
      expect(handled).toBe(false);
      expect(ctx.ops).toEqual([]);
    }
    {
      const { ctx, handled } = draw(0xe0b0, CW, 0);
      expect(handled).toBe(false);
      expect(ctx.ops).toEqual([]);
    }
  });
});

// ----------------------------------------------------------------------------
// Structural checks on hand-picked glyphs.
// ----------------------------------------------------------------------------

describe('drawPowerline structure', () => {
  test('E0B0 draws a single right-pointing filled triangle', () => {
    const { ctx } = draw(0xe0b0);
    // moveTo (0,0) -> lineTo (w, h/2) -> lineTo (0, h) -> closePath -> fill
    const path = ctx.ops.filter(
      (o) =>
        o.kind === 'moveTo' || o.kind === 'lineTo' || o.kind === 'closePath' || o.kind === 'fill'
    );
    expect(path).toEqual([
      { kind: 'moveTo', x: 0, y: 0 },
      { kind: 'lineTo', x: CW, y: CH / 2 },
      { kind: 'lineTo', x: 0, y: CH },
      { kind: 'closePath' },
      { kind: 'fill' },
    ]);
    // No stroke for a hard divider.
    expect(ctx.ops.some((o) => o.kind === 'stroke')).toBe(false);
  });

  test('E0B1 strokes a thin chevron at lightPx', () => {
    const { ctx } = draw(0xe0b1, CW, CH, 2);
    // Path: moveTo, lineTo, lineTo, stroke (no closePath, no fill)
    const path = ctx.ops.filter(
      (o) => o.kind === 'moveTo' || o.kind === 'lineTo' || o.kind === 'stroke'
    );
    expect(path).toEqual([
      { kind: 'moveTo', x: 0, y: 0 },
      { kind: 'lineTo', x: CW, y: CH / 2 },
      { kind: 'lineTo', x: 0, y: CH },
      { kind: 'stroke' },
    ]);
    // lineWidth must be set to the requested 2 px.
    const widths = ctx.ops.flatMap((o) => (o.kind === 'lineWidth' ? [o.v] : []));
    expect(widths[widths.length - 1]).toBe(2);
    // Soft chevrons should not get filled.
    expect(ctx.ops.some((o) => o.kind === 'fill')).toBe(false);
  });

  test('E0B3 is the horizontal mirror of E0B1 (translate + scale(-1, 1))', () => {
    const { ctx } = draw(0xe0b3);
    // The mirror envelope is the FIRST save (drawPowerline sets
    // fillStyle/strokeStyle before the switch, so those come first).
    const mi = mirrorIndex(ctx.ops);
    expect(mi).toBeGreaterThanOrEqual(0);
    // The transform applied: translate(0 + CW, 0) + scale(-1, 1).
    expect(ctx.ops[mi + 1]).toEqual({ kind: 'translate', x: CW, y: 0 });
    expect(ctx.ops[mi + 2]).toEqual({ kind: 'scale', x: -1, y: 1 });
    // Outermost restore must be the last op.
    expect(ctx.ops[ctx.ops.length - 1]).toEqual({ kind: 'restore' });
    // Inside the mirror, the path coordinates are the un-flipped E0B1
    // shape — checking moveTo(0, 0) and lineTo(w, h/2) confirms it.
    const path = ctx.ops.filter((o) => o.kind === 'moveTo' || o.kind === 'lineTo');
    expect(path[0]).toEqual({ kind: 'moveTo', x: 0, y: 0 });
    expect(path[1]).toEqual({ kind: 'lineTo', x: CW, y: CH / 2 });
  });

  test('E0B4 (filled stadium) uses Bezier corners with the standard arc-K factor', () => {
    const w = 10;
    const h = 40; // h/2 = 20 > w, so r = min(w, h/2) = w = 10
    const { ctx } = draw(0xe0b4, w, h);

    const moves = ctx.ops.filter((o) => o.kind === 'moveTo');
    const beziers = ctx.ops.filter((o) => o.kind === 'bezierCurveTo');
    const lines = ctx.ops.filter((o) => o.kind === 'lineTo');

    // Path shape: moveTo + 2 bezierCurveTo + 1 lineTo (the straight
    // segment between the two rounded corners, present because h > 2w).
    expect(moves.length).toBe(1);
    expect(beziers.length).toBe(2);
    expect(lines.length).toBe(1);

    // Start at top-left.
    expect(moves[0]).toEqual({ kind: 'moveTo', x: 0, y: 0 });

    // Top-right Bezier: ends at (r, r) = (10, 10) with control points
    // (r*K, 0) and (r, r - r*K). K = (sqrt(2)-1) * 4/3.
    const K = (Math.SQRT2 - 1) * (4 / 3);
    const b0 = beziers[0] as Extract<RecordingOp, { kind: 'bezierCurveTo' }>;
    expect(b0.cp1x).toBeCloseTo(10 * K, 10);
    expect(b0.cp1y).toBe(0);
    expect(b0.cp2x).toBe(10);
    expect(b0.cp2y).toBeCloseTo(10 - 10 * K, 10);
    expect(b0.x).toBe(10);
    expect(b0.y).toBe(10);

    // Straight segment down the right side from (r, r) to (r, h - r).
    expect(lines[0]).toEqual({ kind: 'lineTo', x: 10, y: 30 });

    // closePath + fill complete the shape.
    expect(ctx.ops.some((o) => o.kind === 'closePath')).toBe(true);
    expect(ctx.ops.some((o) => o.kind === 'fill')).toBe(true);
    expect(ctx.ops.some((o) => o.kind === 'stroke')).toBe(false);
  });

  test('E0B5 (inner-stroke stadium) clips then strokes at 2× lightPx', () => {
    const { ctx } = draw(0xe0b5, CW, CH, 2);

    // The implementation:
    //   - save
    //   - build stadium path + closePath + clip
    //   - re-issue stadium path  (left OPEN — see assertion below)
    //   - stroke at 2× lightPx
    //   - restore
    // We don't need to pin the exact op sequence — just the shape.
    expect(ctx.ops.some((o) => o.kind === 'clip')).toBe(true);
    expect(ctx.ops.some((o) => o.kind === 'stroke')).toBe(true);
    // Outline-only: no fill.
    expect(ctx.ops.some((o) => o.kind === 'fill')).toBe(false);

    // The doubled line width is 2 * 2 = 4.
    const widths = ctx.ops.flatMap((o) => (o.kind === 'lineWidth' ? [o.v] : []));
    expect(widths[widths.length - 1]).toBe(4);

    // Properly paired save/restore.
    const saves = ctx.ops.filter((o) => o.kind === 'save').length;
    const restores = ctx.ops.filter((o) => o.kind === 'restore').length;
    expect(saves).toBe(restores);

    // Stroke path must be OPEN. Ghostty's innerStrokePath builds a
    // closed mask but strokes the original open path; we follow the
    // same shape with exactly one closePath (the one used to seal
    // the clip region) and no second close before the stroke. A
    // second closePath would draw the missing left edge of the
    // stadium — visually wrong, but otherwise silent.
    const closes = ctx.ops.filter((o) => o.kind === 'closePath').length;
    expect(closes).toBe(1);
  });

  test('E0D2 fills two trapezoidal halves separated by a lightPx gap', () => {
    const lightPx = 3;
    const { ctx } = draw(0xe0d2, CW, CH, lightPx);

    // Two beginPath/closePath/fill cycles for the two halves.
    const fills = ctx.ops.filter((o) => o.kind === 'fill');
    const closes = ctx.ops.filter((o) => o.kind === 'closePath');
    expect(fills.length).toBe(2);
    expect(closes.length).toBe(2);

    // Each half's flat edge sits at h/2 ± lightPx/2; check the
    // y-coordinates that appear in the path.
    const ys = ctx.ops.flatMap((o) => (o.kind === 'moveTo' || o.kind === 'lineTo' ? [o.y] : []));
    const midTop = CH / 2 - lightPx / 2;
    const midBot = CH / 2 + lightPx / 2;
    expect(ys).toContain(midTop);
    expect(ys).toContain(midBot);
    // The gap is exactly lightPx.
    expect(midBot - midTop).toBeCloseTo(lightPx, 10);
  });

  test('E0D4 wraps E0D2 in a mirror block', () => {
    const { ctx } = draw(0xe0d4);
    expect(mirrorIndex(ctx.ops)).toBeGreaterThanOrEqual(0);
    expect(ctx.ops[ctx.ops.length - 1]).toEqual({ kind: 'restore' });
    // Two fills, same as E0D2.
    expect(ctx.ops.filter((o) => o.kind === 'fill').length).toBe(2);
  });

  test('E0B9 and E0BF delegate to U+2572 (╲) via drawBoxOrBlock', () => {
    // Without depending on box-drawing's exact op shape, we can
    // confirm the call produced output and that both aliases produce
    // the same op sequence.
    const a = draw(0xe0b9);
    const b = draw(0xe0bf);
    expect(a.handled).toBe(true);
    expect(b.handled).toBe(true);
    // Op streams must match — these glyphs are defined as identical.
    expect(b.ctx.ops).toEqual(a.ctx.ops);
  });

  test('E0BB and E0BD delegate to U+2571 (╱) via drawBoxOrBlock', () => {
    const a = draw(0xe0bb);
    const b = draw(0xe0bd);
    expect(a.handled).toBe(true);
    expect(b.handled).toBe(true);
    expect(b.ctx.ops).toEqual(a.ctx.ops);
  });

  test('the / diagonals (E0BB/E0BD) differ from the \\ diagonals (E0B9/E0BF)', () => {
    const slash = draw(0xe0bb);
    const backslash = draw(0xe0b9);
    expect(slash.ctx.ops).not.toEqual(backslash.ctx.ops);
  });
});

// ----------------------------------------------------------------------------
// Mirror pairs: E0B6 mirrors E0B4, E0B7 mirrors E0B5. The mirrored
// version must produce the un-mirrored op sequence wrapped in
// save / translate / scale(-1,1) / ... / restore.
// ----------------------------------------------------------------------------

describe('mirror pairs', () => {
  function stripMirrorEnvelope(ops: RecordingOp[]): RecordingOp[] {
    const i = mirrorIndex(ops);
    if (i < 0) return ops;
    if (ops[ops.length - 1].kind !== 'restore') return ops;
    // Strip the [save, translate, scale(-1,1)] triple AND the matching
    // outermost restore at the tail.
    return [...ops.slice(0, i), ...ops.slice(i + 3, ops.length - 1)];
  }

  test('E0B6 inner ops match E0B4 ops', () => {
    const filled = draw(0xe0b4);
    const mirrored = draw(0xe0b6);
    expect(stripMirrorEnvelope(mirrored.ctx.ops)).toEqual(filled.ctx.ops);
  });

  test('E0B7 inner ops match E0B5 ops', () => {
    const stroked = draw(0xe0b5);
    const mirrored = draw(0xe0b7);
    expect(stripMirrorEnvelope(mirrored.ctx.ops)).toEqual(stroked.ctx.ops);
  });
});
