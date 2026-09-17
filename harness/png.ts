/**
 * Minimal PNG decoder for the simulator's framebuffer captures.
 *
 * Scope is deliberately narrow: 8-bit, non-interlaced, colour types 0/2/4/6 —
 * which is everything `/api/screenshot/glasses` ever emits. Anything else
 * throws by name rather than being guessed at, because a decoder that quietly
 * misreads pixels turns every downstream ink assertion into a lie.
 *
 * zlib comes from node stdlib, so this file adds no dependency (D-02, D-11).
 */
import zlib from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, length = width * height * 4 */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** bytes per pixel in the raw scanline, by IHDR colour type */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Uint8Array): DecodedPng {
  if (buf.length < 8) throw new Error("not a PNG: input shorter than the signature");
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error("not a PNG: bad signature");
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let sawIhdr = false;
  const idat: Uint8Array[] = [];

  // Chunk walk: 4-byte BE length, 4-byte type, payload, 4-byte CRC. CRC is not
  // verified — the simulator's encoder is trusted; we only reject input that is
  // structurally wrong enough to be read as the wrong image.
  while (off + 8 <= buf.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(buf[off + 4]!, buf[off + 5]!, buf[off + 6]!, buf[off + 7]!);
    const start = off + 8;
    if (start + len > buf.length) {
      throw new Error(`truncated PNG: chunk ${type} claims ${len} bytes past end of input`);
    }
    if (type === "IHDR") {
      if (len < 13) throw new Error(`malformed PNG: IHDR is ${len} bytes, expected 13`);
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = buf[start + 8]!;
      colorType = buf[start + 9]!;
      interlace = buf[start + 12]!;
      sawIhdr = true;
    } else if (type === "IDAT") {
      idat.push(buf.subarray(start, start + len));
    } else if (type === "IEND") {
      break;
    }
    off = start + len + 4;
  }

  if (!sawIhdr) throw new Error("malformed PNG: no IHDR chunk");
  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}: this decoder only handles 8`);
  }
  const bpp = CHANNELS[colorType];
  if (bpp === undefined) {
    throw new Error(
      `unsupported PNG colour type ${colorType}: this decoder only handles 0, 2, 4 and 6`,
    );
  }
  if (interlace !== 0) {
    throw new Error(
      `unsupported PNG interlace method ${interlace}: this decoder only handles non-interlaced (0)`,
    );
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`malformed PNG: dimensions ${width}x${height}`);
  }
  if (idat.length === 0) throw new Error("malformed PNG: no IDAT data");

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new Error(`truncated PNG image data: expected ${expected} bytes, inflated ${raw.length}`);
  }

  // Undo scanline filters into a flat unfiltered buffer.
  const flat = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? flat[dst + i - bpp]! : 0;
      const b = y > 0 ? flat[up + i]! : 0;
      const c = i >= bpp && y > 0 ? flat[up + i - bpp]! : 0;
      let v: number;
      switch (ft) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4:
          v = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`unsupported PNG filter type ${ft} on scanline ${y}`);
      }
      flat[dst + i] = v & 0xff;
    }
  }

  // Expand to RGBA.
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0, n = width * height; p < n; p++) {
    const s = p * bpp;
    const d = p * 4;
    if (colorType === 0) {
      const g = flat[s]!;
      rgba[d] = g;
      rgba[d + 1] = g;
      rgba[d + 2] = g;
      rgba[d + 3] = 255;
    } else if (colorType === 2) {
      rgba[d] = flat[s]!;
      rgba[d + 1] = flat[s + 1]!;
      rgba[d + 2] = flat[s + 2]!;
      rgba[d + 3] = 255;
    } else if (colorType === 4) {
      const g = flat[s]!;
      rgba[d] = g;
      rgba[d + 1] = g;
      rgba[d + 2] = g;
      rgba[d + 3] = flat[s + 1]!;
    } else {
      rgba[d] = flat[s]!;
      rgba[d + 1] = flat[s + 1]!;
      rgba[d + 2] = flat[s + 2]!;
      rgba[d + 3] = flat[s + 3]!;
    }
  }

  return { width, height, rgba };
}
