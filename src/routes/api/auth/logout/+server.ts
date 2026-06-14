import { json } from '@sveltejs/kit';
import { clearCookie } from '$lib/server/auth.js';

export async function POST({ request }) {
  return json({ ok: true }, {
    headers: { 'Set-Cookie': clearCookie(request) }
  });
}
