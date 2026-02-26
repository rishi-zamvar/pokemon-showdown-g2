# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- PascalCase for implementation classes: `glassAdapter.ts`, `wakeLockService.ts` (with camelCase prefix when implementing interface)
- camelCase for service/utility files: `constants.ts`, `main.ts`
- PascalCase for type definition files: `contracts.ts`
- Interfaces and types prefixed clearly: `GlassAdapter`, `WakeLockService`
- Type declaration files use `.d.ts` suffix: `fsapi.d.ts`, `global.d.ts`

**Functions:**
- camelCase for all functions: `bootstrap()`, `setStatus()`, `connect()`, `onGesture()`
- Private methods prefixed with `private` keyword and use camelCase: `waitForBridge()`, `bindEvents()`, `mapEventToGesture()`
- Async functions clearly marked with `async` keyword: `async bootstrap()`, `async connect()`
- Handler functions use verb-noun pattern: `bindEvents()`, `ensureVisibilityListener()`

**Variables:**
- camelCase for all variable declarations: `lastScrollTime`, `bridge`, `gestureHandlers`, `wantLock`
- Constants in UPPER_SNAKE_CASE with `const` and `as const`: `SCROLL_COOLDOWN_MS`, `BRIDGE_TIMEOUT_MS`
- Private instance variables use underscore prefix pattern in some cases (e.g., `private sentinel`)
- Handler variables use descriptive names: `boundVisibilityHandler`, `unsubscribeHub`

**Types:**
- PascalCase for all types and interfaces: `GestureEvent`, `StatusBar`, `GlassAdapter`, `Unsubscribe`
- Type imports use `type` keyword for clarity: `import type { GestureEvent, GlassAdapter }`
- Union types use pipe syntax: `GestureKind = "SCROLL_FWD" | "SCROLL_BACK" | "TAP"`
- Readonly properties marked with `readonly`: `interface GestureEvent { kind: GestureKind; listIndex?: number; }`

## Code Style

**Formatting:**
- No explicit formatter configured (eslint/prettier not found)
- 2-space indentation (observed in HTML and all source files)
- Consistent line length around 100 characters (observed in comments and code)
- Type annotations on function parameters and return types
- Explicit void return types for functions with side effects: `function setStatus(text: string, detail?: string): void`

**Linting:**
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- Additional strict checks enabled:
  - `noUncheckedIndexedAccess: true`
  - `useUnknownInCatchVariables: true`
  - `forceConsistentCasingInFileNames: true`
- Type checking enforced in build: `npm run build` includes `tsc --noEmit`

## Import Organization

**Order:**
1. External SDK imports from `@evenrealities` packages
2. Internal imports from `./` paths using relative imports
3. Type-only imports marked with `type` keyword

**Pattern Example** (from `src/adapters/glassAdapter.ts`):
```typescript
import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  // ... more SDK imports
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { CONTAINER_IDS, CONTAINER_NAMES, GLASS_LAYOUT, TIMING } from "../config/constants";
import type { GestureEvent, GlassAdapter, StatusBar, Unsubscribe } from "../types/contracts";
```

**Path Aliases:**
- No path aliases configured in `tsconfig.json`
- Relative imports using `./` and `../` patterns

## Error Handling

**Patterns:**

**Throw on Invalid State:**
```typescript
// From glassAdapter.ts line 112
if (!this.bridge) {
  throw new Error("Not connected");
}
```

**Promise Rejection Handling:**
```typescript
// From main.ts line 66
void bootstrap().catch((error: unknown) => {
  setStatus("Failed to start", String(error));
  const dot = document.getElementById("status-dot");
  if (dot) dot.className = "status-indicator error";
  console.error("G2 app failed to start", error);
});
```

**Try-Catch with Best Effort:**
```typescript
// From wakeLockService.ts line 40
try {
  this.sentinel = await navigator.wakeLock.request("screen");
  this.sentinel.addEventListener("release", () => {
    this.sentinel = null;
  });
  console.log("[wakelock] Acquired");
} catch (err) {
  console.warn("[wakelock] Failed to acquire:", err);
}
```

**Retry Pattern with Timeout:**
```typescript
// From glassAdapter.ts line 335
try {
  const bridge = await Promise.race([
    waitForEvenAppBridge(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Timed out waiting for Even bridge..."));
      }, TIMING.BRIDGE_TIMEOUT_MS);
    }),
  ]);
  return bridge;
} finally {
  if (timer) clearTimeout(timer);
}
```

## Logging

**Framework:** `console` (no custom logger)

**Patterns:**

**Info Logging:**
```typescript
console.log("Gesture:", gesture.kind, gesture.listIndex);
console.log("[wakelock] Acquired");
```

**Warning Logging:**
```typescript
console.warn("[glass] rebuildPageContainer failed after retry");
console.warn("[wakelock] Failed to acquire:", err);
```

**Error Logging:**
```typescript
console.error("G2 app failed to start", error);
```

**Prefix Convention:** Use bracket notation for component/module identification:
- `[glass]` for glass adapter messages
- `[wakelock]` for wake lock service messages

## Comments

**When to Comment:**
- Block comments before class definitions explaining overall pattern and design decisions
- Inline comments for quirks and non-obvious behavior
- JSDoc comments for public APIs and complex methods

**JSDoc/TSDoc Pattern** (from `glassAdapter.ts`):
```typescript
/**
 * Show a scrollable list on glasses.
 * Always rebuilds because list items can't be updated in-place.
 */
async showList(items: string[], statusText: string): Promise<void> {
  // ...
}
```

**Architecture Documentation Pattern** (from `glassAdapter.ts` line 22-33):
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

## Function Design

**Size:** Functions range from single-purpose (5-20 lines) to complex methods (60+ lines)

**Parameters:**
- Explicit typing on all parameters: `(items: string[], statusText: string)`
- Optional parameters use `?` syntax with undefined values: `detail?: string`
- Payload objects passed as single parameter with typed interface: `payload: { listObject?: ListContainerProperty[]; textObject?: TextContainerProperty[] }`

**Return Values:**
- Promise-based async patterns: `Promise<void>`, `Promise<EvenAppBridge>`
- Explicit return types always specified: `function setStatus(): void`
- Union return types for methods with multiple outcomes: `GestureEvent | null`

**Single Responsibility:**
- Setup methods isolated: `ensureVisibilityListener()`
- Event mapping isolated: `mapEventToGesture()`
- Rendering isolated: `renderContainers()`
- Status creation isolated: `makeStatusContainer()`, `makeSplitStatus()`

## Module Design

**Exports:**

**Class-Based Module** (`src/adapters/glassAdapter.ts`):
```typescript
export class GlassAdapterImpl implements GlassAdapter {
  // Implementation matching interface contract
}
```

**Service Implementation** (`src/services/wakeLockService.ts`):
```typescript
export interface WakeLockService {
  // Interface definition
}
export class WakeLockServiceImpl implements WakeLockService {
  // Implementation
}
```

**Type Module** (`src/types/contracts.ts`):
```typescript
export type Unsubscribe = () => void;
export interface GestureEvent { /* ... */ }
export interface GlassAdapter { /* ... */ }
```

**Constants Module** (`src/config/constants.ts`):
```typescript
export const DISPLAY = { /* ... */ } as const;
export const GLASS_LAYOUT = { /* ... */ } as const;
export const TIMING = { /* ... */ } as const;
export const CONTAINER_IDS = { /* ... */ } as const;
export const CONTAINER_NAMES = { /* ... */ } as const;
```

**Barrel Files:** Not used in this codebase

**Instance Initialization Pattern:**
```typescript
// From main.ts - Direct instantiation and initialization
const glass = new GlassAdapterImpl();
const wakeLock = new WakeLockServiceImpl();
await glass.connect();
```

---

*Convention analysis: 2026-02-26*
