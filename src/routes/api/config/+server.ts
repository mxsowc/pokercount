import { json } from '@sveltejs/kit';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;

export function GET() {
  return json({ googleClientId: GOOGLE_CLIENT_ID });
}
