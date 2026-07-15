---
name: verify
description: How to launch and drive index.html headlessly to verify changes
---

# Verifying zip-cube

Single-file app (`index.html`), no build. Needs network (Three.js CDN) and WebGL.

## Syntax check (fast)

Extract the inline `<script>` block to a temp .js file and run `node --check` on it.
Note: IDE/linter reports a false "Unterminated regular expression literal" at the
`while(n-->0...)` line — the HTML parser misreads `-->`; it's valid JS.

## Runtime check (headless Chrome)

Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Recipe that works:

1. Copy the HTML to scratch; inject two scripts:
   - In `<head>`: throttle rAF or the SwiftShader render loop eats the whole
     virtual-time budget (run never finishes):
     `window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),80);`
   - Before `</body>`: an async driver that clicks real buttons / dispatches real
     `PointerEvent`s, then appends a `<pre id=VERIFY_RESULT>` with JSON results.
2. In the driver, stub `Element.prototype.setPointerCapture/releasePointerCapture`
   to no-ops — synthetic pointerIds make the real ones throw.
3. Run:
   `chrome --headless=new --disable-gpu --enable-unsafe-swiftshader --user-data-dir=<scratch> --window-size=430,900 --virtual-time-budget=10000 --timeout=60000 --dump-dom file://<verify.html>`
   then grep `VERIFY_RESULT_JSON=` from the dumped DOM.
4. Screenshot evidence: same flags with `--screenshot=<path>` on the real file,
   budget ~3000.

## Flows worth driving

- Play: tap cube canvas cells (raycast tap), drag-sweep the net mini-map grid
  (8×6 cell centers) to exercise drag-draw, Undo/Reset, watch `#pFilled`.
- Solver: `#modeSolver` → `#logline` shows "trace from depth N: … finds a solution";
  `#stepBtn` ×k → push+pop+prune counters sum to k; `#playBtn` + wait; `#pruneChk`
  toggle rebuilds a (much larger) trace; `#restartBtn` zeroes counters.
- Stress: click `#newBtn` ~40× (exercises puzzle generation and badge disposal).
- Capture `window.addEventListener('error', …)` in the driver; expect zero errors.

## Gotchas

- zsh: never `echo ===` in a command list — `=word` expansion aborts the whole line.
- Don't skip the rAF throttle; without it the run times out (>2 min).
- **Always stub modals first thing in the driver:** `window.prompt=()=>null; window.alert=()=>{}; window.confirm=()=>true;`
  `copyText()`'s clipboard fallback calls `prompt()`, and a pending modal freezes
  virtual time **forever** — the run wedges with an empty dump and no error. It's
  flaky (depends on whether `navigator.clipboard.writeText` rejects before the
  budget expires), so a driver that passed once can wedge the next run.
- Keep drivers short (one flow each) and `--virtual-time-budget` modest (~2500–12000);
  each throttled rAF tick costs a full SwiftShader render in real time.
- A fresh profile auto-starts the first-time tutorial on boot (no `#z=` hash).
  Click `#newBtn` or use `__zip.tut()`/`startTutorial()` to control it; pre-set
  `localStorage['zipcube.tutorial']='done'` in a `<head>` script to suppress it.
- Leftover headless Chromes from killed runs keep burning CPU and racing output
  files — `pkill -f 'Google Chrome.*--headless'` before re-running.
