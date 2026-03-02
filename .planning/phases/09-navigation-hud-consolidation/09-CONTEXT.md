# Phase 9: Navigation & HUD Consolidation - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Double-tap navigates back throughout the app; the battle HUD becomes a unified action list with Attack/Switch/Tera/Stats/Back to Menu; ACTION_MENU and TERA_CONFIRM screens are eliminated; Tera queues directly into attack select with a visible indicator. Trapping abilities block Switch on the HUD. No new screens are added — this phase consolidates and simplifies existing navigation.

</domain>

<decisions>
## Implementation Decisions

### Double-tap behavior
- Fast timing window (~250ms) for double-tap detection
- No visual feedback on first tap — only second tap triggers back action
- Use G2 SDK's built-in double-tap/DOUBLE_CLICK_EVENT detection — do NOT implement custom timing logic
- Double-tap works everywhere: sub-screens (attack select, switch select, stats) AND battle HUD
- Double-tap on battle HUD triggers a forfeit confirmation prompt (not immediate exit)
- Double-tap is blocked on forced-switch screens (after a faint) — player cannot escape

### Battle HUD layout
- Item order: Attack, Switch, Tera, Stats, Back to Menu (most common action first)
- Full HUD with sprites + HP bars visible in upper portion, action list in lower portion
- No visible "Back to Menu" list item — back to menu is ONLY via double-tap (triggers forfeit confirmation)
- After Tera is used for the battle: show "Tera (used)" as grayed-out non-selectable item — list position preserved
- ACTION_MENU screen type eliminated — battle HUD IS the action menu now

### Tera queue experience
- Selecting Tera on HUD immediately opens attack select screen
- "[TERA QUEUED]" text banner appears at top of attack select screen when Tera is active
- Tera acts as a toggle — tap Tera again on HUD to un-queue (no need to back out first)
- Switching instead of attacking does NOT clear the Tera queue — it persists for next turn
- When the active Pokemon is already Terastallized: show "Tera (active)" as grayed-out, not selectable
- TERA_CONFIRM screen eliminated entirely — no confirmation step needed

### Forced-switch and trapping
- Forced switch after faint: header shows "MUST SWITCH" instead of "SWITCH" — clear mandatory indicator
- Double-tap blocked during forced switch — player must select a Pokemon
- Trapping abilities (Shadow Tag, Arena Trap, Magnet Pull): Switch option on battle HUD shows as "Switch (trapped)" grayed out, not selectable
- Both sim enforcement AND UI-level visual indication of trapping — don't rely on sim alone
- Read the sim request to detect if switching is blocked (trapped field or similar)
- No special indicator for pivot moves (U-turn, Volt Switch) when trapped — player should know these allow escape

</decisions>

<specifics>
## Specific Ideas

- The battle HUD should feel like one screen now — Attack/Switch/Tera/Stats as a quick vertical list overlaid on the battle view with sprites and HP
- Forfeit confirmation on double-tap from HUD prevents accidental battle exits
- Tera toggle is a natural interaction — tap to queue, tap again to un-queue, never a separate confirmation screen
- "MUST SWITCH" header text makes forced switches unambiguous even on a small display
- "Switch (trapped)" communicates the game state without requiring the player to try and fail

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-navigation-hud-consolidation*
*Context gathered: 2026-03-02*
