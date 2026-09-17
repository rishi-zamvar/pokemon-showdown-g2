/**
 * Framebuffer metrics. Exactly two of them, per D-07/D-10: ink coverage and
 * distinct grey-level count. No golden-image diffing — simulator and hardware
 * render fonts differently, so pixel-exact comparison fails for reasons that
 * have nothing to do with defects.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { decodePng } from "./png.ts";

export interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** original PNG bytes, kept so saveFrame() writes a real PNG artifact */
  png: Uint8Array;
  capturedAt: number;
}

/**
 * Premultiplied luminance above this counts as lit.
 *
 * The floor is stated on the 0..255 luma scale, but note the two very different
 * ranges it has to straddle:
 *   - opaque greyscale content (what the hardware panel gets): a lit pixel runs
 *     up to 255, and the dimmest of the 16 grey levels is 17, which clears 16.
 *   - simulator captures: RGB is the constant green (0,255,0) and brightness
 *     lives entirely in alpha, so premultiplied luma tops out at
 *     round(0.587 * 255) = 150. The dimmest alpha seen in real captures is 96,
 *     giving 150 * 96/255 = 56 — still comfortably clear of 16.
 * An unlit pixel is alpha 0 in both worlds and scores exactly 0.
 */
export const INK_THRESHOLD = 16;

/**
 * BT.601 luma scaled by alpha (premultiplied). Matches the greyscale conversion
 * the host applies, so harness and device agree on what "lit" means.
 *
 * Alpha is NOT optional. The simulator's framebuffer carries brightness in the
 * alpha channel and leaves RGB at a constant (0,255,0) on every pixel, lit or
 * not — so an alpha-blind luma returns 150 for all 165,888 pixels, making
 * inkRatio exactly 1.0 on every region of every frame including a blank one.
 * That silently defeats HARN-03, whose whole job is failing a blank screen.
 * Black is LED-off on this panel, so an unlit pixel must score 0.
 *
 * Rounding matters too: the three coefficients sum to 0.9999999999999999 in
 * IEEE754, so an unrounded lum(16,16,16,255) is 15.99… and would bucket and
 * threshold one level low.
 */
function lum(r: number, g: number, b: number, a: number): number {
  return Math.round((0.299 * r + 0.587 * g + 0.114 * b) * (a / 255));
}

/**
 * A region that hangs off the edge is a bug in the caller's layout maths.
 * Clamping it would let an assertion pass while measuring the wrong pixels, so
 * this throws instead.
 */
function assertInside(f: Frame, r: Region): void {
  if (
    r.w <= 0 ||
    r.h <= 0 ||
    r.x < 0 ||
    r.y < 0 ||
    r.x + r.w > f.width ||
    r.y + r.h > f.height
  ) {
    throw new Error(
      `region ${r.name} (${r.x},${r.y} ${r.w}x${r.h}) does not fit inside the ${f.width}x${f.height} frame`,
    );
  }
}

export function toFrame(png: Uint8Array): Frame {
  const { width, height, rgba } = decodePng(png);
  return { width, height, rgba, png, capturedAt: Date.now() };
}

/** fraction (0..1) of pixels in `r` whose luminance exceeds INK_THRESHOLD */
export function inkRatio(f: Frame, r: Region): number {
  assertInside(f, r);
  let lit = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const d = (y * f.width + x) * 4;
      if (lum(f.rgba[d]!, f.rgba[d + 1]!, f.rgba[d + 2]!, f.rgba[d + 3]!) > INK_THRESHOLD) lit++;
    }
  }
  return lit / (r.w * r.h);
}

/** count of distinct 4-bit (luminance >> 4) buckets present in `r` */
export function greyLevels(f: Frame, r: Region): number {
  assertInside(f, r);
  const buckets = new Set<number>();
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const d = (y * f.width + x) * 4;
      buckets.add(lum(f.rgba[d]!, f.rgba[d + 1]!, f.rgba[d + 2]!, f.rgba[d + 3]!) >> 4);
    }
  }
  return buckets.size;
}

/**
 * Writes the ORIGINAL PNG bytes (D-09 wants a debuggable artifact and this
 * harness has no encoder, so re-encoding is neither possible nor wanted).
 */
export async function saveFrame(f: Frame, filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, f.png);
}
