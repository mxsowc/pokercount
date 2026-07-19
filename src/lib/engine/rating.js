// Opponent-based skill rating — Weng–Lin online Bayesian rating, Bradley–Terry
// full pairing (the model behind `openskill`). Each finished game is ONE ranked
// match; a player's skill is a Gaussian (mu = estimated skill, sigma = how unsure
// we are) updated against everyone they actually faced. Pure + deterministic:
// the same game history always yields the same ratings, so ratings are a replay of
// history with no stored mutable state to drift. See docs/rating-system-design.md.
//
// The rating consumes ONLY finishing order within a match — never money amounts or
// format — so cash (rank by net) and tournaments (rank by place) feed one rating
// with nothing to normalise, and stakes/payouts can't distort skill.

import { isRealGame } from './stats.js';

export const MU0 = 25;               // starting skill of a brand-new player
export const SIGMA0 = 25 / 3;        // starting uncertainty (~8.333)
const BETA = SIGMA0 / 2;             // performance noise (skill → result)
const BETA2 = BETA * BETA;
const TAU = SIGMA0 / 100;            // per-match dynamics: ratings never fully freeze
const TAU2 = TAU * TAU;
const KAPPA = 0.0001;                // floor so sigma^2 can't collapse to exactly 0

/** Conservative skill used for ordering/level: mu discounted by uncertainty, so a
 *  new/unproven player ranks low until they've earned confidence.
 *  @param {number} mu @param {number} sigma @param {number} [z] @returns {number} */
export function ordinal(mu, sigma, z = 3) { return mu - z * sigma; }

/** Update ONE ranked match. `entries`: [{ mu, sigma, rank }] where a LOWER rank is a
 *  better finish (1 = winner) and equal ranks = a tie. Returns new [{ mu, sigma }] in
 *  the SAME order. Pure — never mutates the input. O(n^2) in table size (tiny here).
 *  @param {{mu:number,sigma:number,rank:number}[]} entries @returns {{mu:number,sigma:number}[]} */
export function rateMatch(entries) {
  const n = entries.length;
  const mu = entries.map((e) => e.mu);
  // Inflate uncertainty by the dynamics term before updating.
  const s2 = entries.map((e) => e.sigma * e.sigma + TAU2);
  const rank = entries.map((e) => e.rank);
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    let omega = 0, delta = 0;
    for (let q = 0; q < n; q++) {
      if (q === i) continue;
      const c2 = s2[i] + s2[q] + 2 * BETA2;
      const c = Math.sqrt(c2);
      const p = 1 / (1 + Math.exp((mu[q] - mu[i]) / c)); // P(i beats q)
      // Actual result of i vs q from the finishing order: win / tie / loss.
      const s = rank[q] > rank[i] ? 1 : rank[q] < rank[i] ? 0 : 0.5;
      const gamma = Math.sqrt(s2[i]) / c;
      omega += (s2[i] / c) * (s - p);
      delta += (gamma * s2[i] / c2) * p * (1 - p);
    }
    const newMu = mu[i] + omega;
    const newS2 = s2[i] * Math.max(1 - delta, KAPPA);
    out[i] = { mu: newMu, sigma: Math.sqrt(newS2) };
  }
  return out;
}

/** Per-player finishing rank for a finished game (1 = best; ties share a rank).
 *  Cash → by net; tournament → by paid place with all non-cashers tied last.
 *  @param {any} g @returns {Map<string, number>} playerId → rank */
export function ranksForGame(g) {
  const players = g.players || [];
  const rank = new Map();

  if (g.mode === 'tournament' && g.tournament && Array.isArray(g.tournament.places) && g.tournament.places.length) {
    const place = new Map(g.tournament.places.map((pid, i) => [pid, i + 1])); // 1..k
    const nonCasher = g.tournament.places.length + 1; // everyone else ties here
    for (const p of players) rank.set(p.id, place.get(p.id) ?? nonCasher);
    return rank;
  }

  // Cash (or a tournament missing its places): rank by net, standard competition
  // ranking (equal net shares a rank). Prefer the frozen settlement's net.
  const lines = g.settlement && Array.isArray(g.settlement.lines) ? g.settlement.lines : null;
  const netOf = (pid) => {
    if (lines) { const l = lines.find((x) => x.playerId === pid); if (l && l.net != null) return l.net; }
    const fin = g.finalStacks && g.finalStacks[pid] != null ? g.finalStacks[pid] : 0;
    const inv = (g.transactions || []).reduce((s, t) => (t.playerId === pid ? s + (t.amount || 0) : s), 0);
    return fin - inv;
  };
  const sorted = players.map((p) => ({ id: p.id, net: netOf(p.id) })).sort((a, b) => b.net - a.net);
  let cur = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].net < sorted[i - 1].net) cur = i + 1; // gap on strict decrease
    rank.set(sorted[i].id, cur);
  }
  return rank;
}

/** @param {any} g */
function closeAt(g) { return (g.settlement && g.settlement.computedAt) || g.updatedAt || g.createdAt || ''; }

/** Replay every finished, real game in chronological (close) order → each ACCOUNT
 *  player's rating. Only account-linked seats are rated, and a game contributes only
 *  if ≥2 account seats are in it (you need someone to rank against). Deterministic.
 *  With `opts.history`, each user also gets `curve` = ordinal after each rated game.
 *  @param {any[]} games @param {{history?:boolean}} [opts]
 *  @returns {Map<string, {mu:number, sigma:number, games:number, curve:{at:string,ordinal:number}[]}>} */
export function ratePlayers(games, opts = {}) {
  const wantHistory = !!opts.history;
  /** @type {Map<string, {mu:number,sigma:number,games:number,curve:{at:string,ordinal:number}[]}>} */
  const ratings = new Map();
  const get = (uid) => {
    let r = ratings.get(uid);
    if (!r) { r = { mu: MU0, sigma: SIGMA0, games: 0, curve: [] }; ratings.set(uid, r); }
    return r;
  };

  const finished = (games || [])
    .filter((g) => (g.status === 'ended' || g.status === 'settled') && isRealGame(g))
    .slice()
    .sort((a, b) => { const x = closeAt(a), y = closeAt(b); return x < y ? -1 : x > y ? 1 : 0; });

  for (const g of finished) {
    const rankMap = ranksForGame(g);
    // Distinct account seats (one seat per account is the invariant; dedupe anyway).
    const seen = new Set();
    const seats = [];
    for (const p of (g.players || [])) {
      if (!p.userId || seen.has(p.userId)) continue;
      seen.add(p.userId);
      seats.push(p);
    }
    if (seats.length < 2) continue;

    const entries = seats.map((p) => {
      const r = get(p.userId);
      return { userId: p.userId, mu: r.mu, sigma: r.sigma, rank: rankMap.get(p.id) ?? (seats.length + 1) };
    });
    const updated = rateMatch(entries);
    for (let i = 0; i < entries.length; i++) {
      const r = get(entries[i].userId);
      r.mu = updated[i].mu;
      r.sigma = updated[i].sigma;
      r.games += 1;
      if (wantHistory) r.curve.push({ at: closeAt(g), ordinal: ordinal(r.mu, r.sigma) });
    }
  }
  return ratings;
}
