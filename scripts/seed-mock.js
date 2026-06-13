#!/usr/bin/env node
// Generates 30 realistic mock users, follow relationships, and finished games.
// Run: node scripts/seed-mock.js
// WARNING: overwrites data/users.json, data/follows.json, and creates game files.

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Clean old game files (keep .session-secret)
for (const f of readdirSync(DATA_DIR)) {
  if (f.endsWith('.json')) unlinkSync(join(DATA_DIR, f));
}

function uid(n = 10) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += A[b[i] % A.length];
  return s;
}

function hashPin(pin) {
  const salt = randomBytes(16);
  const h = scryptSync(String(pin), salt, 32);
  return salt.toString('hex') + ':' + h.toString('hex');
}

function daysAgo(d) {
  return new Date(Date.now() - d * 86400000).toISOString();
}

function pick(arr, n) {
  const copy = [...arr];
  const result = [];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

// ---- 30 users ---------------------------------------------------------------
const NAMES = [
  ['Kaylem', 'kaylem'], ['Sofia', 'sofia'], ['Jake', 'jake_p'],
  ['Mia', 'mia'], ['Liam', 'liam'], ['Emma', 'emma_k'],
  ['Noah', 'noah'], ['Ava', 'ava'], ['Oliver', 'oliver'],
  ['Isabella', 'isabella'], ['Lucas', 'lucas_r'], ['Charlotte', 'charlotte'],
  ['Ethan', 'ethan'], ['Amelia', 'amelia'], ['Mason', 'mason'],
  ['Harper', 'harper_j'], ['Logan', 'logan'], ['Evelyn', 'evelyn'],
  ['James', 'james_b'], ['Aria', 'aria'], ['Aiden', 'aiden'],
  ['Ella', 'ella'], ['Ben', 'ben_w'], ['Scarlett', 'scarlett'],
  ['Jackson', 'jackson'], ['Grace', 'grace_m'], ['Daniel', 'daniel'],
  ['Lily', 'lily'], ['Henry', 'henry_t'], ['Zoey', 'zoey'],
];

const users = NAMES.map(([displayName, handle], i) => ({
  id: uid(),
  handle,
  displayName,
  provider: 'local',
  providerSub: null,
  pinHash: hashPin('0000'), // all passwords are 0000
  avatar: null,
  createdAt: daysAgo(60 - i),
}));

writeFileSync(join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));
console.log(`Created ${users.length} users (password: 0000 for all)`);

// ---- follows ----------------------------------------------------------------
// Core group (first 15) follow each other heavily.
// Outer group (16-25) follow a few from the core.
// Loners (26-30) follow 0-1 people.
const follows = {};

for (let i = 0; i < 15; i++) {
  const targets = pick(users.filter((_, j) => j !== i && j < 20), 6 + Math.floor(Math.random() * 8));
  follows[users[i].id] = targets.map((u) => u.id);
}
for (let i = 15; i < 25; i++) {
  const targets = pick(users.filter((_, j) => j !== i && j < 15), 2 + Math.floor(Math.random() * 4));
  follows[users[i].id] = targets.map((u) => u.id);
}
// users 25-29 follow 0-1 people (loners)
follows[users[25].id] = [users[0].id];
follows[users[27].id] = [users[1].id];

writeFileSync(join(DATA_DIR, 'follows.json'), JSON.stringify(follows, null, 2));
const totalFollows = Object.values(follows).reduce((s, arr) => s + arr.length, 0);
console.log(`Created ${totalFollows} follow relationships`);

// ---- games ------------------------------------------------------------------
const GAME_NAMES = [
  'Friday Night PLO', 'Saturday Showdown', 'Tuesday Tilt',
  'High Stakes Home Game', 'Micro Madness', 'Sunday Special',
  'Midweek Grind', 'The Big Game', 'Casual Thursday',
  'Late Night Session', 'Weekend Warriors', 'Monthly Main Event',
  'Lunch Break Poker', 'Holiday Special', 'New Year Knockout',
];

const games = [];

for (let g = 0; g < 20; g++) {
  const gameId = String(1000 + Math.floor(Math.random() * 8999));
  if (games.some((x) => x.id === gameId)) continue;

  const nPlayers = 3 + Math.floor(Math.random() * 6); // 3-8 players
  const playerPool = pick(users.slice(0, 25), nPlayers); // mostly from active users
  const buyIn = [10, 15, 20, 25, 50][Math.floor(Math.random() * 5)];
  const ago = 1 + Math.floor(Math.random() * 45); // 1-45 days ago
  const created = daysAgo(ago);
  const ended = daysAgo(ago - 0.2); // ended a few hours later

  const players = playerPool.map((u) => ({
    id: uid(6),
    name: u.displayName,
    userId: u.id,
  }));

  // Each player buys in; some top up
  const transactions = [];
  for (const p of players) {
    transactions.push({
      id: uid(8),
      playerId: p.id,
      amount: buyIn,
      type: 'buyin',
      at: created,
    });
    if (Math.random() < 0.3) {
      transactions.push({
        id: uid(8),
        playerId: p.id,
        amount: buyIn,
        type: 'topup',
        at: created,
      });
    }
  }

  const totalIn = transactions.reduce((s, t) => s + t.amount, 0);

  // Distribute final stacks: random split that sums to totalIn
  const finalStacks = {};
  let remaining = totalIn;
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  for (let i = 0; i < shuffled.length; i++) {
    if (i === shuffled.length - 1) {
      finalStacks[shuffled[i].id] = Math.max(0, remaining);
    } else {
      const maxShare = Math.min(remaining, totalIn * 0.6);
      const share = Math.round(Math.random() * maxShare * 100) / 100;
      finalStacks[shuffled[i].id] = share;
      remaining -= share;
    }
  }

  // Compute settlement lines
  const lines = players.map((p) => {
    const invested = transactions.filter((t) => t.playerId === p.id).reduce((s, t) => s + t.amount, 0);
    const fs = finalStacks[p.id] || 0;
    return {
      playerId: p.id,
      name: p.name,
      invested,
      finalStack: Math.round(fs * 100) / 100,
      net: Math.round((fs - invested) * 100) / 100,
    };
  });

  // Compute transfers (greedy matching)
  const debtors = lines.filter((l) => l.net < 0).map((l) => ({ ...l, owe: Math.round(-l.net * 100) }));
  const creditors = lines.filter((l) => l.net > 0).map((l) => ({ ...l, owed: Math.round(l.net * 100) }));
  const transfers = [];
  for (const d of debtors) {
    for (const c of creditors) {
      if (d.owe <= 0 || c.owed <= 0) continue;
      const amt = Math.min(d.owe, c.owed);
      transfers.push({
        id: uid(8),
        from: d.playerId, fromName: d.name,
        to: c.playerId, toName: c.name,
        amount: amt / 100,
        paid: Math.random() < 0.7,
        paidAt: Math.random() < 0.7 ? ended : null,
        paidBy: null,
      });
      d.owe -= amt;
      c.owed -= amt;
    }
  }

  const allPaid = transfers.every((t) => t.paid);

  const game = {
    id: gameId,
    name: GAME_NAMES[g % GAME_NAMES.length],
    unit: '\u20ac',
    status: allPaid ? 'settled' : 'ended',
    hostId: 'user:' + playerPool[0].id,
    ownerId: playerPool[0].id,
    createdAt: created,
    updatedAt: ended,
    version: 3,
    players,
    transactions,
    finalStacks,
    settlement: {
      computedAt: ended,
      lines,
      transfers,
      totalInvested: totalIn,
      totalFinal: totalIn,
      discrepancy: 0,
      balanced: true,
    },
    log: [
      { id: uid(8), at: created, actorId: 'user:' + playerPool[0].id, actorName: playerPool[0].displayName, action: 'create', detail: { name: GAME_NAMES[g % GAME_NAMES.length] } },
      { id: uid(8), at: ended, actorId: 'user:' + playerPool[0].id, actorName: playerPool[0].displayName, action: 'close_game' },
    ],
  };

  writeFileSync(join(DATA_DIR, `${gameId}.json`), JSON.stringify(game, null, 2));
  games.push(game);
}

console.log(`Created ${games.length} finished games`);
console.log(`\nMock data ready. Restart the server to load it.`);
console.log(`Log in as any user with password: 0000`);
console.log(`\nSample users:`);
for (let i = 0; i < 5; i++) {
  console.log(`  ${users[i].displayName} (@${users[i].handle})`);
}
console.log(`  ... and ${users.length - 5} more`);
