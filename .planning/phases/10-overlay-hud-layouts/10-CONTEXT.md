# Phase 10: Overlay HUD Layouts - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Attack select, switch select, and battle HUD screens all use an overlay layout: Pokemon sprite composites (with HP bars, status, stat modifiers) remain visible while a bordered text box in the bottom-right quadrant shows the selectable list. A team preview bar across the top shows both teams' mini-sprites. No new screens are added — this phase transforms the visual layout of existing screens.

</domain>

<decisions>
## Implementation Decisions

### Composite sprite images
- Each side (player + opponent) is rendered as a SINGLE BMP image containing: name, level, HP% bar, status condition, changed stat modifiers (multiplier format: 0.5x SpD, 1.5x Atk), and the Pokemon sprite
- HP bar + name sits ABOVE the sprite (Pokemon Showdown style nameplate)
- Only non-neutral stat stages are shown (clean when neutral, informative when changed)
- Opponent's composite also shows their stat changes — full battlefield awareness on both sides
- During animation, composites are dynamic (HP drain, etc.) — during HUD/selection screens, composites are static single images
- Sprite sizes stay roughly the same as current — minor adjustments OK but no dramatic shrinking
- No overlap between sprite composites and the text box — everything coexists in distinct areas

### Team preview bar (4th container)
- Single row across the top of the screen showing both teams: player's 6 on one side, opponent's 6 on the other, separated by a divider line with spacing
- All 6 of player's team always shown as mini-sprites (you know your team)
- Opponent's team: revealed Pokemon show mini-sprites, unrevealed show pokeball icons
- Fainted Pokemon shown as grayed-out mini-sprites
- Composited as one single BMP image, updated whenever a Pokemon is revealed or faints
- Visible on: battle HUD, attack select, switch select (all decision screens)
- NOT visible during: battle animation playback

### 4-container allocation
1. **Team preview bar** (top) — both teams' mini-sprites/pokeballs in one row
2. **Opponent composite** (top-right area) — name, level, HP, status, stat changes, sprite
3. **Player composite** (bottom-left area) — name, level, HP, status, stat changes, sprite
4. **Selectable text list** (bottom-right) — bordered frame with move list / team list / action list

### Text box (bottom-right quadrant)
- Bordered frame around the scrollable list (consistent with Phase 8 text box style)
- Contains: move list (attack select), team list (switch select), or action list (battle HUD)
- Bottom-right quadrant of 576x288 display (~288x144)

### Screen layout consistency
- Battle HUD uses the same overlay layout as attack/switch select — sprites visible with action list in the text box
- All decision screens share the same visual structure: team bar + two sprite composites + text box

### Transition behavior
- Snap/instant swap between screens — no transition animation
- When navigating between battle HUD / attack select / switch select, only the text box container content updates; sprite composites stay as-is (fastest possible navigation)
- Re-render composites only when state actually changes (after turn resolution)

### Post-turn composite pre-computation
- Once moves are selected and the turn resolves, the end state is known immediately
- Pre-compute the post-turn composite BMPs concurrently while animation plays
- When animation finishes and transitions to battle HUD, composites are already built — zero delay

</decisions>

<specifics>
## Specific Ideas

- Reference: Pokemon Showdown's nameplate style — name + level above, HP bar below name, status conditions and stat modifiers below HP bar, all above the sprite
- Stat modifiers use multiplier format (0.5x, 0.67x, 1.5x) not stage notation (+1, -2) — matches Pokemon Showdown's tooltip display
- Team preview bar inspired by Pokemon Showdown's team icons — mini-sprites in a row, pokeballs for unrevealed
- The composite image approach is key — baking multiple data points into one BMP avoids the 4-container SDK limit while maximizing information density

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-overlay-hud-layouts*
*Context gathered: 2026-03-02*
