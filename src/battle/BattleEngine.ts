/**
 * BattleEngine — module singleton for the core battle loop.
 *
 * Public API:
 *   startBattle()  — create initial BattleState with two random teams
 *   submitAction() — resolve one turn (both players' actions)
 *   submitSwitch() — handle forced switch after a faint
 *
 * Design rules:
 *   - ALL state updates are immutable (spread, never mutate)
 *   - Damage uses @smogon/calc via DamageCalc wrapper (Plan 03-02)
 *   - PP tracked per move, blocked at 0
 *   - Accuracy rolls cause misses on < 100 accuracy moves
 *   - Critical hits at Gen 9 rates via rollCrit()
 *   - No status per-turn effects (Plan 03-03)
 *
 * Pattern: module-level singleton (export const BattleEngine = { ... } as const)
 */

import type {
  ActivePokemon,
  BattleSide,
  BattleState,
  PlayerAction,
  TurnLogEntry,
  TurnResult,
} from "../types/battleState.js";
import { initActivePokemon } from "../types/battleState.js";
import { TeamGenerator } from "./TeamGenerator.js";
import { resolveTurnOrder } from "./TurnResolver.js";
import {
  computeDamage,
  rollCrit,
  doesMoveHit,
  getMovePP,
  getMoveAccuracy,
  getMoveCritRatio,
} from "./DamageCalc.js";

// ---------------------------------------------------------------------------
// Immutable state update helpers
// ---------------------------------------------------------------------------

type SideKey = "playerSide" | "opponentSide";

/**
 * Return a new BattleState with one side's team updated via an updater function.
 */
function updateSideTeam(
  state: BattleState,
  sideKey: SideKey,
  updater: (team: ActivePokemon[]) => ActivePokemon[],
): BattleState {
  const side = state[sideKey];
  return {
    ...state,
    [sideKey]: {
      ...side,
      team: updater(side.team),
    },
  };
}

/**
 * Return a new team array with one Pokemon replaced.
 */
function replaceTeamMember(
  team: ActivePokemon[],
  index: number,
  update: Partial<ActivePokemon>,
): ActivePokemon[] {
  return team.map((mon, i) =>
    i === index ? { ...mon, ...update } : mon,
  );
}

/**
 * Get the side key for a given actor.
 */
function sideKeyFor(actor: "player" | "opponent"): SideKey {
  return actor === "player" ? "playerSide" : "opponentSide";
}

/**
 * Get the opposite actor.
 */
function oppositeActor(actor: "player" | "opponent"): "player" | "opponent" {
  return actor === "player" ? "opponent" : "player";
}

/**
 * Check if a side has any alive non-active Pokemon to switch to.
 */
function hasAliveTeammates(side: BattleSide): boolean {
  return side.team.some((mon, i) => i !== side.activeIndex && !mon.fainted);
}

/**
 * Check if all Pokemon on a side are fainted.
 */
function allFainted(side: BattleSide): boolean {
  return side.team.every(mon => mon.fainted);
}

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

export const BattleEngine = {
  /**
   * Create a fresh BattleState with two randomly generated 6-Pokemon teams.
   * Both sides start with Pokemon at index 0 active and full HP.
   */
  startBattle(): BattleState {
    const playerTeam = TeamGenerator.buildRandom().map(initActivePokemon);
    const opponentTeam = TeamGenerator.buildRandom().map(initActivePokemon);

    return {
      phase: "WAITING_FOR_ACTION",
      playerSide: {
        team: playerTeam,
        activeIndex: 0,
        teraUsed: false,
      },
      opponentSide: {
        team: opponentTeam,
        activeIndex: 0,
        teraUsed: false,
      },
      turnCount: 0,
      winner: null,
    };
  },

  /**
   * Resolve one complete turn given both players' actions.
   *
   * Validates that state is in WAITING_FOR_ACTION phase.
   * Actions execute in order determined by TurnResolver.
   * Returns a new BattleState and ordered log of events.
   */
  submitAction(
    state: BattleState,
    playerAction: PlayerAction,
    opponentAction: PlayerAction,
  ): TurnResult {
    if (state.phase !== "WAITING_FOR_ACTION") {
      throw new Error(
        `submitAction() called in wrong phase: ${state.phase} (expected WAITING_FOR_ACTION)`,
      );
    }

    let current: BattleState = { ...state, phase: "RESOLVING_TURN" };
    const log: TurnLogEntry[] = [];

    const playerActive = current.playerSide.team[current.playerSide.activeIndex]!;
    const opponentActive = current.opponentSide.team[current.opponentSide.activeIndex]!;

    const turnOrder = resolveTurnOrder(
      playerAction,
      opponentAction,
      playerActive,
      opponentActive,
    );

    // Map actor to their action
    const actionFor = (actor: "player" | "opponent"): PlayerAction =>
      actor === "player" ? playerAction : opponentAction;

    // Execute each actor's action in turn order
    for (const actor of turnOrder) {
      const action = actionFor(actor);
      const actorSideKey = sideKeyFor(actor);
      const targetSideKey = sideKeyFor(oppositeActor(actor));

      // Check if this actor's active Pokemon is fainted (killed earlier this turn)
      const actorSide = current[actorSideKey];
      const actorMon = actorSide.team[actorSide.activeIndex]!;
      if (actorMon.fainted) {
        continue; // Dead Pokemon don't attack
      }

      if (action.type === "SWITCH") {
        const toIndex = action.toIndex;
        current = {
          ...current,
          [actorSideKey]: {
            ...actorSide,
            activeIndex: toIndex,
          },
        };

        // Reset toxic counter if switched-in Pokemon has tox status
        const switchedIn = current[actorSideKey].team[toIndex]!;
        if (switchedIn.status === "tox") {
          current = updateSideTeam(current, actorSideKey, team =>
            replaceTeamMember(team, toIndex, { toxicCounter: 1 }),
          );
        }

        log.push({
          kind: "SWITCH",
          actor,
          detail: {
            fromIndex: actorSide.activeIndex,
            toIndex,
            pokemon: current[actorSideKey].team[toIndex]!.name,
          },
        });
      } else {
        // ATTACK or TERA_ATTACK
        const moveSlug = action.moveSlug;

        // Handle Tera activation
        if (action.type === "TERA_ATTACK") {
          if (current[actorSideKey].teraUsed) {
            throw new Error(`${actor} already used Terastallization this battle`);
          }

          // Set teraActive on the Pokemon and teraUsed on the side
          current = updateSideTeam(current, actorSideKey, team =>
            replaceTeamMember(team, current[actorSideKey].activeIndex, {
              teraActive: true,
            }),
          );
          current = {
            ...current,
            [actorSideKey]: {
              ...current[actorSideKey],
              teraUsed: true,
            },
          };

          log.push({
            kind: "TERA",
            actor,
            detail: {
              teraType: current[actorSideKey].team[current[actorSideKey].activeIndex]!.teraType,
            },
          });
        }

        // --- PP Check ---
        const maxPP = getMovePP(moveSlug);
        const currentAttacker = current[actorSideKey].team[current[actorSideKey].activeIndex]!;
        const usedPP = currentAttacker.ppUsed[moveSlug] ?? 0;

        if (usedPP >= maxPP) {
          // Move has no PP remaining — skip attack entirely
          log.push({
            kind: "PP_OUT",
            actor,
            detail: { move: moveSlug },
          });
          continue;
        }

        // Consume 1 PP (immutable update)
        current = updateSideTeam(current, actorSideKey, team =>
          replaceTeamMember(team, current[actorSideKey].activeIndex, {
            ppUsed: { ...currentAttacker.ppUsed, [moveSlug]: usedPP + 1 },
          }),
        );

        // --- Accuracy Check ---
        const accuracy = getMoveAccuracy(moveSlug);
        if (!doesMoveHit(accuracy)) {
          log.push({
            kind: "MISS",
            actor,
            detail: { move: moveSlug },
          });
          continue;
        }

        // --- Crit Roll ---
        const critRatio = getMoveCritRatio(moveSlug);
        const isCrit = rollCrit(critRatio);

        // --- Damage Calculation ---
        const attackerMon = current[actorSideKey].team[current[actorSideKey].activeIndex]!;
        const targetSide = current[targetSideKey];
        const targetIndex = targetSide.activeIndex;
        const targetMon = targetSide.team[targetIndex]!;

        const damage = computeDamage(attackerMon, targetMon, moveSlug, isCrit);
        const newHp = Math.max(0, targetMon.currentHp - damage);
        const fainted = newHp === 0;

        current = updateSideTeam(current, targetSideKey, team =>
          replaceTeamMember(team, targetIndex, {
            currentHp: newHp,
            fainted,
          }),
        );

        log.push({
          kind: "DAMAGE",
          actor,
          detail: {
            move: moveSlug,
            damage,
            isCrit,
            targetHp: newHp,
            targetMaxHp: targetMon.stats.hp,
          },
        });

        // Log faint if it occurred
        if (fainted) {
          log.push({
            kind: "FAINT",
            actor: oppositeActor(actor),
            detail: {
              pokemon: targetMon.name,
            },
          });
        }
      }
    }

    // Determine next phase based on faint state
    current = resolvePostTurnPhase(current, log);

    return { nextState: current, log };
  },

  /**
   * Handle a forced switch after a faint.
   *
   * Validates that state is in WAITING_FOR_SWITCH phase and that the
   * target Pokemon is not fainted.
   */
  submitSwitch(
    state: BattleState,
    side: "player" | "opponent",
    toIndex: number,
  ): TurnResult {
    if (state.phase !== "WAITING_FOR_SWITCH") {
      throw new Error(
        `submitSwitch() called in wrong phase: ${state.phase} (expected WAITING_FOR_SWITCH)`,
      );
    }

    const sideKey = sideKeyFor(side);
    const currentSide = state[sideKey];
    const targetMon = currentSide.team[toIndex];

    if (!targetMon) {
      throw new Error(`Invalid switch target index: ${toIndex}`);
    }
    if (targetMon.fainted) {
      throw new Error(`Cannot switch to fainted Pokemon at index ${toIndex}`);
    }

    const log: TurnLogEntry[] = [];

    // Update active index
    let current: BattleState = {
      ...state,
      [sideKey]: {
        ...currentSide,
        activeIndex: toIndex,
      },
    };

    // Reset toxic counter if switched-in Pokemon has tox status
    if (targetMon.status === "tox") {
      current = updateSideTeam(current, sideKey, team =>
        replaceTeamMember(team, toIndex, { toxicCounter: 1 }),
      );
    }

    log.push({
      kind: "SWITCH",
      actor: side,
      detail: {
        fromIndex: currentSide.activeIndex,
        toIndex,
        pokemon: targetMon.name,
      },
    });

    // Check if the OTHER side also needs a forced switch (both fainted same turn)
    const otherSideKey = sideKeyFor(oppositeActor(side));
    const otherSide = current[otherSideKey];
    const otherActive = otherSide.team[otherSide.activeIndex]!;

    if (otherActive.fainted && hasAliveTeammates(otherSide)) {
      // Other side still needs to switch — stay in WAITING_FOR_SWITCH
      current = { ...current, phase: "WAITING_FOR_SWITCH" };
    } else if (allFainted(otherSide)) {
      // Other side fully wiped — this side wins
      const winner = side;
      current = { ...current, phase: "BATTLE_OVER", winner };
      log.push({
        kind: "WIN",
        actor: winner,
        detail: {},
      });
    } else {
      // Normal continuation — advance to next turn
      current = {
        ...current,
        phase: "WAITING_FOR_ACTION",
        turnCount: current.turnCount + 1,
      };
    }

    return { nextState: current, log };
  },
} as const;

// ---------------------------------------------------------------------------
// Internal: post-turn phase resolution
// ---------------------------------------------------------------------------

/**
 * After all actions in a turn resolve, determine the next phase:
 *   - If a side is fully fainted: BATTLE_OVER with winner set
 *   - If any active Pokemon is fainted with alive teammates: WAITING_FOR_SWITCH
 *   - Otherwise: increment turn, WAITING_FOR_ACTION
 */
function resolvePostTurnPhase(
  state: BattleState,
  log: TurnLogEntry[],
): BattleState {
  const playerAllDead = allFainted(state.playerSide);
  const opponentAllDead = allFainted(state.opponentSide);

  // Check for win/loss (double KO: attacker wins, but check opponent first since
  // if both are all-fainted the last actor to attack caused the final faint)
  if (playerAllDead && opponentAllDead) {
    // Double KO — opponent wins by convention (last to be attacked)
    // This is a rare edge case; real games would handle this differently
    return { ...state, phase: "BATTLE_OVER", winner: "opponent" };
  }
  if (playerAllDead) {
    log.push({ kind: "WIN", actor: "opponent", detail: {} });
    return { ...state, phase: "BATTLE_OVER", winner: "opponent" };
  }
  if (opponentAllDead) {
    log.push({ kind: "WIN", actor: "player", detail: {} });
    return { ...state, phase: "BATTLE_OVER", winner: "player" };
  }

  // Check if any active Pokemon needs a forced switch
  const playerActive = state.playerSide.team[state.playerSide.activeIndex]!;
  const opponentActive = state.opponentSide.team[state.opponentSide.activeIndex]!;

  const playerNeedsSwitch = playerActive.fainted && hasAliveTeammates(state.playerSide);
  const opponentNeedsSwitch = opponentActive.fainted && hasAliveTeammates(state.opponentSide);

  if (playerNeedsSwitch || opponentNeedsSwitch) {
    return { ...state, phase: "WAITING_FOR_SWITCH" };
  }

  // Normal continuation
  return {
    ...state,
    phase: "WAITING_FOR_ACTION",
    turnCount: state.turnCount + 1,
  };
}
