# Roadmap: Pokemon Showdown G2

## Overview

Build a fully playable Gen 9 random battle simulator on Even Realities G2 smart glasses in six phases, each delivering one complete capability layer. The dependency order is non-negotiable: data must be valid before game logic, the battle engine must be pure-tested before screens touch it, and the AI depends on the full damage pipeline. Phase 6 wires all layers together and validates a complete battle from main menu to win/loss screen.

v1.1 (UI Enhancement & Polish) adds five more phases (7-11) that transform the battle experience: configurable speed, consolidated HUD, animated attacks, persistent overlay layouts, and a stats screen.

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
- [ ] **Phase 6: Integration** - Full loop from main menu through battle to win/loss, validated on device
- [x] **Phase 7: Speed Config & Model Foundation** - SpeedConfig singleton, battle speed menu, BattleState data model extensions, dead code removal
- [x] **Phase 8: Animation Polish** - Text box frame, lunge animation, speed-scaled timing, instant skip
- [ ] **Phase 9: Navigation & HUD Consolidation** - Double-tap back gesture, merged battle HUD, Tera simplification
- [ ] **Phase 10: Overlay HUD Layouts** - Attack and switch screens with persistent sprites and HP bars
- [ ] **Phase 11: Stats Screen** - New stats screen showing stat stages, ability, opponent speed range, possible abilities

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

### Phase 6: Integration
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
**Goal**: Double-tap navigates back throughout the app; the battle HUD is a unified action list with Attack/Switch/Tera/Stats/Back; ACTION_MENU and TERA_CONFIRM screens are gone; Tera queues directly into attack select
**Depends on**: Phase 7 (needs OPT-02 clean-up from Phase 7 so removed screen types don't conflict)
**Requirements**: NAV2-01, NAV2-02, NAV2-03, NAV2-04, HUD-01, HUD-02, HUD-03, HUD-04, TERA-01, TERA-02, TERA-03
**Success Criteria** (what must be TRUE):
  1. No "< Back" text item appears on any list screen — the top of every sub-list is the first real option
  2. Double-tapping returns to the parent screen from attack select, switch select, and stats screens; single-tap on a list item selects it without triggering back navigation
  3. Forced-switch screens (after a faint) do not respond to double-tap — the player cannot escape to the battle HUD mid-forced-switch
  4. Tapping Attack or Switch on the battle HUD goes directly to that selection screen in one tap (no intermediate action menu step)
  5. After Tera is used, the battle HUD shows "Tera (used)" as a non-selectable item
  6. Selecting Tera on the battle HUD immediately opens the attack select screen with a "Tera queued" indicator visible
**Plans**: TBD

### Phase 10: Overlay HUD Layouts
**Goal**: The attack select and switch select screens show both Pokemon sprites and HP bars in the upper portion of the display while the move or team list occupies the lower portion
**Depends on**: Phase 9 (attack/switch screens must already be consolidated before layout changes)
**Requirements**: ATK-01, ATK-02, ATK-03, SWT-01, SWT-02, SWT-03
**Success Criteria** (what must be TRUE):
  1. While choosing an attack, both Pokemon HP bars are visible above the move list without requiring the player to leave the screen
  2. While choosing an attack, both Pokemon sprites are visible above the move list
  3. While choosing a switch target, both Pokemon HP bars are visible above the team list
  4. While choosing a switch target, both Pokemon sprites are visible above the team list
  5. The move list and team list render in the lower portion of the screen; battle context (sprites, HP) occupies the upper portion
**Plans**: TBD

### Phase 11: Stats Screen
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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 5.1 -> 5.2 -> 5.3 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11

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
| 6. Integration | 0/2 | Not started | - |
| 7. Speed Config & Model Foundation | 3/3 | Complete | 2026-03-01 |
| 8. Animation Polish | 2/2 | Complete | 2026-03-02 |
| 9. Navigation & HUD Consolidation | 0/TBD | Not started | - |
| 10. Overlay HUD Layouts | 0/TBD | Not started | - |
| 11. Stats Screen | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-26*
*Milestone v0.1: Random Battle Simulator*
*Milestone v1.1 phases added: 2026-03-01*
*Milestone v1.1: UI Enhancement & Polish*
