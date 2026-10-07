import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [37, 99, 235];

function drawIcon(size, fullBleed) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.46;
  const rIn = size * 0.37;
  const hub = size * 0.14;
  const teeth = 8;
  const step = (2 * Math.PI) / teeth;
  const toothHalf = step * 0.15;
  const toothR = radius * 1.16;
  const rr = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const qx = Math.max(Math.abs(dx) - (size / 2 - rr), 0);
      const qy = Math.max(Math.abs(dy) - (size / 2 - rr), 0);
      if (!fullBleed && qx * qx + qy * qy > rr * rr) continue;
      const k = Math.round(ang / step);
      const rel = ang - k * step;
      let white = false;
      if (d > hub) {
        if (Math.abs(rel) <= toothHalf) {
          white = d >= rIn && d <= toothR;
        } else {
          white = d >= rIn && d <= radius;
        }
      }
      if (white) {
        px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
      } else {
        px[i] = BG[0]; px[i + 1] = BG[1]; px[i + 2] = BG[2]; px[i + 3] = 255;
      }
    }
  }
  return px;
}

writeFileSync(join(outDir, 'icon-192.png'), encodePng(192, drawIcon(192, false)));
writeFileSync(join(outDir, 'icon-512.png'), encodePng(512, drawIcon(512, false)));
writeFileSync(join(outDir, 'apple-touch-icon.png'), encodePng(180, drawIcon(180, true)));
console.log('icons written to', outDir);