# First-Time Tutorial — Design

Date: 2026-07-15
Status: approved

## Goal

An interactive guided tutorial that teaches a first-time player the core of Zip
Cube by making them perform real moves. Six steps, play mode only. Solver,
hint, and challenge remain self-discoverable.

## Approach

A step machine layered on the existing game, reusing existing primitives:

- **Highlight**: the existing `hint` glow (`--tile-hint`), extended so the
  tutorial can hold a glow until the step completes instead of the 4 s decay.
- **Camera**: `faceCell()` auto-turns the cube toward the current target.
- **Board**: a hardcoded known-good puzzle code loaded via the existing
  `decodeCode()`/`applyPuzzle()` path, so every first-timer sees the same
  board. The code is chosen at implementation time (a board where checkpoint 1
  has friendly geometry for the first moves).
- **Guidance target**: `solveFrom(path)` computes a live solution; the glow
  target is always `sol[path.length]`. If the player deviates but is still
  solvable, the glow recomputes from the new path; if they hit a dead end the
  glow falls back on the existing hint "undo to the glowing cell" behaviour.

## Steps

| # | Instruction (banner text) | Completes when |
|---|---|---|
| 1 | "Drag anywhere on the cube to spin it around." | A real pointer rotate-drag happens (attract-mode idle spin does not count). |
| 2 | "Now drag from ① onto the glowing cell." | Path head equals the glowed cell (path length ≥ 2). |
| 3 | "Keep drawing — checkpoints must be visited in order. Reach ②." | Path head is checkpoint 2. |
| 4 | "Made a mistake? Drag backwards, tap a visited cell, or press Undo." | Any `popOne()` or `truncateTo()` fires. |
| 5 | "The mini net shows all six faces flat — you can draw there too. Extend the path from the net." | A successful extend originating from the net canvas. |
| 6 | "You know everything. Fill all 24 cells, ① → ⑥ in order. Finish it!" | The puzzle is solved (`path.length === 24`). Persistent glow is off for this step; the Hint button still works normally. |

## Tutorial state & events

One module-level object: `tut = { active, step }` plus an array of step
definitions `{ text, onEnter(), done(evt) }`.

Existing input paths emit one-line notifications:

- `tutNote('rotate')` — cube pointermove in rotate mode once `cMoved` is true
- `tutNote('extend', src)` — successful `tryExtend`, with `src` = `'cube' | 'net'`
- `tutNote('undo')` — `popOne()` / `truncateTo()`
- `tutNote('win')` — `userWin()`

`tutNote` is a no-op when `tut.active` is false.

## Banner UI

One new DOM element overlaying the top-center of `#cubePane`: step text,
six progress dots, and a **Skip** button. Styled entirely with existing tokens
(`--card`, `--card-ink`, `rgba(var(--fg-rgb),.NN)`) so both themes work with
zero JS color code. Visible only while `tut.active` (gated by a `body.tut`
class, same pattern as `.playOnly`/`.solverOnly`).

A small `?` button joins the header next to the theme toggle and replays the
tutorial anytime.

## Trigger & persistence

- Auto-start on boot when **both**: no `zipcube.tutorial` key in
  `localStorage`, and the page was not opened via a challenge link
  (`#z=...` visitors were invited to race — don't hijack).
- Finishing or skipping sets `localStorage['zipcube.tutorial'] = 'done'`
  (wrapped in try/catch like the existing challenge store).
- `?` replay: drops any armed challenge (`dropChallenge()`), loads the
  tutorial board, starts at step 1.

## Escapes & conflicts

- **Skip button, solver mode, Challenge, New puzzle** mid-tutorial → tutorial
  ends (counts as done: flag set, banner removed, glow cleared). New puzzle /
  Challenge then behave exactly as today; solver entry proceeds normally.
- **Reset** mid-tutorial → path back to `[startCell]`; tutorial rewinds to
  step 2 if it was past step 2 (step 1 stays at step 1).
- **Hint button** stays functional during the tutorial (redundant with the
  glow, harmless).
- On tutorial finish (step 6 solved), the normal win overlay shows; its
  "New puzzle" button generates a fresh random board as usual.

## Error handling

- Corrupt/absent localStorage → treated as first visit (try/catch, same as
  challenge store).
- Hardcoded tutorial code failing `decodeCode` is impossible by construction
  (it is validated at implementation time), but the loader falls back to
  `makePuzzle()` if it ever returns null, and the tutorial still runs.
- Deviation from the guided line is allowed everywhere; the glow recomputes.
  Steps never hard-block free play — they only watch for their completion
  condition.

## Testing

- Extend the read-mostly `window.__zip` debug hook with
  `tut: () => ({active, step})` and `startTutorial()`, so the project's
  headless verify flow can drive every step and assert progression
  (rotate → extend → reach 2 → undo → net-extend → solve).
- Manual browser pass for banner layout (both themes), touch drag feel, and
  the challenge-link no-hijack rule.
