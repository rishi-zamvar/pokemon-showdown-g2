---
status: verifying
trigger: "Investigate two bugs in Phase 10 overlay HUD system"
created: 2026-03-02T00:00:00Z
updated: 2026-03-02T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED for both bugs. Bug 1: getCompositeCtx() is a singleton - all three concurrent Promise.all builds share same canvas, last writer wins. Bug 2: showBattleHud uses containers {1,2,4,5}, showOverlayHud uses {8,4,5,1} - rebuildPageContainer only knows about listed containers so {8} persists into animation and {2} persists into overlay.
test: Confirmed by reading source code
expecting: N/A - root causes confirmed
next_action: Apply fixes

## Symptoms

expected: 144x132 composite images should show nameplate text on white background + sprite on black background
actual: Both composite image regions are completely black
errors: No console errors
reproduction: Start a battle, reach BATTLE_HUD decision screen; select Attack for animation glitches
started: Immediately after Phase 10 implementation

## Eliminated

- hypothesis: buildTeamBar() is broken
  evidence: Team bar (576x24 BMP at top) renders correctly with mini-sprites
  timestamp: 2026-03-02T00:00:00Z

- hypothesis: Placeholder containers fix stale container issue
  evidence: Exceeds 4-container hardware limit, blanks screen entirely
  timestamp: 2026-03-02T00:00:00Z

## Evidence

- timestamp: 2026-03-02T00:00:00Z
  checked: Prior investigation notes
  found: Canvas reuse identified - getCompositeCtx() resizes single shared canvas; concurrent Promise.all calls stomp each other
  implication: This is the root cause of Bug 1; fix is per-call fresh canvas

- timestamp: 2026-03-02T00:00:00Z
  checked: Prior investigation notes
  found: Container 8 (teamBar) persists into showBattleHud; Container 2 (status) persists into showOverlayHud
  implication: SDK rebuildPageContainer doesn't clear containers not in new config

- timestamp: 2026-03-02T00:01:00Z
  checked: CompositeBuilder.ts lines 46-57
  found: compositeCanvas is a module-level singleton. getCompositeCtx(w,h) resizes it then returns same ctx. buildTeamBar calls getCompositeCtx(576,24); buildSpriteComposite calls getCompositeCtx(144,132). In Promise.all([buildOppComposite, buildPlayerComposite, buildTeamBar]), all three enter and call getCompositeCtx before any await completes because each awaits loadImageFromUrl internally. The last getCompositeCtx call stomps canvas dimensions. Result: opp and player composites read wrong-sized pixel data = black output.
  implication: Fix is to create a new canvas inside each buildSpriteComposite / buildTeamBar call (not singleton)

- timestamp: 2026-03-02T00:02:00Z
  checked: glassAdapter.ts showBattleHud (lines 221-303) and showOverlayHud (lines 318-380)
  found: showBattleHud sends containers {content(1), status(2), oppSprite(4), playerSprite(5)} to renderContainers. showOverlayHud sends containers {teamBar(8), oppSprite(4), playerSprite(5), content(1)}. When showBattleHud runs after showOverlayHud, container 8 (teamBar) still exists on glass at y=0 (top strip) and renders green horizontal line artifacts. When showOverlayHud runs after showBattleHud, container 2 (status) still exists and bleeds into overlay layout.
  implication: Need to clear stale containers without exceeding 4-container limit. Solution: merge status text into content container for showBattleHud (use 3 containers: content+status merged, oppSprite, playerSprite). This frees a container slot. Then use that freed slot as a blank image container to explicitly overwrite teamBar(8) with a 1x1 invisible image when transitioning from overlay to animation.

- timestamp: 2026-03-02T00:03:00Z
  checked: AnimationEngine.ts - updateText calls glass.updateText which does textContainerUpgrade on containers {content(1), status(2), statusRight(3)}
  found: AnimationEngine calls glass.updateText for typewriter; glass.updateText calls textContainerUpgrade on status(2). If container 2 doesn't exist (because showOverlayHud replaced it), the upgrade call may silently fail or use wrong container. The green line glitch is container 8 bleeding through, not container 2 being missing.
  implication: The primary visual glitch (green lines) is the teamBar(8) persisting at y=0 with its 576x24 team bar image showing. Secondary issue: if container 2 doesn't exist, status updates during animation are lost (acceptable degradation vs crash). Real fix must eliminate container 8 from animation view without using a 5th container.

- timestamp: 2026-03-02T00:04:00Z
  checked: showBattleHud container count analysis
  found: showBattleHud currently creates: up to 2 image containers (oppSprite, playerSprite) + 2 text containers (content, status) = 4 total. No room to add teamBar(8) invalidation. BUT: we can combine oppText and playerText into a single content container AND combine status into it, using 1 text container. This would free a slot. However the status bar also needs to be updated in-place by AnimationEngine via textContainerUpgrade on status(2). If we remove status(2), AnimationEngine's hpStatus updates break.
  implication: True fix: showBattleHud must include container 8 in its rebuild config to evict the stale teamBar. Since showBattleHud already uses 4 containers max (2 images + 2 text), we must reduce it to 3 to make room. Combine the two status text containers (status + statusRight) into one. But AnimationEngine uses textContainerUpgrade on CONTAINER_IDS.status(2) - that still works as long as container 2 exists. The problem is adding a 5th.

- timestamp: 2026-03-02T00:05:00Z
  checked: showBattleHud - does it actually always use 4 containers?
  found: imageContainers is conditionally built - if no oppSprite AND no playerSprite, imageContainers array is empty = 0 image containers + 2 text = 2 total. If only one sprite, 1+2=3. If both sprites, 2+2=4. So the max is 4. To fit a 5th (teamBar eviction placeholder), we'd need to drop one. The status container is the natural candidate to fold into content. But AnimationEngine.updateText calls textContainerUpgrade on containerID 2 (status). If we remove container 2 from showBattleHud, those upgrades target a non-existent container.
  implication: The cleanest fix is: for showBattleHud, keep containers {1,2,4,5} (exactly as now, max 4), but ALSO send a blank/zero-size image update to container 8 to "paint over" the teamBar. We can't use rebuildPageContainer for this. We CAN use updateImageRawData on container 8 BEFORE the rebuild - painting it black. But if container 8 doesn't exist yet (first transition), updateImageRawData will fail. Need to handle that case.

- timestamp: 2026-03-02T00:06:00Z
  checked: SDK pattern for clearing stale containers
  found: rebuildPageContainer replaces all existing containers with the new set. Containers NOT in the new config are REMOVED (per the SDK design). BUT the bug exists, which means the SDK either: (a) doesn't remove unlisted containers, or (b) something else is happening. The prior investigation OBSERVED the glitch, confirming containers are NOT removed. This means we cannot rely on rebuildPageContainer to clean up. We need a different approach.
  implication: Alternative approach: instead of trying to add a 5th container, make the two HUD modes share the SAME container IDs. If showBattleHud and showOverlayHud use the SAME 4 container IDs, there are no stale containers. Currently they diverge on: showBattleHud has status(2), showOverlayHud has teamBar(8). Fix: replace teamBar(8) with status(2) in overlay, OR replace status(2) with teamBar(8) in animation. The overlay doesn't need a status bar. The animation needs status(2) for textContainerUpgrade. So the correct mapping: showOverlayHud should use container 2 for what is now teamBar, and adjust layout accordingly. BUT teamBar is 576x24 at y=0 and status is a text container. These are different types and different positions.

- timestamp: 2026-03-02T00:07:00Z
  checked: The actual root cause of stale containers
  found: rebuildPageContainer replaces containers - but the OBSERVED glitch means it's NOT working as expected, OR the glitch has a different cause. Re-reading: showOverlayHud sets up {8,4,5,1} and sends BMP to all three image containers. Then showBattleHud is called with {1,2,4,5}. If SDK does clear container 8, the green line should go away. But it doesn't. This means: either (a) SDK doesn't clear container 8, or (b) the BMP update for teamBar happens AFTER the rebuildPageContainer for showBattleHud (race condition). Looking at code: showOverlayHud sends BMP data sequentially after renderContainers. Then immediately showBattleHud is called. The BMP sends are sequential awaits. So timing shouldn't be an issue. Conclusion: SDK does NOT remove containers not in the new rebuild config. Container 8 persists with its last-rendered content (the team bar image).
  implication: DEFINITIVE conclusion: SDK does not clear unlisted containers on rebuild. We must fit all containers we ever use into 4 total, and they must be the SAME 4 IDs used by both modes. OR we must explicitly overwrite/blank container 8 before the animation mode.

- timestamp: 2026-03-02T00:08:00Z
  checked: Final fix strategy
  found: The most surgical fix that doesn't break AnimationEngine: In showBattleHud, BEFORE calling renderContainers, send a blank BMP to container 8 IF it exists (use try/catch on updateImageRawData). This "paints over" the teamBar without adding a new container. For Bug 1: replace the singleton canvas pattern with per-call fresh canvas creation in buildSpriteComposite and buildTeamBar.
  implication: This approach: (a) doesn't change container counts, (b) doesn't change AnimationEngine, (c) fixes the visual artifact by blanking container 8, (d) fixes Bug 1 by eliminating canvas reuse. The try/catch on updateImageRawData is safe - if container 8 doesn't exist yet, it silently fails, which is fine (nothing to blank).

## Resolution

root_cause: Bug 1 - CompositeBuilder.getCompositeCtx() is a singleton canvas; concurrent Promise.all([buildOppComposite, buildPlayerComposite, buildTeamBar]) all resize the same canvas before any await completes, causing the last writer (buildTeamBar at 576x24) to stomp the others. binarizeCanvas then reads wrong pixels and produces all-black output. Bug 2 - SDK rebuildPageContainer does NOT remove containers not listed in the new config. Container 8 (teamBar, 576x24 image at y=0) persists when showBattleHud is called, appearing as a green horizontal line across the top of every animation frame. Container 2 (status) also persists into overlay HUD as stale bottom text.
fix: Bug 1 - Changed getCompositeCtx() from singleton pattern to per-call canvas creation (document.createElement per invocation). Bug 2a - In showBattleHud, before renderContainers, call updateImageRawData on container 8 with emptyTeamBarBmp() to paint it black; wrapped in try/catch for first-run case where container 8 doesn't exist yet. Bug 2b - In showOverlayHud, before renderContainers, call textContainerUpgrade on container 2 with empty string to blank stale status text; wrapped in try/catch.
verification: TypeScript compilation passes cleanly (tsc --noEmit: zero errors). Behavioral verification requires hardware test on G2 glasses.
files_changed:
  - src/sprites/CompositeBuilder.ts (getCompositeCtx: singleton -> per-call canvas)
  - src/adapters/glassAdapter.ts (showBattleHud: blank container 8 before rebuild; showOverlayHud: blank container 2 before rebuild; added emptyTeamBarBmp import)
