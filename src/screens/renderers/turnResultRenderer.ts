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
    // --- Move usage (always emitted for every |move| line) ---
    case 'MOVE_USE': {
      const moveName = moveDisplayName(d.move);
      if (entry.actor === 'player') return `${actorPokemonName('player', state)} used ${moveName}!`;
      return `Foe ${actorPokemonName('opponent', state)} used ${moveName}!`;
    }

    // --- Original kinds (updated for PS-accurate text) ---
    case 'DAMAGE': {
      const dmg = Number(d.damage ?? 0);
      // Show damage as percentage of target's max HP
      const targetSide = entry.actor === 'player' ? state?.opponentSide : state?.playerSide;
      const targetMon = targetSide ? targetSide.team[targetSide.activeIndex] : undefined;
      const maxHp = targetMon?.stats?.hp ?? 0;
      const pct = maxHp > 0 ? Math.round((dmg / maxHp) * 100) : 0;
      if (d.isCrit) return `A critical hit! ${pct}% dmg`;
      return `${pct}% dmg`;
    }
    case 'MISS':
      return 'The attack missed!';
    case 'FAINT':
      return `${d.pokemon} fainted!`;
    case 'STATUS_INFLICT': {
      const status = String(d.status);
      const name = String(d.pokemon);
      if (status === 'brn') return `${name} was burned!`;
      if (status === 'frz') return `${name} was frozen solid!`;
      if (status === 'par') return `${name} is paralyzed! It may be unable to move!`;
      if (status === 'psn') return `${name} was poisoned!`;
      if (status === 'tox') return `${name} was badly poisoned!`;
      if (status === 'slp') return `${name} fell asleep!`;
      return `${name} was ${status}!`;
    }
    case 'STATUS_TICK':
      return `${d.pokemon} took ${d.status} damage!`;
    case 'SWITCH':
      if (entry.actor === 'player') return `Go! ${d.pokemon}!`;
      return `Foe sent out ${d.pokemon}!`;
    case 'TERA':
      return `${label} Terastallized! [${d.teraType}]`;
    case 'WIN':
      return 'You win!';
    case 'LOSS':
      return 'You lost!';
    case 'PP_OUT':
      return `No PP left for ${moveDisplayName(d.move)}!`;
    case 'PARALYSIS_SKIP':
      return `${d.pokemon} is paralyzed! It can't move!`;
    case 'FROZEN':
      return `${d.pokemon} is frozen solid!`;
    case 'ASLEEP':
      return `${d.pokemon} is fast asleep.`;

    // --- Type effectiveness ---
    case 'SUPER_EFFECTIVE':
      return "It's super effective!";
    case 'RESISTED':
      return "It's not very effective...";
    case 'IMMUNE':
      return `It doesn't affect ${d.pokemon}...`;

    // --- Stat changes ---
    case 'STAT_BOOST': {
      const boostName = String(d.pokemon);
      const boostStat = STAT_NAMES[String(d.stat)] ?? String(d.stat);
      const boostAmt = Number(d.amount);
      const boostVerb = boostAmt >= 3 ? 'rose drastically!' : boostAmt >= 2 ? 'rose sharply!' : 'rose!';
      return `${boostName}'s ${boostStat} ${boostVerb}`;
    }
    case 'STAT_UNBOOST': {
      const dropName = String(d.pokemon);
      const dropStat = STAT_NAMES[String(d.stat)] ?? String(d.stat);
      const dropAmt = Number(d.amount);
      const dropVerb = dropAmt >= 3 ? 'fell severely!' : dropAmt >= 2 ? 'fell harshly!' : 'fell!';
      return `${dropName}'s ${dropStat} ${dropVerb}`;
    }
    case 'STAT_CLEAR': {
      const clearType = String(d.type);
      const clearName = String(d.pokemon ?? '');
      if (clearType === 'clearall') return 'All stat changes were eliminated!';
      if (clearType === 'swap') return `${clearName} switched stat changes with its target!`;
      if (clearType === 'invert') return `${clearName}'s stat changes were inverted!`;
      if (clearType === 'copy') return `${clearName} copied ${d.target}'s stat changes!`;
      return `${clearName}'s stat changes were removed!`;
    }

    // --- Volatiles ---
    case 'VOLATILE_START': {
      const vsName = String(d.pokemon);
      const vol = String(d.volatile).toLowerCase();
      if (vol.includes('confusion')) return `${vsName} became confused!`;
      if (vol.includes('substitute')) return `${vsName} put in a substitute!`;
      if (vol.includes('taunt')) return `${vsName} fell for the taunt!`;
      if (vol.includes('encore')) return `${vsName} must do an encore!`;
      if (vol.includes('disable')) return `${vsName}'s ${d.move || 'move'} was disabled!`;
      if (vol.includes('leechseed')) return `${vsName} was seeded!`;
      if (vol.includes('curse')) return `${vsName} is afflicted by the curse!`;
      if (vol.includes('perishsong') || vol.includes('perish')) return 'All Pokemon hearing the song will faint in three turns!';
      if (vol.includes('trapped') || vol.includes('partiallytrapped')) return `${vsName} can no longer escape!`;
      if (vol.includes('destinybond')) return `${vsName} is hoping to take its attacker down with it!`;
      if (vol.includes('futuresight') || vol.includes('doomdesire')) return `${vsName} foresaw an attack!`;
      return `${vsName} is affected by ${d.volatile}!`;
    }
    case 'VOLATILE_END': {
      const veName = String(d.pokemon);
      const veVol = String(d.volatile).toLowerCase();
      if (veVol.includes('confusion')) return `${veName} snapped out of its confusion!`;
      if (veVol.includes('substitute')) return `${veName}'s substitute faded!`;
      if (veVol.includes('taunt')) return `${veName} shook off the taunt!`;
      if (veVol.includes('encore')) return `${veName}'s encore ended!`;
      if (veVol.includes('disable')) return `${veName}'s move is no longer disabled!`;
      if (veVol.includes('leechseed')) return `${veName} was freed from Leech Seed!`;
      return `${veName} is no longer affected by ${d.volatile}!`;
    }

    // --- Weather ---
    case 'WEATHER': {
      const weatherKey = String(d.weather).toLowerCase();
      const weatherPhase = String(d.phase);
      const weatherLookup = WEATHER_TEXT[weatherKey];
      if (!weatherLookup) {
        return weatherPhase === 'end' ? 'The weather cleared.' : `The weather changed to ${d.weather}!`;
      }
      return weatherPhase === 'end' ? weatherLookup.end : weatherLookup.start;
    }

    // --- Terrain ---
    case 'TERRAIN': {
      const terrainRaw = String(d.terrain).replace(/^move:\s*/i, '').toLowerCase();
      const terrainPhase = String(d.phase);
      const terrainLookup = TERRAIN_TEXT[terrainRaw];
      if (!terrainLookup) {
        return terrainPhase === 'end' ? 'The terrain returned to normal.' : `${d.terrain} appeared!`;
      }
      return terrainPhase === 'end' ? terrainLookup.end : terrainLookup.start;
    }

    // --- Side conditions ---
    case 'SIDE_START': {
      const sideEffect = String(d.effect);
      const sideTeam = teamLabel(entry.actor);
      if (sideEffect.includes('Stealth Rock')) return `Pointed stones float in the air around ${sideTeam}!`;
      if (sideEffect.includes('Spikes')) return `Spikes were scattered on the ground all around ${sideTeam}!`;
      if (sideEffect.includes('Toxic Spikes')) return `Poison spikes were scattered on the ground all around ${sideTeam}!`;
      if (sideEffect.includes('Sticky Web')) return `A sticky web spreads beneath ${sideTeam}!`;
      if (sideEffect.includes('Reflect')) return `Reflect made ${sideTeam} stronger against physical moves!`;
      if (sideEffect.includes('Light Screen')) return `Light Screen made ${sideTeam} stronger against special moves!`;
      if (sideEffect.includes('Aurora Veil')) return `Aurora Veil made ${sideTeam} stronger against physical and special moves!`;
      if (sideEffect.includes('Tailwind')) return `The Tailwind blew from behind ${sideTeam}!`;
      return `${sideEffect} started on ${sideTeam}!`;
    }
    case 'SIDE_END': {
      const endEffect = String(d.effect);
      const endTeam = teamLabel(entry.actor);
      if (endEffect.includes('Stealth Rock')) return `The pointed stones disappeared from around ${endTeam}!`;
      if (endEffect.includes('Spikes')) return `The spikes disappeared from the ground around ${endTeam}!`;
      if (endEffect.includes('Toxic Spikes')) return `The poison spikes disappeared from the ground around ${endTeam}!`;
      if (endEffect.includes('Sticky Web')) return `The sticky web disappeared from beneath ${endTeam}!`;
      if (endEffect.includes('Reflect')) return `${endTeam === 'your team' ? 'Your' : "The foe's"} team's Reflect wore off!`;
      if (endEffect.includes('Light Screen')) return `${endTeam === 'your team' ? 'Your' : "The foe's"} team's Light Screen wore off!`;
      if (endEffect.includes('Aurora Veil')) return `${endTeam === 'your team' ? 'Your' : "The foe's"} team's Aurora Veil wore off!`;
      if (endEffect.includes('Tailwind')) return `${endTeam === 'your team' ? 'Your' : "The foe's"} team's Tailwind petered out!`;
      return `${endEffect} ended on ${endTeam}!`;
    }

    // --- Heal ---
    case 'HEAL': {
      const healName = String(d.pokemon);
      const healSource = String(d.source ?? '');
      if (healSource.includes('Wish')) return `${healName}'s wish came true!`;
      if (healSource.includes('Leftovers')) return `${healName} restored a little HP using its Leftovers!`;
      if (healSource.includes('Grassy Terrain')) return `${healName}'s HP was restored.`;
      if (healSource.includes('drain')) return `${healName} had its energy drained!`;
      if (healSource) return `${healName} restored HP. (${healSource})`;
      return `${healName} had its HP restored.`;
    }

    // --- Items ---
    case 'ITEM_REVEAL':
      return `[${d.pokemon}'s ${d.item}]`;
    case 'ITEM_CONSUME':
      if (d.eaten) return `${d.pokemon} ate its ${d.item}!`;
      return `${d.pokemon} lost its ${d.item}!`;

    // --- Abilities ---
    case 'ABILITY':
      if (d.ended) return `${d.pokemon}'s Ability was suppressed!`;
      return `[${d.pokemon}'s ${d.ability}]`;

    // --- Protect/Endure ---
    case 'PROTECT': {
      const protName = String(d.pokemon);
      const protEffect = String(d.effect).toLowerCase();
      if (protEffect.includes('protect') || protEffect.includes('baneful bunker') || protEffect.includes('silk trap') || protEffect.includes('burning bulwark'))
        return `${protName} protected itself!`;
      if (protEffect.includes('endure')) return `${protName} braced itself!`;
      return `${protName} protected itself!`;
    }

    // --- Multi-hit ---
    case 'HIT_COUNT': {
      const hitCount = Number(d.count);
      return hitCount === 1 ? 'The Pokemon was hit 1 time!' : `The Pokemon was hit ${hitCount} times!`;
    }

    // --- Move failure ---
    case 'MOVE_FAIL':
      return 'But it failed!';

    // --- Charging/Prepare ---
    case 'PREPARE': {
      const prepName = String(d.pokemon);
      const prepMove = String(d.move).toLowerCase();
      if (prepMove.includes('solar')) return `${prepName} absorbed light!`;
      if (prepMove.includes('fly')) return `${prepName} flew up high!`;
      if (prepMove.includes('dig')) return `${prepName} burrowed its way under the ground!`;
      if (prepMove.includes('bounce')) return `${prepName} sprang up!`;
      if (prepMove.includes('dive')) return `${prepName} hid underwater!`;
      if (prepMove.includes('phantom')) return `${prepName} vanished instantly!`;
      if (prepMove.includes('meteor')) return `${prepName} became cloaked in a harsh light!`;
      return `${prepName} is charging power!`;
    }

    // --- Recharge ---
    case 'RECHARGE':
      return `${d.pokemon} must recharge!`;

    // --- Transform ---
    case 'TRANSFORM':
      return `${d.pokemon} transformed into ${d.target}!`;

    // --- Status cure ---
    case 'CURE_STATUS': {
      const cureName = String(d.pokemon);
      const cureStatus = String(d.status);
      if (cureStatus === 'brn') return `${cureName}'s burn was healed!`;
      if (cureStatus === 'frz') return `${cureName} thawed out!`;
      if (cureStatus === 'par') return `${cureName} was cured of paralysis!`;
      if (cureStatus === 'psn' || cureStatus === 'tox') return `${cureName} was cured of its poisoning!`;
      if (cureStatus === 'slp') return `${cureName} woke up!`;
      return `${cureName} was cured of ${cureStatus}!`;
    }

    // --- Cant expansions ---
    case 'FLINCH_SKIP':
      return `${d.pokemon} flinched and couldn't move!`;
    case 'RECHARGE_SKIP':
      return `${d.pokemon} must recharge!`;

    // --- Activate (generic) ---
    case 'ACTIVATE': {
      const actName = String(d.pokemon);
      const actEffect = String(d.effect).toLowerCase();
      if (actEffect.includes('substitute')) return `The substitute took damage for ${actName}!`;
      if (actEffect.includes('confusion')) return `${actName} is confused!`;
      if (actEffect.includes('destiny bond')) return `${actName} took its attacker down with it!`;
      if (actEffect.includes('taunt')) return `${actName} can't use ${d.move || 'the move'} after the taunt!`;
      if (actEffect.includes('disable')) return `${actName}'s ${d.move || 'move'} is disabled!`;
      if (actEffect.includes('trapped')) return `${actName} can't escape!`;
      return `[${actName}: ${d.effect}]`;
    }

    // --- Generic text fallback ---
    case 'TEXT':
      return String(d.text ?? '');

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
