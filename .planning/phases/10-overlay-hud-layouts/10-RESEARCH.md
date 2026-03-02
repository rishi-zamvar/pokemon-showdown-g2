# Phase 10: Overlay HUD Layouts - Research

**Researched:** 2026-03-02
**Domain:** G2 SDK container layout, 1-bit BMP canvas compositing, ScreenController overlay architecture
**Confidence:** HIGH

---

## Summary

Phase 10 transforms three decision screens (BATTLE_HUD, ATTACK_SELECT, SWITCH_SELECT) from full-screen text/list layouts into a unified overlay layout. All three screens must show both Pokemon sprite composites and a team preview bar simultaneously with the selectable list. The G2 SDK's hard limit of 4 containers per page is the binding constraint on every architectural decision.

The solution locked in CONTEXT.md avoids the 4-container limit by **baking multiple data layers into single BMP images**: each Pokemon's name, level, HP bar, status, and stat modifiers are composited onto a canvas alongside the sprite PNG, then encoded as a 1-bit BMP — consuming only 1 of the 4 container slots. A separate team preview bar BMP consumes a second slot. The third slot is the selectable list (`ListContainerProperty`). The fourth slot is unused (the 4-container limit is exactly satisfied with 3 used, leaving headroom or for an optional status bar — see layout section below).

The primary implementation challenge is the **canvas-based BMP compositing pipeline**: rendering text and sprite onto a single canvas, then binarizing via `encodeBmp()`. This reuses the existing `SpriteBmpEncoder.ts` infrastructure. The second major challenge is **pre-computing composites concurrently during animation** so the overlay is ready instantly when the player reaches a decision screen.

**Primary recommendation:** Build `CompositeBuilder.ts` as a new module that generates all 3 BMP images from `BattleState`, using the existing canvas/encodeBmp pipeline. Add `showOverlayHud()` to `GlassAdapterImpl`. Wire `ScreenController` to cache and pre-compute composites. Validate the image+list container mix early (it is structurally supported by the SDK type definitions but untested in this project).

---

## Standard Stack

No new npm dependencies are needed. This phase uses only existing project infrastructure.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@evenrealities/even_hub_sdk` | `^0.0.7` | `ImageContainerProperty`, `ListContainerProperty`, `RebuildPageContainer` | Only rendering API for G2 hardware |
| HTML Canvas API (`document.createElement('canvas')`) | Browser built-in | Text + sprite compositing before BMP encoding | Already used by `SpriteBmpEncoder.ts`; same infrastructure |
| `encodeBmp()` from `SpriteBmpEncoder.ts` | Local | Convert pixel array to 1-bit monochrome BMP `Uint8Array` | Existing verified function used by all sprites |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `SpriteService.ts` | Local | Fetch and cache Pokemon sprite BMPs by dex number | Reading sprite source data for composite generation |
| `DataLoader.ts` | Local | Resolve species slug → dex number, move/Pokemon data | Getting dex numbers for sprite loading in composites |
| `SpeedConfig.ts` | Local | No change; animation speed already handled | Unchanged — composite timing is not speed-controlled |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Composite BMP (single image with baked text+sprite) | Separate text container per sprite | Would require 2 text + 2 image + 1 list = 5 containers — exceeds 4-container SDK limit |
| Canvas text rendering for nameplate | Custom pixel font in BMP | Canvas text rendering is simpler and uses existing infrastructure; custom pixel font is unnecessary complexity |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended File Changes
```
src/
├── sprites/
│   ├── SpriteBmpEncoder.ts   — UNCHANGED (encodeBmp, pngToBmp, invertBmp, emptyBmp)
│   ├── SpriteService.ts      — UNCHANGED
│   └── CompositeBuilder.ts   — NEW: buildOppComposite, buildPlayerComposite, buildTeamBar
├── adapters/
│   └── glassAdapter.ts       — ADD showOverlayHud() method
├── types/
│   └── contracts.ts          — ADD showOverlayHud() to GlassAdapter interface
├── screens/
│   ├── ScreenState.ts        — ADD OverlayHudScreen return type (optional)
│   └── ScreenController.ts   — ADD 3 cached composite fields, pre-computation in resolveTurn/resolveSwitch
│       renderers/
│       ├── battleHudRenderer.ts    — UNCHANGED (renderBattleHudActions still used)
│       ├── attackSelectRenderer.ts — UNCHANGED (list items still same)
│       └── switchSelectRenderer.ts — UNCHANGED (list items still same)
└── config/
    └── constants.ts          — ADD OVERLAY_LAYOUT constants
```

### Pattern 1: 4-Container Overlay Layout

**What:** A single `rebuildPageContainer` call with 3 `ImageContainerProperty` objects and 1 `ListContainerProperty` object. The SDK's `RebuildPageContainer` type accepts `listObject`, `textObject`, and `imageObject` as separate arrays that coexist in one page call (verified in SDK type definitions at `index.d.cts:683-689`).

**Display dimensions:** 576x288 pixels. Usable content area: x=8..568, y=4..252, with a standard 28px status bar at y=256.

**Exact container positions (proposed):**
```
Display: 576x288

Container 1 — Team preview bar (ImageContainerProperty)
  x=0, y=0, w=576, h=24
  BMP size: 576x24

Container 2 — Opponent composite (ImageContainerProperty)
  x=432, y=24, w=144, h=132
  BMP size: 144x132
  Content: name + level + HP bar + status + stat mods + sprite (front-facing)

Container 3 — Player composite (ImageContainerProperty)
  x=0, y=156, w=144, h=132
  BMP size: 144x132
  Content: name + level + HP bar + status + stat mods + sprite (back-facing)

Container 4 — Selectable list (ListContainerProperty)
  x=288, y=156, w=288, h=132
  Contains: move list / team list / action list (same data as current)

Total: 4 containers — exactly at SDK limit
```

**Why this allocation:** The opponent appears top-right (mirroring the existing `showBattleHud` layout). The player appears bottom-left (matching existing layout). The text list goes bottom-right (the natural "menu" quadrant). The team bar spans the full top strip.

**Example — GlassAdapter call:**
```typescript
// Source: SDK type definitions at index.d.cts:683-689 + existing renderContainers pattern
async showOverlayHud(
  teamBarBmp: Uint8Array,
  oppCompositeBmp: Uint8Array,
  playerCompositeBmp: Uint8Array,
  listItems: string[],
  listStatus: string,
): Promise<void> {
  const teamBar = new ImageContainerProperty({
    xPosition: 0, yPosition: 0,
    width: OVERLAY_LAYOUT.TEAM_BAR_W, height: OVERLAY_LAYOUT.TEAM_BAR_H,
    containerID: CONTAINER_IDS.teamBar,
    containerName: CONTAINER_NAMES.teamBar,
  });

  const oppComposite = new ImageContainerProperty({
    xPosition: OVERLAY_LAYOUT.OPP_X, yPosition: OVERLAY_LAYOUT.OPP_Y,
    width: OVERLAY_LAYOUT.COMPOSITE_W, height: OVERLAY_LAYOUT.COMPOSITE_H,
    containerID: CONTAINER_IDS.oppSprite,      // reuse existing ID
    containerName: CONTAINER_NAMES.oppSprite,
  });

  const playerComposite = new ImageContainerProperty({
    xPosition: OVERLAY_LAYOUT.PLAYER_X, yPosition: OVERLAY_LAYOUT.PLAYER_Y,
    width: OVERLAY_LAYOUT.COMPOSITE_W, height: OVERLAY_LAYOUT.COMPOSITE_H,
    containerID: CONTAINER_IDS.playerSprite,   // reuse existing ID
    containerName: CONTAINER_NAMES.playerSprite,
  });

  const list = new ListContainerProperty({
    xPosition: OVERLAY_LAYOUT.LIST_X, yPosition: OVERLAY_LAYOUT.LIST_Y,
    width: OVERLAY_LAYOUT.LIST_W, height: OVERLAY_LAYOUT.LIST_H,
    containerID: CONTAINER_IDS.content,
    containerName: CONTAINER_NAMES.content,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemName: listItems,
      isItemSelectBorderEn: 1,
    }),
  });

  await this.renderContainers({
    imageObject: [teamBar, oppComposite, playerComposite],
    listObject: [list],
  });

  // Send BMP image data AFTER container creation
  if (this.bridge) {
    await this.sendBmp(CONTAINER_IDS.teamBar, CONTAINER_NAMES.teamBar, teamBarBmp);
    await this.sendBmp(CONTAINER_IDS.oppSprite, CONTAINER_NAMES.oppSprite, oppCompositeBmp);
    await this.sendBmp(CONTAINER_IDS.playerSprite, CONTAINER_NAMES.playerSprite, playerCompositeBmp);
  }
}
```

### Pattern 2: Composite BMP Generation

**What:** A new `CompositeBuilder.ts` module that creates BMP images by drawing to HTML canvas (text + sprite), then encoding via `encodeBmp()`.

**Composite BMP anatomy (144x132 pixels):**
```
y=0..36:   Nameplate region (white background, black text)
  y=2:  "Pikachu  Lv.55"        (10px font)
  y=16: "[████████░░] 85%"       (10px font, HP bar unicode or drawn)
  y=30: "PAR  1.5x Atk"         (9px font, only if non-neutral/status)

y=36..132: Sprite region (96px tall)
  Sprite PNG drawn at: x=24, y=36, size=96x96 (centered in 144px width)
```

**Canvas compositing approach:**
```typescript
// Source: Extends existing pngToBmp() pattern from SpriteBmpEncoder.ts
export async function buildSpriteComposite(
  dexNum: number,
  isFront: boolean,
  mon: ActivePokemon,
): Promise<Uint8Array | null> {
  const W = OVERLAY_LAYOUT.COMPOSITE_W;  // 144
  const H = OVERLAY_LAYOUT.COMPOSITE_H;  // 132
  const NAMEPLATE_H = 36;
  const SPRITE_SIZE = 96;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // White background for nameplate region
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, W, NAMEPLATE_H);

  // Black background for sprite region
  ctx.fillStyle = 'black';
  ctx.fillRect(0, NAMEPLATE_H, W, H - NAMEPLATE_H);

  // Nameplate text (black on white)
  ctx.fillStyle = 'black';
  ctx.font = '10px monospace';
  const nameText = `${mon.name.slice(0, 10)}  Lv.${mon.level ?? '??'}`;
  ctx.fillText(nameText, 2, 12);

  const hpPct = mon.fainted ? 0 : Math.max(1, Math.round((mon.currentHp / mon.stats.hp) * 100));
  const hpBar = buildHpBarString(hpPct);  // reuse formatHpBar logic
  ctx.font = '9px monospace';
  ctx.fillText(hpBar, 2, 24);

  const statusLine = buildStatusLine(mon);  // status + stat mods
  if (statusLine) {
    ctx.font = '9px monospace';
    ctx.fillText(statusLine, 2, 34);
  }

  // Sprite (white on black via existing BMP decode or PNG direct draw)
  const spriteUrl = isFront
    ? `/sprites/front/${dexNum}.png`
    : `/sprites/back/${dexNum}.png`;
  const spriteImg = await loadImageOrNull(spriteUrl);
  if (spriteImg) {
    const spriteX = Math.floor((W - SPRITE_SIZE) / 2);
    ctx.drawImage(spriteImg, spriteX, NAMEPLATE_H, SPRITE_SIZE, SPRITE_SIZE);
  }

  // Binarize and encode
  const imageData = ctx.getImageData(0, 0, W, H);
  const pixels = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = imageData.data[i * 4]!;
    const g = imageData.data[i * 4 + 1]!;
    const b = imageData.data[i * 4 + 2]!;
    const a = imageData.data[i * 4 + 3]!;
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    pixels[i] = (a > 128 && brightness > 128) ? 1 : 0;
  }
  return encodeBmp(pixels, W, H);
}
```

**Key detail about thresholding:** The sprite PNG on the black background region: sprites are mostly transparent (black via threshold) with solid Pokemon pixels (white/dark). Since the sprite region has a black canvas background, only bright sprite pixels will pass the threshold. This matches the existing sprite rendering behavior in `showBattleHud`. The nameplate region has a white background so black text passes threshold correctly (brightness < 128 = black = 0 = background on white canvas... wait, the binarize logic makes brightness > 128 = WHITE (1). So on the white nameplate: background becomes 1 (white), black text becomes 0 (black). On the 1-bit BMP, 1=white, 0=black. This is correct: white nameplate with black text.

### Pattern 3: Stat Modifier Multiplier Format

**What:** Convert `StatStages` fields to human-readable multiplier strings per CONTEXT.md.

**Stage-to-multiplier mapping:**
```typescript
// Source: Standard Pokemon competitive math (Smogon verified)
const STAGE_MULTIPLIERS: Record<number, string> = {
  [-6]: '0.25x', [-5]: '0.28x', [-4]: '0.33x', [-3]: '0.4x',
  [-2]: '0.5x',  [-1]: '0.67x',
  // 0: not shown (neutral)
  [1]: '1.5x', [2]: '2x', [3]: '2.5x', [4]: '3x', [5]: '3.5x', [6]: '4x',
};

const STAT_ABBREVS: Record<keyof StatStages, string> = {
  atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
  accuracy: 'Acc', evasion: 'Eva',
};

export function buildStatModLine(stages: StatStages): string {
  const parts: string[] = [];
  for (const [key, abbrev] of Object.entries(STAT_ABBREVS)) {
    const stage = stages[key as keyof StatStages];
    if (stage !== 0) {
      const mult = STAGE_MULTIPLIERS[stage] ?? `${stage > 0 ? '+' : ''}${stage}`;
      parts.push(`${mult} ${abbrev}`);
    }
  }
  return parts.join('  ');
}
// Example output: "1.5x Atk  0.5x SpD"
```

### Pattern 4: Team Preview Bar Generation

**What:** Build a 576x24 BMP with 12 mini-sprite slots (6 player, 6 opponent).

**Layout:**
```
x=0..288: Player's 6 Pokemon (each slot 48px wide)
x=288:    Divider (1px vertical line)
x=289..576: Opponent's 6 Pokemon (each slot 48px wide)

Each slot (48x24):
  - Mini-sprite 20x20, centered at x=(slot_x+14), y=2
  - Active Pokemon: no modification (slightly lighter?)
  - Fainted: sprite with reduced contrast (multiply alpha or draw half-brightness)
  - Unrevealed: pokeball icon (drawn via existing AnimationFrames.getPokeballFrame() scaled)
```

**Mini-sprite generation:**
```typescript
// Reuse getPokeballFrame() from AnimationFrames.ts for unrevealed slots
// Use pngToBmp(url, 20) for known Pokemon (size=20px mini)
// For fainted: draw with lower brightness or just use an X marker over the sprite

export async function buildTeamBar(state: BattleState): Promise<Uint8Array> {
  const W = 576, H = 24;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Black background
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, W, H);

  // Divider line
  ctx.fillStyle = 'white';
  ctx.fillRect(287, 0, 2, H);

  const SLOT_W = 48;
  const MINI_SIZE = 20;
  const MINI_Y = 2;

  // Player team (left half, slots 0-5)
  for (let i = 0; i < 6; i++) {
    const mon = state.playerSide.team[i];
    const x = i * SLOT_W + Math.floor((SLOT_W - MINI_SIZE) / 2);
    if (!mon) continue;
    const dexNum = getDexNum(mon.species);
    if (dexNum > 0) {
      const img = await loadImageOrNull(`/sprites/front/${dexNum}.png`);
      if (img) {
        if (mon.fainted) ctx.globalAlpha = 0.4;
        ctx.drawImage(img, x, MINI_Y, MINI_SIZE, MINI_SIZE);
        ctx.globalAlpha = 1.0;
      }
    }
    if (i === state.playerSide.activeIndex) {
      // Highlight border around active
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, MINI_Y - 1, MINI_SIZE + 2, MINI_SIZE + 2);
    }
  }

  // Opponent team (right half, slots 6-11)
  const revealedSpecies = getRevealedOpponentSpecies(state);
  for (let i = 0; i < 6; i++) {
    const x = 289 + i * SLOT_W + Math.floor((SLOT_W - MINI_SIZE) / 2);
    const mon = state.opponentSide.team[i];
    if (!mon) {
      // Draw pokeball for unrevealed
      drawPokeballMini(ctx, x, MINI_Y, MINI_SIZE);
      continue;
    }
    if (mon.fainted) {
      ctx.globalAlpha = 0.4;
      const img = await loadImageOrNull(`/sprites/front/${getDexNum(mon.species)}.png`);
      if (img) ctx.drawImage(img, x, MINI_Y, MINI_SIZE, MINI_SIZE);
      ctx.globalAlpha = 1.0;
    } else {
      const img = await loadImageOrNull(`/sprites/front/${getDexNum(mon.species)}.png`);
      if (img) ctx.drawImage(img, x, MINI_Y, MINI_SIZE, MINI_SIZE);
    }
  }

  const imageData = ctx.getImageData(0, 0, W, H);
  const pixels = binarize(imageData, W, H);
  return encodeBmp(pixels, W, H);
}
```

**Important:** The opponent's team in `BattleState` reflects what has been revealed via the battle log. `state.opponentSide.team` will contain revealed Pokemon (species known) and may have gaps or unknowns. The `buildTeamBar` function must handle unknown opponents via pokeball fallback.

### Pattern 5: Pre-Computation During Animation

**What:** Start building next-state composites concurrently as soon as `result.nextState` is known (before `playTurn` starts or alongside it).

**When to use:** In `resolveTurn()` and `resolveSwitch()` in `ScreenController`, after getting `result.nextState`.

**Example — concurrent pre-computation:**
```typescript
// Source: codebase analysis of ScreenController.ts resolveTurn pattern
private async resolveTurn(playerAction: PlayerAction): Promise<void> {
  const prevState = this.state.battleState!;
  const result = SimBattleAdapter.submitAction(prevState, playerAction, aiAction);
  this.state = { ...this.state, screen: 'ANIMATING', battleState: result.nextState };

  // Start building composites for next state CONCURRENTLY with animation
  const compositesPromise = this.buildAndCacheComposites(result.nextState);

  // Show animation HUD (existing showBattleHud, NOT overlay)
  const hudResult = renderBattleHud(prevState);
  await this.glass.showBattleHud(
    hudResult.oppText, hudResult.playerText, hudResult.status,
    hudResult.oppSprite, hudResult.playerSprite,
  );

  // Play animation
  await this.animationEngine.playTurn(result.log, prevState, result.nextState, this.glass);

  // Wait for composites to finish (should already be done by now)
  await compositesPromise;

  // Transition to decision screen (composites are ready)
  await this.transitionAfterTurn(result.nextState);
}

private async buildAndCacheComposites(state: BattleState): Promise<void> {
  const [opp, player, bar] = await Promise.all([
    CompositeBuilder.buildOppComposite(state),
    CompositeBuilder.buildPlayerComposite(state),
    CompositeBuilder.buildTeamBar(state),
  ]);
  this.oppCompositeBmp = opp;
  this.playerCompositeBmp = player;
  this.teamBarBmp = bar;
}
```

**Note:** The three composite build functions can run concurrently via `Promise.all` because they each use separate canvas elements and read from the same immutable `BattleState`.

### Pattern 6: ScreenController Overlay Dispatch

**What:** The `render()` method for BATTLE_HUD, ATTACK_SELECT, and SWITCH_SELECT all call `showOverlayHud()` with the cached composites plus different list content.

**Example:**
```typescript
// In ScreenController.render():
case 'BATTLE_HUD': {
  const bs = this.state.battleState!;
  const result = renderBattleHudActions(bs, this.isTrapped());
  await this.glass.showOverlayHud(
    this.teamBarBmp ?? this.emptyTeamBar(),
    this.oppCompositeBmp ?? this.emptyComposite(),
    this.playerCompositeBmp ?? this.emptyComposite(),
    result.items,
    result.status,
  );
  break;
}
case 'ATTACK_SELECT': {
  const result = renderAttackSelect(this.state.battleState!);
  const items = this.teraQueued ? ['[TERA QUEUED]', ...result.items] : result.items;
  await this.glass.showOverlayHud(
    this.teamBarBmp ?? this.emptyTeamBar(),
    this.oppCompositeBmp ?? this.emptyComposite(),
    this.playerCompositeBmp ?? this.emptyComposite(),
    items,
    result.status,
  );
  break;
}
case 'SWITCH_SELECT': {
  const result = renderSwitchSelect(this.state.battleState!, this.forcedSwitch);
  this.switchIndexMap = result.indexMap;
  await this.glass.showOverlayHud(
    this.teamBarBmp ?? this.emptyTeamBar(),
    this.oppCompositeBmp ?? this.emptyComposite(),
    this.playerCompositeBmp ?? this.emptyComposite(),
    result.items,
    this.forcedSwitch ? 'MUST SWITCH' : result.status,
  );
  break;
}
```

**Fallback strategy:** `emptyTeamBar()` and `emptyComposite()` return all-black BMPs of the correct dimensions, so the screen renders immediately even if composites aren't ready (extremely rare edge case at battle start).

### Pattern 7: New OVERLAY_LAYOUT Constants

**What:** Add a dedicated constant block to `constants.ts` for all overlay geometry.

```typescript
// Add to constants.ts:
export const OVERLAY_LAYOUT = {
  TEAM_BAR_W: 576,
  TEAM_BAR_H: 24,
  COMPOSITE_W: 144,
  COMPOSITE_H: 132,
  NAMEPLATE_H: 36,
  OPP_X: 432,           // 576 - 144
  OPP_Y: 24,            // below team bar
  PLAYER_X: 0,
  PLAYER_Y: 156,        // 24 + 132
  LIST_X: 288,          // right half
  LIST_Y: 156,          // 24 + 132
  LIST_W: 288,
  LIST_H: 132,
  MINI_SPRITE_SIZE: 20,
  MINI_SLOT_W: 48,      // 576 / 12
} as const;

// New CONTAINER_IDS / CONTAINER_NAMES needed:
// teamBar container -- add to existing CONTAINER_IDS/CONTAINER_NAMES
// e.g. CONTAINER_IDS.teamBar = 8, CONTAINER_NAMES.teamBar = 'teamBar'
// (IDs 1-7 already used; 8 is new)
```

### Anti-Patterns to Avoid

- **Trying to add a 5th container for status text:** The 4-container limit is a hard firmware constraint. If status text is needed, encode it into the list's `status` string or into the composite BMP. Do not attempt a separate text container alongside 3 images + 1 list.
- **Rebuilding composites on every `render()` call:** Composite building involves async image loading and canvas encoding. It takes 20-100ms. Only rebuild when state actually changes (after turn resolution). Cache in `ScreenController` fields.
- **Using the animation layout (showBattleHud) during decision screens:** The animation layout has text containers overlapping the composite areas. Keep the two layouts completely separate: `showBattleHud` for animations, `showOverlayHud` for all decision screens.
- **Calling `showOverlayHud` without waiting for composites:** If composites aren't built yet (battle just started), pass empty BMPs as fallback rather than awaiting composite build inside render(). Render must be fast; composite building must be async/pre-computed.
- **Rendering stat modifiers even when all stages are 0:** Always check `Object.values(stages).every(v => v === 0)` before allocating line space. The nameplate line 3 should be omitted entirely when clean.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 1-bit BMP encoding from pixel array | Custom BMP writer | `encodeBmp()` in `SpriteBmpEncoder.ts` | Verified working, handles row stride padding, bottom-up row order |
| PNG to canvas to pixels | Custom image loader | `loadImage()` pattern from `SpriteBmpEncoder.ts` | Already handles crossOrigin, Promise-based, error handling |
| Canvas creation and reuse | Multiple canvas allocations | Pattern from `getCanvas()` in `SpriteBmpEncoder.ts` | Canvas can be reused per operation; no need for multiple DOM elements |
| Stat stage multiplier calculation | Custom formula | Lookup table `STAGE_MULTIPLIERS` | Standard values; lookup is O(1) and has no rounding errors |
| Pokeball placeholder icon | Custom pixel art | `getPokeballFrame()` from `AnimationFrames.ts` | Already exists, already 1-bit compatible, correct scale |
| Pokemon dex number resolution | Custom slug-to-dex | `getDexNum()` pattern (already in 3 files: duplicate into `CompositeBuilder`) | Handles forme variants (Gastrodon-East) with base species fallback |

**Key insight:** The entire BMP pipeline already exists. `CompositeBuilder.ts` is NOT a new rendering system — it is a new consumer of `encodeBmp()` and the canvas pattern. All infrastructure is proven.

---

## Common Pitfalls

### Pitfall 1: Image+List Container Mix is Structurally Supported but Behaviorally Untested

**What goes wrong:** The SDK type definitions confirm `RebuildPageContainer` accepts `imageObject` and `listObject` simultaneously (`index.d.cts:683-689`). However, whether `listEvent.currentSelectItemIndex` fires correctly when image containers are also present is **untested in this project**. If image containers somehow suppress list events, taps would be silently dropped.

**Why it happens:** The existing `showList()` uses only `ListContainerProperty + TextContainerProperty` (no images). The existing `showBattleHud()` uses `ImageContainerProperty + TextContainerProperty` (no list). The new overlay is the first combination of image + list.

**How to avoid:** Implement a minimal prototype in the **first task** of this phase: `showOverlayHud` with 1 image + 1 list (no compositing yet), confirm that tapping list items fires `listEvent` correctly. Only proceed to full compositing after this is verified.

**Warning signs:** Taps on the move list don't register, or `listIndex` comes back as `undefined`.

### Pitfall 2: Canvas Text Rendering Quality at 1-Bit

**What goes wrong:** HTML canvas text rendering with anti-aliasing produces grey pixels at character edges. After binarization (brightness threshold 128), these grey pixels become unpredictable noise — some become white, some black, resulting in "fuzzy" text.

**Why it happens:** The binarize step is binary: > 128 = white, ≤ 128 = black. Anti-aliased text produces many pixels in the 100-150 brightness range.

**How to avoid:** Use `ctx.textRenderingMode = 'optimizeSpeed'` or force pixel-snapped fonts. Alternatively, accept some fuzziness at the 10px monospace size and validate visually on hardware. The practical mitigation is to use **high contrast**: pure white background + pure black text OR pure black background + pure white text. This minimizes the anti-aliased "fringe" area.

**Warning signs:** Nameplate text looks noisy or partially blended with background.

### Pitfall 3: Composite Not Built at Battle Start

**What goes wrong:** At `startNewBattleInner()`, the code currently calls `this.render()` after sprites are loaded. But composites are not built yet at that point. The first render of BATTLE_HUD will call `showOverlayHud` with null composites.

**Why it happens:** The pre-computation pattern builds composites AFTER `resolveTurn()`. The initial render happens before any turn is resolved.

**How to avoid:** After `SpriteService.fetchAndCacheBitmaps()` completes in `startNewBattleInner()`, explicitly call `await this.buildAndCacheComposites(battleState)` before calling `this.render()`. This adds ~50-200ms to battle start (acceptable, alongside sprite loading).

**Warning signs:** First BATTLE_HUD render shows all-black composite containers.

### Pitfall 4: Opponent Team Reveal Tracking

**What goes wrong:** The team preview bar must show pokeball icons for unrevealed opponent Pokemon. If `state.opponentSide.team` is always fully populated (all 6 slots visible), it would show all opponent Pokemon from turn 1.

**Why it happens:** `@pkmn/sim` initializes both teams with full rosters internally. The `BattleState.opponentSide.team` may contain all 6 opponent Pokemon even before they're revealed in battle.

**How to avoid:** In `CompositeBuilder.buildTeamBar`, do NOT show opponent mini-sprites just because they exist in `state.opponentSide.team`. Instead, determine visibility from the battle log or from whether the Pokemon has participated (HP different from max, or has been switched in). The simplest heuristic: show an opponent's mini-sprite only if they have been active (i.e., `state.opponentSide.activeIndex` was ever this Pokemon). Track a `revealedOpponentIndices: Set<number>` in `ScreenController`.

**Warning signs:** All 6 opponent Pokemon visible from turn 1, defeating the information asymmetry mechanic.

### Pitfall 5: Composite Size Mismatch with Container Size

**What goes wrong:** `ImageContainerProperty` has `width` and `height` fields. The BMP data sent via `updateImageRawData` must match those dimensions exactly. If the BMP is 144x132 but the container declares 100x100, the SDK may crop, stretch, or crash.

**Why it happens:** The BMP dimensions are set at encode time; the container dimensions are set at layout time. These are independent code paths in `CompositeBuilder` and `showOverlayHud` respectively.

**How to avoid:** Define all composite dimensions in `OVERLAY_LAYOUT` constants. Both `CompositeBuilder.ts` and `showOverlayHud()` must import from the same constants. No hardcoded dimensions in either file.

**Warning signs:** Composite appears cropped or stretched on display.

### Pitfall 6: Animation Layout vs Overlay Layout Collision

**What goes wrong:** During `resolveTurn()`, the animation phase calls `showBattleHud()` (the 2-image + 2-text layout). When the animation completes and `render()` is called, it switches to `showOverlayHud()` (3-image + 1-list layout). If `updateImage()` is called after the switch to overlay layout targeting the old text containers, it will target wrong container IDs.

**Why it happens:** `AnimationEngine.ts` calls `glass.updateText()` and `glass.updateImage()` targeting `CONTAINER_IDS.content`, `CONTAINER_IDS.oppSprite`, `CONTAINER_IDS.playerSprite`. After `showOverlayHud` rebuilds the page, those container IDs exist with new meanings.

**How to avoid:** The animation ONLY runs during `ANIMATING` state, which always uses `showBattleHud()` first. Once animation completes, `transitionAfterTurn` calls `render()` which rebuilds to the overlay layout. The `AnimationEngine` never runs while the overlay layout is active. Verify this is true: `animationEngine.isRunning()` should always be false when `render()` dispatches to BATTLE_HUD/ATTACK_SELECT/SWITCH_SELECT.

**Warning signs:** Garbled display during animation, or animation events targeting wrong containers.

### Pitfall 7: `isItemSelectBorderEn` Missing on List in Overlay

**What goes wrong:** The `ListContainerProperty` inside `showOverlayHud` must have `isItemSelectBorderEn: 1` so list items show the selection border when tapped. This was set correctly in `showList()` but must be replicated in `showOverlayHud`.

**Why it happens:** Easy to forget when writing a new method; the existing `showList()` code is the reference.

**How to avoid:** Copy `ListItemContainerProperty` configuration exactly from `showList()`. Use a shared helper method.

**Warning signs:** Items in the overlay list are selectable but show no visual selection indicator.

---

## Code Examples

### New CONTAINER_IDS for Team Bar

```typescript
// Source: codebase constants.ts pattern
export const CONTAINER_IDS = {
  content: 1,
  status: 2,
  statusRight: 3,
  oppSprite: 4,      // reused for oppComposite in overlay mode
  playerSprite: 5,   // reused for playerComposite in overlay mode
  oppInfo: 6,
  playerInfo: 7,
  teamBar: 8,        // NEW: team preview bar image container
} as const;

export const CONTAINER_NAMES = {
  content: "content",
  status: "status",
  statusRight: "statusR",
  oppSprite: "oppSpr",
  playerSprite: "plySpr",
  oppInfo: "oppInfo",
  playerInfo: "plyInfo",
  teamBar: "teamBar",  // NEW
} as const;
```

### HP Bar String for Composite (reuse from battleHudRenderer)

```typescript
// Source: battleHudRenderer.ts formatHpBar — unchanged, import it
// Or inline in CompositeBuilder:
function buildHpBarText(hpPct: number): string {
  const filled = hpPct > 0 ? Math.max(1, Math.round((hpPct / 100) * 10)) : 0;
  const empty = 10 - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${hpPct}%`;
}
```

### Status Line for Composite Nameplate

```typescript
// Source: battleState.ts StatusCondition type + CONTEXT.md status display
function buildStatusLine(mon: ActivePokemon): string {
  const parts: string[] = [];

  // Status condition
  if (mon.status) {
    parts.push(mon.status.toUpperCase());  // 'brn' -> 'BRN'
  }

  // Stat stage modifiers (multiplier format, non-neutral only)
  const STAGE_MULT: Record<number, string> = {
    [-6]: '0.25x', [-5]: '0.28x', [-4]: '0.33x', [-3]: '0.4x',
    [-2]: '0.5x',  [-1]: '0.67x',
    [1]: '1.5x', [2]: '2x', [3]: '2.5x', [4]: '3x', [5]: '3.5x', [6]: '4x',
  };
  const STAT_ABBREV: Record<string, string> = {
    atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
    accuracy: 'Acc', evasion: 'Eva',
  };

  const stages = mon.statStages;
  for (const [key, abbrev] of Object.entries(STAT_ABBREV)) {
    const stage = stages[key as keyof StatStages];
    if (stage && stage !== 0) {
      const mult = STAGE_MULT[stage] ?? `${stage > 0 ? '+' : ''}${stage}`;
      parts.push(`${mult} ${abbrev}`);
    }
  }

  return parts.join(' ');  // e.g. "BRN 1.5x Atk 0.5x SpD"
}
```

### ScreenController Fields for Composites

```typescript
// Source: codebase analysis of ScreenController.ts structure
// Add to ScreenController class (after existing private fields):
private oppCompositeBmp: Uint8Array | null = null;
private playerCompositeBmp: Uint8Array | null = null;
private teamBarBmp: Uint8Array | null = null;
private revealedOpponentIndices: Set<number> = new Set();

// Helper: empty fallback BMP (all black, correct dimensions)
private emptyComposite(): Uint8Array {
  return emptyBmp(OVERLAY_LAYOUT.COMPOSITE_W, OVERLAY_LAYOUT.COMPOSITE_H);
  // NOTE: emptyBmp() currently only takes size (square). May need to add
  // emptyBmpRect(width, height) variant to SpriteBmpEncoder.ts
}

private emptyTeamBar(): Uint8Array {
  return emptyBmpRect(OVERLAY_LAYOUT.TEAM_BAR_W, OVERLAY_LAYOUT.TEAM_BAR_H);
}
```

**Note:** `emptyBmp()` in `SpriteBmpEncoder.ts` currently only supports square BMPs (`size` parameter). A new `emptyBmpRect(width, height)` overload is needed for the team bar (576x24).

### SpriteBmpEncoder: emptyBmpRect Addition

```typescript
// Source: SpriteBmpEncoder.ts existing emptyBmp() pattern
/**
 * Create an empty (all black) BMP with explicit width and height.
 * Needed for non-square BMPs like the team preview bar (576x24).
 */
export function emptyBmpRect(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height); // all zeros = all black
  return encodeBmp(pixels, width, height);
}
```

---

## State of the Art

| Old Approach | Current Approach (after Phase 10) | Impact |
|--------------|-----------------------------------|--------|
| BATTLE_HUD: full-screen list (no sprites visible) | BATTLE_HUD: overlay with sprite composites + team bar + action list | Sprites always visible during decisions |
| ATTACK_SELECT: full-screen list (sprites not visible) | ATTACK_SELECT: overlay with composites + team bar + move list | HP context visible while choosing moves |
| SWITCH_SELECT: full-screen list (sprites not visible) | SWITCH_SELECT: overlay with composites + team bar + team list | Battle context visible while switching |
| Sprite data: raw PNG rendered as standalone BMP | Sprite data: composited with nameplate, HP bar, status, stat mods | Single BMP bakes all battle context |
| Animation layout: same as HUD (reuse showBattleHud) | Animation layout: unchanged (showBattleHud) | Animations still use separate simpler layout |

**Unchanged (do not modify):**
- `showBattleHud()` — still used during animation playback (not a decision screen)
- `AnimationEngine.ts` — no changes; animation targets same container IDs as before
- `renderAttackSelect()`, `renderSwitchSelect()`, `renderBattleHudActions()` — these return list data that `showOverlayHud` consumes unchanged
- `SpriteService.ts` — still pre-loads and caches front/back BMPs; `CompositeBuilder` will use PNG sources directly for compositing (higher quality than baked BMP)

---

## Open Questions

1. **Image + List container mix fires list events correctly?**
   - What we know: SDK type definitions allow `imageObject` + `listObject` in same `RebuildPageContainer`. Tested pattern: `imageObject` + `textObject` works (showBattleHud). `listObject` + `textObject` works (showList).
   - What's unclear: Does `listEvent.currentSelectItemIndex` fire when image containers are also present? No prior art in this codebase.
   - Recommendation: Build the image+list prototype test as the **first task** of Phase 10. Do not proceed to compositing until this is validated.

2. **Opponent reveal tracking: what's the right mechanism?**
   - What we know: CONTEXT.md says opponent's revealed Pokemon show mini-sprites, unrevealed show pokeball icons. `BattleState.opponentSide.team` may contain all 6 opponents from turn 1.
   - What's unclear: Is `state.opponentSide.team` populated with all 6 opponents immediately, or does it grow as Pokemon are revealed? Need to inspect `SimBattleAdapter` behavior.
   - Recommendation: Add `revealedOpponentIndices: Set<number>` to `ScreenController`. Update it on each `SWITCH` log entry for the opponent side. Pass it to `CompositeBuilder.buildTeamBar()`.

3. **Canvas text legibility at 1-bit on physical G2 hardware**
   - What we know: 10px monospace canvas text thresholded to 1-bit should be readable, but hardware display characteristics are unknown.
   - What's unclear: Is 10px enough? Does the G2 display have enough pixel density for 10px text to be legible? The display is 576x288 and presumably sized for a ~0.5" optical area on the G2 lens.
   - Recommendation: Test on hardware early. If 10px is too small, switch nameplate to use larger font (12px) or reduce the number of info lines. The nameplate height (36px) can be increased if needed.

4. **`emptyBmp()` squareness limitation**
   - What we know: Current `emptyBmp(size)` only supports square BMPs. The team bar is 576x24 (not square).
   - What's unclear: Nothing — this is a confirmed gap.
   - Recommendation: Add `emptyBmpRect(width, height)` to `SpriteBmpEncoder.ts` as described in the Code Examples section.

5. **Active Pokemon highlight in team bar**
   - What we know: CONTEXT.md doesn't specify a highlight for the active Pokemon in the team bar.
   - What's unclear: Should the active Pokemon slot in the team bar show any visual indicator (border, etc.)?
   - Recommendation: Add a 1px white border around the active Pokemon's mini-sprite slot. This is standard in competitive tools (Pokemon Showdown uses a similar indicator).

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/adapters/glassAdapter.ts` — `showBattleHud()` layout, `renderContainers()` pattern, container limit evidence
- Direct codebase inspection: `src/sprites/SpriteBmpEncoder.ts` — `encodeBmp()`, `pngToBmp()`, canvas pipeline
- Direct codebase inspection: `src/config/constants.ts` — `GLASS_LAYOUT`, `CONTAINER_IDS`, `SPRITE_CONFIG` (SIZE=96)
- Direct codebase inspection: `src/screens/ScreenController.ts` — `resolveTurn()`, `resolveSwitch()`, `render()` dispatch, `transitionAfterTurn()`
- Direct codebase inspection: `src/types/battleState.ts` — `StatStages`, `ActivePokemon`, `BattleSide`
- SDK type definitions: `node_modules/@evenrealities/even_hub_sdk/dist/index.d.cts:683-689` — `RebuildPageContainer` accepts `listObject` + `imageObject` + `textObject` simultaneously
- `.planning/research/STACK.md` — 4-container limit analysis; container budget table

### Secondary (MEDIUM confidence)
- `.planning/phases/09-navigation-hud-consolidation/09-VERIFICATION.md` — Phase 9 verified complete; confirms current state of ScreenController, renderers, gesture handling
- `.planning/research/ARCHITECTURE.md` — BATTLE_HUD+menu container layout analysis from v1.1 planning

### Tertiary (LOW confidence)
- None — all findings from direct codebase and SDK type definition inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all primitives verified in codebase
- Architecture (4-container layout): HIGH — container dimensions are arithmetic from known display size (576x288); container budget verified from STACK.md research and direct showBattleHud analysis
- Architecture (image+list mix): MEDIUM — structurally supported by SDK types but behaviorally untested in this project
- Composite BMP generation: HIGH — same canvas + encodeBmp pattern as existing sprite pipeline
- Pitfalls: HIGH — derived from direct code inspection of animation flow, container IDs, and known SDK constraints

**Research date:** 2026-03-02
**Valid until:** Indefinite (codebase-specific; 4-container limit is hardware constraint, unlikely to change)
