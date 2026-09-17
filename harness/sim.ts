/**
 * Vite + simulator lifecycle, with the stdout tee that is the whole point of
 * this phase (HARN-02, D-12, D-14).
 *
 * Container validation failures are written to the simulator's own stdout and
 * appear nowhere in /api/console:
 *
 *   [... WARN evenhub_simulator_lib::flutter] RebuildPageContainer validation
 *   failed: image container size 576x24 exceeds maximum 288x144
 *
 * Step 5 below is the single highest-value block of code in Phase 12.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Driver, waitFor } from "./driver.ts";

export interface SimHandle {
  port: number;
  viteUrl: string;
  startedVite: boolean;
  startedSim: boolean;
  /** false when attached to a simulator we did not spawn — no tee, HARN-02 blind */
  stdoutAvailable: boolean;
  /** tears down ONLY what this handle started (D-14) */
  stop(): Promise<void>;
}

export interface StackOpts {
  port?: number;
  viteUrl?: string;
  evenDevDir?: string;
  onStdout: (line: string) => void;
  bootTimeoutMs?: number;
  /** Opt in to attaching to a simulator we did not spawn. Default false. */
  allowAttach?: boolean;
  /** env_logger filter for the simulator. Default "info". See RUST_LOG below. */
  rustLog?: string;
}

/**
 * The simulator is a Rust binary using `env_logger`. Measured behaviour, not
 * assumed:
 *   - with no RUST_LOG, INFO is suppressed but WARN/ERROR still print, so the
 *     container-validation WARN this phase exists to catch DOES survive;
 *   - but a healthy quiet boot then produces 0 bytes on both pipes (verified),
 *     so the probe's `stdoutLineCount > 0` tee-liveness check would depend on
 *     the app happening to misbehave. That is not a check, that is a coin flip.
 *
 * RUST_LOG=info makes the startup banner unconditional, so tee liveness becomes
 * a real signal, and it surfaces the `evenhub_simulator_lib::flutter` container
 * lines Phase 19 needs for call counting.
 *
 * The plan's claim that "the simulator logs its own startup banner, so this is
 * non-zero on any healthy boot" is only true once RUST_LOG is set — it is not
 * true of the launch command the plan specifies.
 *
 * env_logger writes to STDERR, not stdout. Teeing BOTH pipes is load-bearing:
 * a stdout-only tee gets one stray `bounds:` println and none of the logging.
 */
const DEFAULT_RUST_LOG = "info";

const HERE = import.meta.dirname;
const SIM_BIN = path.resolve(
  HERE,
  "..",
  "node_modules/@evenrealities/sim-darwin-arm64/bin/evenhub-simulator",
);

/** owned children, killed by the process-exit fallback if the harness crashes */
const owned = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // A crashed harness must not orphan the simulator or leave Vite holding 5173.
  process.on("exit", () => {
    for (const c of owned) {
      if (c.pid && c.exitCode === null && c.signalCode === null) {
        try {
          process.kill(-c.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  });
}

/**
 * Splits a byte stream into complete lines, holding the trailing partial until
 * its newline arrives. Without this a validation warning that straddles a chunk
 * boundary is silently mangled into two non-matching halves.
 */
function lineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buf = "";
  return (chunk) => {
    buf += chunk.toString("utf8");
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      onLine(line);
    }
  };
}

async function killGroup(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) {
    owned.delete(child);
    return;
  }
  // NEGATIVE pid targets the process GROUP. start-even.sh spawns `npx vite` as
  // a child and blocks on `wait`, so killing the script alone leaves Vite
  // running and port 5173 held.
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    /* already dead */
  }
  const timer = new Promise<false>((r) => setTimeout(() => r(false), 5000).unref());
  const exited = await Promise.race([once(child, "exit").then(() => true), timer]);
  if (!exited) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already dead */
    }
  }
  owned.delete(child);
}

async function viteIsUp(viteUrl: string): Promise<boolean> {
  try {
    const res = await fetch(viteUrl, { method: "HEAD", signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startStack(opts: StackOpts): Promise<SimHandle> {
  const port = opts.port ?? 9898;
  const viteUrl = opts.viteUrl ?? "http://127.0.0.1:5173";
  const evenDevDir = opts.evenDevDir ?? path.resolve(HERE, "..", "..", "even-dev");
  const bootTimeoutMs = opts.bootTimeoutMs ?? 90_000;
  const driver = new Driver(port);
  installExitHook();

  // -- 1. attach check ------------------------------------------------------
  // Never attach silently. With no child of our own there is nothing to tee,
  // onStdout is never called, and every assertion keeps passing while the most
  // important requirement in the phase is switched off (B2).
  if (await driver.ping()) {
    if (!opts.allowAttach) {
      throw new Error(
        `a simulator is already running on :${port}; this harness cannot tee its stdout, so HARN-02 (container-validation capture) would be silently disabled. Stop it, or re-run with --attach to accept that.`,
      );
    }
    console.error(
      `HARN-02 COVERAGE DISABLED — attached to an existing simulator on :${port}; simulator stdout is not being captured.`,
    );
    return {
      port,
      viteUrl,
      startedVite: false,
      startedSim: false,
      stdoutAvailable: false,
      stop: async () => {},
    };
  }

  let viteProc: ChildProcess | null = null;
  let simProc: ChildProcess | null = null;

  const stop = async (): Promise<void> => {
    if (simProc) await killGroup(simProc);
    if (viteProc) await killGroup(viteProc);
  };

  try {
    // -- 2. Vite ------------------------------------------------------------
    // even-dev, NOT this repo's own `npm run dev`: even-dev supplies the Vite
    // plugins and the public/ asset symlinks whose breakage was defect #1.
    let startedVite = false;
    if (!(await viteIsUp(viteUrl))) {
      const script = path.join(evenDevDir, "start-even.sh");
      if (!fs.existsSync(script)) {
        throw new Error(
          `even-dev harness not found at ${script}. The app must be served by even-dev (it supplies the Vite plugins and the public/ asset symlinks); this repo's own \`npm run dev\` is not a substitute.`,
        );
      }
      viteProc = spawn(script, ["pokemon-showdown", "--web-only"], {
        cwd: evenDevDir,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      owned.add(viteProc);
      startedVite = true;
      // Drain both pipes. An unread pipe fills its buffer and blocks the child;
      // vite lines are mirrored for debugging but deliberately NOT fed into
      // onStdout — HARN-02 is about the simulator's stream.
      const viteEcho = lineSplitter((l) => process.stderr.write(`vite| ${l}\n`));
      viteProc.stdout?.on("data", viteEcho);
      viteProc.stderr?.on("data", viteEcho);

      await waitFor(async () => (await viteIsUp(viteUrl)) || null, {
        what: `vite at ${viteUrl}`,
        timeoutMs: 60_000,
      });
    }

    // -- 3. simulator -------------------------------------------------------
    if (!fs.existsSync(SIM_BIN)) {
      throw new Error(
        `simulator binary not found at ${SIM_BIN}. A non-darwin-arm64 host needs the sibling @evenrealities/sim-<platform>-<arch> package. Do NOT fall back to \`npx @evenrealities/evenhub-simulator\` — its bin is not linked and the call fails with "command not found".`,
      );
    }
    // An inherited RUST_LOG=error/off would silence the WARN-level container
    // validation lines and switch HARN-02 off without a word. Refuse instead.
    const rustLog = opts.rustLog ?? process.env["RUST_LOG"] ?? DEFAULT_RUST_LOG;
    if (/^\s*(off|error)\s*$/i.test(rustLog)) {
      throw new Error(
        `RUST_LOG=${rustLog} silences the simulator's WARN-level container-validation lines, which would disable HARN-02. Use "info" (or at least "warn").`,
      );
    }
    simProc = spawn(SIM_BIN, [viteUrl, "--automation-port", String(port)], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RUST_LOG: rustLog },
    });
    owned.add(simProc);

    // -- 5. THE TEE (HARN-02) ----------------------------------------------
    // Both stdout and stderr: the Rust logger's target is not guaranteed, and a
    // container-validation warning that lands on the wrong pipe is exactly the
    // defect this phase exists to catch.
    const simEcho = lineSplitter((line) => {
      process.stderr.write(`sim| ${line}\n`);
      opts.onStdout(line);
    });
    simProc.stdout?.on("data", simEcho);
    simProc.stderr?.on("data", simEcho);

    simProc.on("exit", (code, signal) => {
      process.stderr.write(`sim| <process exited code=${code} signal=${signal}>\n`);
    });

    // -- 6. readiness -------------------------------------------------------
    await waitFor(async () => (await driver.ping()) || null, {
      what: `simulator /api/ping on :${port}`,
      timeoutMs: bootTimeoutMs,
    });

    return {
      port,
      viteUrl,
      startedVite,
      startedSim: true,
      // 4. we spawned it, so the tee is live
      stdoutAvailable: true,
      stop,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
