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
import { AssertionError, expectConsoleClean, expectFrameInk } from "../assert.ts";
import type { Scenario } from "../run.ts";

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

      // The proof needs a target that is known-blank RIGHT NOW. TEAM_BAR only
      // exists on the overlay battle screens, so it is blank on the main menu —
      // but assert that rather than assume it, or a non-blank target would turn
      // this proof into a tautology.
      const ink = inkRatio(frame, REGIONS.TEAM_BAR);
      if (ink >= 0.005) {
        throw new AssertionError(
          `TEAM_BAR is not blank (ink ${ink.toFixed(
            3,
          )}), so this scenario has no known-blank target and cannot prove anything. Expected the app to be on MAIN_MENU.`,
        );
      }

      let threw: unknown;
      try {
        expectFrameInk(frame, REGIONS.TEAM_BAR, 0.2, 1.0);
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
