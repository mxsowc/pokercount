#!/usr/bin/env node
// Export the consented newsletter list as CSV (to stdout).
//
//   node scripts/export-emails.mjs           # opted-in subscribers only (default)
//   node scripts/export-emails.mjs --all     # everyone who gave an email
//   node scripts/export-emails.mjs > list.csv
//
// Reads the same users.json the app writes (PC_DATA_DIR, default ./data). Run it
// on the server (Render → service → Shell) so it sees the live data directory.
// Emails are never exposed via the web app — this is the only way to read them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.PC_DATA_DIR || join(process.cwd(), 'data');
const all = process.argv.includes('--all');

let users = [];
try {
  users = JSON.parse(readFileSync(join(DATA_DIR, 'users.json'), 'utf8'));
} catch (e) {
  console.error(`Could not read ${join(DATA_DIR, 'users.json')}: ${e.message}`);
  process.exit(1);
}

const rows = users.filter((u) => u.email && (all || u.newsletter));
const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';

console.log('email,displayName,handle,provider,newsletter,createdAt');
for (const u of rows) {
  console.log([u.email, u.displayName, u.handle, u.provider, u.newsletter ? 'yes' : 'no', u.createdAt].map(esc).join(','));
}
console.error(`\n${rows.length} ${all ? 'address(es) with email' : 'opted-in subscriber(s)'} of ${users.length} total users.`);
