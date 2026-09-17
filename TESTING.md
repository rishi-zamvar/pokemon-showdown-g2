# Testing Pokemon Showdown G2

## Running the Even Dev Simulator

The app must be tested through the Even Hub Simulator, not standalone Vite.

### Quick Start

```bash
cd /Users/rishizamvar/Desktop/evenG2apps/even-dev
./start-even.sh pokemon-showdown
```

This launches the Vite dev server + Even Hub Simulator together. The simulator window opens automatically in your browser.

### Prerequisites

- Node.js and npm installed
- `even-dev` dependencies installed (`cd even-dev && npm install`)
- `pokemon-showdown` dependencies installed (`cd pokemon-showdown && npm install`)
- `pokemon-showdown` registered in `even-dev/apps.json` as `"pokemon-showdown": "../pokemon-showdown"`

### Simulator Controls

- **Single tap** on the glasses display = select / confirm (TAP gesture)
- **Double tap** = back / cancel (DOUBLE_TAP gesture)
- **Swipe forward** = scroll down in lists (SCROLL_FWD gesture)
- **Swipe back** = scroll up in lists (SCROLL_BACK gesture)

## Automated Tests

### TypeScript Compilation

```bash
cd /Users/rishizamvar/Desktop/evenG2apps/pokemon-showdown
npx tsc --noEmit
```

Zero errors = pass.

### Battle Stress Test (100 iterations)

```bash
npx tsx src/battle/stressTest.ts
```

Runs 100 headless battles with full sim integration. Checks:
- No crashes during battle resolution
- HP values stay consistent after switches
- All battles complete to win/loss

Expected output: `Results: 100 passed, 0 failed out of 100`

### Production Build

```bash
npm run build
```

Verifies TypeScript compilation + Vite bundling succeeds.

## Manual Test Checklist

### Battle Flow
1. Launch app in simulator
2. Tap "New Battle" on main menu
3. Verify battle starts with opening animation
4. Verify both Pokemon sprites visible on battle HUD

### Overlay HUD (Phase 10)
1. On BATTLE_HUD: verify team bar at top, opponent composite (top-right area), player composite (bottom-left area)
2. Each composite should show: nameplate text ("You: [Pokemon] Lv.XX"), HP bar, and sprite
3. Tap "Attack" — verify composites stay visible with move list below
4. Double-tap back to BATTLE_HUD
5. Tap "Switch" — verify composites stay visible with team list below

### HP After Voluntary Switch
1. Start battle, let opponent attack your Pokemon (reduce HP to ~50%)
2. Go to Switch screen, select a different Pokemon
3. After switch animation, verify new Pokemon's HP bar shows 100% (not the previous Pokemon's ~50%)
4. Console should show: `[buildComposites] player active=NewMon hp=XXX/XXX` where hp equals max hp

### HP After Forced Switch (Faint)
1. Let your active Pokemon faint
2. Select a replacement from switch screen
3. Verify replacement shows its own HP (100% if undamaged, or reduced if entry hazards like Stealth Rock are active)

### Animation
1. Select an attack — verify typewriter text plays in text box
2. Verify attacking Pokemon lunges (contact moves only)
3. Verify HP drain animation plays smoothly
4. Verify no green line artifacts at top of screen during animation
5. Verify no garbled/tiny sprites in composite areas
6. After animation completes, verify HUD returns with correct HP values

### Battle Speed
1. From main menu, go to Battle Speed setting
2. Cycle through: Normal → Fast → Instant → Slow
3. Start a battle at each speed and verify animations scale correctly
4. Instant mode should skip all animations

### Tera
1. On BATTLE_HUD, tap "Tera" — should show "[TERA QUEUED]" notification, no confirmation screen
2. Select an attack — Pokemon should Terastallize before attacking
3. Verify Tera type shown in status line

## Debug Logging

Key console.debug messages to watch:
- `[deriveSide] pX active=Species idx=N hp=X/Y simHp=X/Y` — HP tracking after each state derivation
- `[buildComposites] player active=Species hp=X/Y` — HP in composite build
- `[showOverlayHud] BMP sizes: teamBar=XB opp=XB player=XB` — BMP routing verification

Warning signals:
- `console.warn` with "HP mismatch" — deriveSide had to correct HP (fix fired but indicates matching issue)
- `console.error` with "Suspiciously small composite BMP" — BMP encoder produced bad output
