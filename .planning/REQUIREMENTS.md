# Requirements: Pokemon Showdown G2

**Defined:** 2026-02-26
**Core Value:** Players can play a complete random battle on G2 glasses with attack, switch, and Terastallize

## v0.1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Data Infrastructure

- [ ] **DATA-01**: Fix broken data files (abilities.json, items.json, typechart.json are HTML 404 pages)
- [ ] **DATA-02**: Integrate @pkmn/randoms for random team generation (all gens supported)
- [ ] **DATA-03**: Integrate @smogon/calc for damage calculation
- [ ] **DATA-04**: Load only the 12 match Pokemon's data at battle start (not full pokedex)
- [ ] **DATA-05**: Clear all cached match data when battle ends (zero memory footprint between matches)
- [ ] **DATA-06**: Filter non-standard Pokemon (Megas, CAP, Future) from team generation

### Team Generation

- [ ] **TEAM-01**: Generate random 6-Pokemon team for player using @pkmn/randoms
- [ ] **TEAM-02**: Generate random 6-Pokemon team for AI opponent using @pkmn/randoms
- [ ] **TEAM-03**: Each Pokemon has 4 moves, stats, type(s), level, and Tera type
- [ ] **TEAM-04**: Teams are valid for Gen 9 random battle format

### Battle Engine

- [ ] **BATTLE-01**: Turn-based battle loop (player chooses action, AI chooses action, resolve turn)
- [ ] **BATTLE-02**: Damage calculation using @smogon/calc (power, type effectiveness, STAB, random roll)
- [ ] **BATTLE-03**: Critical hit chance (1/24 at 1.5x multiplier)
- [ ] **BATTLE-04**: Type effectiveness (super effective 2x, not very effective 0.5x, immune 0x, dual-type)
- [ ] **BATTLE-05**: Faint detection (HP reaches 0) and forced switch to next alive Pokemon
- [ ] **BATTLE-06**: Voluntary switching (player can switch Pokemon on their turn instead of attacking)
- [ ] **BATTLE-07**: Terastallization (one use per battle, changes Pokemon type, affects STAB)
- [ ] **BATTLE-08**: Turn order based on speed stat (faster Pokemon moves first)
- [ ] **BATTLE-09**: Status conditions (burn, paralysis, poison, sleep, freeze) with per-turn effects
- [ ] **BATTLE-10**: Win condition (all 6 of opponent's Pokemon fainted) and loss condition (all 6 of player's fainted)
- [ ] **BATTLE-11**: Move PP tracking (moves have limited uses)
- [ ] **BATTLE-12**: Move accuracy check (moves can miss based on accuracy stat)

### UI Screens

- [ ] **UI-01**: Main menu screen with "Enter Battle" option displayed on glasses
- [ ] **UI-02**: Battle HUD showing: player Pokemon name + HP%, opponent Pokemon name + HP%
- [ ] **UI-03**: Action menu (vertical list): Attack, Switch, Terastallize — shown after tap on battle HUD
- [ ] **UI-04**: Attack selection screen (vertical list): 4 moves with type indicators, "< Back" at top
- [ ] **UI-05**: Switch Pokemon screen (vertical list): all alive team members with HP%, "< Back" at top
- [ ] **UI-06**: Terastallize confirmation screen with Tera type shown, "< Back" at top
- [ ] **UI-07**: Turn result display showing what happened (damage dealt, effectiveness, status applied)
- [ ] **UI-08**: Win/loss screen with option to return to main menu
- [ ] **UI-09**: All screens fit within G2 display (64 chars/line, 8 lines, 1000 char rebuild limit)
- [ ] **UI-10**: Phone companion screen shows battle state with sprites (using PokeAPI/Showdown CDN sprites)

### Navigation

- [ ] **NAV-01**: Swipe down moves cursor down in vertical lists
- [ ] **NAV-02**: Swipe up moves cursor up in vertical lists
- [ ] **NAV-03**: Tap selects the currently highlighted list item
- [ ] **NAV-04**: "< Back" item at top of every sub-menu returns to previous screen
- [ ] **NAV-05**: Navigation feels responsive (no lag between gesture and screen update)

### AI Opponent

- [ ] **AI-01**: AI scores each available move by expected damage using @smogon/calc
- [ ] **AI-02**: AI prefers super-effective moves over neutral moves
- [ ] **AI-03**: AI switches Pokemon when current matchup is unfavorable
- [ ] **AI-04**: AI uses Terastallization when it would flip a bad matchup
- [ ] **AI-05**: AI makes decisions within one turn cycle (no noticeable delay)

## v1.1 Requirements

Requirements for UI Enhancement & Polish milestone. Each maps to roadmap phases.

### Navigation Redesign

- [ ] **NAV2-01**: Remove "< Back" from all list screens — double-tap is the only back gesture
- [ ] **NAV2-02**: Double-tap gesture distinguished from single-tap with proper timing
- [ ] **NAV2-03**: Double-tap navigates back from any sub-screen to its parent
- [ ] **NAV2-04**: Forced-switch screens block back navigation (cannot escape when Pokemon fainted)

### Main Menu Enhancement

- [ ] **MENU-01**: Main menu includes "Battle Speed" option that opens speed preset selector
- [ ] **MENU-02**: Battle speed presets: Slow (0.5x), Normal (1x), Fast (2x), Instant (skip)
- [ ] **MENU-03**: Selected speed persists across battles within the session

### Battle HUD Consolidation

- [ ] **HUD-01**: Battle HUD shows Attack/Switch/Tera as selectable list items (one tap to reach moves)
- [ ] **HUD-02**: "Back to Menu" via double-tap forfeit confirmation (supersedes original "list item" spec per CONTEXT.md)
- [ ] **HUD-03**: Eliminate separate ACTION_MENU screen entirely
- [ ] **HUD-04**: Tera option disabled/grayed after use (shows "Tera (used)")

### Attack Screen Redesign

- [x] **ATK-01**: Attack select screen keeps HP bars visible for both Pokemon
- [x] **ATK-02**: Attack select screen keeps sprites visible for both Pokemon
- [x] **ATK-03**: Move list positioned in lower portion of screen with battle info above

### Switch Screen Redesign

- [x] **SWT-01**: Switch select screen keeps HP bars visible for both Pokemon
- [x] **SWT-02**: Switch select screen keeps sprites visible for both Pokemon
- [x] **SWT-03**: Team list shows Pokemon with HP% alongside battle context

### Tera Simplification

- [ ] **TERA-01**: Selecting Tera from battle HUD queues it and goes directly to attack select
- [ ] **TERA-02**: Visual notifier shows "Tera queued" on attack select when tera is active
- [ ] **TERA-03**: Eliminate TERA_CONFIRM screen entirely

### Animation Polish

- [ ] **ANIM-01**: Battle animation text displayed inside a text box (bordered frame)
- [ ] **ANIM-02**: Attacking Pokemon sprite moves toward target (lunge animation) before hit effect
- [ ] **ANIM-03**: All animation timing scales with battle speed setting
- [ ] **ANIM-04**: Instant speed mode skips animations and dumps text immediately

### Stats Screen

- [ ] **STAT-01**: Stats screen accessible from battle HUD (new screen type)
- [ ] **STAT-02**: Shows player Pokemon's current stats with modifier adjustments (+1 Atk, -2 Def, etc.)
- [ ] **STAT-03**: Shows player Pokemon's ability and status conditions
- [ ] **STAT-04**: Shows opponent Pokemon's speed range (min-max for randbats set)
- [ ] **STAT-05**: Shows opponent Pokemon's possible abilities (if not yet revealed, show all options)

### Code Optimization

- [ ] **OPT-01**: Remove dead code from v0.1 (old BattleEngine, DamageCalc, StatusEngine files)
- [ ] **OPT-02**: Remove TERA_CONFIRM and ACTION_MENU screen types and renderers

## Future Requirements (v2.0+)

### Enhanced AI

- **AI-06**: Difficulty levels (Easy/Normal/Hard)
- **AI-07**: AI prediction of player switches

### Enhanced UI

- **UI-11**: Battle animations on phone companion
- **UI-12**: Move effectiveness indicator before selecting
- **UI-13**: Battle history/log scrollable on phone
- **UI-14**: Damage estimate on move hover

## Out of Scope

| Feature | Reason |
|---------|--------|
| Online multiplayer | Single-player vs AI only |
| Custom team building | Random battles only — no teambuilder |
| Sound effects | G2 glasses have no speaker |
| Scrollable battle log history | G2 firmware scroll controls list nav; turn result screen already shows log |
| Type-color-coded move buttons | G2 is monochrome — type shown as text |
| Animated move effects (thunderbolts, fire) | No GPU layer; sprite-level BMP only |
| Exact HP numbers for opponent | Intentionally hidden in randbats format |
| Damage calculator | Requires unknown opponent EVs/IVs/nature |
| Team preview screen | Randbats format doesn't use team preview |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| DATA-04 | Phase 1 | Complete |
| DATA-05 | Phase 1 | Complete |
| DATA-06 | Phase 1 | Complete |
| TEAM-01 | Phase 2 | Complete |
| TEAM-02 | Phase 2 | Complete |
| TEAM-03 | Phase 2 | Complete |
| TEAM-04 | Phase 2 | Complete |
| BATTLE-01 | Phase 3 | Complete |
| BATTLE-02 | Phase 3 | Complete |
| BATTLE-03 | Phase 3 | Complete |
| BATTLE-04 | Phase 3 | Complete |
| BATTLE-05 | Phase 3 | Complete |
| BATTLE-06 | Phase 3 | Complete |
| BATTLE-07 | Phase 3 | Complete |
| BATTLE-08 | Phase 3 | Complete |
| BATTLE-09 | Phase 3 | Complete |
| BATTLE-10 | Phase 3 | Complete |
| BATTLE-11 | Phase 3 | Complete |
| BATTLE-12 | Phase 3 | Complete |
| UI-01 | Phase 5 | Complete |
| UI-02 | Phase 5 | Complete |
| UI-03 | Phase 5 | Complete |
| UI-04 | Phase 5 | Complete |
| UI-05 | Phase 5 | Complete |
| UI-06 | Phase 5 | Complete |
| UI-07 | Phase 5 | Complete |
| UI-08 | Phase 5 | Complete |
| UI-09 | Phase 5 | Complete |
| UI-10 | Phase 5 | Complete |
| NAV-01 | Phase 5 | Complete |
| NAV-02 | Phase 5 | Complete |
| NAV-03 | Phase 5 | Complete |
| NAV-04 | Phase 5 | Complete |
| NAV-05 | Phase 5 | Complete |
| AI-01 | Phase 4 | Complete |
| AI-02 | Phase 4 | Complete |
| AI-03 | Phase 4 | Complete |
| AI-04 | Phase 4 | Complete |
| AI-05 | Phase 4 | Complete |
| MENU-01 | Phase 7 | Complete |
| MENU-02 | Phase 7 | Complete |
| MENU-03 | Phase 7 | Complete |
| OPT-01 | Phase 7 | Complete |
| OPT-02 | Phase 7 | Complete |
| ANIM-01 | Phase 8 | Complete |
| ANIM-02 | Phase 8 | Complete |
| ANIM-03 | Phase 8 | Complete |
| ANIM-04 | Phase 8 | Complete |
| NAV2-01 | Phase 9 | Complete |
| NAV2-02 | Phase 9 | Complete |
| NAV2-03 | Phase 9 | Complete |
| NAV2-04 | Phase 9 | Complete |
| HUD-01 | Phase 9 | Complete |
| HUD-02 | Phase 9 | Complete |
| HUD-03 | Phase 9 | Complete |
| HUD-04 | Phase 9 | Complete |
| TERA-01 | Phase 9 | Complete |
| TERA-02 | Phase 9 | Complete |
| TERA-03 | Phase 9 | Complete |
| ATK-01 | Phase 10 | Complete |
| ATK-02 | Phase 10 | Complete |
| ATK-03 | Phase 10 | Complete |
| SWT-01 | Phase 10 | Complete |
| SWT-02 | Phase 10 | Complete |
| SWT-03 | Phase 10 | Complete |
| STAT-01 | Phase 17 (was 11) | Pending — absorbed by INFO-01/INFO-07 |
| STAT-02 | Phase 17 (was 11) | Pending — absorbed by INFO-02 |
| STAT-03 | Phase 17 (was 11) | Pending — absorbed by INFO-02 |
| STAT-04 | Phase 18 (was 11) | Pending — absorbed by INFO-05 |
| STAT-05 | Phase 18 (was 11) | Pending — absorbed by INFO-05 |

Phase 11 (Stats Screen) is retired. It was never started, and the INFO- requirements
specify a richer inspect model of which it is a strict subset. STAT-01..05 re-map to
Phases 17-18 as shown rather than being left orphaned.

**Coverage:**
- v0.1 requirements: 42 total — all Complete
- v1.1 requirements: 31 total — 26 Complete, 5 Pending (STAT-01..05, re-mapped to v2.0 phases)
- v2.0 requirements: 34 total — all Pending, all mapped
- Mapped to phases: 42 (v0.1) + 31 (v1.1) + 34 (v2.0) = 107 total
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-09-17 — v2.0 Showdown Parity requirements mapped to Phases 12-19; Phase 11 retired into 17-18*

---

## v2.0 Requirements — Showdown Parity

**Defined:** 2026-09-17
**Milestone goal:** The G2 app plays and reads like Pokemon Showdown online — correct rendering, every battle fact reachable without a pointer, and a render pipeline that respects the platform's real limits.

**Grounding:** `.planning/G2-PLATFORM-RESEARCH.md` (measured hardware costs, container limits, 4-bit greyscale, automation API) and `.planning/SDK-UPGRADE-AUDIT.md`.

### Test Harness (foundation — built first, TDD)

- [x] **HARN-01**: Automated driver over the simulator HTTP automation API (`--automation-port`) that can send every input kind and read the glasses framebuffer, webview screenshot, and console
- [x] **HARN-02**: Capture simulator stdout alongside the console API — container validation failures are logged there and nowhere else
- [x] **HARN-03**: Assert on glasses framebuffer content (not just "no error"), so a blank or malformed screen fails a test
- [ ] **HARN-04**: Scripted end-to-end battle: boot → menu → battle → attack → switch → faint → win/loss, as a single runnable check
- [x] **HARN-05**: Fail the run on any console `error`, uncaught exception, failed fetch, or simulator validation warning
- [x] **HARN-06**: Headless regression run usable from CLI in one command

### Render Correctness (fix what is broken)

- [ ] **REND-01**: Turn-result text is verified complete, not mid-typewriter. (CORRECTED 2026-09-17: the `[Mudsdale'` fragment first reported as malformed is exactly `"[Mudsdale's Stamina]".slice(0,10)` — AnimationEngine renders progressive prefixes, so the capture landed mid-animation. No rendering defect. The real requirement is that the harness must not mistake a mid-typewriter frame for a settled one, and that every log kind produces correct final text.)
- [ ] **REND-02**: Nameplates and HP bars remain visible for the duration of every animation
- [x] **REND-03**: No page declares a container outside the 20–288 x 20–144 image bounds; a guard rejects violations before the SDK call
- [x] **REND-04**: Image data dimensions always match container dimensions (hardware tiles mismatched data)
- [x] **REND-05**: `updateImageRawData` calls are queued strictly sequentially — concurrent sends are not permitted
- [x] **REND-06**: No image data is sent during `createStartUpPageContainer`; placeholders are created then updated. (The first half is unrepresentable: the SDK's `ImageContainerProperty` has no image-data field, verified in the .d.ts. The half that needed building is the other one — an update aimed at a container the current page does not declare is refused, not swallowed.)
- [ ] **REND-07**: Remove "You" / "Foe" labels from the display entirely; identify Pokemon by name and screen position

### Sprite Pipeline (4-bit greyscale)

- [ ] **SPR-01**: Replace 1-bit BMP encoding with greyscale PNG output; remove all app-side dithering
- [ ] **SPR-02**: Greyscale conversion uses BT.601 luminance, centred on black, resized to container preserving aspect
- [ ] **SPR-03**: Sprites are visually legible on the glasses framebuffer — verified by harness capture, not by eye
- [ ] **SPR-04**: Nameplate/HP text stays composited into the bitmap (per measured cost model), now rendered with greyscale anti-aliasing

### Information Access (no pointer, no hover)

- [ ] **INFO-01**: Native context menu (SDK 0.0.14+, max 10 items, ≤32 UTF-8 byte names) is the universal "more" affordance during battle
- [ ] **INFO-02**: Pokemon inspect screen: species, level, types, current/max HP, status, ability, item, stat stages, Tera type
- [ ] **INFO-03**: Move inspect screen: type, category, base power, accuracy, PP remaining/max, and effectiveness multiplier against the current target
- [ ] **INFO-04**: Field inspect screen: weather, terrain, screens, hazards, and remaining turn counts
- [ ] **INFO-05**: Opponent inspect shows only revealed information, with unrevealed abilities listed as the full possible set for the species
- [ ] **INFO-06**: Team inspect: all six Pokemon with HP, status, and fainted state, for both sides
- [ ] **INFO-07**: Every inspect screen is reachable in at most two inputs from the battle HUD, and exits back to it

### Input Model

- [ ] **INPUT-01**: Handle `LONG_PRESS_EVENT` (9) and `LONG_PRESS_RELEASE_EVENT` (10)
- [ ] **INPUT-02**: Handle `menuItemClickEvent` from the native context menu
- [ ] **INPUT-03**: Distinguish `eventSource` — `GLASSES_R`, `GLASSES_L`, `RING` — and keep R1 ring input working
- [ ] **INPUT-04**: Replace the `forfeitPending` double-tap-twice-within-3s hack with an explicit menu action
- [ ] **INPUT-05**: Root page double-tap calls `shutDownPageContainer(1)` — an Even Hub submission requirement the app currently fails
- [ ] **INPUT-06**: Handle `sysEvent`, `listEvent` and `textEvent` for the same gesture (simulator and hardware differ)

### Performance (call count is the only lever)

- [ ] **PERF-01**: Merge image containers wherever two images fall inside one 288x144 box
- [ ] **PERF-02**: Battle HUD screen change costs at most 2 host calls where geometry allows
- [ ] **PERF-03**: Animation engine runs against an explicit frame budget derived from ~104 ms per image send
- [ ] **PERF-04**: Measure and record actual per-screen call counts in the harness, so regressions are caught

### Out of Scope (v2.0)

- Online multiplayer, custom team building, sound (no speaker)
- IMU head-gesture control — available, but not needed for a turn-based game
- Camera, album picker, location APIs
- Even Hub store submission itself (INPUT-05 removes the blocker; submission is a later call)

### v2.0 Traceability

| Requirement | Phase | Status |
|---|---|---|
| HARN-01 | Phase 12 | Complete |
| HARN-02 | Phase 12 | Complete |
| HARN-03 | Phase 12 | Complete |
| HARN-04 | Phase 12 | Pending |
| HARN-05 | Phase 12 | Complete |
| HARN-06 | Phase 12 | Complete |
| REND-03 | Phase 13 | Complete |
| REND-04 | Phase 13 | Complete |
| REND-05 | Phase 13 | Complete |
| REND-06 | Phase 13 | Complete |
| REND-01 | Phase 14 | Pending |
| REND-02 | Phase 14 | Pending |
| REND-07 | Phase 14 | Pending |
| SPR-01 | Phase 15 | Pending |
| SPR-02 | Phase 15 | Pending |
| SPR-03 | Phase 15 | Pending |
| SPR-04 | Phase 15 | Pending |
| INPUT-01 | Phase 16 | Pending |
| INPUT-02 | Phase 16 | Pending |
| INPUT-03 | Phase 16 | Pending |
| INPUT-04 | Phase 16 | Pending |
| INPUT-05 | Phase 16 | Pending |
| INPUT-06 | Phase 16 | Pending |
| INFO-01 | Phase 17 | Pending |
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

**Coverage: 34/34 v2.0 requirements mapped to exactly one phase each. 0 orphans, 0 duplicates.**
Per-phase counts: 12 -> 6, 13 -> 4, 14 -> 3, 15 -> 4, 16 -> 6, 17 -> 3, 18 -> 4, 19 -> 4.

Note: the v2.0 section above defines **34** requirement IDs (HARN 6, REND 7, SPR 4,
INFO 7, INPUT 6, PERF 4), not 49. If 15 further requirements were intended, they are
not written down anywhere in `.planning/` and need to be added before they can be mapped.

---
*v2.0 requirements mapped to phases: 2026-09-17*
