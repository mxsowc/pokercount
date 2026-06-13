import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../src/cards.js';
import { scoreHigh5, scoreLow8_5, cmp, HIGH } from '../src/evaluate.js';

const h = (s) => scoreHigh5(parseCards(s));

test('hand category ordering', () => {
  const sf = h('As Ks Qs Js Ts');
  const quads = h('Ac Ad Ah As Kd');
  const boat = h('Ac Ad Ah Kc Kd');
  const flush = h('As Ks Qs Js 9s');
  const straight = h('As Kd Qc Jh Ts');
  const trips = h('Ac Ad Ah Kc Qd');
  const twoPair = h('Ac Ad Kc Kd Qh');
  const pair = h('Ac Ad Kc Qd Jh');
  const high = h('Ac Kd Qc Jh 9s');

  assert.equal(sf[0], HIGH.STRAIGHT_FLUSH);
  assert.ok(cmp(sf, quads) > 0);
  assert.ok(cmp(quads, boat) > 0);
  assert.ok(cmp(boat, flush) > 0);
  assert.ok(cmp(flush, straight) > 0);
  assert.ok(cmp(straight, trips) > 0);
  assert.ok(cmp(trips, twoPair) > 0);
  assert.ok(cmp(twoPair, pair) > 0);
  assert.ok(cmp(pair, high) > 0);
});

test('wheel straight recognized (A plays low)', () => {
  const wheel = h('Ac 2d 3h 4s 5c');
  assert.equal(wheel[0], HIGH.STRAIGHT);
  assert.equal(wheel[1], 5); // 5-high straight, not ace-high
  const sixHigh = h('2c 3d 4h 5s 6c');
  assert.ok(cmp(sixHigh, wheel) > 0);
});

test('suits never break ties', () => {
  const a = h('As Ks Qs Js 9s'); // ace-high spade flush
  const b = h('Ad Kd Qd Jd 9d'); // ace-high diamond flush
  assert.equal(cmp(a, b), 0);
});

test('full house compares trip rank then pair rank', () => {
  const acesFullKings = h('Ac Ad Ah Kc Kd');
  const acesFullNines = h('Ac Ad Ah 9c 9d');
  assert.ok(cmp(acesFullKings, acesFullNines) > 0);
});

const low = (s) => scoreLow8_5(parseCards(s));

test('8-or-better low qualification and ordering', () => {
  assert.deepEqual(low('Ac 2d 3h 4s 5c'), [5, 4, 3, 2, 1]); // wheel = nut low
  assert.deepEqual(low('8c 7d 6h 5s 4c'), [8, 7, 6, 5, 4]);
  assert.equal(low('9c 5d 4h 3s 2c'), null); // 9 is too high
  assert.equal(low('Ac Ad 3h 4s 5c'), null); // a pair never makes a low
  // smaller array is the better low
  assert.ok(cmp(low('8c 7d 6h 5s 4c'), low('Ac 2d 3h 4s 5c')) > 0);
});
