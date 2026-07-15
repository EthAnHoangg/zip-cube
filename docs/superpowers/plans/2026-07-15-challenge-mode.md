# Challenge Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Async competitive play for Zip Cube: a puzzle is shareable as a 6-char code in the URL hash; friends race the identical puzzle, timed from first move, with permanent first-try results, attempt counting, solver-voiding, a 10s hint cooldown, and a copy-paste result snippet.

**Architecture:** Everything lives inside the existing single IIFE in `index.html` (no build, no new files, no new dependencies). A puzzle is fully defined by its 6 checkpoint cell ids (each 0–23 → one base-36 char). Challenge state is a small module (`challenge` object + `localStorage` records keyed by code) hooked into the existing move functions (`tryExtend`/`popOne`/`truncateTo`), `userWin`, `setMode`, and the render loop.

**Tech Stack:** Vanilla JS + Three.js r128 (already loaded). No test framework — verification is headless Chrome per `.claude/skills/verify/SKILL.md`.

**Spec:** `docs/superpowers/specs/2026-07-15-challenge-mode-design.md` (approved).

## Global Constraints

- All logic stays inside the single IIFE in `index.html`; no new project files, no dependencies.
- No hardcoded colors in JS; new UI uses existing CSS custom-property tokens and works in dark + light themes.
- Mode/theme classes via `classList` only (never `className=`), so the `light` class survives.
- New buttons/HUD elements follow the existing `.playOnly` visibility pattern.
- Timer is wall-clock (`Date.now()` epoch), never `performance.now()`, so reloads can't pause it.
- First-attempt record (`first`) is write-once: never overwrite a non-null `first`.
- The result snippet's first line always begins `Zip Cube ⚡ first try …`.

## Verification harness (used by every task)

No unit tests exist. Each task's "verify" step drives the real page in headless Chrome, per `.claude/skills/verify/SKILL.md`. The recipe, used verbatim in each task:

```bash
S=$(mktemp -d)
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# head.js = rAF throttle + optional localStorage/hash seed (per task)
# driver.js = async checks appending <pre>VERIFY_RESULT_JSON=... (per task)
node -e '
const fs=require("fs");
let h=fs.readFileSync("index.html","utf8");
h=h.replace("</head>",()=>"<script>"+fs.readFileSync(process.argv[1],"utf8")+"</"+"script></head>");
h=h.replace("</body>",()=>"<script>"+fs.readFileSync(process.argv[2],"utf8")+"</"+"script></body>");
fs.writeFileSync(process.argv[3],h);' "$S/head.js" "$S/driver.js" "$S/verify.html"
"$CH" --headless=new --disable-gpu --enable-unsafe-swiftshader --user-data-dir="$S/prof" \
  --window-size=430,900 --virtual-time-budget=20000 --timeout=60000 \
  --dump-dom "file://$S/verify.html" | grep -o 'VERIFY_RESULT_JSON=.*' | head -c 2000
```

`head.js` always starts with the rAF throttle (mandatory — without it the run never finishes):

```js
window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),80);
```

`driver.js` always starts with this prelude (pointer-capture stubs, error capture, net-drag helpers that talk to the `window.__zip` debug hook added in Task 1):

```js
Element.prototype.setPointerCapture=()=>{};
Element.prototype.releasePointerCapture=()=>{};
const ERRS=[];addEventListener('error',e=>ERRS.push(String(e.message)));
const CAP=[];window.prompt=(m,v)=>{CAP.push(v);return null;};
if(navigator.clipboard) navigator.clipboard.writeText=t=>{CAP.push(t);return Promise.resolve();};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $id=id=>document.getElementById(id);
function netCenter(cellId){
  const r=$id('netPane').getBoundingClientRect();
  const cs=Math.min((r.width-12)/8,(r.height-12)/6);
  const ox=(r.width-cs*8)/2, oy=(r.height-cs*6)/2;
  const n=window.__zip.cells[cellId].net;
  return {x:r.left+ox+(n.cx+0.5)*cs, y:r.top+oy+(5-n.cy+0.5)*cs};
}
const pev=(t,el,x,y)=>el.dispatchEvent(new PointerEvent(t,{pointerId:1,clientX:x,clientY:y,bubbles:true}));
async function move(toId){            // net drag-draw: head → toId
  const nc=$id('netCanvas'), s=window.__zip.state();
  const a=netCenter(s.path[s.path.length-1]), b=netCenter(toId);
  pev('pointerdown',nc,a.x,a.y); pev('pointermove',nc,b.x,b.y); pev('pointerup',nc,b.x,b.y);
  await sleep(120);
}
function legalNext(){                 // any legal extension of the current head
  const s=window.__zip.state(), head=s.path[s.path.length-1];
  let m=0; s.path.forEach(id=>{if(s.numByCell[id])m=Math.max(m,s.numByCell[id]);});
  const exp=m+1;
  return window.__zip.cells[head].nbrIds.find(nb=>{
    if(s.path.includes(nb)) return false;
    const num=s.numByCell[nb];
    if(num&&num!==exp) return false;
    if(num===6&&s.path.length!==23) return false;
    return true;
  });
}
async function solveAll(){            // walk the DFS solution to trigger userWin
  const sol=window.__zip.solution(); if(!sol) return false;
  for(let i=window.__zip.state().path.length;i<24;i++) await move(sol[i]);
  return window.__zip.state().path.length===24;
}
function report(r){
  const pre=document.createElement('pre'); pre.id='VERIFY_RESULT';
  pre.textContent='VERIFY_RESULT_JSON='+JSON.stringify(Object.assign({errs:ERRS},r));
  document.body.appendChild(pre);
}
```

Each task's driver appends a `main()` after the prelude. Gotchas from the verify skill: never `echo ===` in zsh; `node --check` false-positives on `-->` are HTML-parser artifacts only when checking the raw HTML — always extract the script block first.

Syntax-check command (used in every task):

```bash
node -e '
const fs=require("fs");
const m=fs.readFileSync("index.html","utf8").match(/<script>\n([\s\S]*?)<\/script>\n<\/body>/);
fs.writeFileSync(process.env.TMPDIR+"/zip.js",m[1]);' && node --check "$TMPDIR/zip.js" && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`.

---

### Task 1: Puzzle codes — encode/decode, URL hash, load-from-link, debug hook

**Files:**
- Modify: `index.html` — puzzle section (~lines 344–365), `newBtn` handler (~line 843), boot block (~lines 1024–1028), end of IIFE (~line 1029)

**Interfaces:**
- Produces: `applyPuzzle(chk)` (chk = array of 6 checkpoint cell ids, index k → checkpoint k+1), `puzzleCode() → string` (6 base-36 chars), `decodeCode(str) → number[]|null`, `challengeURL(code) → string`, `setHash(code)`, boot-scope consts `bootIds: number[]|null` and `badLink: boolean`, and `window.__zip` debug hook (`code()`, `cells[]`, `solution()`, `state()`).
- Consumes: existing `numByCell`, `startCell`, `N`, `cells`, `rebuildBadges()`, `hamiltonianPath()`, `solveFrom()`.

- [ ] **Step 1: Refactor `makePuzzle` and add code helpers**

Replace the current `makePuzzle` function (the block starting `function makePuzzle(){` and ending with the `c.order` shuffle loop's closing `});` and `}`, ~lines 344–365) with:

```js
  function applyPuzzle(chk){   // chk = checkpoint cell ids, index k → number k+1
    numByCell={};
    cells.forEach(c=>c.num=null);
    chk.forEach((id,k)=>{ cells[id].num=k+1; numByCell[id]=k+1; });
    rebuildBadges();
    startCell=chk[0];
    cells.forEach(c=>{
      c.order=[...c.nbrIds];
      for(let i=c.order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[c.order[i],c.order[j]]=[c.order[j],c.order[i]];}
    });
  }
  function makePuzzle(){
    let sol=hamiltonianPath();
    while(!sol) sol=hamiltonianPath();
    const idxs=[0];
    for(let k=1;k<N-1;k++){
      let i=Math.round(k*23/(N-1));
      i=Math.max(idxs[idxs.length-1]+2, Math.min(21,i));
      idxs.push(i);
    }
    idxs.push(23);
    applyPuzzle(idxs.map(i=>sol[i]));
  }
  // ---- challenge codes: the 6 checkpoint cell ids, one base36 char each ----
  function puzzleCode(){
    const byNum=new Array(N);
    for(const id in numByCell) byNum[numByCell[id]-1]=Number(id);
    return byNum.map(id=>id.toString(36)).join('');
  }
  function decodeCode(str){
    if(typeof str!=='string' || str.length!==N) return null;
    const ids=[...str.toLowerCase()].map(ch=>parseInt(ch,36));
    if(ids.some(id=>!Number.isInteger(id)||id<0||id>23)) return null;
    if(new Set(ids).size!==N) return null;
    return ids;
  }
  const challengeURL=code=>location.href.split('#')[0]+'#z='+code;
  const setHash=code=>history.replaceState(null,'','#z='+code);
```

- [ ] **Step 2: Keep the hash in sync on New puzzle**

In the `$('newBtn').onclick` handler, change the first line `makePuzzle(); path=[startCell]; basePath=[startCell];` to:

```js
    makePuzzle(); setHash(puzzleCode());
    path=[startCell]; basePath=[startCell];
```

- [ ] **Step 3: Boot from a `#z=` link**

Replace the boot block at the bottom of the IIFE:

```js
  makePuzzle();
  path=[startCell]; basePath=[startCell];
  sizeCube(); sizeNet(); sizeTree();
  log('draw on the cube — the mini net helps you peek around back');
  updateHud(); loop();
```

with:

```js
  const bootHash=location.hash.match(/^#z=([0-9a-zA-Z]{6})$/);
  const bootIds=bootHash?decodeCode(bootHash[1]):null;
  const badLink=location.hash.startsWith('#z=')&&!bootIds;
  if(bootIds) applyPuzzle(bootIds); else makePuzzle();
  setHash(puzzleCode());
  path=[startCell]; basePath=[startCell];
  sizeCube(); sizeNet(); sizeTree();
  log(badLink ? 'invalid challenge link — fresh random puzzle instead'
              : 'draw on the cube — the mini net helps you peek around back');
  updateHud(); loop();
```

- [ ] **Step 4: Add the `window.__zip` debug hook**

Immediately before the final `})();` (after the boot block), add:

```js
  // debug hook for headless verification — reads state, never mutates it
  window.__zip={
    code:puzzleCode,
    cells:cells.map(c=>({id:c.id, nbrIds:c.nbrIds.slice(), net:c.net})),
    solution:()=>solveFrom(path),
    state:()=>({path:path.slice(), numByCell:{...numByCell}, startCell, hintsUsed}),
  };
```

- [ ] **Step 5: Syntax check**

Run the syntax-check command from the harness section. Expected: `SYNTAX_OK`.

- [ ] **Step 6: Headless verify — round-trip, bad link, hash-on-new**

`head.js` (scenario: open a specific challenge link):

```js
window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),80);
location.hash='#z=0123ab';
```

`driver.js` = prelude + :

```js
async function main(){
  await sleep(400);
  const s=window.__zip.state();
  const codeOK = window.__zip.code()==='0123ab';
  const startOK = s.startCell===0;
  const numsOK = [0,1,2,3,10,11].every((id,k)=>s.numByCell[id]===k+1);
  document.getElementById('newBtn').click(); await sleep(300);
  const newHashOK = /^#z=[0-9a-z]{6}$/.test(location.hash) && location.hash!=='#z=0123ab';
  report({codeOK,startOK,numsOK,newHashOK});
}
setTimeout(main,600);
```

Run the harness command. Expected JSON: `errs:[]`, all four flags `true`.

Then a second run with `head.js` hash line changed to `location.hash='#z=001122';` (duplicate ids → invalid) and `driver.js` main replaced by:

```js
async function main(){
  await sleep(400);
  const fellBack=/^#z=[0-9a-z]{6}$/.test(location.hash) && location.hash!=='#z=001122';
  const toastOK=document.getElementById('logline').textContent.includes('invalid challenge link');
  report({fellBack,toastOK});
}
setTimeout(main,600);
```

Expected: `errs:[]`, both flags `true`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Add shareable puzzle codes via URL hash"
```

---

### Task 2: Challenge state machine — timer, attempts, persistence, resume

**Files:**
- Modify: `index.html` — header HUD markup (~line 131), new challenge module after `nextExpected` (~line 379), `tryExtend`/`popOne`/`truncateTo` (~lines 537–560), `userWin` (~line 572), `resetBtn`/`newBtn` handlers (~lines 842–849), render `loop()` (~line 990), boot block, `__zip` hook

**Interfaces:**
- Consumes: `puzzleCode()`, `setHash()`, `bootIds` (Task 1); existing `path`, `startCell`, `updateHud()`, `viewsDirty`.
- Produces: `challenge` (null | `{code, rec, running, startEpoch, attempt, finishMs}`), `rec` shape `{attempts:number, first:null|{t:ms}|{dnf:true}, best:ms|null, run:null|{attempt,startEpoch,path}}`, `armChallenge()`, `startRun()`, `persistRun()`, `endRun(solved:boolean)`, `dropChallenge()`, `fmtTime(ms) → "m:ss.t"`, `hintCooldownUntil` (used by Task 3), localStorage key `'zipcube.challenges'`, HUD elements `#timeStat`/`#pTime`, and `window.__zip.arm` (used by later verify drivers).

- [ ] **Step 1: Add the timer chip to the play HUD**

In the header, change:

```html
    <div class="stats playOnly">
      <div class="stat">next <b id="pNext">2</b></div>
      <div class="stat">filled <b><span id="pFilled">1</span>/24</b></div>
    </div>
```

to:

```html
    <div class="stats playOnly">
      <div class="stat">next <b id="pNext">2</b></div>
      <div class="stat">filled <b><span id="pFilled">1</span>/24</b></div>
      <div class="stat" id="timeStat" hidden>time <b id="pTime">–</b></div>
    </div>
```

(No CSS needed: `.stat` sets no `display`, so the native `hidden` attribute works.)

- [ ] **Step 2: Add the challenge module**

Immediately after the `nextExpected` closing `};` (~line 379), add:

```js
  // ================= CHALLENGE MODE =================
  const LS_KEY='zipcube.challenges';
  const loadStore=()=>{ try{ return JSON.parse(localStorage.getItem(LS_KEY))||{}; }catch(e){ return {}; } };
  const saveRec=(code,rec)=>{ try{ const s=loadStore(); s[code]=rec; localStorage.setItem(LS_KEY,JSON.stringify(s)); }catch(e){} };
  let challenge=null;         // {code, rec, running, startEpoch, attempt, finishMs}
  let hintCooldownUntil=0;    // performance.now() deadline; enforced in Task 3
  const fmtTime=ms=>{
    const t=Math.max(0,Math.round(ms/100));
    return `${Math.floor(t/600)}:${String(Math.floor(t/10)%60).padStart(2,'0')}.${t%10}`;
  };
  function armChallenge(){
    const code=puzzleCode();
    const rec=loadStore()[code]||{attempts:0, first:null, best:null, run:null};
    challenge={code, rec, running:false, startEpoch:0, attempt:rec.attempts, finishMs:null};
    hintCooldownUntil=0;
    $('timeStat').hidden=false; $('pTime').textContent='–';
  }
  function persistRun(){
    if(!challenge||!challenge.running) return;
    challenge.rec.run={attempt:challenge.attempt, startEpoch:challenge.startEpoch, path:path.slice()};
    saveRec(challenge.code, challenge.rec);
  }
  function startRun(){
    challenge.rec.attempts++;
    challenge.attempt=challenge.rec.attempts;
    challenge.startEpoch=Date.now();
    challenge.running=true; challenge.finishMs=null;
    persistRun();
  }
  function endRun(solved){
    if(!challenge||!challenge.running) return;
    const ms=Date.now()-challenge.startEpoch;
    if(challenge.attempt===1 && !challenge.rec.first)
      challenge.rec.first = solved ? {t:ms} : {dnf:true};
    if(solved){
      challenge.finishMs=ms;
      if(challenge.rec.best==null || ms<challenge.rec.best) challenge.rec.best=ms;
      $('pTime').textContent=fmtTime(ms);
    }
    challenge.rec.run=null;
    challenge.running=false;
    hintCooldownUntil=0;
    saveRec(challenge.code, challenge.rec);
  }
  function dropChallenge(){
    if(challenge){ endRun(false); challenge=null; }
    $('timeStat').hidden=true;
  }
```

- [ ] **Step 3: Hook the move functions**

In `tryExtend`, after `path.push(cell.id);` / `hint.until=0;`, add one line:

```js
    if(challenge){ if(challenge.running) persistRun(); else startRun(); }
```

Replace `popOne`:

```js
  function popOne(){ if(path.length>1){ path.pop(); persistRun(); viewsDirty=true; updateHud(); } }
```

In `truncateTo`, after `path=path.slice(0,i+1);`, add:

```js
    persistRun();
```

- [ ] **Step 4: Hook win, reset, new**

At the top of `userWin` (first line of the function body), add:

```js
    if(challenge&&challenge.running) endRun(true);
```

Replace the `resetBtn` handler:

```js
  $('resetBtn').onclick=()=>{
    if(challenge&&challenge.running){ endRun(false); $('pTime').textContent='–'; }
    path=[startCell]; viewsDirty=true; updateHud();
  };
```

In `newBtn`'s handler, add `dropChallenge();` as the first line (before `makePuzzle();`).

- [ ] **Step 5: Live timer in the render loop**

In `loop()`, immediately after the `if(viewsDirty){...}` block, add:

```js
    if(challenge&&challenge.running){
      const tt=fmtTime(Date.now()-challenge.startEpoch);
      if($('pTime').textContent!==tt) $('pTime').textContent=tt;
    }
```

- [ ] **Step 6: Arm + resume at boot**

In the boot block, after `path=[startCell]; basePath=[startCell];`, add:

```js
  if(bootIds){
    armChallenge();
    const r=challenge.rec.run;
    if(r && Array.isArray(r.path) && r.path.length>=1 && r.path[0]===startCell
       && r.path.every(id=>Number.isInteger(id)&&id>=0&&id<24)
       && new Set(r.path).size===r.path.length
       && Number.isFinite(r.startEpoch) && Number.isInteger(r.attempt)){
      path=r.path.slice(); basePath=path.slice();
      challenge.attempt=r.attempt; challenge.startEpoch=r.startEpoch; challenge.running=true;
    }
  }
```

- [ ] **Step 7: Expose challenge state in `__zip`**

In the `__zip` hook, replace the `state:` line with:

```js
    arm:armChallenge,   // lets headless drivers arm a challenge on the boot puzzle
    state:()=>({path:path.slice(), numByCell:{...numByCell}, startCell, hintsUsed,
      challenge:challenge&&{code:challenge.code, running:challenge.running,
        attempt:challenge.attempt, startEpoch:challenge.startEpoch,
        rec:JSON.parse(JSON.stringify(challenge.rec))}}),
```

- [ ] **Step 8: Syntax check**

Run the syntax-check command. Expected: `SYNTAX_OK`.

- [ ] **Step 9: Headless verify — timer start, attempts, first-try DNF, solve, resume**

Scenario A (`head.js` = rAF throttle only — the boot puzzle is random and therefore always solvable; fresh profile so localStorage is empty). `driver.js` main:

```js
async function main(){
  await sleep(400);
  const r={};
  window.__zip.arm(); await sleep(120);          // arm a challenge on the boot puzzle
  const code=window.__zip.code();
  let s=window.__zip.state();
  r.armed = !!s.challenge && s.challenge.running===false;
  r.timeChipVisible = !$id('timeStat').hidden;
  await move(legalNext());                       // first move → attempt 1 starts
  s=window.__zip.state();
  r.runStarted = s.challenge.running===true && s.challenge.attempt===1;
  const store=JSON.parse(localStorage.getItem('zipcube.challenges'));
  r.runPersisted = store[code].run && store[code].run.path.length===2;
  $id('resetBtn').click(); await sleep(120);     // abandon attempt 1
  s=window.__zip.state();
  r.firstDNF = s.challenge.rec.first && s.challenge.rec.first.dnf===true;
  r.notRunning = s.challenge.running===false;
  await move(legalNext());                       // attempt 2 starts
  r.attempt2 = window.__zip.state().challenge.attempt===2;
  r.solved = await solveAll();                   // walk DFS solution to the win
  s=window.__zip.state();
  r.runEnded = s.challenge.running===false && s.challenge.rec.run===null;
  r.bestSet = typeof s.challenge.rec.best==='number' && s.challenge.rec.best>=0;
  r.firstStillDNF = s.challenge.rec.first.dnf===true;   // write-once
  r.timeShown = /^\d+:\d\d\.\d$/.test($id('pTime').textContent);
  report(r);
}
setTimeout(main,600);
```

Expected: `errs:[]`, every flag `true`. (The boot puzzle is generated from a real Hamiltonian path, so `solveAll` returning `false` indicates a genuine bug — debug before proceeding.)

Scenario B — resume. `head.js`:

```js
window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),80);
localStorage.setItem('zipcube.challenges', JSON.stringify(
  {'012345':{attempts:1,first:null,best:null,
             run:{attempt:1,startEpoch:Date.now()-5000,path:[0]}}}));
location.hash='#z=012345';
```

`driver.js` main:

```js
async function main(){
  await sleep(600);
  const s=window.__zip.state();
  const resumed = s.challenge && s.challenge.running===true && s.challenge.attempt===1;
  const pathRestored = s.path.length===1 && s.path[0]===0;
  const clockRan = (Date.now()-s.challenge.startEpoch)>=5000;
  const timerText = /^\d+:\d\d\.\d$/.test($id('pTime').textContent);
  report({resumed,pathRestored,clockRan,timerText});
}
setTimeout(main,800);
```

Expected: `errs:[]`, all flags `true`.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Add challenge runs: first-move timer, attempts, first-try record, resume"
```

---

### Task 3: Fairness — solver voids the run, 10s hint cooldown

**Files:**
- Modify: `index.html` — CSS button rules (~line 103), `doHint` (~line 608), `setMode` solver branch (~lines 800–807), the loop's challenge block from Task 2 (~line 1004)

**Interfaces:**
- Consumes: `challenge`, `hintCooldownUntil`, `endRun()`, `fmtTime()` (Task 2); existing `resetRunState()`, `rebuildTrace()`, `log()`.
- Produces: no new names — behavior changes only. Hint button text contract during cooldown: `💡 Ns` and `disabled=true`.

- [ ] **Step 1: Disabled-button style**

After the CSS rule `button:active{transform:scale(.96)}`, add:

```css
  button:disabled{opacity:.45;cursor:default}
  button:disabled:active{transform:none}
```

- [ ] **Step 2: Hint cooldown gate**

In `doHint`, change the opening:

```js
  function doHint(){
    if(mode!=='play'||path.length===24) return;
    hintsUsed++;
```

to:

```js
  function doHint(){
    if(mode!=='play'||path.length===24) return;
    if(challenge&&challenge.running){
      if(performance.now()<hintCooldownUntil) return;
      hintCooldownUntil=performance.now()+10000;
    }
    hintsUsed++;
```

- [ ] **Step 3: Cooldown countdown on the button**

Replace the loop block added in Task 2 Step 5 with:

```js
    if(challenge){
      const left=hintCooldownUntil-performance.now();
      const txt=left>0?`💡 ${Math.ceil(left/1000)}s`:'💡 Hint';
      const hb=$('hintBtn');
      if(hb.textContent!==txt){ hb.textContent=txt; hb.disabled=left>0; }
      if(challenge.running){
        const tt=fmtTime(Date.now()-challenge.startEpoch);
        if($('pTime').textContent!==tt) $('pTime').textContent=tt;
      }
    }
```

- [ ] **Step 4: Solver voids the active run**

In `setMode`, change the solver branch from:

```js
    if(m==='solver'){
      mode='solver';
      basePath=path.slice();
```

to:

```js
    if(m==='solver'){
      mode='solver';
      let voided=false;
      if(challenge&&challenge.running){
        endRun(false);
        path=[startCell]; resetRunState();
        $('pTime').textContent='–';
        voided=true;
      }
      basePath=path.slice();
```

and after the branch's final `rebuildTrace();` line, add:

```js
      if(voided) log('⚡ challenge attempt voided — the solver knows the answer');
```

- [ ] **Step 5: Syntax check**

Run the syntax-check command. Expected: `SYNTAX_OK`.

- [ ] **Step 6: Headless verify — cooldown blocks, solver voids, free play untouched**

Scenario A (`head.js` = rAF throttle only). `driver.js` main:

```js
async function main(){
  await sleep(400);
  const r={};
  window.__zip.arm(); await sleep(120);
  await move(legalNext());                          // start attempt 1
  $id('hintBtn').click(); await sleep(120);
  r.hintUsed = window.__zip.state().hintsUsed===1;
  r.btnCoolingDown = $id('hintBtn').disabled===true && /\ds$/.test($id('hintBtn').textContent);
  $id('hintBtn').click(); await sleep(120);          // blocked by cooldown
  r.secondBlocked = window.__zip.state().hintsUsed===1;
  $id('modeSolver').click(); await sleep(400);       // void the run
  const s=window.__zip.state();
  r.voidedDNF = s.challenge.rec.first && s.challenge.rec.first.dnf===true;
  r.voidedNotRunning = s.challenge.running===false && s.challenge.rec.run===null;
  r.toast = $id('logline').textContent.includes('voided');
  $id('modePlay').click(); await sleep(300);
  r.backAtStart = window.__zip.state().path.length===1;
  report(r);
}
setTimeout(main,600);
```

Expected: `errs:[]`, all flags `true`.

Scenario B — free play unaffected (`head.js` = rAF throttle only, no hash seed). `driver.js` main:

```js
async function main(){
  await sleep(400);
  $id('hintBtn').click(); await sleep(120);
  $id('hintBtn').click(); await sleep(120);
  const s=window.__zip.state();
  report({noCooldownFreePlay: s.hintsUsed===2 && $id('hintBtn').disabled===false});
}
setTimeout(main,600);
```

Expected: `errs:[]`, `noCooldownFreePlay:true`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Void challenge runs on solver entry; add 10s hint cooldown during runs"
```

---

### Task 4: Challenge button, win-overlay results, copy result

**Files:**
- Modify: `index.html` — play button row (~line 166), win card markup (~line 187), `userWin` (~line 572), new share helpers + button handlers near the controls section (~line 840)

**Interfaces:**
- Consumes: `challenge`, `armChallenge()`, `endRun()`, `fmtTime()`, `puzzleCode()`, `setHash()`, `challengeURL()`, `resetRunState()` (earlier tasks).
- Produces: `copyText(txt, okMsg)` (async, clipboard with `prompt()` fallback), `firstTryText(rec) → string`, `resultText() → string` (line 1 `Zip Cube ⚡ first try …`, line 2 the challenge URL), buttons `#chalBtn`, `#copyResBtn`, element `#chalStats`.

- [ ] **Step 1: Markup**

In the play row, after `<button id="hintBtn">💡 Hint</button>`, add:

```html
    <button id="chalBtn">⚡ Challenge</button>
```

In the win card, change:

```html
    <p id="winStats"></p>
    <button id="againBtn" class="primary">New puzzle</button>
```

to:

```html
    <p id="winStats"></p>
    <p id="chalStats" hidden></p>
    <button id="copyResBtn" hidden>Copy result</button>
    <button id="againBtn" class="primary">New puzzle</button>
```

- [ ] **Step 2: Share helpers and handlers**

Next to the other control handlers (after `$('resetBtn').onclick=...`), add:

```js
  async function copyText(txt,okMsg){
    try{ await navigator.clipboard.writeText(txt); log(okMsg); }
    catch(e){ prompt('Copy this:', txt); }
  }
  const firstTryText=rec=>rec.first ? (rec.first.dnf ? 'first try ✗' : `first try ${fmtTime(rec.first.t)}`) : '';
  function resultText(){
    let line=`Zip Cube ⚡ ${firstTryText(challenge.rec)}`;
    if(challenge.attempt>1) line+=` · solved ${fmtTime(challenge.finishMs)} (attempt ${challenge.attempt})`;
    return line+'\n'+challengeURL(challenge.code);
  }
  $('chalBtn').onclick=()=>{
    if(challenge&&challenge.running) endRun(false);
    setHash(puzzleCode());
    armChallenge();
    path=[startCell]; resetRunState();
    hint={id:-1,until:0}; hintsUsed=0;
    viewsDirty=true; updateHud();
    copyText(challengeURL(challenge.code), '⚡ link copied — timer starts on your first move');
  };
  $('copyResBtn').onclick=()=>copyText(resultText(),'result copied — send it to your rivals');
```

- [ ] **Step 3: Challenge results in the win overlay**

Replace the whole `userWin` function (including the `endRun(true)` line Task 2 put at its top) with:

```js
  function userWin(){
    const h=hintsUsed?` — with ${hintsUsed} hint${hintsUsed>1?'s':''}`:'';
    $('winStats').textContent=`All 24 cells, 1 → ${N}, drawn by hand across three dimensions${h}.`;
    if(challenge&&challenge.running){
      endRun(true);
      const rec=challenge.rec;
      $('chalStats').textContent=
        `⚡ ${fmtTime(challenge.finishMs)} · attempt ${challenge.attempt} · ${firstTryText(rec)}`
        +(rec.best!=null?` · best ${fmtTime(rec.best)}`:'');
      $('chalStats').hidden=false; $('copyResBtn').hidden=false;
    } else {
      $('chalStats').hidden=true; $('copyResBtn').hidden=true;
    }
    $('win').classList.add('show');
  }
```

- [ ] **Step 4: Syntax check**

Run the syntax-check command. Expected: `SYNTAX_OK`.

- [ ] **Step 5: Headless verify — arm + copy link, first-try solve, result snippet**

`head.js` = rAF throttle only (no hash — tests the creator flow). `driver.js` main:

```js
async function main(){
  await sleep(400);
  const r={};
  $id('chalBtn').click(); await sleep(200);
  const code=window.__zip.code();
  r.linkCaptured = CAP.some(t=>typeof t==='string' && t.endsWith('#z='+code));
  r.armed = window.__zip.state().challenge && window.__zip.state().challenge.running===false;
  await move(legalNext());
  r.solved = await solveAll();                       // first-try solve
  const s=window.__zip.state();
  r.attempt1 = s.challenge.attempt===1;
  r.firstIsTime = s.challenge.rec.first && typeof s.challenge.rec.first.t==='number';
  r.overlayShown = document.getElementById('win').classList.contains('show');
  r.chalStatsOK = /⚡ \d+:\d\d\.\d · attempt 1 · first try \d+:\d\d\.\d/.test($id('chalStats').textContent);
  CAP.length=0;
  $id('copyResBtn').click(); await sleep(200);
  const lines=(CAP[0]||'').split('\n');
  r.snippetLine1 = /^Zip Cube ⚡ first try \d+:\d\d\.\d$/.test(lines[0]||'');
  r.snippetLine2 = (lines[1]||'').endsWith('#z='+code);
  report(r);
}
setTimeout(main,600);
```

Expected: `errs:[]`, all flags `true`. (If `r.solved` is `false` on a random puzzle, that indicates a real bug — random puzzles are always solvable from the start; debug before proceeding.)

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add Challenge button, win-overlay results, and copy-result snippet"
```

---

### Task 5: Full sweep — regressions, themes, docs

**Files:**
- Modify: `README.md` (add a Challenge mode paragraph)
- No further `index.html` changes expected (fix regressions here if the sweep finds any)

**Interfaces:**
- Consumes: everything above.
- Produces: verified feature + updated README.

- [ ] **Step 1: Regression sweep driver**

`head.js` = rAF throttle only. `driver.js` main:

```js
async function main(){
  await sleep(400);
  const r={};
  // free play regression: extend, undo, reset
  await move(legalNext());
  r.extend = window.__zip.state().path.length===2;
  $id('undoBtn').click(); await sleep(120);
  r.undo = window.__zip.state().path.length===1;
  // solver regression
  $id('modeSolver').click(); await sleep(500);
  r.trace = $id('logline').textContent.includes('trace from depth');
  $id('stepBtn').click(); $id('stepBtn').click(); $id('stepBtn').click(); await sleep(200);
  r.steps = Number($id('sPush').textContent)+Number($id('sPop').textContent)
           +Number($id('sPrune').textContent)===3;
  $id('modePlay').click(); await sleep(300);
  // theme switch with a challenge armed (rebuilds badges + retints)
  $id('chalBtn').click(); await sleep(200);
  $id('themeBtn').click(); await sleep(300);
  r.lightTheme = document.body.classList.contains('light');
  r.stillPlayMode = document.body.classList.contains('play');
  $id('themeBtn').click(); await sleep(200);
  // new-puzzle stress: generation + badge disposal + hash updates
  let hashes=new Set();
  for(let i=0;i<15;i++){ $id('newBtn').click(); await sleep(80); hashes.add(location.hash); }
  r.stress = hashes.size>=14 && [...hashes].every(h=>/^#z=[0-9a-z]{6}$/.test(h));
  r.challengeDropped = window.__zip.state().challenge===null;
  report(r);
}
setTimeout(main,600);
```

Run with virtual-time budget 30000. Expected: `errs:[]`, all flags `true`.

- [ ] **Step 2: Screenshot evidence, both themes**

```bash
"$CH" --headless=new --disable-gpu --enable-unsafe-swiftshader --user-data-dir="$S/prof2" \
  --window-size=430,900 --virtual-time-budget=3000 --timeout=60000 \
  --screenshot="$S/dark.png" "file://$PWD/index.html#z=0123ab"
```

For light theme, copy `index.html` to scratch with `<body class="play">` changed to `<body class="play light">` and screenshot that. Read both PNGs and visually confirm: timer chip visible, ⚡ Challenge button present, no layout overflow in either theme.

- [ ] **Step 3: Update README**

Read `README.md`; after the gameplay/features description (match its tone), add a short section:

```markdown
## Challenge a friend

Every puzzle has a 6-character code in the URL (`#z=…`). Hit **⚡ Challenge** to copy
a link and race it yourself — the timer starts on your first move. Friends who open
the link get the identical cube. Your **first try** is recorded permanently (time, or
✗ if you bail) and always leads your shared result; retries are counted. Opening the
AI solver mid-run voids the attempt, and hints go on a 10-second cooldown while the
clock is running. No server, no accounts — results travel by copy-paste.
```

- [ ] **Step 4: Commit**

```bash
git add README.md index.html
git commit -m "Document challenge mode; verified full regression sweep"
```

---

## Self-review notes

- Spec coverage: codes/links (T1), timer + attempts + first-try permanence + resume (T2), solver void + hint cooldown (T3), win overlay + copy result + clipboard fallback (T4), bad-link fallback (T1 step 3/6), themes + docs (T5). Malformed-code toast and clipboard `prompt()` fallback both implemented and verified.
- `challenge` is declared in Task 2 but referenced by Task 1's `__zip.state` — avoided: Task 1's `state()` deliberately omits challenge; Task 2 Step 7 adds it.
- `fmtTime`, `firstTryText`, `resultText`, `endRun` signatures are consistent across tasks 2–4.
