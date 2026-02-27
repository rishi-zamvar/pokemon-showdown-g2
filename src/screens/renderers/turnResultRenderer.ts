/**
 * Turn result renderer (UI-07) -- displays the log of events from a resolved turn.
 *
 * Shows the last MAX_LOG_ENTRIES entries to stay within display budget.
 * Each entry is formatted based on its kind with actor prefix.
 */

import type { TurnLogEntry } from '../../types/battleState.js';
import type { TextScreen } from '../ScreenState.js';
import { DISPLAY_BUDGET } from '../../config/constants.js';

function actorLabel(actor: 'player' | 'opponent'): string {
  return actor === 'player' ? 'Your' : "Foe's";
}

export function formatEntry(entry: TurnLogEntry): string {
  const d = entry.detail;
  const label = actorLabel(entry.actor);

  switch (entry.kind) {
    case 'DAMAGE':
      return `${label} ${d.pokemon} used ${d.move}! ${d.damage} dmg`;
    case 'MISS':
      return `${label} attack missed!`;
    case 'FAINT':
      return `${d.pokemon} fainted!`;
    case 'STATUS_INFLICT':
      return `${d.pokemon} was ${d.status}!`;
    case 'STATUS_TICK':
      return `${d.pokemon} took ${d.status} damage!`;
    case 'SWITCH':
      return `Go! ${d.pokemon}!`;
    case 'TERA':
      return `${label} Terastallized! [${d.teraType}]`;
    case 'WIN':
      return 'You win!';
    case 'LOSS':
      return 'You lost!';
    case 'PP_OUT':
      return `No PP left for ${d.move}!`;
    case 'PARALYSIS_SKIP':
      return `${d.pokemon} is paralyzed!`;
    case 'FROZEN':
      return `${d.pokemon} is frozen solid!`;
    case 'ASLEEP':
      return `${d.pokemon} is fast asleep!`;
    default:
      return '';
  }
}

export function renderTurnResult(log: TurnLogEntry[]): TextScreen {
  // Show only the last N entries to stay within budget
  const entries = log.slice(-DISPLAY_BUDGET.MAX_LOG_ENTRIES);

  let text = entries.map(formatEntry).join('\n');

  // Enforce total character budget
  if (text.length > DISPLAY_BUDGET.SAFE_CHARS) {
    text = text.slice(0, DISPLAY_BUDGET.SAFE_CHARS);
  }

  return {
    text,
    status: {
      left: 'Turn result',
      right: 'Tap to continue',
    },
  };
}
