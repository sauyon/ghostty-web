/**
 * Canvas Renderer for Terminal Display
 *
 * High-performance canvas-based renderer that draws the terminal using
 * Ghostty's WASM terminal emulator. Features:
 * - Font metrics measurement with DPI scaling
 * - Full color support (256-color palette + RGB)
 * - All text styles (bold, italic, underline, strikethrough, etc.)
 * - Multiple cursor styles (block, underline, bar)
 * - Dirty line optimization for 60 FPS
 */

import { GlyphAtlas } from './glyph-atlas';
import type { ITheme } from './interfaces';
import type { SelectionManager } from './selection-manager';
import type { GhosttyCell, ILink } from './types';
import { CellFlags } from './types';

type LinkRange = { startX: number; startY: number; endX: number; endY: number } | null;
function rangeEquals(a: LinkRange, b: LinkRange): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.startX === b.startX && a.startY === b.startY && a.endX === b.endX && a.endY === b.endY
  );
}

/**
 * Parse '#rrggbb' or '#rgb' or 'rgb(r, g, b)' into a packed 0xRRGGBB number.
 * Returns 0 (black) on parse failure rather than throwing — colors are
 * theme-derived and we'd rather render them as black than crash.
 */
function parseColor(s: string): number {
  if (s.length === 0) return 0;
  if (s.charCodeAt(0) === 0x23 /* '#' */) {
    if (s.length === 7) {
      // #rrggbb
      const v = Number.parseInt(s.slice(1), 16);
      return Number.isNaN(v) ? 0 : v;
    }
    if (s.length === 4) {
      // #rgb -> #rrggbb
      const r = Number.parseInt(s[1] + s[1], 16);
      const g = Number.parseInt(s[2] + s[2], 16);
      const b = Number.parseInt(s[3] + s[3], 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0;
      return (r << 16) | (g << 8) | b;
    }
  }
  // 'rgb(r, g, b)' — best-effort regex match.
  const m = s.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) {
    const r = Number.parseInt(m[1], 10);
    const g = Number.parseInt(m[2], 10);
    const b = Number.parseInt(m[3], 10);
    return (r << 16) | (g << 8) | b;
  }
  return 0;
}

// Interface for objects that can be rendered
export interface IRenderable {
  getLine(y: number): GhosttyCell[] | null;
  getCursor(): { x: number; y: number; visible: boolean };
  getDimensions(): { cols: number; rows: number };
  isRowDirty(y: number): boolean;
  /** Returns true if a full redraw is needed (e.g., screen change) */
  needsFullRedraw?(): boolean;
  clearDirty(): void;
  /**
   * Get the full grapheme string for a cell at (row, col).
   * For cells with grapheme_len > 0, this returns all codepoints combined.
   * For simple cells, returns the single character.
   */
  getGraphemeString?(row: number, col: number): string;
}

export interface IScrollbackProvider {
  getScrollbackLine(offset: number): GhosttyCell[] | null;
  getScrollbackLength(): number;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface RendererOptions {
  fontSize?: number; // Default: 15
  fontFamily?: string; // Default: 'monospace'
  cursorStyle?: 'block' | 'underline' | 'bar'; // Default: 'block'
  cursorBlink?: boolean; // Default: false
  theme?: ITheme;
  devicePixelRatio?: number; // Default: window.devicePixelRatio
}

export interface FontMetrics {
  width: number; // Character cell width in CSS pixels
  height: number; // Character cell height in CSS pixels
  baseline: number; // Distance from top to text baseline
}

// ============================================================================
// Default Theme
// ============================================================================

export const DEFAULT_THEME: Required<ITheme> = {
  foreground: '#d4d4d4',
  background: '#1e1e1e',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  // Selection colors: solid colors that replace cell bg/fg when selected
  // Using Ghostty's approach: selection bg = default fg, selection fg = default bg
  selectionBackground: '#d4d4d4',
  selectionForeground: '#1e1e1e',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

// ============================================================================
// CanvasRenderer Class
// ============================================================================

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fontSize: number;
  private fontFamily: string;
  private cursorStyle: 'block' | 'underline' | 'bar';
  private cursorBlink: boolean;
  private theme: Required<ITheme>;
  private devicePixelRatio: number;
  private metrics: FontMetrics;
  private palette: string[];

  // Cursor blinking state
  private cursorVisible: boolean = true;
  private cursorBlinkInterval?: number;
  private lastCursorPosition: { x: number; y: number } = { x: 0, y: 0 };

  // Viewport tracking (for scrolling)
  private lastViewportY: number = 0;

  // Current buffer being rendered (for grapheme lookups)
  private currentBuffer: IRenderable | null = null;

  // Selection manager (for rendering selection)
  private selectionManager?: SelectionManager;
  // Cached selection coordinates for current render pass (viewport-relative)
  private currentSelectionCoords: {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
  } | null = null;

  // Link rendering state
  private hoveredHyperlinkId: number = 0;
  private previousHoveredHyperlinkId: number = 0;

  // Regex link hover tracking (for links without hyperlink_id)
  private hoveredLinkRange: { startX: number; startY: number; endX: number; endY: number } | null =
    null;
  private previousHoveredLinkRange: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null = null;

  // Cached canvas-2d state. ctx.font / ctx.fillStyle / ctx.strokeStyle assignment
  // is not free in Chromium (CSS parse + FontFaceSet lookup, color string parse).
  // Tracking the last value lets us no-op redundant assignments.
  private cachedFont: string = '';
  private cachedFillStyle: string = '';
  private cachedStrokeStyle: string = '';

  // rgb -> 'rgb(r, g, b)' cache. Keyed by (r<<16|g<<8|b).
  private rgbStringCache: Map<number, string> = new Map();

  // Cursor cell tracking for single-cell overlay redraw.
  private lastCursorWasDrawn: boolean = false;

  // Last scrollbar opacity used. Lets us skip the per-frame scrollbar
  // redraw when opacity hasn't changed (steady-state) — combined with
  // the early-exit check below this drops idle compositor work to zero.
  private lastScrollbarOpacity: number = -1;

  // Glyph atlas — pre-rasterized cache so the hot path is `drawImage` rather
  // than `fillText`. Created once metrics are measured; rebuilt on font /
  // theme / DPR changes.
  private glyphAtlas: GlyphAtlas | null = null;
  // Theme colors precomputed in packed-RGB form so the atlas key path
  // doesn't allocate a CSS string per cell.
  private selectionFgRGB: number = 0;
  private cursorAccentRGB: number = 0;
  private themeForegroundRGB: number = 0;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;

    // Apply options
    this.fontSize = options.fontSize ?? 15;
    this.fontFamily = options.fontFamily ?? 'monospace';
    this.cursorStyle = options.cursorStyle ?? 'block';
    this.cursorBlink = options.cursorBlink ?? false;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.devicePixelRatio = options.devicePixelRatio ?? window.devicePixelRatio ?? 1;

    // Build color palette (16 ANSI colors)
    this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite,
    ];

    // Measure font metrics
    this.metrics = this.measureFont();

    // Cache theme colors in packed-RGB form for the atlas key path.
    this.recomputeThemeRGB();

    // Build the glyph atlas now that we know cell dimensions.
    this.rebuildGlyphAtlas();

    // Setup cursor blinking if enabled
    if (this.cursorBlink) {
      this.startCursorBlink();
    }
  }

  /**
   * Recompute precomputed RGB forms of the theme colors. Call after any
   * change to `this.theme`.
   */
  private recomputeThemeRGB(): void {
    this.selectionFgRGB = parseColor(this.theme.selectionForeground);
    this.cursorAccentRGB = parseColor(this.theme.cursorAccent);
    this.themeForegroundRGB = parseColor(this.theme.foreground);
  }

  /**
   * Drop the existing glyph atlas (if any) and create a fresh one. Called
   * from the constructor and from any setter that invalidates rasterized
   * pixels: font size, font family, or DPI changes.
   */
  private rebuildGlyphAtlas(): void {
    this.glyphAtlas?.dispose();
    this.glyphAtlas = new GlyphAtlas({
      cellWidth: this.metrics.width,
      cellHeight: this.metrics.height,
      baseline: this.metrics.baseline,
      devicePixelRatio: this.devicePixelRatio,
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
    });
    // Warm the cache for default-fg ASCII so the first paint of a new
    // terminal doesn't have to rasterize 95+ glyphs in one rAF.
    this.glyphAtlas.warmupAscii(this.themeForegroundRGB);
  }

  // ==========================================================================
  // Font Metrics Measurement
  // ==========================================================================

  private measureFont(): FontMetrics {
    // Use an offscreen canvas for measurement
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Set font (use actual pixel size for accurate measurement)
    ctx.font = `${this.fontSize}px ${this.fontFamily}`;

    // Measure width using 'M' (typically widest character)
    const widthMetrics = ctx.measureText('M');
    const width = Math.ceil(widthMetrics.width);

    // Measure height using ascent + descent with padding for glyph overflow
    const ascent = widthMetrics.actualBoundingBoxAscent || this.fontSize * 0.8;
    const descent = widthMetrics.actualBoundingBoxDescent || this.fontSize * 0.2;

    // Add 2px padding to height to account for glyphs that overflow (like 'f', 'd', 'g', 'p')
    // and anti-aliasing pixels
    const height = Math.ceil(ascent + descent) + 2;
    const baseline = Math.ceil(ascent) + 1; // Offset baseline by half the padding

    return { width, height, baseline };
  }

  /**
   * Remeasure font metrics (call after font loads or changes)
   */
  public remeasureFont(): void {
    this.metrics = this.measureFont();
    this.rebuildGlyphAtlas();
  }

  // ==========================================================================
  // ctx state helpers
  // ==========================================================================

  private setFont(s: string): void {
    if (this.cachedFont !== s) {
      this.ctx.font = s;
      this.cachedFont = s;
    }
  }

  private setFillStyle(s: string): void {
    if (this.cachedFillStyle !== s) {
      this.ctx.fillStyle = s;
      this.cachedFillStyle = s;
    }
  }

  private setStrokeStyle(s: string): void {
    if (this.cachedStrokeStyle !== s) {
      this.ctx.strokeStyle = s;
      this.cachedStrokeStyle = s;
    }
  }

  /**
   * Invalidate cached ctx state. Call this any time the canvas context is
   * reset or restored — e.g. after `canvas.width =` (which clears state) or
   * after `ctx.restore()`.
   */
  private invalidateCtxCache(): void {
    this.cachedFont = '';
    this.cachedFillStyle = '';
    this.cachedStrokeStyle = '';
  }

  // ==========================================================================
  // Color Conversion
  // ==========================================================================

  private rgbToCSS(r: number, g: number, b: number): string {
    const key = (r << 16) | (g << 8) | b;
    const cached = this.rgbStringCache.get(key);
    if (cached !== undefined) return cached;
    const s = `rgb(${r}, ${g}, ${b})`;
    this.rgbStringCache.set(key, s);
    return s;
  }

  // ==========================================================================
  // Canvas Sizing
  // ==========================================================================

  /**
   * Resize canvas to fit terminal dimensions
   */
  public resize(cols: number, rows: number): void {
    const cssWidth = cols * this.metrics.width;
    const cssHeight = rows * this.metrics.height;

    // Set CSS size (what user sees)
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // Set actual canvas size (scaled for DPI)
    this.canvas.width = cssWidth * this.devicePixelRatio;
    this.canvas.height = cssHeight * this.devicePixelRatio;

    // Scale context to match DPI (setting canvas.width/height resets the context)
    this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
    // canvas.width = … resets the entire 2D state, so our state cache is stale.
    this.invalidateCtxCache();

    // Set text rendering properties for crisp text
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';

    // Fill background after resize
    this.setFillStyle(this.theme.background);
    this.ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  // ==========================================================================
  // Main Rendering
  // ==========================================================================

  /**
   * Render the terminal buffer to canvas
   */
  public render(
    buffer: IRenderable,
    forceAll: boolean = false,
    viewportY: number = 0,
    scrollbackProvider?: IScrollbackProvider,
    scrollbarOpacity: number = 1
  ): void {
    // Store buffer reference for grapheme lookups in renderCell
    this.currentBuffer = buffer;

    // getCursor() calls update() internally to ensure fresh state.
    // Multiple update() calls are safe - dirty state persists until clearDirty().
    const cursor = buffer.getCursor();
    const dims = buffer.getDimensions();
    const scrollbackLength = scrollbackProvider ? scrollbackProvider.getScrollbackLength() : 0;

    // Check if buffer needs full redraw (e.g., screen change between normal/alternate)
    if (buffer.needsFullRedraw?.()) {
      forceAll = true;
    }

    // Resize canvas if dimensions changed
    const needsResize =
      this.canvas.width !== dims.cols * this.metrics.width * this.devicePixelRatio ||
      this.canvas.height !== dims.rows * this.metrics.height * this.devicePixelRatio;

    if (needsResize) {
      this.resize(dims.cols, dims.rows);
      forceAll = true; // Force full render after resize
    }

    // Detect viewport change but DON'T update lastViewportY yet — we want the
    // early-exit check below to see the unchanged state if nothing moved.
    const viewportChanged = viewportY !== this.lastViewportY;
    if (viewportChanged) {
      forceAll = true;
    }

    // Cursor visual handling is deferred until after the main row-rendering
    // loop (see "Cursor overlay" below). The previous implementation called
    // renderLine() for the entire cursor row every frame while blinking,
    // which is ~80 cells of fillText per terminal regardless of dirty
    // state. We now redraw a single cell when the cursor actually moves or
    // toggles, and otherwise just paint the cursor on top.
    const cursorMoved =
      cursor.x !== this.lastCursorPosition.x || cursor.y !== this.lastCursorPosition.y;
    const drawCursorThisFrame =
      viewportY === 0 && cursor.visible && this.cursorVisible;
    const cursorChanged = cursorMoved || drawCursorThisFrame !== this.lastCursorWasDrawn;

    // ----- Early-exit fast path -----
    //
    // The biggest cost on idle frames isn't any one piece of JS — it's the
    // cumulative compositor work for the canvas being marked dirty every
    // frame. If we issue zero canvas commands, the canvas's compositor
    // layer stays clean and the GPU upload is skipped entirely.
    //
    // We can early-exit when *nothing* has changed since the last render:
    // no forced redraw, no viewport scroll, no cursor change, no selection
    // change, no hover change, no scrollbar fade, and no row marked dirty
    // by the VT parser. Each test below is cheap; the dirty-row scan
    // short-circuits on the first hit.
    const hoverUnchanged =
      this.hoveredHyperlinkId === this.previousHoveredHyperlinkId &&
      rangeEquals(this.hoveredLinkRange, this.previousHoveredLinkRange);
    const selectionUnchanged =
      !this.selectionManager || this.selectionManager.getDirtySelectionRows().size === 0;
    const scrollbarUnchanged = scrollbarOpacity === this.lastScrollbarOpacity;
    if (
      !forceAll &&
      !cursorChanged &&
      hoverUnchanged &&
      selectionUnchanged &&
      scrollbarUnchanged &&
      !this.anyRowDirty(buffer, dims.rows)
    ) {
      return;
    }

    // We're committing to a real render — now safe to update viewport state.
    if (viewportChanged) this.lastViewportY = viewportY;

    // Check if we need to redraw selection-related lines
    const hasSelection = this.selectionManager && this.selectionManager.hasSelection();
    const selectionRows = new Set<number>();

    // Cache selection coordinates for use during cell rendering
    // This is used by isInSelection() to determine if a cell needs selection colors
    this.currentSelectionCoords = hasSelection ? this.selectionManager!.getSelectionCoords() : null;

    // Mark current selection rows for redraw (includes programmatic selections)
    if (this.currentSelectionCoords) {
      const coords = this.currentSelectionCoords;
      for (let row = coords.startRow; row <= coords.endRow; row++) {
        selectionRows.add(row);
      }
    }

    // Always mark dirty selection rows for redraw (to clear old overlay)
    if (this.selectionManager) {
      const dirtyRows = this.selectionManager.getDirtySelectionRows();
      if (dirtyRows.size > 0) {
        for (const row of dirtyRows) {
          selectionRows.add(row);
        }
        // Clear the dirty rows tracking after marking for redraw
        this.selectionManager.clearDirtySelectionRows();
      }
    }

    // Track rows with hyperlinks that need redraw when hover changes
    const hyperlinkRows = new Set<number>();
    const hyperlinkChanged = this.hoveredHyperlinkId !== this.previousHoveredHyperlinkId;
    const linkRangeChanged = !rangeEquals(this.hoveredLinkRange, this.previousHoveredLinkRange);

    if (hyperlinkChanged) {
      // Find rows containing the old or new hovered hyperlink
      // Must check the correct buffer based on viewportY (scrollback vs screen)
      for (let y = 0; y < dims.rows; y++) {
        let line: GhosttyCell[] | null = null;

        // Same logic as rendering: fetch from scrollback or screen
        if (viewportY > 0) {
          if (y < viewportY && scrollbackProvider) {
            // This row is from scrollback
            // Floor viewportY for array access (handles fractional values during smooth scroll)
            const scrollbackOffset = scrollbackLength - Math.floor(viewportY) + y;
            line = scrollbackProvider.getScrollbackLine(scrollbackOffset);
          } else {
            // This row is from visible screen
            const screenRow = y - Math.floor(viewportY);
            line = buffer.getLine(screenRow);
          }
        } else {
          // At bottom - fetch from visible screen
          line = buffer.getLine(y);
        }

        if (line) {
          for (const cell of line) {
            if (
              cell.hyperlink_id === this.hoveredHyperlinkId ||
              cell.hyperlink_id === this.previousHoveredHyperlinkId
            ) {
              hyperlinkRows.add(y);
              break; // Found hyperlink in this row
            }
          }
        }
      }
      // Update previous state
      this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
    }

    // Track rows affected by link range changes (for regex URLs)
    if (linkRangeChanged) {
      // Add rows from old range
      if (this.previousHoveredLinkRange) {
        for (
          let y = this.previousHoveredLinkRange.startY;
          y <= this.previousHoveredLinkRange.endY;
          y++
        ) {
          hyperlinkRows.add(y);
        }
      }
      // Add rows from new range
      if (this.hoveredLinkRange) {
        for (let y = this.hoveredLinkRange.startY; y <= this.hoveredLinkRange.endY; y++) {
          hyperlinkRows.add(y);
        }
      }
      this.previousHoveredLinkRange = this.hoveredLinkRange;
    }

    // Track if anything was actually rendered
    let anyLinesRendered = false;

    // Determine which rows need rendering.
    // We also include adjacent rows (above and below) for each dirty row to handle
    // glyph overflow - tall glyphs like Devanagari vowel signs can extend into
    // adjacent rows' visual space.
    const rowsToRender = new Set<number>();
    for (let y = 0; y < dims.rows; y++) {
      // When scrolled, always force render all lines since we're showing scrollback
      const needsRender =
        viewportY > 0
          ? true
          : forceAll || buffer.isRowDirty(y) || selectionRows.has(y) || hyperlinkRows.has(y);

      if (needsRender) {
        rowsToRender.add(y);
        // Include adjacent rows to handle glyph overflow
        if (y > 0) rowsToRender.add(y - 1);
        if (y < dims.rows - 1) rowsToRender.add(y + 1);
      }
    }

    // Render each line
    for (let y = 0; y < dims.rows; y++) {
      if (!rowsToRender.has(y)) {
        continue;
      }

      anyLinesRendered = true;

      // Fetch line from scrollback or visible screen
      let line: GhosttyCell[] | null = null;
      if (viewportY > 0) {
        // Scrolled up - need to fetch from scrollback + visible screen
        // When scrolled up N lines, we want to show:
        // - Scrollback lines (from the end) + visible screen lines

        // Check if this row should come from scrollback or visible screen
        if (y < viewportY && scrollbackProvider) {
          // This row is from scrollback (upper part of viewport)
          // Get from end of scrollback buffer
          // Floor viewportY for array access (handles fractional values during smooth scroll)
          const scrollbackOffset = scrollbackLength - Math.floor(viewportY) + y;
          line = scrollbackProvider.getScrollbackLine(scrollbackOffset);
        } else {
          // This row is from visible screen (lower part of viewport)
          const screenRow = viewportY > 0 ? y - Math.floor(viewportY) : y;
          line = buffer.getLine(screenRow);
        }
      } else {
        // At bottom - fetch from visible screen
        line = buffer.getLine(y);
      }

      if (line) {
        this.renderLine(line, y, dims.cols);
      }
    }

    // Selection highlighting is integrated into renderCellBackground / renderCellText.
    // Link underlines are drawn during cell rendering.

    // ----- Cursor overlay -----
    //
    // The old implementation forced a full-row redraw any frame the cursor
    // was blinking, regardless of whether the row was dirty. For idle
    // terminals that's ~80 fillText calls × 60 fps × N terminals — pure
    // waste. The cursor is now treated as a single-cell overlay:
    //
    //   - We paint the cursor on top of the cell at (cursor.x, cursor.y)
    //     when it should be visible this frame.
    //   - When the cursor stops being visible (blink-off, hide, scroll),
    //     OR when it moves to a new cell, we redraw just the OLD cell to
    //     erase the previous frame's cursor visual. If the old row is
    //     already being redrawn this frame (dirty/selection/etc.), we
    //     skip the per-cell erase — the row redraw already covers it.
    // `cursorChanged` and `drawCursorThisFrame` were precomputed at the top
    // of render() for the early-exit check.
    const oldX = this.lastCursorPosition.x;
    const oldY = this.lastCursorPosition.y;
    if (this.lastCursorWasDrawn && cursorChanged && !rowsToRender.has(oldY)) {
      const oldLine = buffer.getLine(oldY);
      if (oldLine && oldX < oldLine.length) {
        this.redrawCell(oldLine, oldX, oldY);
      }
    }
    if (drawCursorThisFrame) {
      this.renderCursor(cursor.x, cursor.y);
    }
    this.lastCursorWasDrawn = drawCursorThisFrame;

    // Render scrollbar if scrolled or scrollback exists (with opacity for fade effect).
    // We re-render only when opacity actually changed since last frame — otherwise
    // the steady-state scrollbar visual is already on the canvas.
    if (scrollbackProvider && scrollbarOpacity > 0 && scrollbarOpacity !== this.lastScrollbarOpacity) {
      this.renderScrollbar(viewportY, scrollbackLength, dims.rows, scrollbarOpacity);
    }
    this.lastScrollbarOpacity = scrollbarOpacity;

    // Update last cursor position
    this.lastCursorPosition = { x: cursor.x, y: cursor.y };

    // ALWAYS clear dirty flags after rendering, regardless of forceAll.
    // This is critical - if we don't clear after a full redraw, the dirty
    // state persists and the next frame might not detect new changes properly.
    buffer.clearDirty();
  }

  /**
   * Short-circuiting scan: returns true on the first dirty row, false if
   * none. Used by the early-exit check to avoid building rowsToRender (and
   * issuing canvas commands) on quiescent frames.
   */
  private anyRowDirty(buffer: IRenderable, rows: number): boolean {
    for (let y = 0; y < rows; y++) {
      if (buffer.isRowDirty(y)) return true;
    }
    return false;
  }

  /**
   * Redraw a single cell's background and text in place. Used by the cursor
   * overlay to erase the cursor's previous-frame visual without redrawing
   * the entire row.
   *
   * Caveat: glyphs from neighboring cells that bleed into this cell (rare —
   * mostly Devanagari and similar) can leave artifacts. The cursor sits on
   * an ASCII cell in practice, so this is fine for the cursor case. The
   * full-row redraw paths still apply for genuine content updates.
   */
  private redrawCell(line: GhosttyCell[], x: number, y: number): void {
    const cell = line[x];
    if (!cell || cell.width === 0) return;
    const cellX = x * this.metrics.width;
    const cellY = y * this.metrics.height;
    const cellW = this.metrics.width * cell.width;
    const cellH = this.metrics.height;
    this.ctx.clearRect(cellX, cellY, cellW, cellH);
    this.setFillStyle(this.theme.background);
    this.ctx.fillRect(cellX, cellY, cellW, cellH);
    const bg = this.cellBgColor(cell, x, y);
    if (bg !== '') {
      this.setFillStyle(bg);
      this.ctx.fillRect(cellX, cellY, cellW, cellH);
    }
    this.renderCellText(cell, x, y);
  }

  /**
   * Render a single line using two-pass approach:
   * 1. First pass: Draw all cell backgrounds (run-length batched by color)
   * 2. Second pass: Draw all cell text and decorations
   *
   * Two passes are needed because complex scripts (e.g. Devanagari) emit
   * glyphs that extend LEFT of their cell into the previous cell's visual
   * area. Drawing per-cell bg+text in a single pass would let cell N's
   * background cover cell N-1's left-extending grapheme.
   */
  private renderLine(line: GhosttyCell[], y: number, cols: number): void {
    const lineY = y * this.metrics.height;
    const lineWidth = cols * this.metrics.width;
    const cellW = this.metrics.width;
    const cellH = this.metrics.height;

    // Clear line then paint theme bg over the whole row in one fillRect.
    // clearRect is needed because fillRect composites rather than replaces.
    this.ctx.clearRect(0, lineY, lineWidth, cellH);
    this.setFillStyle(this.theme.background);
    this.ctx.fillRect(0, lineY, lineWidth, cellH);

    // PASS 1: cell backgrounds, run-length batched by color.
    //
    // For typical TUI output most cells share the default bg (already painted
    // above). The non-default-bg cells often arrive in runs of the same color
    // (e.g. a status bar, a syntax-highlighted span). We coalesce adjacent
    // same-color cells into a single fillRect, which lets us skip both extra
    // ctx.fillStyle assignments and extra fillRect calls.
    //
    // `runColor === ''` means "no active run" (or the run was default bg,
    // which we don't draw because the row fill already covers it).
    let runColor = '';
    let runStartX = 0;
    let runEndX = 0;
    for (let x = 0; x < line.length; x++) {
      const cell = line[x];
      if (cell.width === 0) {
        // Spacer cell of a wide char — paints under the wide cell, no draw.
        // Don't break the current run: width-0 cells don't have their own bg.
        continue;
      }
      const color = this.cellBgColor(cell, x, y);
      if (color === runColor) {
        runEndX = x + cell.width;
        continue;
      }
      // Color changed — flush previous run if non-default.
      if (runColor !== '') {
        this.setFillStyle(runColor);
        this.ctx.fillRect(runStartX * cellW, lineY, (runEndX - runStartX) * cellW, cellH);
      }
      runColor = color;
      runStartX = x;
      runEndX = x + cell.width;
    }
    if (runColor !== '') {
      this.setFillStyle(runColor);
      this.ctx.fillRect(runStartX * cellW, lineY, (runEndX - runStartX) * cellW, cellH);
    }

    // PASS 2: cell text and decorations. Glyphs can extend across cell
    // boundaries safely now that all backgrounds are in place.
    for (let x = 0; x < line.length; x++) {
      const cell = line[x];
      if (cell.width === 0) continue;
      this.renderCellText(cell, x, y);
    }
  }

  /**
   * Compute the CSS color string for a cell's background, or '' if the cell
   * inherits the default theme background (no draw needed). Selection
   * highlighting takes precedence — selected cells use selectionBackground
   * regardless of the cell's own bg, matching the previous behavior.
   */
  private cellBgColor(cell: GhosttyCell, x: number, y: number): string {
    if (this.isInSelection(x, y)) {
      return this.theme.selectionBackground;
    }
    let r = cell.bg_r;
    let g = cell.bg_g;
    let b = cell.bg_b;
    if (cell.flags & CellFlags.INVERSE) {
      r = cell.fg_r;
      g = cell.fg_g;
      b = cell.fg_b;
    }
    if (r === 0 && g === 0 && b === 0) return '';
    return this.rgbToCSS(r, g, b);
  }

  /**
   * Test whether a cell at (x, y) lies inside the hovered regex-link range.
   */
  private isInLinkRange(
    x: number,
    y: number,
    range: { startX: number; startY: number; endX: number; endY: number }
  ): boolean {
    return (
      (y === range.startY && x >= range.startX && (y < range.endY || x <= range.endX)) ||
      (y > range.startY && y < range.endY) ||
      (y === range.endY && x <= range.endX && (y > range.startY || x >= range.startX))
    );
  }

  /**
   * Render a cell's text and decorations (Pass 2 of two-pass rendering).
   *
   * For empty cells (space/U+0000 with no decorations/links), this is a fast
   * no-op — the most common case in idle terminals.
   *
   * The glyph itself is drawn via the GlyphAtlas: a `drawImage` from the
   * pre-rasterized cache instead of `fillText`, which is roughly an order
   * of magnitude faster on the canvas-2d hot path. fillText is retained as
   * a fallback for the rare case where the atlas is full.
   */
  private renderCellText(
    cell: GhosttyCell,
    x: number,
    y: number,
    colorOverrideRGB?: number
  ): void {
    if (cell.flags & CellFlags.INVISIBLE) return;

    const cellX = x * this.metrics.width;
    const cellY = y * this.metrics.height;
    const cellWidth = this.metrics.width * cell.width;
    const cellHeight = this.metrics.height;

    const hasGlyph = cell.grapheme_len > 0 || (cell.codepoint !== 32 && cell.codepoint !== 0);
    const hasUnderline = (cell.flags & CellFlags.UNDERLINE) !== 0;
    const hasStrike = (cell.flags & CellFlags.STRIKETHROUGH) !== 0;
    const hasOsc8 = cell.hyperlink_id > 0 && cell.hyperlink_id === this.hoveredHyperlinkId;
    const hasRegexLink =
      this.hoveredLinkRange !== null && this.isInLinkRange(x, y, this.hoveredLinkRange);

    if (!hasGlyph && !hasUnderline && !hasStrike && !hasOsc8 && !hasRegexLink) {
      return; // Empty cell with no decorations — nothing to paint.
    }

    // Resolve the cell's foreground color, both as packed RGB (for the atlas
    // key) and as a CSS string (for ctx.strokeStyle on decorations and the
    // fillText fallback path).
    const isSelected = this.isInSelection(x, y);
    let fgRGB: number;
    if (colorOverrideRGB !== undefined) {
      fgRGB = colorOverrideRGB;
    } else if (isSelected) {
      fgRGB = this.selectionFgRGB;
    } else {
      let r = cell.fg_r;
      let g = cell.fg_g;
      let b = cell.fg_b;
      if (cell.flags & CellFlags.INVERSE) {
        r = cell.bg_r;
        g = cell.bg_g;
        b = cell.bg_b;
      }
      fgRGB = (r << 16) | (g << 8) | b;
    }

    if (hasGlyph) {
      this.drawCellGlyph(cell, x, y, cellX, cellY, fgRGB);
    }

    // Decorations (only emit a stroke path if at least one is present).
    if (hasUnderline || hasStrike || hasOsc8 || hasRegexLink) {
      const fgCss = this.rgbCSSFromPacked(fgRGB);
      this.ctx.lineWidth = 1;

      if (hasUnderline || hasStrike) {
        this.setStrokeStyle(fgCss);
        this.ctx.beginPath();
        if (hasUnderline) {
          const ulY = cellY + this.metrics.baseline + 2;
          this.ctx.moveTo(cellX, ulY);
          this.ctx.lineTo(cellX + cellWidth, ulY);
        }
        if (hasStrike) {
          const stY = cellY + cellHeight / 2;
          this.ctx.moveTo(cellX, stY);
          this.ctx.lineTo(cellX + cellWidth, stY);
        }
        this.ctx.stroke();
      }
      // Link underlines render in their own color regardless of cell fg.
      if (hasOsc8 || hasRegexLink) {
        this.setStrokeStyle('#4A90E2');
        this.ctx.beginPath();
        const ulY = cellY + this.metrics.baseline + 2;
        this.ctx.moveTo(cellX, ulY);
        this.ctx.lineTo(cellX + cellWidth, ulY);
        this.ctx.stroke();
      }
    }
  }

  /**
   * Draw a cell's glyph via the atlas. Falls back to direct `fillText` if
   * the atlas is full or unavailable. Handles FAINT via globalAlpha.
   */
  private drawCellGlyph(
    cell: GhosttyCell,
    x: number,
    y: number,
    cellX: number,
    cellY: number,
    fgRGB: number
  ): void {
    const atlas = this.glyphAtlas;
    const glyphFlags = cell.flags & (CellFlags.BOLD | CellFlags.ITALIC);
    const faint = (cell.flags & CellFlags.FAINT) !== 0;

    // Resolve the character: simple codepoint or combined grapheme cluster.
    const isCombined = cell.grapheme_len > 0 && this.currentBuffer?.getGraphemeString != null;
    const chars = isCombined
      ? this.currentBuffer!.getGraphemeString!(y, x)
      : String.fromCodePoint(cell.codepoint || 32);

    if (atlas !== null) {
      let glyph = isCombined
        ? atlas.getCombined(chars, glyphFlags, fgRGB, cell.width)
        : atlas.getSimple(cell.codepoint || 32, glyphFlags, fgRGB, cell.width);

      // Atlas-full path: clear and try once. We don't loop because a single
      // glyph that doesn't fit the entire atlas would loop forever.
      if (glyph === null) {
        atlas.clear();
        glyph = isCombined
          ? atlas.getCombined(chars, glyphFlags, fgRGB, cell.width)
          : atlas.getSimple(cell.codepoint || 32, glyphFlags, fgRGB, cell.width);
      }

      if (glyph !== null) {
        if (faint) this.ctx.globalAlpha = 0.5;
        atlas.blit(this.ctx, glyph, cellX, cellY);
        if (faint) this.ctx.globalAlpha = 1.0;
        return;
      }
    }

    // Fallback: direct fillText (slower, no caching).
    let fontStyle = '';
    if (cell.flags & CellFlags.ITALIC) fontStyle += 'italic ';
    if (cell.flags & CellFlags.BOLD) fontStyle += 'bold ';
    this.setFont(`${fontStyle}${this.fontSize}px ${this.fontFamily}`);
    this.setFillStyle(this.rgbCSSFromPacked(fgRGB));
    if (faint) this.ctx.globalAlpha = 0.5;
    this.ctx.fillText(chars, cellX, cellY + this.metrics.baseline);
    if (faint) this.ctx.globalAlpha = 1.0;
  }

  private rgbCSSFromPacked(rgb: number): string {
    return this.rgbToCSS((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
  }

  /**
   * Render cursor
   */
  private renderCursor(x: number, y: number): void {
    const cursorX = x * this.metrics.width;
    const cursorY = y * this.metrics.height;

    this.setFillStyle(this.theme.cursor);

    switch (this.cursorStyle) {
      case 'block':
        // Full cell block
        this.ctx.fillRect(cursorX, cursorY, this.metrics.width, this.metrics.height);
        // Re-draw character under cursor with cursorAccent color
        {
          const line = this.currentBuffer?.getLine(y);
          if (line?.[x]) {
            // ctx.save/restore preserves font/fillStyle/strokeStyle, but our
            // cache mirrors what *we* last set — so after restore, our cache
            // is correct for the *post-restore* ctx state, which is identical
            // to what we had pre-save. We just need to bracket save/restore
            // the same way for our cache.
            const savedFont = this.cachedFont;
            const savedFill = this.cachedFillStyle;
            const savedStroke = this.cachedStrokeStyle;
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(cursorX, cursorY, this.metrics.width, this.metrics.height);
            this.ctx.clip();
            this.renderCellText(line[x], x, y, this.cursorAccentRGB);
            this.ctx.restore();
            this.cachedFont = savedFont;
            this.cachedFillStyle = savedFill;
            this.cachedStrokeStyle = savedStroke;
          }
        }
        break;

      case 'underline': {
        // Underline at bottom of cell
        const underlineHeight = Math.max(2, Math.floor(this.metrics.height * 0.15));
        this.ctx.fillRect(
          cursorX,
          cursorY + this.metrics.height - underlineHeight,
          this.metrics.width,
          underlineHeight
        );
        break;
      }

      case 'bar': {
        // Vertical bar at left of cell
        const barWidth = Math.max(2, Math.floor(this.metrics.width * 0.15));
        this.ctx.fillRect(cursorX, cursorY, barWidth, this.metrics.height);
        break;
      }
    }
  }

  // ==========================================================================
  // Cursor Blinking
  // ==========================================================================

  private startCursorBlink(): void {
    // xterm.js uses ~530ms blink interval
    this.cursorBlinkInterval = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      // Note: Render loop should redraw cursor line automatically
    }, 530);
  }

  private stopCursorBlink(): void {
    if (this.cursorBlinkInterval !== undefined) {
      clearInterval(this.cursorBlinkInterval);
      this.cursorBlinkInterval = undefined;
    }
    this.cursorVisible = true;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Update theme colors
   */
  public setTheme(theme: ITheme): void {
    this.theme = { ...DEFAULT_THEME, ...theme };
    this.recomputeThemeRGB();
    // Atlas glyphs are keyed by packed RGB, so existing entries remain
    // valid for unchanged colors. We don't clear the atlas here; new color
    // combinations from the new theme will simply rasterize on demand.

    // Rebuild palette
    this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite,
    ];
  }

  /**
   * Update font size
   */
  public setFontSize(size: number): void {
    this.fontSize = size;
    this.metrics = this.measureFont();
    this.rebuildGlyphAtlas();
  }

  /**
   * Update font family
   */
  public setFontFamily(family: string): void {
    this.fontFamily = family;
    this.metrics = this.measureFont();
    this.rebuildGlyphAtlas();
  }

  /**
   * Update cursor style
   */
  public setCursorStyle(style: 'block' | 'underline' | 'bar'): void {
    this.cursorStyle = style;
  }

  /**
   * Enable/disable cursor blinking
   */
  public setCursorBlink(enabled: boolean): void {
    if (enabled && !this.cursorBlink) {
      this.cursorBlink = true;
      this.startCursorBlink();
    } else if (!enabled && this.cursorBlink) {
      this.cursorBlink = false;
      this.stopCursorBlink();
    }
  }

  /**
   * Get current font metrics
   */

  /**
   * Render scrollbar (Phase 2)
   * Shows scroll position and allows click/drag interaction
   * @param opacity Opacity level (0-1) for fade in/out effect
   */
  private renderScrollbar(
    viewportY: number,
    scrollbackLength: number,
    visibleRows: number,
    opacity: number = 1
  ): void {
    const ctx = this.ctx;
    const canvasHeight = this.canvas.height / this.devicePixelRatio;
    const canvasWidth = this.canvas.width / this.devicePixelRatio;

    // Scrollbar dimensions
    const scrollbarWidth = 8;
    const scrollbarX = canvasWidth - scrollbarWidth - 4;
    const scrollbarPadding = 4;
    const scrollbarTrackHeight = canvasHeight - scrollbarPadding * 2;

    // Always clear the scrollbar area first (fixes ghosting when fading out)
    ctx.clearRect(scrollbarX - 2, 0, scrollbarWidth + 6, canvasHeight);
    this.setFillStyle(this.theme.background);
    ctx.fillRect(scrollbarX - 2, 0, scrollbarWidth + 6, canvasHeight);

    // Don't draw scrollbar if fully transparent or no scrollback
    if (opacity <= 0 || scrollbackLength === 0) return;

    // Calculate scrollbar thumb size and position
    const totalLines = scrollbackLength + visibleRows;
    const thumbHeight = Math.max(20, (visibleRows / totalLines) * scrollbarTrackHeight);

    // Position: 0 = at bottom, scrollbackLength = at top
    const scrollPosition = viewportY / scrollbackLength; // 0 to 1
    const thumbY = scrollbarPadding + (scrollbarTrackHeight - thumbHeight) * (1 - scrollPosition);

    // Draw scrollbar track (subtle background) with opacity. Opacity changes
    // every frame during fade, so caching the rgba string would always miss;
    // we still route through setFillStyle to keep the cache consistent.
    this.setFillStyle(`rgba(128, 128, 128, ${0.1 * opacity})`);
    ctx.fillRect(scrollbarX, scrollbarPadding, scrollbarWidth, scrollbarTrackHeight);

    // Draw scrollbar thumb with opacity
    const isScrolled = viewportY > 0;
    const baseOpacity = isScrolled ? 0.5 : 0.3;
    this.setFillStyle(`rgba(128, 128, 128, ${baseOpacity * opacity})`);
    ctx.fillRect(scrollbarX, thumbY, scrollbarWidth, thumbHeight);
  }
  public getMetrics(): FontMetrics {
    return { ...this.metrics };
  }

  /**
   * Get canvas element (needed by SelectionManager)
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Set selection manager (for rendering selection)
   */
  public setSelectionManager(manager: SelectionManager): void {
    this.selectionManager = manager;
  }

  /**
   * Check if a cell at (x, y) is within the current selection.
   * Uses cached selection coordinates for performance.
   */
  private isInSelection(x: number, y: number): boolean {
    const sel = this.currentSelectionCoords;
    if (!sel) return false;

    const { startCol, startRow, endCol, endRow } = sel;

    // Single line selection
    if (startRow === endRow) {
      return y === startRow && x >= startCol && x <= endCol;
    }

    // Multi-line selection
    if (y === startRow) {
      // First line: from startCol to end of line
      return x >= startCol;
    } else if (y === endRow) {
      // Last line: from start of line to endCol
      return x <= endCol;
    } else if (y > startRow && y < endRow) {
      // Middle lines: entire line is selected
      return true;
    }

    return false;
  }

  /**
   * Set the currently hovered hyperlink ID for rendering underlines
   */
  public setHoveredHyperlinkId(hyperlinkId: number): void {
    this.hoveredHyperlinkId = hyperlinkId;
  }

  /**
   * Set the currently hovered link range for rendering underlines (for regex-detected URLs)
   * Pass null to clear the hover state
   */
  public setHoveredLinkRange(
    range: {
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    } | null
  ): void {
    this.hoveredLinkRange = range;
  }

  /**
   * Get character cell width (for coordinate conversion)
   */
  public get charWidth(): number {
    return this.metrics.width;
  }

  /**
   * Get character cell height (for coordinate conversion)
   */
  public get charHeight(): number {
    return this.metrics.height;
  }

  /**
   * Clear entire canvas
   */
  public clear(): void {
    // clearRect first because fillRect composites rather than replaces,
    // so transparent/translucent backgrounds wouldn't clear previous content.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.setFillStyle(this.theme.background);
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stopCursorBlink();
    this.glyphAtlas?.dispose();
    this.glyphAtlas = null;
  }
}
