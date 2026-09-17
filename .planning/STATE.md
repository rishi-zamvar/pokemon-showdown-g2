---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: UI Enhancement & Polish
status: completed
stopped_at: Completed 12-03-PLAN.md
last_updated: "2026-09-17T23:45:03.905Z"
last_activity: "2026-09-17 — 12-03 shipped: assert.ts vocabulary, run.ts runner, `[screen]` oracle, selfCheck/boot/negativeProof scenarios. 36 primitive checks + 10 suite steps green three runs running; three real app defects allow-listed by name and printed every run (research rows 10, 11, and the newly found 13)."
progress:
  total_phases: 22
  completed_phases: 11
  total_plans: 43
  completed_plans: 41
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-17)

**Core value:** Players can play a complete random battle on G2 glasses with attack, switch, and Terastallize
**Current focus:** Milestone v2.0 — Showdown Parity (Phase 12 Automation Test Harness, plan 12-04 next)

## Current Position

Phase: 12 — Automation Test Harness — IN PROGRESS (3/4 plans)
Plan: 12-01, 12-02, 12-03 complete; 12-04 next
Status: `npm run harness` runs the suite unattended from nothing and exits non-zero on any failure. HARN-01, HARN-02, HARN-03, HARN-05, HARN-06 complete; HARN-04 (scripted battle) is 12-04.
Last activity: 2026-09-17 — 12-03 shipped: assert.ts vocabulary, run.ts runner, `[screen]` oracle, selfCheck/boot/negativeProof scenarios. 36 primitive checks + 10 suite steps green three runs running; three real app defects allow-listed by name and printed every run (research rows 10, 11, and the newly found 13).

```
Milestone v2.0 Progress:
[=====     ] Phase 12 Automation Test Harness          <- in progress (3/4), gates everything
[          ] Phase 13 Container Safety Layer
[          ] Phase 14 Battle Text & HUD Persistence
[          ] Phase 15 4-bit Greyscale Sprite Pipeline
[          ] Phase 16 Modern Input Model
[          ] Phase 17 Context Menu & Inspect Navigation
[          ] Phase 18 Move/Field/Team/Opponent Inspect
[          ] Phase 19 Call-Count Performance Restructure
9% complete (0/8 phases, 3/4 plans in Phase 12)
```

### Milestone v1.1 closed out

Phases 7-10 shipped and verified. Two phases are formally retired rather than
left orphaned in the roadmap:

- Phase 11 (Stats Screen) — never started. Subsumed by the v2.0 INFO-
  requirements; STAT-01..03 land on Phase 17, STAT-04..05 on Phase 18.

- Phase 6 (Integration) — never started. Its "full loop, validated end to end"
  goal is exactly HARN-04, delivered as an automated check in Phase 12.

### Fixed this session

- Dangling `even-dev/public` asset symlinks pointed at a deleted `~/Desktop`
  path, so every asset 404'd and no battle ever started. Now relative links.

- 576x24 team bar exceeded the 288x144 image container cap, failing the whole
  `rebuildPageContainer` and removing the action list — the app was
  unplayable. Commit `1684d66`.

### Open defects carried into v2.0

- Turn-result text renders malformed (`[Mudsdale'`)
- Nameplates/HP vanish during animation
- Sprites encoded 1-bit, discarding 15 of 16 grey levels
- ~477 ms per HUD screen change
- Root double-tap does not call `shutDownPageContainer(1)` (blocks Even Hub submission)
- "You"/"Foe" labels baked into composites

## Performance Metrics

**Velocity:**

- Total plans completed: 24 (23 through v1.1, + 12-01)
- 12-01: 2 tasks, 5 commits, 9 files, ~50 min
- Average duration: ~2.3 min

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Use @smogon/calc for damage, @pkmn/randoms for team gen — do not recreate mechanics
- [Roadmap]: Battle engine is pure (no glass calls) — screens are read-only views of BattleState
- [Roadmap]: Load only 12 match Pokemon at battle start; clear all match data on battle end
- [Roadmap]: Status conditions (burn, paralysis, poison, sleep, freeze) are IN scope for v0.1

**v2.0 locked decisions (2026-09-17 — do not re-open):**

- [Locked]: Information access is native context menu + dedicated inspect screens — the G2 has no hover and no pointer
- [Locked]: Sprites use a full 4-bit greyscale pipeline; no app-side dithering (the host downsamples better)
- [Locked]: Performance is restructured by cutting host call count, not payload (~104 ms fixed per image send dominates)
- [Locked]: Do NOT add text containers to reduce rebuilds — break-even is 2 containers; the SDK-UPGRADE-AUDIT recommendation to split text out is superseded by G2-PLATFORM-RESEARCH.md §3
- [Locked]: Phase 12 (harness) ships before any other v2.0 work; every phase after it is developed TDD against its assertions
- [v2.0]: Every v2.0 phase detail names the specific harness assertions that prove it — see ROADMAP.md
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
- [08-01]: scaledDelay resolves immediately when multiplier is 0 — Instant mode completes all animation loops with 0 iterations
- [08-01]: scaledFrameCount returns 0 for Instant, min 1 otherwise — prevents degenerate 0-frame animations at non-Instant speeds
- [08-01]: Early return after TURN_RESULT in Instant branches — prevents fall-through to transitionAfterTurn which would overwrite text
- [08-01]: Opening intro skipped entirely in Instant mode — cosmetic switch-in animations add no value at Instant speed
- [08-02]: renderTextBox lineWidth default 62 — leaves 1-char margin each side of 64-char G2 line
- [08-02]: Text box truncates to last 4 lines — most recent text visible during typewriter effect
- [08-02]: isContactMove checks flags.contact, not just category — ranged specials (Thunderbolt) skip lunge, contact specials (Grass Knot) lunge
- [08-02]: Lunge snaps back instantly — no smooth return animation, per context decisions
- [08-02]: lastMoveSlug tracked from MOVE_USE entries, reset at playTurn start — prevents stale cross-turn state
- [09-01]: DOUBLE_TAP has no listIndex — double-tap is a back-navigation gesture, not a list selection; listIndex only meaningful on TAP
- [09-01]: List renderers omit '< Back' — renderers produce only real content at 0-based indices; ScreenController handles back via DOUBLE_TAP gesture kind
- [09-01]: indexMap[displayIndex] = teamIndex directly — -1 offset removed along with '< Back' slot 0
- [09-02]: BATTLE_HUD dual render mode — sprite HUD (renderBattleHud) called by resolveTurn/resolveSwitch during animation; action list (renderBattleHudActions) called by render() during player decision phase
- [09-02]: [TERA QUEUED] is a list item (not status bar) — prepended to items array; handleAttackSelect shifts moveIndex by -1 when present
- [09-02]: Tera toggle stays on BATTLE_HUD when un-queueing — handleBattleHud calls render() without changing screen
- [09-02]: HUD-02 superseded by CONTEXT.md — no 'Back to Menu' list item; back-to-menu is exclusively via double-tap forfeit
- [09-02]: forfeitPending flag: first double-tap on BATTLE_HUD shows message, second double-tap forfeits; clears on any TAP or after 3s
- [10-01]: CompositeBuilder buildSpriteComposite is the low-level primitive; buildOppComposite/buildPlayerComposite are BattleState wrappers — DRY compositing
- [10-01]: Stat modifiers in overlay HUD use multiplier format (0.5x, 1.5x) not stage notation (+1, -2) — more readable at a glance
- [10-01]: teamBar container ID=8 — no collision with existing 1-7 range; sendBmpData private helper sends BMP sequentially after renderContainers
- [10-01]: loadImageFromUrl() wraps private loadImage() — additive export, no existing callers broken
- [10-02]: Composites built concurrently with animation via fire-and-await: const compositesPromise = buildAndCacheComposites() fires before animation, awaited after animation — maximizes parallelism
- [10-02]: Null fallback at render call site (cache ?? emptyFallback()) — cache fields are Uint8Array | null; fallbacks are valid all-black BMPs of correct dimensions
- [10-02]: resetCompositeCache() helper called on forfeit and both handleEndScreen branches — prevents cross-battle contamination
- [10-02]: revealedOpponentIndices cleared at battle start before first updateRevealedOpponents() call — fresh tracking per battle
- [10-03]: 50ms delay between renderContainers and first sendBmpData in showOverlayHud — SDK container mapping from prior rebuildPageContainer (showBattleHud 2-image layout) persists; delay ensures new 3-image mapping propagates before image data arrives
- [10-03]: BMP size diagnostic at console.debug level — fires on every overlay HUD render; debug level keeps production logs clean
- [10-04]: deriveSide triple-strategy activeIndex: (1) set.species match, (2) species.name match, (3) isActive flag scan — ordered by reliability; isActive fallback catches edge cases where species normalisation fails
- [10-04]: Post-derivation HP invariant: team[activeIndex].currentHp must equal simSide.active[0].hp — if not, correct in-place and console.warn; ensures composite always shows true HP after any switch
- [Phase 12]: Hand-rolled PNG decoder over node:zlib instead of pngjs/sharp; unsupported PNG shapes hard-throw
- [Phase 12]: Framebuffer luminance is premultiplied by ALPHA - simulator carries brightness in alpha, RGB is constant green
- [Phase 12]: Real simulator captures committed as harness fixtures; synthetic PNGs cannot validate the metrics
- [Phase 12]: Phase 12 allow-lists three app defects by exact anchored line (research rows 10, 11, 13) instead of failing every run; each names its owning phase and is printed in every run's output

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

- PROJECT.md "Context" and "Constraints" still describe the display as 576x288
  monochrome and sprites as "8-bit pixel art". It is 4-bit greyscale, 16 levels.
  Correct before Phase 15 so the sprite work isn't planned against a stale spec.

- The v2.0 brief referenced "49 requirements"; REQUIREMENTS.md defines 34
  (HARN 6, REND 7, SPR 4, INFO 7, INPUT 6, PERF 4). All 34 are mapped. If 15
  more were intended they are not written down anywhere and cannot be mapped.

### Roadmap Evolution

- Phase 5.1 inserted after Phase 5: Game Boy-style battle animations — typewriter text, sprite flash on damage, HP drain animation, sequential log playback (INSERTED)
- Phase 5.2 inserted after Phase 5.1: Replace custom BattleEngine with @pkmn/sim for accurate Gen 9 mechanics (INSERTED)
- Phase 5.3 inserted after Phase 5.2: Switch animation (pokeball→green square→checkbox), sprite slide, text polish, activeIndex fix (INSERTED)
- Phases 7-11 added 2026-03-01: Milestone v1.1 UI Enhancement & Polish
- Phase 6 RETIRED 2026-09-17: never started; absorbed by Phase 12 HARN-04
- Phase 11 RETIRED 2026-09-17: never started; absorbed by Phases 17-18 (INFO-02, INFO-05)
- Phases 12-19 added 2026-09-17: Milestone v2.0 Showdown Parity, harness-first

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

Last session: 2026-09-17T23:44:42.436Z
Stopped at: Completed 12-03-PLAN.md
Next: execute 12-02-PLAN.md (simulator lifecycle + HTTP client + merged log capture).
Resume file: None
