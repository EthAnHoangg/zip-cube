# Mobile Layout Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Zip Cube playable on portrait phones: auto-fit the cube to the viewport, stop the net mini-map from occluding the board, and bring touch targets / viewport handling up to mobile standards.

**Architecture:** All client changes live in the single `index.html` (inline CSS + one IIFE) per the project's no-build convention. The camera fix is a pure math change inside `sizeCube()`; layout fixes are additive CSS media queries; nothing else moves. Verification of the camera math is a throwaway node script (the formula is replicated, not imported — the IIFE can't be required).

**Tech Stack:** Vanilla JS + Three.js r128 (CDN), inline CSS. No build, no test framework, no package manager.

## Global Constraints

- Single-file client: all changes go in `index.html`; no new files except the committed spec/plan docs.
- Desktop/landscape rendering must be bit-identical: at pane aspect ≥ 1 the camera distance must remain exactly 6.2 and `sceneG.position.y` must be 0.
- JS never hardcodes a color; no color changes in this plan.
- Verification is node script + user-provided screenshots — **never launch headless Chrome on this machine** (it wedges).
- Spec: `docs/superpowers/specs/2026-07-21-mobile-layout-fixes-design.md`.

---

### Task 1: Aspect-aware camera fit with portrait net reserve

**Files:**
- Modify: `index.html:406-410` (`sizeCube()`)
- Test: `/private/tmp/claude-501/-Users-anhoang-Desktop-devzone-puzzle-zip-cube/73c8075e-efe5-4e5c-9138-7a78e3d54b34/scratchpad/fit-check.mjs` (throwaway, not committed)

**Interfaces:**
- Consumes: `pane`, `camera` (fov 38, position z 6.2), `sceneG`, `renderer` (all defined at `index.html:392-405`), `mode` (`let mode='play'` at `index.html:555`; `sizeCube()` first runs at line 1589, long after, so no TDZ).
- Produces: `sizeCube()` with unchanged signature/callers (lines 1274, 1284, 1513, 1589). Sets `camera.position.z` and `sceneG.position.y` as the only new side effects.

- [ ] **Step 1: Write the verification script (fails against current formula)**

Write `fit-check.mjs` in the scratchpad replicating the *new* formula, plus an oracle for the *old* behavior, and assert the new invariants:

```js
// fit-check.mjs — replicates sizeCube() math; run with: node fit-check.mjs
const FOV = 38, BASE = 6.2, R = Math.sqrt(3) * 1.01; // cube bounding sphere
const vHalf = (FOV / 2) * Math.PI / 180;

function fit(w, h, mode = 'play') {
  let reserve = 0;
  if (h > w && mode === 'play') {
    const netW = Math.min(w * (w <= 480 ? 0.58 : 0.46), 250);
    reserve = netW * 0.75 + 18; // net height (6/8 of width) + 10px offset + 8px gap
  }
  const hUse = Math.max(h - reserve, 120);
  const vUse = Math.atan(Math.tan(vHalf) * hUse / h);
  const hHalf = Math.atan(Math.tan(vHalf) * w / h);
  const m = Math.min(vUse, hHalf);
  const dist = BASE * Math.max(1, Math.sin(vHalf) / Math.sin(m));
  const worldPerPx = 2 * dist * Math.tan(vHalf) / h;
  return { dist, sceneY: reserve / 2 * worldPerPx, reserve, m };
}

let fail = 0;
const eq = (a, b, msg) => { if (Math.abs(a - b) > 1e-9) { console.error('FAIL', msg, a, b); fail = 1; } };
const ok = (c, msg) => { if (!c) { console.error('FAIL', msg); fail = 1; } };

// Desktop / landscape / solver pane: bit-identical to today
for (const [w, h] of [[1600, 900], [1200, 800], [900, 900], [800, 320]]) {
  const f = fit(w, h);
  eq(f.dist, BASE, `landscape ${w}x${h} keeps 6.2`);
  eq(f.sceneY, 0, `landscape ${w}x${h} no bias`);
}
eq(fit(375, 600, 'solver').dist, BASE * Math.max(1, Math.sin(vHalf) / Math.sin(Math.atan(Math.tan(vHalf) * 375 / 600))), 'solver portrait: fit but no reserve');
eq(fit(375, 600, 'solver').sceneY, 0, 'solver portrait: no bias');

// Portrait phones: sphere fits inside the limiting cone (margin ≥ 1.1 like desktop)
for (const [w, h] of [[375, 560], [320, 480], [430, 700], [390, 640]]) {
  const f = fit(w, h);
  ok(f.dist * Math.sin(f.m) >= R * 1.1, `portrait ${w}x${h} cube fits with margin (d·sin(m)=${(f.dist * Math.sin(f.m)).toFixed(3)})`);
  ok(f.reserve > 0 && f.reserve < h / 2, `portrait ${w}x${h} sane reserve ${f.reserve.toFixed(0)}`);
}

// The OLD behavior (fixed 6.2) must FAIL the portrait invariant — proves the bug
const hOld = Math.atan(Math.tan(vHalf) * 375 / 560);
ok(6.2 * Math.sin(hOld) < R, 'old fixed-6.2 camera really does crop the cube on 375x560');

console.log(fail ? 'FAILURES' : 'ALL OK');
process.exit(fail);
```

- [ ] **Step 2: Run it — confirm ALL OK and that the old-behavior line proves the crop**

Run: `node <scratchpad>/fit-check.mjs`
Expected: `ALL OK` (the script self-contains the new formula; the `old fixed-6.2` assertion documents the bug being fixed). If any FAIL prints, the formula constants are wrong — do not proceed.

- [ ] **Step 3: Replace `sizeCube()` in `index.html`**

Replace lines 406–410:

```js
  function sizeCube(){
    const w=pane.clientWidth, h=pane.clientHeight;
    camera.aspect=w/h; camera.updateProjectionMatrix();
    renderer.setSize(w,h);
  }
```

with:

```js
  function sizeCube(){
    const w=pane.clientWidth, h=pane.clientHeight;
    camera.aspect=w/h;
    // portrait play: reserve the compact net's strip so the cube sits above it
    let reserve=0;
    if(h>w && mode==='play'){
      const netW=Math.min(w*(w<=480?0.58:0.46),250);
      reserve=netW*0.75+18;
    }
    // dolly back so the cube fits the narrower of the two view cones (fov is vertical)
    const vHalf=camera.fov/2*Math.PI/180;
    const hUse=Math.max(h-reserve,120);
    const vUse=Math.atan(Math.tan(vHalf)*hUse/h);
    const hHalf=Math.atan(Math.tan(vHalf)*w/h);
    camera.position.z=6.2*Math.max(1,Math.sin(vHalf)/Math.sin(Math.min(vUse,hHalf)));
    camera.updateProjectionMatrix();
    sceneG.position.y=reserve/2*(2*camera.position.z*Math.tan(vHalf)/h);
    renderer.setSize(w,h);
  }
```

Notes for the implementer:
- `mode` is safe to read here: `sizeCube()` never runs before line 1589.
- The `58%/46%` and `0.75` (=6/8 aspect) constants mirror Task 2's `#netPane` CSS — if Task 2's widths change, change them here too.
- Shifting `sceneG` (not the camera) keeps rotation math and raycasting untouched: `ray.setFromCamera` intersects world-space meshes whose matrices include the shift.

- [ ] **Step 4: Sanity-check the file still parses**

Run: `node --input-type=module -e "import{readFileSync}from'fs';const s=readFileSync('index.html','utf8');const js=s.split('<script>')[1].split('<'+'/script>')[0];new Function(js);console.log('parses')"`
(from the repo root; extracts the inline IIFE and syntax-checks it — it must print `parses`.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Fit cube to viewport: aspect-aware camera dolly + portrait net reserve"
```

---

### Task 2: Mobile CSS — wider net, coarse-pointer touch targets, chip bump

**Files:**
- Modify: `index.html` — append two media-query blocks right after the existing `@media (prefers-reduced-motion:reduce)` block (lines 194–197), before `.speed` (line 198).

**Interfaces:**
- Consumes: existing selectors `.iconKey` (34px, line 70), `.key` (padding 9px 13px, line 157), `.key.door` (width 40px, line 169), `#modeBtn` (line 173) and `body.solver #modeBtn` (line 176, higher specificity — must be re-declared or solver mode's keycap goes short), `#netExpand` (line 118), `#netPane` (line 108), `.stat b` (line 98).
- Produces: `#netPane` compact width `min(58%,250px)` under 480px — Task 1's `sizeCube()` reserve constants assume exactly this.

- [ ] **Step 1: Add the media queries**

Insert after line 197 (`}` closing the reduced-motion block):

```css
  /* small screens: net big enough to play on, data readable at arm's length */
  @media (max-width:480px){
    #netPane{width:min(58%,250px)}
    .stat b,.stat b span{font-size:14px}
  }
  /* coarse pointers: every control at or near the 44px touch guideline */
  @media (pointer:coarse){
    .iconKey{width:40px;height:40px}
    .key{padding:11px 13px}
    .key.door{width:44px;padding:11px 0}
    #modeBtn,body.solver #modeBtn{padding:11px 13px}
    #netExpand{padding:10px 12px}
  }
```

- [ ] **Step 2: Verify the cascade beats the base rules**

Run: `grep -n "pointer:coarse" index.html` and confirm the block appears *after* lines 70/157/169/173/176 (equal-or-higher specificity later in the sheet wins; `body.solver #modeBtn` is repeated because its specificity beats a bare `#modeBtn`).
Expected: match at a line number > 197.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Mobile CSS: wider compact net, 44px-class touch targets, larger chip values"
```

---

### Task 3: Viewport height + safe area

**Files:**
- Modify: `index.html:5` (viewport meta), `index.html:55-60` (body rule)

**Interfaces:**
- Consumes: existing `html,body{height:100%;overflow:hidden}` (line 54) as the no-`dvh` fallback; existing footer `env(safe-area-inset-bottom)` padding (line 137) which is currently always 0 for lack of `viewport-fit=cover`.
- Produces: nothing downstream.

- [ ] **Step 1: Update the viewport meta**

Line 5, add `viewport-fit=cover`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

- [ ] **Step 2: Pin body to the dynamic viewport**

In the `body{...}` rule (lines 55–60), add one declaration (line 54's `height:100%` remains as the fallback for browsers without `dvh`):

```css
  body{
    font-family:'Ubuntu Sans',system-ui,sans-serif;
    background:radial-gradient(120% 90% at 50% 20%, var(--bg-hi) 0%, var(--bg-lo) 100%);
    color:var(--text); touch-action:none; user-select:none;
    display:flex; flex-direction:column;
    height:100dvh;
  }
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Mobile viewport: 100dvh with fallback, viewport-fit=cover for safe-area padding"
```

---

### Task 4: Push, PR, screenshot verification

**Files:** none (git/GitHub only)

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin mobile-layout-fixes
gh pr create --title "Mobile layout fixes: fit cube to viewport, playable net, touch targets" --body "..."
```

PR body summarizes the audit findings fixed (cube crop root cause, net reserve, touch targets, dvh/safe-area) and ends with the oh-my-agent attribution footer.

- [ ] **Step 2: Request screenshots from the user (no headless Chrome)**

Ask for: (a) portrait phone, play mode — full cube visible, net below it not covering tiles; (b) desktop — confirm framing unchanged; (c) optionally solver mode portrait for the deferred audit item. Iterate on the branch if anything is off.
