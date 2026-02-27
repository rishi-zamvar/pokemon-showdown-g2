/**
 * Battle HUD renderer (UI-02) -- shows both Pokemon with sprites and HP bars.
 *
 * Layout on G2 display (576x288):
 *   Top row: opponent text (left) + opponent sprite (right)
 *   Bottom row: player sprite (left) + player text (right)
 *
 * Each text block shows: Name, HP bar, status/tera info.
 */

import type { BattleState, ActivePokemon } from '../../types/battleState.js';
import type { BattleHudScreen } from '../ScreenState.js';
import { SpriteService } from '../../sprites/SpriteService.js';
import { DataLoader } from '../../data/DataLoader.js';

export const HP_BAR_WIDTH = 10;

/** Build an HP bar like "[████████░░] 87%" */
export function formatHpBar(mon: ActivePokemon): string {
  const hpPct = mon.fainted
    ? 0
    : Math.max(1, Math.round((mon.currentHp / mon.stats.hp) * 100));
  const filled = Math.round((hpPct / 100) * HP_BAR_WIDTH);
  const empty = HP_BAR_WIDTH - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${hpPct}%`;
}

const MAX_NAME_LINE = 64;

/**
 * Format name with tera type, status, and volatiles in a single bracket.
 * Format: "Label: Name (TeraType | BRN, CNF)" truncated to 64 chars.
 *
 * Bracket parts (separated by " | "):
 *   1. Tera type (if active)
 *   2. Status + volatiles (comma-separated)
 *
 * Examples:
 *   "You: Pikachu"
 *   "You: Pikachu (PAR)"
 *   "You: Pikachu (Fire)"
 *   "You: Pikachu (Fire | BRN, CNF)"
 *   "Foe: Gardevoir (Fairy | TAUNT, SEED)"
 */
function formatName(label: string, mon: ActivePokemon): string {
  const base = `${label}: ${mon.name}`;

  // Collect bracket parts
  const parts: string[] = [];

  // Tera type (always first if active)
  if (mon.teraActive) parts.push(mon.teraType);

  // Status conditions + volatiles combined
  const statuses: string[] = [];
  if (mon.status) statuses.push(mon.status.toUpperCase());
  if (mon.volatiles.length > 0) statuses.push(...mon.volatiles);

  if (statuses.length > 0) parts.push(statuses.join(', '));

  if (parts.length === 0) return base;

  const bracket = parts.join(' | ');
  const full = `${base} (${bracket})`;

  // Truncate with ellipsis if over limit
  if (full.length > MAX_NAME_LINE) {
    return full.slice(0, MAX_NAME_LINE - 1) + '\u2026';
  }
  return full;
}

/** Format status condition -- now empty since status is shown inline in formatName. */
function formatStatus(_mon: ActivePokemon): string {
  return '';
}

/** Get dex number for a Pokemon species slug.
 *  Handles forme variants like "Gastrodon-East" by falling back to base species.
 */
function getDexNum(species: string): number {
  const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = DataLoader.getPokemon(slug);
  if (exact?.num) return exact.num;

  // Fallback: strip forme suffix (everything after first hyphen)
  const hyphenIdx = species.indexOf('-');
  if (hyphenIdx > 0) {
    const baseSlug = species.slice(0, hyphenIdx).toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = DataLoader.getPokemon(baseSlug);
    if (base?.num) return base.num;
  }

  return 0;
}

export function renderBattleHud(state: BattleState): BattleHudScreen {
  const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;
  const opponentMon = state.opponentSide.team[state.opponentSide.activeIndex]!;

  // Build opponent text block (displayed left of sprite)
  let oppText = `${formatName('Foe', opponentMon)}\n${formatHpBar(opponentMon)}`;
  const oppStatus = formatStatus(opponentMon);
  if (oppStatus) oppText += `\n${oppStatus}`;

  // Build player text block (displayed right of sprite)
  let playerText = `${formatName('You', playerMon)}\n${formatHpBar(playerMon)}`;
  const playerStatus = formatStatus(playerMon);
  if (playerStatus) playerText += `\n${playerStatus}`;

  // Get cached BMP sprites (Uint8Array)
  const oppDexNum = getDexNum(opponentMon.species);
  const playerDexNum = getDexNum(playerMon.species);
  const oppSprite = oppDexNum > 0 ? SpriteService.getBitmapCached(oppDexNum) : null;
  const playerSpriteData = playerDexNum > 0 ? SpriteService.getBackBitmapCached(playerDexNum) : null;

  console.log(`[HUD] oppDex=${oppDexNum} sprite=${oppSprite ? oppSprite.length + ' bytes' : 'null'}`);
  console.log(`[HUD] playerDex=${playerDexNum} sprite=${playerSpriteData ? playerSpriteData.length + ' bytes' : 'null'}`);

  return {
    oppText,
    playerText,
    status: {
      left: `Turn ${state.turnCount}`,
      right: 'Tap for menu',
    },
    oppSprite: oppSprite ?? undefined,
    playerSprite: playerSpriteData ?? undefined,
  };
}
