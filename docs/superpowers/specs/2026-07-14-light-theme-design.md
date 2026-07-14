# Light Theme + Design Tokens — Design

Date: 2026-07-14 · Status: approved (Approach A, full retheme, manual toggle)

## Goal

Add a light theme to `index.html` and refactor all color usage — CSS rules,
Three.js materials, badge textures, net/tree canvas draws — onto a single design-token
layer so additional themes are one CSS block away.

## Token architecture

Semantic CSS custom properties on `:root` (dark defaults) overridden by `body.light`.
No raw color literal survives outside these two blocks.

- **Solid tokens** (hex, parseable by `new THREE.Color`): surfaces `--bg-hi/--bg-lo/--card/--card-ink/--card-sub`;
  ink `--text/--log/--accent/--accent-ink/--ok`; 3D `--cube-body/--tile/--tile-path/--tile-hot/--tile-bad`;
  path `--path/--path-solved/--head-ring`; badges `--badge-bg/--badge-ink`;
  tree `--tree-active/--tree-back/--tree-prune/--tree-sol/--tree-num`.
- **Alpha triplets** for the many `rgba(...,.NN)` literals: `--fg-rgb`, `--panel-rgb`,
  `--ok-rgb`, used as `rgba(var(--fg-rgb),.16)` so each theme swaps the triplet while
  alphas stay in place.

## JS integration

- `readTokens()`: one `getComputedStyle(document.body)` pass caches tokens into `T`
  (THREE.Color for 3D, strings for canvas). Called at boot and on toggle; draw code
  reads `T.*` — no per-frame style reads.
- `applyTheme()`: `readTokens()` → retint `bodyMat`, `pathMat` (respecting solved
  state) → `rebuildBadges()` (colors baked into canvas textures) → mark views dirty.
- **Badge refactor**: badge creation/disposal extracted from `makePuzzle()` into
  `rebuildBadges()` so themes can regenerate badges without a new puzzle.
- **Fix**: `setMode()` used `document.body.className=...`, which would wipe the
  `light` class → switched to `classList`.

## UI

☀/🌙 button in the header (grouped with the stat chips). Starts dark each load;
no persistence (explicit choice). Click toggles `body.light` + `applyTheme()`.

## Light palette

Warm paper inversion: cream gradient `#f7f0dd→#e8ddc0`, felt-green as ink `#0d3531`,
panels translucent cream with ink borders. Cube keeps its identity (dark body, ivory
tiles, tangerine path). Contrast adjustments: logline → burnt sienna, `--ok` → deeper
green, tree backtracked/pruned/solution nodes darkened, head ring darkened.

## Testing

Per `.claude/skills/verify/SKILL.md`: headless-Chrome drive — toggle theme, screenshot
dark + light, run play & solver flows in light mode, assert zero JS errors and that
mode switches preserve the `light` class.
