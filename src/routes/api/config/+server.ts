import { json } from '@sveltejs/kit';

// Public client identifiers the sign-in buttons need in the browser. Safe to
// expose: these are public app IDs, not secrets. A null value simply hides the
// corresponding button until the env var is set.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || null;

export function GET() {
  return json({ googleClientId: GOOGLE_CLIENT_ID, appleClientId: APPLE_CLIENT_ID });
}
