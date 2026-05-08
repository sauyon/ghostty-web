/**
 * Tests for procedural box-drawing and block-element rendering.
 *
 * happy-dom's CanvasRenderingContext2D doesn't actually rasterize, so
 * we test against a recording stub that captures every drawing call as
 * a structured op. This catches:
 *   - coverage gaps (every codepoint in U+2500..U+259F should produce
 *     at least one fillRect or stroke),
 *   - regressions in branch logic (the recorded op sequence should
 *     stay stable across refactors),
 *   - junction-aware endpoint correctness (we hand-check a handful of
 *     known-tricky glyphs against expected coordinates).
 */

import { describe, expect, test } from 'bun:test';
import { drawBoxOrBlock, isBoxOrBlock } from './box-drawing';

type Op =
  | { kind: 'fillStyle'; v: string }
  | { kind: 'strokeStyle'; v: string }
  | { kind: 'lineWidth'; v: number }
  | { kind: 'lineCap'; v: string }
  | { kind: 'globalAlpha'; v: number }
  | { kind: 'fillRect'; x: number; y: number; w: number; h: number }
  | { kind: 'save' }
  | { kind: 'restore' }
  | { kind: 'beginPath' }
  | { kind: 'moveTo'; x: number; y: number }
  | { kind: 'lineTo'; x: number; y: number }
  | { kind: 'bezierCurveTo'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
  | { kind: 'stroke' }
  | { kind: 'translate'; x: number; y: number };

interface RecordingCtx {
  ops: Op[];
  // Mirrored from CanvasRenderingContext2D for type compat.
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number
  ): void;
  stroke(): void;
  translate(x: number, y: number): void;
}

function makeCtx(): RecordingCtx {
  const ops: Op[] = [];
  let fillStyleBacking = '#000';
  let strokeStyleBacking = '#000';
  let lineWidthBacking = 1;
  let lineCapBacking = 'butt';
  let globalAlphaBacking = 1;
  return {
    ops,
    get fillStyle() {
      return fillStyleBacking;
    },
    set fillStyle(v: string) {
      fillStyleBacking = v;
      ops.push({ kind: 'fillStyle', v });
    },
    get strokeStyle() {
      return strokeStyleBacking;
    },
    set strokeStyle(v: string) {
      strokeStyleBacking = v;
      ops.push({ kind: 'strokeStyle', v });
    },
    get lineWidth() {
      return lineWidthBacking;
    },
    set lineWidth(v: number) {
      lineWidthBacking = v;
      ops.push({ kind: 'lineWidth', v });
    },
    get lineCap() {
      return lineCapBacking;
    },
    set lineCap(v: string) {
      lineCapBacking = v;
      ops.push({ kind: 'lineCap', v });
    },
    get globalAlpha() {
      return globalAlphaBacking;
    },
    set globalAlpha(v: number) {
      globalAlphaBacking = v;
      ops.push({ kind: 'globalAlpha', v });
    },
    fillRect(x, y, w, h) {
      ops.push({ kind: 'fillRect', x, y, w, h });
    },
    save() {
      ops.push({ kind: 'save' });
    },
    restore() {
      ops.push({ kind: 'restore' });
    },
    beginPath() {
      ops.push({ kind: 'beginPath' });
    },
    moveTo(x, y) {
      ops.push({ kind: 'moveTo', x, y });
    },
    lineTo(x, y) {
      ops.push({ kind: 'lineTo', x, y });
    },
    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      ops.push({ kind: 'bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y });
    },
    stroke() {
      ops.push({ kind: 'stroke' });
    },
    translate(x, y) {
      ops.push({ kind: 'translate', x, y });
    },
  };
}

// Standard cell for tests: 10x20 with a 1px light stroke.
const CW = 10;
const CH = 20;
const LT = 1;
const COLOR = '#fff';

function draw(cp: number, lightPx = LT) {
  const ctx = makeCtx();
  const handled = drawBoxOrBlock(
    ctx as unknown as CanvasRenderingContext2D,
    cp,
    0,
    0,
    CW,
    CH,
    COLOR,
    lightPx
  );
  return { ctx, handled };
}

function rectsOnly(ops: Op[]): { x: number; y: number; w: number; h: number }[] {
  return ops.flatMap((o) => (o.kind === 'fillRect' ? [{ x: o.x, y: o.y, w: o.w, h: o.h }] : []));
}

describe('box-drawing', () => {
  describe('isBoxOrBlock', () => {
    test('matches U+2500..U+259F', () => {
      expect(isBoxOrBlock(0x2500)).toBe(true);
      expect(isBoxOrBlock(0x257f)).toBe(true);
      expect(isBoxOrBlock(0x2580)).toBe(true);
      expect(isBoxOrBlock(0x259f)).toBe(true);
    });
    test('rejects neighbors', () => {
      expect(isBoxOrBlock(0x24ff)).toBe(false);
      expect(isBoxOrBlock(0x25a0)).toBe(false);
      expect(isBoxOrBlock(0x4e00)).toBe(false);
      expect(isBoxOrBlock(0x20)).toBe(false);
    });
  });

  describe('coverage', () => {
    // Every codepoint in the range should produce drawing ops, with no
    // exceptions. A regression here means a glyph is silently falling
    // back to font rendering.
    test('every codepoint U+2500..U+259F draws something', () => {
      const missing: number[] = [];
      for (let cp = 0x2500; cp <= 0x259f; cp++) {
        const { ctx, handled } = draw(cp);
        const drewSomething = ctx.ops.some(
          (o) => o.kind === 'fillRect' || o.kind === 'stroke'
        );
        if (!handled || !drewSomething) missing.push(cp);
      }
      expect(missing).toEqual([]);
    });
  });

  describe('block elements (U+2580..U+259F)', () => {
    test('▀ U+2580 upper half = top-half rect', () => {
      const { ctx } = draw(0x2580);
      expect(rectsOnly(ctx.ops)).toEqual([{ x: 0, y: 0, w: CW, h: CH / 2 }]);
    });
    test('▄ U+2584 lower half = bottom-half rect', () => {
      const { ctx } = draw(0x2584);
      expect(rectsOnly(ctx.ops)).toEqual([{ x: 0, y: CH / 2, w: CW, h: CH / 2 }]);
    });
    test('█ U+2588 full block = full-cell rect', () => {
      const { ctx } = draw(0x2588);
      expect(rectsOnly(ctx.ops)).toEqual([{ x: 0, y: 0, w: CW, h: CH }]);
    });
    test('▏ U+258F left 1/8 = thin left rect', () => {
      const { ctx } = draw(0x258f);
      expect(rectsOnly(ctx.ops)).toEqual([{ x: 0, y: 0, w: CW / 8, h: CH }]);
    });
    test('▕ U+2595 right 1/8 = thin right rect, touches right edge', () => {
      const { ctx } = draw(0x2595);
      const rects = rectsOnly(ctx.ops);
      expect(rects).toHaveLength(1);
      const [r] = rects;
      expect(r.x + r.w).toBeCloseTo(CW, 9);
      expect(r.w).toBeCloseTo(CW / 8, 9);
      expect(r.h).toBe(CH);
    });
    test('▁ U+2581 lower 1/8 = bottom rect, touches bottom edge', () => {
      const { ctx } = draw(0x2581);
      const rects = rectsOnly(ctx.ops);
      expect(rects).toHaveLength(1);
      const [r] = rects;
      expect(r.y + r.h).toBeCloseTo(CH, 9);
    });
    test('▙ U+2599 = three quadrants (tl + bl + br)', () => {
      // Per block.zig:93: tl + bl + br. The quadrant() helper emits
      // one rect per active quadrant, in tl/tr/bl/br order.
      const { ctx } = draw(0x2599);
      const rects = rectsOnly(ctx.ops);
      expect(rects).toEqual([
        { x: 0, y: 0, w: CW / 2, h: CH / 2 }, // tl
        { x: 0, y: CH / 2, w: CW / 2, h: CH / 2 }, // bl
        { x: CW / 2, y: CH / 2, w: CW / 2, h: CH / 2 }, // br
      ]);
    });
    test('░ U+2591 light shade applies 0.25 alpha multiplier', () => {
      const { ctx } = draw(0x2591);
      const alphaOp = ctx.ops.find((o) => o.kind === 'globalAlpha');
      expect(alphaOp).toBeTruthy();
      // We do `globalAlpha *= 0.25`, starting from 1 → 0.25.
      if (alphaOp && alphaOp.kind === 'globalAlpha') {
        expect(alphaOp.v).toBeCloseTo(0.25, 9);
      }
      // And the alpha is applied within save/restore.
      expect(ctx.ops[0]?.kind).toBe('save');
      expect(ctx.ops[ctx.ops.length - 1]?.kind).toBe('restore');
    });
  });

  describe('line drawing (U+2500..U+257F)', () => {
    // drawEdges emits one fillRect per non-empty arm (left, right, up,
    // down). Adjacent arms overlap at the cell center to cover the
    // junction. So a plain horizontal `─` is 2 rects (left arm + right
    // arm), not 1. We assert the union of rects, not individual counts.
    test('─ U+2500 light horizontal: arms cover full width at vertical center', () => {
      const { ctx } = draw(0x2500);
      const rects = rectsOnly(ctx.ops);
      expect(rects.length).toBeGreaterThanOrEqual(1);
      // All rects sit at the vertical center, light-thick high.
      for (const r of rects) {
        expect(r.h).toBe(LT);
        expect(r.y + r.h / 2).toBeCloseTo(CH / 2, 9);
      }
      // Union covers full cell width.
      const minX = Math.min(...rects.map((r) => r.x));
      const maxX = Math.max(...rects.map((r) => r.x + r.w));
      expect(minX).toBe(0);
      expect(maxX).toBe(CW);
    });
    test('│ U+2502 light vertical: arms cover full height at horizontal center', () => {
      const { ctx } = draw(0x2502);
      const rects = rectsOnly(ctx.ops);
      expect(rects.length).toBeGreaterThanOrEqual(1);
      for (const r of rects) {
        expect(r.w).toBe(LT);
        expect(r.x + r.w / 2).toBeCloseTo(CW / 2, 9);
      }
      const minY = Math.min(...rects.map((r) => r.y));
      const maxY = Math.max(...rects.map((r) => r.y + r.h));
      expect(minY).toBe(0);
      expect(maxY).toBe(CH);
    });
    test('━ U+2501 heavy horizontal: rects are 2× light thickness', () => {
      const { ctx } = draw(0x2501);
      const rects = rectsOnly(ctx.ops);
      expect(rects.length).toBeGreaterThanOrEqual(1);
      for (const r of rects) {
        expect(r.h).toBe(2 * LT);
      }
    });
    test('═ U+2550 double horizontal: two parallel light strokes, 1-light gap', () => {
      const { ctx } = draw(0x2550);
      const rects = rectsOnly(ctx.ops);
      // Two arms × two parallels per arm = 4 rects.
      expect(rects).toHaveLength(4);
      // All are light-thick.
      for (const r of rects) {
        expect(r.h).toBe(LT);
      }
      // The four rects collapse into two distinct y-bands. The gap
      // between bands should equal one light thickness (Ghostty's
      // double-line spec: total span = 3 × light).
      const ys = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
      expect(ys).toHaveLength(2);
      expect(ys[1] - ys[0]).toBeCloseTo(2 * LT, 9);
    });
    test('┼ U+253C light cross = two perpendicular full-extent rects', () => {
      const { ctx } = draw(0x253c);
      const rects = rectsOnly(ctx.ops);
      // ┼: up + right + down + left, but symmetric junctions stop each
      // arm at the edge of the perpendicular crossbar to avoid double
      // painting. Up arm goes from y=0 to h_light_top, down arm goes
      // from h_light_bottom to h, horizontal goes full width.
      // Result: 2 vertical pieces + 1 full horizontal piece OR
      // 1 full vertical + 2 horizontal pieces — depending on join order.
      // Either way, the union should cover the cross shape.
      expect(rects.length).toBeGreaterThanOrEqual(2);
      // Crossbar pixel must be covered.
      const crossBarCovered = rects.some(
        (r) =>
          r.x <= CW / 2 &&
          r.x + r.w >= CW / 2 &&
          r.y <= CH / 2 &&
          r.y + r.h >= CH / 2
      );
      expect(crossBarCovered).toBe(true);
    });
    test('╔ U+2554 double down-right corner forms inner L (no crossing parallels)', () => {
      // Bug regression check: in the buggy version, the right and down
      // double parallels would extend all the way to the cell center,
      // crossing each other. Ghostty stops each parallel at the inner
      // edge of the orthogonal stroke.
      const { ctx } = draw(0x2554);
      const rects = rectsOnly(ctx.ops);
      // Should be 4 rects: top horizontal, bottom horizontal, left
      // vertical, right vertical — each with junction-aware endpoints.
      expect(rects.length).toBe(4);
      // No rect should occupy the upper-left quadrant interior (≈
      // 1/3 of cell from top-left).
      const inUpperLeft = (r: typeof rects[0]) =>
        r.x + r.w <= CW / 3 && r.y + r.h <= CH / 3;
      expect(rects.every((r) => !inUpperLeft(r))).toBe(true);
    });
  });

  describe('arcs (╭╮╯╰)', () => {
    test('╭ U+256D draws bezier path with stroke, not fill', () => {
      const { ctx } = draw(0x256d);
      // Arcs use stroke, not fill — they emit beginPath/moveTo/lineTo/
      // bezierCurveTo/stroke and no fillRect.
      expect(ctx.ops.some((o) => o.kind === 'bezierCurveTo')).toBe(true);
      expect(ctx.ops.some((o) => o.kind === 'stroke')).toBe(true);
      expect(ctx.ops.some((o) => o.kind === 'fillRect')).toBe(false);
    });
  });

  describe('dashes', () => {
    test('┄ U+2504 horizontal triple-dash: 3 rects, half-gap on each side', () => {
      const { ctx } = draw(0x2504);
      const rects = rectsOnly(ctx.ops);
      expect(rects).toHaveLength(3);
      // First dash starts at half a gap in.
      const desiredGap = Math.max(4, LT);
      const cap = Math.floor(CW / (2 * 3));
      const gap = Math.min(desiredGap, cap);
      expect(rects[0].x).toBe(Math.floor(gap / 2));
    });
    test('┆ U+2506 vertical triple-dash: 3 rects, starts at top (no half-gap)', () => {
      const { ctx } = draw(0x2506);
      const rects = rectsOnly(ctx.ops);
      expect(rects).toHaveLength(3);
      // Per Ghostty box.zig:907-909: vertical dashes start at y=0 with
      // the full extra gap pushed to the bottom. This is the asymmetry
      // the original port missed.
      expect(rects[0].y).toBe(0);
    });
    test('┈ U+2508 horizontal quad-dash: 4 rects', () => {
      const { ctx } = draw(0x2508);
      expect(rectsOnly(ctx.ops)).toHaveLength(4);
    });
    test('╌ U+254C horizontal double-dash: 2 rects', () => {
      const { ctx } = draw(0x254c);
      expect(rectsOnly(ctx.ops)).toHaveLength(2);
    });
  });

  describe('diagonals (╱╲╳)', () => {
    test('╱ U+2571 forward slash = single stroked line', () => {
      const { ctx } = draw(0x2571);
      const lines = ctx.ops.filter((o) => o.kind === 'lineTo' || o.kind === 'moveTo');
      expect(lines).toHaveLength(2); // one moveTo, one lineTo
      expect(ctx.ops.some((o) => o.kind === 'stroke')).toBe(true);
    });
    test('╳ U+2573 cross = two stroked lines', () => {
      const { ctx } = draw(0x2573);
      const moves = ctx.ops.filter((o) => o.kind === 'moveTo');
      const lines = ctx.ops.filter((o) => o.kind === 'lineTo');
      expect(moves).toHaveLength(2);
      expect(lines).toHaveLength(2);
    });
  });
});
