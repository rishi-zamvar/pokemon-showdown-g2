# Roadmap: Pokemon Showdown G2

## Overview

Build a fully playable Gen 9 random battle simulator on Even Realities G2 smart glasses in six phases, each delivering one complete capability layer. The dependency order is non-negotiable: data must be valid before game logic, the battle engine must be pure-tested before screens touch it, and the AI depends on the full damage pipeline. Phase 6 wires all layers together and validates a complete battle from main menu to win/loss screen.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Data Foundation** - Fix broken data files and wire a validated DataLoader singleton
- [x] **Phase 2: Team Generation** - Build random 6-Pokemon teams using @pkmn/randoms with filtering
- [ ] **Phase 3: Battle Engine** - Pure turn-state machine with damage calc, status, and Terastallization
- [ ] **Phase 4: AI Opponent** - Heuristic AI that scores moves by expected damage and switches intelligently
- [ ] **Phase 5: Screen Layer** - All G2 screens and gesture navigation wired to battle state
- [ ] **Phase 6: Integration** - Full loop from main menu through battle to win/loss, validated on device

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
- [ ] 03-04-PLAN.md — Wire status infliction from move secondary effects and primary status moves (gap closure)

### Phase 4: AI Opponent
**Goal**: The AI picks a legal action each turn by scoring moves using the same damage pipeline the player uses, switching intelligently, and applying Tera when it flips a bad matchup
**Depends on**: Phase 3
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05
**Success Criteria** (what must be TRUE):
  1. AI.pickAction() returns a move or switch action within one turn cycle with no noticeable delay
  2. The AI selects super-effective moves over neutral moves when both are available
  3. The AI switches to a non-resisted Pokemon when all of its current Pokemon's moves are resisted by the opponent
  4. The AI applies Terastallization when it would change a resistance into neutral or grant STAB on an otherwise neutral move
**Plans**: TBD

Plans:
- [ ] 04-01: Implement AI.pickAction() with move scoring via @smogon/calc expected damage, super-effective preference, and random tie-breaking
- [ ] 04-02: Implement AI switch logic (switch when all moves resisted) and AI Tera logic (use when matchup flips favorably)

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
**Plans**: TBD

Plans:
- [ ] 05-01: Implement MainMenuScreen, BattleHUDScreen, and TurnResultScreen with character budget assertions
- [ ] 05-02: Implement MoveSelectScreen, SwitchScreen, and TeraScreen with "< Back" nav items and correct list rendering
- [ ] 05-03: Implement BattleEndScreen; wire gesture routing (SCROLL_FWD/BACK, TAP) through screen stack; add phone companion state display with sprites

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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Foundation | 3/3 | Complete | 2026-02-26 |
| 2. Team Generation | 2/2 | Complete | 2026-02-26 |
| 3. Battle Engine | 3/4 | Gap closure | - |
| 4. AI Opponent | 0/2 | Not started | - |
| 5. Screen Layer | 0/3 | Not started | - |
| 6. Integration | 0/2 | Not started | - |

---
*Roadmap created: 2026-02-26*
*Milestone: v0.1 Random Battle Simulator*
