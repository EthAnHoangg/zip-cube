# Play-Mode Hint — Design

Date: 2026-07-14 · Status: approved (next-cell hint + dead-end walk-back)

## Behavior

- **💡 Hint button** in the play footer row (playOnly; hidden in solver mode). Free,
  unlimited, counted — the win card appends "with N hints" when N > 0. Counter resets
  on New puzzle.
- **Solvable position:** highlight the correct next cell for ~2.5s with a mint
  "go here" tint on both the cube tile and the net (both render through `tileColor`,
  so one state covers both views). Log: `💡 try the glowing cell`.
- **Dead end:** walk back — `solveFrom(path.slice(0,k))` for shrinking k — to the
  last solvable prefix; highlight that cell (tap-to-truncate composes as the undo)
  and log `💡 dead end — undo N moves`. Prefix of length 1 is always solvable by
  construction.
- Hint highlight expires on timeout or is cleared when the path extends.

## Engine

`solveFrom(base)`: recursive DFS returning the full solution path or null. Same rules
as the solver's `dfs` (checkpoint order, N-last, `connectedOK` connectivity prune),
no event/tree bookkeeping, 200k-node budget → null (treated as "no hint"). Hint cell
= `solution[path.length]`. Estimated latency ≈ 0.5–2 ms typical (measured during
verification via synchronous button-press timing).

## Rendering

New token pair `--tile-hint` (dark `#a5e3bd`, light `#7ccf9e`) read into `T.tileHint`.
`tileColor` priority: flash (bad) → on-path → hint → heat ramp.

## Verification

Headless driver solves an entire puzzle using only hints: press Hint, locate the mint
cell by reading net-canvas pixels at the 48 grid centers, tap it, repeat to the win
overlay. Reports real per-press latency. Zero-error smoke throughout.
