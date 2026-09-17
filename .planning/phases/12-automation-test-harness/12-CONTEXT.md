# Phase 12: Automation Test Harness - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Mode:** --auto (defaults selected from prior research; no user questions)

<domain>
## Phase Boundary

Deliver a harness that drives the running EvenHub simulator over its HTTP
automation API, reads the real 576x288 glasses framebuffer plus both log
streams, and fails on any defect. Every later phase in v2.0 is built test-first
against this harness.

This phase adds **no** gameplay or rendering behaviour. It only observes.

</domain>

<decisions>
## Implementation Decisions

### Transport — why HTTP, not a mocked bridge
- **D-01:** Drive the real simulator through `--automation-port`, not a faked
  `EvenAppBridge`. The two bugs that made this app unplayable were both below
  the app's own abstractions — a dangling asset symlink and a container the
  firmware rejects. A mock at the `GlassAdapter` seam would have reported
  success for both. The harness must see what the device sees.
- **D-02:** No Playwright, no browser automation. The simulator already exposes
  input, framebuffer and console over HTTP; adding a browser driver would be a
  second, less faithful path to the same data.

### Log capture — two streams, not one
- **D-03:** Capture the console API **and** simulator stdout. Container
  validation failures (`image container size 576x24 exceeds maximum 288x144`)
  are written to stdout and appear nowhere in `/api/console`. A harness that
  reads only the console API would have passed the exact defect that made the
  game unplayable. This is the single most important requirement in the phase.
- **D-04:** Poll `/api/console?since_id=N` incrementally; never re-read the
  whole buffer. Clear with `DELETE /api/console` at the start of each scenario
  so assertions are scoped to one step.

### Failure policy — fail loud
- **D-05:** Any console entry at `error` level, any `[uncaught]`,
  `[unhandledrejection]` or `[fetch]` prefix, and any simulator stdout line
  matching `WARN|ERROR|validation failed|not found` fails the run. Warnings are
  not tolerated — `rebuildPageContainer failed after retry` was logged as a
  warning while the game was unplayable.
- **D-06:** Assertions are on framebuffer content, not just absence of errors.
  A screen that renders blank produces no error at all.

### Framebuffer assertions — how to assert on a PNG
- **D-07:** Decode the PNG and assert on **ink coverage per region**: the
  fraction of non-black pixels inside a named rectangle. This is robust against
  font differences between simulator and hardware, which the simulator README
  warns about, while still catching blank screens, missing containers, and
  content in the wrong place.
- **D-08:** Provide region helpers matching `OVERLAY_LAYOUT` so a test can say
  "the action list region has ink" without restating coordinates.
- **D-09:** Save every captured frame to a run directory as a PNG artifact.
  Debugging a failure means looking at the frame.
- **D-10:** No golden-image / pixel-exact diffing. Font rendering is documented
  as divergent between simulator and hardware, so exact comparison would be
  brittle and would fail for reasons unrelated to defects.

### Scenario model
- **D-11:** Scenarios are plain async functions taking a driver handle. No test
  framework, no fixtures — this repo has no test runner and a harness that
  needs one is a harness nobody runs.
- **D-12:** One command runs everything: `npm run harness`. It must start from
  nothing (no simulator assumed running), or attach to an already-running one.
- **D-13:** Each step records the host call count observed in the console, so
  Phase 19 can assert on call counts without new plumbing.

### Lifecycle
- **D-14:** The harness owns simulator and Vite lifecycle when it starts them,
  and tears down only what it started.
- **D-15:** Wait on conditions (`/api/ping` responding, a region gaining ink),
  never fixed sleeps, except where the platform's own fixed costs require it.

</decisions>

<constraints>
## Known Constraints

- Input is ignored unless a container has `isEventCapture: 1`. A silently
  dropped input looks identical to a no-op — assert the screen changed.
- `POST /api/input` actions: `up`, `down`, `click`, `double_click`,
  `long_press`, `long_press_release`, `context_menu`.
- Screenshots are 576x288 RGBA PNG.
- Simulator/hardware divergences are documented for font rendering, list focus
  position, error-response handling, and image-size enforcement. The harness
  proves simulator behaviour, which is necessary but not sufficient — hardware
  verification stays a manual step.
- Real host calls cost ~104 ms (image), ~165 ms (rebuild). A full battle
  scenario is inherently slow; budget for it rather than racing it.

</constraints>

<deferred>
## Deferred

- CI integration — no CI exists for this repo yet.
- Hardware-in-the-loop testing over the real Even App.
- Golden-image regression — revisit only if ink-coverage proves too coarse.

</deferred>
