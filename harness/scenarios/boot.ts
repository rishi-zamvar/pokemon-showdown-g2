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
import {
  AssertionError,
  FatalError,
  expectConsoleClean,
  expectFrameInk,
  expectLoggedLine,
  expectNoLoggedLine,
} from "../assert.ts";
import type { Ctx, Scenario } from "../run.ts";
import { MAIN_MENU_CONTEXT_MENU, MENU_ITEM_IDS } from "../../src/config/constants.ts";

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

// ---------------------------------------------------------------------------
// the root context menu (INPUT-02 / INFO-01)
// ---------------------------------------------------------------------------

/** the adapter's "I heard a menu click" line; the id is captured */
const MENU_CLICK = /\[GlassAdapter\] menu: itemID=(\d+)/;

/**
 * Evidence that the app raised the exit dialogue. Written as a pattern rather
 * than inline so there is ONE spelling of it in this file.
 */
const EXIT_CALL = /shutDownPageContainer/;

/**
 * Where the OS highlight sits when the menu opens. MEASURED, not assumed:
 * discovered by the first selection of the run and reused by every later one.
 *
 * Everything in this phase that is not "the app might be wrong" rests on this
 * number: Exit is last (D-02, selfCheck 53) precisely so that a highlight on
 * the FIRST entry cannot exit, and until this is measured that is half a
 * safety property.
 */
let observedDefaultIndex: number | null = null;

/**
 * Turn an unexpected exit into a RUN abort instead of a step failure.
 *
 * Not pedantry about error types. After the dialogue every updateImageRawData
 * returns sendFailed until the app restarts (D-02) and the suite shares one
 * simulator, so continuing would report a cascade of failures whose real cause
 * is three scenarios back. Must be called after EVERY menu click.
 */
function refuseExit(ctx: Ctx, where: string): void {
  try {
    expectNoLoggedLine(ctx.logs, EXIT_CALL, `${where}: the app raised the exit dialogue`);
  } catch (e) {
    throw new FatalError(
      `${e instanceof Error ? e.message : String(e)}\n` +
        `  A menu click selected Exit. Every image send from here on fails until the app restarts (D-02), ` +
        `so every later scenario would fail for a reason unrelated to what it tests — this run is over.\n` +
        `  The default highlight is evidently NOT where this run thought (${
          observedDefaultIndex === null
            ? "not yet measured — this was the first selection of the run, so the highlight starts ON Exit"
            : `measured index ${observedDefaultIndex}`
        }): re-examine MAIN_MENU_CONTEXT_MENU's order in plan 02 before shipping anything else.`,
    );
  }
}

/**
 * Open the OS context menu. Separate from the selection so the step that
 * measures the menu's ink can look at it while it is open.
 */
async function openMenu(ctx: Ctx): Promise<void> {
  await ctx.press("context_menu");
  await quiesce(ctx);
}

/**
 * Commit the selection on MAIN_MENU_CONTEXT_MENU[targetIndex] of an ALREADY
 * OPEN menu, and return the itemID the app actually reported.
 *
 * Navigates DETERMINISTICALLY from the measured default highlight. Selecting
 * "whatever happens to be highlighted" would be a coin flip whose losing side
 * is Exit.
 */
async function commitMenuSelection(ctx: Ctx, targetIndex: number): Promise<number> {
  const target = MAIN_MENU_CONTEXT_MENU[targetIndex];
  if (!target) {
    throw new AssertionError(`menu index ${targetIndex} does not exist in MAIN_MENU_CONTEXT_MENU`);
  }
  // A typo in a caller must not be the thing that wedges the simulator. Plan 04
  // owns that selection and is ordered last for exactly this reason.
  if (target.id === MENU_ITEM_IDS.exit) {
    throw new AssertionError(
      `refusing to select "${target.name}" (itemID ${target.id}): it raises the dialogue that wedges every later image send (D-02). That selection is plan 13.1-04's terminal scenario and belongs at the very end of the suite.`,
    );
  }
  if (observedDefaultIndex === null && targetIndex !== 0) {
    throw new AssertionError(
      `cannot navigate to menu index ${targetIndex} before the default highlight has been measured; the first selection of a run must be index 0`,
    );
  }
  const steps = targetIndex - (observedDefaultIndex ?? 0);
  if (steps < 0) {
    throw new AssertionError(
      `menu index ${targetIndex} is ABOVE the default highlight (${observedDefaultIndex}); only "down" has been measured to move the OS highlight, so this navigation is unproven`,
    );
  }

  const mark = ctx.logs.nextSeq();
  for (let i = 0; i < steps; i++) await ctx.press("down");
  if (steps > 0) await quiesce(ctx);
  await ctx.press("click");
  await quiesce(ctx);

  // FIRST, before anything else can mask it.
  refuseExit(ctx, `selecting menu item "${target.name}"`);

  // Watermarked: a step that selects three times must not read the FIRST
  // iteration's line three times and call that three proofs.
  const line = ctx.logs
    .all()
    .find((l) => l.seq >= mark && MENU_CLICK.test(l.message));
  if (!line) {
    const tail = ctx.logs.all().slice(-8).map((l) => `    [${l.source}/${l.level}] ${l.message}`);
    throw new AssertionError(
      `no "[GlassAdapter] menu: itemID=" line after clicking on menu index ${targetIndex}. Either the click never reached the adapter, or it was swallowed as a stray TAP by mapEventToGesture's unknown-eventType fallback (D6), or it arrived inside the 600ms dedupe window and was dropped. Last lines:\n${tail.join("\n") || "    (none)"}`,
    );
  }
  const id = Number(MENU_CLICK.exec(line.message)![1]);
  const idx = MAIN_MENU_CONTEXT_MENU.findIndex((m) => m.id === id);
  if (idx < 0) {
    throw new AssertionError(
      `the app reported menu itemID ${id}, which is not in MAIN_MENU_CONTEXT_MENU (${MAIN_MENU_CONTEXT_MENU.map((m) => `${m.name}=${m.id}`).join(", ")})`,
    );
  }

  if (observedDefaultIndex === null) {
    observedDefaultIndex = idx;
    console.log(
      `      measured: the OS menu highlight defaults to index ${idx} ("${MAIN_MENU_CONTEXT_MENU[idx]!.name}", itemID ${id})`,
    );
  } else if (id !== target.id) {
    throw new AssertionError(
      `navigated ${steps} step(s) down from index ${observedDefaultIndex} expecting "${target.name}" (itemID ${target.id}), but the app reported itemID ${id} ("${MAIN_MENU_CONTEXT_MENU[idx]!.name}")`,
    );
  }
  return id;
}

/** open + select, the shape every caller after the first measurement wants */
async function selectMenuItem(ctx: Ctx, targetIndex: number): Promise<number> {
  await openMenu(ctx);
  return commitMenuSelection(ctx, targetIndex);
}

/** index of an item by id, so no caller restates a position */
function menuIndexOf(id: number): number {
  return MAIN_MENU_CONTEXT_MENU.findIndex((m) => m.id === id);
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
        // INFO-01: the root page declared its menu. The ROADMAP names this
        // assertion and nothing else in the phase provides it. Safe here only
        // because this step keeps the boot logs; the declaration happens once,
        // before the harness sends its first input.
        expectLoggedLine(ctx.logs, /\[GlassAdapter\] menu declared: 3 item\(s\)/);
        expectConsoleClean(ctx.logs);
      },
      { keepLogs: true },
    );

    // -- 2. the menu is live and routes (INPUT-02) ---------------------------
    // Between "boot" and "enter-battle" on purpose: both menu steps need the
    // app on MAIN_MENU, and entering a battle leaves it on BATTLE_HUD with no
    // menuObject declared at all (D-09).
    await ctx.step("context-menu", async () => {
      const before = await ctx.capture("pre-context-menu");
      await openMenu(ctx);
      const after = await ctx.capture("context-menu-open");

      // POST /api/input answers {"ok":true} for inputs the simulator then
      // drops, so HTTP success proves nothing. The pixels do.
      if (Buffer.compare(Buffer.from(before.rgba), Buffer.from(after.rgba)) === 0) {
        throw new AssertionError(
          `the framebuffer is byte-identical before and after context_menu: the input was accepted by HTTP and dropped by the simulator (ink ${inkRatio(after, REGIONS.FULL).toFixed(4)} unchanged)`,
        );
      }
      // A menu is drawn ON TOP of the page, so it can only ADD lit pixels.
      // Measured on the artifact pair: 0.0091 closed -> 0.0118 open.
      const inkBefore = inkRatio(before, REGIONS.FULL);
      const inkAfter = inkRatio(after, REGIONS.FULL);
      if (!(inkAfter > inkBefore)) {
        throw new AssertionError(
          `FULL ink did not rise when the context menu opened (${inkBefore.toFixed(4)} -> ${inkAfter.toFixed(4)}): the frame changed but nothing was drawn on top, so whatever happened was not a menu`,
        );
      }
      // Smoke detector only (D-10), and DELIBERATELY BELOW the closed-menu
      // value: MAIN_MENU alone measures 0.0091, so a floor of 0.01 would make
      // this assertion accidentally depend on the menu instead of on the rise
      // comparison above. 0.005 is ~2.4x below the measured 0.0118 and a blank
      // screen still scores exactly 0.
      expectFrameInk(after, REGIONS.FULL, 0.005, 0.8);
      // `context-menu-open.png` is the artifact Phase 17 inherits.

      // Commit on the default highlight. This is the measurement: the id that
      // comes back IS the answer to "where does the highlight start".
      const id = await commitMenuSelection(ctx, 0);
      // The click was routed as a MENU event, not swallowed into a stray TAP by
      // mapEventToGesture's unknown-eventType fallback (D6). That ordering
      // constraint is the whole of INPUT-02.
      expectLoggedLine(ctx.logs, /\[screen\] menu: /);
      if (id !== MENU_ITEM_IDS.battleSpeed) {
        throw new AssertionError(
          `the default menu highlight selected itemID ${id}, not Battle Speed (${MENU_ITEM_IDS.battleSpeed}). Every later step navigates relative to index 0; see the SUMMARY note on plan 02's ordering.`,
        );
      }
      expectConsoleClean(ctx.logs);
    });

    // -- 3. harness-01 cannot come back --------------------------------------
    // The live bug: after ONE speed change every further main-menu click
    // re-cycled the speed and "Enter Battle" became permanently unreachable,
    // because handleMainMenu left cursorIndex at 1 and the firmware omits
    // currentSelectItemIndex for selection 0. 13.1-02 removed the state that
    // caused it (one list row, speed in the menu); this step is the proof.
    await ctx.step("menu-speed-does-not-soft-brick", async () => {
      const speedIndex = menuIndexOf(MENU_ITEM_IDS.battleSpeed);
      for (let i = 1; i <= 3; i++) {
        const mark = ctx.logs.nextSeq();
        await selectMenuItem(ctx, speedIndex);
        // Assert on the ROUTE, not on a screen transition. waitScreen here
        // would hang for the full timeout on any iteration that selected About
        // instead (About renders via showText and logs no [screen] oracle at
        // all), turning a wrong selection into three timeouts instead of one
        // clear failure. Watermarked so iteration 2 cannot pass on iteration
        // 1's line.
        expectLoggedLine(ctx.logs, /\[screen\] menu: Battle Speed/, mark);
        // Every click, not just the first (R2).
        refuseExit(ctx, `Battle Speed selection ${i} of 3`);
      }

      // FOUR selections have now happened this run — one in "context-menu" and
      // three here — and the cycle is Normal -> Fast -> Instant -> Slow ->
      // Normal, so the app is back where it started. That is not a coincidence
      // to leave implicit: the suite shares one simulator and the battle
      // scenario assumes Normal (at Instant it renders TURN_RESULT without
      // render() and logs no [screen] oracle, harness-02). Read the preset off
      // the status container in the simulator's own rebuild log.
      const speeds = ctx.logs
        .all()
        .flatMap((l) => [...l.message.matchAll(/Speed: (\w+)/g)].map((m) => m[1]!));
      const ended = speeds.at(-1);
      if (ended !== "Normal") {
        throw new AssertionError(
          `the run leaves the battle speed on "${ended ?? "(never seen)"}", not Normal. One selection in "context-menu" plus three here is exactly one full 4-preset cycle; changing either count hands the battle scenario a speed it cannot drive. Presets seen this step: ${JSON.stringify(speeds)}`,
        );
      }
      expectConsoleClean(ctx.logs);
    });

    // -- 4. enter battle ----------------------------------------------------
    // THIS STEP OWNS THE MAIN_MENU -> BATTLE_HUD TRANSITION, and since the
    // regression step above it also owns the harness-01 proof: a plain click
    // after four Battle Speed selections must still enter a battle. The
    // regression step deliberately does NOT click through itself — one step
    // owning the transition means one place to read when it breaks.
    await ctx.step("enter-battle", async () => {
      const before = await ctx.capture("pre-enter-battle");
      // Watermark BEFORE the input. press() polls the console itself, so by the
      // time waitScreen runs the line may already be buffered — its default
      // (a watermark taken at call entry) would then skip past it and time out.
      const mark = ctx.logs.nextSeq();
      await ctx.press("click");
      const after = await ctx.waitScreen("BATTLE_HUD", SCREEN_TIMEOUT_MS, mark).catch((e: unknown) => {
        throw new AssertionError(
          `Enter Battle is unreachable after 4 Battle Speed selections — harness-01 has regressed. D-05: the main menu list must stay a SINGLE row so cursorIndex never leaves 0 and onTap's \`listIndex ?? cursorIndex\` fallback cannot go stale. Underlying: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
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

    // -- 5. every input action ----------------------------------------------
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

    // -- 6. webview ---------------------------------------------------------
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
