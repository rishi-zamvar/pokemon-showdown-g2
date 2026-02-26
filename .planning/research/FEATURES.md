# Feature Research

**Domain:** Pokemon Showdown Random Battle Simulator for G2 Glasses
**Researched:** 2026-02-26
**Confidence:** MEDIUM — Core battle mechanics verified via Bulbapedia and Smogon official sources; random battle team generation verified via Showdown source code (teams.ts). Some implementation details (e.g. exact Tera type assignment in random battles) rely on secondary sources.

---

## How Random Battles Work

This section answers the upstream research questions before mapping features.

### 1. Random Team Generation

**Source: Showdown teams.ts source (HIGH confidence), Smogon randbats docs (MEDIUM confidence)**

- **Team size:** 6 Pokemon per side
- **Pokemon pool:** All fully evolved Pokemon + some viable NFE (e.g. Chansey, Porygon2). Gen 9 random battle uses OU, UU, RU, NU, PU tiers — no Ubers by default in standard randbats
- **Levels:** Tier-based scaling. Approximate mapping: Uber=76, OU=80, UU=82, RU=84, NU=86, PU/NFE=88. Monthly win-rate adjustments (±1-3 levels per month) keep all Pokemon near 50% win rate on ladder
- **EVs:** 85 in every stat, neutral nature (unless 0 Atk/Spe IVs beneficial). HP EVs may be adjusted to optimize Stealth Rock switch-in counts
- **IVs:** 31 in all stats (perfect IVs standard)
- **Moves:** 4 moves per Pokemon. Selected via role system ("Wallbreaker," "Bulky Attacker," etc.) — enforces STAB moves first, then coverage, setup, or recovery based on role. Some Pokemon have hardcoded rules (e.g. Dragonite always gets Outrage)
- **Abilities:** Filtered to synergize with assigned moves and role. Weather abilities excluded if no weather setter on team
- **Items:** Priority items assigned first (Assault Vest for certain builds). Remaining assigned by move synergy and stats. Rules: 2 or fewer attacks → Leftovers (Black Sludge if Poison-type); 3 attacks with weak bulk → Life Orb; Trick/Switcheroo users → Choice item; specific speed range → Choice Scarf
- **Tera types:** In Gen 9 randbats, each Pokemon has a pre-assigned Tera type from its role's set options (sourced from the hourly simulation that generates 100,000 teams). Tera type is known to the player holding the Pokemon

### 2. Battle Flow

**Source: Bulbapedia damage article (HIGH confidence), Cave of Dragonflies mechanics (HIGH confidence)**

**Turn structure (each turn):**
1. Both sides choose an action (move or switch)
2. Switches resolve first (before any moves)
3. Moves execute in priority bracket order:
   - Higher priority value = moves first (e.g. Quick Attack +1 > normal 0 > Trick Room -7)
   - Within same priority: higher Speed stat moves first
   - Speed tie: random coin flip
4. End-of-turn effects (weather, status damage, Leftovers healing)

**Damage formula (Gen 5+):**

```
Damage = floor(((2 × Level / 5 + 2) × Power × Atk / Def / 50) + 2) × modifiers
```

Modifiers applied in sequence:
- **Type effectiveness:** 0.25x / 0.5x / 1x / 2x / 4x (based on defender's type(s))
- **STAB:** 1.5x if move type matches attacker's type(s). 2x if attacker has Adaptability ability
- **Critical hit:** 1.5x damage (Generation 6+). Base crit rate ~4.17% (1 in 24)
- **Random factor:** Multiply by random integer 85-100 then divide by 100 (so damage varies ±15%)
- **Physical vs Special:** Physical moves use Atk vs Def; Special moves use SpAtk vs SpDef
- **Burn:** Halves physical damage output for burned Pokemon
- **Screens (Reflect/Light Screen):** Halve damage from respective category

**Fainting:** When HP reaches 0, Pokemon faints. Controlling player must switch in a replacement (if any remain). If all 6 faint, that player loses.

**Win condition:** KO all 6 of opponent's Pokemon.

### 3. Terastallization

**Source: Bulbapedia Terastallization article (HIGH confidence)**

- **Usage:** Once per battle per player. Activated as an action on the player's turn (replaces move selection for that action — the Pokemon Terastallizes AND uses a move in the same turn, but the Tera action has no priority modifier)
- **Effect on type:** Pokemon's defensive and offensive type becomes solely its Tera type. Original types are overridden for type-effectiveness calculations
- **Effect on STAB:**
  - If Tera type differs from original types: only Tera type gets STAB (1.5x)
  - If Tera type matches one original type: that type gets 2x (Adaptability-level boost)
  - If Tera type matches both original types (dual-type): same 2x boost on matched type
  - Original STAB types still apply for moves — if original type move used while Tera'd, it still gets 1.5x STAB if original type ≠ Tera type
- **Duration:** Permanent for the rest of battle (survives switching out, stays until the Pokemon faints)
- **Move base power minimum:** Moves of the Tera type with base power below 60 are boosted to 60 BP minimum
- **In random battles:** Each Pokemon has a pre-assigned Tera type. Player chooses when (or whether) to use it

### 4. AI Opponent

**Source: Multiple AI research papers and Smogon community discussions (MEDIUM confidence)**

Showdown's own built-in AI (for challenge mode vs CPU) uses a **heuristic approach**:
- Evaluates each available move based on expected damage output
- Prefers super-effective moves
- Switches when type disadvantage is severe
- Does NOT do deep minimax search (too expensive per turn)

For a v0.1 implementation, a simple heuristic AI is appropriate:
- Calculate expected damage for each move against current target
- Pick the highest-damage move with some randomness to be less predictable
- Switch if all moves are resisted and a better matchup exists

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features without which "the battle doesn't work" on G2 glasses.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Random team generation (6v6) | Core format — no teams = no battle | MEDIUM | Pull from Showdown data files already downloaded. Level per tier, 85 EVs, preset moves/ability/item per role |
| Battle state engine | Tracks HP, active Pokemon, turn count, faint state | HIGH | Damage calc, turn order, switching enforcement on faint |
| Damage calculation (base formula) | Without this, battles have no outcome | MEDIUM | `((2*L/5+2)*Power*A/D/50)+2` with type effectiveness and STAB. No items/abilities for v0.1 |
| Type effectiveness (18x18 chart) | Determines core battle strategy | LOW | Typechart already downloaded to src/data/typechart.json — just read and apply |
| STAB multiplier (1.5x) | Core mechanic — every Pokemon uses STAB moves | LOW | Check if move type matches attacker type(s); multiply by 1.5 |
| Turn structure (both sides pick, execute by speed) | Without turn order, game is incoherent | MEDIUM | Both player and AI pick action, resolve switches first, then moves by Speed stat |
| HP tracking and faint detection | Without faints, battle never ends | LOW | Track current HP as integer; detect 0; force switch screen |
| Forced switch on faint | Player must select replacement | LOW | Trigger switch screen when active Pokemon faints |
| Win/loss detection | Without end condition, game loops forever | LOW | Detect when all 6 on either side have fainted |
| Attack selection screen (4 moves) | Player must choose a move each turn | LOW | Vertical list of 4 move names, tap to select; display name + type + base power |
| Switch Pokemon screen (6 Pokemon) | Player must be able to switch | LOW | Vertical list of up to 6 Pokemon with name + HP%; already fainted = greyed out or skip |
| Battle HUD (both Pokemon, name + HP%) | Player needs to know game state | LOW | G2 display shows: own Pokemon name+HP, opponent name+HP. Already defined in PROJECT.md |
| AI opponent (basic heuristic) | Without an opponent, nothing to play against | MEDIUM | Choose highest-damage move; switch if current matchup is very bad |
| Terastallization option in menu | Listed as target feature in PROJECT.md | MEDIUM | Add "Terastallize" to action menu; change active type; one use per battle |
| Critical hits (4% chance, 1.5x) | Part of damage formula; random battles rely on randomness | LOW | Roll 1/24 chance; multiply damage by 1.5 |
| Random damage roll (85-100%) | Without this, same move always deals same damage | LOW | `Math.floor(damage * (85 + Math.random()*15) / 100)` |
| Physical vs Special move distinction | Without this, damage calc is wrong for half of moves | LOW | Check move.category in moves.json; use Atk vs SpAtk accordingly |

### Differentiators (Nice to Have, Deferrable)

Features that improve the experience but don't block a working battle.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Status conditions (burn, paralysis, sleep, freeze, poison) | Adds strategic depth | HIGH | Affects damage output, turn skip, speed halving. Deferred per PROJECT.md |
| Abilities active effects | Many abilities change battle math (Intimidate, Levitate, etc.) | HIGH | Deferred per PROJECT.md. Could silently ignore for v0.1 |
| Held items active effects | Life Orb, Choice Band, Leftovers healing all matter | HIGH | Deferred per PROJECT.md |
| Move effect display ("Super effective!", "Not very effective!") | Tells player how their move landed | LOW | Display effectiveness label after damage; no extra logic needed |
| Remaining team count display | Lets player track how many Pokemon remain | LOW | Show "Player: 3/6 | AI: 4/6" on HUD |
| Accuracy rolls (missing moves) | Some moves have <100% accuracy | MEDIUM | Apply accuracy * evasion; miss = 0 damage. Adds realism but complicates flow |
| Priority move handling (Quick Attack, Protect) | Correct turn ordering for priority moves | MEDIUM | Requires move priority data from moves.json; already in dataset |
| Switching mid-battle (not forced, voluntary) | Strategic play — change matchup | LOW | Switch screen accessible from main action menu, not just on faint |
| Tera type display for opponent | Hints at what Tera type opponent may use | LOW | Could show "?" or known type from game data |
| Battle log / move announcements | "Pikachu used Thunderbolt! It's super effective!" | MEDIUM | Adds narrative feel; needs text queue on G2 display |
| Speed tie display | Clarify when random tie-break decided order | LOW | Minor UX improvement |

### Anti-Features (Do NOT Build for v0.1)

Features that seem like improvements but would bloat scope, introduce bugs, or fight the G2 display constraints.

| Anti-Feature | Why Requested | Why Avoid for v0.1 | Alternative |
|--------------|---------------|---------------------|-------------|
| Full battle animations / move visuals | Feels more like real game | G2 is monochrome text/list only — animations impossible. Text descriptions are the medium | Use text like "Pikachu used Thunderbolt" |
| Full status effect system | More accurate to real Pokemon | 6 status types × interaction with every ability = 50+ edge cases. Deferred in PROJECT.md | Build after core loop works |
| Full ability interactions | Abilities dramatically change outcomes | 200+ abilities, most with unique logic. Pre-assigned by randbats but silently ignoring is valid for v0.1 | Apply only abilities that are trivially passive (Swift Swim speed boost can wait) |
| Full item effects | Choice Band, Life Orb, etc. matter competitively | Held items are team-gen flavor but applying them correctly requires damage calc branching. Deferred in PROJECT.md | Generate teams with items but don't apply item effects in combat |
| Multi-target / spread moves | Doubles/triples mechanics (e.g. Earthquake hits all) | v0.1 is singles only — irrelevant. Would add format complexity | Single target only |
| Online multiplayer | More engaging | Requires websocket server, matchmaking, latency handling. Not in scope | Single player vs AI only |
| Custom team builder | Power user feature | Contradicts "random battle" format entirely | Random only for v0.1 |
| Detailed stat display screen | Competitive players want to see base stats, EVs | Screen real estate on G2 is extremely limited; 8 lines max | Show only HP% in HUD; full stat screen deferred |
| Form changes (Aegislash, Rotom) | Technically accurate | Form logic requires additional state tracking and sprite swaps | Use base form for v0.1 |
| Weather effects (Rain, Sun, Sand, Hail) | Many team sets include weather setters | Weather multipliers + end-of-turn damage = multiple edge cases. Interacts with abilities | Ignore weather for v0.1 |
| Z-Moves / Mega Evolution | Legacy mechanics still in some randbat formats | Gen 9 format doesn't use them. Only relevant for older gen formats | Use Gen 9 format only for v0.1 |
| Stellar Tera type | Advanced Tera type that works differently | Special case with unique damage math — adds complexity for rare edge case | Exclude Stellar type from Tera pool for v0.1 |

---

## Feature Dependencies

```
[Type chart data (typechart.json)]
    └──required by──> [Type effectiveness calculation]
                          └──required by──> [Damage calculation]
                                                └──required by──> [HP tracking]
                                                                      └──required by──> [Faint detection]
                                                                                            └──required by──> [Win/loss detection]

[Pokemon data (pokedex.json + moves.json + learnsets.json)]
    └──required by──> [Random team generation]
                          └──required by──> [Battle state engine]

[Battle state engine]
    └──required by──> [Attack selection screen]
    └──required by──> [Switch screen]
    └──required by──> [Battle HUD]
    └──required by──> [AI opponent]
    └──required by──> [Terastallization option]

[Terastallization]
    └──enhances──> [Damage calculation] (changes attacker's STAB type mid-battle)
    └──depends on──> [Battle state engine] (needs "tera used" flag per player)

[AI opponent]
    └──depends on──> [Damage calculation] (to evaluate moves)
    └──depends on──> [Battle state engine] (to read game state)
    └──depends on──> [Type effectiveness calculation] (to pick super-effective moves)

[Forced switch on faint]
    └──depends on──> [Faint detection]
    └──triggers──> [Switch screen]
```

### Dependency Notes

- **Damage calc requires type chart:** Cannot calculate damage without knowing type effectiveness. Fortunately typechart.json is already downloaded
- **All screens require battle state:** The HUD, attack screen, and switch screen are all read-only views of the battle state object — build state first, screens second
- **Terastallization changes type mid-battle:** Damage calc must re-check the active Pokemon's current type (which may be Tera type) each turn — use a `currentType` field that overrides base type when tera'd
- **AI depends on full calc pipeline:** The AI needs to score each move by expected damage, which requires the same calc path the player uses
- **Faint → forced switch is a special flow:** When Pokemon faints, the normal "pick action" flow is interrupted — player must switch before turn continues. This is a different screen state than voluntary switching

---

## MVP Definition

### Launch With (v0.1)

Minimum for a complete, playable random battle on G2 glasses.

- [ ] Random team generation (6v6, Gen 9 format, levels by tier, 85 EVs, 31 IVs, 4 moves, ability, item ignored for combat) — cannot start battle without teams
- [ ] Battle state engine (tracks active Pokemon, HP, whose turn, fainted flags) — core of everything
- [ ] Damage calculation (base formula + type effectiveness + STAB + crit roll + random roll) — determines outcomes
- [ ] Physical vs Special move routing — prerequisite for correct damage calc
- [ ] Turn structure (both pick action, switches resolve first, then moves by Speed) — defines game flow
- [ ] Faint detection and forced switch — without this, battle gets stuck
- [ ] Win/loss detection and battle end screen — without this, game never ends
- [ ] Battle HUD (own Pokemon name+HP%, opponent name+HP%) — player needs situational awareness
- [ ] Attack selection screen (4 move names + type + BP, vertical list) — main player action
- [ ] Switch Pokemon screen (6 Pokemon, name+HP%, skip fainted) — required for forced switch and voluntary switch
- [ ] Terastallization option in action menu (one use per player per battle, changes active type) — listed as v0.1 target in PROJECT.md
- [ ] AI opponent (score moves by expected damage, prefer super-effective, switch if all moves resisted) — single-player requires an opponent
- [ ] Voluntary switching (from action menu, not just on faint) — without this, switching is only reactive

### Add After Validation (v1.x)

Add once v0.1 battle loop is confirmed working and fun.

- [ ] Move effect text / battle log ("Super effective!" etc.) — adds game feel, low effort after core works
- [ ] Status conditions (burn, paralysis, sleep, freeze, poison) — significantly expands strategy
- [ ] Accuracy rolls (moves can miss) — adds realism; some moves only relevant with this (e.g. Blizzard 70% accuracy)
- [ ] Active item effects (Life Orb, Leftovers, Choice Band) — teams are generated with items; time to apply them
- [ ] Remaining team count display in HUD — small but meaningful HUD improvement
- [ ] Priority move system (Quick Attack first, Trick Room reversal) — already have priority data in moves.json

### Future Consideration (v2+)

Defer until product-market fit established or explicitly requested.

- [ ] Full ability interactions — adds strategic depth but significant edge cases
- [ ] Weather / terrain effects — complex interaction surface
- [ ] Multiple generations (Gen 1-8 random battle formats) — different mechanics per gen
- [ ] Stellar Tera type — edge case Tera variant
- [ ] Form changes (Aegislash stance, Rotom forms) — significant state complexity
- [ ] Online multiplayer vs other players — requires server infrastructure

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Random team generation | HIGH | MEDIUM | P1 |
| Battle state engine | HIGH | HIGH | P1 |
| Damage calculation | HIGH | MEDIUM | P1 |
| Turn structure | HIGH | MEDIUM | P1 |
| Battle HUD | HIGH | LOW | P1 |
| Attack selection screen | HIGH | LOW | P1 |
| Switch screen | HIGH | LOW | P1 |
| Faint detection + forced switch | HIGH | LOW | P1 |
| Win/loss detection | HIGH | LOW | P1 |
| AI opponent (basic heuristic) | HIGH | MEDIUM | P1 |
| Terastallization | MEDIUM | MEDIUM | P1 (in PROJECT.md scope) |
| Voluntary switching | MEDIUM | LOW | P1 |
| Physical vs Special routing | HIGH | LOW | P1 (part of damage calc) |
| Move effect text | MEDIUM | LOW | P2 |
| Status conditions | MEDIUM | HIGH | P2 |
| Accuracy rolls | LOW | MEDIUM | P2 |
| Item effects | MEDIUM | HIGH | P2 |
| Remaining team count in HUD | LOW | LOW | P2 |
| Priority move handling | LOW | MEDIUM | P2 |
| Full ability interactions | LOW | HIGH | P3 |
| Weather/terrain effects | LOW | HIGH | P3 |
| Multi-gen support | LOW | HIGH | P3 |
| Online multiplayer | HIGH (long-term) | HIGH | P3 |

**Priority key:**
- P1: Must have for v0.1 launch
- P2: Should have, add in v1.x
- P3: Nice to have, v2+ consideration

---

## Competitor Feature Analysis

For a G2 glasses Pokemon battle simulator, the relevant "competitors" are reference implementations to calibrate against.

| Feature | Full Pokemon Showdown (web) | Typical fan game | Our G2 v0.1 Approach |
|---------|-----------------------------|--------------------|----------------------|
| Team generation | Full randbats algorithm with roles, IVs, items, abilities | Manual team builder | Simplified randbats: levels by tier, 85 EVs, 31 IVs, 4 moves per role, items generated but not applied |
| Damage calc | Full formula with all modifiers | Approximate | Base formula + type effectiveness + STAB + crit + random roll |
| Status effects | Full 6-condition system | Partial | None in v0.1 |
| Abilities | 200+ abilities fully implemented | Few key ones | None in v0.1 |
| Items | 100+ items with effects | Few key ones | Generated for flavor, not applied |
| Tera | Full Tera system including Stellar type | N/A | Core Tera (type change, STAB adjustment), no Stellar |
| AI | Heuristic + ladder opponents | Basic random | Basic heuristic: prefer highest expected damage, occasional switch |
| UI | Rich web interface, animations | Varies | G2 text/list only — names, HP%, move list |
| Turn display | Real-time with animations | Varies | Sequential text states via G2 SDK containers |

---

## Terastallization Implementation Notes

This mechanic needs special attention because it interacts with the damage pipeline.

**What changes when Tera is activated:**
1. `pokemon.activeType = pokemon.teraType` (replaces `pokemon.types[]` for all calculations)
2. STAB check: `if move.type === pokemon.teraType → 1.5x` (or 2x if also an original type)
3. Move base power floor: `if move.type === pokemon.teraType && move.basePower < 60 → basePower = 60`
4. Defensive type matching: use `pokemon.teraType` as single type for incoming damage calc

**State to track:**
- `player.teraUsed: boolean` — only one use per player per battle
- `pokemon.isTera: boolean` — whether current active Pokemon is currently Tera'd
- `pokemon.teraType: string` — the Tera type assigned at team generation

**When to offer Tera option:**
- Add "Terastallize" as a checkbox/toggle option before move selection
- Once `player.teraUsed = true`, do not show the option again
- AI can use its Tera based on same heuristic (use when it would flip a matchup from resist to neutral or STAB)

---

## Sources

- [Random Formats on Pokemon Showdown - Smogon University](https://www.smogon.com/articles/random-formats-overview) — Format overview, team composition rules (MEDIUM confidence)
- [Random Team Generation - DeepWiki (smogon/pokemon-showdown)](https://deepwiki.com/smogon/pokemon-showdown/3.3-random-team-generation) — Source code-based team gen documentation (MEDIUM confidence)
- [smogon/pokemon-showdown teams.ts on GitHub](https://github.com/smogon/pokemon-showdown/blob/master/data/random-battles/gen9/teams.ts) — Authoritative source for level assignment, EV/IV rules, item/move/ability logic (HIGH confidence via source code)
- [Random Battles Level Balancing - Smogon Forums](https://www.smogon.com/forums/threads/random-battles-level-balancing.3721211/) — Win-rate based monthly level adjustment system (MEDIUM confidence)
- [Damage - Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Damage) — Official damage formula, type effectiveness multipliers, STAB, critical hits, random factor (HIGH confidence)
- [Terastallization - Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Terastallization) — Tera type change mechanics, STAB interactions, duration, one-use-per-battle rule (HIGH confidence)
- [Battle Mechanics - Cave of Dragonflies](https://www.dragonflycave.com/mechanics/battle/) — Turn structure, speed/priority ordering, damage formula verification (HIGH confidence)
- [Same-type attack bonus - Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Same-type_attack_bonus) — STAB multiplier 1.5x (2x with Adaptability) (HIGH confidence)
- [Programming AI for Pokemon Showdown - Game Developer](https://www.gamedeveloper.com/programming/programming-ai-for-pokemon-showdown-bot-battle-royale-) — AI heuristic approaches, random vs heuristic vs minimax comparison (MEDIUM confidence)
- [randbats - pkmn.github.io](https://pkmn.github.io/randbats/) — Auto-updated Gen 9 random battle set data (MEDIUM confidence)

---
*Feature research for: Pokemon Showdown Random Battle Simulator on G2 Glasses*
*Researched: 2026-02-26*
