// One-time server initialization — called from hooks.server.ts.
import { init as initStore } from './store.js';
import { init as initUsers } from './users.js';
import { init as initSocial } from './social.js';
import { init as initReactions } from './reactions.js';
import { init as initComments } from './comments.js';
import { initAuth } from './auth.js';

let done = false;

export function ensureInit() {
  if (done) return;
  initAuth();
  const usersLoaded = initUsers();
  const socialLoaded = initSocial();
  const reactionsLoaded = initReactions();
  const commentsLoaded = initComments();
  const gamesLoaded = initStore();
  console.log(`pokercount ready (${gamesLoaded} game(s), ${usersLoaded} user(s), ${socialLoaded} follow(s), ${reactionsLoaded} reaction set(s), ${commentsLoaded} comment thread(s))`);
  done = true;
}
