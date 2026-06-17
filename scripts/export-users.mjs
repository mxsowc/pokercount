#!/usr/bin/env node
// Export the full user dataset as CSV (to stdout): account info, optional email +
// newsletter opt-in, and the optional onboarding answers (age range, country,
// how-heard). Run it on the server so it reads the live data directory:
//
//   node scripts/export-users.mjs              # print CSV
//   node scripts/export-users.mjs > users.csv  # save to a file
//
// Reads users.json from PC_DATA_DIR (default ./data). This data is never exposed
// by the web app — running this script is the way to read it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.PC_DATA_DIR || join(process.cwd(), 'data');

let users = [];
try {
  users = JSON.parse(readFileSync(join(DATA_DIR, 'users.json'), 'utf8'));
} catch (e) {
  console.error(`Could not read ${join(DATA_DIR, 'users.json')}: ${e.message}`);
  process.exit(1);
}

const cols = ['handle', 'displayName', 'provider', 'email', 'newsletter', 'ageRange', 'country', 'heardFrom', 'createdAt'];
const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';

console.log(cols.join(','));
for (const u of users) {
  console.log(cols.map((c) => esc(c === 'newsletter' ? (u[c] ? 'yes' : 'no') : u[c])).join(','));
}
console.error(`\n${users.length} user(s).`);
