/**
 * SpriteBmpEncoder — converts PNG sprites to 1-bit monochrome BMP Uint8Array.
 *
 * The Even G2 SDK's ImageRawDataUpdate expects Uint8Array BMP data,
 * not base64 strings. This module:
 *   1. Loads a PNG image via HTMLImageElement
 *   2. Draws it onto a canvas at the target sprite size
 *   3. Reads pixel data and converts to 1-bit monochrome
 *   4. Encodes as a BMP file (same format as the chess app uses)
 *
 * Monochrome threshold: pixel brightness > 128 = white (1), else black (0).
 * Transparent pixels are treated as black (background).
 */

import { SPRITE_CONFIG } from '../config/constants.js';

// ── BMP constants (mirrors chess app's bmp-constants.ts) ──────────────────

const BMP_SIGNATURE = [0x42, 0x4d] as const; // 'BM'
const BMP_FILE_HEADER_SIZE = 14;
const BMP_DIB_HEADER_SIZE = 40;
const BMP_COLOR_TABLE_SIZE = 8;     // 2 colors × 4 bytes
const BMP_HEADER_SIZE = BMP_FILE_HEADER_SIZE + BMP_DIB_HEADER_SIZE + BMP_COLOR_TABLE_SIZE; // 62
const BMP_PPM = 2835;               // 72 DPI
const BMP_COLORS_USED = 2;

function getBmpRowStride(width: number): number {
  const rowBytes = Math.ceil(width / 8);
  return Math.ceil(rowBytes / 4) * 4;
}

function getBmpPixelDataSize(width: number, height: number): number {
  return getBmpRowStride(width) * height;
}

function getBmpFileSize(width: number, height: number): number {
  return BMP_HEADER_SIZE + getBmpPixelDataSize(width, height);
}

// ── Canvas setup ──────────────────────────────────────────────────────────

let reusedCanvas: HTMLCanvasElement | null = null;

function getCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!reusedCanvas) {
    reusedCanvas = document.createElement('canvas');
  }
  reusedCanvas.width = w;
  reusedCanvas.height = h;
  const ctx = reusedCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}

// ── Core encoder ──────────────────────────────────────────────────────────

/**
 * Encode 1-bit monochrome pixels into a BMP Uint8Array.
 * pixels: row-major array of 0 (black) or 1 (white), width*height length.
 */
export function encodeBmp(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const fileSize = getBmpFileSize(width, height);
  const rowStride = getBmpRowStride(width);
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const data = new Uint8Array(buf);

  // File header
  view.setUint8(0, BMP_SIGNATURE[0]);
  view.setUint8(1, BMP_SIGNATURE[1]);
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);                     // reserved
  view.setUint32(10, BMP_HEADER_SIZE, true);       // pixel data offset

  // DIB header (BITMAPINFOHEADER)
  view.setUint32(14, BMP_DIB_HEADER_SIZE, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);                 // positive = bottom-up
  view.setUint16(26, 1, true);                     // planes
  view.setUint16(28, 1, true);                     // bits per pixel
  view.setUint32(30, 0, true);                     // compression (none)
  view.setUint32(34, getBmpPixelDataSize(width, height), true);
  view.setUint32(38, BMP_PPM, true);
  view.setUint32(42, BMP_PPM, true);
  view.setUint32(46, BMP_COLORS_USED, true);
  view.setUint32(50, BMP_COLORS_USED, true);

  // Color table: black = 0x00000000, white = 0x00FFFFFF
  view.setUint32(54, 0x00000000, true);
  view.setUint32(58, 0x00ffffff, true);

  // Pixel data (bottom-up row order for BMP)
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;  // BMP is bottom-up
    const dstOffset = BMP_HEADER_SIZE + y * rowStride;
    for (let x = 0; x < width; x++) {
      if (pixels[srcRow * width + x]) {
        const byteIdx = dstOffset + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        data[byteIdx]! |= 1 << bitIdx;
      }
    }
  }

  return data;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Load a PNG from a URL and convert it to a 1-bit monochrome BMP Uint8Array.
 *
 * @param url — URL of the PNG sprite (e.g. /sprites/front/25.png)
 * @param size — Target size in pixels (both width and height). Defaults to SPRITE_CONFIG.SIZE (64).
 * @returns Uint8Array containing a valid BMP file, or null on failure.
 */
export async function pngToBmp(url: string, size: number = SPRITE_CONFIG.SIZE): Promise<Uint8Array | null> {
  try {
    // Load image
    const img = await loadImage(url);

    // Draw to canvas at target size
    const ctx = getCanvas(size, size);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);

    // Read pixel data
    const imageData = ctx.getImageData(0, 0, size, size);
    const rgba = imageData.data;

    // Convert to 1-bit monochrome
    const pixels = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const r = rgba[i * 4]!;
      const g = rgba[i * 4 + 1]!;
      const b = rgba[i * 4 + 2]!;
      const a = rgba[i * 4 + 3]!;
      // Brightness formula (perceived luminance)
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      // Transparent pixels → black (background), bright pixels → white
      pixels[i] = (a > 128 && brightness > 128) ? 1 : 0;
    }

    return encodeBmp(pixels, size, size);
  } catch (e) {
    console.error(`[SpriteBmpEncoder] Failed to convert ${url}:`, e);
    return null;
  }
}

/**
 * Create an inverted version of a BMP sprite (for damage flash effect).
 * Flips all pixel bits in the pixel data section.
 */
export function invertBmp(bmp: Uint8Array): Uint8Array {
  const copy = bmp.slice();
  for (let i = BMP_HEADER_SIZE; i < copy.length; i++) {
    copy[i] = ~copy[i]! & 0xff;
  }
  return copy;
}

/**
 * Create an empty (all black) BMP of the same dimensions.
 * Useful for "blank" frame in faint flash.
 */
export function emptyBmp(size: number = SPRITE_CONFIG.SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size); // all zeros = all black
  return encodeBmp(pixels, size, size);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}
