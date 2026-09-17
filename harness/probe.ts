/**
 * One-command connectivity probe over a COLD-STARTED stack.
 *
 * `node harness/probe.ts` — boots Vite + the simulator from nothing, touches
 * every automation endpoint, POSTs all seven input actions, and proves the
 * stdout tee is alive. It deliberately never attaches: an attached probe owns
 * no child process, so it could not verify the tee it exists to verify.
 */
// Node-version guard. See .planning/phases/12-automation-test-harness/
// deferred-items.md D1: this CANNOT fire for the ERR_UNKNOWN_FILE_EXTENSION
// case it reads as targeting, because that failure happens at module
// resolution of this file, before any byte of it runs. Kept for consistency
// with the other entry points; the real preflight lands in 12-03's
// `npm run harness`.
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj! < 22 || (maj === 22 && min! < 18)) {
  console.error(
    `harness needs Node >=22.18 for native TypeScript execution; this is ${process.versions.node}`,
  );
  process.exit(1);
}

import { INPUT_ACTIONS, Driver, waitFor } from "./driver.ts";
import { LogStream } from "./logs.ts";
import { startStack } from "./sim.ts";
import { decodePng } from "./png.ts";
import { DISPLAY } from "../src/config/constants.ts";

let failed = 0;

function ok(name: string, detail = ""): void {
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function bad(name: string, why: string): void {
  failed++;
  console.log(`FAIL  ${name} — ${why}`);
}

async function main(): Promise<void> {
  const driver = new Driver(9898);
  const logs = new LogStream(driver);

  // no allowAttach: a cold start is the whole point (see header)
  const handle = await startStack({ onStdout: (l) => logs.pushStdout(l) });

  try {
    if (await driver.ping()) ok("/api/ping");
    else bad("/api/ping", "did not return pong");

    // Four signature bytes never verify the "8-bit non-interlaced RGBA"
    // assumption the whole decoder rests on. Decoding the real encoder's output
    // does — if the simulator ever ships a palette or 16-bit PNG, it surfaces
    // right here instead of as garbage ink ratios six phases later.
    const png = await driver.glasses();
    const sig = [0x89, 0x50, 0x4e, 0x47];
    if (sig.every((b, i) => png[i] === b)) ok("/api/screenshot/glasses", `${png.length} bytes, PNG signature ok`);
    else bad("/api/screenshot/glasses", `bad signature: ${[...png.slice(0, 4)].join(",")}`);

    try {
      const d = decodePng(png);
      if (d.width === DISPLAY.WIDTH && d.height === DISPLAY.HEIGHT) {
        ok("glasses PNG decodes", `${d.width}x${d.height}, ${d.rgba.length} rgba bytes`);
      } else {
        bad("glasses PNG decodes", `got ${d.width}x${d.height}, expected ${DISPLAY.WIDTH}x${DISPLAY.HEIGHT}`);
      }
    } catch (e) {
      bad("glasses PNG decodes", e instanceof Error ? e.message : String(e));
    }

    // The webview endpoint 404s until WKWebView has produced its first snapshot
    // — verified: it returns HTTP 404 right after boot and 200 shortly after.
    // D-15: poll the condition, never sleep a fixed amount.
    try {
      const web = await waitFor(async () => (await driver.webview()) || null, {
        what: "/api/screenshot/webview (404s until the webview has rendered)",
        timeoutMs: 30_000,
      });
      if (web.length > 0) ok("/api/screenshot/webview", `${web.length} bytes`);
      else bad("/api/screenshot/webview", "empty body");
    } catch (e) {
      bad("/api/screenshot/webview", e instanceof Error ? e.message : String(e));
    }

    const con = await driver.consoleSince(0);
    if (Array.isArray(con.entries) && typeof con.total === "number") {
      ok("/api/console", `${con.entries.length} entries, total ${con.total}`);
    } else {
      bad("/api/console", `unexpected shape: ${JSON.stringify(con).slice(0, 120)}`);
    }

    await logs.poll();

    for (const action of INPUT_ACTIONS) {
      try {
        await driver.input(action);
        ok(`POST /api/input ${action}`);
      } catch (e) {
        bad(`POST /api/input ${action}`, e instanceof Error ? e.message : String(e));
      }
    }

    // HARN-02 liveness. A cold start that captured ZERO simulator stdout lines
    // means the tee is dead and the container-validation stream is not being
    // read at all — fail loudly rather than go green with the requirement off.
    if (!handle.stdoutAvailable) {
      bad("HARN-02 stdout tee", "stdoutAvailable is false on a cold start");
    } else if (logs.stdoutLineCount === 0) {
      bad("HARN-02 stdout tee", "cold start captured 0 simulator stdout lines — the tee is dead");
    } else {
      ok("HARN-02 stdout tee", `${logs.stdoutLineCount} simulator stdout lines captured`);
    }

    // monotonicity, live rather than only in selfCheck (B2)
    const beforeReset = logs.stdoutLineCount;
    await logs.reset();
    if (logs.stdoutLineCount === beforeReset) ok("stdoutLineCount survives reset()", `${beforeReset}`);
    else bad("stdoutLineCount survives reset()", `${beforeReset} -> ${logs.stdoutLineCount}`);

    const fails = logs.failures();
    console.log(
      `\nlifecycle: startedVite=${handle.startedVite} startedSim=${handle.startedSim} stdoutAvailable=${handle.stdoutAvailable}`,
    );
    console.log(`log lines: ${logs.all().length} in buffer, ${logs.stdoutLineCount} stdout total`);
    if (fails.length) {
      console.log(`\nfailure-policy hits seen during boot (reported, not fatal for the probe):`);
      for (const f of fails.slice(0, 10)) console.log(`  [${f.source}/${f.level}] ${f.message}`);
    }
  } finally {
    await handle.stop();
  }

  console.log(failed === 0 ? "\nPROBE OK" : `\nPROBE FAILED (${failed})`);
  process.exit(failed ? 1 : 0);
}

void main().catch((e) => {
  console.error(`\nPROBE FAILED — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
