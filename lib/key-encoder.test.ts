/**
 * Unit tests for KeyEncoder.
 *
 * KeyEncoder wraps Ghostty's WASM key encoder, reusing per-instance scratch
 * buffers (event struct, fixed 128-byte output buffer, lazy utf8 buffer,
 * setOption value slot) across encode() calls. These tests cover the
 * direct-encoder API and the buffer-management edge cases that aren't
 * exercised through InputHandler.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { Key, KeyAction, KittyKeyFlags, Mods } from './types';

describe('KeyEncoder', () => {
  let ghostty: Ghostty;

  beforeAll(async () => {
    ghostty = await Ghostty.load();
  });

  test('encode() returns a stable Uint8Array (caller may hold across calls)', () => {
    const encoder = ghostty.createKeyEncoder();
    try {
      const first = encoder.encode({
        action: KeyAction.PRESS,
        key: Key.A,
        mods: Mods.NONE,
        utf8: 'a',
      });
      expect(Array.from(first)).toEqual([0x61]);

      const second = encoder.encode({
        action: KeyAction.PRESS,
        key: Key.B,
        mods: Mods.NONE,
        utf8: 'b',
      });
      expect(Array.from(second)).toEqual([0x62]);

      // first must still hold its original bytes — encode() is documented
      // to return a stable array independent of subsequent calls.
      expect(Array.from(first)).toEqual([0x61]);
    } finally {
      encoder.dispose();
    }
  });

  test('setKittyFlags affects encoded output', () => {
    const encoder = ghostty.createKeyEncoder();
    const decoder = new TextDecoder();
    try {
      // Without Kitty flags, Shift+Enter encodes as the modifyOtherKeys
      // form per Ghostty's function_keys table.
      const legacy = decoder.decode(
        encoder.encode({ action: KeyAction.PRESS, key: Key.ENTER, mods: Mods.SHIFT })
      );
      expect(legacy).toBe('\x1b[27;2;13~');

      // With Kitty flags enabled, the same event encodes as ESC[13;2u.
      encoder.setKittyFlags(KittyKeyFlags.ALL);
      const kitty = decoder.decode(
        encoder.encode({ action: KeyAction.PRESS, key: Key.ENTER, mods: Mods.SHIFT })
      );
      expect(kitty).toBe('\x1b[13;2u');
    } finally {
      encoder.dispose();
    }
  });

  // The utf8 scratch buffer starts unallocated, lazily sizes to 64 bytes
  // on first use, and replaces itself with a larger allocation when a
  // string exceeds capacity. This test exercises the grow path.
  test('utf8 scratch buffer grows beyond initial capacity', () => {
    const encoder = ghostty.createKeyEncoder();
    const decoder = new TextDecoder();
    try {
      // First: a small utf8 that fits in the initial 64 bytes.
      const small = decoder.decode(
        encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: 'a' })
      );
      expect(small).toBe('a');

      // Then: a 100-byte utf8 that forces a realloc. The encoder emits
      // utf8 verbatim in legacy mode for unmodified printable keys.
      const longStr = 'a'.repeat(100);
      const big = decoder.decode(
        encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: longStr })
      );
      expect(big).toBe(longStr);

      // And again after growth: short strings still work (old pointer
      // correctly freed, new pointer usable for short writes too).
      const afterGrow = decoder.decode(
        encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: 'b' })
      );
      expect(afterGrow).toBe('b');
    } finally {
      encoder.dispose();
    }
  });

  // The output buffer starts at 128 bytes but grows to fit larger
  // output. The Zig encoder reports the required size on overflow;
  // KeyEncoder reallocates and retries. A 500-byte utf8 in legacy mode
  // produces a 500-byte output (the encoder emits utf8 verbatim for
  // unmodified printable keys), exceeding the initial buffer — we
  // verify the encoded bytes come through regardless.
  test('output buffer grows to fit oversize output', () => {
    const encoder = ghostty.createKeyEncoder();
    const decoder = new TextDecoder();
    try {
      const longStr = 'a'.repeat(500);
      const encoded = decoder.decode(
        encoder.encode({
          action: KeyAction.PRESS,
          key: Key.A,
          mods: Mods.NONE,
          utf8: longStr,
        })
      );
      expect(encoded).toBe(longStr);

      // After a grow, subsequent small encodes still work — proves the
      // new buffer is valid and capacity tracking is consistent.
      const small = decoder.decode(
        encoder.encode({ action: KeyAction.PRESS, key: Key.A, mods: Mods.NONE, utf8: 'a' })
      );
      expect(small).toBe('a');
    } finally {
      encoder.dispose();
    }
  });

  test('multiple encoders work independently', () => {
    const a = ghostty.createKeyEncoder();
    const b = ghostty.createKeyEncoder();
    const decoder = new TextDecoder();
    try {
      b.setKittyFlags(KittyKeyFlags.ALL);

      const fromA = decoder.decode(
        a.encode({ action: KeyAction.PRESS, key: Key.ENTER, mods: Mods.SHIFT })
      );
      const fromB = decoder.decode(
        b.encode({ action: KeyAction.PRESS, key: Key.ENTER, mods: Mods.SHIFT })
      );

      expect(fromA).toBe('\x1b[27;2;13~');
      expect(fromB).toBe('\x1b[13;2u');
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  test('dispose is idempotent', () => {
    const encoder = ghostty.createKeyEncoder();
    encoder.dispose();
    expect(() => encoder.dispose()).not.toThrow();
  });
});
