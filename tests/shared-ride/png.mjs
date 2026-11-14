// A minimal PNG reader for the tests (8-bit RGB or RGBA, not interlaced:
// what Playwright's screenshots are), and a picture comparison.

import { inflateSync } from 'node:zlib';

// Returns { width, height, channels, data } with `channels` bytes per pixel.
export function decodePng(buffer) {
  let p = 8, width = 0, height = 0, depth = 0, type = 0;
  const parts = [];
  while (p < buffer.length) {
    const length = buffer.readUInt32BE(p);
    const kind = buffer.toString('ascii', p + 4, p + 8);
    const data = buffer.subarray(p + 8, p + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (kind === 'IDAT') parts.push(data);
    else if (kind === 'IEND') break;
    p += 12 + length;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type})`);
  const channels = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[row - stride + x - channels] : 0;
      let v = raw[line + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c;
        const da = Math.abs(e - a), db = Math.abs(e - b), dc = Math.abs(e - c);
        v += da <= db && da <= dc ? a : db <= dc ? b : c;
      }
      out[row + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

// Which pixels differ clearly between two pictures of the same size:
// a Uint8Array with 1 for "different".
export function differingPixels(one, two, threshold = 24) {
  if (one.width !== two.width || one.height !== two.height) throw new Error('pictures have different sizes');
  const mask = new Uint8Array(one.width * one.height);
  for (let i = 0; i < mask.length; i++) {
    const a = i * one.channels, b = i * two.channels;
    const d = Math.abs(one.data[a] - two.data[b]) + Math.abs(one.data[a + 1] - two.data[b + 1]) + Math.abs(one.data[a + 2] - two.data[b + 2]);
    if (d > threshold) mask[i] = 1;
  }
  return mask;
}

// Number of marked pixels within `radius` pixels of (x, y).
export function countNear(mask, width, x, y, radius) {
  const height = mask.length / width;
  let n = 0;
  for (let yy = Math.max(0, Math.floor(y - radius)); yy <= Math.min(height - 1, Math.ceil(y + radius)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - radius)); xx <= Math.min(width - 1, Math.ceil(x + radius)); xx++) {
      if (mask[yy * width + xx] && Math.hypot(xx - x, yy - y) <= radius) n++;
    }
  }
  return n;
}
