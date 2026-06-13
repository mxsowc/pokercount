// Zero-dependency HTTP server: REST API + Server-Sent Events for live sync,
// plus static hosting of the frontend and the shared engine modules.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, onChange, getGame, createGame, mutate, uid, allGames } from './store.js';
import { computeSettlement } from '../src/settle.js';
import { computeUserStats } from '../src/stats.js';
import * as users from './users.js';
import { initAuth, sessionUid, sessionCookie, clearCookie, verifyGoogleIdToken } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;

// ---- rate limiting: simple per-key fixed window -----------------------------
// Used for login brute-force AND to throttle game-code enumeration: short codes
// are friendly to share, so instead of lengthening them we cap how fast one IP
// can probe games. Returns true if the request is allowed.
const rateBuckets = new Map(); // key -> { count, resetAt }
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  if (rateBuckets.size > 5000) { // opportunistic eviction so the map can't grow unbounded
    for (const [k, r] of rateBuckets) if (now > r.resetAt) rateBuckets.delete(k);
  }
  let rec = rateBuckets.get(key);
  if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + windowMs }; rateBuckets.set(key, rec); }
  rec.count++;
  return rec.count <= limit;
}
function ipOf(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
// Login: 10 attempts / 5 min per IP, plus a per-handle cap so one account can't
// be ground through from many IPs.
function checkLoginRate(ip) { return rateLimit('login-ip:' + ip, 10, 5 * 60 * 1000); }
function checkHandleRate(handle) { return rateLimit('login-h:' + String(handle || '').toLowerCase(), 20, 15 * 60 * 1000); }

// ---- SSE registry: gameId -> Set<res> ---------------------------------------
const sseClients = new Map();

onChange((game) => {
  const set = sseClients.get(game.id);
  if (!set) return;
  const payload = `event: update\ndata: ${JSON.stringify(game)}\n\n`;
  for (const res of set) res.write(payload);
});

setInterval(() => {
  for (const set of sseClients.values()) {
    for (const res of set) res.write(': hb\n\n'); // heartbeat keeps proxies open
  }
}, 25000).unref();

// ---- helpers ----------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const num = (v) => (typeof v === 'number' ? v : Number(v));
const isMoney = (v) => Number.isFinite(num(v)) && num(v) >= 0;

// Who made this change? Sent by the client as headers (name URI-encoded so
// non-ASCII names survive transit).
function actorOf(req) {
  const name = req.headers['x-actor-name'];
  return {
    id: req.headers['x-actor-id'] || 'anon',
    name: name ? decodeURIComponent(name).slice(0, 40) : 'Someone',
  };
}
function logEntry(actor, action, extra = {}) {
  return { id: uid(8), at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, action, ...extra };
}
function pname(g, pid) {
  const p = g.players.find((x) => x.id === pid);
  return p ? p.name : null;
}
function sessionUser(req) {
  return users.getUser(sessionUid(req));
}
// Is a player name already used in this game? (case-insensitive, ignoring exceptId)
function nameTaken(game, name, exceptId) {
  const n = String(name || '').trim().toLowerCase();
  return game.players.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === n);
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveFile(res, absPath) {
  try {
    const body = await readFile(absPath);
    const type = CONTENT_TYPES[extname(absPath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

// Prevent path traversal: resolved path must stay within the given base directory.
function safeJoin(base, urlPath) {
  const p = normalize(join(base, urlPath));
  return (p === base || p.startsWith(base + '/')) ? p : null;
}

// ---- request handler --------------------------------------------------------
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);
  const method = req.method;

  try {
    if (path.startsWith('/api/')) return await handleApi(req, res, path, method);

    // Clean page routes.
    if (path === '/' || path === '/index.html') return void (await serveFile(res, join(ROOT, 'public/index.html')));
    if (path === '/game') return void (await serveFile(res, join(ROOT, 'public/game.html')));
    if (path === '/pot') return void (await serveFile(res, join(ROOT, 'public/pot.html')));
    if (path === '/account') return void (await serveFile(res, join(ROOT, 'public/account.html')));
    if (path.startsWith('/u/')) return void (await serveFile(res, join(ROOT, 'public/profile.html')));

    // Static: engine modules under /src/*, everything else under /public/*.
    const base = path.startsWith('/src/') ? join(ROOT, 'src') : join(ROOT, 'public');
    const rel = path.startsWith('/src/') ? path.slice(4) : path; // strip /src prefix for src/ files
    const abs = safeJoin(base, rel);
    if (abs && (await serveFile(res, abs))) return;

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    sendJson(res, 400, { error: err.message || 'bad request' });
  }
});

// ---- API routing ------------------------------------------------------------
async function handleApi(req, res, path, method) {
  const parts = path.split('/').filter(Boolean); // e.g. ['api','games','ABCD','transactions']
  const su = sessionUser(req); // logged-in account, or null
  // A logged-in user's edits are attributed to their account; otherwise to the
  // per-device actor sent in headers.
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : actorOf(req);

  // Throttle game traffic per IP so the short, shareable game codes can't be
  // swept by brute force. 200/min is far above any real game's needs but turns a
  // seconds-long enumeration of the whole keyspace into a non-starter.
  if (parts[1] === 'games' && !rateLimit('game:' + ipOf(req), 200, 60 * 1000)) {
    return sendJson(res, 429, { error: 'Too many requests — slow down a moment.' });
  }

  // ---- config / current user ----
  if (parts[1] === 'config' && method === 'GET') {
    return sendJson(res, 200, { googleClientId: GOOGLE_CLIENT_ID });
  }
  if (parts[1] === 'me' && method === 'GET') {
    return sendJson(res, 200, { user: users.publicUser(su) });
  }
  if (parts[1] === 'me' && method === 'PUT') {
    if (!su) return sendJson(res, 401, { error: 'not signed in' });
    const { name } = await readBody(req);
    let u;
    try { u = users.updateProfile(su.id, { name }); }
    catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
    return sendJson(res, 200, { user: users.publicUser(u) });
  }

  // ---- auth ----
  if (parts[1] === 'auth') {
    const action = parts[2];
    if (action === 'signup' && method === 'POST') {
      const body = await readBody(req);
      let u;
      try { u = users.createLocal(body); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
      res.setHeader('Set-Cookie', sessionCookie(u.id, req));
      return sendJson(res, 201, { user: users.publicUser(u) });
    }
    if (action === 'login' && method === 'POST') {
      if (!checkLoginRate(ipOf(req))) return sendJson(res, 429, { error: 'Too many login attempts — try again in a few minutes' });
      const body = await readBody(req);
      if (!checkHandleRate(body.handle)) return sendJson(res, 429, { error: 'Too many attempts for this account — try again later' });
      let u;
      try { u = users.loginLocal(body); } catch (e) { return sendJson(res, e.status || 401, { error: e.message }); }
      res.setHeader('Set-Cookie', sessionCookie(u.id, req));
      return sendJson(res, 200, { user: users.publicUser(u) });
    }
    if (action === 'logout' && method === 'POST') {
      res.setHeader('Set-Cookie', clearCookie(req));
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'google' && method === 'POST') {
      if (!GOOGLE_CLIENT_ID) return sendJson(res, 501, { error: 'Google sign-in is not configured on this server' });
      const { credential } = await readBody(req);
      let payload;
      try { payload = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID); }
      catch (e) { return sendJson(res, 401, { error: 'Google sign-in failed: ' + e.message }); }
      const u = users.upsertOAuth({
        provider: 'google',
        sub: payload.sub,
        displayName: payload.name || payload.email,
        avatar: payload.picture,
        handleHint: (payload.email || '').split('@')[0],
      });
      res.setHeader('Set-Cookie', sessionCookie(u.id, req));
      return sendJson(res, 200, { user: users.publicUser(u) });
    }
    return sendJson(res, 404, { error: 'unknown auth route' });
  }

  // ---- public profile stats (public — profiles are meant to be shareable) ----
  if (parts[1] === 'users' && parts[2] && parts[3] === 'stats' && method === 'GET') {
    const u = users.getByHandle(parts[2]);
    if (!u) return sendJson(res, 404, { error: 'no such player' });
    return sendJson(res, 200, { user: users.publicUser(u), stats: computeUserStats(allGames(), u.id) });
  }

  // ---- games ----
  if (parts.length === 2 && parts[1] === 'games' && method === 'POST') {
    const body = await readBody(req);
    let game;
    try {
      game = createGame(body);
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.message });
    }
    game = mutate(game.id, (g) => {
      g.hostId = actor.id; // who opened the game — the only one who can close it
      if (su) {
        g.ownerId = su.id;
        if (g.players[0]) g.players[0].userId = su.id; // host takes seat 1, linked to their account
      }
      g.log.push(logEntry(actor, 'create', { detail: { name: g.name } }));
    });
    return sendJson(res, 201, game);
  }

  if (parts[1] !== 'games' || !parts[2]) return sendJson(res, 404, { error: 'unknown route' });
  const id = parts[2].toUpperCase();
  const sub = parts[3];

  // SSE stream
  if (sub === 'events' && method === 'GET') {
    if (!getGame(id)) return sendJson(res, 404, { error: 'game not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: update\ndata: ${JSON.stringify(getGame(id))}\n\n`);
    let set = sseClients.get(id);
    if (!set) sseClients.set(id, (set = new Set()));
    set.add(res);
    req.on('close', () => {
      set.delete(res);
      if (set.size === 0) sseClients.delete(id);
    });
    return;
  }

  // GET game
  if (!sub && method === 'GET') {
    const game = getGame(id);
    return game ? sendJson(res, 200, game) : sendJson(res, 404, { error: 'game not found' });
  }

  if (sub === 'settlement' && method === 'GET') {
    const game = getGame(id);
    if (!game) return sendJson(res, 404, { error: 'game not found' });
    return sendJson(res, 200, computeSettlement(game.players, game.transactions, game.finalStacks));
  }

  if (!getGame(id)) return sendJson(res, 404, { error: 'game not found' });

  // Host check: prefer ownerId (account-linked) over hostId (device-based).
  // Anonymous actors can only be hosts if they match the original hostId.
  // The requester can be recognised by their account OR their device id — and a
  // game's host may have been recorded under either (e.g. created anonymously,
  // then signed up). Match any of them.
  const isHost = (g) => {
    if (!g.hostId) return true;
    if (su && g.ownerId && g.ownerId === su.id) return true; // account owns the game
    if (g.hostId === actor.id) return true;                  // current actor (account or device)
    if (g.hostId === (req.headers['x-actor-id'] || 'anon')) return true; // device id, even when logged in
    return false;
  };
  // Is the requester someone with a seat in this game? Used so any player (not
  // just the host) can close the game once the books balance — important when
  // the host has left the party first.
  const reqPlayerId = req.headers['x-player-id'];
  const isSeated = (g) =>
    (su && g.players.some((p) => p.userId === su.id)) ||
    (reqPlayerId && g.players.some((p) => p.id === reqPlayerId));
  const blockIfClosed = () => {
    if (getGame(id).status !== 'active') {
      sendJson(res, 409, { error: 'Game is closed. The host can reopen it to make changes.' });
      return true;
    }
    return false;
  };

  // Host confirms the game is over → freeze a settlement snapshot we can track.
  if (sub === 'close' && method === 'POST') {
    const g0 = getGame(id);
    const s = computeSettlement(g0.players, g0.transactions, g0.finalStacks);
    if (!isHost(g0)) {
      // A non-host can still close — but only if they're actually in the game and
      // the books balance, so a passer-by can't freeze a half-finished night.
      if (!isSeated(g0)) return sendJson(res, 403, { error: 'Only players in this game can close it' });
      if (!s.balanced) return sendJson(res, 409, { error: 'The cash-outs don’t add up to the buy-ins yet — only the host can close an unbalanced game' });
    }
    const game = mutate(id, (g) => {
      g.settlement = {
        computedAt: new Date().toISOString(),
        lines: s.lines,
        transfers: s.transfers.map((t) => ({ id: uid(8), ...t, paid: false, paidAt: null, paidBy: null })),
        totalInvested: s.totalInvested,
        totalFinal: s.totalFinal,
        discrepancy: s.discrepancy,
        balanced: s.balanced,
      };
      g.status = s.transfers.length === 0 ? 'settled' : 'ended';
      g.log.push(logEntry(actor, 'close_game', {}));
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'reopen' && method === 'POST') {
    const g0 = getGame(id);
    if (!isHost(g0)) return sendJson(res, 403, { error: 'Only the host can reopen the game' });
    const game = mutate(id, (g) => {
      g.status = 'active';
      delete g.settlement;
      g.log.push(logEntry(actor, 'reopen_game', {}));
    });
    return sendJson(res, 200, game);
  }

  // Claim a seat for the signed-in account (used when you make an account after
  // playing). Only links an as-yet-unclaimed seat — never steals someone's.
  // Allowed even after the game is closed, so post-game sign-ups still count.
  if (sub === 'claim' && method === 'POST') {
    if (!su) return sendJson(res, 401, { error: 'sign in first' });
    const { playerId } = await readBody(req);
    const game = mutate(id, (g) => {
      const p = g.players.find((x) => x.id === playerId);
      if (p && !p.userId) p.userId = su.id;
    });
    return sendJson(res, 200, game);
  }

  // Replace the whole payment plan (re-target who pays whom). Validated against
  // the frozen balances: every debtor must pay exactly what they owe and every
  // creditor receive exactly what they're owed — just routed however you like.
  if (sub === 'settlement' && !parts[4] && method === 'PUT') {
    const g0 = getGame(id);
    if (!g0.settlement) return sendJson(res, 409, { error: 'The game has to be ended first' });
    const body = await readBody(req);
    if (!Array.isArray(body.transfers)) return sendJson(res, 400, { error: 'transfers must be a list' });

    const c = (x) => Math.round(Number(x) * 100); // euros → integer cents
    const euros = (cents) => '€' + (cents / 100).toFixed(2);
    const owe = new Map(), owed = new Map(), nameOf = new Map();
    for (const l of g0.settlement.lines) {
      nameOf.set(l.playerId, l.name);
      const net = c(l.net);
      if (net < 0) owe.set(l.playerId, -net);
      else if (net > 0) owed.set(l.playerId, net);
    }

    const outSum = new Map(), inSum = new Map();
    const clean = [];
    for (const t of body.transfers) {
      const amt = c(t.amount);
      if (!(amt > 0)) continue; // ignore blank/zero lines
      if (t.from === t.to) return sendJson(res, 400, { error: 'A player can’t pay themselves' });
      if (!owe.has(t.from)) return sendJson(res, 400, { error: `${nameOf.get(t.from) || 'That player'} isn’t down money — they can’t make a payment` });
      if (!owed.has(t.to)) return sendJson(res, 400, { error: `${nameOf.get(t.to) || 'That player'} isn’t owed money — they can’t receive a payment` });
      outSum.set(t.from, (outSum.get(t.from) || 0) + amt);
      inSum.set(t.to, (inSum.get(t.to) || 0) + amt);
      clean.push({ from: t.from, to: t.to, amount: amt });
    }
    for (const [pid, debt] of owe) {
      const paid = outSum.get(pid) || 0;
      if (paid !== debt) return sendJson(res, 400, { error: `${nameOf.get(pid)} should pay ${euros(debt)} in total, but the plan adds up to ${euros(paid)}` });
    }
    for (const [pid, credit] of owed) {
      const recv = inSum.get(pid) || 0;
      if (recv !== credit) return sendJson(res, 400, { error: `${nameOf.get(pid)} should receive ${euros(credit)} in total, but the plan adds up to ${euros(recv)}` });
    }

    // Preserve "paid" marks for unchanged lines.
    const prev = new Map(g0.settlement.transfers.map((t) => [`${t.from}|${t.to}|${c(t.amount)}`, t]));
    const game = mutate(id, (g) => {
      g.settlement.transfers = clean.map((t) => {
        const old = prev.get(`${t.from}|${t.to}|${t.amount}`);
        return {
          id: uid(8),
          from: t.from, fromName: nameOf.get(t.from),
          to: t.to, toName: nameOf.get(t.to),
          amount: t.amount / 100,
          paid: old ? old.paid : false,
          paidAt: old ? old.paidAt : null,
          paidBy: old ? old.paidBy : null,
        };
      });
      const allPaid = g.settlement.transfers.every((t) => t.paid);
      g.status = allPaid ? 'settled' : 'ended';
      g.log.push(logEntry(actor, 'edit_settlement', { detail: { count: g.settlement.transfers.length } }));
    });
    return sendJson(res, 200, game);
  }

  // Mark a payment settled / unsettled. When every payment is settled, the
  // whole game flips to "settled".
  if (sub === 'settlement' && parts[4] && method === 'PUT') {
    const tid = parts[4];
    const { paid } = await readBody(req);
    const game = mutate(id, (g) => {
      if (!g.settlement) return;
      const t = g.settlement.transfers.find((x) => x.id === tid);
      if (!t) return;
      t.paid = !!paid;
      t.paidAt = paid ? new Date().toISOString() : null;
      t.paidBy = paid ? actor.name : null;
      const allPaid = g.settlement.transfers.every((x) => x.paid);
      g.status = allPaid ? 'settled' : 'ended';
      g.log.push(logEntry(actor, paid ? 'mark_paid' : 'mark_unpaid', {
        detail: { from: t.fromName, to: t.toName, amount: t.amount },
      }));
    });
    return sendJson(res, 200, game);
  }

  // Self-join: the requester takes a seat. If logged in, the seat is linked to
  // their account (and an existing seat is reused, never duplicated).
  if (sub === 'join' && method === 'POST') {
    if (blockIfClosed()) return;
    const { name } = await readBody(req);
    const nm = String(name || '').trim();
    if (!nm) return sendJson(res, 400, { error: 'name required' });
    const g0 = getGame(id);
    // A signed-in player who already has a seat just reuses it.
    if (su) {
      const existing = g0.players.find((p) => p.userId === su.id);
      if (existing) return sendJson(res, 200, { game: g0, playerId: existing.id });
    }
    if (nameTaken(g0, nm)) {
      return sendJson(res, 409, { error: `There's already a player called "${nm}" — pick a slightly different name.` });
    }
    let newId = null;
    const game = mutate(id, (g) => {
      const np = { id: uid(6), name: nm.slice(0, 40) };
      if (su) np.userId = su.id;
      g.players.push(np);
      newId = np.id;
      g.log.push(logEntry(actor, 'add_player', { playerId: np.id, playerName: np.name }));
    });
    return sendJson(res, 200, { game, playerId: newId });
  }

  // Mutations (only while the game is active)
  if (sub === 'players' && method === 'POST') {
    if (blockIfClosed()) return;
    const { name } = await readBody(req);
    const nm = String(name || '').trim();
    if (!nm) return sendJson(res, 400, { error: 'name required' });
    if (nameTaken(getGame(id), nm)) {
      return sendJson(res, 409, { error: `There's already a player called "${nm}" in this game.` });
    }
    const game = mutate(id, (g) => {
      const np = { id: uid(6), name: nm.slice(0, 40) };
      g.players.push(np);
      g.log.push(logEntry(actor, 'add_player', { playerId: np.id, playerName: np.name }));
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'players' && parts[4] && method === 'PATCH') {
    if (blockIfClosed()) return;
    const pid = parts[4];
    const { name } = await readBody(req);
    const nm = String(name || '').trim();
    if (!nm) return sendJson(res, 400, { error: 'name required' });
    if (nameTaken(getGame(id), nm, pid)) {
      return sendJson(res, 409, { error: `There's already a player called "${nm}" in this game.` });
    }
    const game = mutate(id, (g) => {
      const p = g.players.find((x) => x.id === pid);
      if (p) {
        const from = p.name;
        p.name = nm.slice(0, 40);
        g.log.push(logEntry(actor, 'rename_player', { playerId: pid, playerName: p.name, detail: { from, to: p.name } }));
      }
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'players' && parts[4] && method === 'DELETE') {
    if (blockIfClosed()) return;
    const pid = parts[4];
    const game = mutate(id, (g) => {
      const nm = pname(g, pid);
      g.players = g.players.filter((p) => p.id !== pid);
      g.transactions = g.transactions.filter((t) => t.playerId !== pid);
      delete g.finalStacks[pid];
      g.log.push(logEntry(actor, 'remove_player', { playerId: pid, playerName: nm }));
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'transactions' && method === 'POST') {
    if (blockIfClosed()) return;
    const { playerId, amount, type } = await readBody(req);
    if (!isMoney(amount) || num(amount) <= 0) return sendJson(res, 400, { error: 'amount must be > 0' });
    const txType = type === 'topup' ? 'topup' : 'buyin';
    const game = mutate(id, (g) => {
      if (!g.players.some((p) => p.id === playerId)) throw new Error('unknown player');
      g.transactions.push({ id: uid(8), playerId, amount: num(amount), type: txType, at: new Date().toISOString() });
      g.log.push(logEntry(actor, txType, { playerId, playerName: pname(g, playerId), detail: { amount: num(amount), type: txType } }));
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'transactions' && parts[4] && method === 'PATCH') {
    if (blockIfClosed()) return;
    const txId = parts[4];
    const { amount } = await readBody(req);
    if (!isMoney(amount) || num(amount) <= 0) return sendJson(res, 400, { error: 'amount must be > 0' });
    const game = mutate(id, (g) => {
      const t = g.transactions.find((x) => x.id === txId);
      if (t) {
        const from = t.amount;
        t.amount = num(amount);
        g.log.push(logEntry(actor, 'edit_tx', { playerId: t.playerId, playerName: pname(g, t.playerId), detail: { from, to: num(amount), type: t.type } }));
      }
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'transactions' && parts[4] && method === 'DELETE') {
    if (blockIfClosed()) return;
    const txId = parts[4];
    const game = mutate(id, (g) => {
      const t = g.transactions.find((x) => x.id === txId);
      g.transactions = g.transactions.filter((x) => x.id !== txId);
      if (t) g.log.push(logEntry(actor, 'remove_tx', { playerId: t.playerId, playerName: pname(g, t.playerId), detail: { amount: t.amount, type: t.type } }));
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'final' && method === 'PUT') {
    if (blockIfClosed()) return;
    const { playerId, amount } = await readBody(req);
    const game = mutate(id, (g) => {
      const from = g.finalStacks[playerId] ?? null;
      let to;
      if (amount === null || amount === '' || amount === undefined) {
        delete g.finalStacks[playerId];
        to = null;
      } else {
        g.finalStacks[playerId] = num(amount);
        to = num(amount);
      }
      if (from !== to) g.log.push(logEntry(actor, 'set_final', { playerId, playerName: pname(g, playerId), detail: { from, to } }));
    });
    return sendJson(res, 200, game);
  }

  if (sub === 'meta' && method === 'PUT') {
    if (blockIfClosed()) return;
    const { name, unit } = await readBody(req);
    const game = mutate(id, (g) => {
      if (name) g.name = String(name).slice(0, 80);
      if (unit) g.unit = String(unit).slice(0, 4);
    });
    return sendJson(res, 200, game);
  }

  return sendJson(res, 404, { error: 'unknown route' });
}

initAuth();
const usersLoaded = users.init();
const loaded = init();
server.listen(PORT, () => {
  console.log(
    `pokercount running on http://localhost:${PORT}  ` +
    `(${loaded} game(s), ${usersLoaded} user(s) loaded` +
    `${GOOGLE_CLIENT_ID ? ', Google sign-in ON' : ''})`,
  );
});
