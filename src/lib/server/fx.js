// Exchange rates for cross-currency profile stats.
//
// A player's lifetime stats sum games that may be in different currencies, so we
// convert each game's net into their most-used currency. Rates are refreshed
// from a free, key-less API roughly once a month and cached on disk
// (DATA_DIR/fx-rates.json) so a fetch failure or offline boot still works — and a
// built-in static table backstops the very first run. "Somewhat accurate" by
// design: home-game P&L doesn't need intraday precision.
//
// Everything is keyed to a EUR base: rates[X] = how many X you get for €1.
// Conversion is pure (convertWith / convertSymbols) so it's trivially testable;
// the fetch/persist/schedule plumbing wraps that core.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';
import { SYMBOL_TO_ISO } from '../utils/currencies.js';

const FILE = join(DATA_DIR, 'fx-rates.json');
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // a month

// Static fallback (EUR base, units per €1). Rough mid-rates — only used until the
// first live refresh writes fx-rates.json. Covers every symbol in SYMBOL_TO_ISO.
const STATIC_RATES = {
  EUR: 1, USD: 1.08, GBP: 0.85, PLN: 4.3, CHF: 0.97, JPY: 168, INR: 90,
  SEK: 11.4, NOK: 11.6, DKK: 7.46, CAD: 1.48, AUD: 1.65, TRY: 35, BRL: 5.9,
  RUB: 98, KRW: 1470, ILS: 4.0, CZK: 25.2, HUF: 395, THB: 39, ZAR: 20, CNY: 7.8,
};

/** @typedef {{ base: string, rates: Record<string, number>, fetchedAt: string | null }} RateSnapshot */

/** @type {RateSnapshot | null} */
let cache = null;

/** Load the on-disk snapshot once (then keep it in memory); fall back to the
 *  static table. Never throws — bad/missing file just means static rates.
 *  @returns {RateSnapshot} */
export function getRates() {
  if (cache) return cache;
  if (existsSync(FILE)) {
    try {
      const data = JSON.parse(readFileSync(FILE, 'utf8'));
      if (data && data.rates && data.rates.EUR) {
        cache = { base: 'EUR', rates: data.rates, fetchedAt: data.fetchedAt || null };
        return cache;
      }
    } catch { /* corrupt — fall through to static */ }
  }
  cache = { base: 'EUR', rates: { ...STATIC_RATES }, fetchedAt: null };
  return cache;
}

/** Convert `amount` from one ISO code to another using a EUR-based rate map.
 *  Returns null if either side is missing a rate (caller treats as non-money).
 *  @param {Record<string, number>} rates @param {number} amount
 *  @param {string} fromIso @param {string} toIso @returns {number | null} */
export function convertWith(rates, amount, fromIso, toIso) {
  if (fromIso === toIso) return amount;
  const rf = rates[fromIso];
  const rt = rates[toIso];
  if (!rf || !rt) return null;
  return (amount / rf) * rt; // → EUR → target
}

/** Convert between two unit *symbols* (a game's `unit`). Non-convertible units
 *  (Bitcoin, chips, big blinds, custom text) yield null.
 *  @param {Record<string, number>} rates @param {number} amount
 *  @param {string} fromSym @param {string} toSym @returns {number | null} */
export function convertSymbols(rates, amount, fromSym, toSym) {
  const fromIso = SYMBOL_TO_ISO[fromSym];
  const toIso = SYMBOL_TO_ISO[toSym];
  if (!fromIso || !toIso) return null;
  return convertWith(rates, amount, fromIso, toIso);
}

/** A converter bound to the current rate snapshot, shaped for the stats engine:
 *  `(amount, fromSymbol, toSymbol) => number | null`.
 *  @returns {(amount: number, from: string, to: string) => number | null} */
export function converter() {
  const { rates } = getRates();
  return (amount, from, to) => convertSymbols(rates, amount, from, to);
}

// ---- refresh -----------------------------------------------------------------

let refreshing = false;
/** Fetch fresh EUR-based rates and persist them. Never throws. Returns true on a
 *  successful update.  @returns {Promise<boolean>} */
export async function refreshRates() {
  if (refreshing) return false;
  refreshing = true;
  try {
    // open.er-api.com: free, no key, EUR base, covers all our fiat (incl. RUB).
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.result !== 'success' || !data.rates || !data.rates.EUR) {
      throw new Error('unexpected payload');
    }
    // Keep only the ISO codes we actually map a symbol to, so the file stays tiny.
    const wanted = new Set(Object.values(SYMBOL_TO_ISO).concat(Object.keys(STATIC_RATES)));
    /** @type {Record<string, number>} */
    const rates = {};
    for (const iso of wanted) {
      const v = data.rates[iso];
      if (typeof v === 'number' && v > 0) rates[iso] = v;
    }
    rates.EUR = 1;
    const snapshot = { base: 'EUR', rates, fetchedAt: new Date().toISOString() };
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    renameSync(tmp, FILE); // atomic publish
    cache = snapshot;
    console.log(`[fx] refreshed ${Object.keys(rates).length} rates (€ base)`);
    return true;
  } catch (e) {
    console.error('[fx] refresh failed:', e instanceof Error ? e.message : e);
    return false;
  } finally {
    refreshing = false;
  }
}

/** True when we've never fetched or the snapshot is older than a month. */
function isStale() {
  const { fetchedAt } = getRates();
  if (!fetchedAt) return true;
  const age = Date.now() - Date.parse(fetchedAt);
  return !(age >= 0) || age > REFRESH_AFTER_MS;
}

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
/** Start the monthly refresh loop. Like the backup scheduler, it only auto-runs
 *  in the built production server (so dev/tests make no network calls) and is
 *  idempotent — it checks daily but only fetches when the snapshot is >1 month
 *  old, so restarts never hammer the API. */
export function startFxScheduler() {
  if (process.env.PC_FX_DISABLE === '1') return;
  if (process.env.NODE_ENV !== 'production' && process.env.PC_FX_FORCE !== '1') return;
  if (timer) return;
  const tick = () => { if (isStale()) refreshRates(); };
  setTimeout(tick, 15_000); // shortly after boot
  timer = setInterval(tick, 24 * 60 * 60 * 1000); // daily check; monthly guard makes it a no-op in between
  if (typeof timer.unref === 'function') timer.unref();
}
