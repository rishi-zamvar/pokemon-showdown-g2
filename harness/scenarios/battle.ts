/**
 * HARN-04 -- the scripted end-to-end battle.
 *
 * boot -> main menu -> battle -> attack -> voluntary switch -> forced switch
 * after a faint -> win/loss end screen, unattended, pass/fail per step.
 *
 * `runBattleScript()` is the EXPORT that matters. The ROADMAP builds Phases 13,
 * 14, 17 and 19 on it by name ("expectConsoleClean() across runBattleScript()",
 * "golden-frame diffs captured at fixed turns inside runBattleScript()", ...),
 * so it is a parameterised function with an `onTurn` hook rather than a private
 * scenario body. `battleScenario` is a thin wrapper that adds the coverage
 * assertions, which live OUTSIDE runBattleScript so a Phase 14 caller can run
 * `{ maxTurns: 5 }` without tripping assertions it never intended (B7).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS AT NORMAL SPEED, NOT INSTANT  (read before "optimising" it)
 * ---------------------------------------------------------------------------
 * The plan says to cycle the main menu to Instant first. Measured on the real
 * app this session, that is not reachable and would not be observable:
 *
 *   harness-01  FIXED by 13.1-02 -- kept because the quirk behind it is still
 *               live and still the reason select(0, true) exists. Zero list
 *               indices are undeliverable: the simulator omits
 *               `currentSelectItemIndex` from listEvent when the selection is 0
 *               (the same zero-dropping quirk the app already documents for
 *               CLICK_EVENT=0), so glassAdapter.mapEventToGesture hands
 *               ScreenController `listIndex: undefined` and onTap falls back to
 *               `state.cursorIndex`. handleMainMenu used to set cursorIndex=1
 *               when it cycled the speed -- so after ONE speed change, every
 *               further click cycled the speed again and "Enter Battle" became
 *               unreachable. Verified live: Normal->Fast->Instant->Slow->Normal
 *               from four clicks with `up` pressed in between. 13.1-02 removed
 *               the state rather than guarding it: Battle Speed and About moved
 *               into the root context menu, the list is one row, cursorIndex
 *               never leaves 0 and the fallback is always right. Which is also
 *               why `speed` other than Normal now THROWS here -- there is no
 *               list row left to click.
 *   harness-02  In Instant mode resolveTurn():530 and resolveSwitch():611 call
 *               glass.showText() and `return` WITHOUT going through render(),
 *               and render() is where the `[screen] <NAME>` oracle is logged.
 *               So Instant produces no `[screen] TURN_RESULT` line at all and
 *               waitScreen("TURN_RESULT") can only ever time out.
 *
 * Both are app defects; Phase 12 observes and does not fix (see the phase
 * boundary in 12-CONTEXT). Normal is the app's default and the only speed
 * reachable through its own UI, and it is also the BETTER-observed path: at
 * Normal there is no TURN_RESULT screen at all -- resolveTurn falls through to
 * transitionAfterTurn():628, which render()s BATTLE_HUD / SWITCH_SELECT /
 * END_SCREEN directly, so every transition in the loop has a real oracle line
 * and no blind tap is needed.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY WAIT TAKES A WATERMARK  (B4)
 * ---------------------------------------------------------------------------
 * A whole turn is one ctx.step(), so the console buffer still holds the
 * `[screen]` line from the top of the turn when the end-of-turn wait runs. A
 * substring scan over logs.all() would match that stale line instantly, `next`
 * would be BATTLE_HUD forever, sawForcedSwitch/finished would never become true
 * and the run would burn every turn of maxTurns and fail at `end-screen`. So
 * every wait here takes `ctx.logs.nextSeq()` captured BEFORE the input that
 * should cause the transition, and considers only lines with `seq >= from`.
 */
import { waitFor } from "../driver.ts";
import { REGIONS } from "../regions.ts";
import { AssertionError, expectConsoleClean, expectFrameInk, expectScreen } from "../assert.ts";
import { quiesce } from "./boot.ts";
import type { Ctx, Scenario } from "../run.ts";
import type { ScreenName } from "../../src/screens/ScreenState.ts";

/** moves the SIMULATOR's list selection; `force` re-homes even if it looks right */
type Select = (index: number, force?: boolean) => Promise<void>;

// ---------------------------------------------------------------------------
// contract for Phases 13/14/17/19
// ---------------------------------------------------------------------------

export interface BattleScriptOpts {
  /**
   * Only "Normal" is implemented -- see harness-01/harness-02 in the file
   * header. "Fast"/"Instant" throw a message naming the defect rather than
   * timing out 25 seconds later with no explanation.
   */
  speed?: "Normal" | "Fast" | "Instant";
  /** default 60. A battle that needs more turns than this is a stall, not a game. */
  maxTurns?: number;
  /** first turn on which to attempt the voluntary switch; null disables it. default 3. */
  switchOnTurn?: number | null;
  /** called at the END of every turn, inside that turn's ctx.step */
  onTurn?: (turn: number, ctx: Ctx) => Promise<void>;
}

export interface BattleOutcome {
  turns: number;
  /** reached END_SCREEN */
  finished: boolean;
  sawVoluntarySwitch: boolean;
  sawForcedSwitch: boolean;
  hostCallsByTurn: Record<number, Record<string, number>>;
}

/** entering a battle generates two teams, loads match data and fetches sprites */
const ENTER_BATTLE_MS = 120_000;
/** a Normal-speed turn measured at 8-40s; a stall must still fail, not hang forever */
const TURN_MS = 120_000;
const MENU_MS = 30_000;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Wait until the app logs any one of `names` AT OR AFTER the `from` watermark,
 * and return whichever won.
 *
 * `from` is a REQUIRED positional parameter on purpose: a defaulted watermark
 * would be wrong at exactly the call site that matters (B4). After a move
 * resolves the app may route to BATTLE_HUD, SWITCH_SELECT (forced) or
 * END_SCREEN and the harness cannot know which in advance, which is why this
 * exists at all rather than three separate waitScreen calls.
 */
export async function waitAnyScreen(
  ctx: Ctx,
  names: ScreenName[],
  from: number,
  timeoutMs = 25_000,
): Promise<ScreenName> {
  return waitFor(
    async () => {
      await ctx.logs.poll();
      for (const l of ctx.logs.all()) {
        if (l.seq < from) continue;
        for (const n of names) if (l.message.includes(`[screen] ${n}`)) return n;
      }
      return null;
    },
    { what: `any of [${names.join(" | ")}] after seq ${from}`, timeoutMs, pollMs: 200 },
  );
}

/**
 * The item labels of the most recent list the simulator was asked to draw.
 *
 * Read off the simulator's own `RebuildPageContainer ... item_name: Some([...])`
 * stdout line -- the same tee HARN-02 depends on. This is NOT screen-scraping
 * (D-10 rules out reading pixels); it is the payload the app sent, echoed back.
 *
 * It is load-bearing for switch selection: renderSwitchSelect() keeps FAINTED
 * teammates in the list with `indexMap[-1]`, and handleSwitchSelect():~289
 * `return`s SILENTLY on a -1. Clicking a fainted entry therefore deadlocks the
 * app on SWITCH_SELECT with no log line of any kind -- observed live on a
 * forced switch whose list was ["Gogoat 0% (fainted)", "Golurk 100%", ...].
 */
function lastListItems(ctx: Ctx, from: number): string[] | null {
  let items: string[] | null = null;
  for (const l of ctx.logs.all()) {
    if (l.seq < from || l.source !== "stdout") continue;
    const parsed = parseListItems(l.message);
    if (parsed) items = parsed;
  }
  return items;
}

/** The pure half of lastListItems, so selfCheck can pin it without a simulator. */
export function parseListItems(message: string): string[] | null {
  const m = /item_name: Some\((\[.*?\])\)/.exec(message);
  if (!m) return null;
  return [...m[1]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((g) => g[1]!);
}

/**
 * Display index of the first entry renderSwitchSelect will actually accept, or
 * -1 when every one of them is fainted (which is a deadlocked app, not a
 * choice -- see the SWITCH_SELECT note on lastListItems).
 */
export function firstSelectable(items: string[]): number {
  return items.findIndex((i) => !i.includes("(fainted)"));
}

/**
 * Move the SIMULATOR's list selection to `index`.
 *
 * Two measured facts this rides on:
 *   - the selection persists across RebuildPageContainer, so it is NOT safe to
 *     assume it is 0 at the top of a screen;
 *   - `up` CLAMPS at the top rather than wrapping (verified: two `up`s from
 *     index 0 on the 3-item main menu still clicked index 0), so homing by
 *     over-pressing `up` is exact.
 * Hence: home with 6 `up`s (no list in this app is longer than 6), then step
 * down. Only called when the target is not where we already are.
 */
function makeSelector(ctx: Ctx): (index: number, force?: boolean) => Promise<void> {
  let at = 0;
  return async (index: number, force = false): Promise<void> => {
    if (at === index && !force) return;
    for (let i = 0; i < 6; i++) await ctx.press("up");
    for (let i = 0; i < index; i++) await ctx.press("down");
    at = index;
  };
}

/**
 * Wait for a simulator STDOUT line matching `re` at or after `from`.
 *
 * Needed because two screens this script has to see are rendered WITHOUT going
 * through ScreenController.render(), so they log no `[screen]` oracle line at
 * all: the About text (ScreenController.onMenuItem, reached from the root
 * context menu since 13.1-02) and, in Instant mode, the TURN_RESULT text
 * (resolveTurn / resolveSwitch). The simulator echoes
 * the container payload it was handed, so the app's own UI strings are still
 * observable -- on the HARN-02 tee, not on /api/console.
 */
async function waitStdout(ctx: Ctx, re: RegExp, from: number, timeoutMs: number): Promise<void> {
  await waitFor(
    async () => {
      await ctx.logs.poll();
      return ctx.logs.all().some((l) => l.seq >= from && l.source === "stdout" && re.test(l.message))
        ? true
        : null;
    },
    { what: `simulator stdout line matching ${re} after seq ${from}`, timeoutMs, pollMs: 200 },
  );
}

/**
 * The most recent screen the app rendered at or after `from`, or null.
 *
 * `from` matters after the first round of ensureMainMenu: once an input has
 * been sent, a `[screen]` line from before it describes where the app WAS, and
 * trusting it would report success while the app sat somewhere else (B4 again,
 * in a different costume).
 */
function lastScreen(ctx: Ctx, from: number): ScreenName | null {
  let found: ScreenName | null = null;
  for (const l of ctx.logs.all()) {
    if (l.seq < from) continue;
    const m = /\[screen\] ([A-Z_]+)/.exec(l.message);
    if (m) found = m[1] as ScreenName;
  }
  return found;
}

/**
 * Drive the app back to MAIN_MENU from wherever the previous scenario left it.
 *
 * `boot` fires all seven input actions in a row and deliberately does NOT
 * navigate back afterwards, because glassAdapter.mapEventToGesture:632 turns
 * every unknown eventType into a TAP, so long_press / long_press_release /
 * context_menu each commit a move and the storm stops on a different screen
 * every run (deferred item D6). The suite shares ONE simulator process, so the
 * battle scenario cannot assume a cold main menu -- measured: `battle / menu`
 * timing out after 120s on the first full-suite run.
 *
 * Screen-directed rather than a fixed key sequence, because no fixed sequence
 * terminates from every screen: a blind `click, double, double` loops forever
 * between BATTLE_HUD and ATTACK_SELECT (the click re-opens what the double-tap
 * just backed out of). Each branch below strictly reduces the distance home:
 * ATTACK/SWITCH -> BATTLE_HUD -> (double-tap twice = forfeit) -> MAIN_MENU.
 */
async function ensureMainMenu(ctx: Ctx, select: Select): Promise<void> {
  // Round 0 reads the whole buffer, because on a cold `--only battle` run the
  // app really is on the main menu and the boot's `[screen] MAIN_MENU` line is
  // the only evidence of it. Every later round reads only what arrived after
  // its own inputs.
  let from = 0;
  for (let i = 0; i < 10; i++) {
    // lets an in-flight ANIMATING turn finish; ANIMATING never renders, so
    // there is nothing to observe until it does.
    await quiesce(ctx, 6000);
    const here = lastScreen(ctx, from);
    if (here === "MAIN_MENU") return;

    // BEFORE this round's inputs, never after: press() polls the console, so a
    // watermark taken afterwards can already be past the line the input caused.
    from = ctx.logs.nextSeq();
    switch (here) {
      case "ATTACK_SELECT":
        await ctx.press("double_click"); // -> BATTLE_HUD
        break;
      case "SWITCH_SELECT": {
        // double-tap is BLOCKED on a forced switch (onDoubleTap:149), so pick a
        // Pokemon instead -- and never a fainted one, which is a silent no-op.
        const items = lastListItems(ctx, 0);
        const idx = items ? firstSelectable(items) : 0;
        await select(Math.max(idx, 0));
        await ctx.press("click");
        break;
      }
      case "BATTLE_HUD":
        // first double-tap arms the forfeit, second one commits it and renders
        // MAIN_MENU with cursorIndex 0 (onDoubleTap:154-166)
        await ctx.press("double_click");
        await ctx.press("double_click");
        break;
      case "END_SCREEN":
        await select(1); // "Main Menu"
        await ctx.press("click");
        break;
      default:
        // null (nothing rendered since the last console reset) or TURN_RESULT:
        // a double-tap is inert on MAIN_MENU / TURN_RESULT / END_SCREEN, so try
        // it first and only tap if that revealed nothing.
        await ctx.press("double_click");
        await ctx.press("double_click");
        await quiesce(ctx, 4000);
        if (lastScreen(ctx, from) === "MAIN_MENU") return;
        if (lastScreen(ctx, from) === null) await ctx.press("click");
        break;
    }
    await select(0, true);
  }
  throw new AssertionError(
    `could not get the app back to MAIN_MENU in 10 recovery rounds (last screen seen: ${lastScreen(ctx, 0)}). The battle script needs a main menu to start from, and the boot scenario's seven-input storm leaves the app somewhere unpredictable (D6).`,
  );
}

// ---------------------------------------------------------------------------
// the script
// ---------------------------------------------------------------------------

export async function runBattleScript(ctx: Ctx, opts: BattleScriptOpts = {}): Promise<BattleOutcome> {
  const speed = opts.speed ?? "Normal";
  const maxTurns = opts.maxTurns ?? 60;
  const switchOnTurn = opts.switchOnTurn === undefined ? 3 : opts.switchOnTurn;
  const instant = speed === "Instant";
  const select = makeSelector(ctx);

  const outcome: BattleOutcome = {
    turns: 0,
    finished: false,
    sawVoluntarySwitch: false,
    sawForcedSwitch: false,
    hostCallsByTurn: {},
  };

  // -- 1. main menu ---------------------------------------------------------
  // keepLogs + since 0: the subject is the boot, which finished before this
  // step began; D-04's console clear would delete the very line we wait for.
  await ctx.step(
    "menu",
    async () => {
      // The suite shares one simulator, and `boot` leaves the app mid-battle.
      // No-op on a cold run, where MAIN_MENU is already the first thing logged.
      await ensureMainMenu(ctx, select);
      const f = await ctx.waitScreen("MAIN_MENU", ENTER_BATTLE_MS, 0);
      // 0.002, not 0.01 -- the same recalibration as the end-screen step below
      // and boot.ts's boot step. Since 13.1-02 the main menu is ONE list row
      // ("Enter Battle") and is now the sparsest screen in the app, sparser
      // than END_SCREEN: measured 0.0046 on CONTENT. The old 0.01 floor was
      // set against the three-row list and fails with "ink 0.005 outside
      // [0.01, 0.6]". A blank screen still scores exactly 0 and still fails.
      expectFrameInk(f, REGIONS.CONTENT, 0.002, 0.6);
      expectConsoleClean(ctx.logs);
    },
    { keepLogs: true },
  );

  // -- 2. speed -------------------------------------------------------------
  await ctx.step("set-speed", async () => {
    // Normal is SpeedConfig's value on every app open, so there is nothing to
    // do -- and nothing to undo, which is why it is the default here.
    if (speed !== "Normal") {
      // 13.1-02 moved Battle Speed off the main-menu LIST and into the root
      // context menu, so there is no list row to click any more: the menu is
      // an OS affordance driven by POST /api/input {"action":"context_menu"}.
      // The old body clicked list item 1; on today's one-row menu that click
      // resolves to item 0 and ENTERS A BATTLE, then waits 30s for a MAIN_MENU
      // that is never coming. Throw instead of failing 30s later with a
      // misleading message. The menu vocabulary this needs is plan 13.1-03's.
      throw new AssertionError(
        `speed "${speed}" is not reachable from this script. 13.1-02 moved Battle Speed into the root context menu; driving it needs the context_menu vocabulary from 13.1-03. Also see harness-02 in the file header: Instant renders TURN_RESULT without render(), so it logs no [screen] oracle at all.`,
      );
    }
    expectConsoleClean(ctx.logs);
  });

  // -- 3. enter battle ------------------------------------------------------
  await ctx.step("enter-battle", async () => {
    // FORCED home. Since 13.1-02 the main menu is a single row, so boot's
    // seven-input storm can no longer park the selection on a row that cycles
    // the speed -- but re-homing still costs nothing and keeps the tracker
    // honest across a screen it did not draw.
    await select(0, true);
    const w = ctx.logs.nextSeq();
    await ctx.press("click");
    const f = await ctx.waitScreen("BATTLE_HUD", ENTER_BATTLE_MS, w);
    // The HUD's action list is a brand new container; re-home rather than
    // trusting the tracker across the screen change.
    await select(0, true);
    // A blank action list here is defect #2 from the research doc: one
    // oversized container takes the whole rebuildPageContainer down and the
    // player is left with a HUD they cannot act on.
    expectFrameInk(f, REGIONS.LIST, 0.01, 0.6);
    expectFrameInk(f, REGIONS.PLAYER_COMPOSITE, 0.01, 0.95);
    expectFrameInk(f, REGIONS.OPP_COMPOSITE, 0.01, 0.95);
    expectConsoleClean(ctx.logs);
  });

  // -- 4. turns -------------------------------------------------------------
  // No waitScreen("BATTLE_HUD") at the top of a turn: the previous iteration
  // already waited for and identified BATTLE_HUD, and this step's logs.reset()
  // has since deleted that line, so re-waiting for it could only ever hang.
  for (let turn = 1; turn <= maxTurns; turn++) {
    let ended = false;

    await ctx.step(`turn-${turn}`, async () => {
      let next: ScreenName;

      const wantVoluntary =
        switchOnTurn !== null && turn >= switchOnTurn && !outcome.sawVoluntarySwitch;

      next = wantVoluntary
        ? await voluntarySwitchOrAttack(ctx, select, outcome, instant)
        : await attack(ctx, select, instant);

      // A faint routes the app to SWITCH_SELECT with `MUST SWITCH` in the
      // status; the script did not press Switch this iteration, so this is the
      // forced switch HARN-04 requires.
      if (next === "SWITCH_SELECT") {
        next = await resolveSwitchList(ctx, select, "forced", instant);
        outcome.sawForcedSwitch = true;
      }

      // D-09. waitAnyScreen is a pure log wait and saves nothing, so without
      // this a turn's resulting screen leaves no artifact and "flip through the
      // PNGs and watch the HP go down" -- the only check that proves the
      // harness is driving a real battle rather than pressing into the void --
      // has nothing to flip through.
      await ctx.capture(`turn-${turn}-${next}`);

      outcome.turns = turn;
      if (next === "END_SCREEN") {
        outcome.finished = true;
        ended = true;
      }

      // read BEFORE the step ends -- the next step's reset() clears the console
      outcome.hostCallsByTurn[turn] = ctx.logs.hostCalls();
      await opts.onTurn?.(turn, ctx);
      // HARN-05 for every turn of a real battle, not just at boot. This is the
      // assertion that catches a container-validation line appearing on turn 17.
      expectConsoleClean(ctx.logs);
    });

    if (ended) break;
  }

  // -- 5. end screen --------------------------------------------------------
  // keepLogs: the [screen] END_SCREEN line was logged inside the last turn's
  // step, and a reset() here would delete the evidence expectScreen needs.
  await ctx.step(
    "end-screen",
    async () => {
      if (!outcome.finished) {
        throw new AssertionError(
          `battle did not reach END_SCREEN within ${maxTurns} turns. A run that burns every turn is the signature of a missing seq watermark (B4) -- a stale [screen] line matching instantly makes every turn report BATTLE_HUD and END_SCREEN unreachable -- not of a long battle. Check that every wait passes a watermark taken BEFORE its input.`,
        );
      }
      expectScreen(ctx.logs, "END_SCREEN");
      const f = await ctx.capture("end-screen");
      // 0.002, not 0.01: END_SCREEN is the sparsest screen in the app -- two
      // short list items and a one-word status. Measured 0.006 on a real loss
      // (artifact battle-039-end-screen.png, "New Battle" / "Main Menu" /
      // "Defeat..."). A blank screen still scores exactly 0 and still fails.
      expectFrameInk(f, REGIONS.CONTENT, 0.002, 0.6);
      expectConsoleClean(ctx.logs);
    },
    { keepLogs: true },
  );

  return outcome;
}

/** BATTLE_HUD item 0 = Attack, then move 0, then whatever the turn routes to. */
async function attack(ctx: Ctx, select: Select, instant: boolean): Promise<ScreenName> {
  await select(0);
  let w = ctx.logs.nextSeq();
  await ctx.press("click");
  const f = await ctx.waitScreen("ATTACK_SELECT", MENU_MS, w);
  expectFrameInk(f, REGIONS.LIST, 0.01, 0.6);

  w = ctx.logs.nextSeq();
  await ctx.press("click");
  return advance(ctx, w, instant);
}

/**
 * Where a resolved action lands.
 *
 * At Normal/Fast the app falls through resolveTurn to transitionAfterTurn,
 * which render()s the next decision screen directly -- one wait, one oracle.
 * At Instant it stops on TURN_RESULT and needs a tap, and TURN_RESULT has no
 * `[screen]` line because the instant branch never calls render(), so the
 * simulator's echo of the "Tap to continue" status bar is the oracle.
 */
async function advance(ctx: Ctx, w: number, instant: boolean): Promise<ScreenName> {
  if (!instant) return waitAnyScreen(ctx, ["BATTLE_HUD", "SWITCH_SELECT", "END_SCREEN"], w, TURN_MS);
  await waitStdout(ctx, /Tap to continue/, w, TURN_MS);
  const w2 = ctx.logs.nextSeq();
  await ctx.press("click");
  return waitAnyScreen(ctx, ["BATTLE_HUD", "SWITCH_SELECT", "END_SCREEN"], w2, TURN_MS);
}

/**
 * BATTLE_HUD item 1 = Switch. handleBattleHud():234 `return`s SILENTLY when the
 * active Pokemon is trapped, so a failed attempt is a timeout with no log line.
 * That is a legal battle state, not a defect, so fall back to attacking and let
 * the next turn try again (`turn >= switchOnTurn && !sawVoluntarySwitch`).
 */
async function voluntarySwitchOrAttack(
  ctx: Ctx,
  select: Select,
  outcome: BattleOutcome,
  instant: boolean,
): Promise<ScreenName> {
  await select(1);
  const w = ctx.logs.nextSeq();
  await ctx.press("click");
  try {
    await ctx.waitScreen("SWITCH_SELECT", MENU_MS, w);
  } catch {
    console.log(
      `      note: Switch was refused (trapped active Pokemon -- handleBattleHud returns silently); attacking instead and retrying the voluntary switch next turn`,
    );
    return attack(ctx, select, instant);
  }
  const next = await resolveSwitchList(ctx, select, "voluntary", instant);
  outcome.sawVoluntarySwitch = true;
  return next;
}

/** On SWITCH_SELECT: pick the first entry the app will actually accept. */
async function resolveSwitchList(
  ctx: Ctx,
  select: Select,
  kind: "voluntary" | "forced",
  instant: boolean,
): Promise<ScreenName> {
  const items = lastListItems(ctx, 0);
  if (items === null || !items.every((i) => i.includes("%"))) {
    throw new AssertionError(
      `on SWITCH_SELECT but could not read the switch list off the simulator stdout tee (last list seen: ${JSON.stringify(items)}). Without it the script cannot avoid the fainted entries, which deadlock the app silently.`,
    );
  }
  const index = firstSelectable(items);
  if (index < 0) {
    throw new AssertionError(
      `${kind} switch with no selectable Pokemon: every entry is fainted (${JSON.stringify(items)}). handleSwitchSelect returns silently on all of them, so the app is deadlocked on SWITCH_SELECT.`,
    );
  }
  await select(index);
  const w = ctx.logs.nextSeq();
  await ctx.press("click");
  return advance(ctx, w, instant);
}

// ---------------------------------------------------------------------------
// the default scenario
// ---------------------------------------------------------------------------

export const battleScenario: Scenario = {
  name: "battle",
  needsSim: true,
  async run(ctx) {
    const outcome = await runBattleScript(ctx);

    // Coverage lives HERE, not in runBattleScript, so a Phase 14/17 caller can
    // run `{ maxTurns: 5 }` without tripping assertions it never intended (B7).
    await ctx.step("coverage", async () => {
      if (!outcome.sawVoluntarySwitch) {
        throw new AssertionError(
          `HARN-04 half unexercised: no VOLUNTARY switch happened in ${outcome.turns} turns. Either the active Pokemon was trapped on every turn from switchOnTurn onward, or BATTLE_HUD item 1 never reached the app.`,
        );
      }
      if (!outcome.sawForcedSwitch) {
        throw new AssertionError(
          `HARN-04 half unexercised: no FORCED switch after a faint was detected in ${outcome.turns} turns. A 6v6 randbats battle always faints Pokemon before a winner, so this means the script never SAW one -- check the seq watermark on the post-move wait (B4).`,
        );
      }
    });

    // Proves the loop closes and leaves the app re-runnable.
    await ctx.step("back-to-menu", async () => {
      const select = makeSelector(ctx);
      await select(1); // END_SCREEN item 1 = "Main Menu"
      const w = ctx.logs.nextSeq();
      await ctx.press("click");
      await ctx.waitScreen("MAIN_MENU", MENU_MS, w);
      expectConsoleClean(ctx.logs);
    });
  },
};
