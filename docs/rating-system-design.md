# Player rating system — design

Status: proposed (2026-07-19). Replaces the profit-weighted `computePlayerLevel`
with a proper opponent-based rating. Keep it **minimal on screen** — a level + a
confidence, exactly like today — and never hide people from city boards. Low
confidence, not gating, communicates uncertainty.

## Principle

Rate **skill = who you beat**, not **profit = how much you won**. Money (net, ROI,
streaks) stays as separate displayed stats; it does not drive the level. This
de-emphasises farming a soft game for cash and rewards beating strong players.

## Algorithm — Weng–Lin online Bayesian rating (openskill-style)

A poker table is an **N-player, free-for-all, ranked match**. That rules out plain
1v1 systems as the core:

- **Elo (pairwise)** — what we half-have. No real uncertainty; clumsy for N players.
- **Glicko-2** — great uncertainty model, but 1v1; needs pairwise decomposition.
- **TrueSkill** — purpose-built and correct, but factor-graph message passing is
  complex to implement and hard to fuzz-test.
- **Weng–Lin (Thurstone–Mosteller / Plackett–Luce)** — ✅ **chosen.** The math
  behind `openskill`. Closed-form updates for a whole ranked match at once, outputs
  a Gaussian skill **μ** and uncertainty **σ** per player. TrueSkill-quality result,
  but a pure function we can property/fuzz-test like `settle.js`.

Per player we store `{ mu, sigma, games }`. Constants (openskill defaults):
`mu0 = 25`, `sigma0 = 25/3 ≈ 8.33`, `beta = 25/6` (skill→outcome noise),
`tau ≈ sigma0/100` (per-match dynamics so ratings can still move after many games).

## What a "match" is

- Every **finished, real** game (`isRealGame`: ≥2 players, ≥2 buy-ins) that has
  **≥2 account-linked seats**. Anonymous seats have no identity to rate → ignored;
  a game with <2 account seats contributes nothing.
- **Rank within the match = finishing order:**
  - **Cash:** rank by net (higher net = better place). Equal net = tie.
  - **Tournament:** rank by finishing place. Paid places come from
    `tournament.places`; everyone else currently ties at `−buy-in` (we only capture
    the paid top-k today). *Open question below: capture full bust order to rank
    non-cashers.*
- Ties are first-class (Weng–Lin supports equal ranks).

## Score + confidence (what shows on screen — unchanged shape)

- **Level** = a conservative skill estimate `μ − 3σ` (the TrueSkill leaderboard
  convention: a new, uncertain player ranks low until proven) mapped onto the
  existing 1–10 bands via `scoreToLevel`. So the profile/leaderboard keep showing a
  level number exactly as now.
- **Confidence %** = derived from σ (low σ → high confidence), same 0–95% feel as
  today's `reliability`. Shown next to the level. **Nothing else is added to the UI.**
- Minimum to show a level at all: **≥5 rated games** (as today's `< 5 → Newcomer`).

## Leaderboards (city / global) — ungated now, threshold-gated later

- **Now (small user base):** rank everyone with a rating (≥5 rated games) by
  conservative skill. **No connectivity/participation gate** — show everyone, as the
  city board does today. Confidence carries the honesty: a disconnected crew or a
  low-sample player shows **low confidence**, so the number isn't over-trusted, but
  they still appear.
- **Later (activates per city at ≥50 users in that city):** the city board becomes
  **earn-your-place** — a user must have **≥10 games in that city** to access/appear
  on it. This keeps a mature local board meaningful (drive-by/one-game accounts don't
  clutter it) without hurting us while we're small. Implement as a config threshold
  (`CITY_BOARD_MIN_USERS = 50`, `CITY_BOARD_MIN_GAMES = 10`) checked per city, so it
  switches on automatically city-by-city as each fills up. Off everywhere until then.

## The closed-pool reality — handled by confidence, not hiding

A group that only ever plays each other:

1. **Relative ranking is valid** — the system correctly sorts them internally.
2. **Not farmable** — beating the same weaker regular gives diminishing returns
   (expected→actual gap shrinks to 0). Intrinsic to the algorithm.
3. **Absolute level floats** — updates are ~zero-sum, so a closed pool's *average*
   sits at the default; only the spread is real. Their level is only truly
   comparable to the outside once someone **bridges** (an open/city game, or a
   shared player). We surface this via **low confidence**, and cross-play tightens
   it — giving players a concrete reason to use open games. We do **not** gate them
   off the board.

Anti-collusion / anti-abuse (a closed pool is a trust environment; cap the damage):
- Cap μ movement per match.
- Ignore matches with <2 account seats.
- Require ≥5 rated games before a level is shown (already the rule).

## Persistence & recompute (deterministic, no drift)

- **Source of truth = replay.** Ratings are a pure function of the full finished-game
  history processed in **chronological close order** (`settlement.computedAt`,
  fallback `updatedAt`). Replaying is deterministic and reproducible — no mutable
  stored rating that can corrupt or drift.
- **Performance:** cache the replay result; rebuild on game close (incremental) or
  lazily/periodically. Because the truth is a replay, **backfill over existing games
  is automatic** — first run rates all history.
- Reopen/resettle changes a game's result → the replay naturally reflects it on next
  rebuild.

## Migration

- New pure module `src/lib/engine/rating.js`:
  - `rateMatch(entries)` — one ranked match → updated `{mu,sigma}` per entry.
  - `ratePlayers(games)` — replay all games → `Map<userId, {mu,sigma,games}>`.
- `computePlayerLevel` keeps producing `{ level, label, reliability }` for the UI,
  but `level`/`reliability` now come from the rating (μ, σ), not win-rate/ROI.
  Win-rate/ROI/streaks remain as their own displayed stats (unchanged).
- The level bands (`scoreToLevel`) stay, re-pointed at the conservative score, so the
  UI shape doesn't change.

## Tests (engine, like settle/resolve)

- Monotonicity: beating a **higher**-rated field raises μ more than beating a lower
  one; losing to a lower-rated field drops it more.
- Convergence / no-farm: repeatedly beating the same weaker opponent → gains →0.
- σ shrinks with games; new players start uncertain.
- Determinism: same history → same ratings, independent of when replayed.
- Zero anonymous-seat contribution; tie handling; single-account-game = no-op.

## One rating across cash + tournaments — why the math is bulletproof

**Decision: one unified rating.** The reason it works cleanly across every scenario
is that **the rating never touches money or format — it consumes only the ordinal
finishing order within each match.** A game is reduced to "player A finished above
player B above C…", and that ranking is produced differently per format but is the
same *type* of input afterwards:

- **Cash** → rank by net (chips out − chips in, rebuys included).
- **Tournament** → rank by finishing place (non-cashers tied — see below).

Because the engine only ever sees ranks, there is **no cross-format normalisation to
get wrong** — we never compare a cash dollar to a tournament dollar, never weight one
format vs the other. "Did you beat the people at your table" is universal.

The three scenarios, each exact:

- **Cash only** — every match ranks by net → rating = your cash skill. ✓
- **Tournament only** — every match ranks by place → rating = your tournament skill. ✓
- **Mixed** — μ/σ update across *all* your matches in chronological order; the blend
  is naturally weighted by how many of each you actually play. No format flag needed
  in the update; a mixed player's rating is just "how you place against the people you
  sit with, whatever the format." ✓

Guarantees that keep it bulletproof:
- A match contributes **only if ≥2 account seats** are in it (a rank needs someone to
  rank against).
- **Money magnitude never enters the update** — only order. So stakes, buy-in size and
  payout structure can't distort skill (a €5 game and a €500 game move you the same
  for the same result).
- **Ties are first-class** (equal net; tied non-cashers) via the tie-aware Weng–Lin
  update.
- **Deterministic replay** → identical ratings regardless of when/how recomputed.

## Rebuys & tournament finishing order

- **Rebuys are supported and already flow correctly.** A rebuy is another buy-in
  (top-up) → it grows the prize pool and the player's invested. For **tournament**
  ranking (by place) a rebuy doesn't change the final order; for **cash** ranking (by
  net) it correctly lowers net. Either way the rating just re-reads the resulting
  rank. Nothing special needed in the rating engine.
- **Non-cashers are tied** at `−(total invested)` for v1 (we only capture the paid
  top-k today). *Upgrade path:* the planned **bust-tracking** feature (players mark
  when they're out → live "X players remaining") yields a **full finishing order** for
  free, which we can later feed to the rating so deep runs outrank early busts — a
  drop-in improvement, no engine change (it already ranks whatever order it's given).

## Separate track (not part of the rating build): live tournament management

Noted for the roadmap, distinct from the rating engine:
- **Rebuy / add-on** UX during play (already works as top-ups; needs surfacing).
- **Bust tracking** — a player marks "I'm out" → the game tracks remaining players and
  shows **"X players remaining"** live; produces the finishing order.
- **Deals** — near the end (e.g. final table / heads-up) offer a **chop calculator**
  (even split or ICM/chip-chop of the remaining pool) the table can agree to and apply
  as the payout. This is a self-contained feature (an ICM/chop engine + UI).

These make tournaments richer and, as a bonus, feed the rating a full finishing order.
They are a separate build from the rating system below.
