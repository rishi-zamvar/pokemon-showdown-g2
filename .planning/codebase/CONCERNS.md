# Codebase Concerns

**Analysis Date:** 2026-02-26

## Tech Debt

**Incomplete Application Bootstrap:**
- Issue: `src/main.ts` has only example code with placeholder gesture handling. The actual Pokemon Showdown game logic is not implemented.
- Files: `src/main.ts` (lines 43-63)
- Impact: App boots but does nothing meaningful. Gesture event handler accepts events but has no actual game logic to execute.
- Fix approach: Implement game state machine, Pokemon battle simulator, and wire gesture events to game actions (selection, attack, navigation).

**SDK Quirk Workarounds Hardcoded:**
- Issue: `src/adapters/glassAdapter.ts` contains workarounds for firmware quirks (CLICK_EVENT=0 normalization, simulator vs hardware event handling) scattered in `mapEventToGesture()` method.
- Files: `src/adapters/glassAdapter.ts` (lines 284-326, comments on lines 22-33)
- Impact: Brittle to firmware updates. If SDK behavior changes, multiple locations need updates.
- Fix approach: Extract quirk handling to a separate mapping configuration or strategy class. Document which firmware versions each quirk applies to.

**Hard-Coded Magic Numbers:**
- Issue: Layout values, timeouts, and limits are scattered throughout code (1000 char limit for text, 2000 for upgrades, 300ms scroll cooldown, 15s bridge timeout).
- Files: `src/config/constants.ts`, `src/adapters/glassAdapter.ts` (lines 96, 121, 141, 158, 179, 197, 208)
- Impact: Difficult to tune display layout or performance without code search. Some limits documented in comments but not all.
- Fix approach: All limits and magic numbers already in `src/config/constants.ts`. Add remaining hardcoded values (1000 char, 2000 char upgrade limits) to constants.

**No Input Validation on Public Methods:**
- Issue: `GlassAdapter` methods accept string arrays and text without validation. Empty arrays, null text, or extremely long text may cause SDK failures.
- Files: `src/adapters/glassAdapter.ts` (lines 59, 87, 110, 149)
- Impact: SDK calls fail silently with `console.warn` (line 258). User sees no list/text update without debugging.
- Fix approach: Add input validation to `showList()`, `showText()`, `updateText()`, `showMessage()` to enforce bounds before SDK calls.

**Visibility Loss Wake Lock Re-acquisition:**
- Issue: `src/services/wakeLockService.ts` re-acquires wake lock on visibility change, but doesn't handle case where re-acquisition fails persistently.
- Files: `src/services/wakeLockService.ts` (lines 67-77)
- Impact: If user tabs away and back, wake lock may not be held even though app thinks it is. Phone could sleep during a battle.
- Fix approach: Track re-acquisition failures and expose wake lock state via getter for app to check and notify user.

## Known Bugs

**Document Element Null Check Missing:**
- Bug: `setStatus()` function in `src/main.ts` assumes DOM elements exist without checking null result.
- Symptoms: If HTML structure changes or elements removed, setting status silently fails with no error.
- Files: `src/main.ts` (lines 21-29)
- Trigger: Change `index.html` structure and status bar stops updating.
- Workaround: Elements are hardcoded in `index.html` (lines 100-102), safe if HTML not changed. But safe code would check before `.textContent =`.

**Bridge Timeout Error Not User-Friendly:**
- Bug: If bridge connection times out, error message tells user "Open this URL from Even app dev mode" but doesn't indicate current environment.
- Symptoms: User sees timeout error message on phone but may already be in dev mode or the page may be open from a different window.
- Files: `src/adapters/glassAdapter.ts` (lines 339-345)
- Trigger: Open app outside Even dev mode or with closed web inspector.
- Workaround: None. User must manually diagnose.

**Console Logging Always Active:**
- Bug: All `console.log/warn` calls execute regardless of build mode. Development logging leaks to production builds.
- Symptoms: Browser console filled with `[glass]`, `[wakelock]` prefixed messages in production.
- Files: `src/adapters/glassAdapter.ts` (line 258), `src/services/wakeLockService.ts` (lines 36, 45, 47, 56), `src/main.ts` (line 70)
- Trigger: Build and deploy the app.
- Workaround: None. Need conditional logging or logger middleware.

**Scroll Cooldown Time Constant:**
- Bug: Scroll cooldown is 300ms by design per Nick Ustinov notes, but if firmware behavior changes, this becomes a silent duplicate event sink instead of protective mechanism.
- Symptoms: User scrolls, nothing happens, no error, scroll cooldown silently dropped the event.
- Files: `src/adapters/glassAdapter.ts` (lines 270-276), `src/config/constants.ts` (line 17)
- Trigger: Rapid scroll gestures that should register multiple selections.
- Workaround: Increase `SCROLL_COOLDOWN_MS` constant.

## Security Considerations

**No Content Sanitization on Display:**
- Risk: `showText()`, `updateText()`, `showList()` accept arbitrary strings. Malicious text could be crafted to exploit rendering engine if not properly escaped by SDK.
- Files: `src/adapters/glassAdapter.ts` (lines 59-81, 87-104, 110-144, 149-166)
- Current mitigation: SDK handles rendering. No direct code injection possible since strings are passed as data, not HTML.
- Recommendations: Assume SDK sanitizes. If displaying user-generated content from network, validate/escape at ingestion point (in game logic, not adapter).

**No CORS or Permission Enforcement:**
- Risk: `app.json` declares network permission for `evenhub.evenrealities.com` only. Browser may enforce CORS, but app has no explicit CORS checks.
- Files: `app.json` (lines 16-18)
- Current mitigation: App runs in Even Realities sandbox. Network calls restricted by platform.
- Recommendations: All network code should go through event game's credential & session infrastructure (per phase 09 context). No direct fetch() calls from game code.

**Navigator API Access Unguarded:**
- Risk: `wakeLockService.ts` accesses `navigator.wakeLock` without feature detection beyond `in navigator` check. Could throw in restricted environments.
- Files: `src/services/wakeLockService.ts` (lines 35, 41)
- Current mitigation: Wrapped in try-catch. Silently no-ops if unavailable.
- Recommendations: Current approach (best-effort, silent no-op) is appropriate for optional APIs.

## Performance Bottlenecks

**GlassAdapter Render Synchronicity:**
- Problem: `renderContainers()` calls are sequential. Each `showList()`, `showText()` call must complete before next display update. No pipelining or batching.
- Files: `src/adapters/glassAdapter.ts` (lines 214-260)
- Cause: SDK methods are async, each awaited individually. Rebuild retry adds 300ms delay (lines 251-254).
- Improvement path: For game loop, batch display updates into single `renderContainers()` call per frame. Avoid sequential show/update calls in tight loops.

**Retry Logic Blocks on Rebuild Failure:**
- Problem: If `rebuildPageContainer()` fails, code sleeps 300ms before retry (lines 251-254). Game loop blocked during this delay.
- Files: `src/adapters/glassAdapter.ts` (lines 246-259)
- Cause: Hardcoded retry with `delay()` utility.
- Improvement path: Use exponential backoff or timeout-based retry instead of blocking delay. Log repeated failures as warnings to game logic.

**No Frame Rate Control:**
- Problem: If game logic calls `updateText()` on every input event without debouncing, all updates go to glasses immediately. Firmware may rate-limit internally.
- Files: `src/main.ts` (lines 49-53)
- Cause: No throttling middleware between gesture events and adapter calls.
- Improvement path: Add debouncing/throttling to gesture handler or adapter methods for high-frequency updates.

## Fragile Areas

**SDK Event Mapping Logic:**
- Files: `src/adapters/glassAdapter.ts` (lines 291-326)
- Why fragile: Handles three event sources (listEvent, textEvent, sysEvent) with multiple event type checks. If SDK adds new event types or changes field structure, silent no-ops occur.
- Safe modification: Add unit tests covering each event combination. Document each event path with examples. Add logging for unknown event types.
- Test coverage: No tests exist for `mapEventToGesture()`. Any SDK behavior change goes undetected.

**Bootstrap Error Handling:**
- Files: `src/main.ts` (lines 31-71)
- Why fragile: Single top-level try-catch. If connection succeeds but gesture handler setup fails, app is partially initialized.
- Safe modification: Add initialization checks after each major step. Validate glass adapter state before setting up handlers.
- Test coverage: No tests for bootstrap flow. Error states untested.

**Glass Adapter Public/Private Boundary:**
- Files: `src/adapters/glassAdapter.ts` (lines 34-354)
- Why fragile: Private methods like `renderContainers()`, `bindEvents()` manage critical state (`this.startupDone`, `this.unsubscribeHub`). If external code calls private methods (TypeScript only prevents at compile time), state breaks.
- Safe modification: Document state machine clearly. Add runtime assertions to verify state transitions.
- Test coverage: No tests for state correctness. Concurrent calls to public methods may violate state invariants.

**Character Limit Enforcement:**
- Files: `src/adapters/glassAdapter.ts` (lines 96, 121, 141, 158, 179, 197, 208)
- Why fragile: Text sliced to 1000 or 2000 chars at multiple locations. Easy to miss one location when adding display methods.
- Safe modification: Create helper functions `truncateDisplay(text, limit)` and `truncateUpdate(text)` for each limit. Use consistently.
- Test coverage: No tests verify truncation works correctly. Off-by-one errors possible.

## Scaling Limits

**Text Display Content Length:**
- Current capacity: 1000 chars for `showText()`, `showMessage()`, 2000 chars for `updateText()`
- Limit: Firmware may not render text longer than these limits. Tests show chars sliced silently.
- Scaling path: If game needs longer text, paginate display into multiple screen updates. Implement scrollable text container logic in game.

**List Item Count:**
- Current capacity: Firmware supports lists with arbitrary itemCount, but scrolling through 100+ items with 300ms cooldown becomes slow.
- Limit: UX degrades with large lists (multiple swipes needed for single navigation).
- Scaling path: Implement search/filtering to reduce visible items. Split into sub-lists or pages.

**Gesture Event Throughput:**
- Current capacity: One gesture event every 300ms due to scroll cooldown.
- Limit: Cannot detect rapid taps or swipes closer than 300ms.
- Scaling path: Investigate firmware's actual event rate vs cooldown necessity. Reduce cooldown if firmware supports it.

## Dependencies at Risk

**@evenrealities/even_hub_sdk (^0.0.7):**
- Risk: Pre-1.0 version. Breaking changes likely between minor versions.
- Impact: SDK upgrade may change event structure, container API, or return types. Code may silently fail.
- Migration plan: Pin to exact version (0.0.7) for stability. Before upgrading, review SDK changelog and test all event paths. Consider wrapping SDK to abstract version differences.

**TypeScript Strict Mode Enabled:**
- Risk: Not a risk, but requires careful null handling. Code currently assumes elements exist and SDK returns valid values.
- Impact: If DOM structure changes or SDK returns unexpected types, TypeScript doesn't catch runtime failures.
- Migration plan: Maintain strict mode. Add runtime assertions for SDK contract (null checks, type guards).

## Missing Critical Features

**No Error Boundary for Game Logic:**
- Problem: `main.ts` bootstrap catches errors, but game code's gesture handler has no error handling. Unhandled exception in gesture handler crashes app silently.
- Blocks: Robust Pokemon battle logic that must survive edge cases and network errors.
- Fix: Wrap gesture handler callback in try-catch. Expose error state to user via status bar.

**No Logging/Telemetry Framework:**
- Problem: Console logs are unstructured. No way to track errors in production or understand game behavior.
- Blocks: Debugging user-reported issues. Performance analysis. User behavior analytics.
- Fix: Implement structured logging with log levels. Store recent logs in memory or IndexedDB for later retrieval.

**No State Persistence:**
- Problem: If app crashes or user closes it, all game state lost. No way to resume a battle.
- Blocks: Multi-turn games that survive user interruptions.
- Fix: Implement localStorage or IndexedDB save points. Restore game state on app relaunch.

**No Game Configuration/Settings:**
- Problem: All game parameters (difficulty, Pokemon roster, battle rules) are hardcoded or absent.
- Blocks: Customizable gameplay. Settings menu on glasses.
- Fix: Add settings storage and selection UI. Wire to game logic.

## Test Coverage Gaps

**GlassAdapter Connection and Initialization:**
- What's not tested: `connect()` method, bridge wait with timeout, event subscription setup.
- Files: `src/adapters/glassAdapter.ts` (lines 41-46, 332-353)
- Risk: Bridge timeout error message is untested. Concurrent calls to `connect()` may result in multiple bridge instances.
- Priority: High

**Event Mapping Edge Cases:**
- What's not tested: All event combinations, unknown event types, missing event properties.
- Files: `src/adapters/glassAdapter.ts` (lines 291-326)
- Risk: If SDK sends event with unexpected structure, `mapEventToGesture()` returns null silently. Game never receives input.
- Priority: High

**WakeLockService State Transitions:**
- What's not tested: Visibility change during lock acquisition, release failures, repeated acquire/release cycles.
- Files: `src/services/wakeLockService.ts` (lines 16-78)
- Risk: Wake lock state may diverge from actual sentinel state if errors occur.
- Priority: Medium

**Bootstrap Error States:**
- What's not tested: Bridge timeout, network errors, missing DOM elements.
- Files: `src/main.ts` (lines 31-71)
- Risk: Partial initialization leads to confusing error states.
- Priority: High

**Text Truncation and Display Limits:**
- What's not tested: Text at exactly limit boundary, empty text, null values.
- Files: `src/adapters/glassAdapter.ts` (lines 96, 121, 141)
- Risk: Off-by-one errors in truncation. Empty displays if text truncated incorrectly.
- Priority: Medium

---

*Concerns audit: 2026-02-26*
