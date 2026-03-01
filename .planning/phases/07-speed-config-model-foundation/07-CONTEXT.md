# Phase 7: Speed Config & Model Foundation - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Players can select battle speed from the main menu; BattleState carries stat stage, ability, and held item data; dead v0.1 engine code is removed. This phase is foundation work — no new screens or animations, just the data model and config that later phases depend on.

</domain>

<decisions>
## Implementation Decisions

### Speed Preset Behavior
- 4 presets: Slow (0.5x), Normal (1x), Fast (2x), Instant (skip)
- Instant mode: skip all animation, dump the full turn result as static text immediately
- Session only — resets to Normal every time the app opens (no localStorage persistence)
- Speed scales BOTH text streaming (typewriter char delay) AND animation timing (sprite flash, HP drain, switch frames)
- All ANIM constants get multiplied by SpeedConfig.multiplier()

### Main Menu Layout
- Order: Enter Battle (top) → Battle Speed: [current] → About/Credits (bottom)
- Battle Speed uses inline cycling — tapping "Battle Speed: Normal" cycles to next preset (Normal → Fast → Instant → Slow → Normal)
- Current speed shown in the label: "Battle Speed: Fast"
- About/Credits screen added as simple text screen at bottom of main menu

### Dead Code Removal
- Delete ALL old custom engine files: BattleEngine.ts, DamageCalc.ts, StatusEngine.ts, TurnResolver.ts, AIOpponent.ts
- Keep ACTION_MENU and TERA_CONFIRM screen types for now — remove them in Phase 9 when replacements are built
- Full cleanup pass: remove dead imports, unused exports, commented-out code across the codebase

### Stats Data Model (BattleState Extensions)
- Track all 7 stat stages: Atk, Def, SpA, SpD, Spe, Accuracy, Evasion (matches Showdown)
- Track stat stages for BOTH player and opponent Pokemon
- Track revealed ability for opponent (once sim reveals it via protocol, store it)
- Track held item for both sides (current item, or "consumed" if used)
- Fields added to ActivePokemon type in battleState.ts
- SimBattleAdapter.deriveSide() populates new fields from @pkmn/sim Battle object

</decisions>

<specifics>
## Specific Ideas

- Speed cycling on main menu should feel instant — one tap, label updates, no screen transition
- "About/Credits" is a simple text screen, nothing fancy
- Stat stages should use the standard -6 to +6 range from Pokemon games
- Held item tracking should handle consumption events (Berry eaten, Focus Sash used, etc.)

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-speed-config-model-foundation*
*Context gathered: 2026-03-01*
