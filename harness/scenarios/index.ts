/**
 * The scenario registry, in execution order.
 *
 * Order matters and is not alphabetical:
 *   1. selfCheck  — needsSim: false. Proves the harness's own primitives before
 *      it boots anything, so a broken decoder is never reported as a broken app.
 *   2. boot       — cold boot to MAIN_MENU, enter battle, all seven inputs.
 *   3. negativeProof — must run AFTER boot (it needs a screen up, and it needs
 *      the stdout tee to have seen real traffic).
 *
 * `harness/probe.ts` is deliberately NOT here: it is a standalone connectivity
 * probe, so nothing it does counts toward a suite requirement.
 */
import type { Scenario } from "../run.ts";

export const SCENARIOS: Scenario[] = [];
