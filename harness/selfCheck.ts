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
import { CONTAINER_IDS, CONTAINER_NAMES, DISPLAY, GLASS_LAYOUT, MAIN_MENU_CONTEXT_MENU, MENU_ITEM_IDS, OVERLAY_LAYOUT, SPRITE_CONFIG } from "../src/config/constants.ts";
import {
  MenuContainerProperty,
  MenuItemProperty,
  utf8ByteLength,
  validateEvenHubPageContainer,
} from "@evenrealities/even_hub_sdk";
import { LogStream, isFailureLine } from "./logs.ts";
import type { LogLine } from "./logs.ts";
import type { ConsoleEntry, Driver } from "./driver.ts";
import { spawnSync } from "node:child_process";
import { firstSelectable, parseListItems } from "./scenarios/battle.ts";
import {
  LIMITS,
  SendQueue,
  assertContainerDeclared,
  assertImageUpdate,
  assertPageContainers,
  imageDataDimensions,
} from "../src/adapters/containerGuards.ts";
import type { ContainerLike, PageConfigLike } from "../src/adapters/containerGuards.ts";
import {
  AssertionError,
  FatalError,
  KNOWN_DEFECTS,
  expectConsoleClean,
  expectFrameDiff,
  expectFrameInk,
  expectGreyLevels,
  expectHostCalls,
  expectLoggedLine,
  expectNoLoggedLine,
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

  // -- 25: every image send lands on the updateImageRawData counter (D-13) ---
  await check("25 hostCalls counts every updateImageRawData through sendBmpData", async () => {
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

    // showBattleHud's sprite sends go through sendBmpData like every other
    // send (13-01 deleted its inline copies), so they land on the same counter
    // through the same pattern — the per-turn count that diagnosed research-14
    // is preserved exactly.
    const battleHud = stubDriver([
      [
        entry(1, "log", "[GlassAdapter] sendBmpData container=oppSpr size=1234B"),
        entry(2, "log", "[GlassAdapter] sendBmpData container=plySpr size=4321B"),
      ],
    ]);
    const logs2 = new LogStream(battleHud.asDriver());
    await logs2.poll();
    assert.deepEqual(logs2.hostCalls(), { updateImageRawData: 2 });

    // and the log shape it USED to emit is gone from the app, so it must no
    // longer be counted — a pattern kept for a deleted call site is how this
    // table starts lying.
    const dead = stubDriver([[entry(1, "log", "[GlassAdapter] sending oppSprite BMP: 1234 bytes")]]);
    const logs3 = new LogStream(dead.asDriver());
    await logs3.poll();
    assert.deepEqual(logs3.hostCalls(), {});
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
    // The ORACLE is the emit that interpolates the screen name. It must be
    // unique: waitScreen latches onto the first line it can parse as a screen
    // announcement, and a second one would let it succeed on the wrong screen.
    const emits = src.match(/console\.log\(`\[screen\] \$\{this\.state\.screen\} cursor=/g) ?? [];
    assert.equal(emits.length, 1, `expected exactly one [screen] oracle emit in src/, found ${emits.length}`);

    // Everything ELSE on the [screen] channel must be unparseable AS a screen
    // announcement -- otherwise "exactly one oracle" buys nothing. expectScreen
    // matches /\[screen\] NAME\b/ and battle.ts's lastScreen matches
    // /\[screen\] ([A-Z_]+)/, so a non-oracle line is safe iff it continues in
    // lower case with a literal, never an interpolation that could widen to an
    // uppercase screen name. 13.1-02's menu lines ("[screen] menu: Exit",
    // "[screen] menu itemID=2 ignored on BATTLE_HUD") are why this is written
    // down rather than left to whoever adds the next log line.
    for (const m of src.matchAll(/console\.log\([`'"]\[screen\] ([^`'"]*)/g)) {
      const rest = m[1]!;
      if (rest.startsWith("${this.state.screen} cursor=")) continue; // the oracle itself
      assert.ok(
        /^[a-z]/.test(rest),
        `[screen] line continues with "${rest.slice(0, 24)}" — only the oracle may start with an interpolation or a capital, or waitScreen cannot tell them apart`,
      );
    }

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
  // ONE line still on it and NOTHING else -- in particular not the
  // container-validation line this whole phase exists to catch, not the
  // dropped-input line that makes a no-op look like a handled input, and no
  // longer the two container-not-found lines plan 13-03 stopped occurring.
  await check("35 expectConsoleClean fails on stdout validation lines; the allow-list waives only research-13", () => {
    const logs = new LogStream(stubDriver([]).asDriver());
    expectConsoleClean(logs);

    logs.pushStdout(
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::flutter] RebuildPageContainer validation failed: image container size 576x24 exceeds maximum 288x144",
    );
    assert.throws(() => expectConsoleClean(logs), AssertionError);
    assert.throws(() => expectConsoleClean(logs), /RebuildPageContainer validation failed/);

    const waived = [
      "[2026-01-01T00:00:00Z WARN  lvgl] [Warn]\t(9.769, +0)\t lv_draw_unit_draw_letter: lv_draw_letter: glyph dsc. not found for U+2591 lv_draw_label.c:575",
    ];
    const clean = new LogStream(stubDriver([]).asDriver());
    for (const w of waived) clean.pushStdout(w);
    expectConsoleClean(clean); // research-13, Phase 14's, waived by id

    // nothing else is waived, including near-misses of the same families
    const notWaived = [
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] inject_input: no active event container",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] update_image_raw_data: container 3 not found",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] update_image_raw_data: container 8 not found, dropping 1440 bytes",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::flutter] TextContainerUpgrade failed: container 4 not found",
      // a DIFFERENT missing glyph is a different defect and must still fail
      "[2026-01-01T00:00:00Z WARN  lvgl] [Warn]\t(9.769, +0)\t lv_draw_unit_draw_letter: lv_draw_letter: glyph dsc. not found for U+2588 lv_draw_label.c:575",
      // THE REGRESSION GUARD (D-10). These two were waived until plan 13-03
      // stopped them occurring: research-10 died with the team bar, and
      // research-11 died when the container registry became per-page. Their
      // waivers are deleted, so from here on either one coming back fails the
      // run instead of being printed in a footer nobody has to act on.
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::vm] update_image_raw_data: container 8 not found",
      "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::flutter] TextContainerUpgrade failed: container 2 not found",
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

  // -- 39-41: the serialising send queue (REND-05, D-06) ---------------------
  //
  // The platform forbids concurrent sends and the app violated it from
  // AnimationEngine.ts:282 (research-14: the game hangs ~1 turn in 20). These
  // three checks are the deterministic regression guard for the fix; the
  // battle runs are only corroboration.
  //
  // Every task here settles MANUALLY. A sleep-based test of a concurrency bug
  // is a coin flip, and the bug it is guarding against is already intermittent.

  /**
   * Three tasks that record when they START and settle only when told to.
   * `settled` is what makes check 41 meaningful: "started" alone cannot
   * distinguish a serialising queue from one that never runs anything.
   */
  function deferredTasks(n: number) {
    const started: number[] = [];
    const settled: number[] = [];
    const resolve: Array<(v: string) => void> = [];
    const reject: Array<(e: unknown) => void> = [];
    const tasks = Array.from({ length: n }, (_, i) => () => {
      started.push(i);
      const p = new Promise<string>((res, rej) => {
        resolve[i] = res;
        reject[i] = rej;
      });
      void p.then(
        () => settled.push(i),
        () => settled.push(i),
      );
      return p;
    });
    return { started, settled, resolve, reject, tasks };
  }

  /**
   * Drain pending microtasks. `run()` is not async and `tail` starts as
   * `Promise.resolve()`, so even task 1 begins one microtask turn AFTER
   * submission rather than synchronously — and handing a thenable back to a
   * `.then` handler costs a few more turns on top (promise adoption). A single
   * `await Promise.resolve()` would therefore fail against a CORRECT queue.
   * Ten turns is deterministic and, unlike a sleep, cannot flake.
   */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  await check("39 SendQueue.run does not start task N+1 until task N settles", async () => {
    const q = new SendQueue();
    const d = deferredTasks(3);
    const results = d.tasks.map((t) => q.run(t));

    await flush();
    assert.deepEqual(d.started, [0], "queue started more than one task at once");

    d.resolve[0]!("a");
    await flush();
    assert.deepEqual(d.started, [0, 1], "task 2 did not start, or task 3 started early");

    d.resolve[1]!("b");
    await flush();
    assert.deepEqual(d.started, [0, 1, 2]);

    d.resolve[2]!("c");
    // 39b: submission order preserved, and each caller gets its OWN value.
    assert.deepEqual(await Promise.all(results), ["a", "b", "c"]);
    assert.deepEqual(d.settled, [0, 1, 2], "tasks settled out of submission order");
  });

  await check("40 a rejected send does not poison the queue", async () => {
    const q = new SendQueue();
    const boom = new Error("send failed");
    const bad = q.run(() => Promise.reject(boom));
    const good = q.run(async () => "still running");

    // the caller of the FAILED send still sees the failure...
    await assert.rejects(bad, (e: unknown) => e === boom);
    // ...and the send queued behind it runs anyway. A plain
    // `tail = tail.then(fn)` wedges here, which is the whole point.
    assert.equal(await good, "still running");
  });

  await check("41 the concurrency detector used by check 39 can still detect concurrency", async () => {
    // The SAME tasks, run the way AnimationEngine.ts:282 runs them. If this
    // does not report three concurrent starts, checks 39/40 prove nothing —
    // they would pass just as happily against a queue that never runs anything.
    const d = deferredTasks(3);
    const all = Promise.all(d.tasks.map((t) => t()));

    await flush();
    assert.deepEqual(d.started, [0, 1, 2], "detector is dead: bare Promise.all did not run concurrently");
    assert.deepEqual(d.settled, [], "a task settled on its own; the checks are not measuring what they claim");

    d.resolve[0]!("a");
    d.resolve[1]!("b");
    d.resolve[2]!("c");
    assert.deepEqual(await all, ["a", "b", "c"]);
  });

  // -------------------------------------------------------------------------
  // 42-46: the container geometry / count guard (REND-03, plan 13-02)
  // -------------------------------------------------------------------------
  //
  // The 576x24 team bar of defect #2 passed every validator the project had,
  // including the SDK's own: validateEvenHubPageContainer() returns
  // {valid:true} for it, and for a 9999x9999 image, and for
  // containerTotalNum:13 (verified live against 0.0.15). It only covers
  // z-order, menus and text brightness. So geometry and counts are ours, and
  // these checks are the only thing standing between a future layout edit and
  // another whole-page rebuild failure.
  //
  // Every refusal below asserts on the MESSAGE, not just that it threw. A
  // guard that refuses everything with "error" passes a bare assert.throws and
  // helps nobody at 3am — and check 45 is the other half of that: it proves
  // the three configs the app really sends are still accepted.

  /** Refused, carrying the ROADMAP literal plus every needle (id, value, limit). */
  function refuses(config: PageConfigLike, needles: string[], what: string): void {
    let msg: string | null = null;
    try {
      assertPageContainers(config);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    assert.ok(msg !== null, `${what}: expected a refusal, the guard accepted it`);
    assert.match(
      msg,
      /adapter: rejected container/,
      `${what}: refusal must contain the literal the ROADMAP harness assertion matches; got: ${msg}`,
    );
    for (const n of needles) {
      assert.ok(msg.includes(n), `${what}: refusal should name ${JSON.stringify(n)}; got: ${msg}`);
    }
  }

  function accepts(config: PageConfigLike, what: string): void {
    try {
      assertPageContainers(config);
    } catch (e) {
      assert.fail(`${what}: guard refused a legal page — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** image container with legal defaults, so each case varies exactly one thing */
  const img = (o: Partial<ContainerLike> = {}): ContainerLike => ({
    containerID: CONTAINER_IDS.oppSprite,
    containerName: CONTAINER_NAMES.oppSprite,
    width: 100,
    height: 100,
    ...o,
  });
  /** the capture container every legal page needs exactly one of */
  const capture = (o: Partial<ContainerLike> = {}): ContainerLike => ({
    containerID: CONTAINER_IDS.content,
    containerName: CONTAINER_NAMES.content,
    width: GLASS_LAYOUT.width,
    height: GLASS_LAYOUT.height,
    isEventCapture: 1,
    ...o,
  });

  await check("42 assertPageContainers refuses the container that made the game unplayable", () => {
    // Defect #2 verbatim: OVERLAY_LAYOUT.TEAM_BAR_W was 576 until commit
    // 1684d66, and one oversized container fails the ENTIRE rebuild, so the
    // action list never appeared and the game could not be played.
    refuses(
      {
        containerTotalNum: 2,
        imageObject: [img({ containerID: CONTAINER_IDS.teamBar, containerName: CONTAINER_NAMES.teamBar, width: 576, height: 24 })],
        textObject: [capture()],
      },
      ["id=8", "teamBar", "576", "288"],
      "the 576x24 team bar",
    );

    // the other three ways out of bounds, each one dimension off
    refuses({ imageObject: [img({ height: 16 })], textObject: [capture()] }, ["16", "20"], "height under the floor");
    refuses({ imageObject: [img({ height: 145 })], textObject: [capture()] }, ["145", "144"], "height over the ceiling");
    refuses({ imageObject: [img({ width: 19 })], textObject: [capture()] }, ["19", "20"], "width under the floor");
    refuses({ imageObject: [img({ width: 289 })], textObject: [capture()] }, ["289", "288"], "width over the ceiling");

    // an undefined dimension is a refusal too: the SDK types make width and
    // height optional, and the firmware tiles whatever it gets.
    refuses({ imageObject: [{ containerID: 4, containerName: "oppSpr", height: 100 }], textObject: [capture()] }, ["id=4", "width"], "missing width");
    refuses({ imageObject: [{ containerID: 4, containerName: "oppSpr", width: 100 }], textObject: [capture()] }, ["id=4", "height"], "missing height");

    // BOTH boundaries accepted. An off-by-one that refuses a legal container
    // is exactly as bad as one that accepts an illegal one — it bricks a page
    // that works today.
    accepts({ containerTotalNum: 2, imageObject: [img({ width: 20, height: 20 })], textObject: [capture()] }, "minimum legal image 20x20");
    accepts({ containerTotalNum: 2, imageObject: [img({ width: 288, height: 144 })], textObject: [capture()] }, "maximum legal image 288x144");
  });

  await check("43 assertPageContainers refuses count violations", () => {
    const five = Array.from({ length: 5 }, (_, i) => img({ containerID: i + 1 }));
    refuses({ imageObject: five, textObject: [capture()] }, ["5", "4"], "5 image containers");

    const nine = Array.from({ length: 9 }, (_, i) => capture({ containerID: i + 1, isEventCapture: i === 0 ? 1 : 0 }));
    refuses({ textObject: nine }, ["9", "8"], "9 non-image containers");

    // 13 total. NOTE: MAX_IMAGE + MAX_OTHER === MAX_TOTAL, so the total rule
    // can only ever be reached through one of the two rules ahead of it —
    // it is a backstop, and this asserts it stays one rather than pretending
    // the 13-total message is reachable.
    assert.equal(LIMITS.MAX_IMAGE + LIMITS.MAX_OTHER, LIMITS.MAX_TOTAL, "total rule became independently reachable; give it its own case");
    refuses(
      { imageObject: five, textObject: Array.from({ length: 8 }, (_, i) => capture({ containerID: i + 1, isEventCapture: i === 0 ? 1 : 0 })) },
      ["5", "4"],
      "13 containers total",
    );

    // the config-lies-about-itself class, caught directly and cheaply
    refuses(
      { containerTotalNum: 4, imageObject: [img()], textObject: [capture()] },
      ["4", "2"],
      "containerTotalNum disagreeing with the actual count",
    );
  });

  await check("44 assertPageContainers refuses the wrong number of event captures", () => {
    refuses(
      { containerTotalNum: 2, imageObject: [img()], textObject: [capture({ isEventCapture: 0 })] },
      ["0", "isEventCapture"],
      "no event capture anywhere",
    );
    refuses(
      { containerTotalNum: 2, textObject: [capture(), capture({ containerID: CONTAINER_IDS.status, containerName: CONTAINER_NAMES.status })] },
      ["2", "isEventCapture"],
      "two event captures",
    );
    accepts({ containerTotalNum: 2, imageObject: [img()], textObject: [capture()] }, "exactly one event capture");
  });

  await check("45 the three configs the app really sends are accepted unchanged", () => {
    // Built from the same constants glassAdapter.ts builds them from, so a
    // layout edit that breaks the guard breaks this check instead of the app.
    // 42-44 alone would pass against a guard that refuses everything; this is
    // the half that stops one shipping.

    // bootstrapStartup: one full-screen text container. 576x288 is far outside
    // the image limits and must stay legal — the 20-288 x 20-144 cap is an
    // IMAGE container rule only.
    accepts(
      {
        containerTotalNum: 1,
        textObject: [{ containerID: CONTAINER_IDS.content, containerName: CONTAINER_NAMES.content, width: DISPLAY.WIDTH, height: DISPLAY.HEIGHT, isEventCapture: 1 }],
      },
      "bootstrapStartup",
    );

    // showOverlayHud: 3 image + 1 list, the real OVERLAY_LAYOUT numbers.
    accepts(
      {
        containerTotalNum: 4,
        imageObject: [
          { containerID: CONTAINER_IDS.teamBar, containerName: CONTAINER_NAMES.teamBar, width: OVERLAY_LAYOUT.TEAM_BAR_W, height: OVERLAY_LAYOUT.TEAM_BAR_H },
          { containerID: CONTAINER_IDS.oppSprite, containerName: CONTAINER_NAMES.oppSprite, width: OVERLAY_LAYOUT.COMPOSITE_W, height: OVERLAY_LAYOUT.COMPOSITE_H },
          { containerID: CONTAINER_IDS.playerSprite, containerName: CONTAINER_NAMES.playerSprite, width: OVERLAY_LAYOUT.COMPOSITE_W, height: OVERLAY_LAYOUT.COMPOSITE_H },
        ],
        listObject: [
          { containerID: CONTAINER_IDS.content, containerName: CONTAINER_NAMES.content, width: OVERLAY_LAYOUT.LIST_W, height: OVERLAY_LAYOUT.LIST_H, isEventCapture: 1 },
        ],
      },
      "showOverlayHud",
    );

    // showBattleHud: 2 sprite images + content + status.
    accepts(
      {
        containerTotalNum: 4,
        imageObject: [
          { containerID: CONTAINER_IDS.oppSprite, containerName: CONTAINER_NAMES.oppSprite, width: SPRITE_CONFIG.SIZE, height: SPRITE_CONFIG.SIZE },
          { containerID: CONTAINER_IDS.playerSprite, containerName: CONTAINER_NAMES.playerSprite, width: SPRITE_CONFIG.SIZE, height: SPRITE_CONFIG.SIZE },
        ],
        textObject: [
          { containerID: CONTAINER_IDS.content, containerName: CONTAINER_NAMES.content, width: GLASS_LAYOUT.width, height: GLASS_LAYOUT.height, isEventCapture: 1 },
          { containerID: CONTAINER_IDS.status, containerName: CONTAINER_NAMES.status, width: GLASS_LAYOUT.width, height: GLASS_LAYOUT.statusHeight, isEventCapture: 0 },
        ],
      },
      "showBattleHud",
    );

    // showText's split status bar, the only page with three text containers.
    accepts(
      {
        containerTotalNum: 3,
        textObject: [
          { containerID: CONTAINER_IDS.content, containerName: CONTAINER_NAMES.content, width: GLASS_LAYOUT.width, height: GLASS_LAYOUT.height, isEventCapture: 0 },
          { containerID: CONTAINER_IDS.status, containerName: CONTAINER_NAMES.status, width: 400, height: GLASS_LAYOUT.statusHeight, isEventCapture: 0 },
          { containerID: CONTAINER_IDS.statusRight, containerName: CONTAINER_NAMES.statusRight, width: 160, height: GLASS_LAYOUT.statusHeight, isEventCapture: 1 },
        ],
      },
      "showText",
    );
  });

  await check("46 assertPageContainers refuses an over-long containerName", () => {
    // The firmware truncates at 16 chars silently, producing a container the
    // app can then never address by name — every updateImageRawData and
    // textContainerUpgrade against it fails with "container not found".
    refuses(
      { containerTotalNum: 1, textObject: [capture({ containerName: "seventeenCharsXX" + "Y" })] },
      ["17", "16"],
      "a 17-character containerName",
    );
    accepts({ containerTotalNum: 1, textObject: [capture({ containerName: "sixteenCharsXXXX" })] }, "a 16-character containerName");
  });

  // -------------------------------------------------------------------------
  // 47-52: the image-data dimension guard (REND-04 / REND-06, plan 13-03)
  // -------------------------------------------------------------------------
  //
  // The firmware TILES image data smaller than its container instead of
  // erroring: the screen renders something plausible and wrong and NO log
  // stream mentions it. That is strictly worse than the 576x24 team bar of
  // defect #2, which at least failed loudly. The adapter knows every
  // container's declared size (plan 13-02's registry), so it can read the
  // dimensions out of the payload's own header and refuse a mismatch before
  // the ~104 ms host call goes out.
  //
  // Numbered from 47, not 46 as the plan said: 46 was taken by plan 13-02's
  // containerName check, which landed after 13-03 was written.

  /**
   * A hand-built 62-byte BITMAPINFOHEADER.
   *
   * NOT `encodeBmp` from src/sprites/SpriteBmpEncoder.ts, which cannot be
   * imported here at all: its line 15 is
   * `import { SPRITE_CONFIG } from '../config/constants.js'`, and Node 22's
   * strip-only mode does NOT remap `.js` -> `.ts`, so `node harness/selfCheck.ts`
   * would die at import with ERR_MODULE_NOT_FOUND before running a single
   * check. That is also the empirical proof that containerGuards.ts's
   * zero-import rule is load-bearing rather than defensive.
   *
   * The reader only ever looks at offsets 0, 18 and 22, so a header-only
   * fixture pins exactly the bytes it depends on — and fails if it ever starts
   * guessing dimensions from file length. Offsets are the app's real writer's:
   * SpriteBmpEncoder.ts:77-78, `setInt32(18, width, true)` / `setInt32(22, height, true)`.
   */
  function bmpHeader(width: number, height: number): Uint8Array {
    const data = new Uint8Array(62);
    const view = new DataView(data.buffer);
    data[0] = 0x42; // "B"
    data[1] = 0x4d; // "M"
    view.setUint32(2, 62, true); // fileSize
    view.setUint32(10, 62, true); // pixel data offset
    view.setUint32(14, 40, true); // BITMAPINFOHEADER size
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    return data;
  }

  /** 8-byte PNG signature + IHDR length/type + big-endian width/height. */
  function pngHeader(width: number, height: number): Uint8Array {
    const data = new Uint8Array(33);
    const view = new DataView(data.buffer);
    data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    view.setUint32(8, 13, false); // IHDR chunk length
    data.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    return data;
  }

  function decl(kind: string, name: string, width: number, height: number): {
    kind: string; name: string; width: number; height: number;
  } {
    return { kind, name, width, height };
  }

  /** Refused, carrying `adapter: rejected container` plus every needle. */
  function refusesUpdate(fn: () => void, needles: string[], what: string): void {
    let msg: string | null = null;
    try {
      fn();
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    assert.ok(msg !== null, `${what}: expected a refusal, the guard accepted it`);
    assert.match(
      msg,
      /adapter: rejected container/,
      `${what}: refusal must carry the family literal; got: ${msg}`,
    );
    for (const n of needles) {
      assert.ok(msg.includes(n), `${what}: refusal should name ${JSON.stringify(n)}; got: ${msg}`);
    }
  }

  await check("47 imageDataDimensions reads a BITMAPINFOHEADER", () => {
    assert.deepEqual(
      imageDataDimensions(bmpHeader(OVERLAY_LAYOUT.TEAM_BAR_W, OVERLAY_LAYOUT.TEAM_BAR_H)),
      { width: 288, height: 24 },
    );
    assert.deepEqual(
      imageDataDimensions(bmpHeader(OVERLAY_LAYOUT.COMPOSITE_W, OVERLAY_LAYOUT.COMPOSITE_H)),
      { width: 144, height: 132 },
    );
    assert.deepEqual(
      imageDataDimensions(bmpHeader(SPRITE_CONFIG.SIZE, SPRITE_CONFIG.SIZE)),
      { width: 96, height: 96 },
    );

    // A negative height is a legal top-down BMP: it describes row ORDER, not
    // size. Returning -132 would make every comparison below fail open.
    assert.deepEqual(imageDataDimensions(bmpHeader(144, -132)), { width: 144, height: 132 });

    // byteOffset. A Uint8Array view into a larger buffer is exactly where a
    // DataView-based reader silently reads the wrong bytes.
    const padded = new Uint8Array(80);
    padded.set(bmpHeader(96, 96), 8);
    assert.deepEqual(imageDataDimensions(padded.subarray(8)), { width: 96, height: 96 });
  });

  await check("48 imageDataDimensions refuses anything it does not recognise", () => {
    refusesUpdate(() => imageDataDimensions(new Uint8Array(0)), ["0 bytes"], "an empty payload");
    refusesUpdate(
      () => imageDataDimensions(new Uint8Array([0x00, 0x01, 0x02])),
      ["00 01 02", "3 bytes"],
      "a 3-byte payload",
    );
    refusesUpdate(
      () => imageDataDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
      ["ff d8 ff e0"],
      "a JPEG",
    );
    // The real trap: the signature is right and the header is truncated, so a
    // reader that checks only "BM" reads two ints past the end of the buffer.
    refusesUpdate(
      () => imageDataDimensions(new Uint8Array([0x42, 0x4d, 0x00, 0x00])),
      ["42 4d"],
      "a truncated BMP that still starts BM",
    );
  });

  await check("49 imageDataDimensions reads a PNG IHDR", () => {
    // Phase 15 ships a greyscale PNG pipeline; REND-04's guard must not be the
    // thing that blocks it.
    assert.deepEqual(imageDataDimensions(pngHeader(96, 96)), { width: 96, height: 96 });
    assert.deepEqual(imageDataDimensions(pngHeader(288, 144)), { width: 288, height: 144 });
    // Big-endian, not little: 288 read the wrong way round is 0x20010000.
    assert.notDeepEqual(imageDataDimensions(pngHeader(288, 144)), { width: 537067520, height: 0 });
  });

  await check("50 assertImageUpdate refuses the tiling case", () => {
    // The exact shape: showOverlayHud declared 144x132, an animation frame is
    // 96x96. The hardware repeats the 96x96 image across the 144x132 slot
    // rather than erroring.
    refusesUpdate(
      () => assertImageUpdate(
        CONTAINER_IDS.oppSprite,
        decl("image", CONTAINER_NAMES.oppSprite, OVERLAY_LAYOUT.COMPOSITE_W, OVERLAY_LAYOUT.COMPOSITE_H),
        bmpHeader(SPRITE_CONFIG.SIZE, SPRITE_CONFIG.SIZE),
      ),
      ["4", "144x132", "96x96"],
      "a 96x96 frame into a 144x132 container",
    );

    // The reverse is equally wrong and must not be waved through as "it fits".
    refusesUpdate(
      () => assertImageUpdate(
        CONTAINER_IDS.playerSprite,
        decl("image", CONTAINER_NAMES.playerSprite, SPRITE_CONFIG.SIZE, SPRITE_CONFIG.SIZE),
        bmpHeader(OVERLAY_LAYOUT.COMPOSITE_W, OVERLAY_LAYOUT.COMPOSITE_H),
      ),
      ["5", "96x96", "144x132"],
      "a 144x132 composite into a 96x96 container",
    );

    // One dimension off by one is the same defect, just harder to see.
    refusesUpdate(
      () => assertImageUpdate(4, decl("image", "oppSpr", 144, 132), bmpHeader(144, 131)),
      ["144x132", "144x131"],
      "a one-pixel-short payload",
    );
  });

  await check("51 assertImageUpdate accepts the app's real sends", () => {
    // 50 and 52 alone would pass against a guard that refuses everything; this
    // is the half that stops one shipping. Every payload here is a size the
    // app really sends today.
    const accepts = (id: number, d: ReturnType<typeof decl>, data: Uint8Array, what: string): void => {
      try {
        assertImageUpdate(id, d, data);
      } catch (e) {
        assert.fail(`${what}: guard refused a correct send — ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    accepts(
      CONTAINER_IDS.teamBar,
      decl("image", CONTAINER_NAMES.teamBar, OVERLAY_LAYOUT.TEAM_BAR_W, OVERLAY_LAYOUT.TEAM_BAR_H),
      bmpHeader(OVERLAY_LAYOUT.TEAM_BAR_W, OVERLAY_LAYOUT.TEAM_BAR_H),
      "emptyTeamBarBmp()'s 288x24 into the team-bar container",
    );
    accepts(
      CONTAINER_IDS.oppSprite,
      decl("image", CONTAINER_NAMES.oppSprite, OVERLAY_LAYOUT.COMPOSITE_W, OVERLAY_LAYOUT.COMPOSITE_H),
      bmpHeader(OVERLAY_LAYOUT.COMPOSITE_W, OVERLAY_LAYOUT.COMPOSITE_H),
      "showOverlayHud's 144x132 composite",
    );
    accepts(
      CONTAINER_IDS.playerSprite,
      decl("image", CONTAINER_NAMES.playerSprite, SPRITE_CONFIG.SIZE, SPRITE_CONFIG.SIZE),
      bmpHeader(SPRITE_CONFIG.SIZE, SPRITE_CONFIG.SIZE),
      "showBattleHud's 96x96 sprite and every animation frame",
    );
    accepts(
      CONTAINER_IDS.playerSprite,
      decl("image", CONTAINER_NAMES.playerSprite, SPRITE_CONFIG.SIZE, SPRITE_CONFIG.SIZE),
      pngHeader(SPRITE_CONFIG.SIZE, SPRITE_CONFIG.SIZE),
      "Phase 15's PNG of the same size",
    );
  });

  await check("52 assertImageUpdate refuses an undeclared container", () => {
    // research-10's failure mode, moved from a simulator warning nobody reads
    // to an exception at the call site (D-08).
    refusesUpdate(
      () => assertImageUpdate(CONTAINER_IDS.teamBar, undefined, bmpHeader(288, 24)),
      ["8", "declared"],
      "a send to a container no page ever declared",
    );
    refusesUpdate(
      () => assertContainerDeclared(CONTAINER_IDS.status, undefined),
      ["2", "declared"],
      "research-11's textContainerUpgrade against an undeclared container 2",
    );

    // Declared, but as the wrong KIND. updateImageRawData against a text
    // container fails on the hardware the same way a missing one does.
    refusesUpdate(
      () => assertImageUpdate(
        CONTAINER_IDS.status,
        decl("text", CONTAINER_NAMES.status, 576, 32),
        bmpHeader(576, 32),
      ),
      ["2", "text", "image"],
      "an image send to a text container",
    );

    // A declared container passes the existence check and returns nothing.
    assert.equal(assertContainerDeclared(CONTAINER_IDS.content, decl("text", CONTAINER_NAMES.content, 576, 288)), undefined);
  });

  await check("53 the root context menu is SDK-valid and keeps Exit last", () => {
    // MAIN_MENU_CONTEXT_MENU is the ONE place the root menu is spelled out and
    // Phase 17 edits it to add inspect entries. Two different failures are
    // covered here because neither implies the other:
    //
    //  * the SDK validator refuses a malformed menu, and a refused menu builds
    //    NOTHING — no list, no status, no page (D-07). Caught at boot today,
    //    but only if someone boots.
    //  * the validator has no opinion whatsoever about ORDER, and order is the
    //    safety property. Exit LAST is what stops a pre-selected highlight
    //    landing on the one action that wedges every updateImageRawData until
    //    restart (D-02). Nothing else in the codebase checks it.
    const wrap = (items: readonly { id: number; name: string }[]) => ({
      // Exactly how renderContainers wraps it, so this validates the real
      // payload shape and not a convenient plain-object stand-in.
      containerTotalNum: 1,
      textObject: [{ xPosition: 0, yPosition: 0, width: 576, height: 288, containerID: 1, containerName: "content", content: "x" }],
      menuObject: new MenuContainerProperty({
        menuItems: items.map((m) => new MenuItemProperty({ itemID: m.id, itemName: m.name })),
      }),
    });

    const r = validateEvenHubPageContainer(wrap(MAIN_MENU_CONTEXT_MENU));
    assert.equal(r.valid, true, `the real root menu is rejected by the SDK: ${JSON.stringify(r)}`);

    const last = MAIN_MENU_CONTEXT_MENU[MAIN_MENU_CONTEXT_MENU.length - 1];
    assert.equal(last?.id, MENU_ITEM_IDS.exit, "Exit must be the LAST menu item (D-02) — the default highlight lands on the first");
    assert.ok(MAIN_MENU_CONTEXT_MENU.length <= 10, "the firmware renders at most 10 menu items");
    for (const m of MAIN_MENU_CONTEXT_MENU) {
      // No `m.id !== 0` assert: `as const` narrows the ids to a literal union
      // and tsc calls the comparison unintentional (TS2367). The rule is still
      // enforced — by the SDK, on the real menu, three lines up, and by the
      // INVALID_MENU_ITEM_ID case below.
      assert.ok(utf8ByteLength(m.name) <= 32, `"${m.name}" exceeds 32 UTF-8 BYTES — bytes, not characters`);
    }
    assert.equal(new Set(MAIN_MENU_CONTEXT_MENU.map((m) => m.id)).size, MAIN_MENU_CONTEXT_MENU.length, "itemIDs must be unique");

    // The other half: a validator that said {valid:true} to everything would
    // pass all of the above. Each of these is a real 0.0.15 rejection code.
    const refuses = (items: { id: number; name: string }[], code: string, what: string): void => {
      const got = validateEvenHubPageContainer(wrap(items));
      assert.equal(got.valid, false, `${what}: the SDK accepted a menu it must refuse`);
      assert.equal((got as { code: string }).code, code, what);
    };
    refuses([{ id: 0, name: "Exit" }], "INVALID_MENU_ITEM_ID", "itemID 0");
    refuses([{ id: 1, name: "A" }, { id: 1, name: "B" }], "DUPLICATE_MENU_ITEM_ID", "a reused itemID");
    refuses(Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `m${i}` })), "TOO_MANY_MENU_ITEMS", "11 items");
    refuses([{ id: 1, name: "x".repeat(33) }], "INVALID_MENU_ITEM_NAME", "a 33-character name");
    // BYTES, not characters: 9 emoji is 9 characters and 36 bytes.
    refuses([{ id: 1, name: "\u{1F3AE}".repeat(9) }], "INVALID_MENU_ITEM_NAME", "a 9-character, 36-BYTE name");
  });


  await check("54 the menu item ids themselves are pinned, not just their order", () => {
    // Check 53 pins the ORDER. This pins the NUMBERS, and they are a different
    // contract: every assertion in plans 03/04 and every saved run log says
    // `itemID=2`, not `itemID=whatever battleSpeed is today`. A future reorder
    // must move the ARRAY POSITION (which 53 re-checks) and must NOT renumber
    // an id out from under a log line that has already been interpreted.
    assert.equal(MENU_ITEM_IDS.exit, 1, "Exit is itemID 1 in every recorded run log");
    assert.equal(MENU_ITEM_IDS.battleSpeed, 2, "Battle Speed is itemID 2 in every recorded run log");
    assert.equal(MENU_ITEM_IDS.about, 3, "About is itemID 3 in every recorded run log");
    // ...and the array is built from those ids rather than restating them.
    assert.deepEqual(
      MAIN_MENU_CONTEXT_MENU.map((m) => m.id),
      [MENU_ITEM_IDS.battleSpeed, MENU_ITEM_IDS.about, MENU_ITEM_IDS.exit],
    );
  });

  await check("55 containerTotalNum counts containers, NOT menu items", () => {
    // assertPageContainers never reads menuObject, and that is the property
    // being pinned: a menu is not a container. Counting the three menu items
    // into the total makes the guard refuse every correct root page -- with a
    // message about a config lying about itself, which points at the wrong
    // thing entirely. This is the exact page the app builds for MAIN_MENU.
    const root: PageConfigLike = {
      containerTotalNum: 2,
      listObject: [
        { containerID: CONTAINER_IDS.content, containerName: CONTAINER_NAMES.content, width: 560, height: 248, isEventCapture: 1 },
      ],
      textObject: [
        { containerID: CONTAINER_IDS.status, containerName: CONTAINER_NAMES.status, width: 560, height: 28, isEventCapture: 0 },
      ],
    };
    // Not a fresh object literal: the excess-property check would reject the
    // extra key, and menuObject travelling alongside the containers is exactly
    // what is being modelled.
    const withMenu = {
      ...root,
      menuObject: { menuItems: MAIN_MENU_CONTEXT_MENU.map((m) => ({ itemID: m.id, itemName: m.name })) },
    };
    assert.equal(assertPageContainers(withMenu), undefined, "the real root page config was refused");

    // 2 containers + 3 menu items = 5, the mistake this check exists to stop.
    const miscounted = { ...withMenu, containerTotalNum: 2 + MAIN_MENU_CONTEXT_MENU.length };
    assert.throws(
      () => assertPageContainers(miscounted),
      /containerTotalNum 5 but carries 2 containers/,
      "the guard accepted a page that counted its menu items as containers",
    );
  });

  await check("56 expectNoLoggedLine / expectLoggedLine(since) / FatalError", async () => {
    const logs = new LogStream(
      stubDriver([[
        entry(1, "log", "[screen] MAIN_MENU cursor=0"),
        entry(2, "log", "[GlassAdapter] menu: itemID=2"),
        entry(3, "log", "[screen] menu: Battle Speed"),
      ]]).asDriver(),
    );
    await logs.poll();

    // absence passes, presence throws AND names the offending line
    expectNoLoggedLine(logs, /menu: itemID=9/, "nothing selected item 9");
    assert.throws(() => expectNoLoggedLine(logs, /menu: itemID=2/, "a menu item was selected"), AssertionError);
    assert.throws(
      () => expectNoLoggedLine(logs, /menu: itemID=2/, "a menu item was selected"),
      /a menu item was selected: .*\[console\/log\] \[GlassAdapter\] menu: itemID=2/,
    );

    // THE VACUOUSNESS THE DOCSTRING WARNS ABOUT, MADE RUNNABLE. reset() is what
    // ctx.step() does at the start of every step without keepLogs: the same
    // assertion over the same history now passes while proving nothing. This is
    // why the exit checks live INSIDE the step whose inputs they judge.
    await logs.reset();
    expectNoLoggedLine(logs, /menu: itemID=2/, "vacuous after reset()");

    // the `since` watermark: a step that repeats an action must not match the
    // previous iteration's line (the regression step in boot.ts selects the
    // same menu item three times inside ONE step).
    const repeated = new LogStream(
      stubDriver([[entry(1, "log", "[screen] menu: Battle Speed"), entry(2, "log", "[screen] MAIN_MENU cursor=0")]]).asDriver(),
    );
    await repeated.poll();
    const seqOfSecondLine = repeated.all()[1]!.seq;
    assert.equal(expectLoggedLine(repeated, /menu: Battle Speed/).message, "[screen] menu: Battle Speed");
    assert.throws(() => expectLoggedLine(repeated, /menu: Battle Speed/, seqOfSecondLine), AssertionError);
    assert.throws(() => expectLoggedLine(repeated, /menu: Battle Speed/, seqOfSecondLine), /at or after seq/);

    // FatalError is a distinct type, because run.ts routes on `instanceof`.
    const f = new FatalError("boom");
    assert.equal(f.name, "FatalError");
    assert.ok(f instanceof Error);
    assert.ok(!(f instanceof AssertionError));
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
