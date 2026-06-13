import { api } from '/js/api.js';
import { renderStatsHTML } from '/js/statsview.js';
import { animateCounts } from '/js/fx.js';

const root = document.getElementById('profile-app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const handle = decodeURIComponent(location.pathname.replace(/^\/u\//, '')).replace(/[^a-zA-Z0-9_]/g, '');

(async () => {
  try {
    const { user, stats } = await api.userStats(handle);
    root.innerHTML = renderStatsHTML(user, stats);
    animateCounts(root);
  } catch (e) {
    if (String(e.message).toLowerCase().includes('sign in')) {
      root.innerHTML = `<div class="banner info">Profiles are visible to signed-in players. <a href="/account">Sign in →</a></div>`;
    } else if (String(e.message).includes('no such')) {
      root.innerHTML = `<div class="banner warn">No player <b>@${esc(handle)}</b>.</div><p><a href="/">← Home</a></p>`;
    } else {
      root.innerHTML = `<div class="banner warn">${esc(e.message)}</div><p><a href="/">← Home</a></p>`;
    }
  }
})();
