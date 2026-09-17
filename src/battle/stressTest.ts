/**
 * 100-Battle Headless Stress Test
 *
 * Runs 100 complete battles using SimBattleAdapter + SimAIOpponent without
 * any UI/glass dependencies. Validates per-turn invariants and reports
 * all assertion failures with battle#/turn# context.
 *
 * Run: npx tsx src/battle/stressTest.ts
 */

import { SimBattleAdapter } from './SimBattleAdapter.js';
import { SimAIOpponent } from './SimAIOpponent.js';
import type { BattleState, ActivePokemon, StatusCondition } from '../types/battleState.js';

const TOTAL_BATTLES = 100;
const MAX_TURNS = 500;

const VALID_STATUSES: StatusCondition[] = ['brn', 'par', 'psn', 'tox', 'slp', 'frz', ''];

interface Failure {
  battle: number;
  turn: number;
  message: string;
}

function validateState(state: BattleState, battleNum: number, turn: number, failures: Failure[]): void {
  const fail = (msg: string) => failures.push({ battle: battleNum, turn, message: msg });

  for (const label of ['player', 'opponent'] as const) {
    const side = label === 'player' ? state.playerSide : state.opponentSide;

    // Team always has 6 members
    if (side.team.length !== 6) {
      fail(`${label} team has ${side.team.length} members, expected 6`);
    }

    // No duplicate Pokemon (by species)
    const speciesSeen = new Set<string>();
    for (const mon of side.team) {
      if (speciesSeen.has(mon.species)) {
        fail(`${label} has duplicate species: ${mon.species}`);
      }
      speciesSeen.add(mon.species);
    }

    // Active index is a non-fainted Pokemon (unless battle is over)
    if (state.phase !== 'BATTLE_OVER') {
      const activeMon = side.team[side.activeIndex];
      if (!activeMon) {
        fail(`${label} activeIndex ${side.activeIndex} is out of bounds`);
      } else if (activeMon.fainted) {
        // Only flag if not in WAITING_FOR_SWITCH phase for this side
        if (state.phase !== 'WAITING_FOR_SWITCH') {
          fail(`${label} active mon ${activeMon.name} is fainted but phase is ${state.phase}`);
        }
      }
    }

    // Per-Pokemon validations
    for (const mon of side.team) {
      validateMon(mon, label, battleNum, turn, failures);
    }
  }
}

function validateMon(
  mon: ActivePokemon,
  side: string,
  battleNum: number,
  turn: number,
  failures: Failure[],
): void {
  const fail = (msg: string) => failures.push({ battle: battleNum, turn, message: msg });

  // HP never goes negative
  if (mon.currentHp < 0) {
    fail(`${side} ${mon.name} has negative HP: ${mon.currentHp}`);
  }

  // HP never exceeds max
  if (mon.currentHp > mon.stats.hp) {
    fail(`${side} ${mon.name} HP ${mon.currentHp} exceeds max ${mon.stats.hp}`);
  }

  // Fainted Pokemon have exactly 0 HP
  if (mon.fainted && mon.currentHp !== 0) {
    fail(`${side} ${mon.name} is fainted but has HP ${mon.currentHp}`);
  }

  // Non-fainted Pokemon have > 0 HP
  if (!mon.fainted && mon.currentHp <= 0) {
    fail(`${side} ${mon.name} has 0 HP but is not marked fainted`);
  }

  // Status is a valid condition
  if (!VALID_STATUSES.includes(mon.status)) {
    fail(`${side} ${mon.name} has invalid status: "${mon.status}"`);
  }

  // PP never goes negative
  for (const [move, used] of Object.entries(mon.ppUsed)) {
    if (used < 0) {
      fail(`${side} ${mon.name} move ${move} has negative PP used: ${used}`);
    }
  }
}

function validateLog(
  log: import('../types/battleState.js').TurnLogEntry[],
  battleNum: number,
  turn: number,
  failures: Failure[],
): void {
  const fail = (msg: string) => failures.push({ battle: battleNum, turn, message: msg });

  for (let i = 0; i < log.length; i++) {
    const entry = log[i]!;

    // No undefined in text fields
    if (entry.kind === undefined) {
      fail(`log[${i}] has undefined kind`);
    }
    if (entry.actor === undefined) {
      fail(`log[${i}] has undefined actor`);
    }

    // Check detail values for undefined
    for (const [key, value] of Object.entries(entry.detail)) {
      if (value === undefined) {
        fail(`log[${i}] (${entry.kind}) detail.${key} is undefined`);
      }
    }
  }
}

function runOneBattle(battleNum: number): Failure[] {
  const failures: Failure[] = [];
  let state: BattleState;

  try {
    state = SimBattleAdapter.startBattle().state;
  } catch (e) {
    failures.push({
      battle: battleNum,
      turn: 0,
      message: `startBattle() threw: ${e instanceof Error ? e.message : String(e)}`,
    });
    return failures;
  }

  validateState(state, battleNum, 0, failures);

  let turn = 0;
  while (state.phase !== 'BATTLE_OVER' && turn < MAX_TURNS) {
    turn++;
    const battle = SimBattleAdapter.getBattle()!;

    try {
      if (state.phase === 'WAITING_FOR_ACTION') {
        // Both sides pick actions
        const playerAction = SimAIOpponent.pickAction(
          // Trick: read from sides[0] for player AI
          { sides: [battle.sides[0]!, battle.sides[0]!] } as unknown as import('@pkmn/sim').Battle,
        );
        const opponentAction = SimAIOpponent.pickAction(battle);
        const result = SimBattleAdapter.submitAction(state, playerAction, opponentAction);

        validateLog(result.log, battleNum, turn, failures);
        state = result.nextState;
        validateState(state, battleNum, turn, failures);

      } else if (state.phase === 'WAITING_FOR_SWITCH') {
        // Determine which side(s) need to switch
        const p1NeedsSwitch = battle.sides[0]?.activeRequest?.forceSwitch?.some(Boolean);
        const p2NeedsSwitch = battle.sides[1]?.activeRequest?.forceSwitch?.some(Boolean);

        if (p1NeedsSwitch || p2NeedsSwitch) {
          if (p1NeedsSwitch) {
            // Find first alive non-active in our team state
            let switchIdx = -1;
            for (let i = 0; i < state.playerSide.team.length; i++) {
              if (i === state.playerSide.activeIndex) continue;
              if (!state.playerSide.team[i]!.fainted) {
                switchIdx = i;
                break;
              }
            }

            // Fallback: scan ALL non-active (including current active if it's somehow marked alive)
            if (switchIdx < 0) {
              for (let i = 0; i < state.playerSide.team.length; i++) {
                if (!state.playerSide.team[i]!.fainted) {
                  switchIdx = i;
                  break;
                }
              }
            }

            if (switchIdx < 0) {
              failures.push({ battle: battleNum, turn, message: 'Player needs switch but no alive Pokemon' });
              break;
            }

            const aiSwitchIndex = p2NeedsSwitch ? SimAIOpponent.pickSwitch(battle) : undefined;
            const result = SimBattleAdapter.submitSwitch(state, 'player', switchIdx, aiSwitchIndex);
            validateLog(result.log, battleNum, turn, failures);
            state = result.nextState;
            validateState(state, battleNum, turn, failures);

          } else {
            // Only opponent needs to switch
            const aiSwitchIndex = SimAIOpponent.pickSwitch(battle);
            const result = SimBattleAdapter.submitSwitch(state, 'opponent', aiSwitchIndex);
            validateLog(result.log, battleNum, turn, failures);
            state = result.nextState;
            validateState(state, battleNum, turn, failures);
          }

        } else {
          failures.push({ battle: battleNum, turn, message: 'WAITING_FOR_SWITCH but neither side has forceSwitch' });
          break;
        }
      } else {
        failures.push({ battle: battleNum, turn, message: `Unexpected phase: ${state.phase}` });
        break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // For "Not all choices done", add debug context
      let extra = '';
      if (msg.includes('Not all choices done')) {
        const b = SimBattleAdapter.getBattle()!;
        const p1Req = b.sides[0]?.activeRequest;
        const p2Req = b.sides[1]?.activeRequest;
        const p1Mons = b.sides[0]?.pokemon.map(m => `${m.species.name}:${m.hp}/${m.maxhp}${m.fainted ? '(fnt)' : ''}`);
        const p2Mons = b.sides[1]?.pokemon.map(m => `${m.species.name}:${m.hp}/${m.maxhp}${m.fainted ? '(fnt)' : ''}`);
        extra = ` | p1FS=${JSON.stringify(p1Req?.forceSwitch)} p2FS=${JSON.stringify(p2Req?.forceSwitch)} p1W=${!!(p1Req as unknown as Record<string, unknown>)?.wait} p2W=${!!(p2Req as unknown as Record<string, unknown>)?.wait} p1=${JSON.stringify(p1Mons)} p2=${JSON.stringify(p2Mons)}`;
      }
      failures.push({
        battle: battleNum,
        turn,
        message: `Exception in phase ${state.phase}: ${msg}${extra}`,
      });
      break;
    }
  }

  // Battle should end with a winner
  if (turn >= MAX_TURNS) {
    failures.push({ battle: battleNum, turn, message: `Battle did not end within ${MAX_TURNS} turns` });
  }

  if (state.phase === 'BATTLE_OVER') {
    if (!state.winner) {
      failures.push({ battle: battleNum, turn, message: 'Battle over but no winner' });
    }
    // At least one side should have a fainted mon
    const playerHasFainted = state.playerSide.team.some(m => m.fainted);
    const oppHasFainted = state.opponentSide.team.some(m => m.fainted);
    if (!playerHasFainted && !oppHasFainted) {
      failures.push({ battle: battleNum, turn, message: 'Battle over but no fainted Pokemon on either side' });
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\n=== Stress Test: ${TOTAL_BATTLES} headless battles ===\n`);

let passCount = 0;
let failCount = 0;
const allFailures: Failure[] = [];

for (let i = 1; i <= TOTAL_BATTLES; i++) {
  const failures = runOneBattle(i);
  if (failures.length === 0) {
    passCount++;
    process.stdout.write('.');
  } else {
    failCount++;
    process.stdout.write('F');
    allFailures.push(...failures);
  }

  // Newline every 50 battles for readability
  if (i % 50 === 0) process.stdout.write('\n');
}

console.log('\n');
console.log(`Results: ${passCount} passed, ${failCount} failed out of ${TOTAL_BATTLES}`);

if (allFailures.length > 0) {
  console.log(`\n--- ${allFailures.length} assertion failure(s) ---\n`);

  // Group by message for readability
  const grouped = new Map<string, Failure[]>();
  for (const f of allFailures) {
    const key = f.message;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(f);
  }

  for (const [message, instances] of grouped) {
    console.log(`[${instances.length}x] ${message}`);
    // Show first 3 occurrences
    for (const inst of instances.slice(0, 3)) {
      console.log(`     battle #${inst.battle}, turn ${inst.turn}`);
    }
    if (instances.length > 3) {
      console.log(`     ... and ${instances.length - 3} more`);
    }
    console.log();
  }
} else {
  console.log('\nAll battles passed all assertions!');
}

process.exit(failCount > 0 ? 1 : 0);
