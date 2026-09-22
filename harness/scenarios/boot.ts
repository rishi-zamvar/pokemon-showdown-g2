/**
 * Cold boot -> main menu -> battle, plus every input action the platform has.
 *
 * This is the scenario that would have caught both of the defects that made the
 * game unplayable: a blank/short-rendered screen (expectFrameInk) and the
 * `[fetch] 404 /data/learnsets.json` asset regression (expectConsoleClean over
 * the boot logs).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { INPUT_ACTIONS, waitFor } from "../driver.ts";
import { REGIONS } from "../regions.ts";
import { inkRatio } from "../frame.ts";
import { AssertionError, expectConsoleClean, expectFrameInk } from "../assert.ts";
import type { Ctx, Scenario } from "../run.ts";

/**
 * Screen changes cost ~477ms today (3 image sends at ~104ms + a ~165ms
 * rebuild), and entering a battle also generates two teams and builds sprite
 * composites. D-15: poll for the condition, budget generously, never sleep.
 */
const SCREEN_TIMEOUT_MS = 60_000;

/**
 * Wait for the log streams to go quiet before asserting on them.
 *
 * `press()` returns as soon as the POST is answered, but the app keeps
 * rendering afterwards — so a warning caused by an input can land AFTER the
 * step's expectConsoleClean and then be erased by the next step's reset(),
 * turning HARN-05 into a coin flip. This polls a condition (two consecutive
 * polls with no new lines), it is not a fixed sleep: D-15 is satisfied.
 */
export async function quiesce(ctx: Ctx, settleMs = 4000): Promise<void> {
  let last = -1;
  await waitFor(
    async () => {
      await ctx.logs.poll();
      const now = ctx.logs.all().length + ctx.logs.stdoutLineCount;
      const stable = now === last;
      last = now;
      return stable ? true : null;
    },
    { what: "log streams to go quiet after the last input", timeoutMs: settleMs, pollMs: 300 },
  ).catch(() => {
    // Still noisy after settleMs: not a failure by itself. Whatever was logged
    // is in the buffer and the assertions below judge it.
  });
}

export const bootScenario: Scenario = {
  name: "boot",
  needsSim: true,
  async run(ctx) {
    // -- 1. boot ------------------------------------------------------------
    // keepLogs: the subject of this step is the BOOT, which finished before the
    // step began. D-04's console clear would delete the `[screen] MAIN_MENU`
    // line this step waits for and the `[fetch] 404` line it exists to catch.
    // `since = 0` for the same reason: the watermark must not exclude boot.
    await ctx.step(
      "boot",
      async () => {
        const frame = await ctx.waitScreen("MAIN_MENU", SCREEN_TIMEOUT_MS, 0);
        // wide on purpose: a smoke detector, not a golden diff (D-10). The
        // lower bound fails a blank screen, the upper a saturated one.
        //
        // RECALIBRATED by 13.1-02. The floor was 0.01, measured against a
        // THREE-row main menu. The list is one row now ("Enter Battle"; Battle
        // Speed and About moved into the root context menu, D-05), and one row
        // of text inks CONTENT at 0.0046 -- measured, not guessed, off
        // .harness-runs/.../boot-001-screen-MAIN_MENU.png. 0.002 keeps the only
        // property the floor ever had: a blank CONTENT region is 0.000 and
        // still fails, with 2.3x headroom below the real screen.
        expectFrameInk(frame, REGIONS.CONTENT, 0.002, 0.6);
        await quiesce(ctx);
        expectConsoleClean(ctx.logs);
      },
      { keepLogs: true },
    );

    // -- 2. enter battle ----------------------------------------------------
    await ctx.step("enter-battle", async () => {
      const before = await ctx.capture("pre-enter-battle");
      // Watermark BEFORE the input. press() polls the console itself, so by the
      // time waitScreen runs the line may already be buffered — its default
      // (a watermark taken at call entry) would then skip past it and time out.
      const mark = ctx.logs.nextSeq();
      await ctx.press("click");
      const after = await ctx.waitScreen("BATTLE_HUD", SCREEN_TIMEOUT_MS, mark);
      expectFrameInk(after, REGIONS.LIST, 0.01, 0.6);

      // POST /api/input answers {"ok":true} for inputs the simulator then drops
      // (no container with isEventCapture:1) — a dropped input is byte-for-byte
      // indistinguishable from a no-op at the HTTP layer. Assert the pixels.
      if (Buffer.compare(Buffer.from(before.rgba), Buffer.from(after.rgba)) === 0) {
        throw new AssertionError(
          `the framebuffer is byte-identical before and after click: the input was accepted by HTTP and dropped by the simulator (ink ${inkRatio(
            after,
            REGIONS.FULL,
          ).toFixed(3)} unchanged)`,
        );
      }
    });

    // -- 3. every input action ----------------------------------------------
    // ROADMAP success criterion 2 wants all seven exercised inside the suite.
    // This step asserts only that sending them breaks neither the app nor the
    // simulator: long_press, long_press_release and context_menu have no
    // handler until Phase 16 (INPUT-01/02), which upgrades this into
    // behavioural assertions.
    await ctx.step("inputs-accepted", async () => {
      for (const action of INPUT_ACTIONS) {
        await ctx.press(action);
      }
      await quiesce(ctx);
      await ctx.capture("after-seven-inputs");
      expectConsoleClean(ctx.logs);

      // Deliberately NOT navigating back to a known screen here. The seven
      // actions land the app somewhere different run to run — glassAdapter's
      // mapEventToGesture turns every UNKNOWN eventType into a TAP
      // (glassAdapter.ts:629), so long_press / long_press_release /
      // context_menu can each commit a move — and a scenario that depends on
      // where this storm stops is flaky by construction (it was: "could not
      // navigate back to MAIN_MENU in 12 inputs (last screen: ANIMATING)").
      // negativeProof finds its own measured-blank target instead.
    });

    // -- 4. webview ---------------------------------------------------------
    // HARN-01 names this endpoint. It 404s until WKWebView's first snapshot
    // exists, so poll it (deferred item D5).
    await ctx.step("webview", async () => {
      const bytes = await waitFor(async () => (await ctx.driver.webview()) || null, {
        what: "/api/screenshot/webview (404s until the webview has rendered)",
        timeoutMs: 30_000,
      });
      const sig = [0x89, 0x50, 0x4e, 0x47];
      if (!sig.every((b, i) => bytes[i] === b)) {
        throw new AssertionError(
          `/api/screenshot/webview did not return a PNG: first bytes ${[...bytes.slice(0, 4)].join(",")}`,
        );
      }
      await fs.writeFile(path.join(ctx.runDir, "webview.png"), bytes);
    });
  },
};
