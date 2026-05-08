/**
 * Shared types and helpers for box-drawing and block-element rendering.
 *
 * The thickness model matches Ghostty's `Thickness` enum: a base "light"
 * thickness derived from the cell size, with heavy = 2 × light. Double
 * lines are two parallel light strokes separated by a gap of one light
 * thickness (so a double stroke spans 3 × light total).
 */

// Edge weight: none, light (single thin line), heavy (single thick line),
// or double (two parallel thin lines with a 1-light gap between them).
export type Weight = 0 | 1 | 2 | 3;
export const N: Weight = 0;
export const L: Weight = 1;
export const H: Weight = 2;
export const D: Weight = 3;

export function lightThickness(h: number): number {
  return Math.max(1, Math.round(h * 0.07));
}

export function heavyThickness(h: number): number {
  return lightThickness(h) * 2;
}
