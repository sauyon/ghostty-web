/**
 * Glyph atlas — pre-rasterized glyph cache for the canvas renderer.
 *
 * The hot path of a terminal renderer is paying for `ctx.fillText` per cell
 * per frame. Each `fillText` re-asks Skia to shape and rasterize the glyph,
 * even though the same `(codepoint, font, color)` triple gets drawn over
 * and over. The atlas caches the rasterized pixels in an offscreen canvas;
 * the renderer's hot path becomes `drawImage(atlas, srcRect, destRect)`,
 * which is roughly an order of magnitude cheaper.
 *
 * Design notes:
 *
 *   - Single offscreen canvas. xterm.js uses multiple texture pages for
 *     WebGL; for a 2D-canvas renderer, one large atlas is enough — typical
 *     terminal usage fits a few thousand glyphs.
 *
 *   - Cell-aligned shelf packer: every slot is exactly one cell wide (or N
 *     for wide chars) by one cell tall, padded for glyph overflow. We don't
 *     bbox-trim because cell-aligned slots make `drawImage` a one-liner and
 *     handle ascender/descender bleed correctly.
 *
 *   - Cache key: simple codepoints pack into a 53-bit JS number; combined
 *     graphemes (cell.grapheme_len > 0) use a separate string-keyed map.
 *
 *   - Eviction is "clear all when full". Terminal palettes are small in
 *     practice so this rarely triggers. A future iteration could LRU.
 *
 *   - The atlas does NOT bake in decorations (underline/strikethrough/link
 *     hover) or selection coloring. Those are drawn by the renderer post-
 *     blit. Only the (codepoint, fg, fontFlags) tuple is cached.
 */

export interface AtlasGlyph {
  /** Source x in atlas, in device pixels. */
  sx: number;
  /** Source y in atlas, in device pixels. */
  sy: number;
  /** Source width in device pixels (cellWidth × dpr × cell.width). */
  sw: number;
  /** Source height in device pixels (cellHeight × dpr). */
  sh: number;
}

/**
 * Sentinel returned when the atlas is full. Callers should fall back to
 * `fillText` for the cell, or call `clear()` and retry.
 */
export const ATLAS_FULL: null = null;

export class GlyphAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Scratch canvas for rasterizing a glyph before copying into the atlas.
  // Sized to fit one wide cell with padding.
  private temp: HTMLCanvasElement;
  private tempCtx: CanvasRenderingContext2D;

  // Caches.
  // simple: keyed by (codepoint | flags<<21 | color<<29) — see _key()
  private simple: Map<number, AtlasGlyph> = new Map();
  // combined: graphemes that span multiple codepoints
  private combined: Map<string, AtlasGlyph> = new Map();

  // Shelf-packer state, in device pixels.
  private cursorX = 0;
  private cursorY = 0;
  private rowHeight = 0;

  // Cell dimensions in device pixels. Slots are sized at cellHpx tall and
  // cellWpx (× cell.width) wide. The atlas is cell-aligned by design.
  private readonly cellWpx: number;
  private readonly cellHpx: number;
  private readonly baselinePx: number;
  private readonly atlasW: number;
  private readonly atlasH: number;
  private readonly dpr: number;

  // Font config. The renderer rebuilds the atlas if any of these change.
  private readonly fontSize: number;
  private readonly fontFamily: string;

  constructor(opts: {
    cellWidth: number; // CSS pixels
    cellHeight: number; // CSS pixels
    baseline: number; // CSS pixels (offset of text baseline from cell top)
    devicePixelRatio: number;
    fontSize: number;
    fontFamily: string;
    atlasSize?: number; // device pixels; default 2048
  }) {
    this.dpr = opts.devicePixelRatio;
    this.cellWpx = Math.ceil(opts.cellWidth * this.dpr);
    this.cellHpx = Math.ceil(opts.cellHeight * this.dpr);
    this.baselinePx = Math.ceil(opts.baseline * this.dpr);
    this.fontSize = opts.fontSize;
    this.fontFamily = opts.fontFamily;
    this.atlasW = opts.atlasSize ?? 2048;
    this.atlasH = opts.atlasSize ?? 2048;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.atlasW;
    this.canvas.height = this.atlasH;
    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('GlyphAtlas: no 2d context');
    this.ctx = ctx;

    // Temp canvas large enough for a 2-wide cell with margin.
    this.temp = document.createElement('canvas');
    this.temp.width = this.cellWpx * 2 + 4;
    this.temp.height = this.cellHpx + 4;
    const tctx = this.temp.getContext('2d', { alpha: true, willReadFrequently: false });
    if (!tctx) throw new Error('GlyphAtlas: no 2d temp context');
    this.tempCtx = tctx;
  }

  /**
   * Look up or rasterize a glyph for a simple codepoint.
   *
   * @param codepoint  Unicode codepoint. Must be ≤ 0x10FFFF.
   * @param flags      The font-affecting flags only — bold, italic, faint
   *                   should NOT be in here if you want them in the atlas;
   *                   we pack a precomputed `glyphFlags` value (typically
   *                   bold+italic+the cell width).
   * @param colorRGB   24-bit packed RGB (0xRRGGBB).
   * @param cellWidth  How wide the cell is (1 or 2). 0-width spacers don't
   *                   call this method.
   * @returns the cached glyph, or `null` if the atlas is full.
   */
  getSimple(
    codepoint: number,
    flags: number,
    colorRGB: number,
    cellWidth: number
  ): AtlasGlyph | null {
    const key = this._key(codepoint, flags, colorRGB);
    const cached = this.simple.get(key);
    if (cached) return cached;

    const glyph = this._rasterize(
      String.fromCodePoint(codepoint || 32),
      flags,
      colorRGB,
      cellWidth
    );
    if (glyph === null) return ATLAS_FULL;
    this.simple.set(key, glyph);
    return glyph;
  }

  /**
   * Look up or rasterize a glyph for a combined-grapheme string.
   *
   * Combined graphemes (e.g. 'á', emoji ZWJ sequences) can't be packed
   * into a numeric key. This path uses a string-keyed Map; it's hit far less
   * often than the simple path so the per-key allocation is acceptable.
   */
  getCombined(
    chars: string,
    flags: number,
    colorRGB: number,
    cellWidth: number
  ): AtlasGlyph | null {
    // The string key includes flags+color so the same grapheme in different
    // styles caches independently.
    const key = `${chars}|${flags}|${colorRGB}`;
    const cached = this.combined.get(key);
    if (cached) return cached;

    const glyph = this._rasterize(chars, flags, colorRGB, cellWidth);
    if (glyph === null) return ATLAS_FULL;
    this.combined.set(key, glyph);
    return glyph;
  }

  /**
   * Blit a cached glyph onto a destination 2D canvas at the given CSS
   * pixel offset. The glyph's source rect is in device pixels; `drawImage`
   * scales to the destination's CSS pixel size automatically (the dest
   * context is configured with `ctx.scale(dpr, dpr)` at canvas creation).
   */
  blit(
    destCtx: CanvasRenderingContext2D,
    glyph: AtlasGlyph,
    destX: number,
    destY: number
  ): void {
    destCtx.drawImage(
      this.canvas,
      glyph.sx,
      glyph.sy,
      glyph.sw,
      glyph.sh,
      destX,
      destY,
      glyph.sw / this.dpr,
      glyph.sh / this.dpr
    );
  }

  /**
   * Drop all cached entries and reset packer state. Call this on font /
   * size / theme changes that affect rasterization. The atlas canvas is
   * not cleared eagerly — slots are simply reused as new entries get
   * packed on top.
   */
  clear(): void {
    this.simple.clear();
    this.combined.clear();
    this.cursorX = 0;
    this.cursorY = 0;
    this.rowHeight = 0;
    // Wipe the atlas so stale pixels don't leak through if a glyph happens
    // to rasterize as fully transparent and the new tenant doesn't draw to
    // every pixel.
    this.ctx.clearRect(0, 0, this.atlasW, this.atlasH);
  }

  /**
   * Pre-rasterize printable ASCII (32..126) with the default flags+color.
   * Costs a few ms once at startup but eliminates the first-frame stutter
   * that comes from rasterizing a screen full of new glyphs in one rAF.
   *
   * Mirrors xterm.js TextureAtlas:114-132 (their idle-callback warmup).
   */
  warmupAscii(defaultColorRGB: number): void {
    for (let cp = 32; cp <= 126; cp++) {
      this.getSimple(cp, 0, defaultColorRGB, 1);
    }
  }

  /**
   * Free the atlas. Called when the renderer is disposed.
   */
  dispose(): void {
    this.simple.clear();
    this.combined.clear();
    // Nothing else to do — both canvases are GC'd when the atlas object is.
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private _key(codepoint: number, flags: number, colorRGB: number): number {
    // 21 + 8 + 24 = 53 bits, fits exactly in a JS number's integer range.
    // We use floating-point multiplications instead of `<<` because the
    // bitwise shift operators in JS coerce to int32 and lose data above
    // 2^32. The multiplications stay in the safe-integer regime.
    return codepoint + flags * 2097152 /* 2^21 */ + colorRGB * 536870912 /* 2^29 */;
  }

  /**
   * Rasterize one glyph into the temp canvas, then copy it into the atlas.
   * Returns null if the atlas is full.
   */
  private _rasterize(
    chars: string,
    flags: number,
    colorRGB: number,
    cellWidth: number
  ): AtlasGlyph | null {
    const slotW = this.cellWpx * cellWidth;
    const slotH = this.cellHpx;

    // Shelf-pack: place at (cursorX, cursorY); wrap to next row if needed.
    if (this.cursorX + slotW > this.atlasW) {
      this.cursorY += this.rowHeight;
      this.cursorX = 0;
      this.rowHeight = 0;
    }
    if (this.cursorY + slotH > this.atlasH) {
      // Out of room. Caller decides whether to clear and retry or fall back.
      return ATLAS_FULL;
    }
    const sx = this.cursorX;
    const sy = this.cursorY;

    // Draw on the temp canvas first. This separates rasterization (which
    // sets ctx.font / ctx.fillStyle and may be slow due to font shaping)
    // from the atlas's main canvas, which we keep at a stable transform.
    const tw = slotW + 4;
    const th = slotH + 4;
    // Single 'copy' fillRect to clear-and-fill — slightly cheaper than
    // clearRect+fillRect (xterm.js TextureAtlas:506-509).
    const prev = this.tempCtx.globalCompositeOperation;
    this.tempCtx.globalCompositeOperation = 'copy';
    this.tempCtx.fillStyle = 'rgba(0, 0, 0, 0)';
    this.tempCtx.fillRect(0, 0, tw, th);
    this.tempCtx.globalCompositeOperation = prev;

    // Glyph-affecting flags. Only BOLD (1<<0) and ITALIC (1<<1) change the
    // glyph shape — see lib/types.ts CellFlags. INVERSE/SELECTED affect
    // colors and are baked in via the colorRGB key; UNDERLINE/STRIKETHROUGH
    // are drawn separately by the renderer post-blit.
    const BOLD = 1 << 0;
    const ITALIC = 1 << 1;
    let style = '';
    if (flags & ITALIC) style += 'italic ';
    if (flags & BOLD) style += 'bold ';
    this.tempCtx.font = `${style}${this.fontSize * this.dpr}px ${this.fontFamily}`;
    this.tempCtx.textBaseline = 'alphabetic';
    this.tempCtx.textAlign = 'left';
    this.tempCtx.fillStyle = `rgb(${(colorRGB >> 16) & 0xff}, ${(colorRGB >> 8) & 0xff}, ${
      colorRGB & 0xff
    })`;
    this.tempCtx.fillText(chars, 0, this.baselinePx);

    // Copy temp → atlas with one drawImage. Source rect is the slot-sized
    // region we drew into; we drop the right/bottom padding which exists
    // only to absorb glyph overflow during rasterization.
    this.ctx.clearRect(sx, sy, slotW, slotH);
    this.ctx.drawImage(this.temp, 0, 0, slotW, slotH, sx, sy, slotW, slotH);

    this.cursorX += slotW;
    if (slotH > this.rowHeight) this.rowHeight = slotH;

    return { sx, sy, sw: slotW, sh: slotH };
  }
}
