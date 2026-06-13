import { api, toast } from '/js/api.js';
import { renderStatsHTML } from '/js/statsview.js';
import { animateCounts } from '/js/fx.js';

const root = document.getElementById('profile-app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const handle = decodeURIComponent(location.pathname.replace(/^\/u\//, '')).replace(/[^a-zA-Z0-9_]/g, '');

function renderUserList(title, users, onClose) {
  const initial = (n) => (n || '?').charAt(0).toUpperCase();
  return `
    <div class="social-list-overlay" id="social-overlay">
      <div class="social-list-sheet">
        <div class="spread" style="margin-bottom:12px">
          <h3 style="margin:0">${esc(title)}</h3>
          <button class="ghost small" id="close-social-list">\u2715</button>
        </div>
        ${users.length ? users.map((u) => `
          <a class="search-hit" href="/u/${esc(u.handle)}">
            <span class="chip-ava" aria-hidden="true" style="width:28px;height:28px;font-size:.65rem">${esc(initial(u.displayName))}</span>
            <div>
              <div class="search-hit-name">${esc(u.displayName)}</div>
              <div class="muted small">@${esc(u.handle)}</div>
            </div>
          </a>`).join('') : '<p class="muted small" style="padding:8px 0">None yet.</p>'}
      </div>
    </div>`;
}

(async () => {
  try {
    const { user, stats } = await api.userStats(handle);
    root.innerHTML = renderStatsHTML(user, stats);
    animateCounts(root);

    // Social: follow button + counts (only for signed-in viewers)
    try {
      const { user: me } = await api.me();
      if (!me) return;
      const isOwn = me.handle === user.handle;
      const { followers, following, youFollow } = await api.userSocial(handle);

      const card = root.querySelector('.card');
      if (!card) return;

      const bar = document.createElement('div');
      bar.className = 'profile-social';
      bar.innerHTML = `
        <div class="profile-counts">
          <span class="profile-count-link" data-list="followers"><b id="pf-followers">${followers}</b> <span class="muted small">follower${followers !== 1 ? 's' : ''}</span></span>
          <span class="profile-count-link" data-list="following"><b>${following}</b> <span class="muted small">following</span></span>
        </div>
        ${isOwn ? '' : `<button id="follow-btn" class="${youFollow ? 'ghost small' : 'small'}">${youFollow ? 'Unfollow' : 'Follow'}</button>`}`;
      card.insertBefore(bar, card.children[1] || null);

      // Clickable follower/following counts — show list overlay
      bar.querySelectorAll('.profile-count-link').forEach((el) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', async () => {
          const which = el.dataset.list;
          try {
            const data = which === 'followers'
              ? await api.userFollowers(handle)
              : await api.userFollowing(handle);
            const list = data.followers || data.following || [];
            const title = which === 'followers' ? `Followers of ${user.displayName}` : `${user.displayName} follows`;
            // Never stack overlays: a second open would create a duplicate
            // #social-overlay and getElementById would resolve the wrong one,
            // leaving an undismissable sheet. Drop any existing one first.
            document.getElementById('social-overlay')?.remove();
            document.body.insertAdjacentHTML('beforeend', renderUserList(title, list));
            const overlay = document.getElementById('social-overlay');
            overlay.querySelector('#close-social-list').onclick = () => overlay.remove();
            overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
          } catch { /* fail silently — counts are still visible */ }
        });
      });

      if (!isOwn) {
        let isFollowing = youFollow;
        document.getElementById('follow-btn').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            if (isFollowing) {
              await api.unfollow(handle);
              isFollowing = false;
              btn.textContent = 'Follow';
              btn.className = 'small';
            } else {
              await api.follow(handle);
              isFollowing = true;
              btn.textContent = 'Unfollow';
              btn.className = 'ghost small';
            }
            const fc = document.getElementById('pf-followers');
            const n = parseInt(fc.textContent) || 0;
            const newCount = isFollowing ? n + 1 : Math.max(0, n - 1);
            fc.textContent = newCount;
            fc.nextElementSibling.textContent = newCount === 1 ? 'follower' : 'followers';
          } catch (err) { toast(err?.message || 'Something went wrong'); }
          btn.disabled = false;
        });
      }
    } catch { /* social data failed — profile still works */ }
  } catch (e) {
    if (String(e.message).toLowerCase().includes('sign in')) {
      root.innerHTML = `<div class="banner info">Profiles are visible to signed-in players. <a href="/account">Sign in \u2192</a></div>`;
    } else if (String(e.message).includes('no such')) {
      root.innerHTML = `<div class="banner warn">No player <b>@${esc(handle)}</b>.</div><p><a href="/">\u2190 Home</a></p>`;
    } else {
      root.innerHTML = `<div class="banner warn">${esc(e.message)}</div><p><a href="/">\u2190 Home</a></p>`;
    }
  }
})();
