# How the Puzzle Generator and the Solver Work

This document explains the two algorithmic hearts of `index.html`:

1. **Puzzle generation** — `hamiltonianPath()` + `makePuzzle()` (lines ~257–301)
2. **The solver** — `connectedOK()` + `buildTrace()` + trace playback (lines ~480–648)

Both operate on the same 24-cell graph, so we start there.

---

## 0. The board is a graph

The cube surface is divided into 24 cells: 6 faces × a 2×2 grid. Adjacency is
computed geometrically at startup (lines 187–205): each cell stores the 3D
coordinates of its four *edge midpoints*, and any two cells that share a
midpoint are neighbors. Because midpoints on a cube edge are shared between
cells on *different faces*, adjacency wraps around the cube automatically.

The result is a **4-regular graph**: every one of the 24 cells has exactly
4 neighbors — 2 on its own face, 2 across a cube edge.

```
Each cell:          Graph properties:
      ┌───┐           vertices  24
   ───┤ c ├───        degree    4 (every cell)
      └───┘           edges     48
   2 same-face        highly symmetric → Hamiltonian
   2 across an edge   paths are plentiful
```

The puzzle rule set (LinkedIn-Zip style):

- The path starts on checkpoint **1** and must visit checkpoints
  `1 → 2 → … → N` (N = 6) **in order**.
- The path must cover **all 24 cells** exactly once (a *Hamiltonian path*).
- Checkpoint **N must be the very last cell** (the 24th).

---

## 1. Puzzle generation

### 1.1 The key idea: generate the answer first

`makePuzzle()` never has to check "is this puzzle solvable?" — it works
backwards:

```
1. Find a random Hamiltonian path over all 24 cells   (the hidden solution)
2. Drop N numbered checkpoints along that path
3. Show the player only the checkpoints
```

Since the checkpoints were sampled *from* a valid full path in increasing
order, at least one solution always exists by construction.

### 1.2 `hamiltonianPath()` — randomized DFS with Warnsdorff's heuristic

Finding a Hamiltonian path is NP-hard in general, but this graph is small,
regular, and symmetric, so a heuristic random walk finds one almost instantly.
The function makes up to **60 attempts**; each attempt gets a budget of
**4,000 steps**:

```
attempt:
  start ← random cell
  path ← [start]
  loop until path has 24 cells (or budget exhausted):
    options ← unvisited neighbors of the path head
    if options is empty:              ← dead end
        pop the head off the path      (single-step backtrack;
        mark it unvisited              the RNG makes the retry diverge)
    else:
        shuffle options                (Fisher–Yates)
        sort options by ascending "degree"
             = how many unvisited neighbors each option has
        75% of the time: take the minimum-degree option
        25% of the time: take a uniformly random option
```

Two ingredients matter here:

- **Warnsdorff's rule** (the degree sort): always prefer the neighbor with
  the *fewest* remaining exits. Intuition: a cell with only one unvisited
  neighbor left will become an unreachable dead end unless you consume it
  now. This greedy rule alone solves knight's-tour-style problems most of
  the time.
- **Randomness on top** (the shuffle + the 25% random pick): pure Warnsdorff
  is deterministic and can loop into the same trap forever; the noise makes
  every puzzle different and lets the retry budget escape bad regions.

The backtracking is deliberately shallow — pop one cell and re-roll — because
restarting cheaply beats implementing a full backtracking search here. On this
graph the function essentially never exhausts its 60 attempts. (Note: the
caller does not handle a `null` return; if it ever failed 60 times the app
would crash. In practice it doesn't.)

### 1.3 `makePuzzle()` — placing the checkpoints

Given the solution path `sol` (24 cell ids in visit order), it picks N = 6
indices into that path:

```
idxs[0]   = 0                     checkpoint 1 = path start
idxs[k]   ≈ round(k · 23/(N−1))   evenly spaced along the path…
            clamped to ≥ prev+2   …but at least 2 apart, so consecutive
            and       ≤ 21           checkpoints are never adjacent cells
idxs[N−1] = 23                    checkpoint N = path end (forced last cell)
```

For N = 6 the ideal spacing is indices `0, 5, 9, 14, 18, 23` — roughly every
4–5 cells, so the player must reconstruct a 3–4 cell corridor between each
pair of consecutive numbers.

Then it:

- writes `c.num` on the chosen cells and builds `numByCell` (cell id →
  checkpoint number) — the only lookup the game/solver ever needs;
- creates the 3D number badges (canvas-texture sprites) on those cells;
- sets `startCell = sol[0]` — the player's path always begins there;
- **re-shuffles every cell's `c.order`** (the order in which the solver will
  try that cell's neighbors). This has no effect on gameplay but makes each
  puzzle produce a *different-looking* solver trace and search tree.

The full solution path itself is then thrown away — only the checkpoints
survive. The solver genuinely re-searches; it does not replay `sol`.

---

## 2. The solver

### 2.1 Architecture: search first, animate later

The solver never runs during animation. `buildTrace()` executes the **entire
DFS synchronously** and records every decision as an event in a flat array;
the render loop then replays those events at whatever speed the slider asks
for. This decouples search cost from frame rate and makes Step / Replay /
speed-change trivial (they're just pointer manipulations on the event list).

```
 rebuildTrace()                            rAF loop
┌──────────────────────┐   trace[]   ┌─────────────────────┐
│ buildTrace(prune,    │ ──────────► │ applyEvent(trace[ptr++])  │
│   basePath)          │  [t, cell]  │   × evPerSec·dt per frame │
│  full DFS, capped    │             │ mutates path/heat/tree    │
└──────────────────────┘             └─────────────────────┘
```

Event encoding (`[type, cellId]`):

| type | meaning     | playback effect                                   |
|-----:|-------------|---------------------------------------------------|
| 0    | push        | extend `path`, bump `heat[cell]`, add tree node   |
| 1    | backtrack   | pop `path`, close tree node as *backtracked*      |
| 2    | prune       | pop `path`, close tree node as *pruned*           |
| 3    | solved      | mark tree spine as *solution*, recolor path green |
| 4    | exhausted   | stop; message depends on capped / no-path         |

The trace is capped at `CAP = 120,000` events so a pruning-disabled run on a
hostile position can't freeze the tab or eat unbounded memory.

### 2.2 Solving *from the player's position*

When the user switches to solver mode, the current hand-drawn path is
snapshotted into `basePath`, and the DFS starts from its head with
`visited = Set(basePath)`. The expected next checkpoint is derived by
`nextExpected()`: the highest checkpoint number already on the path, plus
one. Two edge cases short-circuit before any search:

- `basePath` already has 24 cells → emit a single *solved* event;
- the player has already disconnected the remaining cells → emit a single
  *exhausted* event ("no path from your position — undo a few moves").

### 2.3 The DFS core

```
dfs(head, expected, depth):
  if depth == 24: SOLVED
  for nb in cells[head].order:            ← the shuffled neighbor order
    if nb already visited:      skip
    if nb is numbered and its number ≠ expected:   reject  (order rule)
    if nb is checkpoint N and depth ≠ 23:          reject  (N-last rule)
    visited += nb;  emit push(nb)
    if pruning and not connectedOK(visited, nb):
        emit prune(nb); visited −= nb; continue
    if dfs(nb, expected+1 if numbered else expected, depth+1): return true
    visited −= nb;  emit backtrack(nb)
```

Note the two *reject* cases produce **no event at all** (they only bump a
counter). Rejections are constraint checks, not search work — leaving them
out keeps the trace and the search tree showing only genuine exploration.

### 2.4 The pruning rule: connectivity check

`connectedOK(visited, head)` is the one "smart" part of the search, and it's
just a flood fill:

```
Every unvisited cell must be reachable from the current head
through unvisited cells only. If not — some region is walled off —
no Hamiltonian completion can exist, so cut this branch immediately.
```

Implementation: seed a stack with the head's unvisited neighbors, flood
across unvisited cells counting what's reached, and compare that count with
the total number of unvisited cells. Cost is O(24) with a `Uint8Array` seen
set — practically free.

Why it's so effective: without it, the DFS only discovers a walled-off
region after exhaustively failing to complete the path — an exponentially
large subtree. With it, that entire subtree collapses into a single ✂ prune
event one step after the fatal move. That's exactly what the "pruning"
checkbox demonstrates: toggle it off and watch the pushes/backtracks counters
explode (often into the event cap).

It is a *necessary* condition, not a *sufficient* one — connectivity can hold
while the position is still hopeless (e.g. the remaining region has the wrong
shape to be threaded in one pass), so the solver still backtracks; it just
backtracks vastly less.

### 2.5 Playback and the three counters

`resetPlayback()` rewinds: `path = basePath`, heat cleared, tree rebuilt with
just the root. Each animation frame consumes `evPerSec() · dt` events, where
the speed slider maps **logarithmically** to ≈ 2 … 6,300 events/second
(`10^(0.3 + 3.2·v/100)`), so the low end is single-step-watchable and the
high end finishes six-figure traces in seconds.

The HUD counters (`pushes / backtracks / prunes`) are live tallies from
`applyEvent`, and the tile **heat map** is `heat[cell]++` on every push,
rendered as ivory→burnt-orange on a log scale — after a run you can literally
see which part of the cube the search churned on.

`rebuildTrace()` re-runs the whole search whenever the starting conditions
change: entering solver mode, toggling the pruning checkbox, or generating a
new puzzle.

---

## 3. Why this design hangs together

- **Generate-from-solution** makes solvability a non-issue and costs
  microseconds.
- **Trace-then-replay** turns an exponential algorithm into a scrubbing-
  friendly animation with a hard memory/CPU ceiling (`CAP`).
- **Per-puzzle shuffled `c.order`** means the educational visualization
  (search tree, heat map) is fresh every time even on similar puzzles.
- The single pruning rule is cheap, easy to visualize, and dramatic — a good
  pedagogical proxy for "constraint propagation beats brute force".
