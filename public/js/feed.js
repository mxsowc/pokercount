import { api } from '/js/api.js';

const root = document.getElementById('feed-app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ago(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function fmtAmount(net, unit) {
  const abs = Math.abs(net).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (net >= 0 ? '+' : '\u2212') + unit + abs;
}

// ---- feed rendering --------------------------------------------------------
(async () => {
  try {
    const { items } = await api.feed();
    if (items.length === 0) {
      root.innerHTML = `
        <div class="banner info">
          No activity yet. Search for players above and follow them to see their results here.
        </div>`;
      return;
    }
    root.innerHTML = items.map((item) => {
      const even = item.net === 0;
      const won = item.net > 0;
      const verb = even ? 'broke even in' : (won ? 'won' : 'lost');
      const cls = even ? '' : (won ? 'pos' : 'neg');
      const amtText = even ? '' : ` <span class="feed-amt ${cls}">${fmtAmount(item.net, item.unit)}</span>`;
      const inWord = even ? '' : ' in';
      const initial = (item.user.displayName || '?').charAt(0).toUpperCase();
      return `
        <a class="feed-card" href="/game?g=${item.game.id}">
          <span class="chip-ava feed-ava" aria-hidden="true">${esc(initial)}</span>
          <div class="feed-body">
            <div class="feed-line">
              <span class="feed-who" data-handle="${esc(item.user.handle)}">${esc(item.user.displayName)}</span>
              ${verb}${amtText}${inWord} <span class="feed-game">${esc(item.game.name)}</span>
            </div>
            <div class="feed-meta muted small">${ago(item.at)}</div>
          </div>
        </a>`;
    }).join('');

    // Name links to profile (stop propagation so the card link doesn't fire)
    root.querySelectorAll('.feed-who').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        location.href = '/u/' + el.dataset.handle;
      });
    });
  } catch (e) {
    if (String(e.message).toLowerCase().includes('sign in')) {
      root.innerHTML = `<div class="banner info">Sign in to see your feed. <a href="/account">Sign in</a></div>`;
    } else {
      root.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
    }
  }
})();

// ---- search ----------------------------------------------------------------
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let searchTimer;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 1) { searchResults.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    try {
      const { users } = await api.searchUsers(q);
      if (users.length === 0) {
        searchResults.innerHTML = '<div class="search-empty muted small">No players found</div>';
      } else {
        searchResults.innerHTML = users.map((u) => {
          const initial = (u.displayName || '?').charAt(0).toUpperCase();
          return `
            <a class="search-hit" href="/u/${esc(u.handle)}">
              <span class="chip-ava" aria-hidden="true" style="width:28px;height:28px;font-size:.65rem">${esc(initial)}</span>
              <div>
                <div class="search-hit-name">${esc(u.displayName)}</div>
                <div class="muted small">@${esc(u.handle)}</div>
              </div>
            </a>`;
        }).join('');
      }
      searchResults.hidden = false;
    } catch {
      searchResults.hidden = true;
    }
  }, 250);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.feed-search')) searchResults.hidden = true;
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchResults.hidden = true; searchInput.blur(); }
});
