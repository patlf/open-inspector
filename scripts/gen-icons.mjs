#!/usr/bin/env node
/**
 * Generate the extension icons.
 *
 * Committing binaries you cannot diff is a small but real supply-chain smell in
 * a project whose pitch is auditability — so the icons are generated from this
 * script instead, and anyone can re-run it and compare.
 *
 * The mark is a selection marquee: four corner brackets around empty space,
 * which is what the overlay itself draws. No dependencies; PNG encoding is
 * about forty lines with node's built-in zlib.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ICON_DIR = join(ROOT, 'apps/extension/public/icon');

const SIZES = [16, 32, 48, 128];

const BACKGROUND = [20, 24, 28, 255]; // #14181c
const MARK = [228, 116, 63, 255]; // #e4743f

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);

  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rounded-square coverage test, so small sizes do not look like hard chips. */
function insideRoundedSquare(x, y, size, radius) {
  const max = size - 1;
  const dx = Math.max(radius - x, 0, x - (max - radius));
  const dy = Math.max(radius - y, 0, y - (max - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * One of the four corner brackets of a selection marquee.
 *
 * The arm length is the number that decides whether this reads as a marquee at
 * all. At 0.24 the four arms very nearly met: the gap was 14% of the span at
 * 128px and closed completely at 48px and below, so in the toolbar and the
 * store listing — every size anyone actually sees — the mark was a plain
 * square ring, which is not what it is supposed to be. At 0.16 the gap is
 * around 44% of the span and the four brackets stay four brackets down to
 * 16px.
 */
function insideBracket(x, y, size) {
  const inset = Math.max(2, Math.round(size * 0.22));
  const thickness = Math.max(1, Math.round(size * 0.09));
  const arm = Math.max(3, Math.round(size * 0.16));
  const max = size - 1 - inset;

  const nearLeft = x >= inset && x < inset + thickness;
  const nearRight = x <= max && x > max - thickness;
  const nearTop = y >= inset && y < inset + thickness;
  const nearBottom = y <= max && y > max - thickness;

  const withinHorizontalArm =
    (x >= inset && x < inset + arm) || (x <= max && x > max - arm);
  const withinVerticalArm = (y >= inset && y < inset + arm) || (y <= max && y > max - arm);

  const inBox = x >= inset && x <= max && y >= inset && y <= max;
  if (!inBox) return false;

  const onVerticalEdge = (nearLeft || nearRight) && withinVerticalArm;
  const onHorizontalEdge = (nearTop || nearBottom) && withinHorizontalArm;

  return onVerticalEdge || onHorizontalEdge;
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;

      if (!insideRoundedSquare(x, y, size, radius)) continue; // stays transparent

      const colour = insideBracket(x, y, size) ? MARK : BACKGROUND;
      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = colour[3];
    }
  }

  return encodePng(size, pixels);
}

mkdirSync(ICON_DIR, { recursive: true });

for (const size of SIZES) {
  const file = join(ICON_DIR, `${size}.png`);
  writeFileSync(file, renderIcon(size));
  console.log(`  wrote ${size}×${size}  ${file}`);
}
