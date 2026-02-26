# Phase 3: Battle Engine - Research

**Researched:** 2026-02-26
**Domain:** Pokemon Gen 9 turn-based battle state machine, @smogon/calc integration
**Confidence:** HIGH

---

## Summary

Phase 3 builds a pure turn-state machine: `BattleEngine.submitAction()` takes a `BattleState` + player action, resolves a full turn, and returns a new immutable `BattleState`. No rendering; the engine is a pure function of state.

The heavy lifting — damage numbers — is delegated entirely to `@smogon/calc`'s `calculate()` function, which already handles STAB, type effectiveness, crits, Terastallization, burn halving, and the 16-roll random bracket. The engine's responsibility is to call `calculate()` with the right inputs, apply the resulting HP delta, and manage state machine transitions (action queuing, faint handling, status ticks, win detection).

The existing codebase already has `BattlePokemon` (with `calcSpecies`, `teraType`, stats), `TeamGenerator`, and `DataLoader` — the engine builds directly on top of these without changes.

**Primary recommendation:** Implement `BattleState` as a plain TypeScript interface with no mutable methods; use structural spread (`{ ...state, playerSide: { ...state.playerSide, ... } }`) for all state updates so every `submitAction()` call produces a fresh object.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@smogon/calc` | already installed | Damage calculation | Official community calc; handles Gen 9 formula, Tera, STAB, crits |
| TypeScript | already in project | State types, type safety | Already the project language |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@pkmn/sim` `Dex` | already installed | Type lookup / move data | DataLoader already uses it; can cross-check move category |
| DataLoader (project) | local | Move metadata (pp, accuracy, type, category) | Look up move data by slug before calculating |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Immutable spread | Immer | Immer is cleaner for deep updates but adds a dep; spread is zero-cost for 6-mon teams |
| Own damage formula | @smogon/calc | Never roll own — @smogon/calc is authoritative and maintained |

### Installation

No new packages needed. Both `@smogon/calc` and `@pkmn/sim` are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/battle/
├── BattleEngine.ts      # Primary export: submitAction(), startBattle()
├── DamageCalc.ts        # Thin wrapper around @smogon/calc calculate()
├── StatusEngine.ts      # Per-turn status effects (burn tick, paralysis check, etc.)
├── TurnResolver.ts      # Turn ordering, action queue, faint handling
├── TeamGenerator.ts     # Already exists (Phase 2)
└── BattleEngine.test.ts # Vitest unit tests
src/types/
├── battle.ts            # Already has BattlePokemon — extend with BattleState, BattlePhase
└── battleState.ts       # Or inline into battle.ts
```

### BattleState Interface Design

```typescript
// Source: design derived from @smogon/calc State.Pokemon fields + PS mechanics
export type BattlePhase =
  | 'WAITING_FOR_ACTION'   // player must submit action
  | 'RESOLVING_TURN'       // internal — engine is processing
  | 'WAITING_FOR_SWITCH'   // forced switch after faint
  | 'BATTLE_OVER';         // win/loss determined

export type StatusCondition = 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | '';

export interface ActivePokemon extends BattlePokemon {
  currentHp: number;           // mutable runtime HP (starts at stats.hp)
  status: StatusCondition;     // '' = none
  toxicCounter: number;        // ticks from 1 for toxic, 0 otherwise
  sleepTurns: number;          // turns remaining asleep (2-4 random on inflict)
  teraActive: boolean;         // has Terastallization been used on this Pokemon
  ppUsed: Record<string, number>; // moveSlug -> pp spent (0 at start)
  fainted: boolean;
}

export interface BattleSide {
  team: ActivePokemon[];       // 6 Pokemon, order preserved
  activeIndex: number;         // index into team of current active Pokemon
  teraUsed: boolean;           // flag: Tera crystal used this battle (once per side)
}

export type PlayerAction =
  | { type: 'ATTACK'; moveSlug: string; isTera?: boolean }
  | { type: 'SWITCH'; toIndex: number }
  | { type: 'TERA_ATTACK'; moveSlug: string };  // shorthand for attack + tera simultaneously

export interface TurnResult {
  nextState: BattleState;
  log: TurnLogEntry[];  // chronological events for UI consumption
}

export interface TurnLogEntry {
  kind: 'DAMAGE' | 'MISS' | 'FAINT' | 'STATUS_INFLICT' | 'STATUS_TICK'
       | 'SWITCH' | 'TERA' | 'WIN' | 'LOSS' | 'PP_OUT';
  actor: 'player' | 'opponent';
  detail: Record<string, unknown>;
}

export interface BattleState {
  readonly phase: BattlePhase;
  readonly playerSide: BattleSide;
  readonly opponentSide: BattleSide;
  readonly turnCount: number;
  readonly winner: 'player' | 'opponent' | null;
}
```

### Pattern 1: Immutable State Update

**What:** Every state mutation returns a new object via spread; prior state is never mutated.

**When to use:** Always. This ensures UI can diff states and engine is referentially transparent.

```typescript
// Source: derived from React/functional state patterns
function applyDamage(state: BattleState, side: 'playerSide' | 'opponentSide', damage: number): BattleState {
  const sideState = state[side];
  const idx = sideState.activeIndex;
  const pokemon = sideState.team[idx];
  const newHp = Math.max(0, pokemon.currentHp - damage);
  const fainted = newHp === 0;

  const newTeam = sideState.team.map((p, i) =>
    i === idx ? { ...p, currentHp: newHp, fainted } : p
  );

  return {
    ...state,
    [side]: { ...sideState, team: newTeam },
  };
}
```

### Pattern 2: @smogon/calc Integration for Damage

**What:** Construct temporary `Pokemon` and `Move` objects, call `calculate()`, extract the damage roll.

**When to use:** Every time an attack move is used.

```typescript
// Source: verified from @smogon/calc dist/index.d.ts + dist/state.d.ts
import { Generations, Pokemon as CalcPokemon, Move as CalcMove, calculate } from '@smogon/calc';

const GEN9 = Generations.get(9);

function computeDamage(
  attacker: ActivePokemon,
  defender: ActivePokemon,
  moveSlug: string,
  isCrit: boolean
): number {
  const calcAttacker = new CalcPokemon(GEN9, attacker.calcSpecies, {
    level: attacker.level,
    ability: attacker.ability as any,
    item: attacker.item as any,
    nature: attacker.nature as any,
    ivs: attacker.ivs,
    evs: attacker.evs,
    // teraType: set only when Tera is active
    teraType: attacker.teraActive ? (attacker.teraType as any) : undefined,
    status: attacker.status as any,
    curHP: attacker.currentHp,
  });

  const calcDefender = new CalcPokemon(GEN9, defender.calcSpecies, {
    level: defender.level,
    ability: defender.ability as any,
    item: defender.item as any,
    nature: defender.nature as any,
    ivs: defender.ivs,
    evs: defender.evs,
    teraType: defender.teraActive ? (defender.teraType as any) : undefined,
    status: defender.status as any,
    curHP: defender.currentHp,
  });

  const calcMove = new CalcMove(GEN9, moveSlug, { isCrit });

  const result = calculate(GEN9, calcAttacker, calcDefender, calcMove);

  // result.damage is number[] (16 rolls from 85-100% random bracket)
  // Pick the median roll (index 8 of 0-15) for deterministic behavior,
  // or pick random for variance. Use result.range() for [min, max].
  const rolls = result.damage as number[];
  return rolls[Math.floor(Math.random() * rolls.length)];
}
```

**Critical note:** `result.damage` is always a `number[]` of 16 values for normal moves in Gen 9. Call `result.range()` for `[min, max]`. Do NOT assume it is a single number.

### Pattern 3: Turn Resolution Order

**What:** Both sides choose actions; engine resolves in priority order.

**When to use:** Every `submitAction()` call.

```
Priority resolution order (highest to lowest):
1. Switches (player and/or opponent switch) — always before attacks
   - If both switch: resolve order (cosmetic; both happen)
2. Move priority bracket (e.g., Quick Attack +1 > Normal 0)
3. Speed stat (higher speed moves first within same priority bracket)
4. Speed tie: random 50/50 each turn
```

```typescript
// Source: Bulbapedia Priority + Gen 9 mechanics
function resolveTurnOrder(
  playerAction: PlayerAction,
  opponentAction: PlayerAction,
  playerActive: ActivePokemon,
  opponentActive: ActivePokemon,
  moveData: Map<string, MoveEntry>
): ('player' | 'opponent')[] {
  // Switches always first
  if (playerAction.type === 'SWITCH' && opponentAction.type === 'SWITCH') {
    return ['player', 'opponent']; // order doesn't matter for switches
  }
  if (playerAction.type === 'SWITCH') return ['player', 'opponent'];
  if (opponentAction.type === 'SWITCH') return ['opponent', 'player'];

  // Both attacking — compare priority then speed
  const playerPriority = moveData.get(
    (playerAction as { moveSlug: string }).moveSlug
  )?.priority ?? 0;
  const opponentPriority = moveData.get(
    (opponentAction as { moveSlug: string }).moveSlug
  )?.priority ?? 0;

  if (playerPriority !== opponentPriority) {
    return playerPriority > opponentPriority
      ? ['player', 'opponent']
      : ['opponent', 'player'];
  }

  // Same priority — compare speed (Paralysis does NOT affect speed in Gen 9,
  // but the stat itself may be modified by items/nature/EVs already in stats)
  const playerSpeed = playerActive.stats.spe;
  const opponentSpeed = opponentActive.stats.spe;

  if (playerSpeed > opponentSpeed) return ['player', 'opponent'];
  if (opponentSpeed > playerSpeed) return ['opponent', 'player'];

  // Tie: random
  return Math.random() < 0.5 ? ['player', 'opponent'] : ['opponent', 'player'];
}
```

**Important:** Paralysis in Gen 9 does NOT reduce the Speed stat. It only has a 25% chance to skip the move. The speed stat for turn-order is not modified by paralysis.

### Pattern 4: Status Condition Per-Turn Effects

**What:** After each Pokemon's move (or at end of turn), apply status ticks.

**Gen 9 status mechanics (verified via Bulbapedia + @smogon/calc source):**

| Status | @smogon/calc code | End-of-turn damage | Move restriction |
|--------|-------------------|--------------------|-----------------|
| `brn` | `'brn'` | 1/16 max HP | Physical moves deal 0.5x (handled by calc) |
| `par` | `'par'` | None | 25% chance to skip move each turn |
| `psn` | `'psn'` | 1/8 max HP | None |
| `tox` | `'tox'` | (1/16 * toxicCounter) max HP | None; counter++ each turn, resets to 1 on switch-in |
| `slp` | `'slp'` | None | Cannot move; wake after 2-4 turns (roll at inflict) |
| `frz` | `'frz'` | None | Cannot move; 20% thaw chance each turn |

```typescript
// Source: Bulbapedia Status condition article + @smogon/calc interface.d.ts
function applyEndOfTurnStatus(
  pokemon: ActivePokemon,
  side: BattleSide
): { newPokemon: ActivePokemon; damage: number } {
  let damage = 0;
  let newPokemon = { ...pokemon };

  switch (pokemon.status) {
    case 'brn':
      damage = Math.max(1, Math.floor(pokemon.stats.hp / 16));
      break;
    case 'psn':
      damage = Math.max(1, Math.floor(pokemon.stats.hp / 8));
      break;
    case 'tox':
      damage = Math.max(1, Math.floor((pokemon.stats.hp * pokemon.toxicCounter) / 16));
      newPokemon = { ...newPokemon, toxicCounter: pokemon.toxicCounter + 1 };
      break;
    // brn, par, slp, frz: no end-of-turn HP damage
  }

  const newHp = Math.max(0, pokemon.currentHp - damage);
  return {
    newPokemon: { ...newPokemon, currentHp: newHp, fainted: newHp === 0 },
    damage,
  };
}

// Check paralysis skip at move execution time
function isParalysisSkip(pokemon: ActivePokemon): boolean {
  return pokemon.status === 'par' && Math.random() < 0.25;
}

// Check freeze thaw at move execution time
function isFreezeThaw(pokemon: ActivePokemon): boolean {
  if (pokemon.status !== 'frz') return false;
  return Math.random() < 0.20; // 20% chance to thaw each turn
}
```

### Pattern 5: Accuracy Check

**What:** Before applying a move, roll accuracy against the move's accuracy value.

```typescript
// Source: derived from DataLoader MoveEntry.accuracy field + PS mechanics
function doesMoveHit(moveAccuracy: number | true): boolean {
  if (moveAccuracy === true) return true;    // "always hits" moves
  return Math.random() * 100 < moveAccuracy; // e.g., 90 accuracy = 90% hit
}
// Note: For v0.1 no evasion/accuracy stat stages (no boosts in scope).
```

### Pattern 6: Terastallization State

**What:** When a player uses Tera, set `teraActive = true` and `teraUsed = true` on the side.

```typescript
// @smogon/calc handles all Tera STAB/type logic automatically when teraType
// is set on the CalcPokemon constructor. The engine only needs to track:
// 1. Is Tera active for this Pokemon right now? (teraActive on ActivePokemon)
// 2. Has the player used their one Tera crystal? (teraUsed on BattleSide)

function applyTera(state: BattleState, side: 'playerSide' | 'opponentSide'): BattleState {
  const sideState = state[side];
  if (sideState.teraUsed) throw new Error('Tera already used this battle');

  const idx = sideState.activeIndex;
  const newTeam = sideState.team.map((p, i) =>
    i === idx ? { ...p, teraActive: true } : p
  );

  return {
    ...state,
    [side]: { ...sideState, team: newTeam, teraUsed: true },
  };
}
```

**Key @smogon/calc Tera STAB math (verified from util.js source):**

All in units of 4096 = 1.0x:
- Base: `4096`
- If move type matches original type: `+2048` → total `6144` = 1.5x
- If `teraType` matches move type: `+2048` → adds another `+2048`
- If both original AND tera type match: `4096 + 2048 + 2048 = 8192` = 2.0x
- If only tera type matches (no original type match): `4096 + 2048 = 6144` = 1.5x

**Implication:** Just pass `teraType` to the `CalcPokemon` constructor when `teraActive = true`. The library computes STAB correctly.

**Defensive type:** @smogon/calc also handles the defensive side: when a defender has `teraType` set, type effectiveness is computed against the tera type alone (not original types).

### Pattern 7: Faint and Forced Switch Handling

**What:** After any HP-reducing event, check for faint. If mid-turn faint, surviving side's next action plays out.

```typescript
// Source: PS mechanics / Bulbapedia damage article
function processFaint(state: BattleState): BattleState {
  const newPhase = hasForcedSwitch(state) ? 'WAITING_FOR_SWITCH' : 'WAITING_FOR_ACTION';
  return { ...state, phase: newPhase };
}

function hasForcedSwitch(state: BattleState): boolean {
  // Player or opponent active Pokemon fainted and has alive teammates
  const checkSide = (side: BattleSide) => {
    const active = side.team[side.activeIndex];
    return active.fainted && side.team.some(p => !p.fainted);
  };
  return checkSide(state.playerSide) || checkSide(state.opponentSide);
}

function isWon(state: BattleState): 'player' | 'opponent' | null {
  if (state.opponentSide.team.every(p => p.fainted)) return 'player';
  if (state.playerSide.team.every(p => p.fainted)) return 'opponent';
  return null;
}
```

### FSM States

```
WAITING_FOR_ACTION
    │  submitAction(playerAction) called
    ↓
RESOLVING_TURN (internal — never persisted)
    │
    ├─→ WAITING_FOR_SWITCH (if faint detected, alive teammates exist)
    │       │  submitSwitch(index) called
    │       └─→ WAITING_FOR_ACTION or BATTLE_OVER
    │
    └─→ WAITING_FOR_ACTION (normal end of turn)
    └─→ BATTLE_OVER (all 6 on one side fainted)
```

### Anti-Patterns to Avoid

- **Mutating `BattleState` in place:** UI diffs depend on referential inequality. Always spread.
- **Calling `@smogon/calc` with undefined ability/item:** Pass empty string `''` not `undefined` for missing items; the constructor has defaults but missing fields can cause silent wrong results.
- **Applying burn halving manually:** `@smogon/calc` already halves physical damage for burned attackers when `status: 'brn'` is set on the attacker. Do not apply another 0.5x.
- **Computing type effectiveness from the typechart manually:** For damage, `@smogon/calc` handles it. Only use `DataLoader.getTypechart()` for UI display purposes.
- **Using result.damage as a single number:** It is a `number[]` of 16 rolls. Always index into it or use `result.range()`.
- **Resetting `toxicCounter` to 0 on switch-out:** Per Gen 9 rules, toxic counter resets to 1 (not 0) when a badly poisoned Pokemon switches back in.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Damage formula | Custom damage calc | `@smogon/calc calculate()` | Handles STAB, Tera, crits, burn, 16-roll bracket, all Gen 9 edge cases |
| Type effectiveness chart | Custom lookup table | `@smogon/calc` via defender type | Already integrated; handles Tera defensive type change |
| STAB calculation | Manual 1.5x / 2x logic | `@smogon/calc` via `teraType` field | Handles same-type Tera 2.0x, Stellar, Adaptability correctly |
| Move category lookup | Manual check | `DataLoader.getMove(slug).category` | Already in `moves.json` |
| Move priority lookup | Manual check | `DataLoader.getMove(slug).priority` | Already in `moves.json` |
| PP tracking | Complex structure | `ppUsed: Record<string, number>` on `ActivePokemon` | Simple counter; compare against `DataLoader.getMove(slug).pp` |

**Key insight:** The complexity in Gen 9 damage is enormous (abilities, items, terrains, Tera). Do not attempt to replicate it. The engine's only job is to supply correct inputs to `@smogon/calc` and apply the returned HP delta.

---

## Common Pitfalls

### Pitfall 1: Paralysis Speed Reduction

**What goes wrong:** Assuming paralysis reduces the Speed stat (was true in Gen 1-5) and dividing `stats.spe` by 4 for turn ordering.
**Why it happens:** Old documentation / muscle memory from older games.
**How to avoid:** In Gen 6+ (and Gen 9), paralysis does NOT modify the Speed stat. The 1/4 skip chance is the only battle effect. Turn order uses the unmodified `stats.spe` value.
**Warning signs:** Paralyzed Pokemon always moving last regardless of their speed.

### Pitfall 2: Burn Halving Applied Twice

**What goes wrong:** Applying `damage * 0.5` after calling `calculate()` because the attacker is burned.
**Why it happens:** Not knowing that `@smogon/calc` reads the `status: 'brn'` field and applies the halving internally.
**How to avoid:** Set `status: 'brn'` on the attacker CalcPokemon and let the library handle it. Never post-process the result for burn.
**Warning signs:** Burned Pokemon dealing 1/4 normal damage instead of 1/2.

### Pitfall 3: Terastallization Not Passed to Defender

**What goes wrong:** Only setting `teraType` on the attacker, forgetting to set it on the defender.
**Why it happens:** Tera is most prominent as an offensive tool (STAB boost) so defensive case is missed.
**How to avoid:** When constructing CalcPokemon for both attacker and defender, check `teraActive` on each and set `teraType` accordingly. The defender's `teraType` changes which types hit it for what effectiveness.
**Warning signs:** A Tera Water Charizard still taking 4x from Water-type moves.

### Pitfall 4: result.damage is an Array

**What goes wrong:** Doing `const dmg = result.damage` then `defender.hp -= dmg` — TypeScript/JS does coercion but the number is wrong.
**Why it happens:** `result.damage` is typed as `Damage = number | number[] | [number, number] | [number[], number[]]`. In Gen 9 singles, it is always `number[]` of 16 values.
**How to avoid:** Always cast and index: `const rolls = result.damage as number[]; const dmg = rolls[randomIndex]`.
**Warning signs:** Pokemon taking NaN or concatenated-string damage.

### Pitfall 5: Forced Switch Phase Not Handled

**What goes wrong:** After a Pokemon faints mid-turn (e.g., both attack, first one kills second), the engine tries to process the second attack against a fainted Pokemon.
**Why it happens:** Treating the turn as a monolithic pipeline without faint checks between actions.
**How to avoid:** After each action in the turn resolution loop, check if any active Pokemon has `fainted`. If so, transition to `WAITING_FOR_SWITCH` before continuing. Skip remaining attacks from fainted Pokemon.
**Warning signs:** Dead Pokemon "attacking" or HP going below 0 without faint detection.

### Pitfall 6: Sleep Turns Already Determined at Inflict Time

**What goes wrong:** Re-rolling the sleep duration every turn ("should it wake up this turn?").
**Why it happens:** Misunderstanding the Gen 5+ mechanic.
**How to avoid:** When sleep is first inflicted, immediately roll `sleepTurns = 2 + Math.floor(Math.random() * 3)` (2-4 turns) and store it on `ActivePokemon`. Decrement each turn the Pokemon is asleep. Wake up when `sleepTurns` reaches 0.
**Warning signs:** Pokemon waking up too early or staying asleep forever.

### Pitfall 7: Toxic Counter Reset on Switch

**What goes wrong:** Setting `toxicCounter = 0` when a badly poisoned Pokemon switches out and back in.
**Why it happens:** Assumption that switching "restarts" poison.
**How to avoid:** On switch-in (whether forced or voluntary), reset `toxicCounter = 1` (not 0). The first turn of toxic after switching deals `1/16`, not `0/16`.
**Warning signs:** Toxic doing zero damage the first turn after a switch.

---

## Code Examples

### Minimal @smogon/calc calculate() Call

```typescript
// Source: verified from node_modules/@smogon/calc/dist/index.d.ts + state.d.ts
import { Generations, Pokemon as CalcPokemon, Move as CalcMove, calculate } from '@smogon/calc';

const GEN9 = Generations.get(9);

// Example: Pikachu uses Thunderbolt on Charizard
const attacker = new CalcPokemon(GEN9, 'Pikachu', {
  level: 88,
  ability: 'Static',
  nature: 'Timid',
  evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  // teraType: undefined (not Terastallized)
  status: '',
});

const defender = new CalcPokemon(GEN9, 'Charizard', {
  level: 84,
  ability: 'Blaze',
  nature: 'Modest',
  evs: { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  status: '',
  curHP: 280, // current HP for accurate result.range() % display
});

const move = new CalcMove(GEN9, 'Thunderbolt', {
  isCrit: false,  // set true for guaranteed crit
});

const result = calculate(GEN9, attacker, defender, move);

// result.damage is number[] — 16 rolls (85%, 86%, ..., 100% of base damage)
const rolls = result.damage as number[];
const minDamage = rolls[0];
const maxDamage = rolls[15];
// For game simulation: pick a random roll
const actualDamage = rolls[Math.floor(Math.random() * 16)];

console.log(result.desc()); // "88 Timid Pikachu Thunderbolt vs. 84 Modest Charizard: 156-186 (53.2 - 63.5%) ..."
```

### Terastallization Example

```typescript
// Source: verified from @smogon/calc dist/mechanics/util.js getStabMod()

// Charizard Tera-Fire: original type is Fire/Flying, Tera type is Fire
// STAB calc: 4096 (base) + 2048 (original type match) + 2048 (tera match) = 8192 = 2.0x
const teraAttacker = new CalcPokemon(GEN9, 'Charizard', {
  level: 84,
  ability: 'Blaze',
  nature: 'Modest',
  evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  teraType: 'Fire', // triggers Tera STAB logic inside calc
  status: '',
});
// @smogon/calc automatically applies 2.0x STAB for Fire moves on Tera-Fire Charizard
```

### Critical Hit Example

```typescript
// Source: verified from @smogon/calc dist/mechanics/gen789.js
// Crit: 1.5x base damage (not 2x — that was Gen 5)
// Engine determines crit chance: 1/24 for normal moves (critRatio = 0)
// critRatio 1 → 1/8, critRatio 2 → 1/2, critRatio 3 → always

function rollCrit(critRatio: number = 0): boolean {
  const thresholds = [24, 8, 2, 1]; // denominator: ratio 0-3
  const threshold = thresholds[Math.min(critRatio, 3)];
  return Math.floor(Math.random() * threshold) === 0;
}

const critMove = new CalcMove(GEN9, 'Slash', { isCrit: true });
// @smogon/calc applies 1.5x to baseDamage when isCrit = true
```

### DataLoader Move Lookup

```typescript
// Source: verified from src/data/DataLoader.ts + src/types/pokemon.ts
import { DataLoader } from '../data/DataLoader.js';

function getMoveMetadata(moveSlug: string) {
  const move = DataLoader.getMove(moveSlug.toLowerCase());
  if (!move) throw new Error(`Unknown move: ${moveSlug}`);
  return {
    pp: move.pp,
    accuracy: move.accuracy, // number | true
    priority: move.priority,
    category: move.category,
    critRatio: (move as any).critRatio ?? 0,
  };
}
```

### BattleState Initialization

```typescript
// Source: design pattern
import { TeamGenerator } from './TeamGenerator.js';

function initActivePokemon(pokemon: BattlePokemon): ActivePokemon {
  return {
    ...pokemon,
    currentHp: pokemon.stats.hp,
    status: '',
    toxicCounter: 0,
    sleepTurns: 0,
    teraActive: false,
    ppUsed: {},
    fainted: false,
  };
}

function startBattle(): BattleState {
  const playerTeam = TeamGenerator.buildRandom().map(initActivePokemon);
  const opponentTeam = TeamGenerator.buildRandom().map(initActivePokemon);

  return {
    phase: 'WAITING_FOR_ACTION',
    playerSide: { team: playerTeam, activeIndex: 0, teraUsed: false },
    opponentSide: { team: opponentTeam, activeIndex: 0, teraUsed: false },
    turnCount: 0,
    winner: null,
  };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Paralysis = Speed / 4 | Paralysis = 25% skip only, no speed mod | Gen 6 | Turn order uses unmodified speed |
| Crit = 2x damage | Crit = 1.5x damage | Gen 6 | Less punishing crits |
| Sleep lasts 1-7 turns | Sleep lasts 2-4 turns | Gen 5 | Faster wake-up |
| Burn = 1/8 HP/turn | Burn = 1/16 HP/turn | Gen 7 | Less burn damage |
| Toxic counter persists through switch | Toxic counter resets to 1 on switch-in | Gen 5 | Counter starts at 1 not 0 after switch |

**Deprecated/outdated:**
- Burn 1/8 damage: old (Gen 1-6) formula. Use 1/16 for Gen 9.
- Crit 2x: old (Gen 5 and earlier). Use 1.5x for Gen 9.
- Speed÷4 paralysis: Gen 1-5 behavior. Gen 9 has no speed modification.

---

## Open Questions

1. **AI action selection strategy**
   - What we know: AI must choose an action each turn before resolution
   - What's unclear: Phase 3 requirements specify AI exists but not its intelligence level
   - Recommendation: Implement simplest-possible AI: randomly pick one of 4 moves (no switch, no Tera). A more intelligent AI can be Phase 4+.

2. **Move priority field in `moves.json`**
   - What we know: `MoveEntry.priority: number` exists and is populated
   - What's unclear: Need to verify all priority moves are correctly non-zero in the dataset
   - Recommendation: Spot-check Quick Attack (should be +1), Extreme Speed (+2), Trick Room (-7) before relying on it.

3. **Forced switch after mid-turn faint: what action does the switching player get?**
   - What we know: Must transition to `WAITING_FOR_SWITCH` phase
   - What's unclear: Does the switching side still get their remaining turn action after switching in? (In real Pokemon, no — you switch in, turn ends.)
   - Recommendation: After forced switch-in, end the turn. Don't grant an extra move to the switched-in Pokemon.

4. **PP at 0: struggle or block?**
   - What we know: Requirements say "blocks at 0 PP"
   - What's unclear: In real Gen 9, PP=0 means Struggle is used, not a block
   - Recommendation: Follow the requirement spec: block the action and return an error/log entry. Struggle is out of scope for v0.1.

---

## Sources

### Primary (HIGH confidence)

- `/node_modules/@smogon/calc/dist/state.d.ts` — Full type definitions for Pokemon/Move/Field/Side state, verified teraType field and StatusName enum
- `/node_modules/@smogon/calc/dist/index.d.ts` — calculate() signature, exported types
- `/node_modules/@smogon/calc/dist/mechanics/util.js` — `getStabMod()` source: verified 4096-base unit system, Tera STAB stacking math
- `/node_modules/@smogon/calc/dist/mechanics/gen789.js` — Gen 9 damage formula source: crit (1.5x), burn handling, type effectiveness with Tera
- `/node_modules/@smogon/calc/dist/result.js` — `damageRange()` source: verified result.damage is `number[]` of 16 rolls
- `/src/types/battle.ts` — `BattlePokemon` interface; confirmed fields available at engine input
- `/src/data/DataLoader.ts` — MoveEntry accessor pattern; confirmed `accuracy`, `pp`, `priority` available
- `/src/types/pokemon.ts` — MoveEntry and TypeChart type definitions; confirmed encoding

### Secondary (MEDIUM confidence)

- [Bulbapedia: Status condition](https://bulbapedia.bulbagarden.net/wiki/Status_condition) — Gen 9 status damage fractions and behavioral rules (burn 1/16, poison 1/8, toxic scaling, sleep 2-4 turns, freeze 20% thaw)
- [Bulbapedia: Damage formula](https://bulbapedia.bulbagarden.net/wiki/Damage) — Gen 9 formula confirmation (1.5x crit, random 85-100 roll)
- [Bulbapedia: Terastallization](https://bulbapedia.bulbagarden.net/wiki/Terastallization) — STAB modifier rules (same original type = 2.0x)
- [Bulbapedia: Priority](https://bulbapedia.bulbagarden.net/wiki/Priority) — Switch ordering before attacks, speed tie = random

### Tertiary (LOW confidence)

- WebSearch: "Pokemon Gen 9 turn order speed tie resolution" — confirmed switches before attacks, 50/50 speed ties. Not independently verified beyond Bulbapedia.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified directly from installed node_modules type definitions and source
- Architecture (BattleState, FSM): HIGH — derived from existing project types + @smogon/calc state interface
- @smogon/calc API: HIGH — read directly from dist files in node_modules
- Status condition mechanics: MEDIUM — Bulbapedia confirmed, cross-checked with @smogon/calc StatusName values
- Pitfalls: HIGH — burn halving and paralysis speed confirmed from @smogon/calc source + Bulbapedia

**Research date:** 2026-02-26
**Valid until:** 2026-04-26 (stable — @smogon/calc changes slowly; Gen 9 mechanics are finalized)
