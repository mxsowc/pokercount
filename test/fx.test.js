// Currency conversion (server/fx.js pure core) + the stats engine reporting in a
// player's most-used currency. No network/disk — rates are passed in explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertWith, convertSymbols } from '../src/lib/server/fx.js';
import { isConvertibleUnit, currencyForCountry, cryptoTicker } from '../src/lib/utils/currencies.js';
import { computeUserStats } from '../src/lib/engine/stats.js';

// €1 = $2 = 4 zł in this toy table (EUR base, units per €1).
const RATES = { EUR: 1, USD: 2, PLN: 4 };

test('convertWith: EUR-based cross conversion + missing rates → null', () => {
  assert.equal(convertWith(RATES, 10, 'EUR', 'EUR'), 10, 'same currency is identity');
  assert.equal(convertWith(RATES, 10, 'USD', 'EUR'), 5, '$10 → €5');
  assert.equal(convertWith(RATES, 10, 'EUR', 'PLN'), 40, '€10 → 40 zł');
  assert.equal(convertWith(RATES, 8, 'USD', 'PLN'), 16, '$8 → €4 → 16 zł');
  assert.equal(convertWith(RATES, 10, 'EUR', 'JPY'), null, 'no JPY rate → null');
});

test('convertSymbols: symbols map to ISO; non-money units → null', () => {
  assert.equal(convertSymbols(RATES, 10, '$', '€'), 5);
  assert.equal(convertSymbols(RATES, 10, '€', 'zł'), 40);
  assert.equal(convertSymbols(RATES, 10, 'chips', '€'), null, 'chips have no rate');
  assert.equal(convertSymbols(RATES, 10, 'BB', '€'), null, 'big blinds have no rate');
  assert.equal(convertSymbols(RATES, 10, '₿', '€'), null, 'Bitcoin is left out');
});

test('unit classification: fiat vs crypto vs play-money', () => {
  // fiat we can convert
  assert.equal(isConvertibleUnit('€'), true);
  assert.equal(isConvertibleUnit('$'), true);
  // crypto → its own ticker (symbol, lowercase, and uppercase all resolve)
  assert.equal(cryptoTicker('₿'), 'BTC');
  assert.equal(cryptoTicker('btc'), 'BTC');
  assert.equal(cryptoTicker('ETH'), 'ETH');
  // play money: big blinds, chips, and arbitrary custom text → not fiat, not crypto
  assert.equal(isConvertibleUnit('BB'), false);
  assert.equal(cryptoTicker('BB'), null);
  assert.equal(cryptoTicker('chips'), null);
  assert.equal(cryptoTicker('gummybears'), null);
});

test('isConvertibleUnit / currencyForCountry', () => {
  assert.equal(isConvertibleUnit('€'), true);
  assert.equal(isConvertibleUnit('$'), true);
  assert.equal(isConvertibleUnit('chips'), false);
  assert.equal(isConvertibleUnit('₿'), false);
  assert.equal(currencyForCountry('PL'), 'zł');
  assert.equal(currencyForCountry('US'), '$');
  assert.equal(currencyForCountry('DE'), '€', 'eurozone → €');
  assert.equal(currencyForCountry('Poland'), 'zł', 'falls back to name match');
  assert.equal(currencyForCountry('MX'), '€', "currency we don't carry a symbol for → €");
  assert.equal(currencyForCountry(null), '€');
});

// Build a balanced 2-player game (real table) where user `u` nets `net` in `unit`.
let seq = 0;
function gameFor(unit, net, at) {
  const id = 'G' + ++seq;
  return {
    id, name: id, status: 'ended', unit, updatedAt: at,
    players: [{ id: 'pu', name: 'u', userId: 'u' }, { id: 'po', name: 'o', userId: 'o' }],
    transactions: [
      { id: 'a' + id, playerId: 'pu', amount: 100, type: 'buyin' },
      { id: 'b' + id, playerId: 'po', amount: 100, type: 'buyin' },
    ],
    finalStacks: { pu: 100 + net, po: 100 - net },
  };
}

test('stats: reports in most-used currency, converting the rest', () => {
  const conv = (amt, from, to) => convertSymbols(RATES, amt, from, to);
  const games = [
    gameFor('$', 20, '2024-01-01'),  // +$20
    gameFor('$', -4, '2024-01-02'),  // -$4
    gameFor('€', 10, '2024-01-03'),  // +€10  → +$20 after conversion
  ];
  const s = computeUserStats(games, 'u', conv);
  assert.equal(s.unit, '$', 'USD is the most-used currency (2 of 3 games)');
  assert.equal(s.gamesPlayed, 3);
  assert.equal(s.otherGames, 0);
  assert.equal(s.totalProfit, 36, '20 − 4 + (€10→$20)');
  assert.equal(s.best.net, 20);
  assert.equal(s.worst.net, -4);
});

test('stats: non-convertible games are excluded but still listed', () => {
  const conv = (amt, from, to) => convertSymbols(RATES, amt, from, to);
  const games = [
    gameFor('€', 10, '2024-01-01'),       // money
    gameFor('chips', 1000, '2024-01-02'), // not money
  ];
  const s = computeUserStats(games, 'u', conv);
  assert.equal(s.unit, '€');
  assert.equal(s.gamesPlayed, 1, 'only the € game counts toward profit');
  assert.equal(s.otherGames, 1, 'the chips game is set aside');
  assert.equal(s.totalProfit, 10, 'chips never inflate the money total');
  const chips = s.recent.find((r) => r.unit === 'chips');
  assert.ok(chips && chips.net === 1000, 'chips game still appears, in its own unit');
});
