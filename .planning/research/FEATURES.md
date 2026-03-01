# Feature Landscape: v1.1 UI Enhancement & Polish

**Domain:** Pokemon Showdown G2 smart glasses battle client — UI enhancement milestone
**Researched:** 2026-03-01
**Confidence:** HIGH — primary research is the existing codebase (read directly); Showdown client UX
verified via official source code on GitHub and DeepWiki documentation.

---

## Context: What Exists vs What Is Being Added

This is a SUBSEQUENT milestone. All core battle mechanics are complete and working. The v1.1 goal
is to bring the UI closer to Pokemon Showdown's web client experience while respecting the G2
hardware constraints (576x288 monochrome, text/list containers only, gesture navigation).

### Already Built (v0.1)
- Main menu with "Enter Battle"
- Battle HUD: both Pokemon names, HP%, sprites, status/volatile display
- Action menu: Attack / Switch / Terastallize (separate from HUD)
- Attack select screen (4 moves, type, PP remaining/max)
- Switch select screen (full team list with HP%)
- Tera confirm screen (separate confirmation step)
- Turn result screen (battle log with typewriter text)
- Animations: typewriter, sprite flash (hit/miss/faint), HP drain, switch slide-in
- Complete protocol text coverage (~30+ message types)
- AI opponent (SimAI via @pkmn/sim)

### Screen Navigation Graph (current)
```
MAIN_MENU
  -> BATTLE_HUD
       -> ACTION_MENU
            -> ATTACK_SELECT  (move chosen -> ANIMATING -> TURN_RESULT -> back)
            -> SWITCH_SELECT  (voluntary)
            -> TERA_CONFIRM
                 -> ATTACK_SELECT
  TURN_RESULT -> BATTLE_HUD | SWITCH_SELECT (forced) | END_SCREEN
  END_SCREEN -> MAIN_MENU
```

---

## How Pokemon Showdown Web Client Displays Battle Information

This section documents what the Showdown web client actually shows, so we can identify
what to adapt for glasses.

### Showdown Battle Screen Layout

**Three-column layout:**
1. Battle field (sprites, HP bars, field conditions)
2. Battle log (scrolling text log + move/switch choice buttons)
3. Chat / room info

**Battle field shows:**
- Both Pokemon sprites (opponent top-right, player bottom-left, back view)
- HP bars: color-coded (green > 50%, yellow 20-50%, red < 20%), displayed as bar + percentage
- Pokemon name, level, gender icon, status badge (BRN/PAR/PSN/SLP/FRZ/TOX), held item icon
- Tera type icon when Terastallized
- Stat stage indicators (arrows or +/- numbers for each stat boost/drop)
- Team preview: 6 pokeballs per side (filled = healthy, half = damaged, empty = fainted)
- Field conditions: weather icon (sun/rain/sand/snow), terrain label, screens (Reflect/Light Screen)

**Move selection panel (inside battle log column):**
- 4 move buttons, color-coded by type (same type colors as the games)
- Each button: move name + type icon + PP remaining/max (e.g. "10/16")
- Disabled appearance when PP = 0 or move is unusable (locked by Choice, Encore, etc.)
- Tera button: checkbox next to the move list to toggle Terastallize for this turn
- "Forfeit" button accessible from the battle controls

**HP/status tooltip on hover (opponent):**
- Pokemon name, level, known held item or "Unknown"
- Possible abilities (if not yet revealed)
- Tracked moves: which moves have been used and their PP
- Speed range estimate: "Speed: X - Y" showing min/max possible speed for that set
- Stat stage display: current boosts/drops shown numerically

**Battle log:**
- Scrolling text showing all events: move usage, damage, status changes, stat changes
- Color-coded: effectiveness notices highlighted
- Player can scroll up to review old turns

**Battle speed controls:**
The Showdown client settings (gear icon) include an "Animation Speed" preference that
controls how fast battle animations play. The underlying implementation uses an
`acceleration` multiplier (BattleSceneStub shows `acceleration: NaN` as default,
updated by `updateAcceleration()`). The BattleChoiceBuilder provides instant skip.
Effectively: Slow / Normal / Fast / Instant (skip all). Users commonly use "Instant"
during high-volume ladder play to skip through animations quickly.

**Stats that change during battle (displayed on Showdown):**
- HP (tracked exactly)
- Stat stages: Atk/Def/SpA/SpD/Spe each from -6 to +6
- Status: PSN/TOX/BRN/PAR/SLP/FRZ
- Volatile conditions: CNF, TAUNT, ENCORE, DISABLE, LEECH SEED, SUBSTITUTE, etc.
- Item usage: depleted (Berry eaten, Choice locked)
- Tera active (type change shown)
- Weather (turns remaining)
- Terrain (turns remaining)
- Side conditions: Stealth Rock, Spikes layers, Reflect/Light Screen turns

**What Showdown shows on the attack screen that we currently lack:**
- HP bars and sprites remain visible while move buttons are shown (Showdown keeps the
  field visible at all times; the move panel is an overlay)
- Move category icon (Physical / Special / Status)
- Move base power number
- Approximate damage estimate (advanced feature in some clients)

**What Showdown's randbats tooltip shows for opponent:**
- Possible move pool for that Pokemon's role
- Possible abilities (if not yet revealed)
- Speed range (min speed for that set at min level, max speed at max level)
- Stat ranges for each stat
- Possible items

---

## Table Stakes

Features users expect for a Showdown-like glasses experience. Missing = feels incomplete
compared to what the user explicitly asked for.

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| Battle speed menu | Showdown has animation speed slider. User explicitly asked for it. Without it, slow typewriter is the only mode. | LOW | ANIM constants in constants.ts |
| Action menu on HUD screen | User asked to collapse Attack/Switch/Tera into the main HUD (one fewer tap). Showdown keeps choices accessible at all times. | MEDIUM | ScreenController, battleHudRenderer |
| HP bars + sprites visible on attack screen | Showdown keeps the battle field visible while you pick moves. Currently attack screen loses all visual context. | MEDIUM | attackSelectRenderer, glass adapter layout |
| HP bars + sprites visible on switch screen | Same as above for switch select. Need to know opponent's HP when deciding who to switch in. | MEDIUM | switchSelectRenderer, glass adapter layout |
| Remove back-button items from lists | Double-tap is the navigation paradigm. "< Back" as list item 0 is a clutter artifact. | LOW | All list renderers |
| Tera without confirmation screen | Showdown's Tera is a checkbox on the move select screen — no separate confirm step. Current two-tap flow is slower than necessary. | LOW | teraConfirmRenderer, ScreenController flow |
| Stats screen | Showdown shows stat stages, status, speed range for opponent. User explicitly asked for this. | HIGH | New renderer, BattleState data model |
| Text in a box during animations | Showdown's battle log is a distinct styled panel. Currently text just floats in the content container. | LOW | AnimationEngine, glass adapter |
| Pokemon attack movement animation | Showdown shows the attacker "lunge" toward the target before the move effect. User asked for this. | MEDIUM | AnimationEngine, shiftSpriteBmp (already exists) |
| Battle log box visible from HUD | Showdown always shows recent log entries on the battle screen. User wants better log visibility. | LOW | battleHudRenderer |

---

## Differentiators

Features that are unique advantages of the glasses platform or go beyond Showdown's web UI.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Glanceable speed control (3 presets) | Showdown's speed slider requires interaction. Glasses benefit from discrete named presets (Slow / Normal / Fast / Instant) that are one-swipe-one-tap to set. | LOW | Named presets map to ANIM constant multipliers |
| Back to main menu from battle menu | User asked for this explicitly. Showdown has "Forfeit" but not a clean "main menu" option. Glasses user may want to reset without finishing battle. | LOW | ScreenController, renderActionMenu |
| Stat stages shown inline on HUD | Showdown shows stat stages via tooltip hover. On glasses, show them directly in the HUD text since hover is impossible. | LOW-MEDIUM | battleHudRenderer, BattleState |
| Opponent speed range on stats screen | The randbats tooltip extension is one of Showdown's most popular community tools precisely because speed calcs matter for competitive play. Build this in natively. | MEDIUM | DataLoader (level + stats), new calc logic |
| Possible abilities display for opponent | When opponent's ability is unknown, show what's possible for that Pokemon's set. Matches randbats tooltip behavior. | MEDIUM | DataLoader (abilities.json), new renderer |

---

## Anti-Features

Things to deliberately NOT build for v1.1, even though they seem like improvements.

| Anti-Feature | Why It Seems Good | Why To Avoid | What To Do Instead |
|--------------|-------------------|--------------|-------------------|
| Scrollable battle log history | Showdown lets you scroll up through all battle events | G2 firmware scroll controls list navigation — a separate scrollable log would require a dedicated screen transition, defeating the purpose | Keep turn result screen as the log view; it already shows last 12 entries |
| Type-color-coded move buttons | Showdown uses 18 different type colors on move buttons | G2 is monochrome. Type is already shown as text in parentheses. Color coding = zero visual difference | Keep current text format: "Thunderbolt (Electric) 15/16" |
| Animated move effects (thunderbolts, fire, etc.) | Showdown has full move effect animations | G2 has no color and no GPU layer. Only sprite-level bitmap manipulation is possible. Move effects would require dozens of pre-rendered frames per move. | Keep sprite flash + lunge animation as the move visual feedback |
| Move category icon (Physical/Special/Status) | Showdown shows a category icon next to each move | Only useful if it changes strategy. On G2, "Physical/Special" could be 1 char but adds clutter for limited benefit in randbats where AI chooses optimally regardless | Display on stats screen if explicitly requested, not on attack select |
| Exact HP numbers | Showdown shows exact HP values in tooltips | Opponent's HP is intentionally hidden in randbats. Showing exact numbers would break game balance. HP% is the correct granularity. | Keep HP% display |
| Damage calculator | Showdown has a companion damage calc (calc.pokemonshowdown.com) | Too complex for v1.1 scope. Requires knowing opponent EVs, IVs, and nature — all unknown for opponent in randbats. | Speed range is achievable (known set data); damage estimate is not |
| Weather / terrain icons | Showdown shows visual weather effects | G2 cannot display weather icons graphically. Text already covers weather events via protocol messages. | Weather state is already shown in battle log text |
| Team preview screen | Showdown shows all 12 Pokemon before the battle starts | Random battle format does not use team preview (both teams are hidden). Adding this would not reflect randbats rules. | No team preview — correct for the format |
| Surrender / forfeit option mid-battle | Showdown has a forfeit button | Not worth adding in v1.1. If player wants to quit, double-tapping to main menu is sufficient. | Handled by "Back to main menu" at bottom of battle menu |

---

## Feature Analysis: Each v1.1 Request

Detailed breakdown of each feature the user explicitly asked for.

---

### 1. Battle Speed Menu

**What Showdown Does:**
Showdown has an animation speed preference that scales animation timing. The `BattleSceneStub`
class has an `acceleration` property. The scene uses it as a divisor for timing values.
Effectively: higher acceleration = faster animations.

**What We Have:**
All timing constants live in `ANIM` in `src/config/constants.ts`:
- `CHAR_DELAY_MS: 45` (typewriter character delay)
- `PUNCTUATION_PAUSE_MS: 180`
- `ENTRY_PAUSE_MS: 500` (pause between log entries)
- `FLASH_FRAME_MS: 75` (sprite flash frame duration)
- `HP_FRAME_MS: 40` (HP bar drain step)
- `SWITCH_FRAME_MS: 120` (switch animation frame)

**Proposed Implementation:**
Store `battleSpeed` as an app-level setting with 4 presets:

| Preset | Multiplier | Typewriter | Entry Pause | HP Drain |
|--------|-----------|-----------|-------------|---------|
| Slow | 0.5x | 90ms/char | 800ms | 80ms/step |
| Normal | 1x | 45ms/char | 500ms | 40ms/step |
| Fast | 2x | 20ms/char | 250ms | 20ms/step |
| Instant | Skip | 0ms (dump full text at once) | 100ms | 0ms |

The `AnimationEngine` must accept a speed multiplier. The main menu should offer a
"Battle Speed" option that opens a 4-item list.

**Complexity:** LOW
**Dependencies:** `ANIM` constants, `AnimationEngine`, `ScreenController`, `mainMenuRenderer`

---

### 2. Consolidated Battle Menu (Action Menu on HUD)

**What Showdown Does:**
The battle field is always visible. The move/switch buttons are in an adjacent panel — you
can see your Pokemon's HP while choosing a move simultaneously.

**What We Have:**
Current flow: HUD screen -> tap -> ACTION_MENU screen -> tap Attack -> ATTACK_SELECT.
This is two taps to reach the move list. The user wants Attack/Switch/Tera accessible
directly from the HUD with one tap.

**Proposed Implementation:**
Convert `BATTLE_HUD` from a text screen to a list screen. The list items ARE the action
options. The HUD content (sprites, HP bars) displays as the screen header. On tap:
- Item 0: "Attack" -> ATTACK_SELECT
- Item 1: "Switch" -> SWITCH_SELECT
- Item 2: "Terastallize" OR "Tera (used)" -> directly queue tera, go to ATTACK_SELECT
- Item 3: "Back to Menu" -> END_SCREEN / MAIN_MENU with confirmation

This eliminates the separate ACTION_MENU screen entirely.

**Complexity:** MEDIUM
**Dependencies:** `ScreenController`, `battleHudRenderer`, `ScreenState` (may need new screen type)

---

### 3. Attack Screen with HP Bars and Sprites Visible

**What Showdown Does:**
The field (sprites + HP bars) is always in the top portion of the screen. The move buttons
appear in the lower portion. The player can see opponent HP while choosing.

**What We Have:**
`ATTACK_SELECT` renders a `ListScreen` with items only. The sprites and HP text are in
separate containers (oppInfo, plyInfo, oppSprite, playerSprite) that persist from the
battle HUD. The issue is that switching to a list screen may clear the text containers.

**G2 Constraints:**
The G2 SDK has separate containers:
- `oppInfo` (container 6): opponent name + HP bar text
- `plyInfo` (container 7): player name + HP bar text
- `oppSprite` (container 4): opponent sprite image
- `playerSprite` (container 5): player sprite image
- `content` (container 1): main text area
- `status` (container 2): left status bar
- `statusRight` (container 3): right status bar

In a list screen, container 1 (`content`) becomes the list. Containers 4-7 are independent
and should persist unless explicitly cleared.

**Proposed Implementation:**
Before rendering ATTACK_SELECT, set containers 4-7 to show current battle state (same as
HUD). The list in container 1 shows the 4 moves. This requires the `GlassAdapter` to be
called with both `rebuildPageContainer` (list) AND `updateImage`/`updateText` (sprites and
HP). Currently the `renderAttackSelect` function only returns a `ListScreen` — we need a way
to also update the sprite/HP containers as part of the attack select transition.

**Complexity:** MEDIUM — requires changes to how screen transitions handle multi-container updates.
**Dependencies:** `GlassAdapter`, `attackSelectRenderer`, `ScreenController`

---

### 4. Switch Screen with HP Bars and Sprites Visible

**What Showdown Does:**
When switching, you can see the current active Pokemon's HP (it may be low, informing urgency)
and the opponent's active Pokemon (to pick an appropriate counter).

**Proposed Implementation:**
Same approach as attack screen. Before rendering `SWITCH_SELECT`, update containers 4-7 with
current battle state. The list in container 1 shows the team.

**Complexity:** MEDIUM (same pattern as attack screen)
**Dependencies:** `GlassAdapter`, `switchSelectRenderer`, `ScreenController`

---

### 5. Remove Back Buttons from Lists

**What Showdown Does:**
Navigation is click-based; there is no explicit "Back" item in lists.

**What We Have:**
Every list screen starts with `'< Back'` as item 0. This means list index 0 = go back,
and every action item is offset by 1. This was designed before double-tap was the back gesture.

**Proposed Implementation:**
Remove `'< Back'` from all list renderers:
- `attackSelectRenderer.ts`: remove `items.push('< Back')` at start
- `switchSelectRenderer.ts`: same
- `teraConfirmRenderer.ts`: same
- `actionMenuRenderer.ts`: same (or eliminate this screen entirely per feature 2)

Update `ScreenController`'s list index mapping — all items shift by 1 (no longer offset by 1).
The `indexMap` in `SwitchListScreen` must be adjusted accordingly.

**Complexity:** LOW — straightforward but affects every list handler in `ScreenController`
**Dependencies:** All list renderers, `ScreenController` `onTap` handlers, `SwitchListScreen.indexMap`

---

### 6. Tera Without Confirmation Screen

**What Showdown Does:**
Tera is a checkbox on the move select screen. Check the box, then pick a move. No separate
confirmation screen exists — once you pick a move with the box checked, Tera is used.

**What We Have:**
Current flow: ACTION_MENU -> "Terastallize" -> TERA_CONFIRM screen -> "Confirm Terastallize"
-> ATTACK_SELECT. This is 3 taps to reach move select with Tera queued.

**Proposed Implementation:**
The user asked for a "notifier only" approach: when the player selects "Terastallize" from
the consolidated battle menu, immediately set `teraQueued = true`, show a brief notification
message (e.g. "Tera queued! Pick your move."), then transition directly to ATTACK_SELECT.
No separate confirmation screen. The attack select screen should indicate Tera is active
(e.g. status bar shows "Tera: [TeraType]").

Eliminate the `TERA_CONFIRM` screen from the navigation graph and `ScreenName` union.

**Complexity:** LOW
**Dependencies:** `ScreenController`, `teraConfirmRenderer` (can be deleted), `attackSelectRenderer`

---

### 7. Stats Screen

**What Showdown Does (via battle-tooltips.ts):**
When hovering a Pokemon in Showdown, the tooltip shows:
- Known/possible abilities
- Tracked moves (revealed during battle)
- Speed range (min and max possible for that randbats set)
- Stat stages (current boosts/drops: Atk/Def/SpA/SpD/Spe each -6 to +6)
- Status condition
- Current HP percentage

**What We Have:**
`BattleState` contains per-mon: `status`, `volatiles`, `teraActive`, `teraType`, `ppUsed`,
`stats` (the computed final stats), `ability`, `item`, `level`.

The `BattleState` does NOT yet track stat stage numbers per mon (e.g. Atk +2, Spe -1).
It has `volatiles: string[]` for volatile condition names but no numeric stat stages.

**Proposed Implementation:**
New `STATS_SCREEN` with two views:
1. Player Pokemon stats (tap to view your active Pokemon)
2. Opponent Pokemon stats (swipe to switch view)

**Player view shows:**
```
You: [Name] (Lv.[level])
Ability: [ability] | Item: [item]
Status: [BRN/PAR/etc or "None"]
Tera: [type] (active/available/used)
Atk [stage] Def [stage] SpA [stage]
SpD [stage] Spe [stage] [actual speed]
HP: [bar] [pct]%
```

**Opponent view shows:**
```
Foe: [Name] (Lv.[level])
Ability: [known ability OR "? (Ability1 / Ability2)"]
Status: [status or "None"]
Speed range: [min] - [max]
Atk [stage] Def [stage] SpA [stage]
SpD [stage] Spe [stage]
HP: [bar] [pct]%
```

**Stat stage tracking requires adding to `ActivePokemon`:**
```typescript
statStages: { atk: number; def: number; spa: number; spd: number; spe: number; }
```
initialized to all 0, updated on `STAT_BOOST` / `STAT_UNBOOST` / `STAT_CLEAR` events
in `SimBattleAdapter`.

**Speed range calculation:**
Using randbats data (`@pkmn/randoms` already installed), fetch the speed stat for the
opponent's species at their assigned level (using min/max multipliers from the role's
speed spread). The speed range accounts for: base speed, level, 85 EVs at neutral nature
(standard randbats stat), no nature boost needed (randbats uses neutral by default).

Formula: `speed = floor(floor((2 * baseSpe + 31 + floor(85/4)) * level / 100 + 5) * natureMultiplier)`
For randbats: nature = 1.0, EVs = 85, IVs = 31.

**Complexity:** HIGH — requires: stat stage tracking in battle state, speed range calculator, new screen renderer, navigation update
**Dependencies:** `ActivePokemon` type, `SimBattleAdapter` (stat stage updates), new `statsRenderer.ts`, `ScreenController`

---

### 8. Animation Text in a Box

**What Showdown Does:**
Battle events appear in a distinct "battle log" panel with a styled border separate from
the field. This creates visual separation between "what happened" and "what is the state."

**What We Have:**
During animations, `AnimationEngine` calls `glass.updateText(currentText, { left: hpStatus, right: '' })`.
The text lands in the main content container with no visual distinction from the HUD.

**G2 Constraints:**
The G2 SDK does not support CSS borders or box drawing via text containers. However,
using the status bar (bottom bar, containers 2+3) for animation text while the
content container (container 1) remains the static HUD creates the equivalent of
"text in a lower panel."

**Proposed Implementation:**
During animations:
- Container 1 (`content`): shows the static HUD (sprites/HP remain)
- Container 2 (`status`): shows the animation event text scrolling in from status bar
- OR: use a dedicated TEXT container that only appears during animation phase

This is a display architecture decision more than a data model change.

**Complexity:** LOW — changes only AnimationEngine's updateText calls, no new data structures
**Dependencies:** `AnimationEngine`, `GlassAdapter.updateText` call pattern

---

### 9. Pokemon Attack Movement Animation

**What Showdown Does:**
When a Pokemon attacks, it briefly "lunges" toward the opponent (moves forward/across the
field), then returns to its position before the move effect plays.

**What We Have:**
`shiftSpriteBmp(original, offsetX, size)` already exists in `AnimationEngine` and is used
for the switch-in slide animation. It can shift the sprite BMP horizontally by N pixels.

**Proposed Implementation:**
In `AnimationEngine.playEntry()`, for `MOVE_USE` events:
1. Attacker's sprite shifts toward the opponent: 3-4 frames shifting +8px, +16px, +24px
2. Hold at max offset for 1 frame
3. Shift back: -24px, -16px, -8px, 0px
4. Then proceed with existing hit flash / HP drain on the target

For player (player lunges right = positive X offset):
- `shiftSpriteBmp(playerSprite, +offset, size)` — shifts right
For opponent (opponent lunges left = negative X offset):
- `shiftSpriteBmp(oppSprite, -offset, size)` — shifts left

This reuses the existing infrastructure completely.

**Complexity:** MEDIUM — adds 6-8 async frames per MOVE_USE event, must be cancellable
**Dependencies:** `AnimationEngine`, `shiftSpriteBmp` (already exists), `ANIM` constants

---

### 10. Back to Main Menu at Bottom of Battle Menu

**What We Have:**
No way to exit a battle in progress except winning or losing.

**Proposed Implementation:**
Add a "Main Menu" item at the bottom of the consolidated battle action list:
```
Attack
Switch
Terastallize (or "Tera: Used")
--- (separator or just bottom position)
Main Menu
```

Tapping "Main Menu" either: (a) shows a brief "Quit battle?" confirmation, or (b)
immediately returns to MAIN_MENU. Given the user's stated preference for reducing
confirmation steps, option (b) is appropriate for v1.1.

**Complexity:** LOW
**Dependencies:** `renderActionMenu` (or the new consolidated HUD menu), `ScreenController`

---

## Feature Dependencies for v1.1

```
[battleSpeed setting]
    -> stored at app level (e.g. ScreenController state or module-level variable)
    -> consumed by AnimationEngine (multiplier for all ANIM constants)
    -> set via main menu "Battle Speed" -> list screen

[consolidated battle menu on HUD]
    -> eliminates ACTION_MENU screen
    -> requires battleHudRenderer to return a hybrid screen type
    -> requires ScreenController to handle list selection from HUD

[HP/sprites on attack + switch screens]
    -> requires ScreenController to push sprite/HP updates before list rebuild
    -> no data model changes needed

[remove back buttons]
    -> all list renderers change
    -> ScreenController index mapping shifts by -1

[Tera without confirm]
    -> eliminates TERA_CONFIRM screen
    -> teraQueued flag set immediately, skip to ATTACK_SELECT
    -> ATTACK_SELECT status bar shows "Tera: [type]" when queued

[stats screen]
    -> requires stat stage tracking in ActivePokemon (new field: statStages)
    -> SimBattleAdapter must update statStages on STAT_BOOST/UNBOOST/CLEAR events
    -> new statsRenderer.ts
    -> speed range calculator using DataLoader + level formula
    -> accessible from HUD: swipe or dedicated tap gesture

[attack movement animation]
    -> extends AnimationEngine.playEntry() for MOVE_USE events
    -> reuses shiftSpriteBmp
    -> speed-controlled by battleSpeed multiplier

[text in a box]
    -> AnimationEngine refactor: updateText targets different container during anim
    -> static HUD content stays in container 1 during animation
```

---

## MVP Definition for v1.1

### Ship in v1.1 (all explicitly requested)

- [ ] Battle speed control (4 presets: Slow/Normal/Fast/Instant)
- [ ] Remove back buttons from all screens (double-tap navigation only)
- [ ] Consolidated battle menu on HUD (Attack/Switch/Tera/Main Menu all from HUD)
- [ ] Tera without confirmation screen (notifier only, direct to attack select)
- [ ] HP bars + sprites visible on attack screen
- [ ] HP bars + sprites visible on switch screen
- [ ] Pokemon attack movement animation (attacker lunges toward target)
- [ ] Text in a box during animations (visual separation from static HUD)
- [ ] Stats screen: ability, status, stat stages, opponent speed range, possible abilities
- [ ] Back to main menu at bottom of battle menu

### Defer to v1.2

- Damage estimate on attack screen (requires knowing opponent EVs/nature — not available in randbats)
- Full stat stage history log (nice-to-have for competitive analysis)
- Move category (Physical/Special/Status) display on attack screen (marginal value in randbats)
- Opponent move tracking display (what moves has foe revealed) — fits stats screen but adds complexity
- Battle replay / log save
- Multiple battle formats (only Gen 9 Random Battle now)
- Sound feedback on G2 (hardware does not support)

---

## Complexity Summary

| Feature | Complexity | Reason |
|---------|-----------|--------|
| Battle speed menu | LOW | Constants already isolated in ANIM; just add multiplier |
| Remove back buttons | LOW | Mechanical change to 5 renderers + ScreenController index offsets |
| Tera without confirmation | LOW | Remove one screen, set flag directly, update status bar |
| Back to main menu option | LOW | One extra menu item + handler |
| Text in animation box | LOW | Change which container AnimationEngine updates |
| Attack movement animation | MEDIUM | New animation phase in playEntry, ~6 frames, must be cancellable |
| Consolidated HUD menu | MEDIUM | Hybrid screen type, layout change, ScreenController routing update |
| HP/sprites on attack screen | MEDIUM | Multi-container update on screen transition |
| HP/sprites on switch screen | MEDIUM | Same pattern as attack screen |
| Stats screen | HIGH | Stat stage tracking in data model, speed calc, new renderer, navigation |

---

## What Makes the Battle Feel Like Showdown: Summary

The features that most move the needle toward Showdown's feel, ranked by impact:

1. **Consolidated action menu on HUD** — eliminates the most friction in the battle loop.
   Showdown's move selection is always one click away; current G2 is two taps.

2. **HP bars and sprites on attack/switch screens** — the single biggest UX gap. On Showdown
   you never lose sight of the battle state while making decisions. On G2 v0.1 you do.

3. **Battle speed control** — this is the #1 quality-of-life feature for Showdown ladder players.
   "Instant" mode is used by almost all experienced players. Making it available immediately
   validates that the G2 experience can feel as fluid as the web client.

4. **Attack movement animation** — the visual feedback that a move was used. Showdown's lunging
   animation is what makes each attack feel impactful. The lunge exists; the infrastructure exists.

5. **Stats screen** — the competitive depth layer. Showdown's randbats tooltip is a beloved
   community tool. Building speed ranges and possible abilities directly into the client matches
   what experienced players expect and use constantly.

---

## Sources

- Existing codebase read directly:
  - `src/screens/renderers/` — all renderers (HIGH confidence, direct code read)
  - `src/animation/AnimationEngine.ts` — animation system (HIGH confidence)
  - `src/config/constants.ts` — ANIM timing constants (HIGH confidence)
  - `src/types/battleState.ts` — data model (HIGH confidence)
  - `src/screens/ScreenController.ts` — navigation graph (HIGH confidence)
- [smogon/pokemon-showdown-client on GitHub](https://github.com/smogon/pokemon-showdown-client) — client architecture (MEDIUM confidence via DeepWiki)
- [battle-tooltips.ts source](https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/play.pokemonshowdown.com/src/battle-tooltips.ts) — tooltip data fields (HIGH confidence via source code fetch)
- [panel-battle.tsx source](https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/play.pokemonshowdown.com/src/panel-battle.tsx) — move buttons, HP bars, Tera toggle (HIGH confidence via source code fetch)
- [DeepWiki: smogon/pokemon-showdown-client](https://deepwiki.com/smogon/pokemon-showdown-client) — UI component architecture (MEDIUM confidence)
- [Pokemon Showdown Randbats Tooltip - Smogon Forums](https://www.smogon.com/forums/threads/pok%C3%A9mon-showdown-randbats-tooltip.3686306/) — randbats tooltip feature scope (MEDIUM confidence)
- [battle-scene-stub.ts source](https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/play.pokemonshowdown.com/src/battle-scene-stub.ts) — `acceleration` property and speed control pattern (HIGH confidence via source code fetch)

---
*Feature research for: Pokemon Showdown G2 — v1.1 UI Enhancement milestone*
*Researched: 2026-03-01*
