// Seed a local mock world for potcount.
//
//   node scripts/seed-mock.mjs           → writes ./data-mock
//   PC_DATA_DIR=./data-mock npm run dev  → run against it
//
// Produces: 50 players (+ you, @max / pin 1234) spread across Amsterdam, Warsaw
// and a few other cities; a handful of OPEN public home games to join in both
// Amsterdam and Warsaw; and 60 finished € games for YOU so your profile shows a
// real reliability (~85–95%) computed off your last 60 nights.
//
// It writes the same JSON files the server stores use (users.json, follows.json,
// one <id>.json per game), so `init()` picks it straight up — no API calls.

import { scryptSync, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.PC_DATA_DIR || join(process.cwd(), 'data-mock');

// ---- deterministic RNG (mulberry32) so re-runs are reproducible --------------
let _s = 0x9e3779b9;
function rng() {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const round2 = (n) => Math.round(n * 100) / 100;

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function uid(n = 10) { let s = ''; for (let i = 0; i < n; i++) s += ALPHA[Math.floor(rng() * ALPHA.length)]; return s; }
function gid() { return 'G' + uid(11); }

// scrypt PIN hash, byte-identical to users.js hashPin()
function hashPin(pin) {
  const salt = randomBytes(16);
  return salt.toString('hex') + ':' + scryptSync(String(pin), salt, 32).toString('hex');
}

// ---- people ------------------------------------------------------------------
// name, city — a realistic spread. First block Amsterdam, second Warsaw, then a
// tail of other cities so the leaderboards aren't single-city.
const PEOPLE = [
  // Amsterdam (Dutch)
  ['Lucas Snepvangers', 'Amsterdam'], ['Sanne de Vries', 'Amsterdam'], ['Daan Bakker', 'Amsterdam'],
  ['Eva Jansen', 'Amsterdam'], ['Bram Visser', 'Amsterdam'], ['Fenna Meijer', 'Amsterdam'],
  ['Sem van Dijk', 'Amsterdam'], ['Lotte Bos', 'Amsterdam'], ['Thijs Mulder', 'Amsterdam'],
  ['Julia Smit', 'Amsterdam'], ['Ruben de Boer', 'Amsterdam'], ['Noa Kok', 'Amsterdam'],
  ['Tim Willemsen', 'Amsterdam'], ['Anouk Vos', 'Amsterdam'], ['Max Peters', 'Amsterdam'],
  ['Stijn Hendriks', 'Amsterdam'], ['Isa van Leeuwen', 'Amsterdam'],
  // Warsaw (Polish)
  ['Kacper Nowak', 'Warsaw'], ['Zofia Kowalska', 'Warsaw'], ['Jakub Wiśniewski', 'Warsaw'],
  ['Maja Wójcik', 'Warsaw'], ['Filip Kamiński', 'Warsaw'], ['Lena Lewandowska', 'Warsaw'],
  ['Antoni Zieliński', 'Warsaw'], ['Zuzanna Szymańska', 'Warsaw'], ['Szymon Woźniak', 'Warsaw'],
  ['Alicja Dąbrowska', 'Warsaw'], ['Michał Kozłowski', 'Warsaw'], ['Oliwia Jankowska', 'Warsaw'],
  ['Wojtek Mazur', 'Warsaw'], ['Nadia Krawczyk', 'Warsaw'], ['Piotr Piotrowski', 'Warsaw'],
  ['Hania Grabowska', 'Warsaw'], ['Bartek Pawlak', 'Warsaw'],
  // Elsewhere
  ['Emma Rossi', 'Rotterdam'], ['Liam Murphy', 'Utrecht'], ['Sofia Novak', 'Kraków'],
  ['Oliver Klein', 'Berlin'], ['Ava Thompson', 'London'], ['Mateo García', 'Barcelona'],
  ['Chloé Martin', 'Paris'], ['Noah Andersen', 'Copenhagen'], ['Mia Larsen', 'Oslo'],
  ['Leon Weber', 'Munich'], ['Freya Nielsen', 'Rotterdam'], ['Adam Nowicki', 'Kraków'],
  ['Ella Bakker', 'Utrecht'], ['Hugo Silva', 'Lisbon'], ['Nina Horvat', 'Berlin'],
  ['Ivan Petrov', 'Warsaw'],
];

function handleFor(name, taken) {
  let base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  base = base.slice(0, 18) || 'player';
  if (base.length < 3) base = (base + 'xyz').slice(0, 3);
  let h = base, i = 1;
  while (taken.has(h)) h = (base.slice(0, 16) + ++i);
  taken.add(h);
  return h;
}

const nowMs = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86_400_000;

const takenHandles = new Set();
const users = [];

// You — the signed-in player. Log in with @max / 1234.
const me = {
  id: uid(), handle: 'max', displayName: 'Max',
  avatar: null, avatarCustom: false, oauthAvatar: null,
  privacy: 'public', city: 'Amsterdam',
  provider: 'local', providerSub: null, pinHash: hashPin('1234'),
  email: null, newsletter: false,
  ageRange: '25-34', country: 'NL', heardFrom: 'friend',
  onboardedAt: iso(nowMs - 200 * DAY), lastSeenAt: iso(nowMs), createdAt: iso(nowMs - 200 * DAY),
};
takenHandles.add('max');
users.push(me);

for (const [name, city] of PEOPLE) {
  users.push({
    id: uid(), handle: handleFor(name, takenHandles), displayName: name,
    avatar: null, avatarCustom: false, oauthAvatar: null,
    privacy: 'public', city,
    provider: 'local', providerSub: null, pinHash: hashPin('1234'),
    email: null, newsletter: false,
    ageRange: pick(['18-24', '25-34', '35-44', '45-54']), country: null, heardFrom: null,
    onboardedAt: iso(nowMs - int(30, 300) * DAY), lastSeenAt: iso(nowMs - int(0, 20) * DAY),
    createdAt: iso(nowMs - int(60, 320) * DAY),
  });
}

const byCity = (c) => users.filter((u) => u.city === c && u.id !== me.id);
const amsPool = byCity('Amsterdam');
const warPool = byCity('Warsaw');

// ---- games -------------------------------------------------------------------
const gameFiles = []; // { id, json }

// A finished € game: `me` + a few opponents, zero-sum nets, frozen settlement.
function finishedGame(atMs, opponents, myNet) {
  const seatFor = (u) => ({ id: uid(6), name: u.displayName.split(' ')[0], userId: u.id });
  const seats = [seatFor(me), ...opponents.map(seatFor)];
  const n = seats.length;

  // opponents share -myNet, with zero-mean noise for spread
  const others = n - 1;
  const noise = Array.from({ length: others }, () => rng() - 0.5);
  const mean = noise.reduce((a, b) => a + b, 0) / others;
  let oNets = noise.map((r) => (r - mean) * 70 - myNet / others).map(round2);
  let resid = round2(-myNet - oNets.reduce((a, b) => a + b, 0));
  oNets[0] = round2(oNets[0] + resid);
  const nets = [myNet, ...oNets];

  const invested = 200; // 2 buy-ins of 100, everyone → finalStack always > 0
  const transactions = [];
  const finalStacks = {};
  const lines = [];
  const transfers = [];
  const computedAt = iso(atMs);
  seats.forEach((s, i) => {
    for (let b = 0; b < 2; b++) transactions.push({ id: uid(6), playerId: s.id, amount: 100, type: b === 0 ? 'buyin' : 'topup', at: iso(atMs - (2 - b) * 3600_000), by: s.name });
    const net = nets[i];
    finalStacks[s.id] = round2(invested + net);
    lines.push({ playerId: s.id, name: s.name, invested, finalStack: round2(invested + net), net: round2(net) });
  });

  // If you lost, add a confirmed transfer you paid — powers the settle-time stat.
  if (myNet < 0) {
    const winner = lines.filter((l) => l.net > 0).sort((a, b) => b.net - a.net)[0];
    if (winner) {
      const confirmMs = atMs + int(1, 5) * DAY;
      transfers.push({
        id: uid(6), from: seats[0].id, to: winner.playerId,
        fromName: seats[0].name, toName: winner.name, amount: round2(Math.min(-myNet, winner.net)),
        paid: true, paidAt: iso(confirmMs), paidBy: seats[0].name,
        confirmed: true, confirmedAt: iso(confirmMs), confirmedBy: winner.name,
      });
    }
  }

  const id = gid();
  const g = {
    id, code: String(int(1000, 9999)),
    name: pick(['Friday Home Game', 'Sunday cash', 'Check-raise or cry', 'Who has the boat?', 'Pocket kings walk', 'The usual', 'Degens anonymous', 'Tuesday grind', 'Rounders night', 'Felt therapy']),
    unit: '€', status: 'settled',
    createdAt: iso(atMs - 6 * 3600_000), updatedAt: computedAt, version: 5,
    ownerId: pick([me, ...opponents]).id,
    players: seats, transactions, finalStacks,
    hours: Object.fromEntries(seats.map((s) => [s.id, int(2, 6)])),
    log: [],
    settlement: {
      computedAt, lines, transfers,
      totalInvested: invested * n, totalFinal: round2(lines.reduce((a, l) => a + l.finalStack, 0)),
      discrepancy: 0, balanced: true,
    },
  };
  gameFiles.push({ id, json: g });
}

// 60 finished nights over the last ~7 months, ~55% winning.
const N = 60;
for (let i = 0; i < N; i++) {
  const atMs = nowMs - Math.round((N - i) * 3.4 * DAY) - int(0, 2) * DAY;
  const oppCount = int(3, 5);
  const pool = [...amsPool, ...warPool].sort(() => rng() - 0.5).slice(0, oppCount);
  // A winning-but-realistic profile: ~58% of nights up, and wins run a bit bigger
  // than losses, so you finish modestly ahead over the 60.
  const win = rng() < 0.58;
  const mag = win ? round2(30 + Math.pow(rng(), 0.7) * 150) : round2(20 + rng() * 95);
  finishedGame(atMs, pool, win ? mag : -mag);
}

// An OPEN public game to join (blinds, listed in the city directory).
function openGame(city, pool, { scheduled = false } = {}) {
  const host = pick(pool);
  const seatCount = int(2, 4);
  const seated = pool.filter((u) => u.id !== host.id).sort(() => rng() - 0.5).slice(0, seatCount - 1);
  const roster = [host, ...seated];
  const seats = roster.map((u) => ({ id: uid(6), name: u.displayName.split(' ')[0], userId: u.id }));
  const bb = pick([1, 2, 2, 5]);
  const sb = bb === 1 ? 0.5 : Math.max(1, Math.floor(bb / 2));
  const minBuyIn = bb * pick([40, 50, 100]);
  const maxBuyIn = minBuyIn * pick([2, 4]);
  const createdMs = nowMs - int(1, 10) * DAY;

  const transactions = seats.map((s) => ({ id: uid(6), playerId: s.id, amount: minBuyIn, type: 'buyin', at: iso(createdMs), by: s.name }));
  const id = gid();
  const g = {
    id, code: String(int(1000, 9999)),
    name: pick([`${city} home game`, 'Open table — bring a friend', 'Weekly cash game', 'Newcomers welcome', 'Low-stakes fun', 'Deep-stack Saturday']),
    unit: 'blinds', status: scheduled ? 'scheduled' : 'active',
    createdAt: iso(createdMs), updatedAt: iso(createdMs), version: 2,
    ownerId: host.id, tokenedHost: true,
    visibility: 'public', city,
    blinds: { small: sb, big: bb }, minBuyIn, maxBuyIn, maxPlayers: pick([6, 8, 9, 10]),
    players: seats, transactions, finalStacks: {}, log: [],
    joinRequests: [],
    ...(scheduled ? { scheduledFor: iso(nowMs + int(2, 20) * DAY) } : {}),
  };
  gameFiles.push({ id, json: g });
}

// 4 open games each in Amsterdam & Warsaw (one scheduled apiece).
for (let i = 0; i < 4; i++) openGame('Amsterdam', amsPool, { scheduled: i === 3 });
for (let i = 0; i < 4; i++) openGame('Warsaw', warPool, { scheduled: i === 3 });

// ---- follows: you follow ~20 players so your feed & 'following' board fill ---
const followTargets = users.filter((u) => u.id !== me.id).sort(() => rng() - 0.5).slice(0, 20).map((u) => u.id);
const follows = { [me.id]: followTargets };

// ---- write -------------------------------------------------------------------
if (existsSync(DIR)) {
  // wipe only files we own (json), keep the dir
  for (const f of readdirSync(DIR)) if (f.endsWith('.json')) rmSync(join(DIR, f));
} else {
  mkdirSync(DIR, { recursive: true });
}
writeFileSync(join(DIR, 'users.json'), JSON.stringify(users, null, 2));
writeFileSync(join(DIR, 'follows.json'), JSON.stringify(follows, null, 2));
for (const { id, json } of gameFiles) writeFileSync(join(DIR, `${id}.json`), JSON.stringify(json, null, 2));

const openCount = gameFiles.filter((g) => g.json.visibility === 'public').length;
console.log(`✔ seeded ${DIR}`);
console.log(`  ${users.length} users (you = @max, pin 1234, city Amsterdam)`);
console.log(`  ${gameFiles.length - openCount} finished € games for you (reliability off your last ${N})`);
console.log(`  ${openCount} open public games (Amsterdam + Warsaw)`);
console.log(`  following ${followTargets.length} players\n`);
console.log(`Run it:  PC_DATA_DIR=${DIR} npm run dev`);
console.log(`Then log in at /account as  max / 1234`);
