---
phase: 12-automation-test-harness
plan: 01
subsystem: harness
tags: [png, framebuffer, metrics, self-check, zero-dependency]
requires: []
provides:
  - "harness/png.ts — decodePng(), zero-dependency PNG decoder over node:zlib"
  - "harness/frame.ts — Frame/Region types, toFrame, inkRatio, greyLevels, saveFrame, INK_THRESHOLD"
  - "harness/regions.ts — REGIONS map derived from DISPLAY/GLASS_LAYOUT/OVERLAY_LAYOUT"
  - "harness/fixtures/ — two real 576x288 simulator captures"
  - "npm run typecheck:harness"
affects:
  - "12-02 (probe.ts) and 12-03 (run.ts) consume these signatures verbatim"
tech-stack:
  added: []
  patterns:
    - "Node 22.18+ native TypeScript type stripping; no tsx/ts-node/build step"
    - "Relative imports carry explicit .ts extensions"
    - "Type-only imports use `import type` (a plain named import of a type becomes a live ESM binding under type stripping and throws at runtime; tsc does not catch it)"
    - "assert-based self-check, no test framework (D-11)"
key-files:
  created:
    - harness/tsconfig.json
    - harness/png.ts
    - harness/frame.ts
    - harness/regions.ts
    - harness/selfCheck.ts
    - harness/fixtures/glasses_menu.png
    - harness/fixtures/glasses_fixed.png
    - .planning/phases/12-automation-test-harness/deferred-items.md
  modified:
    - package.json
decisions:
  - "Hand-rolled PNG decoder over node:zlib rather than pngjs/sharp — ~170 lines vs a ~30 MB native binary for generality never used"
  - "Unsupported PNG shapes (16-bit, palette, interlaced) hard-throw by name rather than falling through, so ink is never measured on garbage bytes"
  - "Luminance is premultiplied by alpha — the simulator carries brightness in alpha, not RGB"
  - "Real simulator captures committed as fixtures; synthetic PNGs alone cannot validate the metrics"
  - "Out-of-bounds regions throw rather than clamp — a clamped region passes an assertion for the wrong reason"
metrics:
  tasks: 2
  commits: 5
  checks: 21
  duration: ~50 min
  completed: 2026-09-17
---

# Phase 12 Plan 01: Framebuffer Analysis Primitives Summary

Zero-dependency PNG decoding plus alpha-aware ink/grey metrics over layout-derived
regions, with a 21-check self-check that fails loudly when any primitive is wrong.

## What Was Built

| File | Provides |
| --- | --- |
| `harness/png.ts` | `decodePng()` — chunk walk, `zlib.inflateSync`, all five PNG scanline filters, colour types 0/2/4/6 expanded to RGBA |
| `harness/frame.ts` | `Frame`/`Region`, `toFrame`, `inkRatio`, `greyLevels`, `saveFrame`, `INK_THRESHOLD` |
| `harness/regions.ts` | `REGIONS` — 7 named rects derived by reference from `DISPLAY`/`GLASS_LAYOUT`/`OVERLAY_LAYOUT` |
| `harness/selfCheck.ts` | 21 assert-based checks; inline CRC-32 + synthetic PNG builder; exits non-zero on any failure |
| `harness/fixtures/*.png` | Two real 576x288 `/api/screenshot/glasses` captures |
| `harness/tsconfig.json` | `allowImportingTsExtensions` + `noEmit`, overriding the root `rootDir: src`/`outDir` |

Zero dependencies added. `package.json` gained only `typecheck:harness` and `engines.node >= 22.18`.

## Verification (actual output)

```
$ node harness/selfCheck.ts
PASS  01 decodePng 2x2 RGBA colorType 6 filter None
... (01-21 all PASS) ...
OK  21/21 checks passed
EXIT=0

$ npm run typecheck:harness        -> EXIT=0
$ npm run typecheck                -> EXIT=0   (app unaffected)
$ grep -c '[0-9][0-9]' harness/regions.ts  -> 0
$ git diff package.json            -> +typecheck:harness, +engines only
```

**Falsifiability proven twice.** The self-check is not a rubber stamp:

- Paeth branch replaced with `v = x + a` -> checks 02 and 05 FAIL, exit 1. Restored.
- `lum()` reverted to alpha-blind -> checks 18-21 FAIL, exit 1. Restored.

**Decoder validated against real-world PNGs**, not only its own synthetic fixtures:
`qr-code.png` (264x264, adaptively filtered by a third-party encoder) decodes to
exactly 2 distinct tones — filter noise would produce hundreds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ink/grey metrics were blind on real simulator output**

- **Found during:** Task 2, after the coordinator supplied real captures
- **Issue:** The simulator carries brightness in the **alpha** channel and pins
  RGB to a constant `(0,255,0)` on every pixel, lit or not. The plan specified a
  plain BT.601 luma over RGB, which returned `round(0.587*255) = 150` for all
  165,888 pixels of every frame. `inkRatio` was therefore **exactly 1.0 on every
  region of every frame, including a blank one**, and `greyLevels` was always 1.
  This silently defeats HARN-03, the requirement the whole phase exists to serve.

  ```
  before:  glasses_menu.png   FULL=1.000  TEAM_BAR=1.000  LIST=1.000   greys=1
           glasses_fixed.png  FULL=1.000  TEAM_BAR=1.000  LIST=1.000   greys=1
  after:   glasses_menu.png   FULL=0.0120 TEAM_BAR=0.0000 LIST=0.0000  greys=8
           glasses_fixed.png  FULL=0.0306 TEAM_BAR=0.0495 LIST=0.0220  greys=8
  ```

- **Fix:** `lum()` premultiplies by alpha, so an unlit pixel scores 0.
  `INK_THRESHOLD = 16` re-justified against both ranges it must serve (opaque
  greyscale up to 255; simulator premultiplied up to 150, dimmest real alpha 96
  giving 56). Two real captures committed as fixtures, plus checks 18-21 — the
  upper ink bound and the transparent-frame guard are the load-bearing halves.
  A "> 0" assertion alone would have passed the broken code.
- **Root cause of the miss:** all 17 original fixtures were synthetic PNGs built
  by the self-check itself with opaque RGB greys, so they encoded the same
  assumption as the code and confirmed it rather than tested it.
- **Files modified:** `harness/frame.ts`, `harness/selfCheck.ts`, `harness/fixtures/`
- **Commit:** `1e52d97`

**2. [Rule 1 - Bug] Unrounded BT.601 luma bucketed one level low**

- **Found during:** Task 2 design
- **Issue:** `0.299 + 0.587 + 0.114` is `0.9999999999999999` in IEEE754, so
  `lum(16,16,16)` yields `15.99…`; `>> 4` truncates it to bucket 0 and the
  `> 16` threshold misses. Grey level 1 (=17) would have read as unlit.
- **Fix:** `Math.round()` the luma. Covered by checks 10 and 14.
- **Commit:** `b10522c`

### Cosmetic

Dropped a `(D-08)` reference from a `harness/regions.ts` doc comment so the
plan's literal gate `grep -c '[0-9][0-9]'` reads 0. The `08` was a decision
citation, not a coordinate; traceability is preserved in the plan and in the
`selfCheck.ts` check-16 comment.

## Did Not Work As Written

**The Node version guard cannot fire for the case it was written for.** The
plan specifies a three-line `process.versions.node` guard at the top of every
entry point, to satisfy must-have truth #6 ("running any harness entry point on
Node <22.18 fails with a message naming the version floor, not an opaque
extension error"). It is implemented as specified and its boundary logic is
correct (22.17.0 rejected, 22.18.0 allowed), but on a Node that cannot strip
types the failure happens at **module resolution of the entry file itself** —
before a single byte of that file executes. Demonstrated locally that ESM
imports are hoisted above the guard. So `node harness/selfCheck.ts` on Node 20
still dies with `ERR_UNKNOWN_FILE_EXTENSION`.

Not fixed here: the working fix is a plain-JS preflight in `npm run harness`,
and changing the entry-point shape would break the `node harness/probe.ts` /
`node harness/run.ts` contract 12-02 and 12-03 are already written against.
Logged as **D1** in `deferred-items.md`, owned by 12-03. The in-file guards are
harmless and should stay.

## Deferred Items

See `.planning/phases/12-automation-test-harness/deferred-items.md`:

- **D1** — version guard is unreachable on old Node; fix belongs in 12-03's `npm run harness`.
- **D2** — the repo's own `src/data/sprites/*.png` are palette PNGs and hard-throw by design; Phase 15 should know.
- **D3** — `greyLevels` tops out at 10 buckets on simulator output (premultiplied luma maxes at 150), so Phase 15 cannot assert `=== 16`.

## Known Stubs

None. Every exported function is fully implemented and exercised by at least one
check that has been verified to fail when the implementation is broken.

## Self-Check: PASSED

All created files present; all 5 commits present in `git log`.
