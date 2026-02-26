/**
 * Battle HUD renderer (UI-02) -- shows both sides' active Pokemon with HP.
 *
 * Pure function: takes BattleState, returns TextScreen.
 * HP% uses Math.max(1, ...) to never show 0% for a non-fainted Pokemon.
 */

import type { BattleState, ActivePokemon } from '../../types/battleState.js';
import type { TextScreen } from '../ScreenState.js';
import { DISPLAY_BUDGET } from '../../config/constants.js';

/** Format one Pokemon's display line: "Name         47% BRN [TeraType]" */
function formatPokemonLine(mon: ActivePokemon): string {
  const name = mon.name.slice(0, 12).padEnd(12);
  const hpPct = mon.fainted
    ? 0
    : Math.max(1, Math.round((mon.currentHp / mon.stats.hp) * 100));
  let line = `${name} ${hpPct}%`;

  if (mon.status) {
    line += ` ${mon.status.toUpperCase()}`;
  }
  if (mon.teraActive) {
    line += ` [${mon.teraType}]`;
  }

  return line;
}

export function renderBattleHud(state: BattleState): TextScreen {
  const playerMon = state.playerSide.team[state.playerSide.activeIndex]!;
  const opponentMon = state.opponentSide.team[state.opponentSide.activeIndex]!;

  const opponentLine = `Foe: ${formatPokemonLine(opponentMon)}`;
  const playerLine = `You: ${formatPokemonLine(playerMon)}`;

  let text = `${opponentLine}\n\n${playerLine}`;

  // Enforce display budget
  if (text.length > DISPLAY_BUDGET.SAFE_CHARS) {
    text = text.slice(0, DISPLAY_BUDGET.SAFE_CHARS);
  }

  return {
    text,
    status: {
      left: `Turn ${state.turnCount}`,
      right: 'Tap for menu',
    },
  };
}
