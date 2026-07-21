# Boot Fold-In Animation — Design

**Date:** 2026-07-21
**Status:** Approved

## Goal

A branded opening moment on every page load: the 3D pane opens on the flat
cross-net, face-on to the camera, and over ~1.1s the net folds up into the
cube — a physically true hinged fold — then settles into the familiar rest
pose. Pure delight, not teaching. It never blocks input and never gates a
visitor.

Chosen over alternatives (self-playing demo, animated tutorial steps,
promo clip) because the app already has a hands-on tutorial; the gap was a
brand moment. The fold concept was chosen because cube ⇄ net is the app's
identity, and the flat cross visually echoes the mini net-map below the pane.

## Trigger and duration

- Plays on **every page load** — including `#z=` challenge links and
  tutorial auto-start (banners simply overlay it).
- Total ≈ **1.1s**, non-blocking.
- **Any pointerdown snaps to the final state** and the input proceeds
  normally (a visitor who immediately drags just plays).
- **`prefers-reduced-motion` skips it entirely** (the existing `reduce`
  flag).
- Does **not** replay on New puzzle, theme change, or mode switch.

## Timeline (eased, times from load)

| Phase | Window | What happens |
|---|---|---|
| Hold | 0–150ms | Flat cross face-on, group scaled so the 8×6-tile cross fits the pane (start scale computed from pane aspect at runtime) |
| Fold | 100–750ms | U/D/L/R faces hinge 90° backward about their shared edges with F; B folds through R's hinge then its own (nested chain). Slight stagger between arms |
| Settle | 500–900ms | Cube group slerps from face-on to rest orientation `Euler(0.42, −0.62, 0)`; group scale eases to 1; body box scales in from zero (a folding net has no interior; scale, not opacity — Lambert transparency is not worth the sorting risk) |
| Badges | 750–1050ms | Badges pop ①→⑥ in sequence, scale-from-zero with small overshoot |
| Done | ~1100ms | Exact original transforms restored, `pathGroup` unhidden, `viewsDirty=true` draws the start dot / restored path |

## Mechanics

- One boot-only timeline variable ticked in the existing render `loop()`,
  same pattern as the `orient` tween.
- **Stateless per-frame transforms:** each frame computes every tile's
  pose from its canonical cube pose — flat pose derived from `c.net`
  (F fixed on the z=+1 plane, arms unrolled around it), then hinge-chain
  rotations at the current fold angle. Never accumulates.
- Badges ride their face's transform (same hinge chain, badge offset).
- No reparenting, no scene-graph changes. When the timeline ends, meshes
  are bit-identical to today's boot state.
- Small refactor: the body box (`new THREE.Mesh(BoxGeometry…)` currently
  added inline) gets a `bodyMesh` variable so it can be hidden/faded.
- `pathGroup.visible=false` during the fold; restored on completion.
  `drawCubePath` may run mid-fold via `viewsDirty` — visibility persists
  regardless.

### Hinge tree (net layout: L F R B strip, U above F, D below F)

- F: fixed on the z=+1 plane.
- L, R, U, D: one hinge each, the shared edge with F.
- B: two hinges — R's hinge, then B's own edge with R.

## Robustness

- `document.fonts.ready` rebuilds badges mid-fold on slow connections —
  harmless because transforms are recomputed statelessly each frame.
- Theme switching retints materials, never transforms — no interaction.
- Interrupted-run path restore at boot: the restored path simply appears
  when the fold completes (pathGroup unhide + viewsDirty).
- Portrait/mobile: start scale derives from live pane dimensions, so the
  cross fits above the reserved net strip.

## Verification

- Node-based check of the fold math: extract/port the hinge-chain
  transform and assert tiles land exactly at canonical poses at t=1 and
  at the flat net layout at t=0. **No headless Chrome on this machine** —
  final visual sign-off via user screenshots.

## Scope

~100–130 lines inside the existing IIFE in `index.html`, zero new
dependencies, zero server changes.
