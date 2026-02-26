# Pokemon Showdown G2

## What This Is

A Pokemon Showdown random battle simulator for Even Realities G2 smart glasses. Players engage in 6v6 turn-based Pokemon battles against AI opponents, navigating moves, switches, and Terastallization via glasses gestures (swipe to scroll, tap to select, double-tap to go back). All Pokemon mechanics, data, and sprites are pulled from existing online repositories — nothing is built from scratch.

## Core Value

Players can play a complete random battle on their G2 glasses with attack, switch, and Terastallize options — using real Pokemon Showdown data and mechanics.

## Current Milestone: v0.1 Random Battle Simulator

**Goal:** Build a fully playable 6v6 random battle against AI on G2 glasses, pulling all game data from Pokemon Showdown's public repos.

**Target features:**
- Main menu screen with "Enter Battle" option
- Random team generation (all generations) for player and AI
- Battle display: both Pokemon names, HP percentages, 8-bit sprites
- Attack selection from 4 moves (vertical list)
- Pokemon switch screen showing full team
- Terastallization option
- Gesture navigation: swipe up/down to scroll, tap to select, double-tap to go back
- AI opponent that makes random/semi-intelligent move choices

## Requirements

### Validated

- ✓ G2 glasses adapter with text, list, and message rendering — existing
- ✓ Gesture handling (scroll, tap, foreground events) — existing
- ✓ Wake lock service for keeping phone screen active — existing
- ✓ Build toolchain (Vite, TypeScript, Even Hub SDK) — existing
- ✓ Pokemon Showdown data files downloaded (pokedex, moves, learnsets, typechart, abilities, items) — existing
- ✓ Gen 1 sprite directory structure created — existing

### Active

- [ ] Main menu with "Enter Battle" entry point
- [ ] Random team generation using Showdown data (all gens)
- [ ] Battle state engine (turns, damage calc, fainting, switching)
- [ ] Battle HUD showing both Pokemon, names, HP%
- [ ] 8-bit sprites rendered on glasses display
- [ ] Attack selection screen (4 moves, vertical list)
- [ ] Switch Pokemon screen (full team, vertical list)
- [ ] Terastallization mechanic
- [ ] AI opponent logic
- [ ] Gesture navigation: swipe scroll, tap select, double-tap back
- [ ] Win/loss detection and battle end screen

### Out of Scope

- Online multiplayer — v0.1 is single-player vs AI only
- Custom team building — random battles only
- Animations/transitions — G2 display is text/list only
- Sound effects — G2 glasses have no speaker
- Move effects beyond damage (status conditions, stat changes) — defer to v0.2
- Abilities — defer to v0.2
- Items/held items — defer to v0.2

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
