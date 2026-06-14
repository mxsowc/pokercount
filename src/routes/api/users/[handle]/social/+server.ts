import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getByHandle } from '$lib/server/users.js';
import * as social from '$lib/server/social.js';

export function GET({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const target = getByHandle(params.handle);
  if (!target) return json({ error: 'no such player' }, { status: 404 });
  return json({
    followers: social.getFollowerCount(target.id),
    following: social.getFollowingCount(target.id),
    youFollow: social.isFollowing(su.id, target.id),
  });
}
