/**
 * Turn result renderer (UI-07) -- displays the log of events from a resolved turn.
 *
 * Shows the last MAX_LOG_ENTRIES entries to stay within display budget.
 * Each entry is formatted based on its kind with actor prefix.
 */

import type { TurnLogEntry, BattleState } from '../../types/battleState.js';
import type { TextScreen } from '../ScreenState.js';
import { DISPLAY_BUDGET } from '../../config/constants.js';
import { DataLoader } from '../../data/DataLoader.js';

/** Stat slug to display name (matches PS BattleTextParser.stat()). */
const STAT_NAMES: Record<string, string> = {
  atk: 'Attack', def: 'Defense', spa: 'Sp. Atk',
  spd: 'Sp. Def', spe: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness',
};

/** Weather ID to start/end text (matches PS data/text/default.mjs). */
const WEATHER_TEXT: Record<string, { start: string; end: string }> = {
  raindance: { start: 'It started to rain!', end: 'The rain stopped.' },
  sunnyday: { start: 'The sunlight turned harsh!', end: 'The harsh sunlight faded.' },
  sandstorm: { start: 'A sandstorm kicked up!', end: 'The sandstorm subsided.' },
  hail: { start: 'It started to hail!', end: 'The hail stopped.' },
  snowscape: { start: 'It started to snow!', end: 'The snow stopped.' },
  snow: { start: 'It started to snow!', end: 'The snow stopped.' },
};

/** Terrain effect string to display text. */
const TERRAIN_TEXT: Record<string, { start: string; end: string }> = {
  'electric terrain': { start: 'An electric current ran across the battlefield!', end: 'The electricity disappeared from the battlefield.' },
  'grassy terrain': { start: 'Grass grew to cover the battlefield!', end: 'The grass disappeared from the battlefield.' },
  'misty terrain': { start: 'Mist swirled around the battlefield!', end: 'The mist disappeared from the battlefield.' },
  'psychic terrain': { start: 'The battlefield got weird!', end: 'The weirdness disappeared from the battlefield!' },
};

/** Map actor to team label for side conditions. */
function teamLabel(actor: 'player' | 'opponent'): string {
  return actor === 'player' ? 'your team' : 'the opposing team';
}

/** Get the active Pokemon's name for a given actor side. */
function actorPokemonName(actor: 'player' | 'opponent', state?: BattleState): string {
  if (!state) return actor === 'player' ? 'Your Pokemon' : "Foe's Pokemon";
  const side = actor === 'player' ? state.playerSide : state.opponentSide;
  return side.team[side.activeIndex]?.name ?? (actor === 'player' ? 'Your Pokemon' : "Foe's Pokemon");
}

function actorLabel(actor: 'player' | 'opponent', state?: BattleState): string {
  if (actor === 'player') return `Your ${actorPokemonName(actor, state)}`;
  return `Foe ${actorPokemonName(actor, state)}`;
}

/** Convert a move slug like "thunder-punch" to display name "Thunder Punch". */
function moveDisplayName(slug: unknown): string {
  if (typeof slug !== 'string') return '???';
  const moveData = DataLoader.getMove(slug.toLowerCase());
  if (moveData?.name) return moveData.name;
  // Fallback: capitalize slug
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function formatEntry(entry: TurnLogEntry, state?: BattleState): string {
  const d = entry.detail;
  const label = actorLabel(entry.actor, state);

  switch (entry.kind) {
    case 'DAMAGE':
      return `${label} used ${moveDisplayName(d.move)}! ${d.damage} dmg`;
    case 'MISS':
      return `${label} used ${moveDisplayName(d.move)}... missed!`;
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
      return `No PP left for ${moveDisplayName(d.move)}!`;
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

export function renderTurnResult(log: TurnLogEntry[], state?: BattleState): TextScreen {
  // Show only the last N entries to stay within budget
  const entries = log.slice(-DISPLAY_BUDGET.MAX_LOG_ENTRIES);

  let text = entries.map(e => formatEntry(e, state)).join('\n');

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
