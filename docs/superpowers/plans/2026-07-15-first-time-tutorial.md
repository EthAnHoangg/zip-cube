# First-Time Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive 6-step tutorial that auto-starts for first-time visitors and teaches core play by making them perform real moves, per `docs/superpowers/specs/2026-07-15-tutorial-design.md`.

**Architecture:** A small step machine (`tut` state + `TUT_STEPS` defs) layered on the existing IIFE in `index.html`. Existing input handlers emit `tutNote()` events; highlights reuse the `hint` glow (held with `until:Infinity`) and `faceCell()` auto-turn; the board is a hardcoded puzzle code loaded through `decodeCode()`/`applyPuzzle()`. One banner DOM element gated by a `body.tut` class.

**Tech Stack:** Vanilla JS/CSS inside `index.html` (no build, no test framework). Verification via the project `verify` skill: headless Chrome drivers in the scratchpad that dispatch real pointer events and dump JSON results.

## Global Constraints

- Single self-contained file: all changes go in `index.html`; no new files in the repo except docs.
- Never hardcode a color in JS; use the CSS token system (`--card`, `--card-sub`, `--accent`, `rgba(var(--fg-rgb),.NN)`).
- Mode/theme classes must use `classList` operations, never `className=` assignment (the `light` and `tut` classes must survive mode switches).
- Touch-first: all interaction via pointer events; test drags with synthetic `PointerEvent`s and stubbed `setPointerCapture`.
- Headless runs need the rAF throttle in `<head>` (`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),80);`) or they time out.
- Chrome binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; flags `--headless=new --disable-gpu --enable-unsafe-swiftshader --user-data-dir=<scratch> --window-size=430,900 --virtual-time-budget=10000 --timeout=60000 --dump-dom`.
- Scratchpad for all temp drivers/copies (session scratchpad dir), never `/tmp`.
- Commit messages end with the oh-my-agent trailer.

---

### Task 1: Banner UI + tutorial step machine + input hooks + auto-start

**Files:**
- Modify: `index.html` (CSS ~line 53, header ~line 144, `#cubePane` ~line 148, `tryExtend`/`truncateTo`/`popOne`/`dragDraw`/`tapCell` ~lines 609–645, `userWin` ~line 646, cube pointermove ~line 1012, net handlers ~lines 1036–1057, controls ~line 936, boot ~line 1155, `__zip` ~line 1177)
- Test: scratchpad `t1-driver.html` + shell runs (not committed)

**Interfaces:**
- Produces: `tutStart()` (loads TUT_CODE board, activates tutorial at step 0), `tutEnd()` (deactivates, sets localStorage flag, clears persistent glow), `tutNote(t, id, src)` (no-op when inactive; `t` ∈ `'rotate'|'extend'|'undo'|'win'`, `src` ∈ `'cube'|'net'|undefined`), `tut` = `{active:boolean, step:number}` (step is 0-indexed 0–5), `window.__zip.tut()` → `{active, step}`, `window.__zip.startTutorial()`, `window.__zip.glow()` → current `hint.id`. Constant `TUT_CODE` (6-char base36 puzzle code).

- [ ] **Step 1: Capture a fixed tutorial puzzle code**

Copy `index.html` to the scratchpad as `dump.html`, injecting after `<head>`:

```html
<script>window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),80);</script>
```

and before `</body>`:

```html
<script>addEventListener('load',()=>{const p=document.createElement('pre');
p.textContent='PUZCODE='+window.__zip.code();document.body.appendChild(p);});</script>
```

Run headless Chrome with the global-constraint flags on `file://<scratch>/dump.html`, grep `PUZCODE=` from the dumped DOM. Record the 6-char code — it becomes `TUT_CODE`. Sanity: 6 chars, all `[0-9a-n]` (cell ids 0–23 in base36), no duplicates.

- [ ] **Step 2: Write the failing driver**

Create `<scratch>/t1-driver.html`: a copy of `index.html` with the rAF throttle in `<head>` and this driver before `</body>` (abridged to its skeleton here; the full driver implements the helpers as described):

```html
<script>
addEventListener('load', async () => {
  const R=[], say=(k,v)=>R.push([k,v]);
  const errs=[]; addEventListener('error',e=>errs.push(String(e.message)));
  Element.prototype.setPointerCapture=()=>{}; Element.prototype.releasePointerCapture=()=>{};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const Z=window.__zip;
  // net-pixel helper: replicate netPx() from page geometry
  const pane=document.getElementById('netPane'), nc=document.getElementById('netCanvas');
  function netPt(id){ const c=Z.cells.find(c=>c.id===id).net;
    const r=pane.getBoundingClientRect(), w=r.width, h=r.height;
    const cs=Math.min((w-12)/8,(h-12)/6), ox=(w-cs*8)/2, oy=(h-cs*6)/2;
    return {x:r.left+ox+(c.cx+0.5)*cs, y:r.top+oy+(5-c.cy+0.5)*cs}; }
  const pe=(el,type,x,y)=>el.dispatchEvent(new PointerEvent(type,{pointerId:1,clientX:x,clientY:y,bubbles:true}));
  async function netDrag(fromId,toId){ const a=netPt(fromId), b=netPt(toId);
    pe(nc,'pointerdown',a.x,a.y); await sleep(90);
    pe(nc,'pointermove',(a.x+b.x)/2,(a.y+b.y)/2); await sleep(90);
    pe(nc,'pointermove',b.x,b.y); await sleep(90); pe(nc,'pointerup',b.x,b.y); await sleep(90); }
  const head=()=>Z.state().path[Z.state().path.length-1];

  say('autostart', Z.tut().active && Z.tut().step===0);
  say('banner shown', getComputedStyle(document.getElementById('tutBanner')).display==='block');
  // step 0: rotate — drag on cube canvas from a corner (no tile => rotate mode)
  const cv=document.querySelector('#cubePane canvas'), cr=cv.getBoundingClientRect();
  pe(cv,'pointerdown',cr.left+5,cr.top+5); await sleep(90);
  pe(cv,'pointermove',cr.left+45,cr.top+40); await sleep(90);
  pe(cv,'pointerup',cr.left+45,cr.top+40); await sleep(90);
  say('rotate->step1', Z.tut().step===1);
  // step 1: extend to glow via net
  await netDrag(head(), Z.glow());
  say('extend->step2', Z.tut().step===2);
  // step 2: follow glow until checkpoint 2 reached
  for(let i=0;i<12 && Z.tut().step===2;i++) await netDrag(head(), Z.glow());
  say('reach2->step3', Z.tut().step===3);
  // step 3: undo
  document.getElementById('undoBtn').click(); await sleep(90);
  say('undo->step4', Z.tut().step===4);
  // step 4: extend via net to glow
  await netDrag(head(), Z.glow());
  say('net->step5', Z.tut().step===5);
  // step 5: finish using the solver
  for(let i=0;i<30 && Z.state().path.length<24;i++){
    const sol=Z.solution(); await netDrag(head(), sol[Z.state().path.length]); }
  say('solved', Z.state().path.length===24);
  say('tut done', Z.tut().active===false);
  say('flag set', localStorage.getItem('zipcube.tutorial')==='done');
  say('banner hidden', getComputedStyle(document.getElementById('tutBanner')).display==='none');
  say('no errors', errs.length===0 ? true : errs.join('|'));
  const pre=document.createElement('pre');
  pre.textContent='VERIFY_RESULT_JSON='+JSON.stringify(R); document.body.appendChild(pre);
});
</script>
```

- [ ] **Step 3: Run driver against unmodified logic — expect FAIL**

Run headless Chrome on `t1-driver.html` (fresh `--user-data-dir`), grep `VERIFY_RESULT_JSON=`. Expected: the driver crashes early or reports `autostart:false` (no `Z.tut`) — confirming the test detects the missing feature.

- [ ] **Step 4: Implement — CSS + HTML**

In `index.html` CSS, replace the `#themeBtn` selector line and add banner rules:

```css
#themeBtn,#helpBtn{padding:2px 10px;font-size:14px;line-height:1;border-radius:9px;
  background:rgba(var(--fg-rgb),.07);border:1px solid rgba(var(--fg-rgb),.16)}
#tutBanner{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;
  display:none;width:min(92%,340px);background:var(--card);color:var(--card-ink);
  border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
body.tut #tutBanner{display:block}
#tutText{font-size:12.5px;font-weight:500;line-height:1.35}
#tutFoot{display:flex;align-items:center;justify-content:space-between;margin-top:7px}
#tutDots i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;
  background:var(--card-sub);opacity:.35}
#tutDots i.on{background:var(--accent);opacity:1}
#tutSkip{padding:5px 10px;font-size:11px;background:transparent;
  border:1px solid rgba(0,0,0,.18);color:var(--card-sub)}
```

In the header, before the theme button:

```html
<button id="helpBtn" aria-label="replay tutorial">?</button>
```

Inside `#cubePane`, before `<div id="netPane">`:

```html
<div id="tutBanner">
  <div id="tutText"></div>
  <div id="tutFoot"><span id="tutDots"></span><button id="tutSkip">Skip</button></div>
</div>
```

- [ ] **Step 5: Implement — tutorial module**

Insert after the hint section (`doHint`), before `// ================= SOLVER`:

```js
// ================= TUTORIAL =================
const TUT_CODE='XXXXXX';   // fixed first-timer board (captured in Task 1 step 1)
const TUT_LS='zipcube.tutorial';
const tutSeen=()=>{ try{ return !!localStorage.getItem(TUT_LS); }catch(e){ return true; } };
const tutMark=()=>{ try{ localStorage.setItem(TUT_LS,'done'); }catch(e){} };
let tut={active:false, step:0};
const TUT_STEPS=[
  {text:'Drag anywhere on the cube to spin it around.',
   done:e=>e.t==='rotate'},
  {text:'Now drag from ① onto the glowing cell.', glow:true,
   done:e=>e.t==='extend'&&e.id===hint.id},
  {text:'Keep drawing — checkpoints must be visited in order. Reach ②.', glow:true,
   skipIf:()=>nextExpected(path)>2,
   done:e=>e.t==='extend'&&numByCell[e.id]===2},
  {text:'Made a mistake? Drag backwards, tap a visited cell, or press Undo.',
   done:e=>e.t==='undo'},
  {text:'The mini net shows all six faces flat — draw the next move on the net.', glow:true,
   done:e=>e.t==='extend'&&e.src==='net'},
  {text:'You know everything. Fill all 24 cells, ① → ⑥ in order. Finish it!',
   done:e=>e.t==='win'},
];
function tutGlow(){
  const st=TUT_STEPS[tut.step];
  if(!st.glow){ if(hint.until===Infinity) hint={id:-1,until:0}; return; }
  const sol=solveFrom(path);
  if(sol) hint={id:sol[path.length], until:Infinity};
  else{
    let k=path.length-1;
    while(k>1 && !solveFrom(path.slice(0,k))) k--;
    hint={id:path[k-1], until:Infinity};
  }
  viewsDirty=true;
}
function tutShow(){
  const st=TUT_STEPS[tut.step];
  $('tutText').textContent=st.text;
  $('tutDots').innerHTML=TUT_STEPS.map((_,i)=>'<i class="'+(i<=tut.step?'on':'')+'"></i>').join('');
  tutGlow();
  if(st.glow && hint.id>=0) faceCell(cells[hint.id]);
}
function tutNote(t,id,src){
  if(!tut.active) return;
  if(TUT_STEPS[tut.step].done({t,id,src})){
    tut.step++;
    while(tut.step<TUT_STEPS.length && TUT_STEPS[tut.step].skipIf && TUT_STEPS[tut.step].skipIf()) tut.step++;
    if(tut.step>=TUT_STEPS.length) tutEnd(); else tutShow();
  } else if(TUT_STEPS[tut.step].glow) tutGlow();
}
function tutStart(){
  if(mode==='solver') setMode('play');
  dropChallenge();
  const ids=decodeCode(TUT_CODE);
  if(ids) applyPuzzle(ids); else makePuzzle();
  setHash(puzzleCode());
  path=[startCell]; basePath=[startCell];
  resetRunState();
  hint={id:-1,until:0}; hintsUsed=0;
  $('win').classList.remove('show');
  tut={active:true, step:0};
  document.body.classList.add('tut');
  tutShow();
  log('tutorial — follow the banner');
  viewsDirty=true; updateHud();
}
function tutEnd(){
  if(!tut.active) return;
  tut.active=false;
  tutMark();
  document.body.classList.remove('tut');
  if(hint.until===Infinity) hint={id:-1,until:0};
  viewsDirty=true;
}
```

Replace `'XXXXXX'` with the code captured in step 1.

- [ ] **Step 6: Implement — input hooks and wiring**

All small edits to existing functions:

- `tryExtend(cell)` → `tryExtend(cell, src)`; after the `hint.until=0;` line add `tutNote('extend',cell.id,src);`
- `dragDraw(cell)` → `dragDraw(cell, src)`; pass `src` to `tryExtend(cell, src)`
- `tapCell(cell)` → `tapCell(cell, src)`; pass `src` to `tryExtend(cell, src)`
- Cube handlers: `dragDraw(pickCell(e.clientX,e.clientY),'cube')` and `tapCell(pickCell(e.clientX,e.clientY),'cube')`
- Net handlers: `dragDraw(netHit(p.x,p.y),'net')` and `tapCell(netHit(p.x,p.y),'net')`
- Cube pointermove rotate branch, after `cDown={x:e.clientX,y:e.clientY};` add: `if(cMoved) tutNote('rotate');`
- `popOne()`: add `tutNote('undo');` after `persistRun();`
- `truncateTo()`: add `tutNote('undo');` after `persistRun();`
- `userWin()`: add `tutNote('win');` as the first line
- Buttons (with the controls): `$('tutSkip').onclick=()=>{ tutEnd(); $('newBtn').onclick(); };` and `$('helpBtn').onclick=tutStart;`
- Boot block: after `updateHud();` and before `loop();` add: `if(!bootIds && !tutSeen()) tutStart();`
- `window.__zip`: add `tut:()=>({active:tut.active, step:tut.step}), startTutorial:tutStart, glow:()=>hint.id,`

- [ ] **Step 7: Syntax check**

Extract the inline `<script>` block to a scratch `.js` file, run `node --check`. Expected: clean (ignore the known IDE-only `-->` false positive; `node --check` itself must pass).

- [ ] **Step 8: Re-run the Task 1 driver — expect PASS**

Rebuild `t1-driver.html` from the modified `index.html` (same injections), run with a **fresh** `--user-data-dir`. Expected: every tuple in `VERIFY_RESULT_JSON` is `true`, including `autostart` (proves first-visit auto-start) and `no errors`.

- [ ] **Step 9: Screenshot both themes**

Run headless with `--screenshot` on the real `index.html` (fresh user-data-dir so the tutorial auto-starts, budget ~3000): once as-is (dark), once with an injected `document.body.classList.add('light')` + `#themeBtn` click driver (light). Inspect: banner legible, dots visible, Skip readable, glow tile visible.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Add interactive first-time tutorial (6 guided steps)"
```

---

### Task 2: Escapes, conflicts, and no-hijack rules

**Files:**
- Modify: `index.html` (`setMode` ~line 886, `resetBtn` ~line 938, `chalBtn` ~line 952, `newBtn` ~line 962)
- Test: scratchpad `t2-driver.html`, `t2b-driver.html`

**Interfaces:**
- Consumes: `tutStart()`, `tutEnd()`, `tut.{active,step}`, `window.__zip.tut()/startTutorial()` from Task 1.
- Produces: no new API; behavioral guarantees (solver/challenge/new-puzzle end the tutorial; reset rewinds to step index 1; replay drops an armed challenge; challenge links never auto-start the tutorial).

- [ ] **Step 1: Write the failing driver**

`<scratch>/t2-driver.html` (same harness pattern as Task 1; `localStorage.setItem('zipcube.tutorial','done')` first so nothing auto-starts, then reload-free scenarios):

```text
a) __zip.startTutorial(); click #modeSolver         → tut inactive, #logline contains "trace from depth"
b) click #modePlay; __zip.startTutorial(); click #chalBtn → tut inactive, #timeStat not hidden
c) __zip.startTutorial(); click #newBtn             → tut inactive
d) __zip.startTutorial(); do rotate-drag + two glow extends (step index 2);
   click #resetBtn                                  → tut active, step===1, path length 1
e) __zip.startTutorial(); click #tutSkip            → tut inactive, flag set
f) click #chalBtn (arm challenge); click #helpBtn   → tut active, __zip.state().challenge===null
g) zero window errors
```

Each scenario asserts into the same `VERIFY_RESULT_JSON` list. Expected first run: scenarios a–c FAIL (tutorial stays active — the hooks don't exist yet).

- [ ] **Step 2: Run driver — expect FAIL on a–c**

- [ ] **Step 3: Implement the hooks**

- `setMode`, solver branch: add `tutEnd();` immediately after `mode='solver';`
- `$('chalBtn').onclick`: add `tutEnd();` as the first line
- `$('newBtn').onclick`: add `tutEnd();` as the first line (before `dropChallenge();`)
- `$('resetBtn').onclick`: after `path=[startCell];` add:

```js
if(tut.active){ if(tut.step>1) tut.step=1; tutShow(); }
```

- [ ] **Step 4: Re-run t2 driver — expect all PASS**

- [ ] **Step 5: Challenge-link no-hijack check**

`<scratch>/t2b-driver.html`: copy with driver asserting `__zip.tut().active===false` and `document.body.classList.contains('tut')===false`. Load it with `#z=<TUT_CODE>` appended to the file URL and a **fresh** user-data-dir (no flag in storage). Expected: PASS — a challenge link suppresses auto-start even for a first-timer.

- [ ] **Step 6: Syntax check + commit**

`node --check` on the extracted script, then:

```bash
git add index.html
git commit -m "End tutorial on solver/challenge/new-puzzle; reset rewinds; guard challenge links"
```

---

### Task 3: Regression sweep + docs

**Files:**
- Modify: `CLAUDE.md` (Architecture section), `README.md` (if it lists features)
- Test: scratchpad `t3-driver.html`

**Interfaces:**
- Consumes: everything above; no new API.

- [ ] **Step 1: Regression driver**

`<scratch>/t3-driver.html` per the verify skill's "flows worth driving", with the tutorial flag pre-set so it stays out of the way:

- Play: net drag-draw 3 cells, Undo, Reset, `#pFilled` correct at each point.
- Solver: `#modeSolver` → logline shows "trace from depth 1"; `#stepBtn` ×10 → counters sum to 10; back to play restores path.
- Challenge: `#chalBtn` → timer stat visible; first extend starts run.
- Theme: `#themeBtn` toggles `body.light`, no errors.
- Stress: `#newBtn` ×40, zero errors.

Expected: all PASS, zero window errors.

- [ ] **Step 2: Update docs**

Add to `CLAUDE.md` Architecture a short "Tutorial" paragraph: step machine (`tut`/`TUT_STEPS`/`tutNote`), fixed `TUT_CODE` board, `body.tut` banner gating, `zipcube.tutorial` localStorage flag, auto-start rule (first visit, non-challenge-link), `?` replay. Mention `__zip.tut()/startTutorial()/glow()` in the debug-hook context. Update `README.md` only if it enumerates features.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document first-time tutorial; full regression sweep"
```
