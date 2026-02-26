# Requirements: Pokemon Showdown G2

**Defined:** 2026-02-26
**Core Value:** Players can play a complete random battle on G2 glasses with attack, switch, and Terastallize

## v0.1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Data Infrastructure

- [ ] **DATA-01**: Fix broken data files (abilities.json, items.json, typechart.json are HTML 404 pages)
- [ ] **DATA-02**: Integrate @pkmn/randoms for random team generation (all gens supported)
- [ ] **DATA-03**: Integrate @smogon/calc for damage calculation
- [ ] **DATA-04**: Load only the 12 match Pokemon's data at battle start (not full pokedex)
- [ ] **DATA-05**: Clear all cached match data when battle ends (zero memory footprint between matches)
- [ ] **DATA-06**: Filter non-standard Pokemon (Megas, CAP, Future) from team generation

### Team Generation

- [ ] **TEAM-01**: Generate random 6-Pokemon team for player using @pkmn/randoms
- [ ] **TEAM-02**: Generate random 6-Pokemon team for AI opponent using @pkmn/randoms
- [ ] **TEAM-03**: Each Pokemon has 4 moves, stats, type(s), level, and Tera type
- [ ] **TEAM-04**: Teams are valid for Gen 9 random battle format

### Battle Engine

- [ ] **BATTLE-01**: Turn-based battle loop (player chooses action, AI chooses action, resolve turn)
- [ ] **BATTLE-02**: Damage calculation using @smogon/calc (power, type effectiveness, STAB, random roll)
- [ ] **BATTLE-03**: Critical hit chance (1/24 at 1.5x multiplier)
- [ ] **BATTLE-04**: Type effectiveness (super effective 2x, not very effective 0.5x, immune 0x, dual-type)
- [ ] **BATTLE-05**: Faint detection (HP reaches 0) and forced switch to next alive Pokemon
- [ ] **BATTLE-06**: Voluntary switching (player can switch Pokemon on their turn instead of attacking)
- [ ] **BATTLE-07**: Terastallization (one use per battle, changes Pokemon type, affects STAB)
- [ ] **BATTLE-08**: Turn order based on speed stat (faster Pokemon moves first)
- [ ] **BATTLE-09**: Status conditions (burn, paralysis, poison, sleep, freeze) with per-turn effects
- [ ] **BATTLE-10**: Win condition (all 6 of opponent's Pokemon fainted) and loss condition (all 6 of player's fainted)
- [ ] **BATTLE-11**: Move PP tracking (moves have limited uses)
- [ ] **BATTLE-12**: Move accuracy check (moves can miss based on accuracy stat)

### UI Screens

- [ ] **UI-01**: Main menu screen with "Enter Battle" option displayed on glasses
- [ ] **UI-02**: Battle HUD showing: player Pokemon name + HP%, opponent Pokemon name + HP%
- [ ] **UI-03**: Action menu (vertical list): Attack, Switch, Terastallize — shown after tap on battle HUD
- [ ] **UI-04**: Attack selection screen (vertical list): 4 moves with type indicators, "< Back" at top
- [ ] **UI-05**: Switch Pokemon screen (vertical list): all alive team members with HP%, "< Back" at top
- [ ] **UI-06**: Terastallize confirmation screen with Tera type shown, "< Back" at top
- [ ] **UI-07**: Turn result display showing what happened (damage dealt, effectiveness, status applied)
- [ ] **UI-08**: Win/loss screen with option to return to main menu
- [ ] **UI-09**: All screens fit within G2 display (64 chars/line, 8 lines, 1000 char rebuild limit)
- [ ] **UI-10**: Phone companion screen shows battle state with sprites (using PokeAPI/Showdown CDN sprites)

### Navigation

- [ ] **NAV-01**: Swipe down moves cursor down in vertical lists
- [ ] **NAV-02**: Swipe up moves cursor up in vertical lists
- [ ] **NAV-03**: Tap selects the currently highlighted list item
- [ ] **NAV-04**: "< Back" item at top of every sub-menu returns to previous screen
- [ ] **NAV-05**: Navigation feels responsive (no lag between gesture and screen update)

### AI Opponent

- [ ] **AI-01**: AI scores each available move by expected damage using @smogon/calc
- [ ] **AI-02**: AI prefers super-effective moves over neutral moves
- [ ] **AI-03**: AI switches Pokemon when current matchup is unfavorable
- [ ] **AI-04**: AI uses Terastallization when it would flip a bad matchup
- [ ] **AI-05**: AI makes decisions within one turn cycle (no noticeable delay)

## Future Requirements (v0.2+)

### Enhanced Mechanics

- **MECH-01**: Abilities with passive effects (Levitate, Intimidate, etc.)
- **MECH-02**: Held items with battle effects
- **MECH-03**: Weather conditions (sun, rain, sandstorm, hail)
- **MECH-04**: Entry hazards (Stealth Rock, Spikes, Toxic Spikes)
- **MECH-05**: Priority moves (Quick Attack, Extreme Speed)
- **MECH-06**: Multi-hit moves, recoil moves, draining moves

### Enhanced AI

- **AI-06**: Difficulty levels (Easy/Normal/Hard)
- **AI-07**: AI prediction of player switches

### Enhanced UI

- **UI-11**: Battle animations on phone companion
- **UI-12**: Move effectiveness indicator before selecting
- **UI-13**: Battle history/log scrollable on phone

## Out of Scope

| Feature | Reason |
|---------|--------|
| Online multiplayer | v0.1 is single-player vs AI only |
| Custom team building | Random battles only — no teambuilder |
| Sound effects | G2 glasses have no speaker |
| Full Showdown simulator (@pkmn/sim) | Too heavy (5-10MB), needs Node polyfills |
| Abilities | Complex interactions, defer to v0.2 |
| Held items | Requires ability system for many items |
| Weather/terrain | Requires multi-turn state tracking |
| Entry hazards | Requires layer-counting state |
| Stellar Tera type | Edge case, defer to v0.2 |
| Sprites on glasses display | SDK only supports text/list containers |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| DATA-04 | Phase 1 | Complete |
| DATA-05 | Phase 1 | Complete |
| DATA-06 | Phase 1 | Complete |
| TEAM-01 | Phase 2 | Pending |
| TEAM-02 | Phase 2 | Pending |
| TEAM-03 | Phase 2 | Pending |
| TEAM-04 | Phase 2 | Pending |
| BATTLE-01 | Phase 3 | Pending |
| BATTLE-02 | Phase 3 | Pending |
| BATTLE-03 | Phase 3 | Pending |
| BATTLE-04 | Phase 3 | Pending |
| BATTLE-05 | Phase 3 | Pending |
| BATTLE-06 | Phase 3 | Pending |
| BATTLE-07 | Phase 3 | Pending |
| BATTLE-08 | Phase 3 | Pending |
| BATTLE-09 | Phase 3 | Pending |
| BATTLE-10 | Phase 3 | Pending |
| BATTLE-11 | Phase 3 | Pending |
| BATTLE-12 | Phase 3 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |
| UI-03 | Phase 5 | Pending |
| UI-04 | Phase 5 | Pending |
| UI-05 | Phase 5 | Pending |
| UI-06 | Phase 5 | Pending |
| UI-07 | Phase 5 | Pending |
| UI-08 | Phase 5 | Pending |
| UI-09 | Phase 5 | Pending |
| UI-10 | Phase 5 | Pending |
| NAV-01 | Phase 5 | Pending |
| NAV-02 | Phase 5 | Pending |
| NAV-03 | Phase 5 | Pending |
| NAV-04 | Phase 5 | Pending |
| NAV-05 | Phase 5 | Pending |
| AI-01 | Phase 4 | Pending |
| AI-02 | Phase 4 | Pending |
| AI-03 | Phase 4 | Pending |
| AI-04 | Phase 4 | Pending |
| AI-05 | Phase 4 | Pending |

**Coverage:**
- v0.1 requirements: 42 total (note: prior count of 38 was pre-BATTLE-09 through 12 addition)
- Mapped to phases: 42
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 — traceability updated after roadmap creation*
