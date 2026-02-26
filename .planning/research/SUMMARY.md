# Project Research Summary

**Project:** Pokemon Showdown Random Battle Simulator for Even Realities G2 Glasses
**Domain:** Turn-based Pokemon battle game on constrained text-only smart glasses display
**Researched:** 2026-02-26
**Confidence:** HIGH (stack verified live against npm registry; architecture verified against existing codebase; pitfalls verified by direct inspection of project data files)

## Executive Summary

This project is a single-player Pokemon random battle simulator running as a WebView app on Even Realities G2 smart glasses, built on top of an existing Even Hub SDK / Vite / TypeScript adapter layer. The correct approach is a narrow, purpose-built battle engine using `@smogon/calc` for damage calculation and `@pkmn/randoms` for team generation — both are official Smogon/pkmn ecosystem packages that plug directly into the existing build setup with zero configuration. The full Pokemon Showdown server simulator (`@pkmn/sim`) must be avoided: it requires Node.js polyfills in Vite, is 5-10MB uncompressed, uses a stream-based protocol designed for networked play, and resists scope limiting. A ~200-line custom turn engine wrapping `@smogon/calc` covers everything needed for v0.1.

The architecture divides cleanly into four isolated layers: an unchanged glass adapter (hardware bridge), a screen layer (text formatting only, no logic), a battle engine (pure computation, no display), and a data loader (JSON indexed once at startup). This separation is critical: screens must never mutate battle state, and the battle engine must never call the glass adapter. The G2 display is 576x288 monochrome, navigated by scroll and tap gestures, with a hard 1000-character limit on page builds and 2000 characters on in-place updates. All UI is text/list based — no images, no animations.

The most dangerous risks are pre-existing and must be resolved before any game logic is written. Three of the six "downloaded" data files (`abilities.json`, `items.json`, `typechart.json`) are currently HTML 404 error pages from an incorrect CDN fetch — they will crash the app on import. The type chart is required for damage calculation and is broken. Additionally, the 3.19MB `learnsets.json` file will block the app for 1-2 seconds if statically imported. These are day-one data wiring problems, not features, and must be treated as Phase 1 blockers.

## Key Findings

### Recommended Stack

The existing Vite 6 / TypeScript 5.7 / Even Hub SDK foundation requires no configuration changes. Add two battle-specific packages: `@smogon/calc@0.10.0` for damage calculation across all generations (including Gen 9 Terastallization), and `@pkmn/randoms@0.10.6` for generating legal Gen 9 random battle teams via `TeamGenerators.getTeamGenerator('gen9randombattle').getTeam()`. The local JSON data files in `src/data/` are already configured for native Vite import via `resolveJsonModule: true` and `moduleResolution: bundler`. A third optional package, `@pkmn/img@0.3.3`, handles sprite URL edge cases but should only be added if CDN 404s from Pokemon forme names (Rotom formes, Megas) become a problem in practice.

**Core technologies:**
- `@smogon/calc@0.10.0`: Damage calculation — the official Smogon tool powering the real Showdown calculator; handles Gen 1-9 formula differences, Tera types, Z-moves, Dynamax; ES module compatible; ships all data internally
- `@pkmn/randoms@0.10.6`: Team generation — official extraction of Showdown's `RandomTeam` logic; `getTeam()` returns fully-built `PokemonSet[]` with species, moves, EVs, item, Tera type already assigned
- Local JSON data files (existing): `pokedex.json`, `moves.json`, `learnsets.json` for team display and move menus; **do not use for damage calculation** (use `@smogon/calc`'s internal data to avoid version skew)
- Showdown sprite CDN (`play.pokemonshowdown.com/sprites/`): Gen 1-5 static PNG sprites via URL construction; `gen5ani/` animated GIFs must not be used (G2 renders static images only)

### Expected Features

Research confirms the complete feature set needed for a working v0.1 battle. The dependency order is strict: type chart data enables damage calculation, which enables HP tracking, faint detection, and win/loss detection. Battle state must exist before any screen can render. The AI depends on the full damage pipeline.

**Must have (table stakes — v0.1):**
- Random team generation (6v6, Gen 9 format, level by tier, 85 EVs, 31 IVs, 4 moves) — no teams means no battle
- Battle state engine (FSM with explicit `BattlePhase` enum: `PLAYER_CHOOSING`, `RESOLVING_TURN`, `PLAYER_SWITCH`, `GAME_OVER`) — core of everything
- Damage calculation (base formula + type effectiveness + STAB 1.5x + crit 4% / 1.5x + random 85-100%) — determines all outcomes
- Physical vs Special move routing — prerequisite for correct damage calc
- Type effectiveness from type chart (dual-type multiplied, immunity = 0 regardless of other type)
- Turn structure (both sides pick action, switches resolve first, then moves by Speed stat, Speed ties broken randomly)
- Faint detection and forced switch-in requirement
- Win/loss detection (all 6 Pokemon fainted on either side)
- Battle HUD (own Pokemon name + HP%, opponent name + HP%, ASCII HP bar)
- Attack selection screen (4 move names + type + base power, vertical list)
- Switch Pokemon screen (6 Pokemon with name + HP%, fainted entries skipped or greyed)
- Terastallization (one use per player per battle; changes active type; STAB recalculated; move BP floored to 60 for Tera-type moves; `@smogon/calc` handles this natively via `teraType` property)
- AI opponent (score moves by expected damage, prefer super-effective, switch if all moves resisted)
- Voluntary switching from action menu (not just on faint)

**Should have (v1.x after v0.1 validated):**
- Move effect text ("Super effective!", "Not very effective!") — adds game feel, low implementation cost post-core
- Status conditions (burn, paralysis, sleep, freeze, poison) — significant strategic depth
- Accuracy rolls (moves can miss) — adds realism; relevant for moves like Blizzard (70% accuracy)
- Active item effects (Life Orb, Leftovers, Choice Band) — teams already have items assigned; time to apply
- Remaining team count in HUD — small but meaningful situational awareness
- Priority move system (Quick Attack +1, Trick Room -7) — data already in `moves.json`

**Defer (v2+):**
- Full ability interactions (200+ abilities, each with unique logic)
- Weather and terrain effects (complex interaction surface, interacts with abilities)
- Multi-generation support (Gen 1-8 formats have different mechanics per gen)
- Stellar Tera type (edge case variant with unique damage math)
- Form changes mid-battle (Aegislash, Rotom, Darmanitan-Zen)
- Online multiplayer (requires server infrastructure)

**Anti-features (do not build for v0.1):**
- Battle animations (G2 is text-only, impossible)
- Custom team builder (contradicts random battle format)
- Detailed stat display screens (no screen real estate; show HP% only)
- Z-Moves or Mega Evolution (not in Gen 9 randbats format)

### Architecture Approach

The system splits into four strictly isolated layers communicating through defined interfaces. The unchanged `GlassAdapterImpl` wraps all Even Hub SDK calls. A screen layer (`BaseScreen` interface: `render(state, glass)` and `handleGesture(gesture, state)`) formats battle state as strings and calls the glass adapter. The battle engine (`BattleEngine`, `DamageCalc`, `AI`, `TeamGenerator`, all in `src/battle/`) is a pure computation layer with no display knowledge — it takes `BattleState` and an action, returns a new `BattleState`. A `DataLoader` singleton loads all JSON files once at startup into `Map<>` structures for O(1) lookup during battle turns. The controller in `main.ts` holds a screen stack (pushdown automaton), routes gestures to the active screen, and never contains game logic.

**Major components:**
1. `DataLoader` (`src/data/`) — singleton, loads all JSON once, exposes typed O(1) accessors; source of truth for all game data
2. `BattleEngine` + `DamageCalc` + `AI` (`src/battle/`) — pure functions, no glass calls; `BattleState` is an immutable value object; only this layer writes state
3. `TeamGenerator` (`src/battle/`) — builds legal 6-Pokemon teams using `@pkmn/randoms`; runs once per battle start
4. Screen layer (`src/screens/`) — `MainMenuScreen`, `BattleHUDScreen`, `MoveSelectScreen`, `SwitchScreen`, `TeraScreen`, `BattleEndScreen`; all read-only views of `BattleState`
5. Controller (`src/main.ts`) — screen stack, gesture routing, boot sequence wiring

### Critical Pitfalls

1. **Three data files are broken HTML 404 pages** (`typechart.json`, `abilities.json`, `items.json`) — Re-fetch from correct Showdown CDN `.js` endpoints (`play.pokemonshowdown.com/data/typechart.js`) and strip the CommonJS wrapper. Validate all JSON at startup with a `typeof data === 'object'` guard. This blocks all damage calculation and must be resolved in Phase 1.

2. **`learnsets.json` is 3.19MB and will freeze the app for 1-2 seconds if statically imported** — Use dynamic `import()` on first use, or preferably replace with `@pkmn/randbats` pre-extracted sets (~80KB) which eliminates the need for learnsets.json at runtime entirely. Decide on this approach before committing to an import strategy.

3. **`pokedex.json` contains 602 non-battle entries that will generate invalid teams** — Pre-filter at startup: exclude `isNonstandard` (CAP, Past/Mega, Future, Custom, LGPE) and `battleOnly` formes and entries with `num <= 0`. Never pick from the raw dictionary for team generation. Without this filter, teams will include CAP fan-made Pokemon and Mega evolutions with no sprites.

4. **Variable-power moves (`basePower: 0` in moves.json) silently deal 0 damage** — Moves like Gyro Ball, Endeavor, Counter, Dragon Rage store `basePower: 0` as a sentinel for "compute at runtime." A naive calculator will deal 0 damage silently. Either map these to fixed fallback values (e.g., 60 BP approximation) or filter them from random battle movesets for v0.1.

5. **G2 content limit silently truncates display at 1000 characters** — No error is thrown; content just disappears. Enforce a 900-character budget per screen type in development with a console warning assertion. Never render full stat descriptions, flavor text, or move effect descriptions on glasses.

## Implications for Roadmap

Based on the dependency graph established by combined research, the build order is non-negotiable. Nothing in the battle engine can run until data is valid. No screen can render meaningful content until the battle engine exists. The AI cannot function without a complete damage pipeline. Each phase has a hard prerequisite in the phase before it.

### Phase 1: Data Foundation and Wiring

**Rationale:** Three data files are currently broken (HTML 404 pages), blocking all game logic. The type chart is required for damage calculation. `learnsets.json` performance must be decided before the import strategy is committed. This phase has zero game logic — it is purely infrastructure and bug-fixing, but nothing else can proceed without it.

**Delivers:** All six data files valid and importable; `DataLoader` singleton with O(1) typed accessors; learnsets lazy-loaded or replaced with `@pkmn/randbats`; startup JSON validation assertions in place.

**Addresses (from FEATURES.md):** Type chart data (prerequisite for type effectiveness); team generation data (prerequisite for random teams).

**Avoids (from PITFALLS.md):** Pitfall 1 (broken 404 data files), Pitfall 7 (learnsets.json 3MB blocking load), and the integration gotcha of fetching `.json` instead of `.js` from the Showdown CDN.

**Research flag:** Standard patterns. Data fetching and singleton loaders are well-understood; no research phase needed. The correct CDN paths are documented in PITFALLS.md.

### Phase 2: Team Generation

**Rationale:** A battle cannot start without two legal teams. Team generation depends only on `DataLoader` (Phase 1). It is self-contained and its output — a `BattlePokemon[]` array — is the input to everything else. Building and validating this before the battle engine ensures the engine always receives well-formed data.

**Delivers:** `TeamGenerator.buildRandom()` using `@pkmn/randoms`; generates two valid 6-Pokemon teams with species, stats, moves, Tera type; `isNonstandard` / `battleOnly` filter applied; verified across 100+ generated teams.

**Addresses (from FEATURES.md):** Random team generation (6v6, Gen 9, levels by tier, 85 EVs, 31 IVs, 4 moves, ability and item assigned but item effect deferred).

**Avoids (from PITFALLS.md):** Pitfall 3 (CAP/Mega/battle-only Pokemon in generated teams), variable-power move exposure (filter at team gen if needed for v0.1).

**Research flag:** Standard patterns. `@pkmn/randoms` API is documented in STACK.md. No research phase needed.

### Phase 3: Battle Engine Core (State Machine + Damage Calculation)

**Rationale:** This is the most technically complex phase, with the most pitfall exposure. It must be built before any screens, because screens are read-only views of `BattleState`. The engine must be pure (no glass calls) so it can be unit tested without hardware. Damage calculation with correct type effectiveness, STAB, crit, and random roll must pass known-matchup tests before integration.

**Delivers:** `BattleState` types with explicit `BattlePhase` FSM; `BattleEngine.submitAction()` producing new state; `DamageCalc` using `@smogon/calc`; type effectiveness lookup with dual-type and immunity handling; turn resolution (switch priority, Speed ordering, faint detection, win/loss detection); Terastallization state tracking (`teraUsed`, `isTera`, `teraType`).

**Addresses (from FEATURES.md):** Damage calculation, type effectiveness, STAB, crit/random roll, Physical vs Special routing, turn structure, faint detection, forced switch, win/loss detection, Terastallization mechanic.

**Avoids (from PITFALLS.md):** Pitfall 2 (variable-power move 0-damage), Pitfall 4 (type effectiveness dual-type and immunity errors), Pitfall 5 (damage formula modifier order and integer rounding), Pitfall (invalid state boolean soup — use explicit `BattlePhase` discriminated union from day one).

**Research flag:** Needs research phase. Damage formula modifier order is subtle; type effectiveness edge cases (Freeze-Dry vs Water, Ghost immunity) need verification. Recommend writing unit test suite against `calc.pokemonshowdown.com` reference values before integration.

### Phase 4: AI Opponent

**Rationale:** The AI depends on the full damage pipeline from Phase 3 — it must score moves by expected damage output, which requires the same calculation path the player uses. The AI is isolated (`AI.ts`) and does not interact with the glass adapter. Building it separately from screens keeps the battle engine testable.

**Delivers:** `AI.pickAction(state, aiSide)` returning a move or switch action; heuristic: score each move by expected damage using `@smogon/calc`; prefer highest expected damage; switch if all moves resisted; uses Tera when it flips a resistance to neutral or STAB; random tie-breaking to reduce predictability.

**Addresses (from FEATURES.md):** AI opponent (basic heuristic, prefer super-effective, switch if all moves resisted), AI Tera usage.

**Research flag:** Standard patterns. Heuristic AI is well-documented in game AI literature. Sources cited in FEATURES.md. No research phase needed.

### Phase 5: Screen Layer and G2 Display Integration

**Rationale:** Screens are the final layer. They depend on a complete `BattleState` (Phase 3), a working battle engine, and team generation. Each screen is a dumb formatter: it reads state and calls glass adapter methods. This phase is where G2 display constraints are enforced — character budgets, `showText` vs `updateText` distinction, list-only navigation for choices.

**Delivers:** All six screens implementing `GameScreen` interface; `BattleHUDScreen` with ASCII HP bars; `MoveSelectScreen` with 4-move list (name + type + BP, under 25 chars each); `SwitchScreen` with 6-Pokemon list; `TeraScreen` Yes/No confirm; `BattleEndScreen`; `MainMenuScreen`; character budget assertions on every screen.

**Addresses (from FEATURES.md):** Battle HUD, attack selection screen, switch screen, Tera menu, win/loss end screen, voluntary switching, main menu.

**Avoids (from PITFALLS.md):** Pitfall 6 (G2 content limit silent truncation — 900-char budget enforced); anti-pattern of calling `showText` (full rebuild) for HP updates instead of `updateText`; anti-pattern of re-rendering on SCROLL events instead of only on TAP.

**Research flag:** Standard patterns. Existing `GlassAdapterImpl` is authoritative; its API is fully documented in ARCHITECTURE.md. No research phase needed.

### Phase 6: Full Loop Integration and End-to-End Testing

**Rationale:** Wire all phases together in `main.ts` with the screen stack (pushdown automaton). Verify complete battle from menu → team generation → first turn → switching → Tera use → faint → forced switch → win/loss end screen. This is validation, not new features.

**Delivers:** Complete working app; full 6v6 battle from start to end without crash; gesture routing through all screen transitions; wake lock acquired on battle start; complete battle log written.

**Addresses:** All v0.1 features from FEATURES.md verified end-to-end.

**Avoids:** "Looks done but isn't" checklist from PITFALLS.md — run all items before declaring v0.1 complete: data file validation, type effectiveness unit tests, team generation inspection for invalid entries, variable-power move handling verification, character budget measurement, faint detection edge cases, PP depletion handling.

**Research flag:** Standard patterns. Integration testing of the existing adapter is documented in the codebase.

### Phase Ordering Rationale

- Phases 1-2 are prerequisites with zero game logic. Data must be valid before any computation. Teams must exist before a battle state can be initialized.
- Phase 3 (battle engine) is built before Phase 5 (screens) because screens are read-only views of state. The engine must be unit-tested without hardware — coupling it to screens before testing creates untestable code.
- Phase 4 (AI) slots after Phase 3 because the AI uses the same damage pipeline. It is isolated from screens.
- Phase 5 (screens) comes last in the build sequence specifically because it depends on everything else. It is the simplest layer technically but requires the most hardware iteration.
- Phase 6 (integration) is deliberately separate from Phase 5 to enforce the "build pure, then wire" discipline.

### Research Flags

Phases requiring `/gsd:research-phase` during planning:
- **Phase 3 (Battle Engine):** Damage formula modifier order and integer rounding are subtle and gen-specific. Type effectiveness edge cases (Ghost immunity, Freeze-Dry, dual-type immunity short-circuit) need verified unit test cases before implementation. Recommend deriving test vectors from `calc.pokemonshowdown.com`.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Data Foundation):** Correct CDN paths and validation patterns documented in PITFALLS.md. No unknowns.
- **Phase 2 (Team Generation):** `@pkmn/randoms` API is fully documented in STACK.md. Filter logic is defined in PITFALLS.md.
- **Phase 4 (AI):** Heuristic AI for turn-based games is established; sources cited in FEATURES.md.
- **Phase 5 (Screen Layer):** Existing glass adapter API is authoritative. G2 constraints fully documented in ARCHITECTURE.md.
- **Phase 6 (Integration):** Standard wiring; no new research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm versions verified live; Vite compatibility confirmed; existing tsconfig verified from file inspection; `@pkmn/sim` avoidance confirmed from API inspection |
| Features | MEDIUM | Core battle mechanics from Bulbapedia (HIGH confidence); random battle team gen specifics from Showdown source code (HIGH); AI heuristics from secondary sources (MEDIUM); exact Tera type assignment in randbats from secondary sources (MEDIUM) |
| Architecture | HIGH | Existing adapter is authoritative; G2 constraints verified from live codebase; patterns from canonical game dev literature; build order from dependency analysis |
| Pitfalls | HIGH | Broken data files verified by direct file inspection (primary source); 3803-byte 404 HTML confirmed in all three affected files; character limits from even-g2-notes G2.md (HIGH) |

**Overall confidence:** HIGH

### Gaps to Address

- **Tera type assignment in Gen 9 randbats:** The exact mechanism by which `@pkmn/randoms` assigns Tera types to generated Pokemon was not verified against source code (secondary sources used). During Phase 2 implementation, log the `teraType` field from several `getTeam()` calls to confirm it is always populated and never undefined.

- **Sprite 404s for edge-case Pokemon formes:** The sprite URL construction formula handles the common case but form-named Pokemon (Rotom-Heat, Landorus-Therian, etc.) use hyphenated names that may not match CDN expectations. During Phase 5, test sprite loading for a sample of form-variant Pokemon and add `@pkmn/img` or fallback logic if needed.

- **Even App WebView performance on actual device:** The 1-2 second freeze estimate for `learnsets.json` parsing is based on reasoning about mobile WebView behavior, not measurement on the actual G2 device. During Phase 1, measure actual time-to-interactive on device with and without lazy loading to confirm the mitigation is necessary and sufficient.

- **`@pkmn/randoms` team format compatibility:** `getTeam()` returns a `PokemonSet[]` which maps to `@smogon/calc`'s `Pokemon` constructor fields. This mapping was verified by documentation but not by running both packages together. During Phase 2, add a smoke test that passes a generated team's first Pokemon through `@smogon/calc`'s `Pokemon` constructor to confirm field names align.

## Sources

### Primary (HIGH confidence)
- Direct inspection of `src/data/*.json` in this project — confirmed broken files, file sizes, JSON structure
- Existing `src/adapters/glassAdapter.ts` — authoritative G2 API capabilities, character limits, method names
- Existing `tsconfig.json` — confirmed `resolveJsonModule: true`, `moduleResolution: bundler`
- `npm show @smogon/calc version`, `npm show @pkmn/randoms version`, `npm show @pkmn/img version` — confirmed live versions
- https://github.com/smogon/damage-calc/blob/master/calc/src/index.ts — verified exports and `teraType` property
- https://bulbapedia.bulbagarden.net/wiki/Damage — damage formula, modifier order, STAB, critical hits, random factor
- https://bulbapedia.bulbagarden.net/wiki/Terastallization — Tera mechanics, STAB interactions, duration, one-use rule
- https://www.dragonflycave.com/mechanics/battle/ — turn structure, speed/priority ordering
- https://github.com/smogon/pokemon-showdown/blob/master/data/random-battles/gen9/teams.ts — level assignment, EV/IV rules, item/move/ability logic
- https://github.com/nickustinov/even-g2-notes/blob/main/G2.md — G2 display constraints, content limits, input event quirks
- https://gameprogrammingpatterns.com/state.html — FSM / pushdown automaton patterns for game state

### Secondary (MEDIUM confidence)
- https://www.smogon.com/articles/random-formats-overview — format overview, team composition rules
- https://deepwiki.com/smogon/pokemon-showdown/3.3-random-team-generation — source code-based team gen documentation
- https://www.smogon.com/forums/threads/random-battles-level-balancing.3721211/ — win-rate level adjustment system
- https://www.gamedeveloper.com/programming/programming-ai-for-pokemon-showdown-bot-battle-royale- — AI heuristic approaches
- https://pkmn.github.io/randbats/ — Gen 9 random battle set data (alternative to learnsets.json)
- https://github.com/pkmn/randbats — pre-extracted random battle sets as learnsets.json replacement
- https://github.com/smogon/pokemon-showdown/issues/10187 — format-specific team validation failures

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
