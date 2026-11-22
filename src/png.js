// A tiny raster canvas with PNG output, so charts need no image library.
import { crc32, deflateSync } from 'node:zlib';

// 5x7 pixel font, only what chart labels need.
const FONT = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

export function createCanvas(width, height, background = [255, 255, 255]) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) pixels.set(background, i);

  function dot(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < width && y < height) pixels.set(color, (y * width + x) * 3);
  }

  function rect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) dot(x + dx, y + dy, color);
  }

  /** A straight line of the given thickness; dash = [on, off] in pixels. */
  function line(x0, y0, x1, y1, color, thickness = 1, dash) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const half = Math.floor(thickness / 2);
    for (let i = 0; i <= steps; i++) {
      if (dash && i % (dash[0] + dash[1]) >= dash[0]) continue;
      rect(x0 + ((x1 - x0) * i) / steps - half, y0 + ((y1 - y0) * i) / steps - half, thickness, thickness, color);
    }
  }

  function circle(cx, cy, r, color) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) dot(cx + dx, cy + dy, color);
  }

  /** Characters missing from the font are skipped. Returns the width. */
  function text(x, y, value, color, scale = 2) {
    let cursor = x;
    for (const char of String(value)) {
      const glyph = FONT[char];
      if (!glyph) continue;
      glyph.forEach((row, gy) => [...row].forEach((bit, gx) => bit === '1' && rect(cursor + gx * scale, y + gy * scale, scale, scale, color)));
      cursor += 6 * scale;
    }
    return cursor - x;
  }

  const textWidth = (value, scale = 2) => [...String(value)].filter((char) => FONT[char]).length * 6 * scale;

  function png() {
    const rows = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8 bit, RGB, deflate, no filter, no interlace
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  return { width, height, dot, rect, line, circle, text, textWidth, png };
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
