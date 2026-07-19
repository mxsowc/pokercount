import test from 'node:test';
import assert from 'node:assert/strict';
import { rateMatch, ranksForGame, ratePlayers, ordinal, MU0, SIGMA0 } from '../src/lib/engine/rating.js';

const fresh = () => ({ mu: MU0, sigma: SIGMA0 });

test('rateMatch: winner gains, loser drops, both grow more certain', () => {
  const [w, l] = rateMatch([{ ...fresh(), rank: 1 }, { ...fresh(), rank: 2 }]);
  assert.ok(w.mu > MU0, 'winner mu up');
  assert.ok(l.mu < MU0, 'loser mu down');
  assert.ok(w.sigma < SIGMA0 && l.sigma < SIGMA0, 'both sigma shrink');
  // Equal starting skill → symmetric swing.
  assert.ok(Math.abs((w.mu - MU0) - (MU0 - l.mu)) < 1e-9, 'symmetric for equal players');
});

test('rateMatch: a tie between equals barely moves mu but tightens sigma', () => {
  const [a, b] = rateMatch([{ ...fresh(), rank: 1 }, { ...fresh(), rank: 1 }]);
  assert.ok(Math.abs(a.mu - MU0) < 1e-9 && Math.abs(b.mu - MU0) < 1e-9, 'mu unchanged on equal tie');
  assert.ok(a.sigma < SIGMA0, 'sigma still shrinks from information');
});

test('rateMatch: beating a STRONGER field gains more than beating a weaker one', () => {
  const me = { mu: 25, sigma: 3 };
  const strong = { mu: 40, sigma: 3 };
  const weak = { mu: 10, sigma: 3 };
  const gainVsStrong = rateMatch([{ ...me, rank: 1 }, { ...strong, rank: 2 }])[0].mu - me.mu;
  const gainVsWeak = rateMatch([{ ...me, rank: 1 }, { ...weak, rank: 2 }])[0].mu - me.mu;
  assert.ok(gainVsStrong > gainVsWeak, `${gainVsStrong} > ${gainVsWeak}`);
  assert.ok(gainVsWeak > 0, 'still a small gain for an expected win');
});

test('rateMatch: no farming — repeatedly beating a much weaker player converges to ~0 gain', () => {
  let me = { mu: 25, sigma: 3 };
  const weak = { mu: 5, sigma: 3 }; // fixed weak opponent
  let firstGain = null, lastGain = null;
  for (let i = 0; i < 40; i++) {
    const before = me.mu;
    me = rateMatch([{ ...me, rank: 1 }, { ...weak, rank: 2 }])[0];
    const gain = me.mu - before;
    if (i === 0) firstGain = gain;
    lastGain = gain;
  }
  assert.ok(lastGain < firstGain, 'gains shrink over repeated wins');
  assert.ok(lastGain < 0.05, `converged to a negligible gain (${lastGain})`);
});

test('rateMatch: multiplayer order is respected (1st > 2nd > 3rd)', () => {
  const r = rateMatch([{ ...fresh(), rank: 1 }, { ...fresh(), rank: 2 }, { ...fresh(), rank: 3 }]);
  assert.ok(r[0].mu > r[1].mu && r[1].mu > r[2].mu, 'mu ordered by finish');
  // Middle place lands near the start (won one, lost one).
  assert.ok(Math.abs(r[1].mu - MU0) < Math.abs(r[0].mu - MU0), 'middle moves least');
});

test('rateMatch is pure + deterministic', () => {
  const input = [{ ...fresh(), rank: 1 }, { mu: 30, sigma: 5, rank: 2 }];
  const a = rateMatch(input.map((e) => ({ ...e })));
  const b = rateMatch(input.map((e) => ({ ...e })));
  assert.deepEqual(a, b, 'same input → same output');
  assert.equal(input[0].mu, MU0, 'input not mutated');
});

test('ordinal discounts uncertainty (unproven player ranks below a proven equal)', () => {
  assert.ok(ordinal(30, 2) > ordinal(30, 6), 'lower sigma → higher conservative skill');
});

// ---- ranking a real game --------------------------------------------------

test('ranksForGame: cash ranks by net (settlement lines), ties share a rank', () => {
  const g = {
    status: 'settled',
    players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    settlement: { lines: [{ playerId: 'a', net: 50 }, { playerId: 'b', net: -20 }, { playerId: 'c', net: -20 }] },
  };
  const r = ranksForGame(g);
  assert.equal(r.get('a'), 1);
  assert.equal(r.get('b'), 2);
  assert.equal(r.get('c'), 2, 'equal net → tied rank');
});

test('ranksForGame: tournament ranks by place, all non-cashers tied last (rebuys ignored for order)', () => {
  const g = {
    status: 'ended',
    mode: 'tournament',
    tournament: { payouts: [70, 30], places: ['w', 'r'] }, // w=1st, r=2nd paid
    players: [{ id: 'w' }, { id: 'r' }, { id: 'x' }, { id: 'y' }],
    // x rebought (more invested) than y — must NOT change their tied rank.
    settlement: { lines: [{ playerId: 'w', net: 60 }, { playerId: 'r', net: 10 }, { playerId: 'x', net: -40 }, { playerId: 'y', net: -20 }] },
  };
  const r = ranksForGame(g);
  assert.equal(r.get('w'), 1);
  assert.equal(r.get('r'), 2);
  assert.equal(r.get('x'), 3);
  assert.equal(r.get('y'), 3, 'non-cashers tied regardless of rebuy/net');
});

// ---- replay over a history ------------------------------------------------

function cashGame(id, at, results /* [{seat,user,net}] */) {
  return {
    id, status: 'settled', updatedAt: at,
    players: results.map((r) => ({ id: r.seat, userId: r.user })),
    transactions: results.flatMap((r) => [
      { playerId: r.seat, amount: 100, type: 'buyin' },
      { playerId: r.seat, amount: 100, type: 'buyin' }, // ≥2 buy-ins → isRealGame
    ]),
    finalStacks: Object.fromEntries(results.map((r) => [r.seat, 200 + r.net])),
    settlement: { computedAt: at, lines: results.map((r) => ({ playerId: r.seat, net: r.net })) },
  };
}

test('ratePlayers: replay is deterministic and ranks a consistent winner on top', () => {
  const games = [
    cashGame('g1', '2026-01-01T00:00:00Z', [{ seat: 's1', user: 'alice', net: 100 }, { seat: 's2', user: 'bob', net: -100 }]),
    cashGame('g2', '2026-01-02T00:00:00Z', [{ seat: 's3', user: 'alice', net: 80 }, { seat: 's4', user: 'bob', net: -80 }]),
    cashGame('g3', '2026-01-03T00:00:00Z', [{ seat: 's5', user: 'alice', net: 60 }, { seat: 's6', user: 'bob', net: -60 }]),
    cashGame('g4', '2026-01-04T00:00:00Z', [{ seat: 's7', user: 'alice', net: 40 }, { seat: 's8', user: 'bob', net: -40 }]),
    cashGame('g5', '2026-01-05T00:00:00Z', [{ seat: 's9', user: 'alice', net: 20 }, { seat: 'sa', user: 'bob', net: -20 }]),
  ];
  const r1 = ratePlayers(games);
  const r2 = ratePlayers(games.slice().reverse()); // order of input list must not matter (sorted by close time)
  assert.equal(r1.get('alice').mu.toFixed(6), r2.get('alice').mu.toFixed(6), 'deterministic regardless of input order');
  assert.ok(ordinal(r1.get('alice').mu, r1.get('alice').sigma) > ordinal(r1.get('bob').mu, r1.get('bob').sigma), 'consistent winner rated higher');
  assert.equal(r1.get('alice').games, 5);
});

test('ratePlayers: games with <2 account seats contribute nothing', () => {
  const g = cashGame('solo', '2026-02-01T00:00:00Z', [{ seat: 's1', user: 'alice', net: 50 }, { seat: 's2', user: null, net: -50 }]);
  const r = ratePlayers([g]);
  assert.equal(r.has('alice'), false, 'no rating from a game with one account seat');
});

test('fuzz: random ranked matches never produce NaN/negative-sigma and keep order sane', () => {
  // Deterministic PRNG (no Math.random — keep tests reproducible).
  let seed = 123456789;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0; t < 2000; t++) {
    const n = 2 + Math.floor(rnd() * 8); // 2..9 players
    const entries = Array.from({ length: n }, () => ({ mu: 5 + rnd() * 40, sigma: 1 + rnd() * 8, rank: 1 + Math.floor(rnd() * n) }));
    const out = rateMatch(entries);
    for (const o of out) {
      assert.ok(Number.isFinite(o.mu), 'mu finite');
      assert.ok(Number.isFinite(o.sigma) && o.sigma > 0, 'sigma finite and positive');
    }
    // A clear sole winner (unique rank 1) must not lose mu.
    const winners = entries.filter((e) => e.rank === 1);
    if (winners.length === 1) {
      const wi = entries.indexOf(winners[0]);
      assert.ok(out[wi].mu >= entries[wi].mu - 1e-9, 'sole winner never drops');
    }
  }
});
