// Lightweight metadata for a game series (keyed by the normalized series name):
// currently just the crew's next-session date, which any member can set so the
// standings page doubles as an anchor to come back FOR. Games stay the source of
// truth for results; this only holds the few bits that aren't derivable.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';
import { writeFileDurable } from './fsutil.js';

const FILE = join(DATA_DIR, 'series-meta.json');

/** @param {string} name */
function slug(name) { return String(name || '').trim().toLowerCase(); }

function loadAll() {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) || {}; }
  catch (err) { console.error('[seriesmeta] unreadable, starting empty:', err instanceof Error ? err.message : err); }
  return {};
}

/** @param {string} name @returns {{ nextDate: string|null, updatedAt: string|null }} */
export function getSeriesMeta(name) {
  return loadAll()[slug(name)] || { nextDate: null, updatedAt: null };
}

/** @param {string} name @param {string|null} nextDate — an ISO date (YYYY-MM-DD) or null to clear */
export function setSeriesNextDate(name, nextDate) {
  const all = loadAll();
  const key = slug(name);
  // Accept only a plain calendar date; anything else clears it.
  const clean = typeof nextDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nextDate) ? nextDate : null;
  all[key] = { nextDate: clean, updatedAt: new Date().toISOString() };
  writeFileDurable(FILE, JSON.stringify(all, null, 2));
  return all[key];
}
