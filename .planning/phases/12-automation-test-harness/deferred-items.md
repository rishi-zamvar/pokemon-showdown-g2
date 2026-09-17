# Phase 12 — deferred items

## D1. The Node version guard cannot fire for the case it was written for

**Found during:** 12-01 Task 1 (verifying must_haves truth #6)
**Owner:** 12-03 (`npm run harness`, the real user-facing entry point)

12-01's plan specifies a three-line guard at the top of every harness entry
point, and says 12-02/12-03 must repeat it verbatim in `probe.ts` and `run.ts`:

```ts
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj! < 22 || (maj === 22 && min! < 18)) { ...; process.exit(1); }
```

The guard is implemented as specified and its boundary logic is correct
(verified: 22.17.0 rejected, 22.18.0 allowed). **But ESM `import` declarations
are hoisted above it**, and more decisively, the failure it targets happens at
module *resolution* of the entry file itself — before a single byte of that
file executes. Demonstrated locally:

```
$ node hoist.ts          # guard written above the import
  <- imported module body ran FIRST (imports are hoisted)
  <- version guard ran
```

So on Node <22.6 (and on 22.6–22.17 without `--experimental-strip-types`),
`node harness/selfCheck.ts` still dies with `ERR_UNKNOWN_FILE_EXTENSION`
— the opaque error truth #6 exists to prevent. The guard only fires in the
narrow case of Node 22.6–22.17 run *with* the experimental flag.

**Fix belongs in 12-03, not here:** the version check has to live in something
the old runtime can actually load — a plain `.js`/`.mjs` shim, or a `node -e`
preflight in the `npm run harness` script, e.g.

```json
"harness": "node -e \"const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<18)){console.error('harness needs Node >=22.18; this is '+process.versions.node);process.exit(1)}\" && node harness/run.ts"
```

Not fixed in 12-01 because changing the entry-point shape would break the
`node harness/probe.ts` / `node harness/run.ts` contract that 12-02 and 12-03
are already written against. The in-file guards are harmless and should stay.

## D2. The repo's own sprite PNGs are colour type 3 (palette)

**Found during:** 12-01 Task 1 (validating the decoder against real files)

`src/data/sprites/*.png` are 8-bit **palette** PNGs. `decodePng` hard-throws on
them by design — palette index bytes would otherwise be measured as if they
were greyscale, and ink assertions would silently read garbage. This is correct
for the harness (it only ever decodes `/api/screenshot/glasses`, which is
colour type 6), but Phase 15 (4-bit greyscale sprite pipeline) should know the
harness decoder cannot read the source sprites directly. Add PLTE support there
only if Phase 15 actually needs it.

## D3. greyLevels tops out at 10 buckets on simulator output, not 16

**Found during:** 12-01 alpha-blindness fix
**Owner:** Phase 15 (4-bit greyscale sprite pipeline)

Because the simulator pins RGB to (0,255,0) and carries brightness in alpha,
premultiplied luma maxes at `round(0.587 * 255) = 150`, so `lum >> 4` can only
ever reach bucket 9. `greyLevels` therefore returns at most **10** on simulator
captures, not 16 — real captures currently report 8.

This is fine for what Phase 12 needs (it cleanly separates 1-bit content from
multi-level content). But Phase 15 wants to prove sprites use all 16 grey
levels, and `greyLevels(...) === 16` can never hold against the simulator. Phase
15 should assert on the alpha histogram directly, or assert `greyLevels >= N`
with N calibrated against a known-good 16-level capture. Do not "fix" this by
loosening the bucket shift — the shift is correct for opaque hardware-shaped
greyscale, which is the other input this metric has to serve.
