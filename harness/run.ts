/**
 * `npm run harness` — the single entry point (D-12, HARN-06).
 *
 * Boots Vite + the simulator from nothing, runs every registered scenario,
 * writes a PNG per capture plus result.json under .harness-runs/<timestamp>/,
 * prints a per-step pass/fail table and exits non-zero if anything failed.
 *
 * NOTE on the version guard below: it cannot fire for the
 * ERR_UNKNOWN_FILE_EXTENSION case (deferred item D1 — that failure happens at
 * module resolution of this file, before any byte of it runs). The guard that
 * actually works is the plain-JS `node -e` preflight in the `harness` npm
 * script, which an old runtime can load. This one is kept for the case where
 * run.ts is invoked directly on a runtime new enough to strip types but old
 * enough to be missing something else.
 */
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj! < 22 || (maj === 22 && min! < 18)) {
  console.error(
    `harness needs Node >=22.18 for native TypeScript execution; this is ${process.versions.node}`,
  );
  process.exit(1);
}

import fs from "node:fs/promises";
import path from "node:path";
import { Driver, waitFor } from "./driver.ts";
import type { InputAction } from "./driver.ts";
import { LogStream } from "./logs.ts";
import { startStack } from "./sim.ts";
import type { SimHandle } from "./sim.ts";
import { inkRatio, saveFrame, toFrame } from "./frame.ts";
import { REGIONS } from "./regions.ts";
import type { Frame } from "./frame.ts";
import { expectConsoleClean, knownDefect } from "./assert.ts";
import type { KnownDefect } from "./assert.ts";
import { SCENARIOS } from "./scenarios/index.ts";
import type { ScreenName } from "../src/screens/ScreenState.ts";

// ---------------------------------------------------------------------------
// contracts consumed by scenarios (and by plan 12-04)
// ---------------------------------------------------------------------------

export interface StepOpts {
  /**
   * Skip the per-step `logs.reset()`.
   *
   * D-04 clears the console at the start of every step so assertions are scoped
   * to that step. That is wrong for exactly one case: a step whose subject is
   * the BOOT, which already happened before the harness ran its first step.
   * Resetting there deletes the evidence — the `[screen] MAIN_MENU` line the
   * step waits for, and the `[fetch] 404 ...` line it exists to catch.
   */
  keepLogs?: boolean;
}

export interface Ctx {
  driver: Driver;
  logs: LogStream;
  /** screenshot the glasses, decode, save the PNG to the run dir, return the Frame */
  capture(label: string): Promise<Frame>;
  /** send an input and drain both log streams */
  press(action: InputAction): Promise<void>;
  /** named sub-unit; clears the console first, records pass/fail + hostCalls */
  step(name: string, fn: () => Promise<void>, opts?: StepOpts): Promise<void>;
  /**
   * Block until the app logs `[screen] <name>` AT OR AFTER the `since`
   * watermark, then capture and return the frame. `since` defaults to a
   * watermark taken at call entry, which is correct for the common
   * `press(); waitScreen()` shape. Pass an explicit watermark taken BEFORE the
   * input when the screen may already have been logged earlier in the step.
   */
  waitScreen(name: ScreenName, timeoutMs?: number, since?: number): Promise<Frame>;
  runDir: string;
}

export type Scenario = { name: string; needsSim: boolean; run: (ctx: Ctx) => Promise<void> };

export interface StepResult {
  scenario: string;
  step: string;
  ok: boolean;
  ms: number;
  hostCalls: Record<string, number>;
  error?: string;
}

/** marks an error as already recorded by step(), so the scenario boundary does not double-count */
const RECORDED = Symbol("recordedByStep");

// ---------------------------------------------------------------------------
// argv (D-11: no config file)
// ---------------------------------------------------------------------------

function parseArgv(argv: string[]): { port: number; only?: string; keep: boolean; attach: boolean } {
  let port = 9898;
  let only: string | undefined;
  let keep = false;
  let attach = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") port = Number(argv[++i]);
    else if (a === "--only") only = argv[++i];
    else if (a === "--keep") keep = true;
    else if (a === "--attach") attach = true;
    else {
      console.error(`unknown argument "${a}"; supported: --port <n> --only <name> --keep --attach`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(port) || port <= 0) {
    console.error(`--port must be a positive integer`);
    process.exit(1);
  }
  return { port, only, keep, attach };
}

// ---------------------------------------------------------------------------
// run state
// ---------------------------------------------------------------------------

const results: StepResult[] = [];
const waived: Array<{ defect: KnownDefect; message: string }> = [];
let handle: SimHandle | null = null;
let runDir = "";
let keepStack = false;
let fatal: string | null = null;

function record(r: StepResult): void {
  results.push(r);
  const mark = r.ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${r.scenario} / ${r.step}  (${r.ms}ms)${r.ok ? "" : `\n      ${r.error}`}`);
}

function makeCtx(driver: Driver, logs: LogStream, runDir: string, sim: boolean, scenario: string): Ctx {
  let captureSeq = 0;

  const needSim = (what: string): void => {
    if (!sim) throw new Error(`${what} requires a simulator, but scenario "${scenario}" declared needsSim: false`);
  };

  /** screenshot + decode, WITHOUT writing an artifact (used for polling) */
  const snap = async (): Promise<Frame> => {
    needSim("capture()");
    return toFrame(await driver.glasses());
  };

  const save = async (frame: Frame, label: string): Promise<void> => {
    const safe = label.replace(/[^A-Za-z0-9._-]+/g, "-");
    // scenario-prefixed: captureSeq restarts per scenario, so two scenarios
    // capturing the same label would otherwise overwrite each other's artifact.
    await saveFrame(
      frame,
      path.join(runDir, `${scenario}-${String(++captureSeq).padStart(3, "0")}-${safe}.png`),
    );
  };

  const capture = async (label: string): Promise<Frame> => {
    const frame = await snap();
    await save(frame, label);
    return frame;
  };

  const ctx: Ctx = {
    driver,
    logs,
    runDir,
    capture,
    async press(action) {
      needSim("press()");
      await driver.input(action);
      await logs.poll();
    },
    async step(name, fn, opts) {
      // Scan for waived known-defect lines BEFORE reset() destroys the buffer:
      // a waiver nobody ever sees is a waiver that has been forgotten.
      if (sim) collectWaived(logs);
      if (sim && !opts?.keepLogs) await logs.reset();
      const t0 = Date.now();
      try {
        await fn();
        if (sim) collectWaived(logs);
        record({ scenario, step: name, ok: true, ms: Date.now() - t0, hostCalls: logs.hostCalls() });
      } catch (e) {
        if (sim) collectWaived(logs);
        if (sim) {
          // the frame at the moment of failure is the whole point of D-09
          try {
            await capture(`${name}-FAIL`);
          } catch {
            /* the simulator may be the thing that died */
          }
        }
        record({
          scenario,
          step: name,
          ok: false,
          ms: Date.now() - t0,
          hostCalls: logs.hostCalls(),
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        });
        if (e instanceof Error) (e as Error & { [RECORDED]?: true })[RECORDED] = true;
        throw e;
      }
    },
    async waitScreen(name, timeoutMs = 20_000, since = logs.nextSeq()) {
      needSim("waitScreen()");
      const from = since;
      await waitFor(
        async () => {
          await logs.poll();
          return logs.all().some((l) => l.seq >= from && l.message.includes(`[screen] ${name}`)) ? true : null;
        },
        { what: `screen ${name} (after seq ${from})`, timeoutMs },
      );

      // The [screen] line means render()'s awaits resolved — but the
      // simulator's compositor lags it, and a capture taken immediately after
      // can still be the blank/previous framebuffer (measured: `CONTENT: ink
      // 0.000` on roughly one run in three before this loop existed; the plan's
      // "no settle is needed" claim is empirically wrong).
      //
      // So poll for pixels (D-15: a condition, never a sleep) — but GIVE UP
      // after the budget and return the blank frame anyway. A screen that is
      // genuinely blank must still fail at the assertion with its observed ink
      // (HARN-03), not hide behind a timeout message from the wait helper.
      let frame = await snap();
      if (inkRatio(frame, REGIONS.FULL) === 0) {
        frame = await waitFor(
          async () => {
            frame = await snap();
            return inkRatio(frame, REGIONS.FULL) > 0 ? frame : null;
          },
          { what: `any lit pixel after [screen] ${name}`, timeoutMs: 5000, pollMs: 100 },
        ).catch(() => frame);
      }
      await save(frame, `screen-${name}`);
      return frame;
    },
  };
  return ctx;
}

/** every waived known-defect line seen so far, collected so nothing is swallowed in silence */
function collectWaived(logs: LogStream): void {
  for (const l of logs.all()) {
    const d = knownDefect(l);
    if (d && !waived.some((w) => w.message === l.message)) waived.push({ defect: d, message: l.message });
  }
}

async function runScenario(s: Scenario, driver: Driver, logs: LogStream, runDir: string): Promise<void> {
  console.log(`\n--- ${s.name} ---`);
  const ctx = makeCtx(driver, logs, runDir, s.needsSim, s.name);
  try {
    await s.run(ctx);
  } catch (e) {
    if (!(e instanceof Error) || !(e as Error & { [RECORDED]?: true })[RECORDED]) {
      record({
        scenario: s.name,
        step: "<scenario body>",
        ok: false,
        ms: 0,
        hostCalls: {},
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
  }
  if (s.needsSim) {
    collectWaived(logs);
    // HARN-05 must hold even for a step that forgot to assert it.
    const t0 = Date.now();
    try {
      await logs.poll();
      expectConsoleClean(logs);
      record({ scenario: s.name, step: "<console clean>", ok: true, ms: Date.now() - t0, hostCalls: logs.hostCalls() });
    } catch (e) {
      record({
        scenario: s.name,
        step: "<console clean>",
        ok: false,
        ms: Date.now() - t0,
        hostCalls: logs.hostCalls(),
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
    collectWaived(logs);
  }
}

async function finish(): Promise<never> {
  if (handle && !keepStack) await handle.stop();
  else if (handle) console.log(`\n--keep: simulator left running on :${handle.port}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(72)}`);
  for (const r of results) {
    const calls = Object.entries(r.hostCalls)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(
      `${r.ok ? "pass" : "FAIL"}  ${(r.scenario + " / " + r.step).padEnd(44)} ${String(r.ms).padStart(6)}ms  ${calls}`,
    );
  }
  if (waived.length) {
    console.log(`\nknown app defects waived by assert.ts KNOWN_DEFECTS (NOT failures, but not fixed either):`);
    for (const w of waived) console.log(`  ${w.defect.id} (${w.defect.owner}): ${w.message}`);
  }
  if (fatal) console.log(`\nFATAL: ${fatal}`);
  for (const r of failed) console.log(`\nFAILED  ${r.scenario} / ${r.step}\n  ${r.error}`);

  const ok = failed.length === 0 && fatal === null;
  await fs.writeFile(
    path.join(runDir, "result.json"),
    JSON.stringify({ ok, fatal, steps: results, waived, node: process.versions.node, at: new Date().toISOString() }, null, 2),
  );
  console.log(`\n${ok ? "HARNESS OK" : `HARNESS FAILED (${failed.length} step(s)${fatal ? " + fatal" : ""})`}`);
  console.log(`artifacts: ${runDir}`);
  process.exit(ok ? 0 : 1);
}

async function main(): Promise<void> {
  const args = parseArgv(process.argv.slice(2));

  // A typo must not boot a simulator and then report success on zero scenarios.
  if (args.only && !SCENARIOS.some((s) => s.name === args.only)) {
    console.error(`unknown scenario "${args.only}"; available: ${SCENARIOS.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }
  const selected = SCENARIOS.filter((s) => !args.only || s.name === args.only);

  runDir = path.resolve(
    import.meta.dirname,
    "..",
    ".harness-runs",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await fs.mkdir(runDir, { recursive: true });
  console.log(`run dir: ${runDir}`);

  keepStack = args.keep;
  const driver = new Driver(args.port);
  // constructed BEFORE startStack so boot-time simulator stdout is captured too
  const logs = new LogStream(driver);

  process.on("unhandledRejection", (e) => {
    fatal = `unhandledRejection: ${e instanceof Error ? e.message : String(e)}`;
    void finish();
  });
  process.on("uncaughtException", (e) => {
    fatal = `uncaughtException: ${e.message}`;
    void finish();
  });

  // 1. no-sim scenarios first: a broken decoder must not be diagnosed as a broken app
  for (const s of selected.filter((x) => !x.needsSim)) {
    await runScenario(s, driver, logs, runDir);
  }
  if (results.some((r) => !r.ok)) {
    fatal = "harness self-checks failed; refusing to boot a simulator and blame the app";
    await finish();
  }

  const simScenarios = selected.filter((s) => s.needsSim);
  if (simScenarios.length === 0) await finish();

  handle = await startStack({
    port: args.port,
    onStdout: (line) => logs.pushStdout(line),
    allowAttach: args.attach,
  });

  let gated = false;
  for (const s of simScenarios) {
    await runScenario(s, driver, logs, runDir);

    // HARN-02 tee liveness gate, immediately after the first sim scenario (B2).
    // stdoutLineCount, NOT logs.all(): ctx.step() calls logs.reset(), which
    // deliberately erases the buffer but not the counter.
    if (!gated) {
      gated = true;
      if (handle.stdoutAvailable === false) {
        console.log(
          `WARNING: attached to an existing simulator, so there is no stdout tee. HARN-02 coverage is OFF for this run.`,
        );
      } else if (logs.stdoutLineCount === 0) {
        fatal =
          "HARN-02 NOT MET: zero simulator stdout lines were captured. Container validation failures appear ONLY on stdout, so this run proves nothing about them.";
        await finish();
      } else {
        console.log(`HARN-02 tee alive: ${logs.stdoutLineCount} simulator stdout line(s) captured`);
      }
    }
  }

  await finish();
}

void main().catch(async (e) => {
  fatal = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const runDir = path.resolve(import.meta.dirname, "..", ".harness-runs", "crash");
  await fs.mkdir(runDir, { recursive: true }).catch(() => {});
  await finish();
});
