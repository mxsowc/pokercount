// Tiny REST + SSE client shared by the frontend pages.

// ---- identity: a stable per-device id + a display name -----------------------
const ACTOR_KEY = 'pc_actor';

export function getActor() {
  let a;
  try { a = JSON.parse(localStorage.getItem(ACTOR_KEY)); } catch {}
  if (!a || !a.id) {
    a = { id: 'u' + Math.random().toString(36).slice(2, 10), name: (a && a.name) || '' };
    localStorage.setItem(ACTOR_KEY, JSON.stringify(a));
  }
  return a;
}

export function setActorName(name) {
  const a = getActor();
  a.name = String(name || '').trim().slice(0, 40);
  localStorage.setItem(ACTOR_KEY, JSON.stringify(a));
  return a;
}

// Which player THIS device is, per game (set when you open or join a game).
export function getMyPlayerId(gameId) {
  return localStorage.getItem('pc_me_' + gameId) || null;
}
export function setMyPlayerId(gameId, playerId) {
  if (playerId) localStorage.setItem('pc_me_' + gameId, playerId);
}

// The games this device has opened or joined, so a player can return any time
// to keep adding or settle later — independent of whether the host is online.
const GAMES_KEY = 'pc_games';
export function listMyGames() {
  try { return JSON.parse(localStorage.getItem(GAMES_KEY)) || []; } catch { return []; }
}
export function rememberGame(game) {
  if (!game || !game.id) return;
  const mineId = getMyPlayerId(game.id);
  const me = (game.players || []).find((p) => p.id === mineId);
  const entry = {
    id: game.id,
    name: game.name,
    unit: game.unit || '€',
    you: me ? me.name : null,
    players: (game.players || []).length,
    status: game.status || 'active',
    at: Date.now(),
  };
  const list = listMyGames().filter((x) => x.id !== game.id);
  list.unshift(entry);
  localStorage.setItem(GAMES_KEY, JSON.stringify(list.slice(0, 20)));
}
// Merge fresh fields into a remembered game WITHOUT touching its position/time.
export function patchGame(gameId, fields) {
  const list = listMyGames();
  const i = list.findIndex((x) => x.id === gameId);
  if (i < 0) return;
  list[i] = { ...list[i], ...fields };
  localStorage.setItem(GAMES_KEY, JSON.stringify(list));
}
export function forgetGame(gameId) {
  localStorage.setItem(GAMES_KEY, JSON.stringify(listMyGames().filter((x) => x.id !== gameId)));
}

function actorHeaders() {
  const a = getActor();
  return { 'X-Actor-Id': a.id, 'X-Actor-Name': encodeURIComponent(a.name || 'Someone') };
}

async function req(method, url, body) {
  const opts = { method, headers: { ...actorHeaders() } };
  // Tell the server which seat this device holds in the game (if any), so it can
  // recognise a seated player — e.g. to let any player (not just the host) close
  // a balanced game. Derived from the per-game myPlayerId set on open/join.
  const m = url.match(/^\/api\/games\/([^/?]+)/);
  if (m) {
    const pid = getMyPlayerId(m[1]);
    if (pid) opts.headers['X-Player-Id'] = pid;
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  createGame: (payload) => req('POST', '/api/games', payload),
  getGame: (id) => req('GET', `/api/games/${id}`),
  setMeta: (id, payload) => req('PUT', `/api/games/${id}/meta`, payload),
  addPlayer: (id, name) => req('POST', `/api/games/${id}/players`, { name }),
  renamePlayer: (id, pid, name) => req('PATCH', `/api/games/${id}/players/${pid}`, { name }),
  removePlayer: (id, pid) => req('DELETE', `/api/games/${id}/players/${pid}`),
  addTx: (id, playerId, amount, type) => req('POST', `/api/games/${id}/transactions`, { playerId, amount, type }),
  editTx: (id, txId, amount) => req('PATCH', `/api/games/${id}/transactions/${txId}`, { amount }),
  removeTx: (id, txId) => req('DELETE', `/api/games/${id}/transactions/${txId}`),
  setFinal: (id, playerId, amount) => req('PUT', `/api/games/${id}/final`, { playerId, amount }),
  setStatus: (id, status) => req('PUT', `/api/games/${id}/status`, { status }),
  closeGame: (id) => req('POST', `/api/games/${id}/close`),
  reopenGame: (id) => req('POST', `/api/games/${id}/reopen`),
  markTransfer: (id, transferId, paid) => req('PUT', `/api/games/${id}/settlement/${transferId}`, { paid }),
  editSettlement: (id, transfers) => req('PUT', `/api/games/${id}/settlement`, { transfers }),
  joinGame: (id, name) => req('POST', `/api/games/${id}/join`, { name }),
  claimSeat: (id, playerId) => req('POST', `/api/games/${id}/claim`, { playerId }),

  // accounts
  config: () => req('GET', '/api/config'),
  me: () => req('GET', '/api/me'),
  updateMe: (name) => req('PUT', '/api/me', { name }),
  signup: (handle, displayName, pin) => req('POST', '/api/auth/signup', { handle, displayName, pin }),
  login: (handle, pin) => req('POST', '/api/auth/login', { handle, pin }),
  logout: () => req('POST', '/api/auth/logout'),
  googleAuth: (credential) => req('POST', '/api/auth/google', { credential }),
  userStats: (handle) => req('GET', `/api/users/${encodeURIComponent(handle)}/stats`),
};

/** Subscribe to live game updates. Returns an unsubscribe function. */
export function subscribe(id, onUpdate) {
  const es = new EventSource(`/api/games/${id}/events`);
  es.addEventListener('update', (e) => {
    let parsed;
    try { parsed = JSON.parse(e.data); }
    catch { return; } // malformed payload — skip just this event, keep listening
    onUpdate(parsed); // let render errors surface (don't swallow live-sync bugs)
  });
  return () => es.close();
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

export const money = (n, unit = '€') =>
  n == null ? '—' : `${unit}${Number(n).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
