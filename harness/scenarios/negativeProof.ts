/**
 * The scenario that makes every other scenario trustworthy.
 *
 * A harness whose assertions always pass is worse than no harness: it converts
 * "we have not looked" into "it is fine". So this scenario deliberately asserts
 * things that MUST fail, and fails the run when they do not.
 *
 * Two proofs:
 *   1. HARN-03 — expectFrameInk demands ink in a region that is genuinely blank
 *      on the live framebuffer. If it passes, every framebuffer assertion in
 *      the suite is decoration.
 *   2. HARN-02 — the simulator stdout tee is alive AND its lines reach the same
 *      failure path console lines do. Both halves are required: the injection
 *      test alone passes identically against a completely dead tee, because the
 *      harness injects the line itself.
 *
 * Runs AFTER boot.ts: it needs a screen up and a tee that has seen traffic.
 */
import { REGIONS } from "../regions.ts";
import { inkRatio } from "../frame.ts";
import type { Frame, Region } from "../frame.ts";
import { AssertionError, expectConsoleClean, expectFrameInk } from "../assert.ts";
import type { Scenario } from "../run.ts";

/** a region counts as blank for this proof below this ink ratio */
const BLANK = 0.005;

/**
 * A region of the LIVE frame that is measured blank right now.
 *
 * TEAM_BAR first, because that is the documented target: the team bar only
 * exists on the overlay battle screens, so it reads blank on the main menu.
 * But boot.ts deliberately leaves the app wherever its seven-input storm ended
 * (see the comment there), and depending on that screen made this scenario
 * flaky — it failed with "TEAM_BAR is not blank (ink 0.046)" on one run in
 * three. So: fall back to the first 48x48 block of the real framebuffer that
 * measures blank, and name whichever target was used in the output.
 *
 * Either way the proof is the same and it is live: a region this run MEASURED
 * as blank, asserted to have ink, must throw.
 */
function blankTarget(f: Frame): { region: Region; via: string } {
  if (inkRatio(f, REGIONS.TEAM_BAR) < BLANK) {
    return { region: REGIONS.TEAM_BAR, via: "REGIONS.TEAM_BAR" };
  }
  const S = 48;
  for (let y = 0; y + S <= f.height; y += S) {
    for (let x = 0; x + S <= f.width; x += S) {
      const region: Region = { name: `BLANK_BLOCK_${x}_${y}`, x, y, w: S, h: S };
      if (inkRatio(f, region) < BLANK) return { region, via: `a measured-blank ${S}x${S} block` };
    }
  }
  throw new AssertionError(
    `every ${S}x${S} block of the live frame has ink, so this scenario has no known-blank target and cannot prove anything (TEAM_BAR ink ${inkRatio(
      f,
      REGIONS.TEAM_BAR,
    ).toFixed(3)})`,
  );
}

/** the real line the simulator emits when a container exceeds the firmware cap */
const CONTAINER_VALIDATION_LINE =
  "[2026-01-01T00:00:00Z WARN evenhub_simulator_lib::flutter] RebuildPageContainer validation failed: image container size 576x24 exceeds maximum 288x144";

export const negativeProofScenario: Scenario = {
  name: "negativeProof",
  needsSim: true,
  async run(ctx) {
    // -- 1. a blank region must fail an ink assertion (HARN-03) -------------
    await ctx.step("blank-region-must-fail", async () => {
      const frame = await ctx.capture("negative-proof-subject");

      // The proof needs a target measured blank RIGHT NOW — assuming it would
      // turn the whole thing into a tautology.
      const { region, via } = blankTarget(frame);
      const ink = inkRatio(frame, region);
      console.log(`      negative proof target: ${region.name} via ${via}, ink ${ink.toFixed(3)}`);

      let threw: unknown;
      try {
        expectFrameInk(frame, region, 0.2, 1.0);
      } catch (e) {
        threw = e;
      }
      if (!(threw instanceof AssertionError)) {
        throw new Error(
          `ASSERTION SELF-PROOF FAILED: expectFrameInk passed on a blank region -- every framebuffer assertion in this suite is meaningless (observed ink ${ink.toFixed(
            3,
          )}, threw: ${threw === undefined ? "nothing" : String(threw)})`,
        );
      }
    });

    // -- 2a. the tee is alive (HARN-02, half one) ---------------------------
    await ctx.step("harn02-tee-is-alive", async () => {
      // stdoutLineCount, NOT logs.all().some(source === "stdout"): ctx.step()
      // calls logs.reset() at the start of every step, which clears the line
      // buffer on purpose. The counter is monotonic for exactly this reason
      // (selfCheck 29), so it is the only honest liveness signal here.
      if (ctx.logs.stdoutLineCount === 0) {
        throw new AssertionError(
          "HARN-02 NOT MET: no line from the simulator stdout tee has been seen, so the injection test below would pass against a dead tee and prove nothing.",
        );
      }
    });

    // -- 2b. the classifier is wired to the failure path (half two) ---------
    await ctx.step("harn02-stdout-reaches-the-failure-path", async () => {
      expectConsoleClean(ctx.logs); // clean before, or the proof is confounded

      ctx.logs.pushStdout(CONTAINER_VALIDATION_LINE);

      let threw: unknown;
      try {
        expectConsoleClean(ctx.logs);
      } catch (e) {
        threw = e;
      }
      if (!(threw instanceof AssertionError)) {
        throw new Error(
          `ASSERTION SELF-PROOF FAILED: expectConsoleClean passed with a container-validation line on the stdout stream -- HARN-02 is not wired to the failure path (threw: ${
            threw === undefined ? "nothing" : String(threw)
          })`,
        );
      }

      // Drop the injected line so it does not fail the run's implicit
      // end-of-scenario expectConsoleClean. reset() deliberately leaves
      // stdoutLineCount intact, so this does not forge tee liveness for anyone.
      await ctx.logs.reset();
    });

    // The end-to-end version — a genuinely oversized container declared in src/
    // and reverted — stays a human-verify step in plan 12-04, because it means
    // editing the app.
  },
};
