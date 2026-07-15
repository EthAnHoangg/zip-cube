# Per-Challenge Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each challenge code gets a shared leaderboard: players opt in with a nickname, solved challenge runs are published to `/api/leaderboard`, and everyone who plays that code sees the ranked board (first-try time) in the win overlay and via a 🏆 standings button.

**Architecture:** The site stays a static `index.html`. One zero-dependency Vercel serverless function (`api/leaderboard.js`) stores one Redis hash per code in Upstash (REST API via `fetch`, credentials from env). The server validates the submitted solving path against a hardcoded 24-cell adjacency table, so scores require a real solution. Spec: `docs/superpowers/specs/2026-07-16-leaderboard-design.md`.

**Tech Stack:** Vanilla JS (client IIFE in `index.html`), Vercel Node serverless function (CommonJS, global `fetch`), Upstash Redis REST pipeline. No npm dependencies, no `package.json`.

## Global Constraints

- No `package.json`, no npm dependencies anywhere — the API file uses only Node globals.
- Client stays one file (`index.html`), all JS inside the existing IIFE.
- Every new color comes from existing CSS custom-property tokens (`--card-ink`, `--card-sub`, `rgba(var(--ok-rgb),.NN)`, …); JS never hardcodes colors.
- Class toggling uses `classList` (never `className=`).
- Never call `window.prompt`/`alert` in new code (wedges headless verification; nickname entry is an inline `<input>`).
- Names: strip `[\u0000-\u001f\u007f]`, trim, 1–16 chars — identical rule on client and server.
- Redis: key `lb:{code}`, field = deviceId, value = JSON `{name,first,best,attempts,ts}`, TTL 90 days refreshed on write, cap 200 fields (existing devices may always update).
- Testing per `.claude/skills/verify/SKILL.md`: node scratch tests for logic/API, ONE headless Chrome run at the very end (Task 5). Scratch files live in the session scratchpad, not the repo.
- Commits end with the oh-my-agent trailer (see repo convention in prior commits).

---

### Task 1: API validation core

**Files:**
- Create: `api/leaderboard.js` (validation functions + `__test` export only; HTTP handler comes in Task 2)
- Test: `<scratchpad>/test-lb-validation.js` (not committed)

**Interfaces:**
- Produces: `module.exports.__test = {decodeCode, validPath, cleanEntry, NBR}` —
  `decodeCode(str) → int[6]|null`; `validPath(path, chk) → bool`;
  `cleanEntry(body) → {code, deviceId, record:{name,first,best,attempts}} | null`.
- Fixture (generated from the client's cell geometry; checkpoints of tutorial code `njlki0` are `[23,19,21,20,18,0]`):

```js
const CODE='njlki0';
const SOLVE=[23,2,9,11,3,19,17,7,10,8,21,6,4,12,20,22,13,15,14,5,16,18,1,0];
```

- [ ] **Step 1: Write the failing test**

Create `<scratchpad>/test-lb-validation.js`:

```js
const assert=require('assert');
const {decodeCode,validPath,cleanEntry,NBR}=require(process.cwd()+'/api/leaderboard.js').__test;

const CODE='njlki0';
const SOLVE=[23,2,9,11,3,19,17,7,10,8,21,6,4,12,20,22,13,15,14,5,16,18,1,0];
const chk=decodeCode(CODE);

// adjacency table shape
assert.strictEqual(NBR.length,24);
NBR.forEach((ns,id)=>{assert.strictEqual(ns.length,4);ns.forEach(n=>assert(NBR[n].includes(id)));});

// decodeCode
assert.deepStrictEqual(chk,[23,19,21,20,18,0]);
assert.deepStrictEqual(decodeCode('NJLKI0'),chk);            // case-insensitive
assert.strictEqual(decodeCode('njlki'),null);                // wrong length
assert.strictEqual(decodeCode('njlkin'),null);               // duplicate id
assert.strictEqual(decodeCode('njlkiz'),null);               // z=35 out of range
assert.strictEqual(decodeCode(42),null);

// validPath
assert.strictEqual(validPath(SOLVE,chk),true);
assert.strictEqual(validPath(SOLVE.slice(0,23),chk),false);            // short
const swapped=SOLVE.slice(); [swapped[3],swapped[7]]=[swapped[7],swapped[3]];
assert.strictEqual(validPath(swapped,chk),false);                      // breaks adjacency
assert.strictEqual(validPath(SOLVE.slice().reverse(),chk),false);      // checkpoints out of order
const dup=SOLVE.slice(); dup[5]=dup[4];
assert.strictEqual(validPath(dup,chk),false);                          // duplicate cell

// cleanEntry
const good={code:CODE,deviceId:'abc123',name:' Ann ',first:{t:47300},best:47300,attempts:1,path:SOLVE};
const e=cleanEntry(good);
assert.deepStrictEqual(e.record,{name:'Ann',first:{t:47300},best:47300,attempts:1});
assert.strictEqual(e.code,CODE); assert.strictEqual(e.deviceId,'abc123');
assert(cleanEntry({...good,first:{dnf:true}}));                        // dnf first ok
assert.strictEqual(cleanEntry({...good,name:'   '}),null);             // empty after trim
assert.strictEqual(cleanEntry({...good,name:'x'.repeat(17)}),null);    // too long
assert.strictEqual(cleanEntry({...good,name:'a\u0007b'}).record.name,'ab'); // control chars stripped
assert.strictEqual(cleanEntry({...good,deviceId:'AB!'}),null);
assert.strictEqual(cleanEntry({...good,first:{t:-5}}),null);
assert.strictEqual(cleanEntry({...good,best:0}),null);
assert.strictEqual(cleanEntry({...good,attempts:0}),null);
assert.strictEqual(cleanEntry({...good,path:swapped}),null);
assert.strictEqual(cleanEntry({...good,code:'zzzzzz'}),null);
console.log('validation OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `node <scratchpad>/test-lb-validation.js`
Expected: FAIL with `Cannot find module '<repo>/api/leaderboard.js'`

- [ ] **Step 3: Write the validation core**

Create `api/leaderboard.js`:

```js
// Per-challenge leaderboard API — zero-dependency Vercel serverless function.
// Storage: Upstash Redis via its REST pipeline endpoint (global fetch).
// Design: docs/superpowers/specs/2026-07-16-leaderboard-design.md

const N=6;
// 24-cell cube-surface adjacency, generated from index.html's cell geometry
// (same construction order → same ids). Row i = the 4 neighbours of cell i.
const NBR=[[2,13,1,22],[3,15,18,0],[9,0,3,23],[11,1,19,2],[6,12,5,20],[7,14,16,4],
[8,4,7,21],[10,5,17,6],[10,21,9,6],[11,23,2,8],[17,8,11,7],[19,9,3,10],
[14,20,13,4],[15,22,0,12],[16,12,15,5],[18,13,1,14],[18,5,17,14],[19,7,10,16],
[1,16,19,15],[3,17,11,18],[22,4,21,12],[23,6,8,20],[0,20,23,13],[2,21,9,22]];

function decodeCode(str){
  if(typeof str!=='string'||str.length!==N) return null;
  const ids=[...str.toLowerCase()].map(ch=>parseInt(ch,36));
  if(ids.some(id=>!Number.isInteger(id)||id<0||id>23)) return null;
  if(new Set(ids).size!==N) return null;
  return ids;
}
function validPath(path,chk){
  if(!Array.isArray(path)||path.length!==24) return false;
  if(!path.every(id=>Number.isInteger(id)&&id>=0&&id<=23)) return false;
  if(new Set(path).size!==24) return false;
  for(let i=1;i<24;i++) if(!NBR[path[i-1]].includes(path[i])) return false;
  if(path[0]!==chk[0]||path[23]!==chk[N-1]) return false;
  const pos=new Array(24); path.forEach((id,i)=>pos[id]=i);
  for(let k=1;k<N;k++) if(pos[chk[k]]<pos[chk[k-1]]) return false;
  return true;
}
const MS_MAX=86400000;
function cleanEntry(b){
  if(!b||typeof b!=='object') return null;
  const chk=decodeCode(b.code); if(!chk) return null;
  if(typeof b.deviceId!=='string'||!/^[0-9a-z]{4,16}$/.test(b.deviceId)) return null;
  const name=typeof b.name==='string'?b.name.replace(/[\u0000-\u001f\u007f]/g,'').trim():'';
  if(!name||name.length>16) return null;
  const f=b.first;
  const first=f&&f.dnf===true?{dnf:true}
    :f&&Number.isInteger(f.t)&&f.t>0&&f.t<MS_MAX?{t:f.t}:null;
  if(!first) return null;
  if(!Number.isInteger(b.best)||b.best<=0||b.best>=MS_MAX) return null;
  if(!Number.isInteger(b.attempts)||b.attempts<1||b.attempts>9999) return null;
  if(!validPath(b.path,chk)) return null;
  return {code:b.code.toLowerCase(), deviceId:b.deviceId,
          record:{name, first, best:b.best, attempts:b.attempts}};
}

module.exports.__test={decodeCode,validPath,cleanEntry,NBR};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node <scratchpad>/test-lb-validation.js`
Expected: `validation OK`

- [ ] **Step 5: Commit**

```bash
git add api/leaderboard.js
git commit -m "Add leaderboard API validation core (code/path/entry checks)"
```

---

### Task 2: API handler + Upstash REST client

**Files:**
- Modify: `api/leaderboard.js` (append handler above the `__test` export; `module.exports` becomes the handler function with `__test` attached)
- Test: `<scratchpad>/test-lb-handler.js` (not committed)

**Interfaces:**
- Consumes: Task 1's `decodeCode`, `cleanEntry`.
- Produces HTTP contract used by the client (Tasks 3–4):
  - `GET /api/leaderboard?code=XXXXXX` → `200 {entries:[{deviceId,name,first,best,attempts,ts},…]}` (unsorted), `400` bad code, `503` unconfigured, `502` upstream error.
  - `POST /api/leaderboard` JSON `{code,deviceId,name,first,best,attempts,path}` → `200` same shape as GET (fresh board), `400` invalid, `409` board full for new device.

- [ ] **Step 1: Write the failing test**

Create `<scratchpad>/test-lb-handler.js` (env vars MUST be set before `require`, since the module reads them at load):

```js
const assert=require('assert');

// ---- in-memory Upstash pipeline fake ----
const store=new Map();                       // key -> Map(field -> value)
global.fetch=async(url,opts)=>{
  assert(url.endsWith('/pipeline'));
  assert.strictEqual(opts.headers.Authorization,'Bearer tkn');
  const results=JSON.parse(opts.body).map(([cmd,key,...args])=>{
    switch(cmd){
      case 'HEXISTS': return {result:store.has(key)&&store.get(key).has(args[0])?1:0};
      case 'HLEN':    return {result:store.has(key)?store.get(key).size:0};
      case 'HSET':  { if(!store.has(key)) store.set(key,new Map());
                      const m=store.get(key), had=m.has(args[0]);
                      m.set(args[0],args[1]); return {result:had?0:1}; }
      case 'EXPIRE':  return {result:1};
      case 'HGETALL':{ const flat=[]; (store.get(key)||new Map()).forEach((v,f)=>flat.push(f,v));
                       return {result:flat}; }
      default:        return {error:'unknown '+cmd};
    }
  });
  return {ok:true, json:async()=>results};
};

process.env.UPSTASH_REDIS_REST_URL='http://fake';
process.env.UPSTASH_REDIS_REST_TOKEN='tkn';
const handler=require(process.cwd()+'/api/leaderboard.js');

function call(method,query,body){
  const res={code:0,body:null,headers:{},
    status(c){this.code=c;return this;},
    json(b){this.body=b;return this;},
    setHeader(k,v){this.headers[k]=v;},
    end(){return this;}};
  return Promise.resolve(handler({method,query:query||{},body},res)).then(()=>res);
}

const CODE='njlki0';
const SOLVE=[23,2,9,11,3,19,17,7,10,8,21,6,4,12,20,22,13,15,14,5,16,18,1,0];
const entry=dev=>({code:CODE,deviceId:dev,name:'P'+dev,first:{t:50000},best:50000,attempts:1,path:SOLVE});

(async()=>{
  let r=await call('GET',{code:'bad'});           assert.strictEqual(r.code,400);
  r=await call('GET',{code:CODE});                assert.strictEqual(r.code,200);
  assert.deepStrictEqual(r.body.entries,[]);
  r=await call('POST',{},{...entry('dev001')});   assert.strictEqual(r.code,200);
  assert.strictEqual(r.body.entries.length,1);
  assert.strictEqual(r.body.entries[0].name,'Pdev001');
  assert(Number.isInteger(r.body.entries[0].ts));
  // upsert: same device replaces its row
  r=await call('POST',{},{...entry('dev001'),best:42000,attempts:3});
  assert.strictEqual(r.body.entries.length,1);
  assert.strictEqual(r.body.entries[0].best,42000);
  // second device appends
  r=await call('POST',{},entry('dev002'));        assert.strictEqual(r.body.entries.length,2);
  // tampered path rejected
  const bad=SOLVE.slice(); [bad[3],bad[7]]=[bad[7],bad[3]];
  r=await call('POST',{},{...entry('dev003'),path:bad}); assert.strictEqual(r.code,400);
  // cap: fill to 200 fields, then a new device is refused, existing still updates
  const m=store.get('lb:'+CODE);
  for(let i=m.size;i<200;i++) m.set('fill'+i,'{"name":"f","first":{"t":1},"best":1,"attempts":1,"ts":0}');
  r=await call('POST',{},entry('dev004'));        assert.strictEqual(r.code,409);
  r=await call('POST',{},{...entry('dev001'),best:41000}); assert.strictEqual(r.code,200);
  // method guard
  r=await call('DELETE',{});                      assert.strictEqual(r.code,405);
  // unconfigured → 503 (fresh module instance without env)
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete require.cache[require.resolve(process.cwd()+'/api/leaderboard.js')];
  const bare=require(process.cwd()+'/api/leaderboard.js');
  const res503={code:0,status(c){this.code=c;return this;},json(){return this;},setHeader(){},end(){return this;}};
  await bare({method:'GET',query:{code:CODE}},res503);
  assert.strictEqual(res503.code,503);
  console.log('handler OK');
})().catch(e=>{console.error(e);process.exit(1);});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node <scratchpad>/test-lb-handler.js`
Expected: FAIL — `handler is not a function` (module currently only exports `__test`).

- [ ] **Step 3: Implement the handler**

In `api/leaderboard.js`, replace the final line `module.exports.__test={decodeCode,validPath,cleanEntry,NBR};` with:

```js
const REST_URL=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL;
const REST_TOKEN=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
const TTL=90*24*3600, CAP=200;

async function redis(cmds){
  const r=await fetch(REST_URL+'/pipeline',{method:'POST',
    headers:{Authorization:'Bearer '+REST_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify(cmds)});
  if(!r.ok) throw new Error('upstash '+r.status);
  const out=await r.json();
  const bad=out.find(o=>o.error); if(bad) throw new Error(bad.error);
  return out.map(o=>o.result);
}
function parseBoard(flat){          // HGETALL REST result: [field,value,field,value,…]
  const entries=[];
  for(let i=0;i+1<(flat||[]).length;i+=2){
    try{ entries.push({deviceId:flat[i], ...JSON.parse(flat[i+1])}); }catch(e){}
  }
  return entries;
}

module.exports=async(req,res)=>{
  if(!REST_URL||!REST_TOKEN) return res.status(503).json({error:'not configured'});
  try{
    if(req.method==='GET'){
      const code=String(req.query.code||'');
      if(!decodeCode(code)) return res.status(400).json({error:'bad code'});
      const [flat]=await redis([['HGETALL','lb:'+code.toLowerCase()]]);
      return res.status(200).json({entries:parseBoard(flat)});
    }
    if(req.method==='POST'){
      const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body;
      if(JSON.stringify(body||{}).length>4096) return res.status(400).json({error:'too big'});
      const e=cleanEntry(body);
      if(!e) return res.status(400).json({error:'invalid'});
      const k='lb:'+e.code;
      const [exists,len]=await redis([['HEXISTS',k,e.deviceId],['HLEN',k]]);
      if(!exists&&len>=CAP) return res.status(409).json({error:'board full'});
      e.record.ts=Date.now();
      const flat=(await redis([
        ['HSET',k,e.deviceId,JSON.stringify(e.record)],
        ['EXPIRE',k,TTL],
        ['HGETALL',k]]))[2];
      return res.status(200).json({entries:parseBoard(flat)});
    }
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({error:'method not allowed'});
  }catch(err){
    return res.status(502).json({error:'upstream'});
  }
};
module.exports.__test={decodeCode,validPath,cleanEntry,NBR};
```

- [ ] **Step 4: Run both tests to verify they pass**

Run: `node <scratchpad>/test-lb-validation.js && node <scratchpad>/test-lb-handler.js`
Expected: `validation OK` then `handler OK`

- [ ] **Step 5: Commit**

```bash
git add api/leaderboard.js
git commit -m "Add leaderboard handler: Upstash REST pipeline, upsert, TTL, cap"
```

---

### Task 3: Client — identity, submission, win-overlay board

**Files:**
- Modify: `index.html` — CSS block (after the `.card p` rule, ~line 136), win-card HTML (~line 211), new JS section after `dropChallenge()` (~line 467), `userWin()` (~line 664)

**Interfaces:**
- Consumes: HTTP contract from Task 2; existing `fmtTime`, `challenge`, `path`.
- Produces (used by Task 4): `getPlayer() → {deviceId,name|null}`; `lbGet(code) → Promise<entries>`; `renderBoard(el, entries)`; `boardNote(el, msg)`; CSS classes `.lbRow`, `.lbRow.me`, `.lbNote`.

- [ ] **Step 1: Add CSS**

In the `<style>` block, immediately after the `.card p{…}` rule, insert:

```css
  #lbPanel{margin:-6px 0 14px}
  #lbJoin{display:flex;gap:6px;justify-content:center;margin-bottom:8px}
  #lbName{font-family:inherit;font-size:12px;padding:7px 9px;border-radius:10px;width:120px;
    border:1px solid rgba(0,0,0,.25);background:transparent;color:var(--card-ink);user-select:text}
  #lbJoinBtn{border-color:rgba(0,0,0,.25);color:var(--card-ink);background:transparent}
  .lbRow{display:flex;gap:8px;align-items:baseline;font-size:11.5px;padding:3px 6px;border-radius:7px;
    color:var(--card-sub);font-family:'Space Mono',monospace}
  .lbRow b{font-family:'Space Grotesk',sans-serif;color:var(--card-ink);flex:1;text-align:left;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .lbRow.me{background:rgba(var(--ok-rgb),.16)}
  .lbNote{font-size:11px;color:var(--card-sub);padding:4px 0}
```

(All colors are card tokens / `--ok-rgb`, so both themes work with zero JS.)

- [ ] **Step 2: Add win-card HTML**

In the `#win` card, after `<p id="chalStats" hidden></p>` (before `<button id="copyResBtn"…`), insert:

```html
      <div id="lbPanel" hidden>
        <div id="lbJoin" hidden>
          <input id="lbName" maxlength="16" placeholder="nickname" autocomplete="off">
          <button id="lbJoinBtn">Join board</button>
        </div>
        <div id="lbRows"></div>
      </div>
```

- [ ] **Step 3: Add leaderboard JS**

In the IIFE, immediately after the `dropChallenge()` function (after its closing `}` at ~line 467), insert:

```js
  // ---- leaderboard: per-code shared board via /api/leaderboard ----
  const PLAYER_KEY='zipcube.player';
  const savePlayer=p=>{ try{ localStorage.setItem(PLAYER_KEY,JSON.stringify(p)); }catch(e){} };
  function getPlayer(){
    let p=null;
    try{ p=JSON.parse(localStorage.getItem(PLAYER_KEY)); }catch(e){}
    if(!p||typeof p.deviceId!=='string'){
      p={deviceId:Array.from({length:8},()=>Math.floor(Math.random()*36).toString(36)).join(''), name:null};
      savePlayer(p);
    }
    return p;
  }
  async function lbCall(url,opts){
    const ctrl=new AbortController();
    const tm=setTimeout(()=>ctrl.abort(),5000);
    try{
      const r=await fetch(url,{...opts,signal:ctrl.signal});
      if(!r.ok) throw new Error('http '+r.status);
      return (await r.json()).entries||[];
    } finally { clearTimeout(tm); }
  }
  const lbGet=code=>lbCall('api/leaderboard?code='+code);
  function lbPost(code,rec,winPath){
    const p=getPlayer();
    return lbCall('api/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code, deviceId:p.deviceId, name:p.name,
        first:rec.first, best:rec.best, attempts:rec.attempts, path:winPath})});
  }
  const lbSort=(a,b)=>{
    const ft=e=>e.first&&!e.first.dnf?e.first.t:Infinity;
    const bt=e=>e.best==null?Infinity:e.best;
    return (ft(a)-ft(b)) || (bt(a)-bt(b)) || ((a.ts||0)-(b.ts||0));
  };
  function boardNote(el,msg){
    el.textContent='';
    const d=document.createElement('div'); d.className='lbNote'; d.textContent=msg;
    el.appendChild(d);
  }
  function renderBoard(el,entries){
    el.textContent='';                          // names rendered via textContent only
    if(!entries.length){ boardNote(el,'no results yet — you could be first'); return; }
    entries.sort(lbSort);
    const mine=entries.findIndex(e=>e.deviceId===getPlayer().deviceId);
    entries.forEach((e,i)=>{
      if(i>=10&&i!==mine) return;
      const row=document.createElement('div');
      row.className='lbRow'+(i===mine?' me':'');
      const rank=document.createElement('span'); rank.textContent=(i+1)+'.';
      const nm=document.createElement('b'); nm.textContent=e.name;
      const ft=document.createElement('span');
      ft.textContent=e.first&&!e.first.dnf?fmtTime(e.first.t):'✗';
      const meta=document.createElement('span');
      meta.textContent=(e.best!=null?fmtTime(e.best):'–')+' ×'+e.attempts;
      row.append(rank,nm,ft,meta);
      el.appendChild(row);
    });
  }
  let lastWin=null;   // {code, rec, path} of the most recent solved challenge run
  async function showWinBoard(){
    if(!lastWin){ $('lbPanel').hidden=true; return; }
    const p=getPlayer();
    $('lbPanel').hidden=false;
    $('lbJoin').hidden=!!p.name;
    boardNote($('lbRows'),'…');
    try{
      const entries=p.name ? await lbPost(lastWin.code,lastWin.rec,lastWin.path)
                           : await lbGet(lastWin.code);
      renderBoard($('lbRows'),entries);
    }catch(e){
      try{ renderBoard($('lbRows'),await lbGet(lastWin.code)); }   // POST failed (e.g. board full) — still show it
      catch(e2){ boardNote($('lbRows'),'leaderboard unavailable'); }
    }
  }
  $('lbJoinBtn').onclick=()=>{
    const name=$('lbName').value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,16);
    if(!name) return;
    const p=getPlayer(); p.name=name; savePlayer(p);
    showWinBoard();
  };
```

- [ ] **Step 4: Wire into `userWin()`**

In `userWin()`, inside the `if(challenge&&challenge.running){` branch, after `$('chalStats').hidden=false; $('copyResBtn').hidden=false;` add:

```js
      lastWin={code:challenge.code, rec:challenge.rec, path:path.slice()};
      showWinBoard();
```

And in the `else` branch, after `$('chalStats').hidden=true; $('copyResBtn').hidden=true;` add:

```js
      lastWin=null; $('lbPanel').hidden=true;
```

- [ ] **Step 5: Syntax check**

Extract the inline script and check (per verify skill):

```bash
awk '/^\(\(\) => \{/,/^\}\)\(\);/' index.html > <scratchpad>/app.js && node --check <scratchpad>/app.js
```

Expected: no output (exit 0). No headless run here — that waits for Task 5.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Publish solved challenge runs; show board in win overlay (opt-in nickname)"
```

---

### Task 4: Client — 🏆 standings button + overlay

**Files:**
- Modify: `index.html` — footer HTML (~line 189), overlay HTML after `#win` (~line 215), CSS `#win` selectors (~lines 130–132), `armChallenge()`/`dropChallenge()` (~lines 429–467), controls JS (~line 1056)

**Interfaces:**
- Consumes: `lbGet`, `renderBoard`, `boardNote` from Task 3; `challenge` from challenge mode.

- [ ] **Step 1: Add HTML**

In the footer's `.row.playOnly`, after `<button id="chalBtn">⚡ Challenge</button>`:

```html
    <button id="lbBtn" hidden>🏆</button>
```

After the closing `</div>` of `#win` (before the `<script src=…three.min.js>` tag):

```html
<div id="lbView">
  <div class="card">
    <h2>Standings</h2>
    <p id="lbViewCode"></p>
    <div id="lbViewRows"></div>
    <button id="lbCloseBtn" class="primary" style="margin-top:14px">Close</button>
  </div>
</div>
```

- [ ] **Step 2: Share the overlay CSS**

Change the two `#win` rules to cover both overlays:

```css
  #win,#lbView{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;
    background:rgba(var(--panel-rgb),.78);backdrop-filter:blur(4px)}
  #win.show,#lbView.show{display:flex}
```

(The inline `style="margin-top:14px"` on the close button is the one exception to token-only styling — it's spacing, not color.)

- [ ] **Step 3: Wire visibility + handlers**

In `armChallenge()`, after `$('timeStat').hidden=false; $('pTime').textContent='–';` add:

```js
    $('lbBtn').hidden=false;
```

In `dropChallenge()`, after `$('timeStat').hidden=true;` add:

```js
    $('lbBtn').hidden=true;
```

In the controls section, right after the `$('copyResBtn').onclick=…` line, add:

```js
  $('lbBtn').onclick=async()=>{
    if(!challenge) return;
    $('lbViewCode').textContent='puzzle '+challenge.code;
    boardNote($('lbViewRows'),'…');
    $('lbView').classList.add('show');
    try{ renderBoard($('lbViewRows'),await lbGet(challenge.code)); }
    catch(e){ boardNote($('lbViewRows'),'leaderboard unavailable'); }
  };
  $('lbCloseBtn').onclick=()=>$('lbView').classList.remove('show');
```

- [ ] **Step 4: Syntax check**

```bash
awk '/^\(\(\) => \{/,/^\}\)\(\);/' index.html > <scratchpad>/app.js && node --check <scratchpad>/app.js
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add 🏆 standings overlay for armed challenges"
```

---

### Task 5: Docs + single headless verification

**Files:**
- Modify: `CLAUDE.md` (architecture notes), `README.md` (feature blurb)
- Test: `<scratchpad>/verify-lb.html` driver (not committed)

- [ ] **Step 1: Document**

`CLAUDE.md`: after the “First-time tutorial” section, add a “Leaderboard” section covering: `api/leaderboard.js` is the only non-static file (zero-dependency Vercel function, Upstash REST via env `UPSTASH_REDIS_REST_URL/_TOKEN` or `KV_REST_API_*`, hardcoded `NBR` adjacency table mirrors the client geometry — regenerate if the cell construction ever changes); client stores `{deviceId,name}` in `zipcube.player`; solved challenge runs POST `{rec fields + winning path}`; publishing is opt-in via nickname; board UI in win overlay + `#lbView`; everything degrades to "leaderboard unavailable" without network/env. Update the opening "entire app is one self-contained file" sentence to mention the API file.

`README.md`: one short paragraph under the challenge-mode feature: each challenge link has a shared leaderboard ranked by first-try time; join with a nickname on your first win.

- [ ] **Step 2: One headless run (per verify skill — the only Chrome run in this plan)**

Build `<scratchpad>/verify-lb.html` from `index.html` following the verify skill recipe exactly (rAF throttle + modal stubs + `localStorage['zipcube.tutorial']='done'` in `<head>`; pointer-capture stubs in the driver). In the `<head>` script also stub `fetch` with an in-memory board so all UI states are exercised offline:

```js
window.__fakeBoard=[]; window.__fail=false;
window.fetch=async(url,opts)=>{
  if(String(url).includes('api/leaderboard')){
    if(window.__fail) return {ok:false,status:502,json:async()=>({})};
    if(opts&&opts.method==='POST'){
      const b=JSON.parse(opts.body);
      window.__fakeBoard=window.__fakeBoard.filter(e=>e.deviceId!==b.deviceId);
      window.__fakeBoard.push({deviceId:b.deviceId,name:b.name,first:b.first,best:b.best,attempts:b.attempts,ts:Date.now()});
    }
    return {ok:true,status:200,json:async()=>({entries:window.__fakeBoard.slice()})};
  }
  return {ok:false,status:404,json:async()=>({})};
};
```

Driver flow (single run, assert into `VERIFY_RESULT_JSON=`): seed `__fakeBoard` with two rivals (one `{dnf:true}` first) → `__zip.arm()` → `#lbBtn` visible; click it → `#lbViewRows` has 2 `.lbRow`s and correct rank order (solved rival before DNF rival) → close → drive a full solve via `__zip.solution()` + `__zip.state()` net-cell taps (extend along the solution using net coordinates from `__zip.cells`) → win overlay shows `#lbJoin` (no stored name) → set `#lbName`, click `#lbJoinBtn` → `#lbRows` now has 3 rows with own row `.me`-highlighted → set `__fail=true`, click `#lbBtn` → "leaderboard unavailable" note → toggle `#themeBtn` and confirm no errors. Capture `window.onerror`; expect zero errors.

Run with the skill's chrome flags; expected: all assertions true in `VERIFY_RESULT_JSON`.

- [ ] **Step 3: Re-run node tests (regression)**

`node <scratchpad>/test-lb-validation.js && node <scratchpad>/test-lb-handler.js` → `validation OK`, `handler OK`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document per-challenge leaderboard; verified API + UI flows"
```

---

## Deployment note (manual, user)

After merge: in the Vercel dashboard, add the **Upstash Redis** marketplace integration (free tier) to the zip-cube project so `UPSTASH_REDIS_REST_URL`/`_TOKEN` are injected. Until then `/api/leaderboard` returns 503 and the client shows "leaderboard unavailable". Optionally smoke-test the preview deployment:
`curl 'https://<preview>/api/leaderboard?code=njlki0'` → `{"entries":[]}`.
