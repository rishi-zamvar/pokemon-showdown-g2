/**
 * Scenario zero (needsSim: false).
 *
 * `npm run harness` proves its own primitives — PNG decode, ink/grey metrics,
 * region maths, the log failure policy, the assertion vocabulary, the Node
 * preflight — BEFORE it boots a simulator, so a broken decoder is never
 * reported as a broken app. run.ts refuses to start the stack if this fails.
 *
 * The checks themselves live in harness/selfCheck.ts, which is also runnable on
 * its own as `node harness/selfCheck.ts`. Both entry points call runChecks().
 */
import { runChecks } from "../selfCheck.ts";
import type { Scenario } from "../run.ts";

export const selfCheckScenario: Scenario = {
  name: "selfCheck",
  needsSim: false,
  async run(ctx) {
    const results = await runChecks();
    await ctx.step(`harness primitives (${results.length} checks)`, async () => {
      const bad = results.filter((r) => !r.ok);
      if (bad.length > 0) {
        throw new Error(
          `${bad.length}/${results.length} primitive check(s) failed:\n${bad
            .map((b) => `  ${b.name}: ${b.error}`)
            .join("\n")}`,
        );
      }
    });
  },
};
