// Player reports. Same file-backed pattern as comments/reactions: an in-memory
// array written through to one JSON file. Each report is a stranger/peer flagging
// another account; they land in the admin panel for review.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './paths.js';
import { writeFileDurable } from './fsutil.js';
import { join } from 'node:path';

const FILE = join(DATA_DIR, 'reports.json');
const MAX_MSG = 1000;

/** @typedef {{ id: string, reporterId: string, reportedId: string, reason: string, message: string, at: string, status: 'open'|'closed' }} Report */
/** @type {Report[]} */
let reports = [];
const rid = () => randomBytes(8).toString('hex');

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileDurable(FILE, JSON.stringify(reports, null, 2));
}

export function init() {
  if (!existsSync(FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    if (Array.isArray(data)) reports = data;
  } catch (err) {
    throw new Error(`[reports] refusing to start: ${FILE} is unreadable (${err instanceof Error ? err.message : err}). Restore or remove it.`);
  }
  return reports.length;
}

/** File a report. Idempotent: one OPEN report per reporter→reported pair (a
 *  repeat just updates the message), so a single user can't flood the queue.
 *  @param {{ reporterId: string, reportedId: string, reason: string, message?: string }} r
 *  @returns {Report} */
export function addReport({ reporterId, reportedId, reason, message }) {
  const msg = String(message || '').trim().slice(0, MAX_MSG);
  const existing = reports.find((r) => r.reporterId === reporterId && r.reportedId === reportedId && r.status === 'open');
  if (existing) {
    existing.reason = reason;
    existing.message = msg;
    existing.at = new Date().toISOString();
    persist();
    return existing;
  }
  /** @type {Report} */
  const rep = { id: rid(), reporterId, reportedId, reason, message: msg, at: new Date().toISOString(), status: 'open' };
  reports.push(rep);
  persist();
  return rep;
}

/** @returns {Report[]} */
export function allReports() { return reports; }

/** Mark a report resolved (closed) so it drops out of the open queue.
 *  @param {string} id @returns {boolean} */
export function closeReport(id) {
  const r = reports.find((x) => x.id === id);
  if (!r || r.status === 'closed') return false;
  r.status = 'closed';
  persist();
  return true;
}

/** Drop every report authored BY or filed ABOUT a (deleted) account.
 *  @param {string} userId @returns {boolean} whether anything changed */
export function removeUser(userId) {
  const before = reports.length;
  reports = reports.filter((r) => r.reporterId !== userId && r.reportedId !== userId);
  const changed = reports.length !== before;
  if (changed) persist();
  return changed;
}
