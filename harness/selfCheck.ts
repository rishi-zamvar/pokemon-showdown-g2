/**
 * Runnable self-check for the harness framebuffer primitives.
 *
 * `node harness/selfCheck.ts` — no test framework (D-11), no dependencies.
 * Exits 0 when every primitive is correct, 1 when any check fails.
 */
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj! < 22 || (maj === 22 && min! < 18)) {
  console.error(
    `harness needs Node >=22.18 for native TypeScript execution; this is ${process.versions.node}`,
  );
  process.exit(1);
}

import assert from "node:assert/strict";
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodePng } from "./png.ts";
import { INK_THRESHOLD, greyLevels, inkRatio, saveFrame, toFrame } from "./frame.ts";
import type { Frame } from "./frame.ts";
import { REGIONS } from "./regions.ts";
import { DISPLAY, OVERLAY_LAYOUT } from "../src/config/constants.ts";

// ---------------------------------------------------------------------------
// check runner
// ---------------------------------------------------------------------------

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// synthetic PNG builder (no fixture files)
// ---------------------------------------------------------------------------

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  dv.setUint32(payload.length + 8, crc32(out.subarray(4, payload.length + 8)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** One scanline as it appears inside the zlib stream: a filter byte + filtered bytes. */
interface Scanline {
  filter: number;
  bytes: Uint8Array;
}

interface PngOpts {
  interlace?: number;
  splitIdat?: boolean;
  palette?: Uint8Array;
  badMagic?: boolean;
}

function makePng(
  width: number,
  height: number,
  colorType: number,
  bitDepth: number,
  rows: Scanline[],
  opts: PngOpts = {},
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = opts.interlace ?? 0;

  const scan = concat(rows.map((r) => concat([Uint8Array.of(r.filter), r.bytes])));
  const deflated = new Uint8Array(zlib.deflateSync(scan));

  const parts: Uint8Array[] = [];
  parts.push(Uint8Array.from(opts.badMagic ? [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0] : SIG));
  parts.push(chunk("IHDR", ihdr));
  if (opts.palette) parts.push(chunk("PLTE", opts.palette));
  if (opts.splitIdat) {
    const mid = Math.floor(deflated.length / 2);
    parts.push(chunk("IDAT", deflated.subarray(0, mid)));
    parts.push(chunk("IDAT", deflated.subarray(mid)));
  } else {
    parts.push(chunk("IDAT", deflated));
  }
  parts.push(chunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

/** Reference Paeth predictor, written independently of png.ts. */
function paethRef(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Forward (encode-side) PNG filter, so a decoder bug cannot be mirrored by the fixture. */
function applyFilter(
  ft: number,
  raw: Uint8Array,
  prior: Uint8Array | null,
  bpp: number,
): Uint8Array {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const a = i >= bpp ? raw[i - bpp]! : 0;
    const b = prior ? prior[i]! : 0;
    const c = prior && i >= bpp ? prior[i - bpp]! : 0;
    let pred = 0;
    if (ft === 1) pred = a;
    else if (ft === 2) pred = b;
    else if (ft === 3) pred = (a + b) >> 1;
    else if (ft === 4) pred = paethRef(a, b, c);
    out[i] = (raw[i]! - pred) & 0xff;
  }
  return out;
}

/** Split a flat pixel buffer into `height` scanlines and filter each with `filters[y]`. */
function filterRows(
  pixels: Uint8Array,
  width: number,
  height: number,
  bpp: number,
  filters: number[],
): Scanline[] {
  const stride = width * bpp;
  const rows: Scanline[] = [];
  let prior: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const raw = pixels.subarray(y * stride, (y + 1) * stride);
    const ft = filters[y] ?? 0;
    rows.push({ filter: ft, bytes: applyFilter(ft, raw, prior, bpp) });
    prior = raw;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// synthetic frames (built without a PNG round-trip, so the metric checks below
// stay independent of the decoder)
// ---------------------------------------------------------------------------

function synthFrame(
  width: number,
  height: number,
  paint: (x: number, y: number) => number | [number, number, number],
): Frame {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = paint(x, y);
      const rgb: [number, number, number] = typeof v === "number" ? [v, v, v] : v;
      const d = (y * width + x) * 4;
      rgba[d] = rgb[0];
      rgba[d + 1] = rgb[1];
      rgba[d + 2] = rgb[2];
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba, png: new Uint8Array(0), capturedAt: 0 };
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // -- 01: minimal 2x2 RGBA, filter 0 everywhere ---------------------------
  await check("01 decodePng 2x2 RGBA colorType 6 filter None", () => {
    const px = Uint8Array.from([
      0, 0, 0, 255, 255, 255, 255, 255,
      17, 34, 51, 128, 255, 0, 0, 255,
    ]);
    const png = makePng(2, 2, 6, 8, filterRows(px, 2, 2, 4, [0, 0]));
    const d = decodePng(png);
    assert.equal(d.width, 2);
    assert.equal(d.height, 2);
    assert.equal(d.rgba.length, 16);
    assert.deepEqual(Array.from(d.rgba), Array.from(px));
  });

  // -- 02: all four non-trivial filters ------------------------------------
  const px4 = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < px4.length; i++) px4[i] = (i * 37 + 11) & 0xff;
  await check("02 decodePng 4x4 RGBA filters Sub/Up/Average/Paeth", () => {
    const png = makePng(4, 4, 6, 8, filterRows(px4, 4, 4, 4, [1, 2, 3, 4]));
    const d = decodePng(png);
    assert.equal(d.width, 4);
    assert.equal(d.height, 4);
    assert.deepEqual(Array.from(d.rgba), Array.from(px4));
  });

  // -- 03: colorType 2 (RGB) expands with alpha 255 -------------------------
  await check("03 decodePng colorType 2 RGB expands to RGBA alpha 255", () => {
    const px = Uint8Array.from([
      10, 20, 30, 40, 50, 60,
      70, 80, 90, 100, 110, 120,
    ]);
    const png = makePng(2, 2, 2, 8, filterRows(px, 2, 2, 3, [0, 1]));
    const d = decodePng(png);
    assert.deepEqual(
      Array.from(d.rgba),
      [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255],
    );
  });

  // -- 04: colorType 0 (greyscale) -----------------------------------------
  await check("04 decodePng colorType 0 grey expands to R=G=B, alpha 255", () => {
    const px = Uint8Array.from([0, 85, 170, 255]);
    const png = makePng(2, 2, 0, 8, filterRows(px, 2, 2, 1, [0, 2]));
    const d = decodePng(png);
    assert.deepEqual(
      Array.from(d.rgba),
      [0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255],
    );
  });

  // -- 05: IDAT split across two chunks -------------------------------------
  await check("05 decodePng joins IDAT split across two chunks", () => {
    const rows = filterRows(px4, 4, 4, 4, [1, 2, 3, 4]);
    const single = decodePng(makePng(4, 4, 6, 8, rows));
    const split = decodePng(makePng(4, 4, 6, 8, rows, { splitIdat: true }));
    assert.deepEqual(Array.from(split.rgba), Array.from(single.rgba));
    assert.deepEqual(Array.from(split.rgba), Array.from(px4));
  });

  // -- 06: 16-bit input is a hard throw --------------------------------------
  await check("06 decodePng throws naming the unsupported bit depth 16", () => {
    const png = makePng(2, 2, 6, 16, [
      { filter: 0, bytes: new Uint8Array(16) },
      { filter: 0, bytes: new Uint8Array(16) },
    ]);
    assert.throws(() => decodePng(png), /bit depth/i);
    assert.throws(() => decodePng(png), /16/);
  });

  // -- 07: interlaced input is a hard throw ----------------------------------
  await check("07 decodePng throws naming interlace", () => {
    const png = makePng(2, 2, 6, 8, filterRows(new Uint8Array(16), 2, 2, 4, [0, 0]), {
      interlace: 1,
    });
    assert.throws(() => decodePng(png), /interlace/i);
  });

  // -- 08: palette PNGs must throw, never fall through -----------------------
  // Index bytes look like plausible pixel data to a naive RGBA reader, so a
  // silent fallthrough would let ink assertions measure garbage.
  await check("08 decodePng throws naming the unsupported colour type 3", () => {
    const png = makePng(2, 2, 3, 8, filterRows(Uint8Array.from([0, 1, 2, 3]), 2, 2, 1, [0, 0]), {
      palette: Uint8Array.from([0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255]),
    });
    assert.throws(() => decodePng(png), /colou?r type/i);
    assert.throws(() => decodePng(png), /3/);
  });

  // -- 09: bad magic bytes ---------------------------------------------------
  await check("09 decodePng throws on bad signature", () => {
    const png = makePng(2, 2, 6, 8, filterRows(new Uint8Array(16), 2, 2, 4, [0, 0]), {
      badMagic: true,
    });
    assert.throws(() => decodePng(png), /signature|not a PNG/i);
  });

  const W = DISPLAY.WIDTH;
  const H = DISPLAY.HEIGHT;

  // -- 10: an all-black screen has no ink -----------------------------------
  // This is the blank-screen case HARN-03 exists to catch.
  await check("10 inkRatio of an all-black frame is 0", () => {
    assert.equal(inkRatio(synthFrame(W, H, () => 0), REGIONS.FULL), 0);
    // INK_THRESHOLD is exclusive: a frame sitting exactly on it is still dark.
    assert.equal(inkRatio(synthFrame(W, H, () => INK_THRESHOLD), REGIONS.FULL), 0);
  });

  // -- 11: an all-white screen is fully lit ---------------------------------
  await check("11 inkRatio of an all-white frame is 1", () => {
    assert.equal(inkRatio(synthFrame(W, H, () => 255), REGIONS.FULL), 1);
  });

  // -- 12: half-lit screen ---------------------------------------------------
  await check("12 inkRatio of a half-white frame is 0.5", () => {
    const f = synthFrame(W, H, (_x, y) => (y < H / 2 ? 255 : 0));
    assert.equal(inkRatio(f, REGIONS.FULL), 0.5);
  });

  // -- 13: regions read at their own offsets, not globally -------------------
  await check("13 inkRatio is scoped to the region rectangle", () => {
    const L = REGIONS.LIST;
    const f = synthFrame(W, H, (x, y) =>
      x >= L.x && x < L.x + L.w && y >= L.y && y < L.y + L.h ? 255 : 0,
    );
    assert.equal(inkRatio(f, REGIONS.LIST), 1);
    assert.equal(inkRatio(f, REGIONS.TEAM_BAR), 0);
    assert.ok(inkRatio(f, REGIONS.FULL) > 0 && inkRatio(f, REGIONS.FULL) < 1);
  });

  // -- 14: distinct 4-bit grey buckets ---------------------------------------
  await check("14 greyLevels counts distinct 4-bit buckets", () => {
    // 16 evenly spaced levels: n * 17 spans 0..255 and lands one per bucket.
    const ramp = synthFrame(W, H, (x) => (x % 16) * 17);
    assert.equal(greyLevels(ramp, REGIONS.TEAM_BAR), 16);
    assert.equal(greyLevels(synthFrame(W, H, () => 0), REGIONS.FULL), 1);
  });

  // -- 15: no region can silently read out of bounds -------------------------
  await check("15 every REGIONS entry fits inside the display", () => {
    const f = synthFrame(W, H, () => 0);
    for (const [key, r] of Object.entries(REGIONS)) {
      assert.equal(r.name, key, `region ${key} carries name ${r.name}`);
      assert.ok(r.w > 0 && r.h > 0, `region ${key} is ${r.w}x${r.h}`);
      assert.ok(r.x >= 0 && r.y >= 0, `region ${key} origin ${r.x},${r.y} is negative`);
      assert.ok(
        r.x + r.w <= W && r.y + r.h <= H,
        `region ${key} ends at ${r.x + r.w},${r.y + r.h} outside ${W}x${H}`,
      );
      assert.doesNotThrow(() => inkRatio(f, r), `region ${key} rejected by inkRatio`);
    }
    // A region past the edge must throw, never clamp — a clamped region would
    // make an assertion pass for the wrong reason.
    assert.throws(() => inkRatio(f, { name: "OOB", x: W - 1, y: 0, w: 4, h: 4 }), /OOB/);
  });

  // -- 16: regions are derived from app layout, not restated (D-08) ----------
  await check("16 REGIONS.LIST is derived from OVERLAY_LAYOUT", () => {
    assert.equal(REGIONS.LIST.x, OVERLAY_LAYOUT.LIST_X);
    assert.equal(REGIONS.LIST.y, OVERLAY_LAYOUT.LIST_Y);
    assert.equal(REGIONS.LIST.w, OVERLAY_LAYOUT.LIST_W);
    assert.equal(REGIONS.LIST.h, OVERLAY_LAYOUT.LIST_H);
    assert.equal(REGIONS.TEAM_BAR.w, OVERLAY_LAYOUT.TEAM_BAR_W);
    assert.equal(REGIONS.TEAM_BAR.h, OVERLAY_LAYOUT.TEAM_BAR_H);
  });

  // -- 17: saveFrame writes the original PNG bytes, unaltered ----------------
  await check("17 saveFrame writes a byte-identical PNG artifact", async () => {
    const px = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255, 9, 9, 9, 255, 1, 2, 3, 255]);
    const png = makePng(2, 2, 6, 8, filterRows(px, 2, 2, 4, [0, 1]));
    const f = toFrame(png);
    assert.equal(f.width, 2);
    assert.deepEqual(Array.from(f.rgba), Array.from(px));
    assert.ok(f.capturedAt > 0, "capturedAt not stamped");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-selfcheck-"));
    // nested path proves saveFrame creates missing directories
    const file = path.join(dir, "frames", "shot.png");
    try {
      await saveFrame(f, file);
      const back = new Uint8Array(fs.readFileSync(file));
      assert.equal(back.length, png.length);
      assert.deepEqual(Array.from(back.subarray(0, 8)), SIG);
      assert.deepEqual(Array.from(back), Array.from(png));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const total = 17;
  console.log(
    failures === 0
      ? `\nOK  ${total}/${total} checks passed`
      : `\nFAILED  ${failures}/${total} check(s)`,
  );
  process.exit(failures ? 1 : 0);
}

void main();
