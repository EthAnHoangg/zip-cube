# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Zip Cube — a LinkedIn-Zip-style puzzle played on the surface of a 3D cube, plus an animated DFS solver visualization. The client is one self-contained file, `index.html`: inline CSS, inline JS (one IIFE), no build step, no tests, no package manager. The only dependency is Three.js r128 loaded from a CDN, so the page needs network access on first load. The single exception to "static site" is `api/leaderboard.js`, a zero-dependency Vercel serverless function (see Leaderboard below).

## Running

Open `index.html` directly in a browser, or serve the directory (e.g. `python3 -m http.server`) and open it. Verify changes manually in the browser; the UI is touch-first (pointer events, `touch-action:none`), so test drag interactions with a mouse or device emulation.

## Architecture

All state and logic live inside the single IIFE in the `<script>` block. The board is the 24 cells of a cube's surface (6 faces × 2×2). The goal is a Hamiltonian path over all 24 cells that visits the numbered checkpoints 1..N (N=6) in order.

### Cell model (the foundation everything shares)

- `cells[]` (24 entries) is built geometrically: each cell has a `center` and `normal` Vector3. Adjacency (`nbrIds`) is derived by hashing edge-midpoint coordinates (`midMap`) — two cells sharing a midpoint are neighbors, which makes adjacency work seamlessly *across cube edges*, not just within a face.
- Each cell also carries its 3D mesh (`c.mesh`, `c.badge`), its 2D net coordinate (`c.net` via `netCoord()`, a cross-shaped unfolding into an 8×6 grid), and a randomized neighbor order (`c.order`) used by the solver so traces differ per puzzle.

### Design tokens (theming)

Every color is a semantic CSS custom property on `:root` (dark) overridden by `body.light` — including the 3D/canvas colors (`--cube-body`, `--tile*`, `--path*`, `--badge-*`, `--tree-*`). JS never hardcodes a color: `readTokens()` caches the tokens into `T` (THREE.Color for 3D, strings for canvas) once per theme switch, and `applyTheme()` retints materials, rebuilds badge textures (`rebuildBadges()` — colors are baked into canvas textures), and marks views dirty. Alpha-composed colors use triplet tokens (`rgba(var(--fg-rgb),.NN)`). Surface chrome (buttons, chips, panels) uses `--btn-bg`/`--btn-border`/`--chip-border`/`--lift`: frosted glass in dark, elevated white with shadows in light — a light theme needs opaque surfaces, not translucency. Adding a theme = one CSS override block, zero JS changes. Mode switching must use `classList` (not `className=`) so the `light` class survives.

### Typography

Three Google Fonts with strict roles: **Ubuntu Sans** (400/500/700) for all UI text and canvas-baked labels (cube badges, net numbers/face letters), **Ubuntu Mono** (400/700) for data — stat values, `#logline`, leaderboard times, puzzle codes, tree-canvas labels — and **Bungee** for display only (wordmark, card titles). Sans and mono are sibling families; keep that pairing if swapping. Text baked into canvases (`badgeTexture()`, net/tree draw calls) hardcodes the family in `ctx.font` strings — a font change must touch those too, and boot re-bakes them once via `document.fonts.ready` since webfonts arrive after first paint.

### Two modes, shared state

`mode` is `'play'` or `'solver'`; `document.body.className` mirrors it and CSS (`.playOnly`/`.solverOnly`) swaps the UI. The current path is `path[]` (array of cell ids). Entering solver mode snapshots the player's path into `basePath` and the solver searches *from that position*; returning to play mode restores `basePath` untouched.

### Solver = precomputed trace + playback

`buildTrace()` runs the full DFS synchronously up front (capped at `CAP` events) and emits an event list: `[0,id]` push, `[1,id]` backtrack, `[2,id]` prune (connectivity check `connectedOK()`), `[3,id]` solved, `[4,id]` exhausted/capped. The animation loop then replays events at a speed-slider rate via `applyEvent()` — rendering never runs the search itself. Toggling pruning or changing the puzzle calls `rebuildTrace()`.

### Three synchronized views, one dirty flag

1. **3D cube** (Three.js): tiles, number badges (canvas textures), and the path drawn as cylinders/spheres in `pathGroup` with an *unlit* material (`MeshBasicMaterial`) so the cord reads as drawn ink, not lit plastic; edge-crossing segments bend through the shared midpoint (`sharedMid`).
2. **Net mini-map** (2D canvas `#netCanvas`): same state drawn on the unfolded cross; non-adjacent-on-net jumps render as dashed curves.
3. **Search tree** (2D canvas `#treeCanvas`, solver only): flat parallel arrays (`nSlot/nDepth/nParent/nCell/nState/nKids`) instead of node objects for performance; leaf-slot x-layout, viewport culling via `lowerBound`, and point decimation when >15k visible nodes.

Setting `viewsDirty=true` redraws cube tiles + net on the next frame; `treeDirty` throttles tree redraws (≥50ms apart). When touching shared state (path, heat, flash), set the flag rather than drawing directly.

### Input

Three separate pointer handlers (cube, net, tree). On the cube and net, dragging from the path head extends the path ("draw"), dragging elsewhere rotates the cube (net: no-op); a tap on a visited cell truncates the path back to it. The tree canvas supports pan, pinch-zoom, and wheel-zoom, and auto-follows the search head unless the user pans.

### First-time tutorial

A six-step interactive tutorial (`tut`/`TUT_STEPS`/`tutNote`) layered on play mode. Input handlers emit `tutNote(t, id, src)` events (`'rotate'|'extend'|'undo'|'win'`, `src` `'cube'|'net'`); each step's `done(evt)` predicate advances the machine, and `skipIf()` lets a step auto-skip if already satisfied. Glow steps reuse the `hint` mechanism with `until:Infinity` (recomputed via `solveFrom` after every move) plus `faceCell()` auto-turn. The board is a fixed puzzle code (`TUT_CODE`) loaded through `decodeCode()`/`applyPuzzle()`. The banner UI is gated by a `body.tut` class. Auto-starts on boot only when the `zipcube.tutorial` localStorage key is absent *and* the page wasn't opened via a challenge link; finishing or skipping sets the key. Solver entry, Challenge, and New puzzle all call `tutEnd()`; Reset rewinds to step index 1. The `?` header button replays via `tutStart()`. Debug hooks: `__zip.tut()`, `__zip.startTutorial()`, `__zip.glow()`.

### Leaderboard (per-challenge, opt-in)

`api/leaderboard.js` is the only server code: a CommonJS Vercel function with zero npm dependencies (no `package.json` — it uses only Node globals). Storage is one Upstash Redis hash per challenge code (`lb:{code}`, field = deviceId, value = JSON record, 90-day TTL, 200-entry cap), reached via Upstash's REST pipeline API with `fetch`; credentials come from `UPSTASH_REDIS_REST_URL`/`_TOKEN` (or the `KV_REST_API_*` names the Vercel marketplace integration injects) — unset means every request returns 503. POSTs are validated server-side against a **hardcoded `NBR` adjacency table** that mirrors the client's cell geometry (same construction order → same ids); if the cell construction in `index.html` ever changes, regenerate the table. A submission must include the winning 24-cell path visiting the code's checkpoints in order, so scores can't be posted without a real solution (times remain client-claimed by design). `module.exports.__test` exposes the pure validators for node-based tests.

Client side: `zipcube.player` in localStorage holds `{deviceId, name}`; publishing is opt-in — the win overlay's `#lbPanel` offers an inline nickname input (never `window.prompt`) on the first challenge win, and once a name is stored, solved challenge runs auto-POST `{first, best, attempts, path}`. Boards render in the win card and in the `#lbView` overlay (🏆 button, visible while a challenge is armed), ranked by first-try time (DNFs after solved). All fetches have a 5s abort and degrade to a "leaderboard unavailable" note; the game never blocks on the network.

### Puzzle generation

`makePuzzle()` finds a random Hamiltonian path (`hamiltonianPath()`, randomized Warnsdorff-ish DFS with restarts), then places N numbered checkpoints along it at roughly even indices. `numByCell` maps cell id → checkpoint number; `startCell` is checkpoint 1.
