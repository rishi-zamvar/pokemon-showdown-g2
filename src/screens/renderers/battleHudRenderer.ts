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

/** Format status + tera info on a separate line. */
function formatStatus(mon: ActivePokemon): string {
  const parts: string[] = [];
  if (mon.status) parts.push(mon.status.toUpperCase());
  if (mon.teraActive) parts.push(`Tera:${mon.teraType}`);
  return parts.join(' ');
}

/** Get dex number for a Pokemon species slug. */
function getDexNum(species: string): number {
  const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  const entry = DataLoader.getPokemon(slug);
  return entry?.num ?? 0;
}

export function renderBattleHud(state: BattleState): BattleHudScreen {
  const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;
  const opponentMon = state.opponentSide.team[state.opponentSide.activeIndex]!;

  // Build opponent text block (displayed left of sprite)
  let oppText = `Foe: ${opponentMon.name}\n${formatHpBar(opponentMon)}`;
  const oppStatus = formatStatus(opponentMon);
  if (oppStatus) oppText += `\n${oppStatus}`;

  // Build player text block (displayed right of sprite)
  let playerText = `You: ${playerMon.name}\n${formatHpBar(playerMon)}`;
  const playerStatus = formatStatus(playerMon);
  if (playerStatus) playerText += `\n${playerStatus}`;

  // Get cached bitmap sprites
  const oppDexNum = getDexNum(opponentMon.species);
  const playerDexNum = getDexNum(playerMon.species);
  const oppSprite = oppDexNum > 0 ? SpriteService.getBitmapCached(oppDexNum) : null;
  const playerSpriteData = playerDexNum > 0 ? SpriteService.getBackBitmapCached(playerDexNum) : null;

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
