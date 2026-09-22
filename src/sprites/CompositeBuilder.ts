/**
 * CompositeBuilder — generates composite 1-bit BMP images for the overlay HUD layout.
 *
 * Produces three types of composite images to stay within the 4-container SDK limit:
 *   1. Opponent composite (144x132): nameplate + HP bar + status/stat mods + front sprite
 *   2. Player composite (144x132):   nameplate + HP bar + status/stat mods + back sprite
 *   3. Team preview bar (576x24):    mini-sprite slots for both teams (6 + 6)
 *
 * All images are monochrome 1-bit BMP (brightness > 128 threshold).
 *
 * Stage-to-multiplier table mirrors Showdown Gen 9 mechanics.
 */

import { encodeBmp, emptyBmpRect, loadImageFromUrl } from './SpriteBmpEncoder.js';
import { OVERLAY_LAYOUT } from '../config/constants.js';
import type { ActivePokemon, BattleState } from '../types/battleState.js';
import { DataLoader } from '../data/DataLoader.js';

// ── Stage → multiplier lookup ──────────────────────────────────────────────

const STAGE_MULT: Record<number, string> = {
  [-6]: '0.25x',
  [-5]: '0.28x',
  [-4]: '0.33x',
  [-3]: '0.4x',
  [-2]: '0.5x',
  [-1]: '0.67x',
  [1]:  '1.5x',
  [2]:  '2x',
  [3]:  '2.5x',
  [4]:  '3x',
  [5]:  '3.5x',
  [6]:  '4x',
};

const STAT_ABBREVS: Record<string, string> = {
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

// ── Canvas management ──────────────────────────────────────────────────────

/**
 * Create a fresh canvas context for each composite render call.
 *
 * Previously this was a singleton (module-level canvas resized on each call).
 * That caused a race condition: buildOppComposite, buildPlayerComposite, and
 * buildTeamBar are all launched concurrently via Promise.all in
 * ScreenController.buildAndCacheComposites. Each calls getCompositeCtx before
 * its first `await loadImageFromUrl`, so all three resize the same canvas
 * synchronously. The last resize (buildTeamBar: 576x24) wins. When the earlier
 * composites resume after their awaits, they draw onto a 576x24 canvas instead
 * of 144x132, then binarizeCanvas reads the wrong dimensions — producing an
 * all-black output.
 *
 * Fix: allocate a new canvas per call. Canvas creation is cheap; the cost is
 * dwarfed by the PNG fetch + draw + getImageData that follows.
 */
function getCompositeCtx(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get dex number for a species slug; falls back to base species on forme variants. */
function getDexNum(species: string): number {
  const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = DataLoader.getPokemon(slug);
  if (exact?.num) return exact.num;

  // Fallback: strip forme suffix after first hyphen
  const hyphenIdx = species.indexOf('-');
  if (hyphenIdx > 0) {
    const baseSlug = species.slice(0, hyphenIdx).toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = DataLoader.getPokemon(baseSlug);
    if (base?.num) return base.num;
  }

  return 0;
}

/** Build an HP bar string like "[████████░░] 85%" with a 10-char bar width. */
function buildHpBarText(hpPct: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(hpPct)));
  const filled = pct > 0 ? Math.max(1, Math.round((pct / 100) * 10)) : 0;
  const empty = 10 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%`;
}

/**
 * Build a combined status + non-neutral stat modifier line.
 * Format: "BRN 1.5x Atk 0.5x SpD"
 */
function buildStatusLine(mon: ActivePokemon): string {
  const parts: string[] = [];

  // Status condition
  if (mon.status) {
    parts.push(mon.status.toUpperCase());
  }

  // Non-neutral stat modifiers in multiplier format
  const stages = mon.statStages;
  for (const stat of ['atk', 'def', 'spa', 'spd', 'spe'] as const) {
    const stage = stages[stat];
    if (stage !== 0) {
      const mult = STAGE_MULT[stage];
      const abbrev = STAT_ABBREVS[stat];
      if (mult && abbrev) {
        parts.push(`${mult} ${abbrev}`);
      }
    }
  }

  return parts.join(' ');
}

/**
 * Read pixel data from a canvas context, apply brightness threshold (>128 = white).
 * Returns 1-bit pixel array (row-major, 0=black, 1=white).
 */
function binarizeCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const imageData = ctx.getImageData(0, 0, w, h);
  const rgba = imageData.data;
  const pixels = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const a = rgba[i * 4 + 3]!;
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    pixels[i] = (a > 128 && brightness > 128) ? 1 : 0;
  }
  return pixels;
}

// ── Composite generation ───────────────────────────────────────────────────

const { COMPOSITE_W, COMPOSITE_H, NAMEPLATE_H, SPRITE_SIZE } = OVERLAY_LAYOUT;

/**
 * Build a 144x132 composite BMP image for one Pokemon.
 *
 * Layout:
 *   y=0..NAMEPLATE_H  (36px): white nameplate — name+level, HP bar, status+stat mods
 *   y=NAMEPLATE_H..132 (96px): black sprite region — sprite image centered
 *
 * @param dexNum  — Dex number for sprite URL
 * @param isFront — true = front sprite, false = back sprite
 * @param mon     — ActivePokemon for stats/name/status text
 */
export async function buildSpriteComposite(
  dexNum: number,
  isFront: boolean,
  mon: ActivePokemon,
): Promise<Uint8Array> {
  const ctx = getCompositeCtx(COMPOSITE_W, COMPOSITE_H);

  // ── Nameplate region (y=0..NAMEPLATE_H, black background with white text) ──
  // On G2 glasses: white(1) = green pixels, black(0) = off. So white text on
  // black background renders as green text on black — matching the sprite region.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, COMPOSITE_W, NAMEPLATE_H);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px monospace';
  ctx.textBaseline = 'top';

  // Opponent nameplate: left-aligned (text starts at left edge, readable when composite is at right of screen)
  // Player nameplate: right-aligned (text ends at right edge, readable when composite is at left of screen)
  const alignText = (text: string, y: number): void => {
    const metrics = ctx.measureText(text);
    const x = isFront
      ? 2                                                        // opponent: left-align
      : Math.max(2, COMPOSITE_W - metrics.width - 2);           // player: right-align
    ctx.fillText(text, x, y);
  };

  // Line 1: Name only.
  // No "Foe:"/"You:" prefix and no level — screen position already says which
  // side a Pokemon is on (opponent top-right, player bottom-left), and the
  // prefix cost 5 of the 18 usable characters on a line that has to fit a
  // species name. Level is not actionable during a random battle.
  alignText(mon.name.slice(0, 18), 2);

  // Line 2: HP bar
  const hpPct = mon.fainted
    ? 0
    : Math.max(1, Math.round((mon.currentHp / mon.stats.hp) * 100));
  const hpLine = buildHpBarText(hpPct);
  alignText(hpLine.slice(0, 18), 18);

  // Line 3: Status + stat modifiers
  const statusLine = buildStatusLine(mon);
  if (statusLine) {
    alignText(statusLine.slice(0, 18), 34);
  }

  // ── Sprite region (y=NAMEPLATE_H..COMPOSITE_H, black background) ──
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, NAMEPLATE_H, COMPOSITE_W, COMPOSITE_H - NAMEPLATE_H);

  // Attempt to load and draw sprite
  if (dexNum > 0) {
    try {
      const spriteDir = isFront ? 'front' : 'back';
      const url = `/sprites/${spriteDir}/${dexNum}.png`;
      const img = await loadImageFromUrl(url);

      // Center sprite within the sprite region
      const spriteX = Math.floor((COMPOSITE_W - SPRITE_SIZE) / 2);
      const spriteY = NAMEPLATE_H + Math.floor(((COMPOSITE_H - NAMEPLATE_H) - SPRITE_SIZE) / 2);
      ctx.drawImage(img, spriteX, spriteY, SPRITE_SIZE, SPRITE_SIZE);
    } catch {
      // Sprite load failed — sprite region stays black (acceptable fallback)
      console.warn(`[CompositeBuilder] Failed to load sprite for dex #${dexNum}`);
    }
  }

  const pixels = binarizeCanvas(ctx, COMPOSITE_W, COMPOSITE_H);
  const bmp = encodeBmp(pixels, COMPOSITE_W, COMPOSITE_H);
  if (bmp.length < 100) {
    console.error(
      `[CompositeBuilder] Suspiciously small composite BMP: ${bmp.length}B for ${COMPOSITE_W}x${COMPOSITE_H}`,
    );
  }
  return bmp;
}

/**
 * Build the opponent composite (144x132) from BattleState.
 * Uses front-facing sprite.
 */
export async function buildOppComposite(state: BattleState): Promise<Uint8Array> {
  const mon = state.opponentSide.team[state.opponentSide.activeIndex];
  if (!mon) return emptyComposite();
  const dexNum = getDexNum(mon.species);
  return buildSpriteComposite(dexNum, true, mon);
}

/**
 * Build the player composite (144x132) from BattleState.
 * Uses back-facing sprite (falls back to front if back unavailable).
 */
export async function buildPlayerComposite(state: BattleState): Promise<Uint8Array> {
  const mon = state.playerSide.team[state.playerSide.activeIndex];
  if (!mon) return emptyComposite();
  const dexNum = getDexNum(mon.species);
  return buildSpriteComposite(dexNum, false, mon);
}

/**
 * Build the team preview bar (576x24) with mini-sprite slots for both teams.
 *
 * Layout: 6 player slots (left) + 6 opponent slots (right).
 * Each slot is MINI_SLOT_W (48px) wide, TEAM_BAR_H (24px) tall.
 * Active slot has sprite, fainted slots are black, unknown slots are circles.
 *
 * @param state                  — Current battle state
 * @param revealedOpponentIndices — Set of opponent team indices whose sprites are known
 */
export async function buildTeamBar(
  state: BattleState,
  revealedOpponentIndices: Set<number>,
): Promise<Uint8Array> {
  const { TEAM_BAR_W, TEAM_BAR_H, MINI_SLOT_W, MINI_SPRITE_SIZE } = OVERLAY_LAYOUT;
  const ctx = getCompositeCtx(TEAM_BAR_W, TEAM_BAR_H);

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, TEAM_BAR_W, TEAM_BAR_H);

  // Draw separator between teams
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(TEAM_BAR_W / 2 - 1, 0, 2, TEAM_BAR_H);

  const spriteOffset = Math.floor((MINI_SLOT_W - MINI_SPRITE_SIZE) / 2);
  const spriteYOffset = Math.floor((TEAM_BAR_H - MINI_SPRITE_SIZE) / 2);

  // ── Player team (left half, slots 0..5) ──
  for (let i = 0; i < 6; i++) {
    const mon = state.playerSide.team[i];
    const slotX = i * MINI_SLOT_W;

    if (!mon) {
      // Empty slot — no rendering
      continue;
    }

    if (mon.fainted) {
      // Fainted — draw a small filled rectangle
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(slotX + spriteOffset + 4, spriteYOffset + 4, MINI_SPRITE_SIZE - 8, MINI_SPRITE_SIZE - 8);
      continue;
    }

    // Active — attempt to load mini sprite
    const dexNum = getDexNum(mon.species);
    if (dexNum > 0) {
      try {
        const img = await loadImageFromUrl(`/sprites/front/${dexNum}.png`);
        ctx.drawImage(img, slotX + spriteOffset, spriteYOffset, MINI_SPRITE_SIZE, MINI_SPRITE_SIZE);
      } catch {
        // Draw a white circle as fallback for live Pokemon
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(
          slotX + MINI_SLOT_W / 2,
          TEAM_BAR_H / 2,
          MINI_SPRITE_SIZE / 2 - 2,
          0, Math.PI * 2,
        );
        ctx.stroke();
      }
    }
  }

  // ── Opponent team (right half, slots 6..11) ──
  for (let i = 0; i < 6; i++) {
    const mon = state.opponentSide.team[i];
    const slotX = TEAM_BAR_W / 2 + i * MINI_SLOT_W;
    const isRevealed = revealedOpponentIndices.has(i);

    if (!mon) {
      // Unknown opponent slot — draw a hollow circle
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        slotX + MINI_SLOT_W / 2,
        TEAM_BAR_H / 2,
        MINI_SPRITE_SIZE / 2 - 2,
        0, Math.PI * 2,
      );
      ctx.stroke();
      continue;
    }

    if (mon.fainted) {
      // Fainted — small filled square
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(slotX + spriteOffset + 4, spriteYOffset + 4, MINI_SPRITE_SIZE - 8, MINI_SPRITE_SIZE - 8);
      continue;
    }

    if (isRevealed) {
      const dexNum = getDexNum(mon.species);
      if (dexNum > 0) {
        try {
          const img = await loadImageFromUrl(`/sprites/front/${dexNum}.png`);
          ctx.drawImage(img, slotX + spriteOffset, spriteYOffset, MINI_SPRITE_SIZE, MINI_SPRITE_SIZE);
        } catch {
          // Fallback circle
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(
            slotX + MINI_SLOT_W / 2,
            TEAM_BAR_H / 2,
            MINI_SPRITE_SIZE / 2 - 2,
            0, Math.PI * 2,
          );
          ctx.stroke();
        }
      }
    } else {
      // Not yet revealed — hollow circle placeholder
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        slotX + MINI_SLOT_W / 2,
        TEAM_BAR_H / 2,
        MINI_SPRITE_SIZE / 2 - 2,
        0, Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  const pixels = binarizeCanvas(ctx, TEAM_BAR_W, TEAM_BAR_H);
  const bmp = encodeBmp(pixels, TEAM_BAR_W, TEAM_BAR_H);
  if (bmp.length < 100) {
    console.error(
      `[CompositeBuilder] Suspiciously small team bar BMP: ${bmp.length}B for ${TEAM_BAR_W}x${TEAM_BAR_H}`,
    );
  }
  return bmp;
}

/** Return an empty (all-black) 144x132 composite BMP. Fallback for missing Pokemon. */
export function emptyComposite(): Uint8Array {
  return emptyBmpRect(OVERLAY_LAYOUT.COMPOSITE_W, OVERLAY_LAYOUT.COMPOSITE_H);
}

/** Return an empty (all-black) 576x24 team bar BMP. Fallback for missing state. */
export function emptyTeamBarBmp(): Uint8Array {
  return emptyBmpRect(OVERLAY_LAYOUT.TEAM_BAR_W, OVERLAY_LAYOUT.TEAM_BAR_H);
}
