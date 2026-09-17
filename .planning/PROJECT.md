# Pokemon Showdown G2

## What This Is

A Pokemon Showdown random battle simulator for Even Realities G2 smart glasses. Players engage in 6v6 turn-based Pokemon battles against AI opponents, navigating moves, switches, and Terastallization via glasses gestures (swipe to scroll, tap to select, double-tap to go back). All Pokemon mechanics, data, and sprites are pulled from existing online repositories — nothing is built from scratch.

## Core Value

Players can play a complete random battle on their G2 glasses with attack, switch, and Terastallize options — using real Pokemon Showdown data and mechanics.

## Current Milestone: v2.0 Showdown Parity

**Goal:** The G2 app plays and reads like Pokemon Showdown online — correct rendering, every battle fact reachable without a pointer, and a render pipeline built against the platform's measured limits.

**Why now:** The app was unplayable. Two root causes, both found by instrumentation in Sept 2026: dangling asset symlinks meant no battle ever started, and a 576x24 team bar exceeded the 288x144 image container cap, which failed the entire page rebuild and removed the action list. Both are fixed. What the instrumentation then exposed is that the render layer was built against assumptions that are wrong — a monochrome display that is actually 4-bit greyscale, and a cost model where call count, not payload, dominates.

**Target features:**
- Automation-API test harness that reads the real glasses framebuffer — TDD foundation, built first
- Correct rendering: turn text, persistent nameplates, container bounds guards
- 4-bit greyscale sprite pipeline replacing the 1-bit dithered BMP encoder
- Full information access via native context menu + inspect screens (no hover on G2)
- Modern input model: long-press, context menu, ring/temple event sources, root-page exit
- Performance restructured around call count (~104 ms per image send, ~165 ms per rebuild)
- "You"/"Foe" labels removed from the display

**Key context:**
- Display is 576x288 **4-bit greyscale (16 levels)**, not monochrome
- Image containers: 20-288 x 20-144, max 4 per page; 8 other containers; 12 total
- Measured: `updateImageRawData` ~104 ms fixed, `rebuildPageContainer` ~165 ms flat, `textContainerUpgrade` ~83 ms
- Current battle HUD costs ~477 ms per screen change
- Simulator 0.9.5 exposes an HTTP automation API (input + framebuffer + console) — this is what makes TDD possible here
- SDK moved 0.0.7 -> 0.0.15 (purely additive); simulator 0.4.1 -> 0.9.5

**Decisions locked (2026-09-17):**
- Information access: native context menu + dedicated inspect screens
- Sprites: full 4-bit greyscale pipeline, no app-side dithering
- Performance: restructure to cut host call count

## Requirements

### Validated

- ✓ G2 glasses adapter with text, list, and message rendering — existing
- ✓ Gesture handling (scroll, tap, foreground events) — existing
- ✓ Wake lock service for keeping phone screen active — existing
- ✓ Build toolchain (Vite, TypeScript, Even Hub SDK) — existing
- ✓ Pokemon Showdown data files downloaded (pokedex, moves, learnsets, typechart, abilities, items) — existing
- ✓ Gen 1 sprite directory structure created — existing
- ✓ Main menu with "Enter Battle" entry point — v0.1
- ✓ Random team generation using @pkmn/randoms (all gens) — v0.1
- ✓ Battle state engine via @pkmn/sim (turns, damage, fainting, switching) — v0.1
- ✓ Battle HUD showing both Pokemon, names, HP%, sprites — v0.1
- ✓ 8-bit sprites rendered on glasses display — v0.1
- ✓ Attack selection screen (4 moves, vertical list) — v0.1
- ✓ Switch Pokemon screen (full team, vertical list) — v0.1
- ✓ Terastallization mechanic — v0.1
- ✓ AI opponent logic (random with tera heuristic) — v0.1
- ✓ Gesture navigation: swipe scroll, tap select, double-tap back — v0.1
- ✓ Win/loss detection and battle end screen — v0.1
- ✓ Battle animations: typewriter text, sprite flash, HP drain — v0.1
- ✓ Switch animation (pokeball → green square → checkbox) — v0.1
- ✓ Complete protocol text coverage (~30+ message types) — v0.1

### Active

- [ ] Redesigned main menu with speed controls and options
- [ ] Remove back buttons, double-tap only navigation
- [ ] Battle animation text in a box
- [ ] Consolidated battle menu (Attack/Switch/Tera on main HUD)
- [ ] Attack screen with HP bars, sprites, and Pokemon visible
- [ ] Switch screen with HP bars, sprites, and Pokemon visible
- [ ] Tera without confirmation (notifier only)
- [ ] Pokemon attack movement animation
- [ ] Stats screen (abilities, statuses, modifiers, opponent info)
- [ ] Battle speed control (animation + text streaming)
- [ ] Back to main menu at bottom of battle menu
- [ ] Code optimization

### Out of Scope

- Online multiplayer — single-player vs AI only
- Custom team building — random battles only
- Sound effects — G2 glasses have no speaker

## Context

- G2 display is 576x288 **4-bit greyscale (16 levels of green)**, renders text, lists and images via SDK containers (corrected 2026-09-17 — was documented as monochrome, which is what led the sprite pipeline to encode 1-bit)
- Max ~64 chars per line, ~8 lines of content visible
- SDK supports text containers (content display) and list containers (scrollable selection)
- Sprites come from the Showdown CDN, resized to container and converted to greyscale (BT.601), centred on black
- Pokemon Showdown data already downloaded to `src/data/` (pokedex.json, moves.json, learnsets.json, typechart.json, abilities.json, items.json)
- All menus displayed vertically — firmware handles list scrolling
- Navigation: swipe = scroll up/down, tap = select, double-tap = go back

## Constraints

- **Display**: G2 4-bit greyscale 576x288 — all UI must fit within text/list/image containers; images capped at 20-288 x 20-144, max 4 per page, 12 containers total
- **Input**: Gestures only (scroll, tap, double-tap) — no keyboard, no touch screen on glasses
- **Data source**: Must use Pokemon Showdown public data — do not recreate mechanics from scratch
- **SDK limits**: Text content max 1000 chars on rebuild, 2000 chars on in-place update
- **Sprites**: Sized to their container, sent as greyscale PNG with no app-side dithering — the host downsamples to 4-bit better than we can

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pull all game data from Showdown repos | Avoid reimplementing Pokemon mechanics; stay accurate | — Pending |
| Greyscale PNG sprites from Showdown CDN | Display is 4-bit greyscale; app-side 1-bit dithering produced dot noise | — Phase 15 |
| Random battles only for v0.1 | Simplest battle format, no team builder needed | — Pending |
| Defer status effects, abilities, items to v0.2 | Reduce v0.1 scope to core battle loop | — Pending |

---
*Last updated: 2026-02-26 after initialization*
