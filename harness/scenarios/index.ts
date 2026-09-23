/**
 * The scenario registry, in execution order.
 *
 * Order matters and is not alphabetical:
 *   1. selfCheck  — needsSim: false. Proves the harness's own primitives before
 *      it boots anything, so a broken decoder is never reported as a broken app.
 *   2. boot       — cold boot to MAIN_MENU, enter battle, all seven inputs.
 *   3. negativeProof — must run AFTER boot (it needs a screen up, and it needs
 *      the stdout tee to have seen real traffic).
 *   4. battle     — by far the longest (a full Normal-speed battle runs
 *      minutes), so everything cheap that could fail has already failed by the
 *      time it starts, and it leaves the app back on MAIN_MENU.
 *   5. exitLast   — LAST, and it must stay last: it is the only scenario
 *      permitted to raise the exit dialogue, which wedges every image send for
 *      the rest of the session (D-02). Nothing follows it, so there is nothing
 *      left for the wedge to poison. selfCheck 57 enforces the position.
 *
 * `harness/probe.ts` is deliberately NOT here: it is a standalone connectivity
 * probe, so nothing it does counts toward a suite requirement.
 */
import type { Scenario } from "../run.ts";
import { selfCheckScenario } from "./selfCheck.ts";
import { bootScenario } from "./boot.ts";
import { negativeProofScenario } from "./negativeProof.ts";
import { battleScenario } from "./battle.ts";
import { exitLastScenario } from "./exitLast.ts";

export const SCENARIOS: Scenario[] = [
  selfCheckScenario,
  bootScenario,
  negativeProofScenario,
  battleScenario,
  exitLastScenario,
];
