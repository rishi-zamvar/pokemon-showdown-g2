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
 *   - Status effects: checkMoveBlock() before attack, applyEndOfTurnStatus() after (Plan 03-03)
 *   - Tera one-use per side enforced; logs warning if attempted twice
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
import {
  checkMoveBlock,
  applyEndOfTurnStatus,
  resetToxicOnSwitchIn,
  inflictStatus,
} from "./StatusEngine.js";
import { DataLoader } from "../data/DataLoader.js";

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

        // Reset toxic counter on switch-in via StatusEngine
        const switchedIn = current[actorSideKey].team[toIndex]!;
        const resetMon = resetToxicOnSwitchIn(switchedIn);
        if (resetMon !== switchedIn) {
          current = updateSideTeam(current, actorSideKey, team =>
            replaceTeamMember(team, toIndex, resetMon),
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

        // --- Status Move Block Check ---
        const blockResult = checkMoveBlock(actorMon, actor);
        if (blockResult.logEntry) {
          log.push(blockResult.logEntry);
        }
        // Update pokemon state (sleep turns decremented, freeze may thaw)
        if (blockResult.newPokemon !== actorMon) {
          current = updateSideTeam(current, actorSideKey, team =>
            replaceTeamMember(team, actorSide.activeIndex, blockResult.newPokemon),
          );
        }
        if (blockResult.blocked) {
          continue; // Skip attack — paralysis, sleep, or freeze
        }

        // Handle Tera activation
        if (action.type === "TERA_ATTACK") {
          if (current[actorSideKey].teraUsed) {
            // Log warning but don't crash — treat as regular attack
            console.warn(`${actor} already used Terastallization — treating as regular ATTACK`);
          } else {
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
        }

        // --- PP Check ---
        const currentAttacker = current[actorSideKey].team[current[actorSideKey].activeIndex]!;
        let actualMoveSlug = moveSlug;
        let useStruggle = false;

        const maxPP = getMovePP(moveSlug);
        const usedPP = currentAttacker.ppUsed[moveSlug] ?? 0;

        if (usedPP >= maxPP) {
          // Check if ALL moves are out of PP — if so, use Struggle
          const allPPOut = currentAttacker.moves.every(m => {
            const mMax = getMovePP(m);
            const mUsed = currentAttacker.ppUsed[m] ?? 0;
            return mUsed >= mMax;
          });

          if (allPPOut) {
            // All PP exhausted — use Struggle (typeless 50 BP, always hits, 25% recoil)
            useStruggle = true;
            actualMoveSlug = "struggle";
          } else {
            // This specific move has no PP but others do — skip
            log.push({
              kind: "PP_OUT",
              actor,
              detail: { move: moveSlug },
            });
            continue;
          }
        }

        // Consume 1 PP (skip for Struggle)
        if (!useStruggle) {
          current = updateSideTeam(current, actorSideKey, team =>
            replaceTeamMember(team, current[actorSideKey].activeIndex, {
              ppUsed: { ...currentAttacker.ppUsed, [moveSlug]: usedPP + 1 },
            }),
          );
        }

        // --- Accuracy Check (Struggle always hits) ---
        if (!useStruggle) {
          const accuracy = getMoveAccuracy(actualMoveSlug);
          if (!doesMoveHit(accuracy)) {
            log.push({
              kind: "MISS",
              actor,
              detail: { move: actualMoveSlug },
            });
            continue;
          }
        }

        // --- Crit Roll (Struggle cannot crit) ---
        const critRatio = useStruggle ? 0 : getMoveCritRatio(actualMoveSlug);
        const isCrit = useStruggle ? false : rollCrit(critRatio);

        // --- Damage Calculation ---
        const attackerMon = current[actorSideKey].team[current[actorSideKey].activeIndex]!;
        const targetSide = current[targetSideKey];
        const targetIndex = targetSide.activeIndex;
        const targetMon = targetSide.team[targetIndex]!;

        const damage = computeDamage(attackerMon, targetMon, actualMoveSlug, isCrit);
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
            move: actualMoveSlug,
            damage,
            isCrit,
            targetHp: newHp,
            targetMaxHp: targetMon.stats.hp,
          },
        });

        // --- Status Infliction from Moves ---
        // Look up move data once; reuse for both primary and secondary blocks.
        const moveInfo = DataLoader.getMove(actualMoveSlug.toLowerCase());

        // Block A — Primary status moves (category === "Status"): apply status field directly.
        // Status moves deal 0 damage; the status is the primary effect.
        if (moveInfo?.category === "Status" && moveInfo.status) {
          const targetAfterDmg = current[targetSideKey].team[targetSide.activeIndex]!;
          const statusResult = inflictStatus(
            targetAfterDmg,
            moveInfo.status,
            oppositeActor(actor), // actor receiving the status
          );
          if (statusResult.log) {
            current = updateSideTeam(current, targetSideKey, team =>
              replaceTeamMember(team, targetSide.activeIndex, statusResult.newPokemon),
            );
            log.push(statusResult.log);
          }
        }

        // Block B — Secondary effect on damaging moves: roll chance to inflict status.
        // Only roll if the move dealt damage, is not Struggle, and has a secondary with a status.
        if (
          damage > 0 &&
          !useStruggle &&
          moveInfo?.secondary &&
          moveInfo.secondary.status &&
          typeof moveInfo.secondary.chance === "number"
        ) {
          if (Math.random() * 100 < moveInfo.secondary.chance) {
            const targetAfterDmg2 = current[targetSideKey].team[targetSide.activeIndex]!;
            if (!targetAfterDmg2.fainted) {
              const secResult = inflictStatus(
                targetAfterDmg2,
                moveInfo.secondary.status,
                oppositeActor(actor),
              );
              if (secResult.log) {
                current = updateSideTeam(current, targetSideKey, team =>
                  replaceTeamMember(team, targetSide.activeIndex, secResult.newPokemon),
                );
                log.push(secResult.log);
              }
            }
          }
        }

        // Struggle recoil: attacker takes 25% of max HP as recoil damage
        if (useStruggle && damage > 0) {
          const recoil = Math.max(1, Math.floor(attackerMon.stats.hp / 4));
          const attackerAfter = current[actorSideKey].team[current[actorSideKey].activeIndex]!;
          const recoilHp = Math.max(0, attackerAfter.currentHp - recoil);
          const attackerFainted = recoilHp === 0;
          current = updateSideTeam(current, actorSideKey, team =>
            replaceTeamMember(team, current[actorSideKey].activeIndex, {
              currentHp: recoilHp,
              fainted: attackerFainted,
            }),
          );
          log.push({
            kind: "DAMAGE",
            actor,
            detail: {
              move: "struggle-recoil",
              damage: recoil,
              isCrit: false,
              targetHp: recoilHp,
              targetMaxHp: attackerMon.stats.hp,
            },
          });
          if (attackerFainted) {
            log.push({
              kind: "FAINT",
              actor,
              detail: { pokemon: attackerMon.name },
            });
          }
        }

        // Log faint if target was KO'd
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

    // --- End-of-turn status effects ---
    // Apply to both sides' active Pokemon (if not fainted and not already BATTLE_OVER)
    for (const sideActor of ["player", "opponent"] as const) {
      const sk = sideKeyFor(sideActor);
      const side = current[sk];
      const activeMon = side.team[side.activeIndex]!;
      if (activeMon.fainted) continue;

      const statusResult = applyEndOfTurnStatus(activeMon, sideActor);
      if (statusResult.damage > 0 || statusResult.log.length > 0) {
        current = updateSideTeam(current, sk, team =>
          replaceTeamMember(team, side.activeIndex, statusResult.newPokemon),
        );
        log.push(...statusResult.log);

        // Check for faint from status damage
        if (statusResult.newPokemon.fainted) {
          log.push({
            kind: "FAINT",
            actor: sideActor,
            detail: { pokemon: activeMon.name },
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

    // Reset toxic counter on switch-in via StatusEngine
    const resetMon = resetToxicOnSwitchIn(targetMon);
    if (resetMon !== targetMon) {
      current = updateSideTeam(current, sideKey, team =>
        replaceTeamMember(team, toIndex, resetMon),
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
