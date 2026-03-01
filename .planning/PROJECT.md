# Pokemon Showdown G2

## What This Is

A Pokemon Showdown random battle simulator for Even Realities G2 smart glasses. Players engage in 6v6 turn-based Pokemon battles against AI opponents, navigating moves, switches, and Terastallization via glasses gestures (swipe to scroll, tap to select, double-tap to go back). All Pokemon mechanics, data, and sprites are pulled from existing online repositories — nothing is built from scratch.

## Core Value

Players can play a complete random battle on their G2 glasses with attack, switch, and Terastallize options — using real Pokemon Showdown data and mechanics.

## Current Milestone: v1.1 UI Enhancement & Polish

**Goal:** Make the battle experience cleaner, faster, and closer to Pokemon Showdown — redesigned screens, consolidated menus, animation polish, stats viewer, and speed controls.

**Target features:**
- Main menu with battle speed control and additional options
- Remove back buttons from all screens (double-tap only navigation)
- Battle animation text displayed in a box
- Attack/Switch/Tera menu on main battle screen (one less navigation level)
- Attack screen preserves HP bars, sprites, Pokemon visibility
- Switch screen preserves HP bars, sprites, Pokemon visibility
- Tera selection without confirmation screen (notifier only)
- Pokemon attack movement animation
- Stats screen showing abilities, status conditions, stat modifiers, opponent speed range, possible abilities
- Battle speed menu controlling animation speed and text streaming speed
- Back to main menu option at bottom of menu screen
- Code optimization pass

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

- G2 display is 576x288 monochrome, renders text and lists via SDK containers
- Max ~64 chars per line, ~8 lines of content visible
- SDK supports text containers (content display) and list containers (scrollable selection)
- Sprites must be very small pixel art to fit — Gen 1 style 8-bit sprites from Showdown CDN
- Pokemon Showdown data already downloaded to `src/data/` (pokedex.json, moves.json, learnsets.json, typechart.json, abilities.json, items.json)
- All menus displayed vertically — firmware handles list scrolling
- Navigation: swipe = scroll up/down, tap = select, double-tap = go back

## Constraints

- **Display**: G2 monochrome 576x288 — all UI must fit within text/list containers
- **Input**: Gestures only (scroll, tap, double-tap) — no keyboard, no touch screen on glasses
- **Data source**: Must use Pokemon Showdown public data — do not recreate mechanics from scratch
- **SDK limits**: Text content max 1000 chars on rebuild, 2000 chars on in-place update
- **Sprites**: Must be small enough to render on G2 — 8-bit pixel art style

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pull all game data from Showdown repos | Avoid reimplementing Pokemon mechanics; stay accurate | — Pending |
| 8-bit sprites from Showdown CDN | Smallest sprites that fit G2 display | — Pending |
| Random battles only for v0.1 | Simplest battle format, no team builder needed | — Pending |
| Defer status effects, abilities, items to v0.2 | Reduce v0.1 scope to core battle loop | — Pending |

---
*Last updated: 2026-02-26 after initialization*
