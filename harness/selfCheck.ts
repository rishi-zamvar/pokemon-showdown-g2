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
import { LogStream, isFailureLine } from "./logs.ts";
import type { LogLine } from "./logs.ts";
import type { ConsoleEntry, Driver } from "./driver.ts";
import { spawnSync } from "node:child_process";
import { firstSelectable, parseListItems } from "./scenarios/battle.ts";
import {
  AssertionError,
  KNOWN_DEFECTS,
  expectConsoleClean,
  expectFrameDiff,
  expectFrameInk,
  expectGreyLevels,
  expectHostCalls,
  expectLoggedLine,
  expectRegionPersists,
  expectScreen,
} from "./assert.ts";

// ---------------------------------------------------------------------------
// check runner
// ---------------------------------------------------------------------------

let failures = 0;

export interface CheckResult {
  name: string;
  ok: boolean;
  error?: string;
}

/** every check run so far, so runChecks() can hand results to the scenario runner */
const results: CheckResult[] = [];

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    const error = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, error });
    console.log(`FAIL  ${name}: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// stub automation API (log-policy checks need no simulator)
// ---------------------------------------------------------------------------

function entry(id: number, level: string, message: string): ConsoleEntry {
  return { id, level, message, ts: new Date(id * 1000).toISOString() };
}

/**
 * Serves one batch per poll() and records the since_id it was asked for, which
 * is how check 26 proves D-04's incremental polling rather than assuming it.
 */
function stubDriver(batches: ConsoleEntry[][]) {
  const sinceIds: number[] = [];
  let i = 0;
  const state = {
    sinceIds,
    cleared: 0,
    async consoleSince(id: number) {
      sinceIds.push(id);
      const entries = batches[i++] ?? [];
      return { entries, total: entries.length };
    },
    async clearConsole() {
      state.cleared++;
    },
    // LogStream only ever touches those two methods; the rest of Driver is
    // network I/O that these checks deliberately do not exercise.
    asDriver(): Driver {
      return state as unknown as Driver;
    },
  };
  return state;
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
  alpha: (x: number, y: number) => number = () => 255,
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
      rgba[d + 3] = alpha(x, y);
    }
  }
  return { width, height, rgba, png: new Uint8Array(0), capturedAt: 0 };
}

/**
 * Real 576x288 captures from `/api/screenshot/glasses`, committed under
 * harness/fixtures/. Synthetic frames alone cannot validate these metrics:
 * fixtures built by this file encode the same assumptions as the code, so they
 * confirm rather than test. The simulator's actual pixel format (constant
 * green RGB, brightness in alpha) is only discoverable from real output.
 */
function fixture(name: string): Frame {
  return toFrame(new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "fixtures", name))));
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

/**
 * Runs every pure check and RETURNS the results — no printing of a total, no
 * process.exit. `harness/scenarios/selfCheck.ts` calls this so `npm run harness`
 * proves the harness's own primitives before it boots anything and blames the
 * app; the CLI entry point at the bottom of this file calls the same function.
 */
export async function runChecks(): Promise<CheckResult[]> {
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

  // -- 18: a sparse real screen must read sparse ----------------------------
  // The UPPER bound is the load-bearing half. An alpha-blind luma reported
  // FULL = 1.000 on this exact frame, and a "> 0" assertion would have passed
  // it happily while the primitive was totally blind.
  await check("18 real menu capture reads as sparse ink, not saturated", () => {
    const f = fixture("glasses_menu.png");
    assert.equal(f.width, W);
    assert.equal(f.height, H);
    const ink = inkRatio(f, REGIONS.FULL);
    assert.ok(ink > 0, `menu FULL ink is ${ink}, expected > 0`);
    assert.ok(ink < 0.1, `menu FULL ink is ${ink}, expected < 0.1 (saturated?)`);
    // Menu shows no battle HUD at all, so these must be empty.
    assert.equal(inkRatio(f, REGIONS.TEAM_BAR), 0);
    assert.equal(inkRatio(f, REGIONS.LIST), 0);
  });

  // -- 19: real antialiased text genuinely has multiple grey levels ----------
  await check("19 greyLevels on a real capture is > 1", () => {
    for (const name of ["glasses_menu.png", "glasses_fixed.png"]) {
      const levels = greyLevels(fixture(name), REGIONS.FULL);
      assert.ok(levels > 1, `${name} reports ${levels} grey level(s), expected > 1`);
    }
  });

  // -- 20: a full HUD lights every overlay region ---------------------------
  await check("20 real HUD capture has ink in every overlay region", () => {
    const f = fixture("glasses_fixed.png");
    for (const name of ["TEAM_BAR", "OPP_COMPOSITE", "PLAYER_COMPOSITE", "LIST"] as const) {
      const ink = inkRatio(f, REGIONS[name]);
      assert.ok(ink > 0, `HUD ${name} ink is ${ink}, expected > 0`);
    }
    const full = inkRatio(f, REGIONS.FULL);
    assert.ok(full > 0 && full < 0.2, `HUD FULL ink is ${full}, expected 0 < x < 0.2`);
  });

  // -- 21: direct regression guard for the alpha-blind luma bug -------------
  await check("21 a fully transparent frame has zero ink", () => {
    // The simulator's own encoding: RGB pinned to green, brightness in alpha.
    // Alpha 0 everywhere is a blank screen and MUST score 0 — this is exactly
    // the case HARN-03 exists to fail.
    const blank = synthFrame(W, H, () => [0, 255, 0], () => 0);
    assert.equal(inkRatio(blank, REGIONS.FULL), 0);
    assert.equal(greyLevels(blank, REGIONS.FULL), 1);
    // ...and the same green at full alpha is fully lit, so the metric is
    // reading alpha rather than just always returning 0.
    const lit = synthFrame(W, H, () => [0, 255, 0], () => 255);
    assert.equal(inkRatio(lit, REGIONS.FULL), 1);
  });

  // =========================================================================
  // 12-02: log capture and failure policy (HARN-02, HARN-05, D-04, D-05)
  // =========================================================================

  // -- 22: the stdout-only failures — THE point of Phase 12 ------------------
  // A harness that reads only /api/console passes the defect that made this
  // app unplayable. The first line below appears nowhere in the console API.
  await check("22 stdout-only failure lines are classified as failures", () => {
    const mustFail = [
      "[2026-09-17T16:36:58Z WARN evenhub_simulator_lib::flutter] RebuildPageContainer validation failed: image container size 576x24 exceeds maximum 288x144",
      "[2026-09-17T16:36:59Z ERROR evenhub_simulator_lib] container 8 not found",
    ];
    for (const message of mustFail) {
      assert.ok(
        isFailureLine({ seq: 0, source: "stdout", level: "warn", message }),
        `stdout line was NOT classified as a failure: ${message}`,
      );
    }
  });

  // -- 23: console failures, including a mere WARN (D-05) --------------------
  await check("23 console failure lines are classified as failures", () => {
    const mustFail: Array<[string, string]> = [
      ["error", "[GlassAdapter] bootstrapStartup failed with code: 2"],
      ["log", "[uncaught] TypeError: x is not a function"],
      ["log", "[unhandledrejection] Error: boom"],
      ["log", "[fetch] 404 /data/learnsets.json"],
      // a WARN: the game was unplayable the whole time this was being logged
      ["warn", "[glass] rebuildPageContainer failed after retry"],
    ];
    for (const [level, message] of mustFail) {
      assert.ok(
        isFailureLine({ seq: 0, source: "console", level, message }),
        `console ${level} line was NOT classified as a failure: ${message}`,
      );
    }
  });

  // -- 24: healthy lines must NOT fail the run -------------------------------
  // Without this the policy could be `() => true` and check 22/23 would pass.
  await check("24 healthy lines on both streams are not failures", () => {
    const mustPass: LogLine[] = [
      {
        seq: 0,
        source: "console",
        level: "log",
        message: "[BATTLE] Step 6: rendering battle HUD...",
      },
      {
        seq: 0,
        source: "console",
        level: "debug",
        message: "[buildComposites] player active=Mudsdale hp=100/100 idx=0",
      },
      {
        seq: 0,
        source: "stdout",
        level: "info",
        message:
          "[2026-09-17T16:36:50Z INFO evenhub_simulator_lib] automation server listening on 127.0.0.1:9898",
      },
    ];
    for (const l of mustPass) {
      assert.ok(!isFailureLine(l), `healthy line was classified as a failure: ${l.message}`);
    }
  });

  // -- 25: hostCalls counts both real image-send paths (D-13) ----------------
  await check("25 hostCalls counts both updateImageRawData paths", async () => {
    const driver = stubDriver([
      [
        entry(1, "log", "[GlassAdapter] sendBmpData container=oppSpr size=1234B"),
        entry(2, "log", "[GlassAdapter] sendBmpData container=oppSpr size=1234B"),
        entry(3, "log", "[GlassAdapter] createStartUpPageContainer result: 0"),
      ],
    ]);
    const logs = new LogStream(driver.asDriver());
    await logs.poll();
    assert.deepEqual(logs.hostCalls(), { updateImageRawData: 2, createStartUpPageContainer: 1 });

    // the other live path (showBattleHud) must land on the same counter
    const other = stubDriver([
      [
        entry(1, "log", "[GlassAdapter] sending oppSprite BMP: 1234 bytes"),
        entry(2, "log", "[GlassAdapter] sending playerSprite BMP: 4321 bytes"),
      ],
    ]);
    const logs2 = new LogStream(other.asDriver());
    await logs2.poll();
    assert.deepEqual(logs2.hostCalls(), { updateImageRawData: 2 });
  });

  // -- 26: since_id advances, so nothing is counted twice (D-04) -------------
  await check("26 poll() never yields a duplicate line", async () => {
    const driver = stubDriver([
      [entry(1, "log", "a"), entry(2, "log", "b"), entry(3, "log", "c")],
      [entry(4, "log", "d"), entry(5, "log", "e")],
    ]);
    const logs = new LogStream(driver.asDriver());
    const first = await logs.poll();
    const second = await logs.poll();
    assert.equal(first.length, 3);
    assert.equal(second.length, 2);
    assert.deepEqual(driver.sinceIds, [0, 3], "second poll did not advance since_id");
    assert.equal(logs.all().length, 5);
    assert.equal(new Set(logs.all().map((l) => l.message)).size, 5);
  });

  // -- 27: blank stdout lines are not lines ----------------------------------
  await check("27 empty stdout lines add nothing and do not inflate the count", () => {
    const logs = new LogStream(stubDriver([]).asDriver());
    logs.pushStdout("");
    logs.pushStdout("   ");
    assert.equal(logs.all().length, 0);
    assert.equal(logs.stdoutLineCount, 0);
  });

  // -- 28: reset() scopes assertions to one step (D-04) ----------------------
  await check("28 reset() clears the console, the buffer and since_id", async () => {
    const driver = stubDriver([
      [entry(7, "log", "before")],
      [entry(1, "log", "after")],
    ]);
    const logs = new LogStream(driver.asDriver());
    await logs.poll();
    assert.equal(logs.all().length, 1);
    await logs.reset();
    assert.equal(driver.cleared, 1, "reset() did not DELETE /api/console");
    assert.equal(logs.all().length, 0);
    await logs.poll();
    assert.deepEqual(driver.sinceIds, [0, 0], "reset() did not put since_id back to 0");
  });

  // -- 29: THE B2 GUARD — reset() must not zero stdoutLineCount --------------
  // Without this, a dead stdout tee is indistinguishable from a clean run: the
  // first ctx.step() erases the evidence and HARN-02 switches itself off in
  // silence while every assertion keeps passing.
  await check("29 stdoutLineCount is monotonic across reset()", async () => {
    const logs = new LogStream(stubDriver([]).asDriver());
    logs.pushStdout("[INFO x] one");
    logs.pushStdout("[INFO x] two");
    logs.pushStdout("[INFO x] three");
    assert.equal(logs.stdoutLineCount, 3);
    await logs.reset();
    assert.equal(logs.stdoutLineCount, 3, "reset() zeroed stdoutLineCount");
    logs.pushStdout("[INFO x] four");
    assert.equal(logs.stdoutLineCount, 4);
    assert.equal(logs.all().length, 1, "reset() did not clear the line buffer");
  });

  // -- 30: nextSeq() is a usable watermark (B4) ------------------------------
  await check("30 nextSeq() separates lines before an action from lines after", async () => {
    const driver = stubDriver([[entry(1, "log", "[screen] stale")], [entry(2, "log", "[screen] fresh")]]);
    const logs = new LogStream(driver.asDriver());
    logs.pushStdout("[INFO x] older");
    await logs.poll();
    const mark = logs.nextSeq();
    for (const l of logs.all()) {
      assert.ok(l.seq < mark, `seq ${l.seq} of an earlier line is not < nextSeq ${mark}`);
    }
    logs.pushStdout("[INFO x] newer");
    await logs.poll();
    const after = logs.all().filter((l) => l.seq >= mark);
    assert.deepEqual(
      after.map((l) => l.message),
      ["[INFO x] newer", "[screen] fresh"],
      "watermark filter did not select exactly the lines added after the mark",
    );
  });

  // -------------------------------------------------------------------------
  // 31-36 — plan 12-03: the assertion vocabulary, the screen oracle and the
  // Node preflight. Appended; checks 01-30 above are untouched.
  // -------------------------------------------------------------------------

  // -- 31: THE D1 FIX — the preflight that an old runtime can actually load ---
  // The in-file guards in run.ts/probe.ts/selfCheck.ts cannot fire for
  // ERR_UNKNOWN_FILE_EXTENSION (deferred item D1): that failure happens at
  // module resolution, before any byte of the entry file runs. The real guard
  // is the plain-JS `node -e` preflight inside the `harness` npm script. This
  // check runs THAT EXACT STRING, read from package.json, against fabricated
  // version numbers -- so it tests the shipped expression, not a copy of it.
  await check("31 the npm run harness preflight rejects old Node and accepts the floor", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const script = pkg.scripts["harness"];
    assert.ok(script, "package.json has no `harness` script");
    const m = /^node -e "(.+)" && node harness\/run\.ts$/.exec(script!);
    assert.ok(m, `harness script is not "node -e <preflight> && node harness/run.ts": ${script}`);
    const expr = m![1]!;
    assert.ok(
      expr.includes("process.versions.node"),
      "the preflight does not read process.versions.node, so it cannot be checking a version",
    );

    const run = (version: string | null): number => {
      // Substituting the literal is the only way to exercise the boundary: a
      // child process's process.versions.node is not writable from outside.
      const src = version === null ? expr : expr.replaceAll("process.versions.node", JSON.stringify(version));
      return spawnSync(process.execPath, ["-e", src], { encoding: "utf8" }).status ?? -1;
    };

    for (const bad of ["20.19.0", "21.9.0", "22.0.0", "22.17.9"]) {
      assert.equal(run(bad), 1, `preflight did NOT reject Node ${bad}`);
    }
    for (const good of ["22.18.0", "22.20.0", "23.1.0", "24.0.0"]) {
      assert.equal(run(good), 0, `preflight wrongly rejected Node ${good}`);
    }
    // ...and unmodified, on the runtime actually executing this check
    assert.equal(run(null), 0, `preflight rejects the running Node ${process.versions.node}`);
  });

  // -- 32: the screen oracle is placed where waitScreen needs it --------------
  // Placement is load-bearing, not stylistic. Logged before/inside the switch,
  // the line announces a screen ~477ms before showOverlayHud's three image
  // sends and rebuild have put its pixels on the framebuffer, so every
  // expectFrameInk would assert against the OUTGOING screen.
  await check("32 [screen] oracle is logged after render()'s switch, before updatePhoneCompanion", () => {
    // Line comments are stripped first: a commented-out emit is not an emit,
    // and this check is the thing standing between a deleted oracle and a
    // 60-second waitScreen timeout that reads like a hung app.
    const src = fs
      .readFileSync(path.join(import.meta.dirname, "..", "src", "screens", "ScreenController.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const emits = src.match(/console\.log\(`\[screen\] /g) ?? [];
    assert.equal(emits.length, 1, `expected exactly one [screen] emit in src/, found ${emits.length}`);

    const render = src.indexOf("private async render()");
    assert.ok(render > 0, "render() funnel not found");
    const lastCase = src.indexOf("case 'ANIMATING'", render); // last case of the switch
    const emit = src.indexOf("console.log(`[screen] ", render);
    const companion = src.indexOf("updatePhoneCompanion", render);
    assert.ok(lastCase > render, "the render switch's last case not found");
    assert.ok(emit > lastCase, "the [screen] emit is inside or above the switch, not after it");
    assert.ok(emit < companion, "the [screen] emit is below the phone-companion update");
  });

  // -- 33: expectFrameInk really fails a blank region (HARN-03) ---------------
  // If this ever passes on a blank region, every framebuffer assertion in every
  // later phase is decoration. scenarios/negativeProof.ts proves the same thing
  // against a live capture; this proves it without a simulator.
  await check("33 expectFrameInk fails blank and saturated regions, passes an inked one", () => {
    const blank = synthFrame(DISPLAY.WIDTH, DISPLAY.HEIGHT, () => 0);
    const full = synthFrame(DISPLAY.WIDTH, DISPLAY.HEIGHT, () => 255);
    const some = synthFrame(DISPLAY.WIDTH, DISPLAY.HEIGHT, (_x, y) => (y % 10 === 0 ? 255 : 0));

    assert.throws(() => expectFrameInk(blank, REGIONS.CONTENT, 0.01, 0.6), AssertionError);
    assert.throws(() => expectFrameInk(full, REGIONS.CONTENT, 0.01, 0.6), AssertionError);
    expectFrameInk(some, REGIONS.CONTENT, 0.01, 0.6);
    // the message must carry the observed value, because it IS the failure report
    assert.throws(
      () => expectFrameInk(blank, REGIONS.CONTENT, 0.01, 0.6),
      /CONTENT: ink 0\.000 outside \[0\.01, 0\.6\]/,
    );

    // the rest of the framebuffer vocabulary, same shape
    assert.throws(() => expectGreyLevels(blank, REGIONS.CONTENT, 2), /1 distinct grey levels/);
    expectGreyLevels(synthFrame(DISPLAY.WIDTH, DISPLAY.HEIGHT, (x) => (x % 16) * 17), REGIONS.CONTENT, 10);
    assert.throws(() => expectRegionPersists([some, blank, some], REGIONS.CONTENT), /frame 1 of 3/);
    // an empty sequence must NOT pass vacuously
    assert.throws(() => expectRegionPersists([], REGIONS.CONTENT), /zero frames/);
    expectRegionPersists([some, some], REGIONS.CONTENT);
  });

  // -- 34: the log vocabulary ------------------------------------------------
  await check("34 expectLoggedLine / expectScreen / expectHostCalls fail and pass on real streams", async () => {
    const logs = new LogStream(
      stubDriver([[entry(1, "log", "[screen] MAIN_MENU cursor=0"), entry(2, "log", "[GlassAdapter] sendBmpData container=1")]]).asDriver(),
    );
    await logs.poll();

    assert.equal(expectLoggedLine(logs, /\[screen\] MAIN_MENU/).source, "console");
    assert.throws(() => expectLoggedLine(logs, /\[screen\] END_SCREEN/), AssertionError);
    // a mismatch must print what WAS seen, or it is not debuggable
    assert.throws(() => expectLoggedLine(logs, /nope/), /\[screen\] MAIN_MENU cursor=0/);

    expectScreen(logs, "MAIN_MENU");
    assert.throws(() => expectScreen(logs, "BATTLE_HUD"), AssertionError);
    // \b in expectScreen must not let a longer screen name satisfy a shorter one
    const prefixed = new LogStream(stubDriver([[entry(1, "log", "[screen] MAIN_MENU_V2 cursor=0")]]).asDriver());
    await prefixed.poll();
    assert.throws(() => expectScreen(prefixed, "MAIN_MENU"), AssertionError);

    expectHostCalls(logs, "updateImageRawData", 1);
    assert.throws(() => expectHostCalls(logs, "updateImageRawData", 0), /1 host call\(s\), ceiling is 0/);
    expectHostCalls(logs, "neverCalled", 0);
  });

  // -- 35: HARN-05 + the known-defect allow-list -----------------------------
  // The allow-list is the one place D-05 ("warnings are not tolerated") is
  // bent, so it gets the most sceptical check in this file: it must waive the
  // two named boot lines and NOTHING else -- in particular not the
  // container-validation line this whole phase exists to catch, and not the
  // dropped-input line that makes a no-op look like a handled input.
  await check("35 expectConsoleClean fails on stdout validation lines; the allow-list waives only its two", () => {
    const logs = new LogStream(stubDriver([]).asDriver());
    expectConsoleClean(logs);

    logs.pushStdout(
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::flutter] RebuildPageContainer validation failed: image container size 576x24 exceeds maximum 288x144",
    );
    assert.throws(() => expectConsoleClean(logs), AssertionError);
    assert.throws(() => expectConsoleClean(logs), /RebuildPageContainer validation failed/);

    const waived = [
      "[2026-01-01T00:00:00Z WARN  lvgl] [Warn]\t(9.769, +0)\t lv_draw_unit_draw_letter: lv_draw_letter: glyph dsc. not found for U+2591 lv_draw_label.c:575",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] update_image_raw_data: container 8 not found",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::flutter] TextContainerUpgrade failed: container 2 not found",
    ];
    const clean = new LogStream(stubDriver([]).asDriver());
    for (const w of waived) clean.pushStdout(w);
    expectConsoleClean(clean); // the two known boot defects, waived by id

    // nothing else is waived, including near-misses of the same families
    const notWaived = [
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] inject_input: no active event container",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] update_image_raw_data: container 3 not found",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] update_image_raw_data: container 8 not found, dropping 1440 bytes",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::flutter] TextContainerUpgrade failed: container 4 not found",
      // a DIFFERENT missing glyph is a different defect and must still fail
      "[2026-01-01T00:00:00Z WARN  lvgl] [Warn]\t(9.769, +0)\t lv_draw_unit_draw_letter: lv_draw_letter: glyph dsc. not found for U+2588 lv_draw_label.c:575",
    ];
    for (const line of notWaived) {
      const l = new LogStream(stubDriver([]).asDriver());
      l.pushStdout(line);
      assert.throws(() => expectConsoleClean(l), AssertionError, `allow-list swallowed: ${line}`);
    }

    // console-side failures are never waived: the allow-list is stdout-only
    const con = new LogStream(stubDriver([[entry(1, "error", "boom")]]).asDriver());
    assert.equal(KNOWN_DEFECTS.every((d) => d.owner.length > 0 && d.id.length > 0), true);
    return con.poll().then(() => {
      assert.throws(() => expectConsoleClean(con), AssertionError);
    });
  });

  // -- 36: expectFrameDiff is a documented refusal, not a missing export ------
  await check("36 expectFrameDiff throws naming D-10", () => {
    const f = synthFrame(DISPLAY.WIDTH, DISPLAY.HEIGHT, () => 0);
    assert.throws(() => expectFrameDiff(f, REGIONS.FULL, "golden.png"), /D-10/);
    assert.throws(() => expectFrameDiff(f, REGIONS.FULL, "golden.png"), AssertionError);
  });

  // -- 37: the switch-list parser reads a REAL simulator stdout line ---------
  // Verbatim from a live run (.harness-runs/2026-09-18T15-18-04-069Z). This is
  // the line the battle script depends on to avoid clicking a fainted entry,
  // which deadlocks the app on SWITCH_SELECT with no log line of any kind.
  await check("37 parseListItems reads item_name off a real stdout line", () => {
    const real =
      '[2026-09-18T15:12:24Z INFO  evenhub_simulator_lib::flutter] RebuildPageContainer ' +
      'CreateStartUpPageContainer { container_total_num: Some(4), list_object: Some([ListContainerProperty ' +
      '{ x_position: Some(288), item_container: ListItemContainerProperty { item_count: Some(5), ' +
      'item_width: None, is_item_select_border_en: Some(1), item_name: Some(["Gogoat 0% (fainted)", ' +
      '"Golurk 100%", "Vaporeon 100%", "Venomoth 100%", "Gardevoir 100%"]) }, is_event_capture: Some(1) }])';
    assert.deepEqual(parseListItems(real), [
      "Gogoat 0% (fainted)",
      "Golurk 100%",
      "Vaporeon 100%",
      "Venomoth 100%",
      "Gardevoir 100%",
    ]);
    // a line that carries no list must be null, not an empty array: an empty
    // array would read as "a list with nothing selectable" and throw the wrong
    // diagnosis at whoever is debugging a stalled switch.
    assert.equal(parseListItems("[INFO] UpdateImageRawData container_id=Some(4)"), null);
    assert.deepEqual(parseListItems('item_name: Some(["Attack", "Switch"])'), ["Attack", "Switch"]);
  });

  // -- 38: fainted entries are skipped, and all-fainted is -1 ----------------
  await check("38 firstSelectable skips the entries handleSwitchSelect drops", () => {
    assert.equal(firstSelectable(["Gogoat 0% (fainted)", "Golurk 100%"]), 1);
    assert.equal(firstSelectable(["Golurk 100%", "Gogoat 0% (fainted)"]), 0);
    assert.equal(firstSelectable(["A 0% (fainted)", "B 0% (fainted)"]), -1);
    assert.equal(firstSelectable([]), -1);
  });

  return results;
}

// CLI entry point. Guarded so importing this module from a scenario runs the
// checks without exiting the harness process out from under it.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const r = await runChecks();
  const bad = r.filter((x) => !x.ok).length;
  console.log(bad === 0 ? `\nOK  ${r.length}/${r.length} checks passed` : `\nFAILED  ${bad}/${r.length} check(s)`);
  process.exit(bad ? 1 : 0);
}
