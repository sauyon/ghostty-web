/**
 * Selection Manager Tests
 *
 * Tests for text selection functionality including:
 * - Basic selection operations
 * - Absolute coordinate system for scroll persistence
 * - Selection clearing behavior
 * - Auto-scroll during drag selection
 * - Copy functionality with scrollback
 *
 * Test Isolation Pattern:
 * Uses createIsolatedTerminal() to ensure each test gets its own WASM instance.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

/**
 * Helper to set selection using absolute coordinates
 */
function setSelectionAbsolute(
  term: Terminal,
  startCol: number,
  startAbsRow: number,
  endCol: number,
  endAbsRow: number
): void {
  const selMgr = (term as any).selectionManager;
  if (selMgr) {
    (selMgr as any).selectionStart = { col: startCol, absoluteRow: startAbsRow };
    (selMgr as any).selectionEnd = { col: endCol, absoluteRow: endAbsRow };
  }
}

/**
 * Helper to convert viewport row to absolute row
 */
function viewportToAbsolute(term: Terminal, viewportRow: number): number {
  const scrollbackLength = term.wasmTerm?.getScrollbackLength() ?? 0;
  const viewportY = term.getViewportY();
  return scrollbackLength + viewportRow - Math.floor(viewportY);
}

describe('SelectionManager', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Construction', () => {
    test('creates without errors', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      expect(term).toBeDefined();
    });
  });

  describe('API', () => {
    test('has required public methods', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const selMgr = (term as any).selectionManager;
      expect(typeof selMgr.getSelection).toBe('function');
      expect(typeof selMgr.hasSelection).toBe('function');
      expect(typeof selMgr.clearSelection).toBe('function');
      expect(typeof selMgr.selectAll).toBe('function');
      expect(typeof selMgr.getSelectionCoords).toBe('function');
      expect(typeof selMgr.dispose).toBe('function');
      expect(typeof selMgr.getDirtySelectionRows).toBe('function');
      expect(typeof selMgr.clearDirtySelectionRows).toBe('function');

      term.dispose();
    });
  });

  describe('Selection with absolute coordinates', () => {
    test('hasSelection returns false when no selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('hasSelection returns true when selection exists', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      // Set selection using absolute coordinates
      setSelectionAbsolute(term, 0, 0, 5, 0);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(true);

      term.dispose();
    });

    test('hasSelection returns true for single cell programmatic selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      // Programmatic single-cell selection should be valid
      // (e.g., triple-click on single-char line, or select(col, row, 1))
      setSelectionAbsolute(term, 5, 0, 5, 0);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(true);

      term.dispose();
    });

    test('clearSelection clears selection and marks rows dirty', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen + 2);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.hasSelection()).toBe(true);

      selMgr.clearSelection();

      expect(selMgr.hasSelection()).toBe(false);
      // Dirty rows should be marked for redraw
      const dirtyRows = selMgr.getDirtySelectionRows();
      expect(dirtyRows.size).toBeGreaterThan(0);

      term.dispose();
    });
  });

  describe('Selection text extraction', () => {
    test('getSelection returns empty string when no selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.getSelection()).toBe('');

      term.dispose();
    });

    test('getSelection extracts text from screen buffer', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select "Hello" (first 5 characters)
      setSelectionAbsolute(term, 0, scrollbackLen, 4, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.getSelection()).toBe('Hello');

      term.dispose();
    });

    test('getSelection extracts multi-line text', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select all three lines
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen + 2);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');
      expect(text).toContain('Line 3');

      term.dispose();
    });

    test('getSelection extracts text from scrollback', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write enough lines to create scrollback
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      expect(scrollbackLen).toBeGreaterThan(0);

      // Select from scrollback (first few lines)
      setSelectionAbsolute(term, 0, 0, 10, 2);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toContain('Line 000');
      expect(text).toContain('Line 001');
      expect(text).toContain('Line 002');

      term.dispose();
    });

    test('getSelection extracts text spanning scrollback and screen', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write enough lines to fill scrollback and screen
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();

      // Select spanning scrollback and screen
      // End of scrollback through beginning of screen
      setSelectionAbsolute(term, 0, scrollbackLen - 2, 10, scrollbackLen + 2);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      // Should contain lines from both regions
      expect(text.split('\n').length).toBeGreaterThanOrEqual(4);

      term.dispose();
    });
  });

  describe('Selection persistence during scroll', () => {
    test('selection coordinates are preserved when scrolling', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write content
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();

      // Set selection at specific absolute position
      const startAbsRow = scrollbackLen + 5;
      const endAbsRow = scrollbackLen + 10;
      setSelectionAbsolute(term, 0, startAbsRow, 10, endAbsRow);

      const selMgr = (term as any).selectionManager;
      const textBefore = selMgr.getSelection();

      // Scroll up
      term.scrollLines(-10);

      // Selection should still return the same text
      const textAfter = selMgr.getSelection();
      expect(textAfter).toBe(textBefore);

      term.dispose();
    });

    test('selection coords convert correctly after scrolling', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write content
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();

      // Set selection in screen buffer area
      setSelectionAbsolute(term, 0, scrollbackLen, 10, scrollbackLen + 5);

      const selMgr = (term as any).selectionManager;

      // Get viewport coords before scroll
      const coordsBefore = selMgr.getSelectionCoords();
      expect(coordsBefore).not.toBeNull();

      // Scroll up 10 lines
      term.scrollLines(-10);

      // Get viewport coords after scroll - they should have shifted
      const coordsAfter = selMgr.getSelectionCoords();
      expect(coordsAfter).not.toBeNull();

      // Viewport row should have increased by the scroll amount
      expect(coordsAfter!.startRow).toBe(coordsBefore!.startRow + 10);
      expect(coordsAfter!.endRow).toBe(coordsBefore!.endRow + 10);

      term.dispose();
    });

    test('selection outside viewport returns null coords but preserves text', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);

      // Write content
      for (let i = 0; i < 100; i++) {
        term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
      }

      // Select near the bottom of the buffer
      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen + 10, 10, scrollbackLen + 15);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      // Scroll to top - selection should be way off screen
      term.scrollToTop();

      // Coords should be null (off screen) but text should still work
      const coords = selMgr.getSelectionCoords();
      expect(coords).toBeNull();

      // Text extraction should still work
      expect(selMgr.getSelection()).toBe(text);

      term.dispose();
    });
  });

  describe('Dirty row tracking', () => {
    test('getDirtySelectionRows returns empty set initially', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const selMgr = (term as any).selectionManager;
      expect(selMgr.getDirtySelectionRows().size).toBe(0);

      term.dispose();
    });

    test('clearSelection marks selection rows as dirty', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Test content\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen + 3);

      const selMgr = (term as any).selectionManager;
      selMgr.clearSelection();

      const dirtyRows = selMgr.getDirtySelectionRows();
      expect(dirtyRows.size).toBeGreaterThan(0);

      term.dispose();
    });

    test('clearDirtySelectionRows clears the set', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Test\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen, 5, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      selMgr.clearSelection();

      expect(selMgr.getDirtySelectionRows().size).toBeGreaterThan(0);

      selMgr.clearDirtySelectionRows();

      expect(selMgr.getDirtySelectionRows().size).toBe(0);

      term.dispose();
    });
  });

  describe('Backward selection', () => {
    test('handles selection from right to left', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select backwards (end before start)
      setSelectionAbsolute(term, 10, scrollbackLen, 0, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toBe('Hello World');

      term.dispose();
    });

    test('handles selection from bottom to top', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      // Select backwards (end row before start row)
      setSelectionAbsolute(term, 5, scrollbackLen + 2, 0, scrollbackLen);

      const selMgr = (term as any).selectionManager;
      const text = selMgr.getSelection();

      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');
      expect(text).toContain('Line 3');

      term.dispose();
    });
  });

  describe('selectAll', () => {
    test('selectAll selects entire viewport', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello\r\nWorld\r\n');

      const selMgr = (term as any).selectionManager;
      selMgr.selectAll();

      expect(selMgr.hasSelection()).toBe(true);

      const coords = selMgr.getSelectionCoords();
      expect(coords).not.toBeNull();
      expect(coords!.startRow).toBe(0);
      expect(coords!.startCol).toBe(0);
      expect(coords!.endRow).toBe(23); // rows - 1

      term.dispose();
    });
  });

  describe('select() API', () => {
    test('select() creates selection at specified position', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      selMgr.select(0, 0, 5);

      expect(selMgr.hasSelection()).toBe(true);
      expect(selMgr.getSelection()).toBe('Hello');

      term.dispose();
    });
  });

  describe('selectLines() API', () => {
    test('selectLines() selects entire lines', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Line 1\r\nLine 2\r\nLine 3\r\n');

      const selMgr = (term as any).selectionManager;
      selMgr.selectLines(0, 1);

      expect(selMgr.hasSelection()).toBe(true);

      const text = selMgr.getSelection();
      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');

      term.dispose();
    });
  });

  describe('scrollback content accuracy', () => {
    test('getScrollbackLine returns correct content after lines scroll off', async () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: 800 });
      Object.defineProperty(container, 'clientHeight', { value: 480 });
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      // Write 50 lines to push content into scrollback (terminal has 24 rows)
      for (let i = 0; i < 50; i++) {
        term.write(`Line ${i}\r\n`);
      }

      const wasmTerm = (term as any).wasmTerm;
      const scrollbackLen = wasmTerm.getScrollbackLength();
      expect(scrollbackLen).toBeGreaterThan(0);

      // First scrollback line (oldest) should contain "Line 0"
      const firstLine = wasmTerm.getScrollbackLine(0);
      expect(firstLine).not.toBeNull();
      const firstText = firstLine!
        .map((c: any) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ''))
        .join('')
        .trim();
      expect(firstText).toContain('Line 0');

      // Last scrollback line should contain content near the boundary
      const lastLine = wasmTerm.getScrollbackLine(scrollbackLen - 1);
      expect(lastLine).not.toBeNull();
      const lastText = lastLine!
        .map((c: any) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ''))
        .join('')
        .trim();
      // The last scrollback line is the one just above the visible viewport
      expect(lastText).toMatch(/Line \d+/);

      term.dispose();
    });

    test('selection clears when user types', async () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: 800 });
      Object.defineProperty(container, 'clientHeight', { value: 480 });
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      selMgr.selectLines(0, 0);
      expect(selMgr.hasSelection()).toBe(true);

      // Simulate the input callback clearing selection
      // The actual input handler calls clearSelection before firing data
      selMgr.clearSelection();
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('triple-click selects correct line in scrollback region', async () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: 800 });
      Object.defineProperty(container, 'clientHeight', { value: 480 });
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      // Write enough lines to create scrollback
      for (let i = 0; i < 50; i++) {
        term.write(`TestLine${i}\r\n`);
      }

      const wasmTerm = (term as any).wasmTerm;
      const scrollbackLen = wasmTerm.getScrollbackLength();
      expect(scrollbackLen).toBeGreaterThan(0);

      // Verify multiple scrollback lines have correct content
      for (let i = 0; i < Math.min(5, scrollbackLen); i++) {
        const line = wasmTerm.getScrollbackLine(i);
        expect(line).not.toBeNull();
        const text = line!
          .map((c: any) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ''))
          .join('')
          .trim();
        expect(text).toContain(`TestLine${i}`);
      }

      // Use selectLines to select a single line and verify content
      const selMgr = (term as any).selectionManager;
      selMgr.selectLines(0, 0);
      expect(selMgr.hasSelection()).toBe(true);
      const selectedText = selMgr.getSelection();
      expect(selectedText.length).toBeGreaterThan(0);

      term.dispose();
    });
  });

  describe('Touch selection (tap-and-hold)', () => {
    type Point = { id?: number; x: number; y: number };
    // Helper to dispatch a TouchEvent. `points` populates `touches` (fingers
    // currently down). `changed`, when provided, populates `changedTouches`
    // (fingers that triggered this specific event); otherwise mirrors `points`.
    // For touchend/touchcancel: `points` should be remaining-down fingers
    // and `changed` should be the lifted/cancelled fingers.
    function dispatchTouch(
      canvas: HTMLCanvasElement,
      type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
      points: Point[],
      changed?: Point[]
    ): TouchEvent {
      const rect = canvas.getBoundingClientRect();
      const toTouches = (pts: Point[]) =>
        pts.map((p) => ({
          identifier: p.id ?? 0,
          clientX: rect.left + p.x,
          clientY: rect.top + p.y,
          target: canvas,
        }));
      const touches = toTouches(points);
      const changedTouches = changed ? toTouches(changed) : touches;
      const ev = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: touches as any,
        targetTouches: touches as any,
        changedTouches: changedTouches as any,
      });
      canvas.dispatchEvent(ev);
      return ev;
    }

    test('touchstart arms long-press timer; long-press creates selection of word at touch', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      // Touch the cell over the second letter of "Hello"
      const x = metrics.width * 1 + metrics.width / 2;
      const y = metrics.height * 0 + metrics.height / 2;

      expect(selMgr.hasSelection()).toBe(false);
      dispatchTouch(canvas, 'touchstart', [{ x, y }]);
      expect(selMgr.hasSelection()).toBe(false); // long-press hasn't fired yet
      expect(selMgr.longPressTimer).not.toBeNull();

      // Wait for long-press timer (500ms) to fire
      await Bun.sleep(560);

      expect(selMgr.isTouchSelecting).toBe(true);
      expect(selMgr.hasSelection()).toBe(true);
      // Selection should be the word "Hello"
      expect(selMgr.getSelection()).toBe('Hello');

      term.dispose();
    });

    test('touchmove past tolerance before long-press cancels the timer', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const canvas: HTMLCanvasElement = (term as any).renderer.getCanvas();

      dispatchTouch(canvas, 'touchstart', [{ x: 20, y: 20 }]);
      expect(selMgr.longPressTimer).not.toBeNull();

      // Move >10px - tolerance is 10px
      dispatchTouch(canvas, 'touchmove', [{ x: 60, y: 60 }]);
      expect(selMgr.longPressTimer).toBeNull();

      // Wait past the long-press window to confirm it never fires
      await Bun.sleep(560);
      expect(selMgr.isTouchSelecting).toBe(false);
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('multi-touch (pinch/zoom) cancels long-press', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const canvas: HTMLCanvasElement = (term as any).renderer.getCanvas();

      dispatchTouch(canvas, 'touchstart', [{ x: 20, y: 20 }]);
      expect(selMgr.longPressTimer).not.toBeNull();

      // Second finger touches down - should cancel long-press
      dispatchTouch(canvas, 'touchstart', [
        { id: 0, x: 20, y: 20 },
        { id: 1, x: 100, y: 100 },
      ]);
      expect(selMgr.longPressTimer).toBeNull();

      term.dispose();
    });

    test('touchmove during active selection extends it', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      // Long-press on "H" of Hello
      const startX = metrics.width * 0 + metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ x: startX, y }]);
      await Bun.sleep(560);
      expect(selMgr.isTouchSelecting).toBe(true);
      const initialText = selMgr.getSelection();
      expect(initialText).toBe('Hello');

      // Drag finger to column 10 (middle of "World") to extend selection
      const endX = metrics.width * 10 + metrics.width / 2;
      dispatchTouch(canvas, 'touchmove', [{ x: endX, y }]);

      // Selection end should now be at column 10
      expect(selMgr.selectionEnd.col).toBe(10);
      const extended = selMgr.getSelection();
      expect(extended.length).toBeGreaterThan(initialText.length);
      expect(extended).toContain('Hello');
      expect(extended).toContain('Wo');

      term.dispose();
    });

    test('touchend without long-press leaves no selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const canvas: HTMLCanvasElement = (term as any).renderer.getCanvas();

      dispatchTouch(canvas, 'touchstart', [{ x: 20, y: 20 }]);
      // Immediately end - simulates a tap
      dispatchTouch(canvas, 'touchend', [{ x: 20, y: 20 }]);
      expect(selMgr.longPressTimer).toBeNull();
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('touchend after long-press finalizes selection and fires change event', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      let changeFires = 0;
      selMgr.onSelectionChange(() => {
        changeFires++;
      });

      const x = metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ x, y }]);
      await Bun.sleep(560);

      const firesBeforeEnd = changeFires;
      dispatchTouch(canvas, 'touchend', [{ x, y }]);

      expect(selMgr.isTouchSelecting).toBe(false);
      expect(selMgr.hasSelection()).toBe(true);
      // touchend should fire one final selection-change event with the copied text
      expect(changeFires).toBeGreaterThan(firesBeforeEnd);

      term.dispose();
    });

    test('starting a new touch clears prior selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const canvas: HTMLCanvasElement = (term as any).renderer.getCanvas();

      // Pre-existing programmatic selection
      const scrollbackLen = term.wasmTerm!.getScrollbackLength();
      setSelectionAbsolute(term, 0, scrollbackLen, 4, scrollbackLen);
      expect(selMgr.hasSelection()).toBe(true);

      // A new tap (no long-press) should clear it
      dispatchTouch(canvas, 'touchstart', [{ x: 5, y: 5 }]);
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('dispose cancels pending long-press timer', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const canvas: HTMLCanvasElement = (term as any).renderer.getCanvas();

      dispatchTouch(canvas, 'touchstart', [{ x: 5, y: 5 }]);
      expect(selMgr.longPressTimer).not.toBeNull();

      term.dispose();
      expect(selMgr.longPressTimer).toBeNull();

      // Even after the would-be long-press window, nothing fires
      await Bun.sleep(560);
      expect(selMgr.isTouchSelecting).toBe(false);
    });

    test('rapid touchstart cancels prior pending long-press timer', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const canvas: HTMLCanvasElement = (term as any).renderer.getCanvas();

      dispatchTouch(canvas, 'touchstart', [{ x: 5, y: 5 }]);
      const firstTimer = selMgr.longPressTimer;
      expect(firstTimer).not.toBeNull();

      // Second touchstart arrives before the first timer fires - the prior
      // timer should be cancelled so we never get a double-fire.
      dispatchTouch(canvas, 'touchstart', [{ x: 5, y: 5 }]);
      const secondTimer = selMgr.longPressTimer;
      expect(secondTimer).not.toBeNull();
      expect(secondTimer).not.toBe(firstTimer);

      term.dispose();
    });

    test('touchcancel during selection aborts (does not commit)', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      const x = metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ x, y }]);
      await Bun.sleep(560);
      expect(selMgr.isTouchSelecting).toBe(true);
      expect(selMgr.hasSelection()).toBe(true);

      // OS interrupts the gesture - selection should be dropped
      dispatchTouch(canvas, 'touchcancel', [{ x, y }]);
      expect(selMgr.isTouchSelecting).toBe(false);
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('clearSelection resets dragThresholdMet so anti-flash starts fresh', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;

      // Simulate the state that startTouchSelection leaves behind
      selMgr.dragThresholdMet = true;
      selMgr.selectionStart = { col: 0, absoluteRow: 0 };
      selMgr.selectionEnd = { col: 4, absoluteRow: 0 };
      expect(selMgr.hasSelection()).toBe(true);

      selMgr.clearSelection();
      expect(selMgr.dragThresholdMet).toBe(false);

      term.dispose();
    });

    test('terminal touchend does not steal focus when a touch selection is active', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();
      const textarea = term.textarea!;

      // Spy on textarea.focus to detect terminal.ts's would-be focus call
      let focusCalls = 0;
      const originalFocus = textarea.focus.bind(textarea);
      textarea.focus = () => {
        focusCalls++;
        originalFocus();
      };

      const x = metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ x, y }]);
      await Bun.sleep(560);
      expect(selMgr.hasSelection()).toBe(true);

      focusCalls = 0;
      dispatchTouch(canvas, 'touchend', [{ x, y }]);

      // terminal.ts's touchend should have returned early without focusing
      // the hidden textarea, leaving keyboard focus on the canvas parent.
      expect(focusCalls).toBe(0);
      expect(selMgr.hasSelection()).toBe(true);
    });

    test('terminal touchend focuses textarea on a plain tap (no selection)', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);

      const canvas: HTMLCanvasElement = (term as any).renderer.getCanvas();
      const textarea = term.textarea!;

      let focusCalls = 0;
      const originalFocus = textarea.focus.bind(textarea);
      textarea.focus = () => {
        focusCalls++;
        originalFocus();
      };

      dispatchTouch(canvas, 'touchstart', [{ x: 5, y: 5 }]);
      dispatchTouch(canvas, 'touchend', [{ x: 5, y: 5 }]);

      // Plain tap (no long-press) - textarea should be focused for keyboard input
      expect(focusCalls).toBe(1);

      term.dispose();
    });

    test('secondary finger lifting during selection does not commit', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      let changeFires = 0;
      selMgr.onSelectionChange(() => {
        changeFires++;
      });

      // Primary finger long-press → selection active
      const x = metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ id: 0, x, y }]);
      await Bun.sleep(560);
      expect(selMgr.isTouchSelecting).toBe(true);
      const firesAfterSelection = changeFires;

      // Secondary finger lifts (touchend with changedTouches=[id 1] while
      // primary finger id 0 stays down). Should NOT commit the selection.
      dispatchTouch(
        canvas,
        'touchend',
        [{ id: 0, x, y }], // touches: primary still down
        [{ id: 1, x: 100, y: 100 }] // changedTouches: secondary finger
      );

      expect(selMgr.isTouchSelecting).toBe(true);
      expect(selMgr.hasSelection()).toBe(true);
      expect(changeFires).toBe(firesAfterSelection); // no extra commit-fire

      // Primary finger lifts - now we should commit
      dispatchTouch(canvas, 'touchend', [], [{ id: 0, x, y }]);
      expect(selMgr.isTouchSelecting).toBe(false);
      expect(changeFires).toBeGreaterThan(firesAfterSelection);

      term.dispose();
    });

    test('secondary finger cancellation does not abort selection', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      const x = metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ id: 0, x, y }]);
      await Bun.sleep(560);
      expect(selMgr.isTouchSelecting).toBe(true);

      // Secondary finger gets cancelled (palm rejection etc.)
      dispatchTouch(
        canvas,
        'touchcancel',
        [{ id: 0, x, y }], // primary still down
        [{ id: 1, x: 100, y: 100 }] // secondary cancelled
      );

      // Primary selection must survive
      expect(selMgr.isTouchSelecting).toBe(true);
      expect(selMgr.hasSelection()).toBe(true);

      term.dispose();
    });

    test('long-press on a link activates instead of selecting', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      // Replace the wired-up activation callback with a probe that always
      // consumes the gesture, regardless of position.
      let probeCalls = 0;
      let probedCol = -1;
      let probedRow = -1;
      selMgr.onLongPressActivation = (col: number, row: number) => {
        probeCalls++;
        probedCol = col;
        probedRow = row;
        return true; // consumed → no selection
      };

      const x = metrics.width * 2 + metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ x, y }]);
      await Bun.sleep(560);

      // Probe was called with the touched cell
      expect(probeCalls).toBe(1);
      expect(probedCol).toBe(2);
      expect(probedRow).toBeGreaterThanOrEqual(0);

      // Gesture consumed - no selection state
      expect(selMgr.isTouchSelecting).toBe(false);
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('long-press falls through to word selection when callback returns false', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      let probeCalls = 0;
      selMgr.onLongPressActivation = () => {
        probeCalls++;
        return false; // not a link → fall through
      };

      const x = metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ x, y }]);
      await Bun.sleep(560);

      expect(probeCalls).toBe(1);
      expect(selMgr.isTouchSelecting).toBe(true);
      expect(selMgr.getSelection()).toBe('Hello');

      term.dispose();
    });

    test('async activation callback is awaited; touch lifted during probe does not select', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container);
      term.write('Hello World\r\n');

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      // Callback delays so we can lift the finger mid-probe
      let resolveProbe: (v: boolean) => void;
      selMgr.onLongPressActivation = () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve;
        });

      const x = metrics.width / 2;
      const y = metrics.height / 2;
      dispatchTouch(canvas, 'touchstart', [{ x, y }]);
      await Bun.sleep(560);

      // Long-press fired and is now awaiting the link probe. Lift finger.
      dispatchTouch(canvas, 'touchend', [], [{ x, y }]);
      expect(selMgr.activeTouchId).toBe(null);

      // Resolve the probe with "not a link" - but the gesture was already
      // abandoned, so SelectionManager should not start a word selection.
      resolveProbe!(false);
      await Bun.sleep(10);

      expect(selMgr.isTouchSelecting).toBe(false);
      expect(selMgr.hasSelection()).toBe(false);

      term.dispose();
    });

    test('touchmove past canvas bottom edge triggers downward auto-scroll', async () => {
      if (!container) return;

      const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
      term.open(container);
      // Fill scrollback so there is content to scroll into
      for (let i = 0; i < 100; i++) {
        term.write(`Line ${i}\r\n`);
      }

      const selMgr = (term as any).selectionManager;
      const renderer = (term as any).renderer;
      const canvas: HTMLCanvasElement = renderer.getCanvas();
      const metrics = renderer.getMetrics();

      // happy-dom returns 0 for clientHeight (no real layout); stub it so the
      // auto-scroll edge detection has a sensible viewport size to work with.
      const visibleHeight = metrics.height * 24;
      Object.defineProperty(canvas, 'clientHeight', {
        configurable: true,
        get: () => visibleHeight,
      });

      // Long-press near the middle of the canvas (away from both edges)
      const middleY = visibleHeight / 2;
      dispatchTouch(canvas, 'touchstart', [{ x: metrics.width / 2, y: middleY }]);
      await Bun.sleep(560);
      expect(selMgr.isTouchSelecting).toBe(true);

      // Drag finger past the bottom edge - should kick off downward auto-scroll
      const bottomY = visibleHeight + 10;
      dispatchTouch(canvas, 'touchmove', [{ x: metrics.width / 2, y: bottomY }]);
      expect(selMgr.autoScrollDirection).toBe(1);
      expect(selMgr.autoScrollInterval).not.toBeNull();

      // Pull finger back to the middle - auto-scroll should stop
      dispatchTouch(canvas, 'touchmove', [{ x: metrics.width / 2, y: middleY }]);
      expect(selMgr.autoScrollDirection).toBe(0);

      term.dispose();
    });
  });
});
