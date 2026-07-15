# Per-Challenge Leaderboards — Design

**Date:** 2026-07-16
**Status:** Approved

## Goal

Close the challenge-mode loop: instead of pasting results back to each other, everyone who plays a challenge link sees a live board of everyone else's results for that same puzzle — their own row highlighted. Minimal infrastructure: the site stays a static `index.html`, plus one Vercel serverless function and a free Upstash Redis store.

## Decisions (from brainstorming)

| Question | Decision |
|:--|:--|
| Scope | Per-challenge boards (one board per 6-char puzzle code), no global ranking |
| Identity | Self-chosen nickname, no accounts; a random per-browser `deviceId` keys entries |
| Backend | Vercel serverless function in this repo + Upstash Redis via its plain REST API (`fetch`, zero npm dependencies, no `package.json`) |
| Ranking | First-try time (DNFs after solved times); best time and attempts shown as secondary columns |
| Anti-cheat | Server validates the submitted solving path against the puzzle; times remain client-claimed (accepted risk — friendly competition) |
| Publishing | Opt-in: entering a nickname on first win enables publishing; blank = never publish |

## 1. Data model (Upstash Redis)

One Redis hash per challenge code:

- **Key:** `lb:{code}` (code = 6 base-36 chars, validated).
- **Field:** `deviceId` (random 8-char base-36 id generated once per browser, stored in `localStorage` under `zipcube.player`).
- **Value:** JSON `{ name, first, best, attempts, ts }` where `first` is `{t:ms}` or `{dnf:true}`, `best` is ms, `ts` is the server epoch of last update.
- **Upsert semantics:** resubmitting from the same device overwrites its own field only — replays update your row, never duplicate it.
- **TTL:** 90 days, refreshed on every write (`EXPIRE` pipelined with the `HSET`).
- **Cap:** if the hash already has ≥200 fields and this `deviceId` is not among them, the write is rejected (existing players can still update). Friend boards never approach this; it just bounds abuse.

## 2. API — `api/leaderboard.js`

A single zero-config Vercel function (plain `module.exports = (req,res)`, Node runtime, no dependencies). It talks to Upstash via `fetch` against the REST API, reading credentials from `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_URL`/`KV_REST_API_TOKEN` names the Vercel marketplace integration may inject — accept either).

- **`GET /api/leaderboard?code=XXXXXX`** → `200 {entries:[{deviceId,name,first,best,attempts,ts},…]}` (unsorted; client sorts). Invalid code → `400`. Missing credentials → `503`.
- **`POST /api/leaderboard`** with JSON `{code, deviceId, name, first, best, attempts, path}` → validates, upserts, returns the same shape as GET so the client can render the fresh board from one round trip.

**Validation (all server-side, any failure → `400`):**

- `code`: 6 base-36 chars decoding to 6 distinct cell ids 0–23.
- `path`: array of exactly 24 distinct ints 0–23; every consecutive pair adjacent per a **hardcoded 24-cell adjacency table** (generated once from the client's `nbrIds` and pasted in as a constant); `path[0]` is checkpoint 1's cell; the 6 checkpoint cells appear in ascending checkpoint order along the path. This means a score can't be posted without an actual solution to that exact puzzle.
- `name`: after trimming and stripping control characters, 1–16 chars.
- `deviceId`: 4–16 chars `[0-9a-z]`.
- `first`: `{t}` with `0 < t < 86400000`, or `{dnf:true}`; `best`: same ms bounds; `attempts`: int 1–9999. Body ≤ 4 KB.

No CORS headers: page and API share the Vercel origin. Times are client-claimed; the path check plus the cap are the whole anti-abuse story, by design.

## 3. Client — submission

- `localStorage['zipcube.player']` holds `{deviceId, name}`. `deviceId` is created lazily on first use; `name` only exists once the player opts in.
- **When:** a challenge run ends solved (`endRun(true)`). The submitted record is the current `rec` (first/best/attempts) plus the winning 24-cell `path`. Players who never solve a given puzzle never appear on its board (a first-try DNF becomes visible once they eventually solve).
- **First win with no stored name:** the win overlay's leaderboard panel shows an inline name input + "Join board" button (never `window.prompt` — modals wedge headless runs and block the UI). Submitting saves the name and posts. Skipping just shows the board read-only; later wins re-offer.
- **With a stored name:** wins auto-publish, fire-and-forget with a 5 s `AbortController` timeout. Failures log a toast-style line and never block gameplay.

## 4. Client — display

- **Win overlay panel:** after a challenge solve, fetch (or reuse the POST response) and render the board: `rank · name · first-try · best · attempts`, your row highlighted via a token-based accent. Sort: solved first-tries by time ascending, then first-try DNFs (by best time), oldest `ts` breaking ties. Show top 10 plus your own row if outside.
- **🏆 button:** visible whenever a challenge is armed (including on opening a friend's `#z=` link), next to the existing challenge HUD. Tapping opens the same board panel as an overlay so you can see the standings *before* playing.
- **Degradation:** GET failure, timeout, or `503` renders "leaderboard unavailable" in the panel; everything else behaves exactly as today. Opening `index.html` from `file://` simply has no board.
- All new UI uses the existing semantic CSS custom-property tokens (dark + light), `.playOnly`-style visibility classes, and `classList` mutation.

## 5. Error handling

- Client treats any non-200 as "unavailable"; no retries beyond the single 5 s attempt.
- Server wraps Upstash calls in try/catch → `502` on upstream failure.
- Malformed submissions are rejected silently from the player's point of view (the board just doesn't update); this is fine because legitimate clients can't produce them.

## 6. Deployment

- Vercel auto-detects `api/leaderboard.js`; no config file needed.
- **One-time manual step (user):** add the Upstash Redis integration (free tier) from the Vercel marketplace to this project, which injects the REST env vars into all environments. Until then the endpoint returns `503` and the client shows "unavailable".

## 7. Testing

Per the project verify skill, cheapest-sufficient-check first:

1. **Node, no browser:** extract the validation module logic (code decode, adjacency table, path check, sorting comparator) into a scratch file and unit-drive it: valid solve accepted; non-Hamiltonian path, wrong checkpoint order, duplicate cells, oversized name, bad code all rejected.
2. **curl against `vercel dev` or the preview deployment:** GET bad/missing code → 400; POST valid fixture → appears in subsequent GET; second POST same device updates in place; POST with tampered path → 400; missing env vars → 503.
3. **One headless Chrome run at the end** covering the changed UI flow only: arm a challenge with `fetch` stubbed → solve → name input appears → join → board renders with own row highlighted; stub a failing fetch → "leaderboard unavailable"; 🏆 button opens standings pre-play. Verify both themes in the same run.
