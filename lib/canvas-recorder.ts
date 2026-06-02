/**
 * Recording stub for `CanvasRenderingContext2D`, shared between the
 * `lib/box-drawing.test.ts` and `lib/powerline.test.ts` suites.
 *
 * happy-dom's Canvas2D implementation doesn't actually rasterize, so
 * we can't render-then-pixel-diff in unit tests. Instead the recorder
 * captures every drawing call as a structured `RecordingOp` and tests
 * make assertions against the op stream. This gives us:
 *   - coverage assertions (every supported codepoint must produce at
 *     least one fillRect / fill / stroke),
 *   - structural assertions on hand-picked glyphs (vertex coords,
 *     control points, line widths, mirror-envelope wrapping), and
 *   - regression-on-refactor stability (the op sequence is stable).
 *
 * The returned value is cast to `CanvasRenderingContext2D` here so
 * test files don't need their own `as unknown as` jump — they get a
 * value typed as the real Canvas2D context plus an `ops` field they
 * can inspect.
 *
 * Kept out of the published package on two fronts:
 *   - JS: this file isn't reachable from `lib/index.ts`, so Rollup
 *     tree-shakes it out of `dist/ghostty-web.js`.
 *   - Types: vite-plugin-dts's `exclude` in `vite.config.js` lists
 *     this file by name (the `*.test.ts` wildcard alone wouldn't
 *     catch it), so its declarations stay out of `ghostty-web.d.ts`.
 */

/**
 * Union of every Canvas2D operation either glyph renderer can emit.
 * Order intentionally matches the order each kind first appears in
 * box-drawing.ts / powerline.ts; if a new op gets added to one of
 * those modules it goes here too.
 */
export type RecordingOp =
  // Style property writes.
  | { kind: 'fillStyle'; v: string }
  | { kind: 'strokeStyle'; v: string }
  | { kind: 'lineWidth'; v: number }
  | { kind: 'lineCap'; v: CanvasLineCap }
  | { kind: 'lineJoin'; v: CanvasLineJoin }
  | { kind: 'globalAlpha'; v: number }
  // Rectangles.
  | { kind: 'fillRect'; x: number; y: number; w: number; h: number }
  // State stack.
  | { kind: 'save' }
  | { kind: 'restore' }
  // Path lifecycle.
  | { kind: 'beginPath' }
  | { kind: 'closePath' }
  // Path construction.
  | { kind: 'moveTo'; x: number; y: number }
  | { kind: 'lineTo'; x: number; y: number }
  | {
      kind: 'bezierCurveTo';
      cp1x: number;
      cp1y: number;
      cp2x: number;
      cp2y: number;
      x: number;
      y: number;
    }
  // Path consumption.
  | { kind: 'fill' }
  | { kind: 'stroke' }
  | { kind: 'clip' }
  // Transforms.
  | { kind: 'translate'; x: number; y: number }
  | { kind: 'scale'; x: number; y: number };

/**
 * A recorder typed as a real `CanvasRenderingContext2D` so it can be
 * passed straight to `drawBoxOrBlock`, `drawPowerline`, etc. The
 * extra `ops` field is what tests assert against.
 *
 * Only the methods/properties the procedural glyph renderers actually
 * use are implemented; touching anything else throws at runtime (the
 * type cast hides it from the type system on purpose — we want test
 * failures, not silent no-ops, if a renderer starts calling a new
 * Canvas2D method without us updating this recorder).
 */
export type RecordingCanvas = CanvasRenderingContext2D & { ops: RecordingOp[] };

export function makeRecordingCtx(): RecordingCanvas {
  const ops: RecordingOp[] = [];
  // Style properties are stored in backing variables so the getters
  // can return what was last set. Without this, `ctx.fillStyle = x;
  // ctx.fillStyle` would return undefined and break any renderer that
  // reads back a style it just wrote (e.g. powerline.ts copies
  // fillStyle to strokeStyle).
  let fillStyleBacking = '#000';
  let strokeStyleBacking = '#000';
  let lineWidthBacking = 1;
  let lineCapBacking: CanvasLineCap = 'butt';
  let lineJoinBacking: CanvasLineJoin = 'miter';
  let globalAlphaBacking = 1;

  const recorder = {
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
    set lineCap(v: CanvasLineCap) {
      lineCapBacking = v;
      ops.push({ kind: 'lineCap', v });
    },
    get lineJoin() {
      return lineJoinBacking;
    },
    set lineJoin(v: CanvasLineJoin) {
      lineJoinBacking = v;
      ops.push({ kind: 'lineJoin', v });
    },
    get globalAlpha() {
      return globalAlphaBacking;
    },
    set globalAlpha(v: number) {
      globalAlphaBacking = v;
      ops.push({ kind: 'globalAlpha', v });
    },
    fillRect(x: number, y: number, w: number, h: number) {
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
    closePath() {
      ops.push({ kind: 'closePath' });
    },
    moveTo(x: number, y: number) {
      ops.push({ kind: 'moveTo', x, y });
    },
    lineTo(x: number, y: number) {
      ops.push({ kind: 'lineTo', x, y });
    },
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
      ops.push({ kind: 'bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y });
    },
    fill() {
      ops.push({ kind: 'fill' });
    },
    stroke() {
      ops.push({ kind: 'stroke' });
    },
    clip() {
      ops.push({ kind: 'clip' });
    },
    translate(x: number, y: number) {
      ops.push({ kind: 'translate', x, y });
    },
    scale(x: number, y: number) {
      ops.push({ kind: 'scale', x, y });
    },
  };

  // Single cast site for the whole project — see the doc on
  // RecordingCanvas for why we don't try to fully implement the
  // CanvasRenderingContext2D surface.
  return recorder as unknown as RecordingCanvas;
}
