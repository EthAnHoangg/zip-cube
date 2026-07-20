# Mobile Layout Fixes — Design

**Date:** 2026-07-21
**Scope:** Critical + High + Medium findings from the mobile UI/UX audit (portrait-phone screenshot, play mode). Explicitly out of scope: logline two-line wrap, solver-mode dock layout (needs a solver screenshot first).

## Problem

On portrait phones the cube is drastically oversized: ~70% of the board renders off-screen, including the next required checkpoint. Root cause: the camera sits at a fixed distance (`camera.position.set(0,0,6.2)`, `index.html:398`) tuned for landscape aspect. Three.js `PerspectiveCamera.fov` is *vertical*; on a narrow pane the horizontal view cone shrinks and `sizeCube()` only updates `camera.aspect`, never the distance. Secondary issues: the net mini-map overlays the board with ~21px playable cells, several touch targets are under the 44px guideline, and the fixed `height:100%` viewport misbehaves with mobile URL-bar collapse.

## Fixes

### 1. Aspect-aware camera fit (Critical)

In `sizeCube()`, dolly the camera so the cube's bounding sphere fits the smaller of the two view cones, preserving today's desktop framing exactly:

```
vHalf = fov/2 (19°)
hHalf = atan(tan(vHalf) · aspectUsable)
dist  = 6.2 · max(1, sin(vHalf)/sin(hHalf))   // wide panes stay at 6.2
```

`aspectUsable` uses the pane width and the *usable* height (see fix 2). `camera.aspect` still uses the real pane dimensions. Nothing else in the codebase writes `camera.position`, so this is the single point of change; raycasting (`ray.setFromCamera`) reads the live camera and needs no updates.

### 2. Reserve a net strip on portrait; bias the cube upward (High)

After fitting, a square-ish cube floats centered in a tall pane and the absolutely-positioned `#netPane` overlaps its lower-right tiles. On portrait play mode (`pane aspect < 1`, `mode === 'play'`):

- Compute `reserve` = the compact net's footprint height, derived from the compact CSS width formula for the current breakpoint (58% under 480px, else 46%, capped at 250px; height = width · 6/8, plus the 10px bottom offset and a small gap). Derived from the formula, not `clientHeight`, so the expanded (`.big`) net never feeds back into layout.
- Fit the cube against `(w, h − reserve)` instead of `(w, h)`.
- Shift the whole scene up by `reserve/2` pixels converted to world units at the cube's distance (`worldPerPx = 2·dist·tan(vHalf)/h`; set `sceneG.position.y`). Cube rotation is around the cube group's own origin and raycasting works in world space, so both are unaffected.
- Landscape / solver mode: `reserve = 0`, `sceneG.position.y = 0` — desktop rendering is bit-identical to today.

### 3. Wider compact net on small screens (High)

`#netPane` width `min(46%,250px)` → `min(58%,250px)` under `@media (max-width:480px)`. Playable cells go from ~21px to ~27px on a 375px phone. The `.big` expanded state stays `min(92%,460px)`.

### 4. Touch-target bumps under `@media (pointer:coarse)` (Medium)

- `.iconKey`: 34px → 40px square (icon stays 15px).
- `.key.door`: width 40px → 44px.
- `#netExpand`: padding up to a ≥32px square hit area.
- `.key` vertical padding 9px → 11px (≥40px tall keycaps).

All existing rows are `flex-wrap`, so nothing breaks if a row gets tighter.

### 5. Viewport height + safe area (Medium)

- `body`: `height:100%` → `height:100%; height:100dvh` (fallback then override; browsers without `dvh` keep today's behavior).
- Viewport meta: add `viewport-fit=cover` so the existing `env(safe-area-inset-bottom)` footer padding actually resolves on notched phones.

### 6. Stat-chip value bump on small screens (Medium)

`.stat b` 12.5px → 14px under `@media (max-width:480px)`. Labels and header structure unchanged — "next" stays a chip; no header restructuring (it was just redesigned).

## Non-changes (deliberate)

- `user-scalable=no` stays: pinch-zoom would fight the rotate/draw gestures.
- No orthographic camera, no cube geometry scaling — preserves depth feel and badge scale.
- Net stays an overlay panel; no layout reflow of `#cubePane`.

## Addendum (same day): deferred Low items, brought into scope

After screenshot verification of the core fixes, the two deferred items were requested:

- **Logline two-line wrap (≤480px):** `white-space:normal` with `-webkit-line-clamp:2` and a *fixed* 35px height. Fixed, not auto: pane heights derive from the flex column, and a growing logline would shrink `#cubePane` without firing the `resize` handler that re-sizes the canvases.
- **Solver dock 3 → 2 rows (≤480px):** the pruning+speed group and the doors group share one row by trimming ~40pt: speed's "slow/fast" text labels hidden (`font-size:0` on `.speed`), slider 100→78px, and `#modeBtn` shows a short "Back" label (new `.backShort` span) instead of "Back to play". Doors keep `margin-left:auto`, preserving the stakes-position layout. On very narrow screens (~320px) the row may still wrap — graceful, via existing `flex-wrap`.
- **Solver net occlusion (found in solver screenshot):** the 58% compact-net width is scoped to `body.play`; solver uses 36%/160px on phones so the net stops covering the 40%-tall cube pane. `:not(.big)` keeps the expand state winning. The header `.hudSep` is hidden ≤480px where the HUD wraps.

## Verification

- Node script (scratchpad) replicating the fit formula across aspects: assert distance = 6.2 for aspect ≥ 1 and projected cube diameter ≤ usable pane at phone aspects (~0.5).
- Manual: user-provided portrait screenshots (no headless Chrome on this machine) — full board visible, net not covering tiles, desktop unchanged.
