// Aggregate a user's results across all their games. Pure and dependency-free.
//
// A "result" only counts once a game is ended/settled (final stacks are in and
// the books are frozen) or the moment YOU cash out. Active games still count
// toward "games you have".
//
// Games can be played in different currencies, so money stats are reported in the
// player's most-used *convertible* currency: every game's net is converted into
// it via the injected `convert` callback. Units with no exchange rate (chips, big
// blinds, Bitcoin, custom text) can't be folded into a money total — they're
// counted as `otherGames` and still listed (in their own unit), just left out of
// profit/avg/streak/curve. Omitting `convert` falls back to 1:1 (every unit
// convertible), preserving the original single-currency behaviour.

import { computeSettlement } from './settle.js';

const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** The one definition of a game that counts: a real table has at least two
 *  players AND at least two buy-ins — you need at least two people to actually put
 *  money in to have a game (a table with a single lone buy-in never played out).
 *  Single-seat, no-money, or one-buy-in tables are abandoned setups / tests; they
 *  never count toward anyone's stats or the leaderboard, and the reaper deletes
 *  them after 24h (the exact complement of this rule). The stats engine,
 *  insights/leaderboard, the reaper, and the admin aggregates all share this
 *  predicate so "counted" never drifts between surfaces.
 * @param {{ players?: unknown[], transactions?: unknown[] }} g */
export function isRealGame(g) {
  return (g?.players?.length || 0) >= 2 && (g?.transactions?.length || 0) >= 2;
}

/** How quickly a user pays confirmed debts: average DAYS from a game settling
 *  (`settlement.computedAt`) to each of their outgoing transfers being confirmed.
 *  Only confirmed payments in real games count (never a bare unpaid debt).
 *  @param {Array<import('../types').Game>} games @param {string} userId
 *  @returns {{ avgDays: number, count: number } | null} */
export function settleSpeedFor(games, userId) {
  /** @type {number[]} */
  const deltas = [];
  for (const g of games) {
    const seat = (g.players || []).find((p) => p.userId === userId);
    if (!seat || !g.settlement?.transfers || !g.settlement.computedAt) continue;
    if (!isRealGame(g)) continue; // stay consistent with every other counted surface
    const computedMs = new Date(g.settlement.computedAt).getTime();
    if (!Number.isFinite(computedMs)) continue;
    for (const t of g.settlement.transfers) {
      if (t.from !== seat.id || !t.confirmedAt) continue;
      const delta = new Date(t.confirmedAt).getTime() - computedMs;
      if (delta >= 0) deltas.push(delta);
    }
  }
  if (!deltas.length) return null;
  const avgMs = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  return { avgDays: Math.ceil(avgMs / 86_400_000), count: deltas.length };
}

/**
 * @param {Array<import('../types').Game>} games  every game in the system
 * @param {string} userId
 * @param {(amount: number, from: string, to: string) => number | null} [convert]
 *        Convert `amount` from one unit symbol to another; null = not convertible.
 */
export function computeUserStats(games, userId, convert) {
  const conv = typeof convert === 'function' ? convert : (/** @type {number} */ amt) => amt;
  // A unit is "money" if it can convert to itself (i.e. we have a rate for it).
  const convertible = (/** @type {string} */ unit) => conv(1, unit, unit) != null;

  let totalGames = 0;
  /** @type {Array<{id:string,name:string,net:number|null,unit:string,at:string,status:string,tournament:boolean}>} */
  const recent = [];
  /** @type {Array<{id:string,name:string,unit:string,net:number,invested:number,at:string,hours:number|null,status:string,place:{better:number,n:number}|null,tournament:boolean}>} */
  const finishedAll = [];

  for (const g of games) {
    const seat = (g.players || []).find((p) => p.userId === userId);
    if (!seat) continue;
    if (!isRealGame(g)) continue; // abandoned/no-money tables never count
    totalGames++;
    const unit = g.unit || '€';

    const finished = g.status === 'ended' || g.status === 'settled';
    // Your result is locked the moment YOU cash out — net = your cash-out minus
    // your buy-in, independent of who's still playing — so it counts immediately,
    // even while the game runs on. A seat with no final stack yet has no result.
    const cashedOut = !!seat && g.finalStacks != null && g.finalStacks[seat.id] != null;
    if (!finished && !cashedOut) {
      recent.push({ id: g.id, name: g.name, net: null, unit, at: g.updatedAt, status: g.status, tournament: g.mode === 'tournament' });
      continue;
    }

    // Net in the game's OWN unit: frozen snapshot if present, else live compute.
    // Grab ALL players' lines too, so we can rank this player at the table.
    let net = null;
    let lines = g.settlement && Array.isArray(g.settlement.lines) ? g.settlement.lines : null;
    if (lines) {
      const ln = lines.find((l) => l.playerId === seat.id);
      if (ln && ln.net != null) net = ln.net;
    }
    if (net == null || !lines) {
      const s = computeSettlement(g.players, g.transactions, g.finalStacks);
      lines = s.lines;
      if (net == null) { const ln = s.lines.find((l) => l.playerId === seat.id); net = ln ? ln.net : 0; }
    }
    // Table placement — ONLY when the game is fully finished (everyone's net is
    // final). `better` = how many players beat you (rank = better + 1). Powers
    // "nights won" (nobody beat you) and "top-half finishes". Unit-independent, so
    // chip/other-unit games count here even though they're left out of money totals.
    let place = null;
    if (finished && Array.isArray(lines)) {
      const withNet = lines.filter((l) => typeof l.net === 'number');
      if (withNet.length >= 2) place = { better: withNet.filter((l) => l.net > net).length, n: withNet.length };
    }
    // Total this user put on the table across the WHOLE game — buy-ins + top-ups
    // (every transaction on their seat), in cents to avoid drift.
    const invested = (g.transactions || []).reduce(
      (s, t) => t.playerId === seat.id ? s + Math.round((t.amount || 0) * 100) : s, 0) / 100;
    const hrs = g.hours && seat ? g.hours[seat.id] : null;
    finishedAll.push({ id: g.id, name: g.name, unit, net, invested, at: g.updatedAt, hours: typeof hrs === 'number' ? hrs : null, status: g.status, place, tournament: g.mode === 'tournament' });
  }

  // Report in the player's most-used convertible currency (default €).
  const displayUnit = pickDisplayUnit(finishedAll, convertible);

  let totalProfitC = 0; // integer cents so many games can't drift a fractional cent
  let investedC = 0;    // total invested across money games (for avg buy-in)
  let profitable = 0, gamesPlayed = 0, otherGames = 0;
  let best = null, worst = null;
  /** @type {Array<{at:string, net:number, hours:number|null}>} */
  const moneyResults = []; // converted into displayUnit, for curve/streak/hourly
  /** Full, uncapped per-game statement rows — every finished result, money games
   *  converted into displayUnit, other-unit games kept in their own unit. Powers
   *  the exportable statement (CSV / printable PDF); `recent` (capped, mixed with
   *  in-progress) stays the compact UI list. @type {Array<{id:string,name:string,at:string,unit:string,net:number,invested:number,hours:number|null,status:string,money:boolean}>} */
  const ledger = [];

  for (const r of finishedAll) {
    const converted = conv(r.net, r.unit, displayUnit);
    if (converted == null) {
      // No exchange rate (chips / big blinds / Bitcoin / custom) — surfaced in the
      // games list in its own unit, but never mixed into the money total.
      otherGames++;
      recent.push({ id: r.id, name: r.name, net: round2(r.net), unit: r.unit, at: r.at, status: r.status, tournament: r.tournament });
      ledger.push({ id: r.id, name: r.name, at: r.at, unit: r.unit, net: round2(r.net), invested: round2(r.invested), hours: r.hours, status: r.status, money: false });
      continue;
    }
    gamesPlayed++;
    totalProfitC += Math.round(converted * 100);
    const convInvested = conv(r.invested, r.unit, displayUnit) || 0;
    investedC += Math.round(convInvested * 100);
    if (converted > 0) profitable++;
    if (!best || converted > best.net) best = { id: r.id, name: r.name, net: round2(converted) };
    if (!worst || converted < worst.net) worst = { id: r.id, name: r.name, net: round2(converted) };
    recent.push({ id: r.id, name: r.name, net: round2(converted), unit: displayUnit, at: r.at, status: r.status, tournament: r.tournament });
    moneyResults.push({ at: r.at, net: converted, hours: r.hours });
    ledger.push({ id: r.id, name: r.name, at: r.at, unit: displayUnit, net: round2(converted), invested: round2(convInvested), hours: r.hours, status: r.status, money: true });
  }

  // Newest first, by ISO timestamp (lexical order == chronological). A missing
  // timestamp coerces to '' → sorts oldest, so a legacy game without updatedAt
  // can't wrongly float to the top of "your games".
  const keyAt = (/** @type {{ at: string }} */ x) => x.at || '';
  recent.sort((a, b) => (keyAt(a) < keyAt(b) ? 1 : keyAt(a) > keyAt(b) ? -1 : 0));
  // Oldest → newest for the running curve / streaks.
  moneyResults.sort((a, b) => (keyAt(a) < keyAt(b) ? -1 : keyAt(a) > keyAt(b) ? 1 : 0));
  // Statement ledger reads oldest → newest, like a bank statement top-to-bottom.
  ledger.sort((a, b) => (keyAt(a) < keyAt(b) ? -1 : keyAt(a) > keyAt(b) ? 1 : 0));

  // Cumulative profit over time (a bankroll sparkline), accumulated in cents.
  let cumC = 0;
  const curve = moneyResults.map((r) => { cumC += Math.round(r.net * 100); return { at: r.at, cum: cumC / 100 }; });

  // Win/loss streaks. net 0 (break-even) is neutral and breaks a streak.
  const streak = streakOf(moneyResults.map((r) => r.net));

  // currency/hr — ONLY from games where this user entered their hours. No hours =
  // the game isn't counted (we never assume a duration). null when none entered.
  let hNetC = 0, hHours = 0, hGames = 0;
  for (const r of moneyResults) {
    if (typeof r.hours === 'number' && r.hours > 0) { hNetC += Math.round(r.net * 100); hHours += r.hours; hGames++; }
  }
  const hourly = hHours > 0 ? { rate: round2((hNetC / 100) / hHours), hours: Math.round(hHours * 100) / 100, games: hGames } : null;

  // Settlement speed — how quickly this user pays their debts (see settleSpeedFor).
  const settlementSpeed = settleSpeedFor(games, userId);

  // Table placement across fully-finished games: how often this player finished
  // the night on top, and how often in the top half of the table.
  let nightsWon = 0, topHalf = 0, placementGames = 0;
  for (const r of finishedAll) {
    if (!r.place) continue;
    placementGames++;
    if (r.place.better === 0) nightsWon++;
    if (r.place.n > 1 && r.place.better / (r.place.n - 1) <= 0.5) topHalf++;
  }
  const placement = placementGames
    ? { games: placementGames, nightsWon, topHalfPct: Math.round((topHalf / placementGames) * 100) }
    : null;

  const totalProfit = totalProfitC / 100;
  const avgProfit = gamesPlayed ? round2(totalProfit / gamesPlayed) : 0;
  const avgBuyIn = gamesPlayed ? round2((investedC / 100) / gamesPlayed) : 0;
  const profitablePct = gamesPlayed ? Math.round((profitable / gamesPlayed) * 100) : 0;
  const level = computePlayerLevel(gamesPlayed, profitablePct, avgProfit, avgBuyIn, ledger, { games, userId });

  // Level curve — decimal level at each game point (aligned 1:1 with profit curve).
  // Pre-computes opponent adjustment once, then replays personal stats game by game.
  const levelCurve = buildLevelCurve(ledger, games, userId);

  return {
    unit: displayUnit,
    totalGames,
    gamesPlayed,
    otherGames,
    totalProfit: round2(totalProfit),
    avgProfit,
    avgBuyIn,
    profitable,
    profitablePct,
    best,
    worst,
    curve,
    levelCurve,
    streak,
    hourly,
    settlementSpeed,
    placement,
    recent: recent.slice(0, 30),
    ledger,
    level,
  };
}

/** The currency to report stats in: the most-used convertible unit (ties broken
 *  by most recent), defaulting to € when the player has no money games.
 *  @param {Array<{unit:string, at:string}>} results
 *  @param {(unit:string)=>boolean} convertible @returns {string} */
function pickDisplayUnit(results, convertible) {
  /** @type {Map<string, number>} */ const counts = new Map();
  /** @type {Map<string, string>} */ const lastAt = new Map();
  for (const r of results) {
    if (!convertible(r.unit)) continue;
    counts.set(r.unit, (counts.get(r.unit) || 0) + 1);
    const prev = lastAt.get(r.unit);
    if (prev == null || r.at > prev) lastAt.set(r.unit, r.at);
  }
  let bestUnit = '€', bestCount = -1, bestAt = '';
  for (const [unit, count] of counts) {
    const at = lastAt.get(unit) || '';
    if (count > bestCount || (count === bestCount && at > bestAt)) { bestUnit = unit; bestCount = count; bestAt = at; }
  }
  return bestUnit;
}

/** Win/loss streaks from finished nets in chronological order.
 *  @param {number[]} nets @returns {{current:number, kind:'win'|'loss'|'none', longestWin:number, longestLoss:number}} */
function streakOf(nets) {
  let longestWin = 0, longestLoss = 0, runW = 0, runL = 0;
  for (const n of nets) {
    if (n > 0) { runW++; runL = 0; } else if (n < 0) { runL++; runW = 0; } else { runW = 0; runL = 0; }
    if (runW > longestWin) longestWin = runW;
    if (runL > longestLoss) longestLoss = runL;
  }
  let current = 0;
  /** @type {'win'|'loss'|'none'} */ let kind = 'none';
  for (let i = nets.length - 1; i >= 0; i--) {
    const n = nets[i];
    if (i === nets.length - 1) {
      if (n > 0) kind = 'win'; else if (n < 0) kind = 'loss'; else break;
      current = 1; continue;
    }
    if ((kind === 'win' && n > 0) || (kind === 'loss' && n < 0)) current++; else break;
  }
  return { current, kind, longestWin, longestLoss };
}

/** Player skill level — a weighted composite of personal stats + opponent-adjusted
 *  Elo, with a confidence ramp that requires 30+ games to fully stabilize.
 *
 *  Three personal components (each normalized 0–1, totalling the "skill score"):
 *    Win rate    (35%) — fraction of sessions that ended profitable (net > 0)
 *    ROI         (35%) — avgProfit / avgBuyIn, clamped to [−50%, +50%] → [0, 1]
 *    Consistency (15%) — inverse stddev of per-game ROI, BUT only counted when the
 *        player's overall ROI ≥ 0. Being consistently bad is not a skill — this
 *        prevents a 0% WR player from getting a free 15% boost for zero variance.
 *
 *  Opponent adjustment (15% effective weight via additive ±0.15):
 *    Multi-player Elo via pairwise comparisons. For each finished game, every pair
 *    (me, opponent-with-account) yields an expected vs actual outcome:
 *      expected = 1 / (1 + 10^((oppScore − myScore) / 30))   (Elo formula, 30-point scale)
 *      actual   = 1 if my net > theirs, 0.5 if tied, 0 if lower
 *    The average surprise (actual − expected) across all pairs is scaled to [−15, +15]
 *    and added to the 0–100 skill score BEFORE the confidence ramp, so it's dampened
 *    for players with few games just like the personal stats are. Needs ≥ 5 pairwise
 *    comparisons to activate (otherwise neutral — falls back to stats-only rating).
 *
 *    This means: beating strong opponents boosts your level, farming weak opponents
 *    doesn't, and losing to weaker players pulls you down. Table size is handled
 *    naturally — more players = more pairs = more data per game.
 *
 *  Confidence — linear ramp from 0 at 5 games to 1 at 30. At low confidence the
 *  score is floored at 25% of the adjusted skill, preventing a lucky 5-game run
 *  from reaching the top tiers.
 *
 *  Reliability — a user-facing percentage (0–95%) showing how trustworthy the score
 *  is, computed from game count (sqrt scale, ~85% max) plus pairwise data quality
 *  (up to +10%). Capped at 95% because poker's inherent variance means no
 *  session-level rating is ever fully certain.
 *
 *  Level thresholds on the 0–100 scale:
 *    ≥82 Shark · ≥68 Advanced · ≥54 Skilled · ≥40 Regular · ≥25 Casual · else Beginner
 *
 *  @param {number} gamesPlayed  finished money games
 *  @param {number} profitablePct  0-100
 *  @param {number} avgProfit  in display currency
 *  @param {number} avgBuyIn   in display currency
 *  @param {Array<{net:number, invested:number, money:boolean}>} ledger
 *  @param {{games: Array<import('../types').Game>, userId: string}} [ctx]
 *         Pass all games + the userId to enable opponent-adjusted rating.
 *  @returns {{level:number, score:number, label:string, reliability:number}} */
export function computePlayerLevel(gamesPlayed, profitablePct, avgProfit, avgBuyIn, ledger, ctx) {
  if (gamesPlayed < 5) return { level: 1, label: 'Newcomer', reliability: 0 };

  // --- Personal stats (0–1) ---
  const winRate = (profitablePct || 0) / 100;

  const safeBuyIn = Math.max(avgBuyIn || 0, 0.01);
  const roi = (avgProfit || 0) / safeBuyIn;
  const roiNorm = Math.max(0, Math.min(1, roi + 0.5));

  const moneyGames = (ledger || []).filter((g) => g.money && g.invested > 0);
  let consistency = 0.5;
  if (moneyGames.length >= 3) {
    const rois = moneyGames.map((g) => Math.max(-1, Math.min(2, g.net / g.invested)));
    const mean = rois.reduce((s, r) => s + r, 0) / rois.length;
    const variance = rois.reduce((s, r) => s + (r - mean) ** 2, 0) / rois.length;
    consistency = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / 1.5));
  }

  const effConsistency = roi >= 0 ? consistency : 0;
  let skillScore = 0.35 * winRate + 0.35 * roiNorm + 0.15 * effConsistency;

  // --- Opponent strength adjustment (adds up to ±0.15) ---
  let pairCount = 0;
  if (ctx?.games && ctx.userId) {
    const peers = buildBaseScores(ctx.games);
    const myBase = peers.get(ctx.userId) ?? 50;
    const pa = pairwiseAdj(ctx.games, ctx.userId, myBase, peers);
    skillScore = Math.max(0, Math.min(1, skillScore + pa.adj / 100));
    pairCount = pa.pairs;
  } else {
    skillScore += 0.15 * 0.5;
  }

  // --- Confidence ramp ---
  const confidence = Math.min(1, (gamesPlayed - 5) / 25);
  const finalScore = skillScore * (0.25 + 0.75 * confidence);
  const score = Math.round(finalScore * 100);

  // --- Reliability (0–95%) ---
  const gameRel = Math.sqrt(Math.min(1, gamesPlayed / 50)) * 85;
  const pairRel = Math.min(10, (pairCount / 200) * 100);
  const reliability = Math.min(95, Math.round(gameRel + pairRel));

  const { level, label } = scoreToLevel(score);
  return { level, label, reliability };
}

const BANDS = [[82,100,7,'Shark'],[68,81,6,'Advanced'],[54,67,5,'Skilled'],[40,53,4,'Regular'],[25,39,3,'Casual'],[0,24,2,'Beginner']];
function scoreToLevel(score) {
  for (const [min, max, lvl, label] of BANDS) {
    if (score >= min) return { level: Math.round((lvl + (score - min) / (max - min + 1)) * 100) / 100, label };
  }
  return { level: 2, label: 'Beginner' };
}

/** Build the level curve — one decimal-level value per money game, oldest→newest.
 *  Pre-computes opponent adjustment once from the full history, then replays
 *  personal stats incrementally so the curve is cheap to produce.
 *  @param {Array<{net:number, invested:number, money:boolean}>} ledger
 *  @param {Array<import('../types').Game>} [games]
 *  @param {string} [userId]
 *  @returns {number[]} */
function buildLevelCurve(ledger, games, userId) {
  const moneyLedger = (ledger || []).filter((g) => g.money && g.invested > 0);
  if (moneyLedger.length < 5) return [];

  let oppAdj = 0.15 * 0.5;
  if (games && userId) {
    const peers = buildBaseScores(games);
    const myBase = peers.get(userId) ?? 50;
    oppAdj = pairwiseAdj(games, userId, myBase, peers).adj / 100;
  }

  const out = [];
  let runGames = 0, runWins = 0, runProfitC = 0, runInvestedC = 0;
  /** @type {Array<{net:number, invested:number}>} */
  const runEntries = [];

  for (const entry of moneyLedger) {
    runGames++;
    runProfitC += Math.round(entry.net * 100);
    runInvestedC += Math.round(entry.invested * 100);
    if (entry.net > 0) runWins++;
    runEntries.push(entry);

    if (runGames < 5) continue;

    const winRate = runWins / runGames;
    const avgBI = Math.max(runInvestedC / 100 / runGames, 0.01);
    const roi = (runProfitC / 100 / runGames) / avgBI;
    const roiNorm = Math.max(0, Math.min(1, roi + 0.5));

    let consistency = 0.5;
    if (runEntries.length >= 3) {
      const rois = runEntries.map((g) => Math.max(-1, Math.min(2, g.net / g.invested)));
      const mean = rois.reduce((s, r) => s + r, 0) / rois.length;
      const variance = rois.reduce((s, r) => s + (r - mean) ** 2, 0) / rois.length;
      consistency = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / 1.5));
    }
    const effConsistency = roi >= 0 ? consistency : 0;

    let skillScore = 0.35 * winRate + 0.35 * roiNorm + 0.15 * effConsistency;
    skillScore = Math.max(0, Math.min(1, skillScore + oppAdj));

    const confidence = Math.min(1, (runGames - 5) / 25);
    const score = Math.round(skillScore * (0.25 + 0.75 * confidence) * 100);
    out.push(scoreToLevel(score).level);
  }
  return out;
}

/** Lightweight base score (0–100) for every user with 3+ finished games.
 *  Uses only win rate + ROI (no consistency, no opponent adj) so it can serve as
 *  the opponent-strength proxy without circular dependency.
 *  @param {Array<import('../types').Game>} games
 *  @returns {Map<string,number>} userId → baseScore */
function buildBaseScores(games) {
  /** @type {Map<string, {g:number, w:number, rs:number}>} */
  const acc = new Map();
  for (const g of games) {
    if (!isRealGame(g) || (g.status !== 'ended' && g.status !== 'settled')) continue;
    if (!g.settlement?.lines) continue;
    for (const seat of g.players) {
      if (!seat.userId) continue;
      const ln = g.settlement.lines.find((l) => l.playerId === seat.id);
      if (!ln || ln.net == null) continue;
      const inv = (g.transactions || []).reduce(
        (s, t) => t.playerId === seat.id ? s + Math.round((t.amount || 0) * 100) : s, 0) / 100;
      if (inv <= 0) continue;
      let e = acc.get(seat.userId);
      if (!e) { e = { g: 0, w: 0, rs: 0 }; acc.set(seat.userId, e); }
      e.g++;
      if (ln.net > 0) e.w++;
      e.rs += Math.max(-1, Math.min(2, ln.net / inv));
    }
  }
  /** @type {Map<string,number>} */
  const scores = new Map();
  for (const [uid, d] of acc) {
    if (d.g < 3) continue;
    const wr = d.w / d.g;
    const roiN = Math.max(0, Math.min(1, d.rs / d.g + 0.5));
    scores.set(uid, Math.round((0.50 * wr + 0.50 * roiN) * 100));
  }
  return scores;
}

/** Pairwise Elo adjustment across all shared games. For each (me, opponent) pair
 *  in every finished game, computes expected-vs-actual outcome and averages the
 *  surprise. Returns adjustment in [−15, +15] on the 0–100 scale plus the pair count.
 *  @param {Array<import('../types').Game>} games
 *  @param {string} userId
 *  @param {number} myBase   0-100 base score
 *  @param {Map<string,number>} peers  userId → base score
 *  @returns {{adj:number, pairs:number}} */
function pairwiseAdj(games, userId, myBase, peers) {
  let delta = 0, pairs = 0;
  for (const g of games) {
    if (!isRealGame(g) || (g.status !== 'ended' && g.status !== 'settled')) continue;
    if (!g.settlement?.lines) continue;
    const seat = g.players.find((p) => p.userId === userId);
    if (!seat) continue;
    const myLn = g.settlement.lines.find((l) => l.playerId === seat.id);
    if (!myLn || myLn.net == null) continue;
    for (const opp of g.players) {
      if (opp.id === seat.id || !opp.userId) continue;
      const os = peers.get(opp.userId);
      if (os == null) continue;
      const oppLn = g.settlement.lines.find((l) => l.playerId === opp.id);
      if (!oppLn || oppLn.net == null) continue;
      const expected = 1 / (1 + Math.pow(10, (os - myBase) / 30));
      const actual = myLn.net > oppLn.net ? 1 : myLn.net === oppLn.net ? 0.5 : 0;
      delta += actual - expected;
      pairs++;
    }
  }
  if (pairs < 5) return { adj: 15 * 0.5, pairs };
  const avg = delta / pairs;
  return { adj: Math.max(-15, Math.min(15, avg * 30)), pairs };
}
