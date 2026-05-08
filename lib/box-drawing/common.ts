/**
 * Shared types and helpers for box-drawing and block-element rendering.
 *
 * The thickness model matches Ghostty's `Thickness` enum: a base "light"
 * thickness measured from the font's own U+2500 '─' glyph (passed in
 * by the caller as `lightPx`), with heavy = 2 × light. Double lines are
 * two parallel light strokes separated by a gap of one light thickness
 * (so a double stroke spans 3 × light total).
 */

// Edge weight: none, light (single thin line), heavy (single thick line),
// or double (two parallel thin lines with a 1-light gap between them).
export type Weight = 0 | 1 | 2 | 3;
export const N: Weight = 0;
export const L: Weight = 1;
export const H: Weight = 2;
export const D: Weight = 3;

export function heavyThickness(lightPx: number): number {
  return lightPx * 2;
}
