/**
 * Block element renderer (U+2580..U+259F).
 *
 * These glyphs are pure rectangles (eighths, halves, quadrants) plus three
 * shading levels. Each cell is filled with one or two `fillRect` calls
 * sized to the cell, so adjacent block-element cells tile seamlessly.
 */

/**
 * Draw a U+2580..U+259F glyph into the cell at (x, y, w, h).
 * Returns true if the codepoint was handled.
 */
export function drawBlockElement(
  ctx: CanvasRenderingContext2D,
  cp: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): boolean {
  ctx.fillStyle = color;
  switch (cp) {
    case 0x2580: // ▀ upper half
      ctx.fillRect(x, y, w, h / 2);
      return true;
    case 0x2581: // ▁ lower one eighth
      ctx.fillRect(x, y + (h * 7) / 8, w, h / 8);
      return true;
    case 0x2582: // ▂ lower one quarter
      ctx.fillRect(x, y + (h * 3) / 4, w, h / 4);
      return true;
    case 0x2583: // ▃ lower three eighths
      ctx.fillRect(x, y + (h * 5) / 8, w, (h * 3) / 8);
      return true;
    case 0x2584: // ▄ lower half
      ctx.fillRect(x, y + h / 2, w, h / 2);
      return true;
    case 0x2585: // ▅ lower five eighths
      ctx.fillRect(x, y + (h * 3) / 8, w, (h * 5) / 8);
      return true;
    case 0x2586: // ▆ lower three quarters
      ctx.fillRect(x, y + h / 4, w, (h * 3) / 4);
      return true;
    case 0x2587: // ▇ lower seven eighths
      ctx.fillRect(x, y + h / 8, w, (h * 7) / 8);
      return true;
    case 0x2588: // █ full block
      ctx.fillRect(x, y, w, h);
      return true;
    case 0x2589: // ▉ left seven eighths
      ctx.fillRect(x, y, (w * 7) / 8, h);
      return true;
    case 0x258a: // ▊ left three quarters
      ctx.fillRect(x, y, (w * 3) / 4, h);
      return true;
    case 0x258b: // ▋ left five eighths
      ctx.fillRect(x, y, (w * 5) / 8, h);
      return true;
    case 0x258c: // ▌ left half
      ctx.fillRect(x, y, w / 2, h);
      return true;
    case 0x258d: // ▍ left three eighths
      ctx.fillRect(x, y, (w * 3) / 8, h);
      return true;
    case 0x258e: // ▎ left one quarter
      ctx.fillRect(x, y, w / 4, h);
      return true;
    case 0x258f: // ▏ left one eighth
      ctx.fillRect(x, y, w / 8, h);
      return true;
    case 0x2590: // ▐ right half
      ctx.fillRect(x + w / 2, y, w / 2, h);
      return true;
    case 0x2591: // ░ light shade
      ctx.save();
      ctx.globalAlpha *= 0.25;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return true;
    case 0x2592: // ▒ medium shade
      ctx.save();
      ctx.globalAlpha *= 0.5;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return true;
    case 0x2593: // ▓ dark shade
      ctx.save();
      ctx.globalAlpha *= 0.75;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return true;
    case 0x2594: // ▔ upper one eighth
      ctx.fillRect(x, y, w, h / 8);
      return true;
    case 0x2595: // ▕ right one eighth
      ctx.fillRect(x + (w * 7) / 8, y, w / 8, h);
      return true;
    case 0x2596: // ▖ quadrant lower left
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      return true;
    case 0x2597: // ▗ quadrant lower right
      ctx.fillRect(x + w / 2, y + h / 2, w / 2, h / 2);
      return true;
    case 0x2598: // ▘ quadrant upper left
      ctx.fillRect(x, y, w / 2, h / 2);
      return true;
    case 0x2599: // ▙ quadrant upper-left + lower-left + lower-right
      ctx.fillRect(x, y, w / 2, h);
      ctx.fillRect(x + w / 2, y + h / 2, w / 2, h / 2);
      return true;
    case 0x259a: // ▚ quadrant upper-left + lower-right
      ctx.fillRect(x, y, w / 2, h / 2);
      ctx.fillRect(x + w / 2, y + h / 2, w / 2, h / 2);
      return true;
    case 0x259b: // ▛ upper-left + upper-right + lower-left
      ctx.fillRect(x, y, w / 2, h);
      ctx.fillRect(x + w / 2, y, w / 2, h / 2);
      return true;
    case 0x259c: // ▜ upper-left + upper-right + lower-right
      ctx.fillRect(x, y, w, h / 2);
      ctx.fillRect(x + w / 2, y + h / 2, w / 2, h / 2);
      return true;
    case 0x259d: // ▝ quadrant upper right
      ctx.fillRect(x + w / 2, y, w / 2, h / 2);
      return true;
    case 0x259e: // ▞ upper-right + lower-left
      ctx.fillRect(x + w / 2, y, w / 2, h / 2);
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      return true;
    case 0x259f: // ▟ upper-right + lower-left + lower-right
      ctx.fillRect(x + w / 2, y, w / 2, h);
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      return true;
  }
  return false;
}
