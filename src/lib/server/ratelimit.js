// Simple in-memory fixed-window rate limiter. Used to throttle login brute-force
// and game-code enumeration. Single Node process (adapter-node) → one shared map.

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

/** Returns true if the request is allowed (under `limit` within `windowMs`).
 * @param {string} key @param {number} limit @param {number} windowMs @returns {boolean} */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  if (buckets.size > 5000) { // opportunistic eviction so the map can't grow unbounded
    for (const [k, r] of buckets) if (now > r.resetAt) buckets.delete(k);
  }
  let rec = buckets.get(key);
  if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + windowMs }; buckets.set(key, rec); }
  rec.count++;
  return rec.count <= limit;
}

/** Best-effort client IP from a SvelteKit RequestEvent.
 * @param {import('@sveltejs/kit').RequestEvent} event @returns {string} */
export function clientIp(event) {
  const xff = event.request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  try { return event.getClientAddress(); } catch { return 'unknown'; }
}
