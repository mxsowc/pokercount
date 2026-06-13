// Fills the topbar account chip with the signed-in user (or a Sign in link).
// Repaints whenever auth changes (login/logout/rename) via the 'pc:auth' event,
// so the chip never goes stale after an in-page sign-in.
import { api } from '/js/api.js';

const el = document.getElementById('nav-me');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function paint() {
  if (!el) return;
  api.me()
    .then(({ user }) => {
      if (!user) { el.innerHTML = `<a class="pill" href="/account">Sign in</a>`; return; }
      const initial = esc((user.displayName || user.handle || '?').trim().charAt(0).toUpperCase() || '?');
      el.innerHTML =
        `<a class="pill chip-pill" href="/account" title="@${esc(user.handle)}">` +
        `<span class="chip-ava" aria-hidden="true">${initial}</span>${esc(user.displayName)}</a>`;
    })
    .catch(() => { el.innerHTML = `<a class="pill" href="/account">Sign in</a>`; });
}

paint();
window.addEventListener('pc:auth', paint);
// Refresh when returning to the tab (e.g. signed in/out elsewhere).
document.addEventListener('visibilitychange', () => { if (!document.hidden) paint(); });
