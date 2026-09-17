# Pokemon Showdown G2 — Structure Map + Even Realities SDK Upgrade Audit

Generated 2026-09-17. Baseline: `npx tsc --noEmit` exits 0 on the working tree as pulled.

---

## Part 1 — Metadata

| Field | Value |
|---|---|
| Location | `~/Documents/Projects/evenG2apps/pokemon-showdown` (moved out of iCloud 2026-09-17) |
| Package id | `com.rishi.g2pokemonshowdown` |
| App version | 0.1.0, edition `202601` |
| Entrypoint | `index.html` → `src/main.ts` |
| Permissions | network: `evenhub.evenrealities.com` |
| Build | Vite 6 + TS 5.9, `tsc --noEmit && vite build` |
| Git | `main`, no remote. HEAD `a0a8a8f`. 37 dirty paths (uncommitted Phase 10 work) |
| Source size | 7,593 LOC TS across 35 files |
| Assets | `public/sprites/{front,back}` full dex PNGs (11 MB), `public/data/learnsets.json` |
| Planning | GSD project; milestone v1.1 at 75% (Phases 7–10 ✓, Phase 11 Stats Screen next) |
| Sibling repos | `../even-dev` (BxNxM community harness + app registry), `../g2-app-template` |

**Dependency pins as built (Feb–Mar 2026) vs. latest today:**

| Package | Pinned | Installed | Latest | Gap |
|---|---|---|---|---|
| `@evenrealities/even_hub_sdk` | `^0.0.7` | 0.0.7 | **0.0.15** | 8 minors. `^0.0.x` pins exactly — npm will never bump this |
| `@evenrealities/evenhub-simulator` | `^0.4.1` | 0.4.1 | **0.9.5** | 5 minors |
| `@evenrealities/evenhub-cli` | `^0.1.5` | 0.1.5 | **0.1.14** | 9 patches |
| `@pkmn/randoms` | `^0.10.6` | 0.10.6 | 0.10.11 | minor |
| `@smogon/calc` | `^0.10.0` | 0.10.x | 0.11.0 | minor |

`^0.0.7` is the trap: semver treats `0.0.x` as all-breaking, so the caret pins to that exact version. The app has been frozen on a February SDK for seven months.

---

## Part 2 — Structure

```
src/
  main.ts                    bootstrap: connect glasses → validate data → ScreenController → route gestures → wake lock
  adapters/glassAdapter.ts   (690) the entire SDK surface. ONLY file that imports @evenrealities
  screens/
    ScreenController.ts      (973) state machine + gesture routing + composite cache + phone companion DOM
    ScreenState.ts           (66)  ScreenName union, cursor, renderer return types
    renderers/*.ts           (7 files, 640) pure state → {text|items, status} functions
  battle/
    SimBattleAdapter.ts      (847) wraps @pkmn/sim Battle; startBattle/submitAction/submitSwitch
    LogParser.ts             (554) PS protocol lines → TurnLogEntry[]
    SimAIOpponent.ts         (158) pickAction / pickSwitch heuristics
    TeamGenerator.ts         (94)  @pkmn/randoms → BattlePokemon[]
    simSmoke.ts / stressTest.ts     headless harnesses (486)
  animation/
    AnimationEngine.ts       (701) playTurn orchestration, flash/HP-drain/lunge/typewriter
    AnimationFrames.ts, SpriteEffects.ts, TextBoxRenderer.ts
  sprites/
    SpriteService.ts         fetch + IndexedDB/localStorage bitmap cache
    SpriteBmpEncoder.ts      PNG → 1-bit BMP bytes
    CompositeBuilder.ts      (406) canvas: sprite + nameplate text + HP bar → one BMP
  data/DataLoader.ts         validate() at boot, lazy loadMatchData(12 mons), clearMatchData()
  config/constants.ts        DISPLAY 576x288, layouts, TIMING, ANIM, container IDs/names
  config/SpeedConfig.ts      animation speed presets
```

**Layering is clean.** Battle engine is pure (no glass calls). Renderers are pure functions. All hardware I/O funnels through `glassAdapter.ts`. That means the SDK upgrade is contained to one file plus `constants.ts` — this codebase is unusually well-positioned for the modernization.

### Pseudocode — boot

```
main():
  glass = GlassAdapterImpl()
  await glass.connect()            # waitForEvenAppBridge, 15s timeout, bindEvents
  DataLoader.validate()            # throws on corrupt json → status "Data error", abort
  screen = ScreenController(glass)
  await screen.init()              # bootstrapStartup + render MAIN_MENU
  glass.onGesture(e => screen.handleGesture(e))
  wakeLock.acquire()
```

### Pseudocode — screen state machine

```
ScreenName = MAIN_MENU | BATTLE_HUD | ATTACK_SELECT | SWITCH_SELECT
           | TURN_RESULT | END_SCREEN | SPRITE_REFRESH | ANIMATING

handleGesture(e):
  if animationEngine.isRunning():
      if e is TAP or DOUBLE_TAP: animationEngine.skip()
      return                                   # everything else swallowed
  TAP            -> onTap(e.listIndex ?? cursorIndex)
  DOUBLE_TAP     -> onDoubleTap()              # = "back"
  FOREGROUND_ENTER -> render()
  SCROLL_*, FOREGROUND_EXIT -> no-op           # scroll must not rebuild

onTap dispatches per screen:
  MAIN_MENU      0 Enter Battle | 1 cycle SpeedConfig | 2 About
  BATTLE_HUD     Attack / Switch / Tera / Stats
  ATTACK_SELECT  submitAction(move, teraQueued) -> TURN_RESULT
  SWITCH_SELECT  submitSwitch(indexMap[idx])    -> TURN_RESULT
  TURN_RESULT    advance -> BATTLE_HUD or END_SCREEN

onDoubleTap:
  ATTACK_SELECT / SWITCH_SELECT -> back to BATTLE_HUD  (blocked if forcedSwitch)
  BATTLE_HUD -> forfeit, two-stage: first sets forfeitPending + toast,
                second forfeits. setTimeout(3000) clears it.
```

### Pseudocode — a turn

```
submitAction(move):
  sim.submitAction()                      # @pkmn/sim runs the turn
  raw protocol lines -> LogParser -> TurnLogEntry[]
  AnimationEngine.playTurn(entries):
      for entry:
        typewriter text into TextBoxRenderer   (CHAR_DELAY_MS, punctuation pause)
        on damage:  lunge frames -> invert sprite BMP -> re-upload -> restore  (HIT_FLASH_CYCLES)
                    HP drain: recompute HP bar, rebuild composite BMP, upload  (<=MAX_HP_STEPS)
        on faint:   invert/blank cycles
        on switch:  slide frames, SWITCH_SLIDE_PX per frame
  rebuild composites (opp, player, teamBar) -> showOverlayHud
```

### Pseudocode — the render path that matters

```
showOverlayHud(teamBarBmp, oppBmp, playerBmp, listItems, listStatus):
  C1 image  576x24   @ (0,0)      teamBar
  C2 image  144x132  @ (360,24)   opponent composite   (sprite+name+HP baked into the bitmap)
  C3 image  144x132  @ (72,156)   player composite
  C4 list   288x132  @ (288,156)  action list, isEventCapture=1
  # workaround: blank container 2 (status text from showBattleHud) with a
  # zero-length textContainerUpgrade, because rebuildPageContainer does not
  # remove containers that are absent from the new config
  rebuildPageContainer({containerTotalNum: 4, ...})
  sleep 50ms                                   # race workaround
  updateImageRawData(C1); updateImageRawData(C2); updateImageRawData(C3)
```

Everything visible is either a list or a **pre-rendered bitmap**. Names, HP bars and status are drawn with canvas into the composite BMP and re-uploaded on every change. That design exists because the Feb SDK gave 4 containers total and no layering.

---

## Part 3 — SDK gap analysis (0.0.7 → 0.0.15)

Diffed `dist/index.d.ts` directly, 1209 → 1535 lines.

**Nothing was removed. 29 new exports, 7 new bridge methods. The upgrade is purely additive — low risk.**

New `EvenAppBridge` methods: `imuControl`, `captureImageFromCamera`, `pickImageFromAlbum`, `getAppLocation`, `startAppLocationUpdates`, `stopAppLocationUpdates`, `onAppLocationChanged`, `onLaunchSource`.

### The five that actually matter for this app

**1. Startup containers 4 → 12 (0.0.8).** Limits are now `containerTotalNum` 1–12, `textObject` max 8, `imageObject` max 4. The overlay HUD was designed against a hard cap of 4 and bakes name/HP/status text into the composite bitmaps to stay under it. With 8 text containers available, nameplates and HP text become real text containers updated in place via `textContainerUpgrade` — no canvas, no BMP re-encode, no upload, per change. This is the single biggest win and it would let `CompositeBuilder` shrink to sprite-only.

**2. `zOrderIndex` on list/text/image (0.0.12).** Explicit stacking order. The Phase 10 gap-closure commits — "canvas race condition and stale container artifacts", "composite BMP routing fix", the 50 ms sleep after `rebuildPageContainer`, the blank-container-2 hack — are all symptoms of having no layering control. Rules: optional only if *every* container on the page omits it; if any sets it, all must; values must be unique; higher = front. The SDK validates this and fails the call before it reaches native.

**3. LZ4 compression on `updateImageRawData` (0.0.12).** Internal, free on upgrade. Every animation frame in `AnimationEngine` is an image upload, so this is a direct latency win on the hottest path with zero code change.

**4. Contextual menus (0.0.14).** `MenuContainerProperty` / `MenuItemProperty` / `menuItemClickEvent`, max 10 items, 32 UTF-8 bytes per name. Forfeit, Battle Speed and About currently consume list rows and a stateful double-tap-twice-within-3s hack. They belong in a native menu.

**5. `LONG_PRESS_EVENT` (9) / `LONG_PRESS_RELEASE_EVENT` (10) + `eventSource` (0.0.14/0.0.15).** New gesture primitives, and `sysEvent.eventSource` now distinguishes `GLASSES_R`, `GLASSES_L` and **`RING`**. The `GestureKind` union in `types/contracts.ts` has no long-press and no source field. Long-press-to-forfeit replaces the `forfeitPending` + `setTimeout` state machine outright.

### Also available, currently unused

- `textColor` brightness 0–4 on text containers and on `textContainerUpgrade` — a brightness ramp is a cheaper flash than inverting and re-uploading a bitmap.
- IMU control + data events (0.0.8) — head-tracking as an input axis.
- Camera, album picker, location, MIC source selection (0.0.11).
- `onLaunchSource` — `appMenu` vs `glassesMenu` entry context.
- Validation helpers: `validateEvenHubPageContainer`, `formatEvenHubPageContainerValidationError`.

### Two corrections the upgrade forces

- `borderRdaius` → **`borderRadius`**. The typo is fixed on `TextContainerProperty` and `ListContainerProperty`. This codebase never uses the field, so it costs nothing here — noted because it is the one genuinely breaking rename.
- `min_app_version` in `app.json` is `0.1.0`. SDK 0.0.15 requires **Even App ≥ 2.2.10** (0.0.14 → 2.2.9, 0.0.13 → 2.2.6). That field needs updating and the phone app needs to be current.

### Verified, not assumed

I ran the new SDK's validator against this app's actual overlay HUD config:

```
validateEvenHubPageContainer(overlayConfig)  ->  { valid: true }
```

So the current layout is accepted as-is. Probing further, the validator enforces z-order consistency/uniqueness, menu count/ID/name, and `textColor` range — it does **not** check dimensions or container count. Worth knowing: `ImageContainerProperty` in 0.0.15 carries new doc comments saying width 20–288 and height 20–144, and the team bar is **576×24**. The SDK will not reject it, and it evidently renders today, but that is an undocumented-territory bet against the protobuf's stated range. Test it on hardware before building anything new on top of full-width image containers.

### Tooling

The simulator jumped 0.4.1 → **0.9.5**, five minor versions, and changed packaging (`bin/` in both, but the CLI gained an `ehpk/` directory and shell completions). `scripts/start-sim.sh` and `start-glasses.sh` should be re-validated against the new CLI — `evenhub` still exposes `login`, `init`, `pack`, `qr`, so the surface looks compatible, but this was not run.

---

## Part 4 — Recommended sequence

1. **Commit the 37 dirty Phase 10 files first.** Do not start an upgrade on top of uncommitted gap-closure work.
2. **Bump the three `@evenrealities` packages, typecheck, run `simSmoke` + `stressTest`.** Purely additive API means this should be near-free, and it banks the LZ4 win immediately. Update `app.json` `min_app_version` to `2.2.10`.
3. **Adopt `zOrderIndex` across `showOverlayHud`** (all four containers, unique values) and delete the 50 ms sleep and the blank-container-2 workaround. Re-verify against the Phase 10 bug list.
4. **Split text out of the composites.** Nameplate + HP + status become text containers driven by `textContainerUpgrade`; `CompositeBuilder` renders sprite only. This is the real performance change.
5. **Move Forfeit / Battle Speed / About into a contextual menu**; replace the `forfeitPending` timeout hack with long-press.
6. **Then** Phase 11 Stats Screen — which becomes much easier with 8 text containers instead of 4 total.

Steps 3–5 each touch `glassAdapter.ts` plus `constants.ts` and little else, thanks to the existing layering.

---

## Open questions

- Does a 576-wide image container actually work on current firmware, or is it clamped/wrapped? Needs a hardware test.
- Is Even App on the phone ≥ 2.2.10?
- Phase 6 "Integration" shows 0/2 in the roadmap and was skipped — intentional, or a real gap?
