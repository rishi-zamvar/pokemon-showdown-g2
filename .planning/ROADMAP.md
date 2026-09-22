# Roadmap: Pokemon Showdown G2

## Overview

Build a fully playable Gen 9 random battle simulator on Even Realities G2 smart glasses in six phases, each delivering one complete capability layer. The dependency order is non-negotiable: data must be valid before game logic, the battle engine must be pure-tested before screens touch it, and the AI depends on the full damage pipeline. Phase 6 wires all layers together and validates a complete battle from main menu to win/loss screen.

v1.1 (UI Enhancement & Polish) adds four more phases (7-10) that transform the battle experience: configurable speed, consolidated HUD, animated attacks, and persistent overlay layouts.

v2.0 (Showdown Parity) adds Phases 12-19. It opens with an automation test harness because every phase after it is developed TDD against that harness — the simulator's HTTP automation API makes the glasses framebuffer, the console, and every input kind readable from a script, and that closed loop is what found the two bugs that made the app unplayable. The rest of the milestone is ordered by what unblocks what: container invariants before any new rendering, correct rendering before the greyscale sprite pipeline, the input model before the context menu that the inspect screens hang off, and the call-count restructure last, once the image content and the screen set are final.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Data Foundation** - Fix broken data files and wire a validated DataLoader singleton
- [x] **Phase 2: Team Generation** - Build random 6-Pokemon teams using @pkmn/randoms with filtering
- [x] **Phase 3: Battle Engine** - Pure turn-state machine with damage calc, status, and Terastallization
- [x] **Phase 4: AI Opponent** - Heuristic AI that scores moves by expected damage and switches intelligently
- [x] **Phase 5: Screen Layer** - All G2 screens and gesture navigation wired to battle state
- [x] **Phase 5.1: Battle Animations** (INSERTED) - Game Boy-style battle animations: typewriter text, sprite flash, HP drain
- [x] **Phase 5.2: @pkmn/sim Integration** (INSERTED) - Replace custom battle engine with @pkmn/sim for accurate Gen 9 mechanics
- [x] **Phase 5.3: Switch Animation & Text Polish** (INSERTED) - Switch animation, complete protocol text, HUD volatiles
- [~] **Phase 6: Integration** - RETIRED into Phase 12 (HARN-04 delivers this loop as an automated check)
- [x] **Phase 7: Speed Config & Model Foundation** - SpeedConfig singleton, battle speed menu, BattleState data model extensions, dead code removal
- [x] **Phase 8: Animation Polish** - Text box frame, lunge animation, speed-scaled timing, instant skip
- [x] **Phase 9: Navigation & HUD Consolidation** - Double-tap back gesture, merged battle HUD, Tera simplification
- [x] **Phase 10: Overlay HUD Layouts** - Attack and switch screens with persistent sprites and HP bars
- [~] **Phase 11: Stats Screen** - RETIRED into Phases 17-18 (subsumed by the INFO- inspect model)

**Milestone v2.0 — Showdown Parity**

- [ ] **Phase 12: Automation Test Harness** - Scripted simulator driver reading framebuffer, console, and stdout; TDD foundation for every phase after it
- [x] **Phase 13: Container Safety Layer** - Adapter-level guards for image bounds, dimension match, sequential sends, and startup placeholders (completed 2026-09-22)
- [ ] **Phase 14: Battle Text & HUD Persistence** - Correct turn-result text, nameplates that survive animation, "You"/"Foe" labels removed
- [ ] **Phase 15: 4-bit Greyscale Sprite Pipeline** - Greyscale PNG sprites replacing the 1-bit dithered BMP encoder
- [ ] **Phase 16: Modern Input Model** - Long-press, context-menu clicks, eventSource, explicit forfeit, root-page shutdown
- [ ] **Phase 17: Context Menu & Inspect Navigation** - Native context menu plus the Pokemon inspect screen, absorbing the retired Stats Screen
- [ ] **Phase 18: Move, Field, Team & Opponent Inspect** - The remaining inspect surfaces, with opponent info limited to what is revealed
- [ ] **Phase 19: Call-Count Performance Restructure** - Merged image containers, a frame budget, and call-count ceilings enforced by the harness

## Phase Details

### Phase 1: Data Foundation
**Goal**: All six data files are valid, importable JSON and accessible through a typed singleton with O(1) lookups
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06
**Success Criteria** (what must be TRUE):
  1. App boots without JSON parse errors — no data file is an HTML 404 page
  2. DataLoader exposes typed accessors for type chart, pokedex, and moves with sub-millisecond lookup
  3. learnsets.json does not block page load — lazy-loaded or replaced with @pkmn/randbats
  4. Only the 12 battle Pokemon's data is loaded at match start; all match data is cleared on battle end
  5. Non-standard Pokemon (Megas, CAP, Future, battleOnly formes) are excluded from any lookup used by team gen
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Re-fetch broken data files from Showdown CDN and strip CommonJS wrapper
- [x] 01-02-PLAN.md — Build DataLoader singleton with typed O(1) accessors, install @pkmn/randoms + @smogon/calc
- [x] 01-03-PLAN.md — Per-match data scoping (load 12 at start, clear on end) and lazy-load learnsets.json

### Phase 2: Team Generation
**Goal**: Player and AI each receive a valid, filtered Gen 9 random battle team of 6 Pokemon with 4 moves, stats, and Tera type before every battle
**Depends on**: Phase 1
**Requirements**: TEAM-01, TEAM-02, TEAM-03, TEAM-04
**Success Criteria** (what must be TRUE):
  1. TeamGenerator.buildRandom() returns a 6-Pokemon team using @pkmn/randoms with no invalid entries
  2. Every generated Pokemon has 4 moves, correct stats for its level, a Tera type, and a valid species name
  3. No generated team contains Megas, CAP Pokemon, formes tagged battleOnly, or entries with num <= 0
  4. A generated Pokemon's fields pass through @smogon/calc's Pokemon constructor without errors (field-name smoke test)
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Define BattlePokemon type and implement TeamGenerator singleton with buildRandom()
- [x] 02-02-PLAN.md — 100-iteration stress test validating all fields, calc alignment, and edge cases (Ditto, cosmetic formes)

### Phase 3: Battle Engine
**Goal**: A pure (no display calls) turn-state machine that takes a BattleState and an action and returns the next BattleState with correct damage, status effects, type effectiveness, fainting, and win/loss detection
**Depends on**: Phase 2
**Requirements**: BATTLE-01, BATTLE-02, BATTLE-03, BATTLE-04, BATTLE-05, BATTLE-06, BATTLE-07, BATTLE-08, BATTLE-09, BATTLE-10, BATTLE-11, BATTLE-12
**Success Criteria** (what must be TRUE):
  1. BattleEngine.submitAction() produces a new BattleState for every valid player action (attack, switch, Tera) without mutating the previous state
  2. Damage dealt matches @smogon/calc reference values for at least 5 known matchup vectors (including STAB, super-effective, crit, and Tera-boosted)
  3. Status conditions (burn, paralysis, poison, sleep, freeze) apply and trigger per-turn effects correctly
  4. A Pokemon with 0 HP is marked fainted; the engine forces a switch-in before the next turn; a side with all 6 fainted is marked as losing
  5. Terastallization changes the active type and recalculates STAB; the flag is consumed and cannot be used again in the same battle
  6. Move accuracy rolls cause misses at the correct statistical frequency; PP depletes by 1 per use and blocks selection at 0
**Plans**: 4 plans

Plans:
- [x] 03-01-PLAN.md — Define BattleState types and BattleEngine skeleton with turn resolution, switching, faint detection, and win/loss
- [x] 03-02-PLAN.md — Implement DamageCalc wrapping @smogon/calc with accuracy, PP tracking, and crit rolls
- [x] 03-03-PLAN.md — Implement status conditions, Terastallization integration, and complete battle loop
- [x] 03-04-PLAN.md — Wire status infliction from move secondary effects and primary status moves (gap closure)

### Phase 4: AI Opponent
**Goal**: The AI picks a legal action each turn by scoring moves using the same damage pipeline the player uses, switching intelligently, and applying Tera when it flips a bad matchup
**Depends on**: Phase 3
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05
**Success Criteria** (what must be TRUE):
  1. AI.pickAction() returns a move or switch action within one turn cycle with no noticeable delay
  2. The AI selects super-effective moves over neutral moves when both are available
  3. The AI switches to a non-resisted Pokemon when all of its current Pokemon's moves are resisted by the opponent
  4. The AI applies Terastallization when it would change a resistance into neutral or grant STAB on an otherwise neutral move
**Plans**: 1 plan

Plans:
- [x] 04-01-PLAN.md — Implement AIOpponent singleton with pickAction(): move scoring via computeDamage(), switch when resisted, Tera when matchup flips, plus smoke test

### Phase 5: Screen Layer
**Goal**: All G2 battle screens render correctly within display limits and all gestures route to the right screen transitions
**Depends on**: Phase 3 (needs BattleState), Phase 4 (needs AI actions)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, NAV-01, NAV-02, NAV-03, NAV-04, NAV-05
**Success Criteria** (what must be TRUE):
  1. Main menu displays "Enter Battle" on glasses; tapping it starts team generation and transitions to the battle HUD
  2. Battle HUD shows both Pokemon names and HP percentages within 64 chars/line and 8 lines; no screen exceeds 900 chars
  3. Attack selection shows 4 moves in a scrollable list with type; "< Back" at top returns to the action menu
  4. Switch screen shows all living team members with HP%; selecting one triggers a voluntary switch; fainted members are not selectable
  5. Terastallize confirmation shows Tera type and "< Back"; confirming uses the one-time Tera action for that Pokemon
  6. Win/loss end screen appears when the battle concludes with an option to return to the main menu
  7. Swipe down/up scrolls the active list; tap selects the highlighted item; response is immediate with no perceptible lag
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md — ScreenState types, display budget constants, and all 8 pure renderer functions
- [x] 05-02-PLAN.md — ScreenController state machine with gesture routing, turn resolution, and forced switch handling
- [x] 05-03-PLAN.md — Phone companion display with sprites, main.ts wiring, and clean build

### Phase 5.1: Battle Animations (INSERTED)
**Goal**: Turn resolution plays as a Game Boy-style animated sequence — sprites stay visible, text streams character-by-character, sprites flash on damage, HP bars drain progressively — making battles feel like classic Pokemon Red/Blue on G2 hardware
**Depends on**: Phase 5
**Requirements**: ANIM-01 (typewriter text), ANIM-02 (sprite flash on hit), ANIM-03 (HP drain animation), ANIM-04 (sequential log entry playback), ANIM-05 (tap-to-skip), ANIM-06 (gesture blocking during animation)
**Success Criteria** (what must be TRUE):
  1. After player selects an action, turn events play out one-by-one with typewriter text reveal (~40ms/char) — not shown as a static text block
  2. When a Pokemon takes damage, its sprite briefly flashes (inverted or blank → restore) before HP updates
  3. HP bar text updates progressively (drains frame-by-frame) rather than jumping to the final value
  4. Sprites remain visible on the glass display throughout the entire turn animation sequence
  5. Player can tap during animation to skip to the end result immediately
  6. All gestures except tap-to-skip are blocked during animation playback (no accidental navigation)
**Plans**: 3 plans

Plans:
- [x] 05.1-01-PLAN.md — Animation primitives: SpriteEffects, ANIM constants, updateImage on GlassAdapter, export formatEntry/formatHpBar
- [x] 05.1-02-PLAN.md — AnimationEngine class: async sequencer with typewriter, sprite flash, HP drain, and skip
- [x] 05.1-03-PLAN.md — ScreenController integration: wire animation into resolveTurn, gesture blocking, auto-transition

### Phase 5.2: @pkmn/sim Integration (INSERTED)
**Goal**: Replace the custom BattleEngine with @pkmn/sim so battles use accurate Gen 9 mechanics — correct damage rolls, abilities, items, priority, weather, terrain, and the full move/status ruleset — while keeping the existing screen layer, animations, and AI intact
**Depends on**: Phase 5.1
**Requirements**: (no new requirements — this phase replaces the implementation behind BATTLE-01 through BATTLE-12)
**Success Criteria** (what must be TRUE):
  1. Battles run through @pkmn/sim's RandomPlayerAI or equivalent, producing correct Gen 9 damage, priority, and ability interactions
  2. BattleState is derived from @pkmn/sim's battle object — HP, status, moves, PP, faint, and win/loss all come from sim state
  3. Player actions (attack, switch, Tera) translate to @pkmn/sim protocol choices and execute correctly
  4. AI opponent uses @pkmn/sim's built-in RandomPlayerAI or the existing heuristic AI adapted to sim state
  5. All existing screens, animations, sprites, and gesture navigation continue to work without changes
  6. Team generation uses @pkmn/sim's built-in random team generation
**Plans**: 3 plans

Plans:
- [x] 05.2-01-PLAN.md — SimBattleAdapter + LogParser integration with @pkmn/sim
- [x] 05.2-02-PLAN.md — SimAIOpponent using sim request/choice system
- [x] 05.2-03-PLAN.md — ScreenController wiring + old engine deprecation

### Phase 5.3: Switch Animation & Text Polish (INSERTED)
**Goal**: Switching Pokemon plays a 3-frame pokeball animation sequence, then shows the new Pokemon sprite with a 2-3px slide effect and "YOU SENT OUT [POKEMON]" text. All animation entries (damage, status, faint, switch, tera) display proper descriptive text — no undefined or missing values.
**Depends on**: Phase 5.2
**Requirements**: (no new requirements — polish on existing ANIM and UI requirements)
**Success Criteria** (what must be TRUE):
  1. When a Pokemon switches in, a 3-frame sequence plays: pokeball frame → green filled square → green checkbox square → pokemon sprite appears
  2. The new Pokemon sprite slides 2-3 pixels left-to-right on entry
  3. Text displays "YOU SENT OUT [POKEMON]" during the switch animation
  4. All animation entries show proper text — no "undefined" values for damage, status, faint, switch, or tera events
  5. Player-side activeIndex updates correctly after forced switch (faint) — name, sprite, and moves reflect the new Pokemon
  6. Species matching between sim and UI state handles all forme variations (cosmetic, gender, mid-battle changes)
**Plans**: 8 plans

Plans:
- [x] 05.3-01-PLAN.md — Expand TurnLogEntry kinds + LogParser with all ~35 PS protocol message types
- [x] 05.3-02-PLAN.md — Create AnimationFrames.ts (pokeball/square/checkbox BMP) + export encodeBmp
- [x] 05.3-03-PLAN.md — Add PS-accurate formatEntry text for all new TurnLogEntry kinds
- [x] 05.3-04-PLAN.md — HUD volatile status display (ActivePokemon.volatiles + SimBattleAdapter + battleHudRenderer)
- [x] 05.3-05-PLAN.md — AnimationEngine SWITCH/HEAL effects (3-frame + sprite slide + heal drain)
- [x] 05.3-05b-PLAN.md — ScreenController resolveSwitch animation wiring (no preloadSprites)
- [x] 05.3-07-PLAN.md — Fix getDexNum forme normalization for variant species (Gastrodon-East etc.)
- [x] 05.3-06-PLAN.md — Build verification + human-verify checkpoint

### Phase 6: Integration — RETIRED
**Status**: Retired into Phase 12. HARN-04 delivers this exact loop as a repeatable automated check rather than a one-off manual device pass. Do not plan this phase.
**Goal**: A complete battle plays from main menu to win/loss screen on actual G2 hardware without crashes, data errors, or navigation dead ends
**Depends on**: Phase 5
**Requirements**: (all 42 requirements verified end-to-end — no new requirements; this phase validates coverage)
**Success Criteria** (what must be TRUE):
  1. User opens app on G2, sees main menu, taps "Enter Battle," and enters a live battle against the AI with no crashes
  2. A full 6v6 battle can be played to completion: attacks, switches, Tera use, faints, forced switch-ins, and win/loss detection all work
  3. All screen transitions are reachable and reversible — no navigation dead ends; "< Back" always returns to the previous screen
  4. App survives 3 consecutive battles with no memory leak symptoms (no slowdown, no crash after match data cleared)
**Plans**: TBD

Plans:
- [ ] 06-01: Wire all layers in main.ts (screen stack, gesture routing, boot sequence, wake lock); run end-to-end battle checklist
- [ ] 06-02: On-device validation — complete 3 full battles, verify all navigation paths, confirm character budgets, measure load time

---

## Milestone v1.1: UI Enhancement & Polish

**Started:** 2026-03-01
**Phases:** 7-11
**Requirements:** 31 v1.1 requirements

### Phase 7: Speed Config & Model Foundation
**Goal**: Players can select battle speed from the main menu and the selection persists; BattleState carries stat stage and ability data; dead v0.1 code is removed
**Depends on**: Phase 6
**Requirements**: MENU-01, MENU-02, MENU-03, OPT-01, OPT-02
**Success Criteria** (what must be TRUE):
  1. Main menu shows "Battle Speed" as a selectable option alongside "Enter Battle"
  2. Selecting "Battle Speed" opens a list of four presets: Slow (0.5x), Normal (1x), Fast (2x), Instant (skip)
  3. Selected speed carries into the next battle without resetting — starting a new battle uses the last chosen speed
  4. Build succeeds with no TypeScript errors after old BattleEngine, DamageCalc, StatusEngine files are deleted and TERA_CONFIRM / ACTION_MENU screen types are removed
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — SpeedConfig singleton + main menu speed cycling integration
- [x] 07-02-PLAN.md — BattleState model extensions (stat stages, ability, held item on ActivePokemon)
- [x] 07-03-PLAN.md — Delete dead v0.1 engine files (BattleEngine, DamageCalc, StatusEngine, TurnResolver, AIOpponent)

### Phase 8: Animation Polish
**Goal**: Battle animations display inside a visible text box frame, the attacking sprite lunges toward the target before hit, all timing scales with the speed setting, and Instant mode skips animations entirely
**Depends on**: Phase 7 (needs SpeedConfig)
**Requirements**: ANIM-01, ANIM-02, ANIM-03, ANIM-04
**Success Criteria** (what must be TRUE):
  1. During battle animation, text appears inside a visible bordered frame rather than directly on the background
  2. When a Pokemon attacks, its sprite visibly shifts toward the opponent before the hit flash plays
  3. Setting speed to Slow makes animations noticeably longer; Fast makes them shorter; the ratio matches 0.5x / 2x multipliers
  4. Setting speed to Instant causes the battle to skip all animations and display the result text immediately with no per-character delay
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Speed scaling + Instant mode (wire SpeedConfig into AnimationEngine timing)
- [x] 08-02-PLAN.md — Text box frame + lunge animation (bordered text display, contact move sprite shift)

### Phase 9: Navigation & HUD Consolidation
**Goal**: Double-tap navigates back throughout the app; the battle HUD is a unified action list with Attack/Switch/Tera/Stats; ACTION_MENU and TERA_CONFIRM screens are gone; Tera queues directly into attack select
**Depends on**: Phase 7 (needs OPT-02 clean-up from Phase 7 so removed screen types don't conflict)
**Requirements**: NAV2-01, NAV2-02, NAV2-03, NAV2-04, HUD-01, HUD-02, HUD-03, HUD-04, TERA-01, TERA-02, TERA-03
**Success Criteria** (what must be TRUE):
  1. No "< Back" text item appears on any list screen — the top of every sub-list is the first real option
  2. Double-tapping returns to the parent screen from attack select, switch select, and stats screens; single-tap on a list item selects it without triggering back navigation
  3. Forced-switch screens (after a faint) do not respond to double-tap — the player cannot escape to the battle HUD mid-forced-switch
  4. Tapping Attack or Switch on the battle HUD goes directly to that selection screen in one tap (no intermediate action menu step)
  5. After Tera is used, the battle HUD shows "Tera (used)" as a non-selectable item
  6. Selecting Tera on the battle HUD immediately opens the attack select screen with a "Tera queued" indicator visible
**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md — DOUBLE_TAP gesture kind + remove "< Back" from attack/switch renderers
- [x] 09-02-PLAN.md — Battle HUD as action list, ScreenController refactor, screen elimination, tera toggle, trapping

### Phase 10: Overlay HUD Layouts
**Goal**: All decision screens (battle HUD, attack select, switch select) use a unified 4-container overlay layout with both Pokemon sprite composites, a team preview bar, and the selectable list visible simultaneously
**Depends on**: Phase 9 (attack/switch screens must already be consolidated before layout changes)
**Requirements**: ATK-01, ATK-02, ATK-03, SWT-01, SWT-02, SWT-03
**Success Criteria** (what must be TRUE):
  1. While choosing an attack, both Pokemon HP bars are visible above the move list without requiring the player to leave the screen
  2. While choosing an attack, both Pokemon sprites are visible above the move list
  3. While choosing a switch target, both Pokemon HP bars are visible above the team list
  4. While choosing a switch target, both Pokemon sprites are visible above the team list
  5. The move list and team list render in the lower portion of the screen; battle context (sprites, HP) occupies the upper portion
**Plans**: 4 plans

Plans:
- [x] 10-01-PLAN.md — CompositeBuilder module, OVERLAY_LAYOUT constants, showOverlayHud adapter method
- [x] 10-02-PLAN.md — ScreenController overlay wiring, composite caching, pre-computation, opponent reveal tracking
- [x] 10-03-PLAN.md — Fix player composite BMP routing/dimension mismatch (gap closure)
- [x] 10-04-PLAN.md — Fix HP carryover after voluntary switch (gap closure)

### Phase 11: Stats Screen — RETIRED
**Status**: Retired into Phases 17-18. The INFO- requirements specify a richer inspect model reached through the native context menu, of which this screen is a strict subset. STAT-01..05 re-map as tabled under "Carried-over v1.1 requirements" below. Do not plan this phase.
**Goal**: Players can open a stats screen from the battle HUD that shows their active Pokemon's stat stages, ability, status, and the opponent's speed range and possible abilities
**Depends on**: Phase 9 (stats screen entry point is on the consolidated battle HUD from Phase 9)
**Requirements**: STAT-01, STAT-02, STAT-03, STAT-04, STAT-05
**Success Criteria** (what must be TRUE):
  1. "Stats" appears as a selectable option on the battle HUD; tapping it opens the stats screen
  2. Stats screen shows the player's active Pokemon's current stat modifiers with clear labels (e.g., "+1 Atk", "-2 Def")
  3. Stats screen shows the player's active Pokemon's ability name and any active status condition
  4. Stats screen shows the opponent's active Pokemon's speed stat as a min-max range appropriate for the randbats set
  5. Stats screen shows the opponent's possible abilities — if the ability has not been revealed, all possible abilities for that species are listed
**Plans**: TBD

### Phase 12: Automation Test Harness
**Goal**: Every later phase can be built test-first — one CLI command drives the simulator, reads the real glasses framebuffer and both log streams, and fails on any defect
**Depends on**: Nothing in this milestone (foundation — hard sequencing requirement)
**Requirements**: HARN-01, HARN-02, HARN-03, HARN-04, HARN-05, HARN-06
**Success Criteria** (what must be TRUE):
  1. `npm run harness` boots the simulator with `--automation-port`, runs the whole suite unattended, and exits non-zero on any failure — no manual clicks, no browser window
  2. The driver can send all seven input kinds (`up`, `down`, `click`, `double_click`, `long_press`, `long_press_release`, `context_menu`) and read `/api/screenshot/glasses`, `/api/screenshot/webview`, and `/api/console?since_id=N`
  3. A test whose glasses region renders blank, all-black, or saturated FAILS — assertions read framebuffer pixel content, not merely the absence of an error
  4. Simulator stdout is captured into the same result stream as the console API, and a container-validation line appearing only in stdout fails the run
  5. A scripted battle runs boot → main menu → battle → attack → switch → faint → win/loss end screen unattended, reporting pass/fail per step
  6. Any console `error`, uncaught exception, or failed fetch occurring during a run fails that run

**Assertion vocabulary defined here** (every later phase cites these):

| Assertion | What it proves |
|---|---|
| `expectConsoleClean()` | no console error, uncaught exception, failed fetch, or stdout validation line |
| `expectFrameInk(region, min, max)` | region is neither blank nor saturated |
| `expectGreyLevels(region, n)` | region contains at least n distinct 4-bit grey levels |
| `expectFrameDiff(region, golden, tol)` | region matches a committed baseline capture |
| `expectRegionPersists(region, frames)` | region never goes blank across a frame sequence |
| `expectLoggedLine(pattern)` | an app-emitted structured log line matches |
| `expectHostCalls(action, n)` | a screen change issued at most n adapter calls |
| `runBattleScript()` | the full boot → win/loss script completes |

`expectFrameDiff` is defined here but deliberately **not implemented** in Phase 12 —
D-10 rules out golden-image diffing because simulator and hardware font rendering are
documented as divergent. Phases citing it must either justify a committed baseline or
fall back to `expectFrameInk` / `expectGreyLevels`.

**Plans**: 4 plans (strictly sequential: each wave depends on the previous)

Plans:
- [x] 12-01-PLAN.md — Zero-dependency PNG decode, ink/grey-level metrics, named regions derived from OVERLAY_LAYOUT
- [x] 12-02-PLAN.md — Simulator + Vite lifecycle, HTTP automation client, merged console+stdout capture with the failure policy
- [x] 12-03-PLAN.md — Assertion vocabulary, `npm run harness` runner, boot scenario, and the negative scenario that proves assertions can fail
- [ ] 12-04-PLAN.md — Scripted end-to-end battle: boot → menu → attack → switch → faint → win/loss

### Phase 13: Container Safety Layer
**Goal**: The adapter cannot issue an SDK call the hardware will reject or tile — every geometry and ordering invariant is enforced in one place, so no later phase can silently break a whole page rebuild again
**Depends on**: Phase 12
**Requirements**: REND-03, REND-04, REND-05, REND-06
**Success Criteria** (what must be TRUE):
  1. A page config declaring an image container outside 20–288 x 20–144, or exceeding 4 image / 8 other / 12 total containers, or not having exactly one `isEventCapture: 1`, is rejected inside the adapter before any SDK call, and the rejection is logged
  2. Every `updateImageRawData` payload's pixel dimensions equal its container's declared dimensions; a mismatch is rejected rather than sent, so the hardware never tiles
  3. Two `updateImageRawData` calls are never in flight at once — all sends pass through a single sequential queue
  4. `createStartUpPageContainer` is never called carrying image data; placeholders are created empty and filled by a following update, and the `container 8 not found` warning no longer appears
**Harness assertions that prove it**: `expectConsoleClean()` across `runBattleScript()` (no stdout validation lines for an entire battle); `expectLoggedLine(/adapter: rejected container/)` in a negative test that deliberately declares the old 576x24 team bar; `expectFrameDiff(SPRITE_REGION, golden)` on an undersized-payload fixture, which fails if tiling occurs.

> **Planning note (2026-09-18):** two of those three land differently, for
> reasons recorded in the plans. The `/adapter: rejected container/` assertion
> is proved by a deterministic `harness/selfCheck.ts` check rather than a live
> scenario, because the harness drives the app only through inputs and cannot
> make it build a bad config — a live version would mean shipping a
> deliberately-broken code path in production. `expectFrameDiff` is a
> documented refusal (D-10) and the tiling case is proved by refusing the
> undersized payload at the adapter, which is strictly stronger than detecting
> the tiled render after the fact. `expectConsoleClean()` across
> `runBattleScript()` lands as specified, three consecutive runs.

**Plans**: 3 plans (strictly sequential — all three touch glassAdapter.ts)

Plans:
- [x] 13-01-PLAN.md — Serialising send queue in the adapter; fixes the 1-in-20 mid-battle hang (REND-05)
- [x] 13-02-PLAN.md — Geometry/count/event-capture guard + SDK validator + cumulative container registry (REND-03)
- [x] 13-03-PLAN.md — Image data/container dimension match, no updates to undeclared containers, KNOWN_DEFECTS waivers deleted (REND-04, REND-06)

### Phase 13.1: Store Blocker — Exit Dialogue via Context Menu (INSERTED 2026-09-22)
**Goal**: The app satisfies Even Hub's root-page exit requirement, and does so through a menu rather than a bare double-tap, so the firmware's post-dialogue image wedge cannot be tripped by accident
**Depends on**: Phase 13 (the send queue and container registry must exist first)
**Requirements**: INPUT-05, INPUT-02, INFO-01
**Why inserted**: `evenhub pack` now succeeds, so packaging is no longer what blocks submission — this is. `shutDownPageContainer` is called ZERO times anywhere in `src/`; root double-tap currently does nothing, and Even Hub rejects apps whose root page does not invoke the exit dialogue.

**Why it merges with the context menu rather than shipping alone**: there is a
firmware defect (observed 2.2.7.14 / Even App 2.2.7 / SDK 0.0.13) where, once
the exit dialogue has been shown and dismissed, EVERY `updateImageRawData`
returns `sendFailed` in 1-3 ms — an immediate rejection with no transfer — and
it never recovers until the app restarts. Three in-app recoveries were tried
and all failed: rebuilding on appearance wipes the images, rebuilding after
cancel does not clear the wedge, and re-calling `createStartUpPageContainer` is
rejected with `invalid` after blocking ~2.1 s.

So the dialogue must be hard to reach by accident. Firing
`shutDownPageContainer(1)` from every root double-tap — the obvious reading of
the requirement — maximises exposure to an unrecoverable wedge. EvenChess's
pattern is the safe one and still satisfies the requirement: root double-tap
opens the context menu, and an explicit "Exit" item fires the dialogue.

**Success Criteria** (what must be TRUE):
  1. A native context menu is declared via `menuObject` on the root page, with at most 10 items and each `itemID` non-zero and unique
  2. `menuItemClickEvent` is parsed and routed through `onEvenHubEvent`
  3. Double-tap on the root (MAIN_MENU) page opens that menu; it does NOT call `shutDownPageContainer` directly
     > Scope note (added at plan time): opening the menu on double-tap is FIRMWARE behaviour the app cannot invoke — the SDK exposes no method to open a menu, only `menuObject` to declare one. The app's half of this criterion is (a) declaring the menu on the root page and (b) not hijacking `DOUBLE_CLICK_EVENT`. The harness exercises the simulator's `context_menu` action, which is a DISTINCT input from `double_click`; plan 04 asserts separately that `double_click` on the root page exits nothing.
  4. An explicit "Exit" menu item calls `shutDownPageContainer(1)`
  5. No non-root screen calls `shutDownPageContainer` at all
  6. Menu item names are within 32 UTF-8 bytes and validate before the SDK call
**Harness assertions that prove it**: `expectLoggedLine` on the menu declaration at boot; `POST /api/input {"action":"context_menu"}` followed by `expectFrameInk` on the menu region; `expectConsoleClean()` across `runBattleScript()` to prove no accidental shutdown mid-battle.
**Plans**: 4 plans
Plans:
- [x] 13.1-01-PLAN.md — declare menuObject on the root page, route menuItemClickEvent ahead of gesture mapping, add the single exitApp() call site
- [x] 13.1-02-PLAN.md — wire Exit/Battle Speed/About to the root menu behind a MAIN_MENU-only guard, and collapse the main menu to one row to delete the harness-01 soft-brick
- [x] 13.1-03-PLAN.md — harness proof: menu declared at boot, live under context_menu, click routes, and Enter Battle survives N speed changes
- [ ] 13.1-04-PLAN.md — per-turn no-accidental-exit, set-speed rewritten for the menu, and a terminal scenario proving Exit actually reaches shutDownPageContainer(1)
**UI hint**: yes

### Phase 14: Battle Text & HUD Persistence
**Goal**: Turn results read like the Showdown battle log, nameplates and HP bars survive every animation, and the display never says "You" or "Foe"
**Depends on**: Phase 13 (needs the sequential image queue before touching animation sends)
**Requirements**: REND-01, REND-02, REND-07

> **Note (2026-09-17):** the `[Mudsdale'` "malformed text" symptom that originally
> motivated REND-01 was **withdrawn** — it is `"[Mudsdale's Stamina]".slice(0,10)`,
> i.e. AnimationEngine.ts:298 rendering a progressive typewriter prefix, captured
> mid-animation. Do not go looking for a string-corruption bug; there isn't one.
> REND-01 remains worth doing as *coverage*: golden fixtures per log kind proving
> final text is correct, and a harness rule that a mid-typewriter frame is never
> mistaken for a settled one. REND-02 (nameplates vanishing during animation) was
> observed in the same frame and **is** real.
**Success Criteria** (what must be TRUE):
  1. After any turn, the turn-result area shows the complete parsed sentence for each log line — no truncated or bracketed fragment such as `[Mudsdale'` is produced by any of the ~30 protocol message types
  2. Nameplate and HP-bar regions are non-blank in every captured frame of a full attack sequence, including hit flash, HP drain, lunge, faint, and switch
  3. The strings "You" and "Foe" appear nowhere on the glasses display; each Pokemon is identified by species name and by which half of the screen it occupies
**Harness assertions that prove it**: `expectLoggedLine` on each rendered turn line against a committed golden set of protocol fixtures (REND-01); `expectRegionPersists(NAMEPLATE_REGIONS, allAnimationFrames)` over `runBattleScript()` (REND-02); `expectFrameDiff(HUD_REGION, golden)` against a You/Foe-free baseline (REND-07).
**Plans**: TBD
**UI hint**: yes

### Phase 15: 4-bit Greyscale Sprite Pipeline
**Goal**: Sprites render as readable Pokemon artwork using all 16 grey levels the display actually has, with no app-side dithering
**Depends on**: Phase 13 (dimension-match and queue guards must exist first)
**Requirements**: SPR-01, SPR-02, SPR-03, SPR-04
**Success Criteria** (what must be TRUE):
  1. No 1-bit encoding and no dithering code path remains in the app — the adapter receives greyscale PNG, and `SpriteBmpEncoder`'s 1-bit output is deleted
  2. Each sprite is converted with BT.601 luminance, resized preserving aspect ratio, and centred on a black field sized exactly to its container
  3. A captured sprite region on the glasses framebuffer contains at least 6 distinct grey levels with ink density inside a legible band — the scattered dot-cloud rendering of Dragonite and Cryogonal no longer occurs
  4. Nameplate and HP text remain composited into the bitmap rather than split into text containers, and are drawn with greyscale anti-aliasing
**Harness assertions that prove it**: `expectGreyLevels(SPRITE_REGION, 6)` and `expectFrameInk(SPRITE_REGION, min, max)` across a fixed roster of species; `expectConsoleClean()`.

> **Measurement ceiling (Phase 12, deferred item D3):** `greyLevels()` can return
> **at most 10** on simulator captures, never 16. The simulator pins RGB to
> (0,255,0) and carries brightness in alpha, so premultiplied luma maxes at
> `round(0.587*255) = 150` and `lum >> 4` tops out at bucket 9. The goal line's
> "all 16 grey levels" describes the *panel*, not anything assertable here —
> criterion 3's `>= 6` is the testable form. Do NOT assert `=== 16`, and do NOT
> "fix" the bucket shift: it is correct for the opaque hardware-shaped greyscale
> this metric also has to serve. To prove 16-level output, assert on the alpha
> histogram directly.
>
> `expectFrameDiff` was **removed** from this line: it is a throwing stub (D-10
> forbids golden-image diffing — simulator and hardware render differently).
> Also note deferred item **D2**: the repo's own `src/data/sprites/*.png` are
> colour-type-3 palette PNGs, which the harness decoder hard-throws on by design.
> If Phase 15 needs to read source sprites directly it must add PLTE support.
**Plans**: TBD
**UI hint**: yes

### Phase 16: Modern Input Model
**Goal**: Every gesture the G2 and the R1 ring can produce reaches the app, the double-tap-twice forfeit hack is gone, and the root page satisfies Even Hub's shutdown requirement
**Depends on**: Phase 12 (independent of the render phases — may run alongside 13–15)
**Requirements**: INPUT-01, INPUT-03, INPUT-04, INPUT-06  
> INPUT-02 (menuItemClickEvent) and INPUT-05 (root-page exit) moved to **Phase 13.1** — they are the Even Hub submission blocker and were pulled forward.
**Success Criteria** (what must be TRUE):
  1. `LONG_PRESS_EVENT` (9) and `LONG_PRESS_RELEASE_EVENT` (10) arrive at the screen controller as distinct gesture kinds
  2. `menuItemClickEvent` from the native context menu arrives carrying the clicked item's id
  3. Every gesture carries its `eventSource` (`GLASSES_R`, `GLASSES_L`, `RING`), and R1 ring input drives list navigation and selection identically to temple input
  4. Forfeiting is an explicit menu action; no `forfeitPending` flag and no 3-second `setTimeout` remain in the codebase
  5. Double-tap on the root page calls `shutDownPageContainer(1)` and the app exits — the Even Hub submission blocker is gone
  6. The same physical gesture produces the same app behaviour whether it arrives as `sysEvent`, `listEvent`, or `textEvent`
**Harness assertions that prove it**: each of the seven `POST /api/input` actions followed by `expectLoggedLine(/gesture: <kind> src=<source>/)`; `expectLoggedLine(/shutDownPageContainer\(1\)/)` after `double_tap` on the root page; a synthetic-event test firing the same gesture as all three event shapes and asserting one identical log line; `expectConsoleClean()`.
**Plans**: TBD

### Phase 17: Context Menu & Inspect Navigation
**Goal**: The native context menu becomes the universal "more" affordance, and the Pokemon inspect screen establishes the inspect pattern — this is where the retired Phase 11 Stats Screen lands
**Depends on**: Phase 16 (needs `menuItemClickEvent` plumbed), Phase 14 (inspect screens render over a correct HUD)
**Requirements**: INFO-02, INFO-07  
> INFO-01 (native context menu) moved to **Phase 13.1** — the safe exit pattern requires the menu to exist, so it ships there. Phase 17 extends that menu with inspect entries rather than creating it.
**Success Criteria** (what must be TRUE):
  1. A `context_menu` input from any battle screen opens a native menu of at most 10 items, each name ≤32 UTF-8 bytes, and selecting an item navigates to that inspect screen
  2. The Pokemon inspect screen shows species, level, types, current/max HP, status, ability, held item, every non-zero stat stage, and Tera type for the selected Pokemon
  3. Every inspect screen is reachable from the battle HUD within two inputs, and double-tap returns to the battle HUD with its prior cursor position intact
  4. Everything the retired Phase 11 Stats Screen specified — stat stages with signed labels, ability, and status — is present on the Pokemon inspect screen
**Harness assertions that prove it**: `expectFrameDiff(SCREEN, golden-pokemon-inspect)` after `context_menu` → `click`; an input-count assertion over every menu entry proving no inspect screen needs a third input; `expectLoggedLine(/menu: item name bytes=\d+/)` bounded at 32; `expectConsoleClean()`.
**Plans**: TBD
**UI hint**: yes

### Phase 18: Move, Field, Team & Opponent Inspect
**Goal**: Every battle fact Showdown surfaces on hover is reachable on the G2 — move details with live effectiveness, field conditions, both full teams, and opponent data limited to what the log has actually revealed
**Depends on**: Phase 17 (extends the inspect pattern and menu established there)
**Requirements**: INFO-03, INFO-04, INFO-05, INFO-06
**Success Criteria** (what must be TRUE):
  1. Move inspect shows type, category, base power, accuracy, PP remaining/max, and the effectiveness multiplier against the currently active opposing Pokemon
  2. Field inspect shows weather, terrain, screens, and entry hazards for both sides with remaining turn counts, and shows an explicit empty state when the field is clear
  3. Opponent inspect shows no fact the battle log has not revealed; an unrevealed ability is listed as the full possible ability set for the species, and opponent speed appears as a randbats min–max range rather than an exact number
  4. Team inspect lists all six Pokemon for a side with HP, status, and fainted state, and works for both the player's side and the opponent's
**Harness assertions that prove it**: golden-frame diffs per inspect screen captured at fixed turns inside `runBattleScript()`; a reveal-leak test asserting the opponent inspect frame is byte-identical before and after an opponent-only internal state change; `expectConsoleClean()`.
**Plans**: TBD
**UI hint**: yes

### Phase 19: Call-Count Performance Restructure
**Goal**: A battle screen change costs a fraction of today's ~477 ms because the app makes fewer host calls, and the harness turns any call-count regression into a test failure
**Depends on**: Phase 15 (image content must be final before merging canvases), Phase 17 (all screens exist to measure)
**Requirements**: PERF-01, PERF-02, PERF-03, PERF-04
**Success Criteria** (what must be TRUE):
  1. Wherever two images fall inside a single 288x144 box they are composited onto one canvas and sent as one `updateImageRawData` instead of two
  2. A battle HUD screen change issues at most 2 host calls where geometry permits, and the layout records which merges the 288x144 cap forbids and why
  3. The animation engine schedules frames against an explicit budget derived from ~104 ms per image send and ~165 ms per rebuild, dropping frames rather than queueing past the budget
  4. The harness records the host-call count for every screen change against a committed ceiling file, and a run fails when any screen exceeds its ceiling
  5. The layout uses no more than 2 text containers — no text container is added to avoid a rebuild, per the measured 2-container break-even
**Harness assertions that prove it**: `expectHostCalls('battleHud', 2)` and per-screen ceilings from a committed baseline; wall-clock per screen change recorded across `runBattleScript()`; `expectConsoleClean()`.
**Plans**: TBD

## v2.0 Requirement Coverage

Every v2.0 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|---|---|---|
| HARN-01 | Phase 12 | Complete |
| HARN-02 | Phase 12 | Complete |
| HARN-03 | Phase 12 | Complete |
| HARN-04 | Phase 12 | Delivered, blocked by research-14 (Phase 13 REND-05) |
| HARN-05 | Phase 12 | Complete |
| HARN-06 | Phase 12 | Complete |
| REND-03 | Phase 13 | Pending |
| REND-04 | Phase 13 | Pending |
| REND-05 | Phase 13 | Pending |
| REND-06 | Phase 13 | Pending |
| REND-01 | Phase 14 | Pending |
| REND-02 | Phase 14 | Pending |
| REND-07 | Phase 14 | Pending |
| SPR-01 | Phase 15 | Pending |
| SPR-02 | Phase 15 | Pending |
| SPR-03 | Phase 15 | Pending |
| SPR-04 | Phase 15 | Pending |
| INPUT-01 | Phase 16 | Pending |
| INPUT-02 | Phase 13.1 (moved from 16) | Pending |
| INPUT-03 | Phase 16 | Pending |
| INPUT-04 | Phase 16 | Pending |
| INPUT-05 | Phase 13.1 (moved from 16) | Pending |
| INPUT-06 | Phase 16 | Pending |
| INFO-01 | Phase 13.1 (moved from 17) | Pending |
| INFO-02 | Phase 17 | Pending |
| INFO-07 | Phase 17 | Pending |
| INFO-03 | Phase 18 | Pending |
| INFO-04 | Phase 18 | Pending |
| INFO-05 | Phase 18 | Pending |
| INFO-06 | Phase 18 | Pending |
| PERF-01 | Phase 19 | Pending |
| PERF-02 | Phase 19 | Pending |
| PERF-03 | Phase 19 | Pending |
| PERF-04 | Phase 19 | Pending |

**Totals by category** — HARN 6/6, REND 7/7, SPR 4/4, INPUT 6/6, INFO 7/7, PERF 4/4.
**34 of 34 v2.0 requirements mapped. 0 orphans, 0 duplicates.**

Per-phase counts: 12 → 6, 13 → 4, 14 → 3, 15 → 4, 16 → 6, 17 → 3, 18 → 4, 19 → 4. Sum = 34.

### Carried-over v1.1 requirements

The five Phase 11 Stats Screen requirements are retired into v2.0 rather than left orphaned:

| v1.1 Requirement | Absorbed by | Where |
|---|---|---|
| STAT-01 accessible from battle HUD | INFO-01, INFO-07 | Phase 17 |
| STAT-02 stat stages with modifiers | INFO-02 | Phase 17 |
| STAT-03 ability and status | INFO-02 | Phase 17 |
| STAT-04 opponent speed range | INFO-05 | Phase 18 |
| STAT-05 opponent possible abilities | INFO-05 | Phase 18 |

## Retired Phases

- **Phase 11: Stats Screen** — never started. Its entire intent is a strict subset of the INFO- requirements, which specify a richer inspect model reached through the native context menu rather than a single list screen. Retired; STAT-01..05 re-map to Phases 17 and 18 as tabled above. Do not plan Phase 11.
- **Phase 6: Integration** — never started (0/2). Its goal, "full loop from main menu through battle to win/loss, validated on device", is exactly HARN-04, which delivers the same loop as an automated, repeatable check instead of a one-off manual pass. Retired into Phase 12. Do not plan Phase 6.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 5.1 -> 5.2 -> 5.3 -> 7 -> 8 -> 9 -> 10 -> 12 -> 13 -> 14 -> 15 -> 16 -> 17 -> 18 -> 19

Phases 6 and 11 are retired and skipped. Within v2.0, Phase 12 must complete before anything else starts. Phase 16 depends only on Phase 12, so it may run alongside 13-15 if desired; 17 -> 18 -> 19 are strictly sequential.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Foundation | 3/3 | Complete | 2026-02-26 |
| 2. Team Generation | 2/2 | Complete | 2026-02-26 |
| 3. Battle Engine | 4/4 | Complete | 2026-02-26 |
| 4. AI Opponent | 1/1 | Complete | 2026-02-26 |
| 5. Screen Layer | 3/3 | Complete | 2026-02-26 |
| 5.1 Battle Animations | 3/3 | Complete | 2026-02-27 |
| 5.2 @pkmn/sim Integration | 3/3 | Complete | 2026-02-27 |
| 5.3 Switch Animation & Text Polish | 8/8 | Complete | 2026-02-27 |
| 6. Integration | - | Retired -> Phase 12 | - |
| 7. Speed Config & Model Foundation | 3/3 | Complete | 2026-03-01 |
| 8. Animation Polish | 2/2 | Complete | 2026-03-02 |
| 9. Navigation & HUD Consolidation | 2/2 | Complete | 2026-03-02 |
| 10. Overlay HUD Layouts | 4/4 | Complete | 2026-03-03 |
| 11. Stats Screen | - | Retired -> Phases 17-18 | - |
| 12. Automation Test Harness | 3/4 | In Progress|  |
| 13. Container Safety Layer | 3/3 | Complete   | 2026-09-22 |
| 13.1 Store Blocker — Exit Menu | 3/4 | In Progress|  |
| 14. Battle Text & HUD Persistence | 0/TBD | Not started | - |
| 15. 4-bit Greyscale Sprite Pipeline | 0/TBD | Not started | - |
| 16. Modern Input Model | 0/TBD | Not started | - |
| 17. Context Menu & Inspect Navigation | 0/TBD | Not started | - |
| 18. Move, Field, Team & Opponent Inspect | 0/TBD | Not started | - |
| 19. Call-Count Performance Restructure | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-26*
*Milestone v0.1: Random Battle Simulator*
*Milestone v1.1 phases added: 2026-03-01*
*Milestone v1.1: UI Enhancement & Polish*
*Milestone v2.0 phases added: 2026-09-17*
*Milestone v2.0: Showdown Parity — grounded in .planning/G2-PLATFORM-RESEARCH.md and .planning/SDK-UPGRADE-AUDIT.md*
