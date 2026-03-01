# Technology Stack — v1.1 UI Enhancement & Polish

**Project:** Pokemon Showdown G2
**Milestone:** v1.1 UI Enhancement & Polish
**Researched:** 2026-03-01
**Confidence:** HIGH (based on verified codebase inspection; no external library additions required)

---

## Summary

No new npm dependencies are needed for this milestone. Every feature — consolidated menus, animation speed controls, stats screen, attack movement animation, and screen layout changes — is implemented by modifying and extending existing TypeScript modules. The existing stack already has all required primitives: BMP pixel manipulation via `encodeBmp` + `shiftSpriteBmp`, timing control via `ANIM` constants, battle data via `SimBattleAdapter`/`DataLoader`, and rendering via `GlassAdapterImpl`.

The work is entirely intra-project: new renderers, modified ScreenState, new ANIM constants for speed tiers, new container layout patterns in `glassAdapter.ts`, and new screen names in the FSM.

---

## Existing Stack — Unchanged

| Technology | Version | Role in v1.1 |
|------------|---------|--------------|
| `@evenrealities/even_hub_sdk` | `^0.0.7` | All rendering primitives. `TextContainerProperty`, `ListContainerProperty`, `ImageContainerProperty`, `ImageRawDataUpdate`, `TextContainerUpgrade` are the only display APIs. No additions needed. |
| `@pkmn/sim` | (transitive) | Battle state source of truth. The stats screen reads stat boosts, ability, item, speed from the sim's Pokemon objects via `SimBattleAdapter.getBattle()`. |
| `@pkmn/randoms` | `^0.10.6` | Unchanged. Team generation is not touched this milestone. |
| `@smogon/calc` | `^0.10.0` | Unchanged. Damage calc not touched this milestone. |
| `vite` | `^6.0.0` | Build system, unchanged. |
| `typescript` | `^5.9.3` | Type checking, unchanged. |
| Local JSON data files | — | `abilities.json` already loaded — needed for stats screen ability display. |

---

## What NOT to Add — And Why

| Temptation | Why Not |
|------------|---------|
| A UI framework (React, Lit, etc.) | The G2 SDK is the entire rendering layer. There is no DOM on the glasses. Frameworks add bundle weight with zero benefit. |
| A state management library (Zustand, XState) | `ScreenController` already is the state machine. `ScreenState` is the discriminated union. Adding a library adds indirection without solving any real problem at this scale. |
| A canvas/BMP library | `encodeBmp` and `shiftSpriteBmp` already exist in `SpriteBmpEncoder.ts` and `AnimationEngine.ts`. The attack movement animation is more pixel shifts — same pattern, same tools. |
| An animation scheduler library | `AnimationEngine` is already the scheduler. Speed tiers are just different delay values. An external scheduler adds complexity without benefit. |
| A logging/telemetry library | Not appropriate for a glasses app with no network. |

---

## Patterns Needed Per Feature

This section maps each v1.1 feature to the specific code patterns and integration points required.

---

### 1. Consolidated Battle Menu (Attack/Switch/Tera on Main HUD)

**Current state:** BATTLE_HUD is a tap-target (any tap opens ACTION_MENU); ACTION_MENU is a separate list screen with Back/Attack/Switch/Tera.

**New behavior:** Attack/Switch/Tera options appear directly on the BATTLE_HUD screen (likely as a list with HP bars visible simultaneously, OR as a hybrid text+list layout). Eliminating ACTION_MENU removes one navigation level.

**Pattern: Hybrid layout via combined container content**

The G2 SDK allows a layout with both text and list containers simultaneously in one `rebuildPageContainer` call. The constraint is the 4-container maximum in the firmware.

Current BATTLE_HUD uses:
- `oppSprite` (ImageContainerProperty, ID 4)
- `playerSprite` (ImageContainerProperty, ID 5)
- `content` (TextContainerProperty, ID 1) — combined opp+player info text
- `status` (TextContainerProperty, ID 2) — status bar

The most compatible approach for the consolidated menu: replace the separate ACTION_MENU screen with a `ListContainerProperty` that replaces the `content` text container in the battle HUD layout — while keeping both sprite containers. The list shows the available actions. The status bar shows abbreviated HP information.

Alternatively: encode actions as text lines within the existing `content` container and detect which "line" was tapped via scroll position. This is fragile — the list approach is correct.

**Integration point:** `GlassAdapterImpl` needs a new method `showBattleHudWithMenu()` that takes the same sprite args plus a list of action items, composing a 4-container page: oppSprite, playerSprite, listContainer (actions), textContainer (minimal HP status bar). This replaces the `showBattleHud` + separate `showList` two-screen pattern.

**ScreenController change:** Remove `ACTION_MENU` from `ScreenName` or keep it unused. The `BATTLE_HUD` tap handler directly renders the consolidated view. Double-tap navigates back from attack/switch sub-screens. No "< Back" items in action list.

**Key constraint:** The list container in this layout cannot also display text above it (the sprite containers already consume two of four container slots). HP bar data must be encoded into the list item strings or into the status bar — not into a separate text container.

```typescript
// New GlassAdapterImpl method signature:
async showBattleHudWithMenu(
  menuItems: string[],  // e.g. ['Attack', 'Switch', 'Tera']
  hpStatus: string,     // status bar: "You 87% | Foe 54%"
  oppSprite?: Uint8Array,
  playerSprite?: Uint8Array,
): Promise<void>
```

---

### 2. Remove "< Back" from All Screens

**Current state:** Every sub-menu has `'< Back'` as item index 0. `ScreenController` tap handlers treat `idx === 0` as back navigation. The double-tap gesture is already mapped to TAP with `undefined` listIndex in the SDK event mapping.

**Problem:** The current event mapping treats DOUBLE_CLICK_EVENT as `{ kind: "TAP", listIndex: ... }` — same as single click. There is no separate `DOUBLE_TAP` gesture kind.

**Finding from codebase inspection:** `mapEventToGesture()` in `glassAdapter.ts` maps `OsEventTypeList.DOUBLE_CLICK_EVENT` to `{ kind: "TAP", listIndex: ... }`. Single click maps to the same `TAP` kind. The distinction the current code relies on is that the ACTION_MENU "< Back" item has listIndex 0. Double-tap currently just selects whatever item is highlighted.

**Pattern: Add DOUBLE_TAP gesture kind**

To make double-tap mean "go back" regardless of selected item, the gesture mapper must distinguish single vs double tap. This requires adding a new gesture kind:

```typescript
// In types/contracts.ts — add:
export type GestureEvent =
  | { kind: 'SCROLL_FWD' }
  | { kind: 'SCROLL_BACK' }
  | { kind: 'TAP'; listIndex?: number }
  | { kind: 'DOUBLE_TAP' }          // NEW
  | { kind: 'FOREGROUND_ENTER' }
  | { kind: 'FOREGROUND_EXIT' };
```

Map `OsEventTypeList.DOUBLE_CLICK_EVENT` → `{ kind: 'DOUBLE_TAP' }` in `mapEventToGesture()`.

Map single `OsEventTypeList.CLICK_EVENT` (and the `undefined` quirk) → `{ kind: 'TAP', listIndex }`.

In `ScreenController.handleGesture()`, add a case for `DOUBLE_TAP` that navigates back from the current screen — a centralized back-navigation handler instead of per-screen "< Back" item checks.

**All screens:** Remove `'< Back'` from items arrays. Remove `if (idx === 0) { ... back ... }` blocks from each tap handler. Add to `ScreenController.onDoubleTap()`: a back-navigation switch on `this.state.screen`.

---

### 3. Battle Animation Text in a Box

**Current state:** During animation (`ANIMATING`), `AnimationEngine` calls `glass.updateText(text, { left: hpStatus, right: '' })` — text appears in the full-height content container, no visual boundary.

**New behavior:** Animation text appears in a visually distinct box — likely the bottom quarter of the screen, while sprites remain in the top three-quarters.

**Pattern: Separate animation text container**

This requires a new container layout for the `ANIMATING` state. The animation text box is a `TextContainerProperty` positioned at the bottom of the content area (e.g., `yPosition: 180`, `height: 68`). The sprite containers continue to occupy the top area.

In `GlassAdapterImpl`, add a method `showBattleAnimLayout()` that establishes the container structure used during animations: oppSprite (top-right), playerSprite (bottom-left of top area), animText (bottom strip). This layout is set up once when animation begins (via `showBattleHud` transitioning to this layout) and animation engine's `updateText` calls update only the animText container in-place.

**Integration in AnimationEngine:** Currently `playEntry` calls `glass.updateText(currentText, { left: hpStatus, right: '' })`. Post-change, the `updateText` method targets the animation text container specifically. No change to AnimationEngine's calling convention is needed if `updateText` already writes to the correct container — but the container must be set up by the layout before animation starts.

**Key question: container budget.** With oppSprite + playerSprite + animTextBox + hpStatusBar, that is 4 containers — at the firmware limit. This works only if the HP bar is either encoded within the animTextBox or eliminated during animation (HP drain shows in the animTextBox itself). Recommended: encode current HP in the animTextBox string (`"Foe HP: ██████████ 87%\nCharizard used Flamethrower!"`), no separate HP status bar during animation.

---

### 4. Attack Screen with HP Bars and Sprites Visible

**Current state:** `ATTACK_SELECT` renders as a plain list via `glass.showList()` — sprites disappear because `showList` rebuilds the page with only a list container and status bar, no image containers.

**New behavior:** During attack selection, both sprites and HP information remain visible. The 4-move list is still selectable.

**Pattern: showBattleHudWithMenu reuse**

The same `showBattleHudWithMenu` method designed for the consolidated battle menu works here. The move list replaces the action list. Sprites stay. HP status in the status bar.

```
Layout: oppSprite | playerSprite | moveList | hpStatusBar
```

`renderAttackSelect` returns `BattleHudScreen`-style output (with sprites) instead of a `ListScreen`. `ScreenController.render()` for `ATTACK_SELECT` calls `showBattleHudWithMenu(moveItems, hpStatus, oppSprite, playerSprite)`.

**Applies equally to SWITCH_SELECT:** Same pattern — sprite containers stay, the list shows team members.

---

### 5. Tera Without Confirmation Screen

**Current state:** Selecting Tera from the action menu navigates to `TERA_CONFIRM`, which shows a Yes/No list. Confirming navigates to `ATTACK_SELECT`.

**New behavior:** Selecting Tera immediately queues the tera flag and transitions to move selection. A notifier text appears briefly (e.g., in the status bar: "Tera ready!") without a full screen transition.

**Pattern: Remove TERA_CONFIRM from FSM, use status bar flash**

In `ScreenController.handleActionMenu`: tap on Tera sets `this.teraQueued = true`, updates the status bar text momentarily ("Tera ready — choose move"), then immediately transitions to `ATTACK_SELECT`.

Remove `TERA_CONFIRM` from `ScreenName`. Remove `handleTeraConfirm()` and `renderTeraConfirm.ts`. Remove the teraConfirmRenderer file.

The brief notifier does not require a separate screen or timer — the status bar string in the `ATTACK_SELECT` layout can read "Tera: choose move" to indicate the queued state.

---

### 6. Animation Speed Controls

**Current state:** `ANIM` constants in `src/config/constants.ts` are hardcoded. No runtime speed control exists.

**Pattern: Speed tier runtime configuration**

Add a `SpeedConfig` object to module scope (not a constant — mutable):

```typescript
// In config/constants.ts — ADD alongside ANIM:

export type SpeedTier = 'slow' | 'normal' | 'fast' | 'instant';

/** Mutable runtime speed config — set from main menu, read by AnimationEngine */
export const SpeedConfig = {
  tier: 'normal' as SpeedTier,
};

/** Speed multipliers by tier */
export const SPEED_MULTIPLIERS: Record<SpeedTier, number> = {
  slow: 2.0,
  normal: 1.0,
  fast: 0.35,
  instant: 0.0,
};
```

In `AnimationEngine`, replace `this.delay(ANIM.CHAR_DELAY_MS)` with:

```typescript
private delayScaled(baseMs: number): Promise<void> {
  const mult = SPEED_MULTIPLIERS[SpeedConfig.tier];
  if (mult === 0) return Promise.resolve(); // instant skip
  return this.delay(Math.round(baseMs * mult));
}
```

All `this.delay(ANIM.CHAR_DELAY_MS)`, `this.delay(ANIM.FLASH_FRAME_MS)`, `this.delay(ANIM.HP_FRAME_MS)`, etc. → `this.delayScaled(ANIM.CHAR_DELAY_MS)` etc.

`ENTRY_PAUSE_MS` and `POST_ANIM_DELAY_MS` are also scaled — they are the most impactful for perceived speed.

**Main menu integration:** The main menu list includes a speed item (e.g., "Speed: Normal"). Tapping it cycles through tiers: `slow → normal → fast → instant`. No sub-menu needed. `SpeedConfig.tier` is updated directly. The menu item label reflects the current tier.

**Why mutable module-level, not localStorage:** This app already avoids localStorage for state (sprite cache uses it, but that is cleared explicitly). Speed preference is session-only — reset on reload is acceptable and simpler.

---

### 7. Stats Screen

**Current state:** No stats screen exists. `ScreenName` does not include `STATS`.

**Data available in `SimBattleAdapter.getBattle()`:**

The `@pkmn/sim` `Battle` object exposes each side's Pokemon with:
- `pokemon.ability` — current ability name (string)
- `pokemon.item` — held item name (string)
- `pokemon.boosts` — `{ atk, def, spa, spd, spe, accuracy, evasion }` (stat stage deltas, -6 to +6)
- `pokemon.status` — current status condition
- `pokemon.hp`, `pokemon.maxhp` — current/max HP
- `pokemon.baseStoredStats` — the computed base stats dict
- `pokemon.set.ivs`, `pokemon.set.evs` — IV/EV spread

The opponent's ability and item are revealed via the sim's protocol messages and stored on the Battle object — `opponent.pokemon[0].ability` reflects only what has been revealed in battle (not yet revealed = empty string).

**Pattern: New STATS screen with text layout**

Add `'STATS'` to `ScreenName`. Add a `renderStats(state: BattleState, battle: Battle): TextScreen` renderer.

```typescript
// src/screens/renderers/statsRenderer.ts

export function renderStats(state: BattleState): TextScreen {
  const battle = SimBattleAdapter.getBattle()!;
  const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;
  const oppMon = state.opponentSide.team[state.opponentSide.activeIndex]!;

  // Access sim Pokemon for live data
  const simPlayer = battle.sides[0]!.active[0]!;
  const simOpp = battle.sides[1]!.active[0]!;

  const lines: string[] = [];

  // Player section
  lines.push(`=== ${playerMon.name} ===`);
  lines.push(`Ability: ${simPlayer.ability || playerMon.ability || '?'}`);
  lines.push(`Item: ${simPlayer.item || playerMon.item || 'None'}`);
  lines.push(`Status: ${playerMon.status || 'None'}`);
  lines.push(formatBoosts(simPlayer.boosts));
  lines.push(`HP: ${playerMon.currentHp}/${playerMon.stats.hp}`);

  lines.push('');

  // Opponent section
  lines.push(`=== Foe: ${oppMon.name} ===`);
  lines.push(`Ability: ${simOpp.ability || '???'}`);   // Only shown if revealed
  lines.push(`Status: ${oppMon.status || 'None'}`);
  lines.push(formatBoosts(simOpp.boosts));
  lines.push(formatSpeRange(oppMon)); // Speed range from base speed + possible boost

  return {
    text: lines.join('\n').slice(0, 900),
    status: { left: 'Stats', right: 'dbl-tap back' },
  };
}

function formatBoosts(boosts: Record<string, number>): string {
  const parts: string[] = [];
  const statNames: Record<string, string> = {
    atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'
  };
  for (const [key, label] of Object.entries(statNames)) {
    const val = boosts[key] ?? 0;
    if (val !== 0) parts.push(`${label}${val > 0 ? '+' : ''}${val}`);
  }
  return parts.length > 0 ? `Boosts: ${parts.join(', ')}` : 'No boosts';
}

function formatSpeRange(mon: ActivePokemon): string {
  const base = mon.stats.spe;
  // Speed range accounts for nature (0.9x - 1.1x) and choice scarf (1.5x)
  const min = Math.floor(base * 0.9);
  const max = Math.floor(base * 1.1);
  return `Foe Speed: ${min}-${max} (base ${base})`;
}
```

**Navigation:** Stats screen is accessible from the battle menu (new item: "Stats") via double-tap to return. It is a text screen — no gesture input beyond double-tap.

**Access to sim Battle object:** `SimBattleAdapter.getBattle()` already exists and is public. The stats renderer calls it directly, same pattern as `ScreenController` does for AI actions.

---

### 8. Pokemon Attack Movement Animation

**Current state:** Damage animation = sprite flash (invert/blank cycles). Attacker sprite does not move.

**New behavior:** When a Pokemon uses an attack, the attacker's sprite briefly slides toward the opponent and snaps back, before the defender's hit flash plays.

**Pattern: Attacker lunge via `shiftSpriteBmp`**

`shiftSpriteBmp` already exists in `AnimationEngine.ts` — it shifts a sprite BMP by N pixels horizontally. The switch-in animation already uses this for a slide effect.

For the attack lunge:
- Player attacks → player sprite shifts right (toward opponent) by `ANIM.LUNGE_PX` pixels for `ANIM.LUNGE_FRAMES` frames, then snaps back.
- Opponent attacks → opponent sprite shifts left (toward player) by `ANIM.LUNGE_PX` pixels, then snaps back.

```typescript
// Add to ANIM constants:
LUNGE_PX: 8,         // Pixels per lunge frame
LUNGE_FRAMES: 2,     // Number of frames in lunge
LUNGE_FRAME_MS: 60,  // Duration per lunge frame
```

Lunge direction per side:
- Player (bottom-left sprite) attacks → shift right (+8, +16 px offsets)
- Opponent (top-right sprite) attacks → shift left (-8, -16 px offsets)

`shiftSpriteBmp` takes `(original, offsetX, size)`. Positive offsetX = shift right. Player lunge uses positive offset; opponent lunge uses negative.

```typescript
private async lunge(
  side: Side,
  state: BattleState,
  glass: GlassAdapter,
): Promise<void> {
  const sprite = getSpriteForSide(state, side);
  if (!sprite) return;

  const containerID = side === 'opponent' ? CONTAINER_IDS.oppSprite : CONTAINER_IDS.playerSprite;
  const containerName = side === 'opponent' ? CONTAINER_NAMES.oppSprite : CONTAINER_NAMES.playerSprite;
  const direction = side === 'player' ? 1 : -1; // player lunges right, opp lunges left
  const size = SPRITE_CONFIG.SIZE;

  // Lunge out
  for (let f = 1; f <= ANIM.LUNGE_FRAMES; f++) {
    if (this.cancelled) return;
    const shifted = shiftSpriteBmp(sprite, direction * ANIM.LUNGE_PX * f, size);
    await glass.updateImage(containerID, containerName, shifted);
    await this.delayScaled(ANIM.LUNGE_FRAME_MS);
  }

  // Snap back
  if (!this.cancelled) {
    await glass.updateImage(containerID, containerName, sprite);
  }
}
```

The lunge plays at the beginning of a `DAMAGE` entry's `playEntry`, before the typewriter text and hit flash. It runs sequentially (not via `Promise.all`) — the lunge must complete before the hit flash begins.

Order: `lunge(attacker)` → then `Promise.all([typewriterText, spriteFlash(defender), hpDrain])`.

---

### 9. Screen Layout Optimization

**Current state:** The battle HUD text block shows opp and player info in a single shared text container using a combined string with `\n\n` separator. This is fragile and unidirectional.

**Optimization pattern: Use `oppInfo` and `playerInfo` containers**

`CONTAINER_IDS.oppInfo` (6) and `CONTAINER_IDS.playerInfo` (7) are already defined in `constants.ts` but are not used. These can be wired up as dedicated text containers for opp and player info blocks respectively.

However, this increases container count: oppSprite + playerSprite + oppInfo + playerInfo = 4 containers, leaving no room for a status bar. To add the status bar would be 5 containers — possibly beyond the firmware limit.

**Recommendation:** Keep the current single `content` text container for the battle HUD to preserve the status bar slot. Do not try to split into `oppInfo` + `playerInfo` as separate containers — the 4-container limit makes this too constraining when sprites are also in the layout.

The layout optimization should instead focus on:
1. Text content formatting: tighter, more information-dense lines
2. Removing the `\n\n` double-newline separator in favor of a single `\n` with a visual divider character
3. Status bar: encode both HP bars as a single compact string (`"[████████░░]87% | [███░░░░░░░]30%"`)

---

## Integration Points Summary

| Feature | Files Modified | New Files |
|---------|---------------|-----------|
| Consolidated battle menu | `glassAdapter.ts`, `ScreenController.ts`, `ScreenState.ts`, `actionMenuRenderer.ts` | — |
| Remove back buttons | `glassAdapter.ts` (gesture mapping), `ScreenController.ts`, all renderer files | — |
| Animation text box | `glassAdapter.ts` (new layout method), `AnimationEngine.ts` | — |
| Attack/Switch with sprites | `glassAdapter.ts`, `ScreenController.ts`, `attackSelectRenderer.ts`, `switchSelectRenderer.ts` | — |
| Tera without confirm | `ScreenController.ts`, `ScreenState.ts` | Remove `teraConfirmRenderer.ts` |
| Speed controls | `config/constants.ts`, `AnimationEngine.ts`, `mainMenuRenderer.ts`, `ScreenController.ts` | — |
| Stats screen | `ScreenController.ts`, `ScreenState.ts` | `src/screens/renderers/statsRenderer.ts` |
| Attack movement | `AnimationEngine.ts`, `config/constants.ts` | — |
| Layout optimization | `battleHudRenderer.ts` | — |

---

## Container Budget Reference

The G2 SDK firmware appears to enforce a maximum of ~4 containers per `rebuildPageContainer` call. This is the binding constraint on every layout decision.

| Screen | Containers Used | Budget |
|--------|----------------|--------|
| BATTLE_HUD (current) | oppSprite, playerSprite, content, status | 4 — at limit |
| BATTLE_HUD + menu (new) | oppSprite, playerSprite, menuList, hpStatusBar | 4 — at limit |
| ATTACK_SELECT (new) | oppSprite, playerSprite, moveList, hpStatusBar | 4 — at limit |
| SWITCH_SELECT (new) | oppSprite, playerSprite, teamList, hpStatusBar | 4 — at limit |
| STATS | (no sprites) content, status | 2 — safe |
| ANIMATING (new layout) | oppSprite, playerSprite, animTextBox | 3 — safe, no status bar |
| MAIN_MENU | list, status | 2 — safe |

**Consequence:** Any layout that includes both sprite containers must compress HP info into the list item strings or the single status bar string. There is no slot for a separate HP text block when both sprites and a list are present.

---

## What Requires No Stack Changes

- `@pkmn/sim` is already the battle engine; the stats screen reads from `getBattle()` with zero new integration
- `DataLoader.getAbility()` already works (abilities.json is loaded); stats screen just calls it
- `encodeBmp` and `shiftSpriteBmp` already exist; attack lunge is the same pattern as switch slide
- `SpeedConfig` is a plain object mutation; no reactive system needed

---

## Sources

- `src/adapters/glassAdapter.ts` — authoritative source for container structure, 4-container limit, `showBattleHud` layout (HIGH confidence, direct inspection)
- `src/animation/AnimationEngine.ts` — `shiftSpriteBmp`, `playEntry` orchestration, `typewriterText`, `spriteFlash` (HIGH confidence, direct inspection)
- `src/config/constants.ts` — `ANIM`, `CONTAINER_IDS`, `CONTAINER_NAMES`, `GLASS_LAYOUT`, `SPRITE_CONFIG` (HIGH confidence, direct inspection)
- `src/screens/ScreenController.ts` — FSM, gesture routing, render dispatch, `ANIMATING` state pattern (HIGH confidence, direct inspection)
- `src/screens/ScreenState.ts` — `ScreenName`, renderer return types (HIGH confidence, direct inspection)
- `src/types/battleState.ts` — `ActivePokemon`, stat boost fields available (HIGH confidence, direct inspection)
- `src/battle/SimBattleAdapter.ts` — `getBattle()` API, Battle object access (HIGH confidence, direct inspection)
- `src/screens/renderers/*.ts` — all renderer patterns confirmed (HIGH confidence, direct inspection)

---

*Stack research for: Pokemon Showdown G2 v1.1 UI Enhancement & Polish*
*Researched: 2026-03-01*
