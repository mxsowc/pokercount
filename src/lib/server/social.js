// Follow relationships. Same pattern as users.js: in-memory Map, written
// through to a single JSON file on every change.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';

import { DATA_DIR } from "./paths.js";
import { join } from "node:path";
const FILE = join(DATA_DIR, 'follows.json');

/** @type {Map<string, Set<string>>} userId -> Set<followedUserId> */
const following = new Map();

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  /** @type {Record<string, string[]>} */
  const obj = {};
  for (const [uid, set] of following) {
    if (set.size > 0) obj[uid] = [...set];
  }
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, FILE);
}

export function init() {
  if (!existsSync(FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const [uid, ids] of Object.entries(data)) {
      if (Array.isArray(ids) && ids.length) following.set(uid, new Set(ids));
    }
  } catch (err) {
    // Same reasoning as the user store: one shared file, so a parse failure that
    // silently empties the follow graph is a data-loss footgun. Fail fast.
    throw new Error(`[social] refusing to start: ${FILE} is unreadable (${err instanceof Error ? err.message : err}). Restore or remove it.`);
  }
  return following.size;
}

/** @param {string} userId @param {string} targetId @returns {boolean} */
export function follow(userId, targetId) {
  if (userId === targetId) return false;
  let set = following.get(userId);
  if (!set) { set = new Set(); following.set(userId, set); }
  if (set.has(targetId)) return false; // already following
  set.add(targetId);
  persist();
  return true;
}

/** @param {string} userId @param {string} targetId @returns {boolean} */
export function unfollow(userId, targetId) {
  const set = following.get(userId);
  if (!set || !set.has(targetId)) return false;
  set.delete(targetId);
  if (set.size === 0) following.delete(userId);
  persist();
  return true;
}

/** @param {string} userId @returns {Set<string>} */
export function getFollowing(userId) {
  return following.get(userId) || new Set();
}

/** @param {string} userId @returns {number} */
export function getFollowingCount(userId) {
  const set = following.get(userId);
  return set ? set.size : 0;
}

/** @param {string} targetId @returns {string[]} */
export function getFollowers(targetId) {
  /** @type {string[]} */
  const result = [];
  for (const [uid, set] of following) {
    if (set.has(targetId)) result.push(uid);
  }
  return result;
}

/** @param {string} targetId @returns {number} */
export function getFollowerCount(targetId) {
  let count = 0;
  for (const set of following.values()) {
    if (set.has(targetId)) count++;
  }
  return count;
}

/** @param {string} userId @param {string} targetId @returns {boolean} */
export function isFollowing(userId, targetId) {
  const set = following.get(userId);
  return set ? set.has(targetId) : false;
}
