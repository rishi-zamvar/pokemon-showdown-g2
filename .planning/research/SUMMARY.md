# Project Research Summary

**Project:** Pokemon Showdown G2 — v1.1 UI Enhancement & Polish
**Domain:** Smart glasses battle client UI enhancement (Even Realities G2, monochrome display, gesture navigation)
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

Pokemon Showdown G2 is a working battle client for the Even Realities G2 smart glasses. The v0.1 core — battle engine, animations, AI opponent, sprite rendering — is complete and functional. The v1.1 milestone is a UI polish pass that closes the gap between the current glasses experience and the web Showdown client: consolidated menus, animation speed controls, a stats screen, attack movement animation, and cleaner double-tap navigation. This is not a greenfield build; it is precision surgery on a working system.

The recommended implementation approach requires no new npm dependencies. Every feature is achievable by modifying and extending existing TypeScript modules. The binding hardware constraint is the G2 SDK's 4-container-per-page limit, which drives every layout decision in this milestone. Features that require both sprite containers and a list container simultaneously (attack and switch screens showing HP bars alongside sprites) are at risk of SDK-level infeasibility and require hardware verification before committing to that layout. The safe fallback for those screens is HP info compressed into the status bar string, which delivers information parity without the container risk.

The top three risks for this milestone are: (1) silently exceeding the 4-container SDK limit — the SDK discards extra containers without errors and behavior differs between browser and on-device, making this hard to catch without a real device test; (2) breaking list index mappings when removing the `< Back` item and adding new menu options — the renderer and ScreenController handler have no enforced contract; and (3) the Stats screen requiring data fields (stat boosts, ability) not currently in `BattleState` — the renderer cannot be written until `SimBattleAdapter` is updated to expose this data. All three risks have clear, specific prevention strategies documented in PITFALLS.md.

---

## Key Findings

### Recommended Stack

No new npm dependencies are needed for v1.1. The existing stack — `@evenrealities/even_hub_sdk`, `@pkmn/sim`, `@pkmn/randoms`, `@smogon/calc`, `vite`, and `typescript` — already provides every primitive required. Animation speed control is a mutable module-level multiplier applied at call sites in `AnimationEngine.ts`. The Stats screen reads from `SimBattleAdapter.getBattle()` (already public) and `DataLoader` (already loaded). The attack lunge animation reuses `shiftSpriteBmp()` which already exists in `AnimationEngine.ts` for the switch-in slide. Speed persistence uses `localStorage`, which is already used by the sprite cache in v0.1.

**Core technologies:**
- `@evenrealities/even_hub_sdk ^0.0.7`: All rendering primitives (`TextContainerProperty`, `ListContainerProperty`, `ImageContainerProperty`) — no additions needed; the 4-container limit per `rebuildPageContainer` call is the primary architectural constraint for every v1.1 layout decision
- `@pkmn/sim` (transitive): Battle state source of truth; the stats screen reads stat boosts, ability, item, and speed from the sim's Pokemon objects via `SimBattleAdapter.getBattle()`; abilities.json is already loaded and needed for stats display
- `TypeScript ^5.9.3`: The type system serves as the primary regression harness; exhaustive `switch` on `ScreenName` union catches dead transitions when screens are removed (critical for TERA_CONFIRM removal)
- Local JSON data files: Already loaded via `DataLoader`; stats screen calls existing `DataLoader.getAbility()` and `DataLoader.getPokemon()` with no new integration

### Expected Features

**Must have (table stakes) — all explicitly requested:**
- Battle speed control (4 presets: Slow/Normal/Fast/Instant) — the biggest QoL feature for Showdown ladder players; Showdown has an acceleration multiplier; implement via `SpeedConfig` singleton
- Consolidated battle menu on HUD (Attack/Switch/Tera/Stats/Main Menu from one screen, eliminating the separate ACTION_MENU) — reduces the tap count to reach move selection from 2 to 1
- HP bars and sprites visible on attack and switch screens — the single biggest UX gap vs. Showdown web client, which keeps the battlefield visible at all times during move selection
- Remove `< Back` from all list screens (double-tap navigation only) — removes list clutter; requires adding a `DOUBLE_TAP` gesture kind and a `backAllowed()` guard per screen state
- Tera without confirmation screen (notifier-only, direct to attack select) — Showdown's Tera is a checkbox on the move screen; keep the two-step selection (Tera then move) but eliminate the dedicated confirm screen
- Stats screen: ability, status, stat stages, opponent speed range, possible abilities — replicates the beloved randbats tooltip used by experienced Showdown players
- Pokemon attack movement animation (attacker sprite lunges toward target before damage flash) — reuses existing `shiftSpriteBmp()`
- Animation text in a visually distinct region during battle resolution (separator characters or status bar repurposing, not a 5th container)
- Back to main menu at bottom of battle action list

**Should have (differentiators beyond Showdown web):**
- Glanceable speed control cycling through presets with one tap — more ergonomic than Showdown's settings slider
- Opponent speed range displayed natively — replicates the randbats tooltip community extension
- Possible abilities for opponent when unknown — matches randbats tooltip behavior
- Stat stages shown inline on HUD between turns — replaces Showdown's hover-only tooltip (impossible on glasses)

**Defer to v1.2:**
- Damage calculator (requires opponent EVs/nature — unavailable in randbats format)
- Scrollable battle log history (requires dedicated screen; defeats purpose on glasses)
- Move category icon (Physical/Special/Status) on attack screen — marginal value in randbats
- Opponent move tracking display (which moves has the foe revealed) — fits the stats screen but adds significant complexity
- Multiple battle formats beyond Gen 9 Random Battle

### Architecture Approach

The existing architecture is a clean FSM: `ScreenController` owns state and routes gestures, pure renderer functions return display objects, `AnimationEngine` handles async animation sequences, and `GlassAdapterImpl` bridges to the SDK. All v1.1 changes follow this same pattern. New renderers (`statsRenderer.ts`), new `ScreenName` values (`STATS_SCREEN`, `SPEED_SELECT`, `BATTLE_HUD_MENU`), a mutable `SpeedConfig` singleton, and a new `attackLunge()` method on `AnimationEngine` are the main additions. No new components break existing boundaries. The biggest structural risk is `ScreenController.ts` at 870 lines — adding 3-4 new screen states will compound complexity unless `PhoneCompanionRenderer` is extracted first.

**Major components and their v1.1 changes:**
1. `ScreenController` — Add `STATS_SCREEN`, `SPEED_SELECT`, `BATTLE_HUD_MENU` to the FSM; add centralized `backAllowed()` double-tap guard; extract `PhoneCompanionRenderer` to keep the file manageable before adding new handlers
2. `AnimationEngine` — Add `attackLunge()` method for `MOVE_USE` entries; add `delayScaled()` wrapper applying `SpeedConfig.multiplier()` to every delay call; apply `formatTextBox()` or separator chars to typewriter path
3. `GlassAdapterImpl` — Add `showBattleHudWithList()` if hardware verification confirms 2-image + 1-list + 1-text within the 4-container limit; keep `showBattleHud()` unchanged otherwise; add `DOUBLE_TAP` to `GestureEvent` union and map `DOUBLE_CLICK_EVENT` accordingly
4. `SpeedConfig` (new module) — Mutable module-level singleton with `get()`/`set()`/`multiplier()` API; optional `localStorage` persistence but always default to `normal` on launch
5. Renderers (new/modified) — `statsRenderer.ts` (new), `speedSelectRenderer.ts` (new), `renderBattleHudMenu()` on `battleHudRenderer.ts` (modified); all remain pure synchronous functions with no side effects

**Unchanged components:** `SimBattleAdapter`, `SimAIOpponent`, `LogParser`, `SpriteService`, `SpriteBmpEncoder`, `AnimationFrames`, `SpriteEffects`, `DataLoader`, and all `battleState` types (except adding `statStages` and `ability` fields to `ActivePokemon`).

### Critical Pitfalls

1. **Silently exceeding the 4-container SDK limit (C1)** — `rebuildPageContainer` returns `false` with no error when the limit is exceeded; the display simply omits containers. Sprites visible in browser may silently disappear on device. Prevention: map container slots in a table before writing any layout code; verify every new layout on hardware before committing.

2. **List index shifting breaks action handlers when items are added or reordered (C2)** — The renderer item array and the `ScreenController` `switch(idx)` block have no enforced contract. Adding "Stats" at index 1 shifts Attack to index 2 — wrong action fires silently for every tap. Prevention: define menu items as a typed `as const` array; derive both renderer items and handler switch cases from the same constant.

3. **Stats screen missing data fields not currently in BattleState (M5)** — Stat boosts and current ability are in `@pkmn/sim`'s internal `Battle` object but not tracked in `ActivePokemon`. The renderer will show zeros or undefined without `SimBattleAdapter` parser changes. Prevention: complete a data-availability audit and extend `BattleState` before writing any renderer code.

4. **Animation loop calling `showBattleHud()` causes progressive Bluetooth queue lag (M4)** — Three sequential SDK calls per animation frame at 22 fps = 66 calls/second; community reports show >20 calls/second causes visible lag after 2-3 seconds. Prevention: during animation, use only `updateText()` and `updateImage()` (in-place); never call `showBattleHud()` inside an animation loop.

5. **Double-tap back allowed on forced-switch screen causes illegal battle state (N3)** — If the player double-taps back during a forced switch, the sim expects a switch choice but ScreenController navigates away, breaking the battle. Prevention: implement a `backAllowed()` check per screen state; block double-tap-back on `ANIMATING`, `END_SCREEN`, and forced-switch `SWITCH_SELECT`.

---

## Implications for Roadmap

Based on the dependency graph, four phases emerge in a clear build order. Phases 1 and 2 are foundation work with no hardware risk. Phase 3 is the largest structural change with the most regression risk. Phase 4 is the highest-risk feature gated on hardware verification.

### Phase 1: Foundation — Data Model and Speed Config

**Rationale:** The Stats screen renderer cannot be written until `BattleState` exposes stat boosts and ability. Speed controls cannot be integrated into `AnimationEngine` until `SpeedConfig` exists. These are zero-dependency foundation tasks — no SDK interaction, no hardware needed — that unblock every other phase.

**Delivers:**
- `SpeedConfig` singleton (`src/config/speedConfig.ts`) with `get()`/`set()`/`multiplier()` and optional `localStorage` persistence; defaults to `normal` on every launch
- `ActivePokemon` type extended with `statStages: { atk, def, spa, spd, spe }` and `ability: string` fields in `battleState.ts`
- `SimBattleAdapter` updated to populate `statStages` from sim `boosts` data and `ability` from reveal events

**Addresses:** Stats screen data availability (pitfall M5 prevention), Speed controls foundation (pitfall M2 prevention)
**Avoids:** Writing the stats renderer against a data model that will force a later rewrite

### Phase 2: AnimationEngine Enhancements

**Rationale:** All animation changes are isolated to `AnimationEngine.ts` and have no dependencies on Phase 3 ScreenController wiring. They can be built and smoke-tested (even in browser with sprite overlay) before any navigation changes. Speed control multiplier requires Phase 1's `SpeedConfig`; attack lunge has no external dependencies beyond existing `shiftSpriteBmp`.

**Delivers:**
- `delayScaled()` wrapper in `AnimationEngine` replacing all `this.delay(ANIM.X)` calls — speed controlled by `SpeedConfig.multiplier()` read at execution time
- `attackLunge()` method for `MOVE_USE` entries — attacker sprite shifts 2-3 frames toward opponent, snaps back, then damage flash plays; uses `shiftSpriteBmp()` with signed direction per side
- Animation text formatting via separator characters (`═══ BATTLE ═══`) or `formatTextBox()` utility applied in the `updateDisplay` closure — no extra SDK container consumed
- New `ANIM` constants: `LUNGE_PX: 8`, `LUNGE_FRAMES: 2`, `LUNGE_FRAME_MS: 60`

**Uses:** `shiftSpriteBmp` (existing), `SpeedConfig` (Phase 1)
**Avoids:** SDK call rate lag — in-place `updateText()`/`updateImage()` only during animation, never `showBattleHud()` (pitfall M4)

### Phase 3: ScreenController Wiring and Navigation Redesign

**Rationale:** Requires Phase 1 data model and Phase 2 engines to exist. This is the largest structural change and the highest risk for introducing regressions in the existing working FSM. Building it after foundation work means each new wiring task is adding to proven components rather than to untested abstractions. Extract `PhoneCompanionRenderer` before adding new screen states to keep the file manageable.

**Delivers:**
- `DOUBLE_TAP` gesture kind added to `GestureEvent` union; `mapEventToGesture()` maps `DOUBLE_CLICK_EVENT` to `{ kind: 'DOUBLE_TAP' }`; centralized `backAllowed()` guard blocks back on forced-switch, ANIMATING, and END_SCREEN
- `< Back` removed from all list renderers; all index maps updated; `SwitchListScreen.indexMap` adjusted
- `TERA_CONFIRM` screen removed from `ScreenName` union; TypeScript exhaustive checking finds all usages; `teraQueued` flag set immediately in consolidated menu handler; status bar in `ATTACK_SELECT` shows "Tera: [type]" when queued
- `STATS_SCREEN` added to `ScreenName`; `statsRenderer.ts` wired; accessible from battle action list
- `SPEED_SELECT` added to `ScreenName`; `speedSelectRenderer.ts` wired; speed cycles inline or via sub-screen from main menu
- `BATTLE_HUD_MENU` added to `ScreenName`; consolidated HUD list (Attack/Switch/Tera/Stats/Main Menu) replaces separate ACTION_MENU; HP info encoded as list item text since list container occupies the content slot
- `PhoneCompanionRenderer` extracted from `ScreenController` before adding new handlers

**Addresses:** All navigation features; Tera without confirmation; back button removal; stats screen; speed selection
**Avoids:** Index shifting bugs (typed `as const` action array — pitfall C2); forced-switch back crash (backAllowed — pitfall N3); dead TERA_CONFIRM transitions (TypeScript union removal — pitfall I2); God object growth (extract PhoneCompanion first — pitfall I1)

**Research flag:** Navigation redesign is the most complex phase. The double-tap timing window (250-300ms discrimination) must be validated on hardware — if it adds perceptible latency to all single taps, fall back to keeping `< Back` on battle-critical screens (ATTACK_SELECT, SWITCH_SELECT) and only using double-tap for less critical back navigation.

### Phase 4: Overlay HUD — Sprites with List During Move/Switch Selection

**Rationale:** This is the highest-risk feature: showing both sprite image containers AND a selectable list container simultaneously requires a 2-image + 1-list + 1-text SDK layout that may not work within the 4-container limit. It is deferred to last so the rest of the milestone ships even if this hardware test fails.

**Delivers (if hardware test passes):**
- `showBattleHudWithList()` added to `GlassAdapterImpl` and `GlassAdapter` interface — 2 image containers (oppSprite, playerSprite) + 1 list container (moves/team) + 1 text container (status bar with compressed HP)
- `ATTACK_SELECT` and `SWITCH_SELECT` updated to use the overlay layout — sprites visible while choosing a move or switch target
- HP status compressed into the status bar: `"[████████░░]87% | [███░░░░░░░]30%"` — no separate HP text block when both sprite containers and a list are present

**Fallback (if SDK rejects 4-container overlay layout):**
- `ATTACK_SELECT` and `SWITCH_SELECT` use the status bar for compressed HP display without sprites
- Sprites remain visible on `BATTLE_HUD` between turns — already an improvement over v0.1 baseline
- No code changes needed to Phase 3's completed screens; fallback requires only omitting `showBattleHudWithList()`

**Avoids:** Silent 4-container overflow (hardware verification is the gating step before any code — pitfall C1)

**Research flag:** Hardware device test required before writing any Phase 4 code. Gate: does `rebuildPageContainer` with 2 image + 1 list + 1 text containers render correctly on the actual G2 device? Do not write `showBattleHudWithList()` until this is confirmed.

### Phase Ordering Rationale

- **Data model first:** The stats renderer is blocked on `BattleState` having the right fields. Writing renderer code against the wrong model forces a rewrite of both the parser and the renderer. `SimBattleAdapter` changes are the most likely source of unexpected behavior since they touch live battle parsing.
- **Animation before wiring:** `AnimationEngine` changes are self-contained and can be smoke-tested without ScreenController changes. Speed multiplier and lunge animation do not require navigation work to verify.
- **ScreenController last among stable features:** Every new screen state multiplies the gesture-state combinations that need regression testing. Building new screens after their renderers and data sources exist means each addition is a focused, testable wiring task.
- **Overlay HUD deferred and hardware-gated:** A SDK container limit could invalidate the most ambitious layout. The milestone should ship everything else even if Phase 4 falls back to the status-bar-only approach.

### Research Flags

Phases needing deeper research or hardware verification during planning:
- **Phase 3 (Navigation):** Double-tap timing window behavior on real G2 hardware — whether 250ms discrimination adds perceptible latency to all single taps, and how `DOUBLE_CLICK_EVENT` timing varies in practice
- **Phase 4 (Overlay HUD):** Hardware device test required — 2-image + 1-list + 1-text container layout must be verified on real G2 before writing any `showBattleHudWithList()` implementation

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Direct TypeScript data model extension following existing `BattleState` and `SimBattleAdapter` patterns; `SpeedConfig` is a plain module-level singleton — well-understood, no SDK interaction
- **Phase 2 (AnimationEngine):** Reuses `shiftSpriteBmp()` which already works in production; `SpeedConfig` integration is a multiplier applied to existing delay calls — established pattern
- **Phase 3 stable features (screen removal, stats, speed):** TERA_CONFIRM removal follows the TypeScript exhaustive union pattern; stats and speed screens follow the existing renderer-then-wire pattern

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Research based entirely on direct codebase inspection; no external library additions means no version compatibility uncertainty; all primitives verified present |
| Features | HIGH | Features are user-specified with exact parity references to Showdown web client source code (panel-battle.tsx, battle-tooltips.ts fetched directly); scope is well-defined |
| Architecture | HIGH | All patterns derived from direct code inspection of all existing source files; medium confidence on overlay HUD specifically (hardware-dependent, unverified on device) |
| Pitfalls | HIGH | Critical pitfalls validated against G2 SDK community notes (Nick Ustinov G2.md), observed v0.1 behavior, and SDK source behavior; all pitfalls trace to specific code locations |

**Overall confidence:** HIGH

### Gaps to Address

- **Hardware overlay layout verification (Phase 4):** Whether 2-image + 1-list + 1-text fits within 4 containers is not confirmed by documentation — only by device test. This gap must be resolved with a hardware test at the start of Phase 4. Do not write code before this answer is known.
- **Unicode box-drawing character rendering on G2 display:** Whether `┌┐└┘│─` render correctly on the G2 font is unconfirmed. Fallback is `+`, `-`, `|` ASCII borders if Unicode fails — plan for both when implementing animation text box.
- **Double-tap timing discrimination window on hardware:** The exact millisecond window that distinguishes a deliberate double-tap from two rapid single taps has not been measured on G2. This affects whether removing `< Back` causes accidental navigation or perceptible tap latency for all single taps.
- **Stat boost data accessibility via `SimBattleAdapter`:** The plan to read `battle.sides[n].active[0].boosts` from the `@pkmn/sim` Battle object is architecturally sound but not smoke-tested. Confirm the exact field path when beginning Phase 1.
- **`localStorage` persistence in Even App WebView for SpeedConfig:** Confirmed working for sprite cache in v0.1, but SpeedConfig using it for speed persistence carries some risk. Session-only (in-memory) persistence is the safe fallback if `localStorage` behaves differently in a new storage key context.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `src/adapters/glassAdapter.ts` — 4-container limit, `showBattleHud()` layout, gesture event mapping (`mapEventToGesture`)
- `src/animation/AnimationEngine.ts` — `shiftSpriteBmp`, `playEntry` orchestration, `typewriterText`, `spriteFlash`, HP drain, switch slide-in
- `src/config/constants.ts` — `ANIM`, `CONTAINER_IDS`, `CONTAINER_NAMES`, `GLASS_LAYOUT`, `SPRITE_CONFIG`, `DISPLAY_BUDGET`
- `src/screens/ScreenController.ts` — full FSM (870 lines), gesture routing, render dispatch, `ANIMATING` state, forced-switch handling, `teraQueued` flag
- `src/screens/ScreenState.ts` — `ScreenName` union, all renderer return types (`TextScreen`, `ListScreen`, `SwitchListScreen`, `BattleHudScreen`)
- `src/types/battleState.ts` — `ActivePokemon`, `BattleState`, `TurnLogEntry` (35+ kinds), current field inventory
- `src/battle/SimBattleAdapter.ts` — `getBattle()` API, Battle object access pattern, action submission
- `src/screens/renderers/*.ts` — all existing renderer patterns, index map conventions, item array structure
- Nick Ustinov's G2 Community Notes (github.com/nickustinov/even-g2-notes/blob/main/G2.md) — 4-container limit, character budget, `rebuildPageContainer` cursor reset behavior

### Secondary (MEDIUM confidence)
- [smogon/pokemon-showdown-client on GitHub](https://github.com/smogon/pokemon-showdown-client) — client architecture via DeepWiki
- [battle-tooltips.ts](https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/play.pokemonshowdown.com/src/battle-tooltips.ts) — tooltip data fields for stats screen design reference
- [panel-battle.tsx](https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/play.pokemonshowdown.com/src/panel-battle.tsx) — move button layout, HP bar display, Tera checkbox UX
- [battle-scene-stub.ts](https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/play.pokemonshowdown.com/src/battle-scene-stub.ts) — `acceleration` property and speed control pattern
- [DeepWiki: smogon/pokemon-showdown-client](https://deepwiki.com/smogon/pokemon-showdown-client) — UI component architecture overview
- [Even Realities G2 SDK Architecture Notes](https://www.evenrealities.com/blog/how-we-rebuilt-g2-from-the-inside-out) — display pipeline behavior
- Gestural interface pitfall references — double-tap accidental activation, system gesture conflicts, cognitive load on constrained displays

### Tertiary (LOW confidence — needs validation during implementation)
- `localStorage` persistence in Even App WebView for SpeedConfig — inferred from sprite cache behavior; not explicitly documented for arbitrary keys
- Unicode box-drawing character rendering on G2 — inferred from monospace font behavior; unconfirmed on device
- Double-tap timing window specifics — community inference; no published G2 SDK timing documentation

---

*Research completed: 2026-03-01*
*Ready for roadmap: yes*
