# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Status:** Not detected

**Current State:**
- No test runner installed (jest, vitest, mocha, etc.)
- No test configuration files found
- No `*.test.*` or `*.spec.*` files in the codebase
- No testing dependencies in `package.json`

**Type Checking as Validation:**
The codebase uses TypeScript strict mode as its primary validation mechanism:
- TypeScript build includes `tsc --noEmit` in the build pipeline
- Strict compiler options enforce type safety
- Type annotations on all functions and parameters

## Build & Validation

**Current Validation Commands:**
```bash
npm run typecheck              # Run TypeScript type checking
npm run build                  # Build and type check (tsc --noEmit first)
```

From `package.json`:
```json
{
  "scripts": {
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

## Test File Organization

**Current Structure:**
- No test directory exists
- No test files present

**Recommended Structure (when tests are added):**
```
src/
├── adapters/
│   ├── glassAdapter.ts
│   └── glassAdapter.test.ts
├── services/
│   ├── wakeLockService.ts
│   └── wakeLockService.test.ts
└── config/
    └── constants.ts
```

## Type Safety as Testing

**Strict TypeScript Configuration** (`tsconfig.json`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "useUnknownInCatchVariables": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**What This Enforces:**
- All function parameters must be explicitly typed
- All return types must be explicitly specified
- Variables must have compatible assignments
- Catch variables typed as `unknown` (no implicit `any`)
- Null/undefined must be explicitly handled
- No unchecked array access without index checking

## Manual Testing Approach

**Current Testing Method:**
The codebase appears designed for manual testing on hardware/simulator:

**Development Server:**
```bash
npm run dev                    # Start Vite dev server
npm run sim                    # Run EvenHub simulator
```

**Physical Testing:**
- Glass adapter tested on Even Realities G2 glasses hardware
- Wake lock service tested on real device with Navigator.wakeLock API
- Gesture handling tested via physical device gestures or simulator

**Testing Notes from Code:**

From `src/adapters/glassAdapter.ts` (lines 22-33):
```typescript
/**
 * GlassAdapter implementation built from official SDK docs and
 * Nick Ustinov's G2 community notes.
 *
 * Key design decisions:
 * - createStartUpPageContainer called exactly once (first render)
 * - rebuildPageContainer only for mode changes
 * - textContainerUpgrade for in-place text updates (no flash)
 * - 300ms scroll cooldown to prevent duplicate events
 * - CLICK_EVENT=0->undefined quirk handled
 * - Simulator sysEvent + hardware listEvent/textEvent all handled
 */
```

These documented quirks require testing against both simulator and hardware.

## Error Handling Validation

**Type-Safe Error Handling Pattern:**

From `src/main.ts` (lines 66-71):
```typescript
void bootstrap().catch((error: unknown) => {
  setStatus("Failed to start", String(error));
  const dot = document.getElementById("status-dot");
  if (dot) dot.className = "status-indicator error";
  console.error("G2 app failed to start", error);
});
```

**Pattern Benefits:**
- `error: unknown` forces explicit type checking before use
- `String(error)` safely converts any error to string
- UI state updated on error (`status-dot` class change)
- Error logged to console for developer debugging

## Boundary Testing (Type-Based)

**Interface Contracts:**

From `src/types/contracts.ts`:
```typescript
export interface GestureEvent {
  kind: GestureKind;
  /** Firmware-reported list selection index (from listEvent on TAP). */
  listIndex?: number;
}

export interface StatusBar {
  left: string;
  right: string;
}

export interface GlassAdapter {
  connect(): Promise<void>;
  onGesture(handler: (event: GestureEvent) => void): Unsubscribe;
  showList(items: string[], statusText: string): Promise<void>;
  showText(text: string, status: StatusBar): Promise<void>;
  updateText(text: string, status: StatusBar): Promise<void>;
  showMessage(text: string): Promise<void>;
}
```

**Type Safety:**
- All gesture events must have `kind` (required)
- Only defined gesture kinds accepted
- StatusBar always has both `left` and `right`
- All methods must match interface signature

## State Validation

**Private State Management:**

From `src/services/wakeLockService.ts`:
```typescript
export class WakeLockServiceImpl implements WakeLockService {
  private sentinel: WakeLockSentinel | null = null;
  private wantLock = false;
  private boundVisibilityHandler: (() => void) | null = null;

  async acquire(): Promise<void> {
    this.wantLock = true;
    this.ensureVisibilityListener();
    await this.requestLock();
  }

  async release(): Promise<void> {
    this.wantLock = false;
    await this.releaseLock();
  }
}
```

**State Guarantees:**
- `sentinel` can only be `WakeLockSentinel | null` (type-checked)
- `wantLock` boolean prevents redundant operations
- `boundVisibilityHandler` prevents duplicate listeners
- Private keyword prevents external state modification

## Promise/Async Testing

**Async Pattern Examples:**

From `src/adapters/glassAdapter.ts` (lines 335-352):
```typescript
private async waitForBridge(): Promise<EvenAppBridge> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              "Timed out waiting for Even bridge. Open this URL from Even app dev mode.",
            ),
          );
        }, TIMING.BRIDGE_TIMEOUT_MS);
      }),
    ]);

    return bridge;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

**What Gets Validated:**
- Promise race condition handling
- Timeout rejection path
- Timer cleanup in finally block
- Error message clarity for debugging

## Testing Coverage Gaps

**Currently Untested Areas:**

1. **Event Mapping Logic** (`mapEventToGesture` method)
   - Files: `src/adapters/glassAdapter.ts` (lines 291-326)
   - Complexity: Multiple event type mappings with quirk handling
   - Risk: Silent failures if event mapping breaks

2. **Layout Calculations** (`makeSplitStatus` method)
   - Files: `src/adapters/glassAdapter.ts` (lines 183-212)
   - Complexity: Character width calculations and positioning
   - Risk: Display layout could break on different text lengths

3. **Container Lifecycle** (`renderContainers` method)
   - Files: `src/adapters/glassAdapter.ts` (lines 214-260)
   - Complexity: First-render vs. rebuild state machine
   - Risk: Incorrect startup/rebuild sequence could cause rendering failures

4. **Wake Lock Availability** (`requestLock` method)
   - Files: `src/services/wakeLockService.ts` (lines 32-49)
   - Complexity: API availability checks and error recovery
   - Risk: Failures on unsupported browsers not detected

5. **Visibility Change Handling**
   - Files: `src/services/wakeLockService.ts` (lines 67-77)
   - Complexity: Event listener registration and state synchronization
   - Risk: Wake lock could be released unexpectedly on visibility changes

**Recommended Priority for Testing:**
- High: Event mapping and container lifecycle (core UI functionality)
- Medium: Layout calculations (visual correctness)
- Medium: Wake lock availability (graceful degradation)
- Low: Visibility change handling (edge case)

---

*Testing analysis: 2026-02-26*
