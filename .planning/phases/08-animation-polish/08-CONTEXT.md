# Phase 8: Animation Polish - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Battle animations display inside a visible text box frame, the attacking sprite lunges toward the target before hit, all timing scales with the battle speed setting, and Instant mode skips animations entirely. This phase wires SpeedConfig (from Phase 7) into the existing AnimationEngine. No new screens, no new data model — purely visual/timing polish.

</domain>

<decisions>
## Implementation Decisions

### Text box frame design
- Double-line Unicode box drawing characters (╔═╗║╚═╝) for the border
- Text box occupies the bottom third (~96px) of the 576x288 display
- Sprites stay visible above the text box during animation
- Box holds 3-4 lines of text at once
- Box persists during the full turn — appears at turn start, stays while all entries play, disappears when HUD returns

### Lunge animation behavior
- Small shift (~10-15% of screen width) toward the target
- Both player and opponent Pokemon lunge when they attack
- Contact moves lunge, ranged/special moves stay in place (just flash the target)
- Status moves have NO lunge — lunge is only for attacking moves
- After lunge: snap back instantly to original position (no smooth slide back)

### Speed scaling behavior
- Everything scales uniformly — typewriter, lunge, HP drain, sprite flash, switch animation
- Speed controls FRAME COUNT, not frame rate:
  - Slow (0.5x multiplier): MORE frames pushed = smoother, more immersive animation
  - Normal (1x): baseline frame count
  - Fast (2x multiplier): FEWER frames = snappier, gets the point across quickly but enough to understand what happened
- At faster speeds, SKIP frames rather than trying to push more frames per second — this stays within Bluetooth protocol limits
- Slow should feel smooth and immersive (more animation frames)
- The goal is smoother animation overall compared to current state
- Claude should calibrate minimum frame delay based on existing animation code and Bluetooth practical limits

### Instant mode behavior
- All turn event text appears at once in the text box (no typewriter, no lunge, no HP drain animation)
- Text box still uses the double-line frame border (same visual as other speeds)
- Text stays on screen until player TAPS to advance (player controls the pace)
- Faint/switch is still communicated clearly:
  - Opponent auto-switch gets some visual indication
  - Player faint triggers the switch selection screen
  - The experience should flow smoothly even without animations
- Sprites update to final state instantly (no animation frames for switch/faint)

</decisions>

<specifics>
## Specific Ideas

- Frame skipping approach for Fast speed keeps within G2 Bluetooth bandwidth constraints
- Slow mode should push more frames for a genuinely smoother experience, not just add delays
- The text box should feel like the classic Pokemon game text box at the bottom of the screen
- Switch animation (pokeball → green square → checkbox) also scales with speed setting

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-animation-polish*
*Context gathered: 2026-03-01*
