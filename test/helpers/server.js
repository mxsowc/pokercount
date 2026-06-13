// Spin up the real HTTP server in-process, on an ephemeral port, backed by a
// throwaway data directory so tests never touch real games/users. Each test
// file runs in its own process under `node --test`, so importing the server
// once per file (after PC_DATA_DIR is set) gives full isolation.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function startTestServer() {
  const dir = mkdtempSync(join(tmpdir(), 'pc-test-'));
  process.env.PC_DATA_DIR = dir;
  process.env.COOKIE_SECURE = '0';
  delete process.env.GOOGLE_CLIENT_ID; // keep Google sign-in off
  const mod = await import('../../server/index.js');
  const server = await mod.start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    server,
    dir,
    client: () => new Client(base),
    async stop() {
      await new Promise((r) => server.close(r));
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

// Pre-seed a data dir with arbitrary files, for store-loading tests.
export function seedDataDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pc-seed-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

// One "device/browser": its own cookie jar; per-call headers let a test play
// host (X-Host-Token), a seat (X-Player-Id) or a device (X-Actor-Id).
export class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }
  async req(method, path, { body, headers } = {}) {
    const h = { ...(headers || {}) };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.cookie) h['Cookie'] = this.cookie;
    const res = await fetch(this.base + path, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setC = res.headers.get('set-cookie');
    if (setC) this.cookie = setC.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON / empty */ }
    return { status: res.status, data };
  }
  get(path, opts) { return this.req('GET', path, opts); }
  post(path, body, headers) { return this.req('POST', path, { body, headers }); }
  put(path, body, headers) { return this.req('PUT', path, { body, headers }); }
  del(path, headers) { return this.req('DELETE', path, { headers }); }
}

// ---- small scenario helpers --------------------------------------------------

/** Open a game and return { id, hostToken, hostHeaders, game }. */
export async function openGame(client, { players = [{ name: 'Host' }], code } = {}) {
  const { status, data } = await client.post('/api/games', { players, code });
  if (status !== 201) throw new Error(`open failed: ${status} ${JSON.stringify(data)}`);
  return { id: data.id, hostToken: data.hostToken, hostHeaders: { 'X-Host-Token': data.hostToken }, game: data };
}

/** Add a buy-in for a player. */
export function buyIn(client, id, playerId, amount) {
  return client.post(`/api/games/${id}/transactions`, { playerId, amount, type: 'buyin' });
}

/** Set a player's final cash-out. */
export function setFinal(client, id, playerId, amount) {
  return client.put(`/api/games/${id}/final`, { playerId, amount });
}
