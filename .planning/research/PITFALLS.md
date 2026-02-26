# Pitfalls Research

**Domain:** Pokemon battle simulator for G2 smart glasses (text-only constrained display)
**Researched:** 2026-02-26
**Confidence:** HIGH — several pitfalls verified against actual project data files on disk

---

## Critical Pitfalls

### Pitfall 1: Downloaded Data Files Are 404 HTML Pages

**What goes wrong:**
Three of the six "downloaded" data files in `src/data/` are not valid JSON — they are HTML 404 error pages from the Pokemon Showdown CDN. Specifically:

- `abilities.json` — 3803 bytes, starts with `<!DOCTYPE html>` ("Not Found - Pokemon Showdown!")
- `items.json` — 3803 bytes, starts with `<!DOCTYPE html>` ("Not Found - Pokemon Showdown!")
- `typechart.json` — 3803 bytes, starts with `<!DOCTYPE html>` ("Not Found - Pokemon Showdown!")

These files will parse as undefined in JavaScript's `import` (Vite will fail) or throw a SyntaxError at runtime. Any code that reads type effectiveness, ability names, or item data will crash immediately.

**Why it happens:**
The original download script hit incorrect CDN paths. The Pokemon Showdown CDN serves HTML 404 pages at non-existent paths instead of returning a proper HTTP 404 status, so the downloader saved the HTML content without noticing the error.

**How to avoid:**
Fetch data from the correct authoritative sources:
- **Type chart**: `https://play.pokemonshowdown.com/data/typechart.js` (not `.json`). Extract the object after `exports.BattleTypeChart =`.
- **Abilities**: `https://play.pokemonshowdown.com/data/abilities.js`. Extract after `exports.BattleAbilities =`.
- **Items**: `https://play.pokemonshowdown.com/data/items.js`. Extract after `exports.BattleItems =`.

Alternatively, use the raw GitHub files: `https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/typechart.ts` and strip the TypeScript exports manually. The `@pkmn/dex` npm package also provides these as pre-processed JSON.

Validate all JSON files at import time with a startup check:
```typescript
function assertValidJSON(name: string, data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Data file ${name} failed validation — likely a 404 HTML page`);
  }
}
```

**Warning signs:**
- File size exactly 3803 bytes for any data file
- File content starts with `<!DOCTYPE`
- TypeScript build error: "JSON object is not valid"
- Runtime error: "Cannot read property 'X' of undefined" when looking up type matchups

**Phase to address:** Data wiring phase (Phase 1). This must be resolved before any game logic can run.

---

### Pitfall 2: Variable-Power Moves Treated as Zero Damage

**What goes wrong:**
`moves.json` stores `basePower: 0` for moves whose power is computed at runtime (e.g., Gyro Ball, Electro Ball, Endeavor, Crush Grip, Beat Up, Counter, Bide, Dragon Rage, Fissure). A naive damage calculator that reads `basePower` directly will deal 0 damage for these moves every time, silently — no crash, no error.

There are at minimum 10+ such moves in the data (confirmed from file inspection). For a random battle, any of these can appear legitimately in a generated moveset.

**Why it happens:**
`basePower: 0` is the Showdown convention for "compute this at battle time," not "the move does no damage." Developers unfamiliar with this convention write `damage = calcDamage(move.basePower, ...)` and test with Tackle (which has real basePower: 40) but never test with Gyro Ball.

**How to avoid:**
Add a lookup table mapping variable-power moves to their computation type. For v0.1 (simplified simulator), resolve these to fixed approximations:
```typescript
const VARIABLE_POWER_FALLBACK: Record<string, number> = {
  'electroball': 60,   // average-ish
  'gyroball': 60,
  'endeavor': 1,       // deals (target HP - user HP), cap at 1 for safety
  'crushgrip': 60,
  'counter': 0,        // physical reflect — skip in AI
  'dragonrage': 40,    // always deals 40 HP
  'bide': 0,           // charge move — skip in AI
  'beatup': 20,        // per hit; simplify
};
```
Alternatively, filter these moves out of randomly generated movesets for v0.1.

**Warning signs:**
- A Pokemon deals 0 damage repeatedly with a specific move but not others
- Battle feels one-sided — one Pokemon never KOs the other

**Phase to address:** Battle engine phase (damage calculation). Flag in code review checklist.

---

### Pitfall 3: isNonstandard Entries Pollute Team Generation

**What goes wrong:**
`pokedex.json` contains 1,515 entries but only 913 are "real" standard Pokemon. 602 entries are marked with `isNonstandard` values:
- 452 tagged `"Past"` (Mega evolutions, G-Max forms — not available in current gen)
- 80 tagged `"CAP"` (fan-made Create-A-Pokemon project)
- 49 tagged `"Future"` (unreleased)
- 19 tagged `"Custom"` (custom formats)
- 2 tagged `"LGPE"` (Let's Go Pikachu/Eevee exclusives)

A random team generator that picks from all 1,515 entries will generate CAP Pokemon, unreleased forms, and Mega evolutions that don't exist in normal random battles. Additionally, 87 "battle-only" formes (like Meloetta-Pirouette, Darmanitan-Zen, Cherrim-Sunshine) exist in the data but cannot be sent out at battle start — they transform mid-battle.

**Why it happens:**
The pokedex file is a flat dictionary. Nothing stops a random picker from selecting `venusaurmega`, `syclar` (CAP), or `darmanitanzen` (battle-only). The data does have `isNonstandard` and `battleOnly` fields — but only if you read them.

**How to avoid:**
Pre-filter the pool at startup to a valid battlable set:
```typescript
const battleableSpecies = Object.entries(pokedex)
  .filter(([id, data]) => {
    if (data.isNonstandard) return false;           // exclude Past/CAP/Future/Custom/LGPE
    if (data.battleOnly) return false;             // exclude battle-only formes
    if (data.num <= 0) return false;               // exclude placeholder entries (num=-1 etc)
    return true;
  })
  .map(([id]) => id);
```

Also: cosmetic formes (like Unown-B through Unown-Z) are NOT in `pokedex.json` at all — they are generated from base formes. Do not assume pokedex.json is exhaustive for cosmetic variants.

**Warning signs:**
- Generated teams contain Pokemon with names like "Venusaur-Mega" or unknown names
- Battle crashes when looking up a Pokemon's sprite (no sprite exists for CAP Pokemon on CDN)
- "Syclar" or "Equilibra" appearing in teams (CAP Pokemon with real-sounding names)

**Phase to address:** Team generation phase. Must be handled before first battle can run.

---

### Pitfall 4: Type Effectiveness Lookup Requires Non-Trivial Logic

**What goes wrong:**
Without a valid `typechart.json` (currently a 404 page — see Pitfall 1), type effectiveness returns undefined for all matchups. But even with a valid type chart, dual-type Pokemon require multiplying two separate lookup values, and common mistakes are:

1. Only checking the first type, ignoring the second
2. Multiplying before flooring (should floor after each individual multiplication in Gen 1, but not in Gen 2+)
3. Not handling immunity (0x effectiveness) — if any type matchup returns 0, the move does zero damage regardless of the other type
4. Getting the direction wrong: you look up Attacking Type vs Defending Type, not the other way

The type chart structure in Showdown is keyed by **defending type** with nested values by attacking type (or vice versa — verify before use).

**Why it happens:**
Type charts are habitually implemented from memory. "I know Fire beats Grass" leads to handcoded tables that miss edge cases (Freeze-Dry vs Water type, Ghost vs Normal immunity, etc.).

**How to avoid:**
Fetch the actual Showdown type chart and use it as the canonical source. Implement a single `getTypeEffectiveness(attackType: string, defendTypes: string[]): number` function and write unit tests for known matchups before building the damage calculator:
```typescript
// Known test cases to verify
getTypeEffectiveness('Water', ['Fire'])          // => 2
getTypeEffectiveness('Normal', ['Ghost'])        // => 0
getTypeEffectiveness('Ground', ['Flying'])       // => 0
getTypeEffectiveness('Electric', ['Water', 'Flying']) // => 4
getTypeEffectiveness('Ice', ['Water', 'Ground']) // => 2 (1x * 2x)
```

**Warning signs:**
- All moves doing "normal" damage regardless of type
- Ghost-type Pokemon taking damage from Normal moves
- Legendary battles feeling wrong (Zapdos should wreck Water types)

**Phase to address:** Battle engine phase (damage calculation). Write type effectiveness tests before integrating into damage formula.

---

### Pitfall 5: Damage Formula Modifier Order and Integer Rounding

**What goes wrong:**
The Pokemon damage formula applies multiple modifiers (STAB, type effectiveness, weather, critical hits, random roll) and requires specific integer truncation at specific steps. Getting the order wrong or floating-point rounding incorrectly produces damage values that diverge from real Pokemon games:

- The random roll (85-100%) must be applied AFTER type effectiveness, not before
- Each modifier is typically a 4096-denominator fraction in modern gens (Gen V+) to avoid compounding rounding errors
- STAB is 1.5x in most gens (floor to nearest integer after applying)
- Critical hits in Gen VIII+ are 1.5x, not 2x
- Spread moves in doubles get a 0.75x multiplier applied to the final damage, not to base power

A common mistake: applying `Math.floor()` after every single multiplication. The correct approach is to chain modifiers and floor only at the intermediate stages Showdown specifies.

**Why it happens:**
Developers implement the formula from Bulbapedia without noticing the specific truncation points. "Multiply by STAB and round" looks right but produces wrong values for edge cases.

**How to avoid:**
For v0.1 simplified combat, use this proven structure:
```typescript
function calcDamage(
  attackerLevel: number, attackStat: number, defenseStat: number,
  movePower: number, stab: boolean, effectiveness: number
): number {
  // Base damage (Gen V+ formula, simplified)
  const base = Math.floor(
    Math.floor((2 * attackerLevel / 5 + 2) * movePower * attackStat / defenseStat / 50) + 2
  );
  // Apply STAB
  const withStab = stab ? Math.floor(base * 1.5) : base;
  // Apply type effectiveness
  const withType = Math.floor(withStab * effectiveness);
  // Apply random roll (85-100%)
  const roll = (Math.floor(Math.random() * 16) + 85) / 100;
  return Math.max(1, Math.floor(withType * roll));
}
```
This is a deliberate simplification that matches Showdown output for typical cases. Do NOT attempt full Gen IX modifier chains for v0.1 — it's out of scope.

**Warning signs:**
- Damage output off by 1-3 HP compared to online calculators
- STAB bonus not applying (STAB multiplier of 1.5 rounds to 1 if applied prematurely)
- All moves doing the same damage regardless of type effectiveness

**Phase to address:** Battle engine phase. Write verification against known Showdown calc outputs.

---

### Pitfall 6: G2 Content Limit Silently Truncates Battle State

**What goes wrong:**
The G2 SDK allows a maximum of 1000 characters on page creation and 2000 characters on in-place updates. A battle status screen that tries to render both Pokemon names, HP bars, move names, and status info can easily exceed these limits. When the limit is exceeded, content is silently clipped — no error is thrown, display just cuts off mid-line.

For context: a typical battle HUD might look like:
```
Charizard  HP: 68%  [Tera: Fire]
vs
Blastoise  HP: 45%

> Flamethrower (90)
  Fly (90)
  Fire Blast (110)
  Slash (70)
```
That is approximately 140 characters. But if Pokemon names are long (e.g., "Fletchinder", "Talonflame") and move names are long ("Hydro Pump", "Psychic"), and you add turn counter + status conditions, you approach 300-400 characters easily. A full team listing (6 Pokemon with HP%) exceeds 500 characters.

**Why it happens:**
Developers build the display on desktop where content limits don't apply, then test on device and find the screen is half-blank. There's no visual error — just missing content.

**How to avoid:**
Define a strict character budget per screen:
- Battle HUD: max 400 chars (leave 600 as safety margin)
- Move selection list: each item should be under 30 chars ("Flamethrower 90 Fire" = 20 chars — fine)
- Team list: each item under 25 chars ("Charizard HP:68%" = 16 chars — fine)
- Never include full descriptions, flavor text, or move descriptions on the glasses display

Implement a content length assertion in development:
```typescript
function sendToGlasses(content: string, context: string): void {
  if (content.length > 900) {
    console.warn(`[G2] Content for "${context}" is ${content.length} chars — approaching 1000 limit`);
  }
  // ... send
}
```

**Warning signs:**
- Battle screen shows top content but bottom is cut off
- Switch screen shows some Pokemon but not all six
- Content looks fine in browser dev tools but truncated on actual glasses

**Phase to address:** Display/rendering phase. Enforce character budgets from the first screen built.

---

### Pitfall 7: learnsets.json Is 3MB but Only ~10% Is Needed for One Battle

**What goes wrong:**
`learnsets.json` is 3.19MB (the largest file in the project at 76% of total data size). Vite bundles it as a static import, meaning the browser must parse the entire 3.19MB JSON object before any game logic can run. On a mid-range Android phone through the Even App WebView, parsing 3.19MB of JSON can take 800-1500ms.

The typical Vite dev build will inline this as a string literal in a chunk, and the production bundle will have it as a separate chunk — but even with code splitting, it must be parsed synchronously when the module loads.

**Why it happens:**
Developers do `import learnsets from './data/learnsets.json'` and Vite handles the rest. It works in dev (Chrome on desktop is fast). It works in CI. It only fails noticeably on the actual mobile WebView under real conditions.

**How to avoid:**
For v0.1 (random battles only), learnsets.json is used only during team generation (one-time at battle start). Strategies:

Option A — Lazy load on first use:
```typescript
let _learnsets: Record<string, any> | null = null;
async function getLearnsets() {
  if (!_learnsets) {
    const m = await import('./data/learnsets.json');
    _learnsets = m.default;
  }
  return _learnsets;
}
```

Option B — Pre-extract a randbats subset. The `@pkmn/randbats` project maintains a pre-extracted set of random battle sets (~80KB vs 3.19MB). Using this instead of computing from learnsets eliminates the need for learnsets.json entirely at runtime.

Option C — Compute the pre-filtered battle pool at build time using a Vite plugin that produces a small `randbats-pool.json` with only the data needed.

**Warning signs:**
- App feels "frozen" for 1-2 seconds after tapping "Enter Battle"
- Lighthouse performance score drops significantly
- Even App WebView process memory spikes on battle start

**Phase to address:** Data wiring phase. Decide on lazy-loading or pre-extraction before committing to import strategy.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode type chart as TypeScript object | No need to fix typechart.json | Incorrect if Showdown updates types (new Fairy additions, etc.) | Acceptable for v0.1 — type chart is stable |
| Use basePower=60 for all variable-power moves | Simplifies damage calc | Flavour-incorrect but functionally acceptable for random battles | Acceptable for v0.1 — mark TODO |
| Skip abilities/items entirely for v0.1 | Huge scope reduction | Battles feel less realistic | Explicitly in scope as "defer to v0.2" |
| Fixed random roll instead of 85-100% range | Deterministic testing | Battles feel same every time | Never in production — use for unit tests only |
| Not filtering `isNonstandard` from team pool | Faster implementation | CAP/Mega Pokemon appear in teams, sprites missing | Never — easy fix, no reason to skip |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Showdown CDN for sprites | Hardcoding `/sprites/gen5/charizard.png` — Gen 5 sprites only exist for original 151-649 | Check which generation a Pokemon was introduced, use appropriate sprite path or fall back to Gen 5 animated |
| Showdown data files (.ts vs .js vs .json) | Fetching `.json` endpoints that don't exist (see Pitfall 1) | Fetch `.js` format from `play.pokemonshowdown.com/data/` and strip the CommonJS wrapper |
| G2 EvenAppBridge | Calling bridge methods before the WebView signals readiness | Listen for the `evenapp:ready` event before sending any display commands |
| learnsets.json move codes | Treating `"8L9"` as a pure move ID | The prefix is encoded data: `8` = gen, `L` = learned by level, `9` = level number. Strip to get move ID |

---

## Performance Traps

Patterns that work at small scale but fail on constrained hardware.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Importing all 6 data files at module level | 1-2s load time on mobile WebView | Lazy-load learnsets.json specifically; keep pokedex/moves eager | On first load on mid-range Android |
| Rendering full move descriptions on glasses | Content truncated to 1000 char limit | Show only move name + base power + type (20-25 chars max) | Every time — display limit is always hit |
| Calling `Object.keys(pokedex).filter(...)` on every turn | UI jank every time player opens switch screen | Pre-compute battle pool once at team generation time | At 60fps if called in render loop |
| Storing full Pokemon objects (with all learnset data) in battle state | Memory bloat | Store only battle-relevant fields: name, types, stats, currentHP, moves | On lower-memory devices |

---

## UX Pitfalls

Common user experience mistakes specific to this display platform.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing "HP: 234/340" on glasses | Too long for constrained display, hard to read at glance | Show "HP: 68%" — percentage is all a player needs mid-battle |
| Listing move names only without type/power | Player can't make informed choices | Format as "Flamethrower Fire 90" or "Flamethrower (90)" — fits in ~25 chars |
| Showing "Use move" as only battle option | Players may want to switch or Terastallize | Present three top-level options first: Attack / Switch / Terastallize |
| Waiting for full animation timing (simulating real Pokemon timing) | G2 is text-only — artificial delays feel broken | Show results immediately, then poll for next input |
| Displaying full evolution chains or Pokedex flavor text | Wastes character budget, buries useful info | No flavor text anywhere on glasses — game-relevant data only |

---

## "Looks Done But Isn't" Checklist

Things that appear complete in browser but have critical gaps on device.

- [ ] **Data files**: Verify each `.json` file actually parses as JSON (`JSON.parse(fs.readFileSync(...))` in a test script) — abilities.json, items.json, and typechart.json are currently broken
- [ ] **Type effectiveness**: Run known matchup unit tests before integrating into damage calc — normal/ghost immunity, dual-type multipliers
- [ ] **Team generation**: Generate 20+ teams and inspect for CAP Pokemon, Mega formes, and battle-only formes appearing
- [ ] **Variable-power moves**: Check that at least Gyro Ball, Endeavor, Counter are handled (not dealing 0 damage)
- [ ] **Character budget**: Measure every screen's character count in the actual JSON payload sent to glasses — not the rendered HTML
- [ ] **Fainting detection**: Test case where both Pokemon faint simultaneously (e.g., recoil damage + attacker KO)
- [ ] **PP depletion**: Verify that after 4 PP moves are used, Struggle activates (or moves are blocked) — not a silent infinite loop
- [ ] **Full 6v6 battle**: Complete a full 12-Pokemon battle to end screen without crash — happy path test

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Broken data files (404 HTML) | LOW | Re-fetch from correct CDN paths; validate with JSON.parse before committing |
| Variable-power move deals 0 damage | LOW | Add to fallback table; no state migration needed |
| isNonstandard Pokemon in team | LOW | Add filter; regenerate team |
| Content truncation on glasses | MEDIUM | Audit all screen renders, apply character budget; may require restructuring display components |
| learnsets.json blocking initial load | MEDIUM | Switch from static import to dynamic import(); no logic changes needed |
| Damage formula rounding error | MEDIUM | Fix formula, verify against calc.pokemonshowdown.com reference; existing battles in flight are invalid |
| Battle state corruption (invalid turn) | HIGH | Requires battle engine rewrite if state machine was not built with explicit transitions; mitigate by using explicit state enum from day one |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Broken data files (404 HTML) | Data wiring (Phase 1) | `node -e "JSON.parse(require('fs').readFileSync('./src/data/X.json','utf8'))"` passes for all 6 files |
| Variable-power moves as 0 damage | Battle engine (damage calc phase) | Unit test: `calcDamage('endeavor', ...)` returns > 0 |
| isNonstandard Pokemon in teams | Team generation phase | Generate 100 teams, confirm zero CAP/Mega entries |
| Type effectiveness lookup | Battle engine (damage calc phase) | 10-point unit test suite of known matchups all pass |
| Damage formula rounding | Battle engine (damage calc phase) | Output matches calc.pokemonshowdown.com for 5 reference matchups |
| G2 content limit truncation | Display/rendering phase | Assert `content.length < 900` for every screen type |
| learnsets.json load perf | Data wiring (Phase 1) | Measure time-to-interactive on actual phone; must be under 500ms |
| Battle-only formes in teams | Team generation phase | Check `battleOnly` field filter in team generator |
| Battle state invalid transitions | Battle engine (state machine phase) | Enumerate all valid state transitions in code as typed enum; no raw string states |

---

## Sources

- Direct inspection of `src/data/*.json` files in this project (HIGH confidence — primary source)
- [Bulbapedia: Damage calculation formula Gen V+](https://bulbapedia.bulbagarden.net/wiki/Damage) — modifier order and rounding rules (HIGH confidence)
- [Pokemon Showdown FORMES.md](https://github.com/smogon/pokemon-showdown/blob/master/data/FORMES.md) — battleOnly and cosmetic forme quirks (HIGH confidence)
- [Pokemon Showdown DEX.md](https://github.com/smogon/pokemon-showdown/blob/master/sim/DEX.md) — isNonstandard field values and exists behavior (HIGH confidence)
- [Smogon Damage Calculator forum](https://www.smogon.com/forums/threads/pok%C3%A9mon-showdown-damage-calculator.3593546/) — real-world bugs in damage implementations (MEDIUM confidence)
- [DeepWiki: PS Random Team Generation](https://deepwiki.com/smogon/pokemon-showdown/3.3-random-team-generation) — team generation edge cases (MEDIUM confidence)
- [GitHub Issue #10187: Invalid Generated Team For Format](https://github.com/smogon/pokemon-showdown/issues/10187) — format-specific team validation failures (MEDIUM confidence)
- [even-g2-notes/G2.md](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) — G2 display constraints, content limits, input event quirks (HIGH confidence)
- [pkmn/randbats](https://github.com/pkmn/randbats) — pre-extracted random battle sets as alternative to learnsets.json (MEDIUM confidence)

---
*Pitfalls research for: Pokemon Showdown random battle simulator on G2 glasses*
*Researched: 2026-02-26*
