# G2 Platform Research — what is actually possible, and what this app gets wrong

Compiled 2026-09-17 from: the SDK 0.0.15 type surface and README, the
evenhub-simulator 0.9.5 README, the community reference
[nickustinov/even-g2-notes](https://github.com/nickustinov/even-g2-notes)
(display/input/performance docs, measured on real G2 firmware 2.2.7.14), and
live instrumentation of this app through the simulator automation API.

---

## 1. The display is not monochrome

`PROJECT.md` says "576x288 monochrome". It is **576x288, 4-bit greyscale — 16
levels of green**. The host app converts everything you send via `imageToGray4`.

This app ships `SpriteBmpEncoder.ts`, which encodes **1-bit** BMPs. The
community reference is explicit that this is the wrong thing to do:

> Do not perform 1-bit dithering in your app — the host does better 4-bit
> downsampling; manual Floyd-Steinberg dithering creates noisy green dots on
> the display.

That is exactly what the captured frames show: Dragonite and Cryogonal render
as scattered dot clouds rather than readable sprites. **The sprites look bad
because the app throws away 15 of the 16 available brightness levels before the
host ever sees them.**

Correct pipeline per the reference: resize to fit the container preserving
aspect, centre on black (black = LED off), convert to greyscale with BT.601
luminance, encode PNG, send as `number[]` or base64. No dithering.

Text has a parallel capability the app ignores: `textColor` (SDK 0.0.14+) sets
brightness 0–4 per text container, and borders take `borderColor` 0–15.

## 2. Hard container limits

| Constraint | Value |
|---|---|
| Image containers per page | **4** |
| Other containers per page | **8** (12 total, mixed) |
| Image width | **20–288 px** |
| Image height | **20–144 px** |
| `isEventCapture: 1` | **exactly one** container per page |
| Text content | 1000 chars (startup/rebuild), 2000 (`textContainerUpgrade`) |
| `containerName` | max 16 chars |
| Menu items (0.0.14+) | max 10, names ≤32 UTF-8 bytes |

The 576x24 team bar violated the image width cap. One oversized container
fails the **entire** `rebuildPageContainer`, which is why the action list
vanished and the game was unplayable. Fixed in `1684d66`.

Two more gotchas that bite this app directly:
- **Tiling:** if image data is smaller than its container, the hardware
  *repeats* it. Always match data dimensions to container dimensions.
- **No concurrent image sends.** Queue `updateImageRawData` sequentially.
- **Cannot send image data during `createStartUpPageContainer`.** Create an
  empty placeholder, then update. This is the `container 8 not found` warning.

## 3. Performance: call count is everything

Measured on real hardware (firmware 2.2.7.14, SDK 0.0.13):

| Call | Cost |
|---|---|
| `updateImageRawData` | **~104 ms fixed** + ~3.9 ms/KB of gray4 |
| `rebuildPageContainer` | **~165 ms flat**, any container count |
| `textContainerUpgrade` | **~83 ms** per call |
| `createStartUpPageContainer` | ~100–135 ms |

`ms ≈ 104 + 0.0039 × gray4Bytes`. **10.5x the data costs 1.6x the time.**
Payload is nearly irrelevant; the fixed per-call cost dominates.

**What this costs this app today.** Every overlay HUD render sends three
images plus a rebuild:

```
3 × ~104 ms  (teamBar, opponent, player)  +  ~165 ms rebuild  ≈  477 ms
```

Nearly half a second per screen change, before any animation. The animation
engine then drives *more* image uploads per frame for hit flashes and HP
drain — at ~104 ms each, a "flash" of 2 cycles is ~400 ms of pure overhead.
This is why the game feels sluggish, and it is a structural problem, not a
tuning one.

### Correction to my earlier audit

In `SDK-UPGRADE-AUDIT.md` I recommended splitting nameplate/HP text out of the
composite bitmaps into separate text containers, calling it "the single biggest
win". **The measured data contradicts that and I was wrong.** Break-even is 2
containers: `textContainerUpgrade` at ~83 ms versus ~165 ms for a whole
rebuild, so 5–6 text containers cost ~415–500 ms against ~165 ms for one
rebuild — about 3x worse. Compositing text into the bitmap, which is what this
app already does, is the *right* call on this platform.

The real win is the opposite direction: **merge image containers.** Two image
containers cost ~208 ms in fixed overhead alone. Where two images fall inside
one 288x144 box, compositing them onto a single canvas and sending once saves
~104 ms for a couple of milliseconds of extra bytes. The 288x144 cap is the
binding constraint on how far this can go.

LZ4 (0.0.12+) is real but optimises the part that was already free.

## 4. Input surface

| Event | Value | Source |
|---|---|---|
| `CLICK_EVENT` | 0 | ring tap, temple tap |
| `SCROLL_TOP_EVENT` | 1 | internal scroll hit top |
| `SCROLL_BOTTOM_EVENT` | 2 | internal scroll hit bottom |
| `DOUBLE_CLICK_EVENT` | 3 | ring/temple double-tap |
| `FOREGROUND_ENTER/EXIT` | 4/5 | app lifecycle |
| `ABNORMAL_EXIT_EVENT` | 6 | disconnect |
| `LONG_PRESS_EVENT` | 9 | SDK 0.0.14+ |
| `LONG_PRESS_RELEASE_EVENT` | 10 | SDK 0.0.14+ |

Plus, new in 0.0.14/0.0.15: `menuItemClickEvent` (native context menu) and
`sysEvent.eventSource` distinguishing `GLASSES_R`, `GLASSES_L` and **`RING`**.
IMU head gestures are available via `imuControl` (0.0.8+).

Quirks that matter:
1. **`CLICK_EVENT = 0` normalises to `undefined`.** Must check for both. The
   app already handles this.
2. **`currentSelectItemIndex` is omitted for index 0.** Track selection in app
   state as fallback. The app already does.
3. **Simulator sends `sysEvent`; real hardware sends `listEvent`/`textEvent`.**
   Handle all three.
4. **Swipe throttling** — 300 ms cooldown. Already implemented.
5. **Submission requirement:** the root page *must* call
   `shutDownPageContainer(1)` on double-tap or Even Hub rejects the app.
   **This app does not do that** — root double-tap currently does nothing.

## 5. Automated testing is available (and this unblocks TDD)

`evenhub-simulator` v0.7.0+ exposes an HTTP automation API, explicitly
"intended to make it easier for scripts (and AI agents) to drive the
simulator". It exists only because of the 0.4.1 → 0.9.5 bump.

```bash
evenhub-simulator http://127.0.0.1:5173 --automation-port 9898
```

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/ping` | health |
| GET | `/api/screenshot/glasses` | **576x288 RGBA PNG of the real framebuffer** |
| GET | `/api/screenshot/webview` | companion webview PNG |
| GET | `/api/console?since_id=N` | console, uncaught errors, failed fetches |
| DELETE | `/api/console` | clear buffer |
| POST | `/api/input` | `up`/`down`/`click`/`double_click`/`long_press`/`long_press_release`/`context_menu` |

This is a full closed loop: drive input, read the framebuffer, read the
console. It is what found both bugs in this session. Simulator-side validation
failures are logged to simulator **stdout**, not the console API — capture both.

Known simulator/hardware divergences: font rendering, list focus positioning,
error-response handling, and image-size constraint enforcement.

---

## 6. What is wrong with this app, ranked

Verified by instrumentation, not inspection.

| # | Issue | Evidence | Status |
|---|---|---|---|
| 1 | Dangling asset symlinks in `even-dev/public` pointed at a deleted `~/Desktop` path → every asset 404 → battle never started | `[fetch] 404 /data/learnsets.json` | **fixed** (relative symlinks) |
| 2 | 576x24 team bar exceeded the 288x144 image cap → whole page rebuild rejected → no action list → unplayable | simulator: `image container size 576x24 exceeds maximum 288x144` | **fixed** `1684d66` |
| 3 | Sprites encoded 1-bit, discarding 15 of 16 grey levels → noisy dot clouds | captured frames; reference says do not dither | open |
| 4 | ~477 ms per screen change from 3 image sends + rebuild | measured cost model | open |
| 5 | ~~Turn-result text malformed~~ **NOT A DEFECT** — `[Mudsdale'` is `"[Mudsdale's Stamina]".slice(0,10)`; the typewriter renders progressive prefixes and the capture landed mid-animation | verified against AnimationEngine.ts:298 | withdrawn |
| 6 | Nameplates/HP disappear during animation | captured frame | open |
| 7 | Root double-tap does not call `shutDownPageContainer(1)` — blocks Even Hub submission | `ScreenController.onDoubleTap` | open |
| 8 | "You"/"Foe" labels baked into composites | `CompositeBuilder.ts:188` | open (user asked to remove) |
| 9 | Stale `Desktop`-era absolute paths elsewhere in tooling | `even-dev` symlinks | fixed |
| 10 | `update_image_raw_data: container 8 not found` on every boot — the team bar BMP is pushed before its container exists | simulator stdout, Phase 12 wave 2 | open (REND-06) |
| 11 | `TextContainerUpgrade failed: container 2 not found` — the "blank out container 2" workaround in `showOverlayHud` fires against a container that isn't there | simulator stdout, Phase 12 wave 2 | open (Phase 13/14) |
| 12 | `POST /api/input` returns `{"ok":true}` for inputs the simulator then DROPS (`inject_input: no active event container`). The HTTP result is not evidence the input was handled | simulator stdout, Phase 12 wave 2 | open (harness + Phase 16) |
| 13 | HP bars pad with `U+2591` (light shade), which the panel font has no glyph for — `lv_draw_letter: glyph dsc. not found for U+2591` on every HP-bar text render, so the empty part of every bar draws as nothing. `U+2588` (full block) does render | simulator stdout, Phase 12 wave 3 | open (Phase 13/14; `battleHudRenderer.ts:26`) |
| 14 | **The game intermittently hangs forever mid-battle.** `AnimationEngine.ts:282` does `await Promise.all(tasks)` where tasks include `spriteFlash` and `hpDrain`, both of which issue `updateImageRawData`. Concurrent image sends are explicitly **not allowed**; the bridge deadlocks and the turn never completes | harness turn-16 and turn-21 timeouts, ~1 turn in 20 | open (REND-05, Phase 13) |


### Item 14 in detail — the most serious defect found so far

Two harness runs hung at different turns (16, then 21 on a re-run), each timing
out after 120 s with no screen transition. The captured frame shows the sprite
frozen **inverted** — `spriteFlash` stuck between its invert and restore steps —
with the typewriter text truncated mid-stream.

The decisive evidence is the per-step host-call count the harness records:

| | `updateImageRawData` calls |
|---|---|
| turns that passed | 10 - 21 |
| the turn that hung | **5** |

The hung turn issued *fewer* calls than a healthy one, so it did not stall after
finishing its work — it died partway through its send sequence.

Root cause is a documented platform rule the app violates:

> Concurrent sends: **Not allowed** - queue image updates sequentially.

`Promise.all` runs the typewriter, the sprite flash and the HP drain at the same
time. On any turn that both deals damage and flashes a sprite — most of them —
two image senders race. It usually survives; roughly one turn in twenty it does
not.

The fix belongs to **REND-05**, already written as "`updateImageRawData` calls
are queued strictly sequentially — concurrent sends are not permitted". That
requirement was derived from the docs before anyone knew the app violated it.

`showOverlayHud` already awaits its three sends one at a time
(`glassAdapter.ts:453-455`), so the adapter path is correct and only the
animation path races. Phase 13 must enforce the invariant centrally so neither
can regress.

### Why 10-14 were invisible before

All four are written to simulator **stdout** and appear nowhere in
`/api/console`. During one boot the console held 119 entries and not one of
them mentioned any of these. This is HARN-02's entire justification, and it
paid for itself the first time the tee ran against the real app.

Item 12 matters beyond this app: it means **no harness assertion may treat an
`{"ok":true}` input response as proof of anything**. Scenarios must assert the
framebuffer or the screen oracle changed.

## 7. Pokemon Showdown parity — the gap

PS online surfaces, on demand, per Pokemon: stats, forme, level, HP, types,
status, ability, nature, item, full moveset, spreads and boosts; per move:
type, category, base power, accuracy, PP, effectiveness multiplier against the
current target; and field state: weather, terrain, screens, hazards.

The G2 has no hover and no pointer, so every one of those has to become a
*navigable* surface. The available primitives are: list containers, the native
context menu (≤10 items, 0.0.14+), long-press, double-tap, and the R1 ring.
That is the design problem for the milestone — "all information accessible"
means an inspect model, not tooltips.

Currently the app shows: name, level, HP%, status, and a 4-move list. Nearly
everything else is missing.
