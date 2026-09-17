/**
 * The Phase 12 assertion vocabulary. These names are a CONTRACT — the ROADMAP
 * cites every one of them by name in later phases, so do not rename casually:
 *
 *   expectConsoleClean(logs)                 HARN-05. Used by 13,14,15,16,17,18,19.
 *   expectFrameInk(f, r, min, max)           HARN-03 blank/saturated detector. 15,19.
 *   expectGreyLevels(f, r, n)                Phase 15 (4-bit sprite pipeline).
 *   expectRegionPersists(frames, r, min?)    Phase 14 (nameplates across animation).
 *   expectLoggedLine(logs, pattern)          Phases 13,14,16,17.
 *   expectHostCalls(logs, method, max)       Phase 19 / PERF-04.
 *   expectScreen(logs, name)                 screen oracle, this phase onward.
 *   expectFrameDiff(...)                     defined, deliberately NOT implemented (D-10).
 *
 * `runBattleScript()` is on the same ROADMAP table but is plan 12-04, not this file.
 *
 * Every assertion throws AssertionError with a message naming BOTH the subject
 * (region / pattern / method) and the observed value, because that message is
 * the entire failure report a harness run prints.
 */
import { greyLevels, inkRatio } from "./frame.ts";
import type { Frame, Region } from "./frame.ts";
import type { LogLine, LogStream } from "./logs.ts";
import type { ScreenName } from "../src/screens/ScreenState.ts";

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

// ---------------------------------------------------------------------------
// framebuffer assertions (HARN-03, D-06, D-07)
// ---------------------------------------------------------------------------

/**
 * The blank/saturated detector. A screen that renders nothing logs no error at
 * all (D-06), so this is the assertion that catches it: `min` fails a blank
 * region, `max` fails an all-lit one.
 */
export function expectFrameInk(f: Frame, r: Region, min: number, max: number): void {
  const got = inkRatio(f, r);
  if (!(got >= min && got <= max)) {
    throw new AssertionError(`${r.name}: ink ${got.toFixed(3)} outside [${min}, ${max}]`);
  }
}

/** Phase 15 asserts sprites actually use multiple grey levels (see deferred D3). */
export function expectGreyLevels(f: Frame, r: Region, n: number): void {
  const got = greyLevels(f, r);
  if (got < n) {
    throw new AssertionError(`${r.name}: ${got} distinct grey levels, expected at least ${n}`);
  }
}

/**
 * Phase 14: a nameplate that blinks out for one animation frame is a defect a
 * single capture cannot see. Names the FIRST offending frame index.
 */
export function expectRegionPersists(frames: Frame[], r: Region, min = 0.01): void {
  // An empty sequence would pass vacuously, which is the one way this assertion
  // could silently prove nothing.
  if (frames.length === 0) {
    throw new AssertionError(`${r.name}: expectRegionPersists got zero frames, so it proved nothing`);
  }
  for (let i = 0; i < frames.length; i++) {
    const got = inkRatio(frames[i]!, r);
    if (got < min) {
      throw new AssertionError(
        `${r.name}: went blank at frame ${i} of ${frames.length} (ink ${got.toFixed(3)} < ${min})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// known app defects — the ONLY lines expectConsoleClean is allowed to waive
// ---------------------------------------------------------------------------

/**
 * D-05 says warnings are not tolerated, and these two ARE real defects, not
 * noise. They are waived here only so that `npm run harness` can exit 0 on the
 * app as it stands today; every waiver names one exact line, is anchored at
 * both ends, and carries the phase that must delete it.
 *
 * Never add a blanket pattern here. A regex that waives a family of lines
 * waives the next defect in that family too, which is precisely how HARN-02
 * gets switched off one entry at a time.
 *
 * Waived lines are NOT hidden: run.ts prints every one it saw at the end of the
 * run, so a waiver that stops being needed is visible immediately.
 */
export interface KnownDefect {
  /** row in .planning/G2-PLATFORM-RESEARCH.md */
  id: string;
  match: RegExp;
  /** the phase that must fix the defect and then delete this entry */
  owner: string;
  why: string;
}

export const KNOWN_DEFECTS: readonly KnownDefect[] = [
  {
    id: "research-10",
    match: /\bupdate_image_raw_data: container 8 not found$/,
    owner: "Phase 13/14 (REND-06)",
    why:
      "the team bar BMP is pushed before its container exists, on every boot. Fixing it means changing render order, which this phase is forbidden to do (it observes only).",
  },
  {
    id: "research-11",
    match: /\bTextContainerUpgrade failed: container 2 not found$/,
    owner: "Phase 13/14",
    why:
      "showOverlayHud's 'blank out container 2' workaround fires against a container that is not there, on every boot. Same reason: the fix is a rendering change.",
  },
];

/** the waiver that applies to `l`, if any. stdout stream only. */
export function knownDefect(l: LogLine): KnownDefect | undefined {
  if (l.source !== "stdout") return undefined;
  return KNOWN_DEFECTS.find((d) => d.match.test(l.message));
}

// ---------------------------------------------------------------------------
// log assertions (HARN-05, HARN-02, D-05, D-13)
// ---------------------------------------------------------------------------

/**
 * HARN-05 plus HARN-02: fails on any console error / uncaught / unhandled
 * rejection / failed fetch AND on any simulator stdout validation line, which
 * is the stream where the container failure that made this game unplayable
 * appears and where /api/console shows nothing at all.
 */
export function expectConsoleClean(logs: LogStream): void {
  const bad = logs.failures().filter((l) => knownDefect(l) === undefined);
  if (bad.length === 0) return;
  const shown = bad.slice(0, 20).map((l) => `  [${l.source}/${l.level}] ${l.message}`);
  const more = bad.length > shown.length ? `\n  ...and ${bad.length - shown.length} more` : "";
  throw new AssertionError(`${bad.length} failure line(s):\n${shown.join("\n")}${more}`);
}

/** Returns the matching line so callers can assert on its contents. */
export function expectLoggedLine(logs: LogStream, pattern: RegExp): LogLine {
  const hit = logs.all().find((l) => pattern.test(l.message));
  if (hit) return hit;
  const tail = logs.all().slice(-10).map((l) => `  [${l.source}/${l.level}] ${l.message}`);
  throw new AssertionError(
    `no log line matched ${pattern}; last ${tail.length} of ${logs.all().length} line(s):\n${
      tail.join("\n") || "  (none)"
    }`,
  );
}

/**
 * D-13 only requires the number be RECORDED this phase; Phase 19 / PERF-04
 * turns it into an enforced ceiling. See the KNOWN INACCURACY notes on
 * HOST_CALL_PATTERNS in logs.ts before trusting a count of zero.
 */
export function expectHostCalls(logs: LogStream, method: string, max: number): void {
  const got = logs.hostCalls()[method] ?? 0;
  if (got > max) {
    throw new AssertionError(`${method}: ${got} host call(s), ceiling is ${max}`);
  }
}

/** The screen oracle: ScreenController.render() logs `[screen] <NAME> cursor=<n>`. */
export function expectScreen(logs: LogStream, name: ScreenName): void {
  expectLoggedLine(logs, new RegExp(`\\[screen\\] ${name}\\b`));
}

// ---------------------------------------------------------------------------
// D-10 — defined, deliberately not implemented
// ---------------------------------------------------------------------------

/**
 * Exported as a throwing stub on purpose. Phases 13/14/15/17/18 cite this name;
 * omitting it would greet them with `SyntaxError: does not provide an export
 * named 'expectFrameDiff'`, which reads like a missing feature rather than a
 * decision.
 */
export function expectFrameDiff(_f: Frame, _r: Region, _goldenPath: string, _tol?: number): never {
  throw new AssertionError(
    "expectFrameDiff is not implemented: golden-image diffing is ruled out by decision D-10, because simulator and hardware font rendering are documented as divergent and exact comparison would fail for reasons unrelated to defects. Use expectFrameInk() or expectGreyLevels() instead, or raise D-10 with the user before committing a baseline.",
  );
}
