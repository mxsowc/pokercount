import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '$lib/server/paths.js';
import { writeFileDurable } from '$lib/server/fsutil.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

// Fake-door demand probe. A record per click (e.g. the "potcount Pro" interest
// button) so we can size willingness-to-pay BEFORE building any billing. Not a
// commitment and never charged — just a counter an operator can read.
const FILE = join(DATA_DIR, 'interest.json');

export async function POST(event) {
  const { request } = event;
  if (!rateLimit('interest:' + clientIp(event), 20, 60_000)) {
    return json({ ok: true }); // silently swallow floods — this is a soft signal, not a gate
  }
  const body = await request.json().catch(() => ({}));
  const feature = String(body?.feature || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const su = sessionUser(request);
  let list: any[] = [];
  try { if (existsSync(FILE)) list = JSON.parse(readFileSync(FILE, 'utf8')); } catch { /* start fresh */ }
  if (!Array.isArray(list)) list = [];
  list.push({ feature, userId: su?.id || null, at: new Date().toISOString() });
  if (list.length > 5000) list = list.slice(-5000);
  try { writeFileDurable(FILE, JSON.stringify(list)); } catch { /* best effort */ }
  return json({ ok: true });
}
