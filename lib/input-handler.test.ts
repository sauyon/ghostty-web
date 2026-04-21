/**
 * Unit tests for InputHandler
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { InputHandler } from './input-handler';
import { Key, KeyAction, Mods } from './types';

// Mock DOM types for testing
interface MockKeyboardEvent {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface MockClipboardEvent {
  type: string;
  clipboardData: {
    getData: (format: string) => string;
    setData: (format: string, data: string) => void;
  } | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}
interface MockInputEvent {
  type: string;
  inputType: string;
  data: string | null;
  isComposing?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface MockHTMLElement {
  addEventListener: (event: string, handler: (e: any) => void) => void;
  removeEventListener: (event: string, handler: (e: any) => void) => void;
  childNodes: Node[];
  removeChild: (node: Node) => Node;
  appendChild: (node: Node) => Node;
}

// Helper to create mock keyboard event
function createKeyEvent(
  code: string,
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): MockKeyboardEvent {
  return {
    code,
    key,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    metaKey: modifiers.meta ?? false,
    repeat: false,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}

// Helper to create mock clipboard event
function createClipboardEvent(text: string | null): MockClipboardEvent {
  const data = new Map<string, string>();
  if (text !== null) {
    data.set('text/plain', text);
  }

  return {
    type: 'paste',
    clipboardData:
      text !== null
        ? {
            getData: (format: string) => data.get(format) || '',
            setData: (format: string, value: string) => {
              data.set(format, value);
            },
          }
        : null,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}

// Helper to create mock beforeinput event
function createBeforeInputEvent(inputType: string, data: string | null): MockInputEvent {
  return {
    type: 'beforeinput',
    inputType,
    data,
    isComposing: false,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}
interface MockCompositionEvent {
  type: string;
  data: string | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

// Helper to create mock composition event
function createCompositionEvent(
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  data: string | null
): MockCompositionEvent {
  return {
    type,
    data,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}
// Helper to create mock container
function createMockContainer(): MockHTMLElement & {
  _listeners: Map<string, ((e: any) => void)[]>;
  dispatchEvent: (event: any) => void;
} {
  const listeners = new Map<string, ((e: any) => void)[]>();

  return {
    _listeners: listeners,
    addEventListener(event: string, handler: (e: any) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    },
    removeEventListener(event: string, handler: (e: any) => void) {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    },
    dispatchEvent(event: any) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
    // Mock childNodes and removeChild for text node cleanup test
    childNodes: [] as Node[],
    removeChild(node: Node) {
      const index = this.childNodes.indexOf(node);
      if (index >= 0) {
        this.childNodes.splice(index, 1);
      }
      return node;
    },
    appendChild(node: Node) {
      this.childNodes.push(node);
      return node;
    },
  };
}

// Helper to simulate key event
function simulateKey(
  container: ReturnType<typeof createMockContainer>,
  event: MockKeyboardEvent
): void {
  const handlers = container._listeners.get('keydown') || [];
  for (const handler of handlers) {
    handler(event);
  }
}

describe('InputHandler', () => {
  let ghostty: Ghostty;
  let container: ReturnType<typeof createMockContainer>;
  let dataReceived: string[];
  let bellCalled: boolean;

  beforeEach(async () => {
    // Create a fresh Ghostty WASM instance for complete test isolation
    ghostty = await Ghostty.load();

    // Create mock container for each test
    container = createMockContainer();

    // Reset data tracking
    dataReceived = [];
    bellCalled = false;
  });

  describe('Constructor and Lifecycle', () => {
    test('creates handler and attaches listeners', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      expect(handler.isActive()).toBe(true);
      expect(container._listeners.has('keydown')).toBe(true);
      expect(container._listeners.get('keydown')!.length).toBe(1);
    });

    test('dispose removes listeners and marks inactive', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      handler.dispose();

      expect(handler.isActive()).toBe(false);
      expect(container._listeners.get('keydown')!.length).toBe(0);
    });

    test('dispose is idempotent', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      handler.dispose();
      handler.dispose(); // Second call should not throw

      expect(handler.isActive()).toBe(false);
    });
  });

  describe('Printable Characters', () => {
    test('encodes lowercase letters', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a'));
      expect(dataReceived).toEqual(['a']);

      simulateKey(container, createKeyEvent('KeyZ', 'z'));
      expect(dataReceived).toEqual(['a', 'z']);
    });

    test('encodes uppercase letters (with shift)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'A', { shift: true }));
      expect(dataReceived).toEqual(['A']);
    });

    test('encodes digits', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Digit0', '0'));
      simulateKey(container, createKeyEvent('Digit5', '5'));
      simulateKey(container, createKeyEvent('Digit9', '9'));

      expect(dataReceived).toEqual(['0', '5', '9']);
    });

    test('encodes punctuation', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Comma', ','));
      simulateKey(container, createKeyEvent('Period', '.'));
      simulateKey(container, createKeyEvent('Slash', '/'));

      expect(dataReceived).toEqual([',', '.', '/']);
    });

    test('encodes space', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Space', ' '));
      expect(dataReceived).toEqual([' ']);
    });
  });

  describe('IME Composition', () => {
    test('handles composition sequence', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Start composition
      const startEvent = createCompositionEvent('compositionstart', '');
      container.dispatchEvent(startEvent);

      // Update composition (typing)
      const updateEvent1 = createCompositionEvent('compositionupdate', 'n');
      container.dispatchEvent(updateEvent1);

      // Keydown events during composition should be ignored
      const keyEvent1 = createKeyEvent('KeyN', 'n');
      Object.defineProperty(keyEvent1, 'isComposing', { value: true });
      simulateKey(container, keyEvent1);

      // Update composition (more typing)
      const updateEvent2 = createCompositionEvent('compositionupdate', 'ni');
      container.dispatchEvent(updateEvent2);

      // End composition (commit)
      const endEvent = createCompositionEvent('compositionend', '你好');
      container.dispatchEvent(endEvent);

      // Should only receive the final committed text
      expect(dataReceived).toEqual(['你好']);
    });

    test('ignores keydown during composition', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Start composition
      container.dispatchEvent(createCompositionEvent('compositionstart', ''));

      // Simulate keydown with isComposing=true
      const keyEvent = createKeyEvent('KeyA', 'a');
      Object.defineProperty(keyEvent, 'isComposing', { value: true });
      simulateKey(container, keyEvent);

      // Simulate keydown with keyCode 229
      const keyEvent229 = createKeyEvent('KeyB', 'b');
      Object.defineProperty(keyEvent229, 'keyCode', { value: 229 });
      simulateKey(container, keyEvent229);

      // Should not receive any data
      expect(dataReceived.length).toBe(0);

      // End composition
      container.dispatchEvent(createCompositionEvent('compositionend', 'a'));
      expect(dataReceived).toEqual(['a']);
    });

    test('cleans up text nodes in container after composition', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Simulate browser inserting text node during composition
      const textNode = { nodeType: 3, textContent: '你好' } as Node;
      container.appendChild(textNode);

      // Also add a non-text node (e.g. canvas) to ensure it's not removed
      const elementNode = { nodeType: 1, nodeName: 'CANVAS' } as Node;
      container.appendChild(elementNode);

      expect(container.childNodes.length).toBe(2);

      // End composition
      const endEvent = createCompositionEvent('compositionend', '你好');
      container.dispatchEvent(endEvent);

      // Should have removed the text node but kept the element node
      expect(container.childNodes.length).toBe(1);
      expect(container.childNodes[0]).toBe(elementNode);
      expect(dataReceived).toEqual(['你好']);
    });

    test('avoids duplicate commit when compositionend fires before beforeinput', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      container.dispatchEvent(createCompositionEvent('compositionend', '你好'));
      inputElement.dispatchEvent(createBeforeInputEvent('insertText', '你好'));

      expect(dataReceived).toEqual(['你好']);
    });

    test('avoids duplicate commit when beforeinput fires before compositionend', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      inputElement.dispatchEvent(createBeforeInputEvent('insertText', '你好'));
      container.dispatchEvent(createCompositionEvent('compositionend', '你好'));

      expect(dataReceived).toEqual(['你好']);
    });
  });

  describe('Control Characters', () => {
    test('encodes Ctrl+A', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+A should produce 0x01
      expect(dataReceived[0].charCodeAt(0)).toBe(0x01);
    });

    test('encodes Ctrl+C', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyC', 'c', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+C should produce 0x03
      expect(dataReceived[0].charCodeAt(0)).toBe(0x03);
    });

    test('encodes Ctrl+D', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyD', 'd', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+D should produce 0x04
      expect(dataReceived[0].charCodeAt(0)).toBe(0x04);
    });

    test('encodes Ctrl+Z', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyZ', 'z', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+Z should produce 0x1A (26)
      expect(dataReceived[0].charCodeAt(0)).toBe(0x1a);
    });

    test('Cmd+C allows copy (no data sent)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyC', 'c', { meta: true }));

      // Cmd+C should NOT send data - it should allow copy operation
      // SelectionManager handles the actual copying
      expect(dataReceived.length).toBe(0);
    });
  });

  describe('Special Keys', () => {
    test('encodes Enter', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Enter', 'Enter'));

      expect(dataReceived.length).toBe(1);
      // Enter should produce \r (0x0D)
      expect(dataReceived[0]).toBe('\r');
    });

    test('encodes Tab', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Tab', 'Tab'));

      expect(dataReceived.length).toBe(1);
      // Tab should produce \t (0x09)
      expect(dataReceived[0]).toBe('\t');
    });

    test('encodes Escape', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Escape', 'Escape'));

      expect(dataReceived.length).toBe(1);
      // Escape should produce ESC (0x1B)
      expect(dataReceived[0].charCodeAt(0)).toBe(0x1b);
    });

    test('encodes Backspace', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Backspace', 'Backspace'));

      expect(dataReceived.length).toBe(1);
      // Backspace should produce 0x7F (DEL) or 0x08 (BS)
      const code = dataReceived[0].charCodeAt(0);
      expect(code === 0x7f || code === 0x08).toBe(true);
    });
  });

  describe('Arrow Keys', () => {
    test('encodes Up arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));

      expect(dataReceived.length).toBe(1);
      // Arrow keys produce ESC[A, ESC[B, ESC[C, ESC[D or ESCOA, ESCOB, ESCOC, ESCOD
      expect(dataReceived[0]).toMatch(/\x1b(\[A|OA)/);
    });

    test('encodes Down arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowDown', 'ArrowDown'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[B|OB)/);
    });

    test('encodes Left arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowLeft', 'ArrowLeft'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[D|OD)/);
    });

    test('encodes Right arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowRight', 'ArrowRight'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[C|OC)/);
    });

    test('sends CSI sequences in normal cursor mode (mode 1 off)', () => {
      // Create handler with getMode callback that returns false (normal mode)
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (_mode: number) => false // Normal cursor mode
      );

      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));
      simulateKey(container, createKeyEvent('ArrowDown', 'ArrowDown'));
      simulateKey(container, createKeyEvent('ArrowLeft', 'ArrowLeft'));
      simulateKey(container, createKeyEvent('ArrowRight', 'ArrowRight'));

      expect(dataReceived.length).toBe(4);
      // Normal mode: CSI sequences (ESC[A, ESC[B, ESC[D, ESC[C)
      expect(dataReceived[0]).toBe('\x1b[A');
      expect(dataReceived[1]).toBe('\x1b[B');
      expect(dataReceived[2]).toBe('\x1b[D');
      expect(dataReceived[3]).toBe('\x1b[C');
    });

    test('sends SS3 sequences in application cursor mode (mode 1 on)', () => {
      // Create handler with getMode callback that returns true for mode 1
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (mode: number) => mode === 1 // Application cursor mode enabled
      );

      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));
      simulateKey(container, createKeyEvent('ArrowDown', 'ArrowDown'));
      simulateKey(container, createKeyEvent('ArrowLeft', 'ArrowLeft'));
      simulateKey(container, createKeyEvent('ArrowRight', 'ArrowRight'));

      expect(dataReceived.length).toBe(4);
      // Application mode: SS3 sequences (ESCOA, ESCOB, ESCOD, ESCOC)
      expect(dataReceived[0]).toBe('\x1bOA');
      expect(dataReceived[1]).toBe('\x1bOB');
      expect(dataReceived[2]).toBe('\x1bOD');
      expect(dataReceived[3]).toBe('\x1bOC');
    });
  });

  describe('Function Keys', () => {
    test('encodes F1', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('F1', 'F1'));

      expect(dataReceived.length).toBe(1);
      // F1 produces ESC[11~ or ESCOP
      expect(dataReceived[0]).toMatch(/\x1b(\[11~|OP)/);
    });

    test('encodes F12', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('F12', 'F12'));

      expect(dataReceived.length).toBe(1);
      // F12 produces ESC[24~
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });
  });

  describe('Navigation Keys', () => {
    test('encodes Home', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Home', 'Home'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes End', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('End', 'End'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes PageUp', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('PageUp', 'PageUp'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes PageDown', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('PageDown', 'PageDown'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes Delete', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Delete', 'Delete'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes Insert', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Insert', 'Insert'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });
  });

  describe('Event Prevention', () => {
    test('prevents default on printable characters', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('KeyA', 'a');
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('prevents default on special keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('Enter', 'Enter');
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('prevents default on Ctrl+keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('KeyC', 'c', { ctrl: true });
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe('Unknown Keys', () => {
    test('ignores unmapped keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Simulate a key that's not in KEY_MAP
      simulateKey(container, createKeyEvent('Unknown', 'Unknown'));

      // Should not crash or produce output
      expect(dataReceived.length).toBe(0);
    });
  });

  describe('Modifier Combinations', () => {
    test('handles Ctrl+Shift combinations', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'A', { ctrl: true, shift: true }));

      expect(dataReceived.length).toBe(1);
      // Should still encode something
      expect(dataReceived[0].length).toBeGreaterThan(0);
    });

    test('handles Alt combinations', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a', { alt: true }));

      expect(dataReceived.length).toBe(1);
      // Alt+A often produces ESC a or similar
      expect(dataReceived[0].length).toBeGreaterThan(0);
    });
  });

  describe('Clipboard Operations', () => {
    test('handles paste event', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteText = 'Hello, World!';
      const pasteEvent = createClipboardEvent(pasteText);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('handles beforeinput insertFromPaste with data', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      const pasteText = 'Hello, beforeinput!';
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);

      inputElement.dispatchEvent(beforeInputEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('uses bracketed paste for beforeinput insertFromPaste', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (mode) => mode === 2004,
        undefined,
        inputElement as any
      );

      const pasteText = 'Bracketed paste';
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);

      inputElement.dispatchEvent(beforeInputEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(`\x1b[200~${pasteText}\x1b[201~`);
    });

    test('handles multi-line paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteText = 'Line 1\nLine 2\nLine 3';
      const pasteEvent = createClipboardEvent(pasteText);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('ignores beforeinput insertFromPaste when paste already handled', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      const pasteText = 'Hello, World!';
      const pasteEvent = createClipboardEvent(pasteText);
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);

      container.dispatchEvent(pasteEvent);
      inputElement.dispatchEvent(beforeInputEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('ignores paste when beforeinput insertFromPaste already handled', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      const pasteText = 'Hello, World!';
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);
      const pasteEvent = createClipboardEvent(pasteText);

      inputElement.dispatchEvent(beforeInputEvent);
      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('ignores paste with no clipboard data', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteEvent = createClipboardEvent(null);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(0);
    });

    test('ignores paste with empty text', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteEvent = createClipboardEvent('');

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(0);
    });

    test('allows Ctrl+V to trigger paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Ctrl+V should NOT call onData callback (lets paste event handle it)
      simulateKey(container, createKeyEvent('KeyV', 'v', { ctrl: true }));

      expect(dataReceived.length).toBe(0);
    });

    test('allows Cmd+V to trigger paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Cmd+V should NOT call onData callback (lets paste event handle it)
      simulateKey(container, createKeyEvent('KeyV', 'v', { meta: true }));

      expect(dataReceived.length).toBe(0);
    });
  });

  // Regression tests for bugs that were present while the "simple keys" and
  // "printable character" fast paths bypassed the encoder. Each test here
  // corresponds to a behavior that used to be wrong because the fast path
  // never consulted the encoder or terminal-mode state.
  describe('Regression: encoder bypass removal', () => {
    // Bug: Shift+Enter was short-circuited to '\r' alongside plain Enter,
    // making it indistinguishable. Apps using modifyOtherKeys or Kitty rely
    // on distinguishing them (e.g. "newline without submit" in REPLs).
    test('Shift+Enter differs from plain Enter', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Enter', 'Enter'));
      expect(dataReceived[0]).toBe('\r');

      dataReceived.length = 0;
      simulateKey(container, createKeyEvent('Enter', 'Enter', { shift: true }));
      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).not.toBe('\r');
      // The encoder emits the modifyOtherKeys sequence for Shift+Enter by
      // default: ESC [ 27 ; 2 ; 13 ~
      expect(dataReceived[0]).toBe('\x1b[27;2;13~');
    });

    // Bug: the hardcoded switch emitted '\x1b[H' for Home regardless of
    // whether mods included SHIFT, so Shift+Home was indistinguishable from
    // Home. The encoder's function_keys table has a distinct entry.
    test('Shift+Home differs from plain Home', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Home', 'Home'));
      const plain = dataReceived[0];
      dataReceived.length = 0;

      simulateKey(container, createKeyEvent('Home', 'Home', { shift: true }));
      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).not.toBe(plain);
      // xterm-style Shift+Home is ESC [ 1 ; 2 H
      expect(dataReceived[0]).toBe('\x1b[1;2H');
    });

    test('Shift+End differs from plain End', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('End', 'End'));
      const plain = dataReceived[0];
      dataReceived.length = 0;

      simulateKey(container, createKeyEvent('End', 'End', { shift: true }));
      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).not.toBe(plain);
    });

    test('Shift+PageUp and Shift+PageDown preserve Shift', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('PageUp', 'PageUp'));
      const plainUp = dataReceived[0];
      dataReceived.length = 0;
      simulateKey(container, createKeyEvent('PageUp', 'PageUp', { shift: true }));
      expect(dataReceived[0]).not.toBe(plainUp);
      dataReceived.length = 0;

      simulateKey(container, createKeyEvent('PageDown', 'PageDown'));
      const plainDn = dataReceived[0];
      dataReceived.length = 0;
      simulateKey(container, createKeyEvent('PageDown', 'PageDown', { shift: true }));
      expect(dataReceived[0]).not.toBe(plainDn);
    });

    // Bug: Shift+F-keys emitted the unmodified xterm sequence and dropped
    // the Shift modifier. The encoder emits the PC-style modified sequence.
    test('Shift+F1 preserves Shift', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('F1', 'F1'));
      const plain = dataReceived[0];
      dataReceived.length = 0;

      simulateKey(container, createKeyEvent('F1', 'F1', { shift: true }));
      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).not.toBe(plain);
      // xterm-style Shift+F1 is ESC [ 1 ; 2 P
      expect(dataReceived[0]).toBe('\x1b[1;2P');
    });

    // Bug: Home and End ignored DECCKM (application cursor mode), even
    // though the parallel Arrow-key handling correctly routed through the
    // encoder. Home is ESC[H in normal mode, ESCOH in application mode.
    test('Home honors DECCKM (normal mode)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        () => false // DECCKM off
      );

      simulateKey(container, createKeyEvent('Home', 'Home'));
      expect(dataReceived[0]).toBe('\x1b[H');
    });

    test('Home honors DECCKM (application mode)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (mode: number) => mode === 1 // DECCKM on
      );

      simulateKey(container, createKeyEvent('Home', 'Home'));
      expect(dataReceived[0]).toBe('\x1bOH');
    });

    // Bug: the encoder-fallback utf8 path used
    //   event.key.length === 1 && event.key.charCodeAt(0) < 128
    // which excluded non-ASCII BMP characters (and any non-BMP character
    // entirely). A CJK letter typed via a physical key now reaches the
    // encoder as utf8 and is emitted verbatim.
    test('non-ASCII BMP character is emitted as UTF-8', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', '你'));
      expect(dataReceived).toEqual(['你']);
    });

    // Bug: surrogate-pair input (event.key.length === 2) was rejected by
    // both the printable fast path (length check) and the encoder-fallback
    // utf8 path (charCodeAt < 128 check), so emoji with a mapped physical
    // key produced no output.
    test('surrogate-pair emoji is emitted as UTF-8', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', '😀'));
      expect(dataReceived).toEqual(['😀']);
    });

    // Bug: the encoder-fallback utf8 path lowercased event.key, so the
    // encoder could not distinguish Shift+letter from the base letter.
    // Case preservation lets the encoder emit the shifted character.
    test('Shift+letter preserves case in utf8 output', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Shift+2 on US layout produces '@'. The old fast path caught this
      // via isPrintableCharacter; we now rely on the encoder, and the '@'
      // must still come through (not '2').
      simulateKey(container, createKeyEvent('Digit2', '@', { shift: true }));
      expect(dataReceived).toEqual(['@']);
    });

    // Bug: Kitty keyboard protocol flags were silently ignored for every
    // key that hit either fast path (printables and simple special keys).
    // With the bypass removed, flags set on the shared encoder affect all
    // keys. This is a plumbing regression test — we probe the encoder
    // directly since InputHandler does not expose flag configuration.
    test('Kitty flags change Shift+Enter encoding', () => {
      const encoder = ghostty.createKeyEncoder();
      try {
        const td = new TextDecoder();

        const legacy = td.decode(
          encoder.encode({ action: KeyAction.PRESS, key: Key.ENTER, mods: Mods.SHIFT })
        );
        expect(legacy).toBe('\x1b[27;2;13~');

        // Enable disambiguate + report_events (minimal Kitty subset).
        encoder.setKittyFlags(0x1f);
        const kitty = td.decode(
          encoder.encode({ action: KeyAction.PRESS, key: Key.ENTER, mods: Mods.SHIFT })
        );
        // Kitty encodes Shift+Enter as ESC [ 13 ; 2 u
        expect(kitty).toBe('\x1b[13;2u');
        expect(kitty).not.toBe(legacy);
      } finally {
        encoder.dispose();
      }
    });

    // Bug: the printable fast path bypassed the encoder, so composing=true
    // could not be plumbed through. The encoder's legacy path returns no
    // bytes when composing is true. This verifies the plumbing works.
    test('composing suppresses encoder output', () => {
      const encoder = ghostty.createKeyEncoder();
      try {
        const td = new TextDecoder();

        const normal = td.decode(
          encoder.encode({
            action: KeyAction.PRESS,
            key: Key.A,
            mods: Mods.NONE,
            utf8: 'a',
          })
        );
        expect(normal).toBe('a');

        const composing = td.decode(
          encoder.encode({
            action: KeyAction.PRESS,
            key: Key.A,
            mods: Mods.NONE,
            utf8: 'a',
            composing: true,
          })
        );
        expect(composing).toBe('');
      } finally {
        encoder.dispose();
      }
    });

    // Regression for the encoder-option cache (InputHandler.syncEncoderOption).
    // We skip pushing options when the value is unchanged; this test makes
    // sure mode *changes* do propagate — i.e., the cache invalidates
    // correctly when getModeCallback starts returning a different value.
    test('encoder options track mode changes across keystrokes', () => {
      let cursorApp = false;
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (mode: number) => mode === 1 && cursorApp
      );

      // First: DECCKM off → CSI form.
      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));
      expect(dataReceived[0]).toBe('\x1b[A');
      dataReceived.length = 0;

      // Flip the mode. The next keystroke must pick it up.
      cursorApp = true;
      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));
      expect(dataReceived[0]).toBe('\x1bOA');
      dataReceived.length = 0;

      // And flip back.
      cursorApp = false;
      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));
      expect(dataReceived[0]).toBe('\x1b[A');
    });

    // Regression for the utf8 buffer grow path. The buffer starts at 64
    // bytes on first use and must replace itself with a larger allocation
    // when a string exceeds capacity. This test passes a 100-byte utf8
    // string through and verifies the encoder emits it verbatim — which
    // only works if the grow path (a) doesn't corrupt the pointer, (b)
    // doesn't truncate via encodeInto pre-sizing, and (c) properly frees
    // the prior allocation.
    test('utf8 scratch buffer grows beyond initial capacity', () => {
      const encoder = ghostty.createKeyEncoder();
      try {
        const td = new TextDecoder();

        // First: a small utf8 that fits in the initial 64 bytes.
        const small = td.decode(
          encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: 'a' })
        );
        expect(small).toBe('a');

        // Then: a 100-byte utf8 that forces a realloc. The encoder emits
        // utf8 verbatim in legacy mode for unmodified printable keys.
        const longStr = 'a'.repeat(100);
        const big = td.decode(
          encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: longStr })
        );
        expect(big).toBe(longStr);

        // And again after growth: short strings still work (old pointer
        // correctly freed, new pointer usable for short writes too).
        const afterGrow = td.decode(
          encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: 'b' })
        );
        expect(afterGrow).toBe('b');
      } finally {
        encoder.dispose();
      }
    });

    // Regression for the output buffer overflow path. The output buffer
    // is fixed at 128 bytes and throws with the required size on overflow.
    // A 500-byte utf8 in legacy mode produces a 500-byte output sequence
    // (the encoder emits utf8 verbatim for unmodified printable keys),
    // which exceeds the buffer and must throw.
    test('output buffer overflow throws with required size', () => {
      const encoder = ghostty.createKeyEncoder();
      try {
        const longStr = 'a'.repeat(500);
        expect(() =>
          encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: longStr })
        ).toThrow(/exceeds 128 bytes.*needed 500/);
      } finally {
        encoder.dispose();
      }
    });
  });
});
