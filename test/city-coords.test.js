import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestCity } from '../src/lib/city-coords.js';

test('nearestCity maps coordinates to the closest curated city', () => {
  assert.equal(nearestCity(52.37, 4.90).slug, 'amsterdam');
  assert.equal(nearestCity(51.92, 4.48).slug, 'rotterdam');
  assert.equal(nearestCity(51.507, -0.128).slug, 'london');
  assert.equal(nearestCity(40.71, -74.01).slug, 'new-york');
  // Utrecht is closer to Amsterdam-ish centre than Rotterdam:
  assert.equal(nearestCity(52.09, 5.12).slug, 'utrecht');
});

test('nearestCity returns null when far from every listed city', () => {
  assert.equal(nearestCity(0, 0), null);          // Gulf of Guinea — nowhere near
  assert.equal(nearestCity(-33.87, 151.21), null); // Sydney — no curated city nearby
  assert.equal(nearestCity(NaN, 5), null);
});
