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
