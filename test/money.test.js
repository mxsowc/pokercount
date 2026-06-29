// Tests for parseAmount — the money-input parser used for every buy-in, top-up,
// final stack and settlement edit on the game screen. The old inline version
// stripped any separator before three digits and so silently turned "10.000"
// into 10000 (a 1000× error that the server's isMoney() guard then accepted).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../src/lib/utils/money.ts';

test('parseAmount: plain numbers and simple decimals', () => {
  assert.equal(parseAmount('20'), 20);
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount('12.50'), 12.5);
  assert.equal(parseAmount('0.05'), 0.05);
  assert.equal(parseAmount('0.5'), 0.5);
  assert.equal(parseAmount('1.2345'), 1.2345);
  assert.equal(parseAmount('100'), 100);
});

test('parseAmount: 3-decimal inputs are NOT mangled (the regression)', () => {
  // These all broke before (×1000). The dot is the decimal point.
  assert.equal(parseAmount('10.000'), 10);
  assert.equal(parseAmount('0.500'), 0.5);
  assert.equal(parseAmount('1.250'), 1.25);
  assert.equal(parseAmount('2.005'), 2.005);
  assert.equal(parseAmount('100.000'), 100);
});

test('parseAmount: comma as decimal separator (phone keypads)', () => {
  assert.equal(parseAmount('5,55'), 5.55);
  assert.equal(parseAmount('0,5'), 0.5);
  assert.equal(parseAmount('12,50'), 12.5);
});

test('parseAmount: thousands separators (grouping)', () => {
  assert.equal(parseAmount('1,000'), 1000);
  assert.equal(parseAmount('1,000,000'), 1000000);
  assert.equal(parseAmount('12,000'), 12000);
  assert.equal(parseAmount('1 000'), 1000);   // space grouping
  assert.equal(parseAmount('1.000.000'), 1000000); // dot grouping (multiple dots)
});

test('parseAmount: mixed separators — last one is the decimal point', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56); // EU: dot grouping, comma decimal
  assert.equal(parseAmount('1,234.56'), 1234.56); // US: comma grouping, dot decimal
  assert.equal(parseAmount('1.000.000,50'), 1000000.5);
});

test('parseAmount: empty / junk → NaN (rejected by > 0 checks)', () => {
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('   ')));
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount(null)));
  assert.ok(Number.isNaN(parseAmount(undefined)));
});
