/**
 * The positive proof of INPUT-05, and the only place in the suite allowed to
 * select Exit.
 *
 * Selecting Exit raises the OS dialogue, and after that dialogue every
 * updateImageRawData returns sendFailed in 1-3 ms and never recovers until the
 * app restarts (D-02). The suite shares ONE simulator. So this scenario runs
 * last, after battle's "back-to-menu" step has already returned the app to the
 * root page: the wedge it causes has nothing left to poison.
 *
 * Why not a mocked ScreenController instead? Because it cannot be imported.
 * src/ uses `.js` import specifiers, which Node's strip-only TypeScript mode
 * does not resolve to `.ts` -- verified: importing ScreenController.ts from
 * Node fails with ERR_MODULE_NOT_FOUND on '../battle/SimBattleAdapter.js'.
 * That is the same constraint that forces containerGuards.ts to import
 * nothing. Driving the real simulator is not a compromise here, it is the
 * only option, and it proves more: the real gesture path, the real adapter and
 * the real bridge.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCENARIO IS ALLOWED TO ASSERT, AND WHERE IT STOPS
 * ---------------------------------------------------------------------------
 * Both halves of INPUT-05 are here and they are different shapes:
 *
 *   the absence  a root DOUBLE-TAP must NOT exit (D-01). Every other scenario
 *                asserts this too, but they assert it where a false negative
 *                would be expensive; here it is free, because the very next
 *                step raises the dialogue on purpose.
 *   the presence an explicit Exit SELECTION must reach shutDownPageContainer(1).
 *
 * After the presence assertion the app is in the documented wedge and nothing
 * it logs is evidence of anything, so this scenario asserts nothing further,
 * captures no frame and attempts no recovery. Three recoveries were tried
 * upstream and all failed (D-02); a fourth here would be re-litigating a
 * closed question.
 */
import { REGIONS } from "../regions.ts";
import { expectConsoleClean, expectFrameInk, expectLoggedLine, expectNoLoggedLine } from "../assert.ts";
import {
  EXIT_CALL,
  defaultHighlightIndex,
  menuIndexOf,
  quiesce,
  selectMenuItem,
} from "./boot.ts";
import { returnToMainMenu } from "./battle.ts";
import type { Ctx, Scenario } from "../run.ts";
import { MENU_ITEM_IDS } from "../../src/config/constants.ts";

/** a main menu that has to be navigated back to is still only a few rebuilds away */
const MENU_MS = 60_000;

/**
 * The PRE-call log line in glassAdapter.exitApp(), matched deliberately.
 *
 * If the dialogue wedges the bridge the `-> <result>` promise may never settle
 * and the post-call line never arrives, so the post-call line must not be what
 * the proof depends on. The pre-call line means "validated, about to call".
 */
const EXIT_RAISED = /\[GlassAdapter\] shutDownPageContainer\(1\)/;

export const exitLastScenario: Scenario = {
  name: "exitLast",
  needsSim: true,
  async run(ctx) {
    // -- 1. find the root page ----------------------------------------------
    // keepLogs, for the reason battle's "menu" step gives: this step's job is
    // to find out WHERE the app is, and the only evidence is the `[screen]`
    // line a PREVIOUS step logged. reset() would delete it, returnToMainMenu
    // would see nothing rendered, and its blind-recovery branch would click --
    // which on MAIN_MENU starts a battle.
    //
    // Deliberately NO expectConsoleClean here: the buffer is inherited, so a
    // failure from the scenario before this one would be reported against
    // exitLast. Every step below starts from an empty buffer and judges only
    // its own lines.
    await ctx.step(
      "main-menu",
      async () => {
        await returnToMainMenu(ctx);
        const f = await ctx.waitScreen("MAIN_MENU", MENU_MS, 0);
        // Same floor as boot's: since 13.1-02 the main menu is ONE list row and
        // measures ~0.005 on CONTENT. A blank screen still scores 0 and fails.
        expectFrameInk(f, REGIONS.CONTENT, 0.002, 0.6);
      },
      { keepLogs: true },
    );

    // -- 2. D-01: the bare double-tap exits nothing --------------------------
    // The app is on MAIN_MENU because the step above proved it and no input has
    // been sent since. Fresh buffer on purpose: the assertion below is an
    // ABSENCE, and an absence is only worth anything over lines this step's own
    // input could have produced.
    await ctx.step("root-double-tap-does-not-exit", async () => {
      await ctx.press("double_click");
      await quiesce(ctx);
      await ctx.capture("after-root-double-tap");
      expectNoLoggedLine(
        ctx.logs,
        EXIT_CALL,
        "root double-tap called the exit dialogue directly — D-01 requires the dialogue to come from " +
          "an explicit Exit menu selection, never from a bare double-tap, because D-02 makes an " +
          "unintended one unrecoverable",
      );
      expectConsoleClean(ctx.logs);
    });

    // -- 3. INPUT-05, the whole reason this phase exists ---------------------
    await ctx.step("menu-exit-raises-the-dialogue", async () => {
      // `--only exitLast` never ran boot, so nothing has measured where the OS
      // highlight starts and commitMenuSelection refuses to navigate blind --
      // correctly, since the thing it would be guessing about is Exit. Measure
      // it the same way boot does, by committing on the default. Costs one
      // Battle Speed cycle, and nothing after this scenario reads the speed.
      if (defaultHighlightIndex() === null) await selectMenuItem(ctx, 0);

      // Watermark BEFORE the selection. The two lines below are emitted once
      // per selection, and the measurement above may have just logged a menu
      // click of its own.
      const mark = ctx.logs.nextSeq();

      // BY ID, never by position: menuIndexOf resolves where Exit currently
      // sits, so a Phase 17 menu edit moves this selection with it. allowExit
      // lifts the refusal that every other caller is held to -- narrowly, here,
      // in the scenario registered last (selfCheck 57 pins both halves).
      await selectMenuItem(ctx, menuIndexOf(MENU_ITEM_IDS.exit), { allowExit: true });

      // The controller ROUTED it as a menu selection rather than swallowing it
      // as a stray TAP (D6) or ignoring it as off-root (onMenuItem's
      // non-MAIN_MENU guard).
      expectLoggedLine(ctx.logs, /\[screen\] menu: Exit/, mark);
      // ...and the adapter reached the bridge. THE assertion this whole phase
      // exists for: the Even Hub submission requirement is that the root page
      // invokes the exit dialogue, and this is the only direct observation of
      // it in the repo.
      expectLoggedLine(ctx.logs, EXIT_RAISED, mark);

      // NOTHING BELOW THIS LINE. No expectConsoleClean, no capture: the app is
      // in the D-02 wedge now and anything it logs or draws from here is that
      // defect, not a new one. If a later reader is tempted to "fix" a failure
      // that appears after this point by adding a KNOWN_DEFECTS waiver, the fix
      // is to check this scenario is still LAST instead.
    });
  },
};
