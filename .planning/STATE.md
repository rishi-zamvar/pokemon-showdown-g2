# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** Players can play a complete random battle on G2 glasses with attack, switch, and Terastallize
**Current focus:** Milestone v1.1 — UI Enhancement & Polish (Phase 8)

## Current Position

Phase: 7 — Speed Config & Model Foundation — COMPLETE
Plan: 3/3 complete
Status: Phase verified, moving to Phase 8
Last activity: 2026-03-01 — Phase 7 complete (3 plans, 1 wave, all verified)

```
Milestone v1.1 Progress:
[██        ] Phase 7  Speed Config & Model Foundation ✓
[          ] Phase 8  Animation Polish
[          ] Phase 9  Navigation & HUD Consolidation
[          ] Phase 10 Overlay HUD Layouts
[          ] Phase 11 Stats Screen
20% complete
```

## Performance Metrics

**Velocity:**
- Total plans completed: 21
- Average duration: ~2.3 min
- Total execution time: ~44.5 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-data-foundation | 3 completed | ~10 min | ~3.3 min |
| 02-team-generation | 2 completed | ~3 min | ~1.5 min |
| 03-battle-engine | 4 completed | ~17.5 min | ~4.4 min |
| 04-ai-opponent | 1 completed | ~2 min | ~2 min |
| 05-screen-layer | 3 completed | ~6 min | ~2 min |

**Recent Trend:**
- Last 5 plans: 05.1-01 (~2 min), 05.1-02 (~2 min), 05.1-03 (~1.5 min), 05.3-02 (~1 min), 05.3-01 (~2 min)
- Trend: stable ~1.5 min per plan

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Use @smogon/calc for damage, @pkmn/randoms for team gen — do not recreate mechanics
- [Roadmap]: Battle engine is pure (no glass calls) — screens are read-only views of BattleState
- [Roadmap]: Load only 12 match Pokemon at battle start; clear all match data on battle end
- [Roadmap]: Status conditions (burn, paralysis, poison, sleep, freeze) are IN scope for v0.1
- [Roadmap]: No sprites on glasses — text/list only; sprites only on phone companion screen
- [01-01]: Fetch .js not .json from PS CDN — .json paths return 404 HTML; .js paths return real data
- [01-01]: Drop function-valued keys via JSON.stringify — Phase 1 only needs static fields (name, num, desc)
- [01-01]: PS typechart damageTaken encoding: 0=1x, 1=2x(super), 2=0.5x(resist), 3=0x(immune)
- [01-01]: PS data keys are lowercase slugs — downstream lookups must use .toLowerCase() or slug normalization
- [01-02]: Module singleton pattern: export const DataLoader = { ... } object, not class with getInstance()
- [01-02]: JSON cast requires 'as unknown as' intermediate — some PS pokedex entries are sparse cosmetic formes
- [01-02]: getStandardPokemon() = !isNonstandard && !battleOnly = exactly 897 standard entries
- [01-02]: @pkmn/randoms and @smogon/calc installed and importable — ready for team gen and damage calc
- [01-02]: tsc and vite shims in node_modules/.bin/ had wrong relative paths — fixed; npm run build now works
- [01-03]: learnsets.json belongs in public/data/ not src/data/ — Vite bundles src/data/*.json at build time
- [01-03]: Match-scoped Maps use null (not empty Map) for clearance — null assignment makes Map GC-eligible
- [01-03]: loadMatchData extracts only 12 entries from 3.19 MB raw response — raw object discarded immediately
- [01-03]: validate() error handler calls setStatus() then returns — user sees error on glass before abort
- [02-01]: teraType cast as unknown as TypeName — @pkmn/randoms returns string, @smogon/calc wants TypeName union
- [02-01]: calcSpecies stored on BattlePokemon — downstream callers use it directly without re-doing Dex lookup
- [02-01]: stats computed at generation time via CalcPokemon constructor — no recalculation at battle runtime
- [02-01]: No post-filter for nonstandard Pokemon — @pkmn/randoms internal randomData allowlist is authoritative
- [02-02]: Stress test as standalone tsx script — no Jest/Vitest needed; tsx executes .ts directly
- [02-02]: 100 iterations confirmed: 0 failures, 2 Ditto appearances (~0.3%), 52 cosmetic forme resolutions (~8.7%) — all handled correctly
- [03-01]: Placeholder 50 HP damage in BattleEngine — replaced by DamageCalc in 03-02
- [03-01]: Double KO convention: opponent wins (rare edge case)
- [03-01]: Toxic counter resets to 1 on switch-in (Gen 9 behavior)
- [03-01]: All BattleState updates are immutable via spread — never mutate in place
- [03-02]: Status moves return 0 without calling @smogon/calc — avoids edge cases
- [03-02]: PP consumed even on miss — only PP_OUT (0 remaining) skips consumption
- [03-02]: Tera type passed to both attacker and defender CalcPokemon only when teraActive is true
- [03-03]: Sleep turns decremented at move-attempt time (checkMoveBlock), not end of turn
- [03-03]: Second Tera attempt degrades to regular attack with console.warn (no crash)
- [03-03]: Struggle fallback when all 4 moves have 0 PP — typeless damage + 25% max HP recoil
- [03-04]: inflictStatus() is the single entry point for status from moves — checks existing status + fainted before applying
- [03-04]: STATUS_INFLICT log actor = who RECEIVED the status (oppositeActor(attacker)), consistent with STATUS_TICK convention
- [03-04]: DamageCalc result.damage from @smogon/calc must be Array.isArray() guarded — immune/edge returns number not array
- [03-04]: Smoke test pickMove() must prefer damaging moves — status moves (Spore+healing) can stall test indefinitely
- [04-01]: AI switch threshold: only switch when damaging moves exist AND all score 0 (not just all moves score 0)
- [04-01]: AI Tera threshold: 1.3x improvement triggers TERA_ATTACK — ~10-20% activation rate in practice
- [04-01]: pickBestSwitch uses candidate mon not current aiMon — prevents scoring wrong Pokemon
- [04-01]: computeDamage random roll acceptable for AI scoring — 2x multiplier too large for noise to flip preference
- [05-01]: Non-null assertion (!) on team[activeIndex] — activeIndex always valid during battle; avoids undefined checks in renderers
- [05-01]: HP floor Math.max(1,...) only for non-fainted Pokemon; fainted shows 0%
- [05-02]: teraQueued flag reset in ALL paths leaving ATTACK_SELECT — prevents stale tera state
- [05-02]: resolveSwitch auto-switches opponent first on double faint before player switch
- [05-02]: SCROLL_FWD/BACK are complete no-ops — no render call, avoids unnecessary glass rebuilds
- [05-03]: Sprite URL uses DataLoader.getPokemon(slug).num for dex number — avoids separate sprite lookup
- [05-03]: Companion log renders last turn entries only (not full history) — keeps companion concise
- [05-03]: Phone companion updates via DOM manipulation in render() postamble, not in renderers
- [05.1-01]: blankSprite() has hardcoded base64 fallback if Canvas 2D context unavailable
- [05.1-01]: Pixel inversion uses (data[i] ?? 0) pattern for TypeScript strict indexed access compliance
- [05.1-01]: HP_BAR_WIDTH exported alongside formatHpBar so AnimationEngine can reconstruct bar strings at any HP
- [05.1-01]: updateImage() throws 'Not connected' if bridge null -- consistent with existing adapter pattern
- [05.1-02]: Shared mutable currentText/hpStatus in playEntry scope — both typewriter and HP drain update display via same updateText call
- [05.1-02]: findFaintedSide matches entry.detail.pokemon against prevState active mon names — FAINT entries lack side field
- [05.1-02]: HP drain uses prevState.currentHp as startHp, interpolates down by damage — endHp floored at 0
- [05.1-03]: prevState used for initial HUD display so animation drains from correct starting HP
- [05.1-03]: Final showBattleHud(nextState) after animation ensures correct HP even if skipped mid-drain
- [05.1-03]: TURN_RESULT kept for resolveSwitch — forced switches don't animate
- [05.2-01]: filterSplitLines() strips |split|pX markers + following secret line; keeps shared line — prevents duplicate TurnLogEntry per event
- [05.2-01]: HP percentage mod: targetHp/targetMaxHp in DAMAGE entries are log-string values (percentages for opponent) — only used for animation, not state
- [05.2-01]: damage=0 set in LogParser (stateless); fillDamageValues() in SimBattleAdapter fills real damage from prevHp map diff
- [05.2-01]: SimBattleAdapter.getBattle() exposes internal Battle instance to SimAIOpponent without coupling to adapter internals
- [05.2-02]: SimAIOpponent casts activeRequest as any — ChoiceRequest union narrowed via wait/forceSwitch/active property checks
- [05.2-02]: Random move selection replaces damage scoring — sim ChoiceRequest guarantees legal moves; matches PS RandomPlayerAI
- [05.2-02]: Tera at 20% via canTerastallize field in request — sim tracks teraUsed internally, no flag needed in SimAIOpponent
- [05.2-02]: _pickForceSwitchIndex skips forceSwitch.length active slots, detects fainted via condition.endsWith(' fnt')
- [05.2-03]: SimBattleAdapter.getBattle() is bridge between ScreenController and SimAIOpponent — adapter is sole owner of Battle instance
- [05.2-03]: Double-faint resolveSwitch calls SimAIOpponent.pickSwitch(battle) then single submitSwitch() with aiSwitchIndex — one makeChoices() covers both sides
- [05.2-03]: Old engine files (BattleEngine, AIOpponent, DamageCalc, StatusEngine, TurnResolver) preserved but no longer imported — cleanup deferred to future phase
- [05.3-01]: Weather upkeep ticks suppressed in LogParser — too verbose for glasses display
- [05.3-01]: STAT_CLEAR kind reused for clearboost/clearallboost/swapboost/invertboost/copyboost with type discriminator
- [05.3-01]: cant case expanded with flinch/recharge/taunt/disable handling instead of silent ignore
- [05.3-02]: encodeBmp exported as additive change -- internal callers unaffected
- [05.3-02]: Lazy caching via module-level null variables -- frames generated on first switch, reused forever
- [05.3-07]: getDexNum baseSpecies fallback: strip forme suffix after first hyphen when exact slug fails — resolves Gastrodon-East, Indeedee-F, etc.
- [05.3-07]: Four getDexNum sites updated: AnimationEngine, battleHudRenderer, ScreenController (startNewBattleInner + updatePokemonSlot)
- [05.3-04]: 12 volatile conditions tracked via VOLATILE_ABBREVS map — only game-relevant volatiles that affect player decisions
- [05.3-04]: Single-bracket format for tera + status + volatiles — maximizes info density on 64-char G2 line
- [05.3-05]: SWITCH animation runs sequentially (await), not via Promise.all — animation must complete before typewriter text
- [05.3-05]: Sprite slide uses shiftSpriteBmp with negative offset for left-to-right entrance effect
- [05.3-05]: HEAL uses prevState/nextState HP diff, not entry.detail percentages — actual HP values are authoritative
- [05.3-05b]: resolveSwitch mirrors resolveTurn animation pattern exactly — prevState HUD, playTurn, nextState HUD, transition

### v1.1 Research Context

Key findings from research (2026-03-01):
- [v1.1]: Zero new npm dependencies needed for all v1.1 features
- [v1.1]: 4-container SDK limit is the binding constraint for overlay HUD layouts (Phase 10)
- [v1.1]: Double-tap needs new gesture kind — DOUBLE_CLICK_EVENT currently maps to TAP in gesture handler
- [v1.1]: Stats screen needs BattleState type changes (statStages map, ability fields on ActivePokemon)
- [v1.1]: Attack lunge reuses existing shiftSpriteBmp() — no new BMP primitives needed
- [v1.1]: SpeedConfig is a mutable module-level singleton — imported by AnimationEngine and ScreenController
- [07-01]: SpeedConfig cycle order: ['Normal', 'Fast', 'Instant', 'Slow'] — index wrapping, resets to Normal on app restart
- [07-01]: About/Credits uses showText() directly then state stays MAIN_MENU — no new screen type needed
- [07-01]: Battle Speed cursorIndex=1 preserved after cycle so highlighted item stays visible after tap
- [07-02]: StatStages keys mirror @pkmn/sim boosts object verbatim — no key-mapping indirection at read site
- [07-02]: revealedAbility reads simMon.ability unconditionally for all pokemon — Phase 11 adds opponent visibility filtering if needed
- [07-02]: heldItemConsumed: prev.heldItemConsumed || (simMon.item === '' && prev.item !== '') — BattlePokemon.item from team gen is authoritative original item reference
- [07-02]: New BattleState fields follow: type in battleState.ts → default in initActivePokemon() → deriveSide() wiring → downstream consumers

### Pending Todos

None.

### Roadmap Evolution

- Phase 5.1 inserted after Phase 5: Game Boy-style battle animations — typewriter text, sprite flash on damage, HP drain animation, sequential log playback (INSERTED)
- Phase 5.2 inserted after Phase 5.1: Replace custom BattleEngine with @pkmn/sim for accurate Gen 9 mechanics (INSERTED)
- Phase 5.3 inserted after Phase 5.2: Switch animation (pokeball→green square→checkbox), sprite slide, text polish, activeIndex fix (INSERTED)
- Phases 7-11 added 2026-03-01: Milestone v1.1 UI Enhancement & Polish

### Blockers/Concerns

- [Phase 1 blocker RESOLVED]: abilities.json, items.json, typechart.json now contain valid data (314, 583, 19 entries)
- [Phase 1 blocker RESOLVED]: learnsets.json moved to public/data/ — lazy-loaded via fetch, not bundled
- [Phase 3 flag RESOLVED]: Damage formula delegated to @smogon/calc — no manual modifier ordering needed
- [Phase 3 flag RESOLVED]: All status conditions implemented with correct Gen 9 mechanics
- [Data note]: PS typechart damageTaken uses 1=2x (not 3) — plan had incorrect assertion; actual encoding documented above
- [Phase 4 note]: Pass BattlePokemon.calcSpecies (not species) to @smogon/calc — cosmetic forme crash avoided
- [Bundle note]: @pkmn/sim + @pkmn/randoms produce ~1.25 MB bundle (247 KB gzip) — chunk warning is cosmetic, not blocking
- [Phase 10 flag]: 4-container SDK limit may require fallback if overlay layout exceeds hardware constraint — research noted this as hardware-gated with a fallback option

## Session Continuity

Last session: 2026-03-01T21:09:03Z
Stopped at: Completed 07-02-PLAN.md (StatStages + ActivePokemon model extension + SimBattleAdapter wiring)
Resume file: None
