# Pokemon Showdown G2

Gen 9 random battles on Even Realities G2 smart glasses. TypeScript + Vite,
`@pkmn/sim` for the battle engine, rendered to a 576x288 monochrome panel
through the EvenHub SDK.

```bash
npm run dev          # vite only -- NOT enough on its own, see TESTING.md
npm run typecheck    # tsc --noEmit, must be zero
npm run harness      # the automated regression suite (below)
```

The app has to be served by `even-dev` (it supplies the Vite plugins and the
`public/` asset symlinks) and driven through the EvenHub simulator. See
[TESTING.md](TESTING.md) for the manual loop.

## Test harness

`npm run harness` is the regression entry point. It boots Vite and the
simulator itself, drives the real app over the simulator's HTTP automation API,
and **exits non-zero on any failure** — no test framework, no browser driver,
no image library, zero new dependencies (D-02, D-11). Scenarios are plain async
functions and assertions throw.

```bash
npm run harness                      # full suite, from a cold machine
npm run harness -- --only battle     # one scenario: selfCheck | boot | negativeProof | battle
npm run harness -- --keep            # leave the stack up afterwards to poke at
npm run harness -- --attach          # attach to a simulator you already started
npm run harness -- --port 9898       # automation port (default 9898)
node harness/selfCheck.ts            # the harness's own primitives, no simulator needed
npm run typecheck:harness            # tsc over harness/ + the src/ it reads
```

Artifacts land in `.harness-runs/<timestamp>/`: a PNG for every captured frame
(including a `<step>-FAIL.png` at the moment of any failure) plus `result.json`
with per-step pass/fail, elapsed ms and host-call counts (D-09, D-13).

### Both log streams are watched — do not "simplify" the tee away

The harness reads `/api/console` **and the simulator's own stdout/stderr**.
This is the single most important thing in it. Container validation failures —

```
RebuildPageContainer validation failed: image container size 576x24 exceeds maximum 288x144
```

— are written **only** to simulator stdout and appear nowhere in
`/api/console`. A harness that read just the console API would have passed the
exact defect that made this game unplayable (HARN-02, D-03). `harness/sim.ts`
tees both pipes of the child process, and `run.ts` fails the whole run if zero
stdout lines were captured, so a dead tee can never look like a clean run.

Consequences, on purpose:
- the harness refuses to attach to a simulator it did not spawn unless you pass
  `--attach`, because there is no child process to tee (it then prints
  `HARN-02 COVERAGE DISABLED`);
- it refuses to run with `RUST_LOG=off|error`, which would silence the
  WARN-level validation lines;
- warnings are failures. `rebuildPageContainer failed after retry` was logged
  at warn level the entire time the game was unplayable.

Known app defects are waived one exact anchored line at a time in
`KNOWN_DEFECTS` (`harness/assert.ts`), each naming the phase that must fix it
and delete the entry; every waived line is printed at the end of the run. Never
add a blanket pattern there.

### Scenarios

| Scenario        | Needs sim | What it proves                                                                |
| --------------- | --------- | ----------------------------------------------------------------------------- |
| `selfCheck`     | no        | the PNG decoder, ink metric, region map and failure policy, before anything boots |
| `boot`          | yes       | cold boot to MAIN_MENU, enter battle, all seven input actions, `/api/screenshot/webview` |
| `negativeProof` | yes       | the assertions can actually fail — a measured-blank region really does throw   |
| `battle`        | yes       | HARN-04: the full scripted battle, main menu to win/loss end screen            |

`battle` is built on `runBattleScript(ctx, opts)` (`harness/scenarios/battle.ts`),
exported with `speed` / `maxTurns` / `switchOnTurn` / `onTurn` so Phases 13-19
can hang their own assertions on a real battle without forking the file:

```ts
const outcome = await runBattleScript(ctx, {
  maxTurns: 5,
  onTurn: async (turn, ctx) => { /* per-turn assertions go here */ },
});
// -> { turns, finished, sawVoluntarySwitch, sawForcedSwitch, hostCallsByTurn }
```

It runs at **Normal** speed, which takes ~10 minutes for a full battle. Instant
speed would take ~30 seconds and is implemented (`{ speed: "Instant" }`), but
the app deadlocks in it — see `harness-01`/`harness-03` in the header comment of
`harness/scenarios/battle.ts`.

### What this does NOT prove

The simulator proves *simulator* behaviour. Its own README documents font
rendering, list focus position, error-response handling and image-size
enforcement as divergent from hardware — in particular it does **not** enforce
the hardware image-size limit, which is why the harness reads the validation
warning rather than expecting an error. Assertions are therefore on ink
coverage per region, not pixel-exact golden images (D-07, D-10). **A hardware
pass over the real Even app remains a manual step.**
