# ZIP³ — Zip Cube

A [LinkedIn-Zip](https://www.linkedin.com/games/zip)-style path puzzle, lifted off the flat grid and wrapped around a **3D cube** — with a built-in **AI solver you can watch think**.

The entire game is one self-contained HTML file. No build step, no install, no framework beyond Three.js from a CDN. Open `index.html` in a browser and play.

---

## The puzzle

The cube's surface is divided into **24 cells** (6 faces × 2×2). Six of them carry numbered checkpoints.

**Draw one continuous path that:**

1. starts at checkpoint **1**,
2. visits **every** cell exactly once,
3. passes the checkpoints **in order** (1 → 2 → … → 6),
4. lands on **6** with its final step.

What makes the cube version interesting: the path flows *around edges and corners*. Two cells on different faces are neighbors if they share an edge — so a third of the board is always hidden behind the cube, and the geometry your intuition trusts on a flat grid quietly betrays you here.

Every puzzle is guaranteed solvable: the generator finds a random Hamiltonian path over the whole surface first (randomized DFS with Warnsdorff's heuristic), then drops the checkpoints along it and throws the solution away.

## Playing

| Action | Effect |
|---|---|
| **Drag from the path head** (glowing orb) | Extend the path cell by cell; drag back onto the previous cell to retract |
| **Drag anywhere else** on the cube | Rotate the cube |
| **Tap a visited cell** | Truncate the path back to that cell |
| **Tap an unvisited neighbor** of the head | Extend one step |
| **Net mini-map** (bottom-right) | The cube unfolded flat — fully interactive, draw on it too; `⤢` expands it |
| **Undo / Reset** | Pop one step / back to checkpoint 1 |
| **☀ / ☾** | Toggle light & dark theme |

Illegal moves flash red and tell you why (`reach 3 first`, `6 must be your last cell`). The mini-map is the answer to "what's behind the cube" — jumps that cross hidden geometry render as dashed arcs.

## The AI solver

Switch to **🤖 AI solver** at any moment and the solver picks up *from your current position* — it never touches your board; switch back and your hand-drawn path is exactly where you left it.

It runs a depth-first search with one classic pruning rule, and every decision is animated across three synchronized views:

- **The cube & net** — the path grows and retracts live; tiles accumulate a **heat map** (ivory → burnt orange, log scale) showing where the search churned.
- **The search tree** — every node is one push. Orange = current path, gray = backtracked, teal = **pruned**, green = the solution spine. Pan, pinch, scroll-zoom, or let it auto-follow the search head.
- **The counters** — pushes, backtracks, prunes, depth, and a progress bar over the whole trace.

### The pruning checkbox is the whole lesson

The solver's only "intelligence" is a connectivity check: after each step, flood-fill the unvisited cells — if any region got walled off, no Hamiltonian completion can exist, so the entire subtree collapses into a single ✂ event.

Toggle **pruning off** and watch the same puzzle balloon from a few hundred events to tens of thousands (capped at 120,000) as the search discovers each walled-off region the hard way. It's constraint propagation vs. brute force, made visible.

The search runs to completion **up front** and records a trace of events; the animation just replays it. That's why Step, Replay, and the log-scale speed slider (~2 to ~6,000 events/sec) are all instant and scrub-friendly.

## Theming

All colors — CSS chrome, Three.js materials, badge textures, both 2D canvases — resolve through **semantic design tokens** (CSS custom properties) defined once in `:root` and overridden per theme:

```css
body.light {
  --bg-hi:#f7f0dd; --text:#0d3531; --path-solved:#1f8a4d; /* … */
}
```

JS reads the tokens once per switch (`readTokens()` → cached `T` object), retints materials, and regenerates the number badges. **Adding a theme is one CSS block — zero JS changes.**

## Project layout

```
index.html                       the whole game (markup, styles, logic)
docs/puzzle-and-solver.md        deep dive: generator & solver algorithms
docs/superpowers/specs/          design docs
.claude/skills/verify/SKILL.md   headless-Chrome verification recipe
CLAUDE.md                        architecture notes for AI-assisted development
```

## Development

There is deliberately no build system. Edit the file, refresh the browser.

- **Syntax check:** extract the inline `<script>` and run `node --check` on it. (Some linters false-positive on `while(n-->0)` — it's valid JS; the HTML parser misreads `-->`.)
- **Runtime verification:** `.claude/skills/verify/SKILL.md` documents a headless-Chrome recipe that drives the real UI — button clicks, synthetic pointer events, screenshots — used to verify every change to this project.
- **Algorithm internals:** `docs/puzzle-and-solver.md` explains the generator (why Warnsdorff + noise), the trace/event encoding, and why the connectivity prune is cheap yet devastating.

### Engineering notes worth knowing

- **Adjacency is geometric.** Each cell hashes its four edge-midpoint coordinates; cells sharing a midpoint are neighbors. Face-to-face adjacency across cube edges falls out for free — no case analysis.
- **The search tree renders 100k+ nodes** on a phone by using flat parallel arrays instead of node objects, binary-search viewport culling, and point decimation past 15k visible nodes.
- **Rendering is flag-driven.** Nothing redraws unless `viewsDirty`/`treeDirty` is set; the tree throttles to 20 fps; the path-membership check uses a 24-byte mask rebuilt once per flush.

## License

No license file yet — all rights reserved by default. Add one if you intend to share or accept contributions.
