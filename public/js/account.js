import { api, toast, setActorName, listMyGames, getMyPlayerId } from '/js/api.js';
import { renderStatsHTML } from '/js/statsview.js';
import { animateCounts } from '/js/fx.js';

const root = document.getElementById('account-app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Link any games this device already played to the new account, so signing up
// after playing still pulls those games into your stats.
async function claimRecentSeats() {
  for (const g of listMyGames()) {
    const pid = getMyPlayerId(g.id);
    if (pid) { try { await api.claimSeat(g.id, pid); } catch {} }
  }
}

// Called after a successful login/signup.
async function afterAuth() {
  await claimRecentSeats();
  refresh();
}

async function refresh() {
  let user = null;
  try { ({ user } = await api.me()); } catch {}
  window.dispatchEvent(new Event('pc:auth')); // keep the topbar chip in sync
  if (!user) return renderLoggedOut();
  if (user.needsHandle) return renderChooseName(user); // first OAuth sign-in
  renderLoggedIn(user);
}

// First sign-in for Google/Apple users: pick the name once (pre-filled with a
// suggestion from their account). Can still be changed later.
function renderChooseName(user) {
  root.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">Pick your name</h2>
      <p class="muted small">This is your public profile (<b>/u/name</b>) and how you show up in games. You can change it later.</p>
      <label>Name</label>
      <input id="ch-name" value="${esc(user.handle)}" autocapitalize="none" />
      <button id="ch-go" style="width:100%;margin-top:14px">Save and continue</button>
    </div>`;
  const go = async () => {
    try { await api.updateMe(root.querySelector('#ch-name').value.trim()); refresh(); }
    catch (e) { toast(e.message); }
  };
  root.querySelector('#ch-go').onclick = go;
  root.querySelector('#ch-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

function renderLoggedIn(user) {
  setActorName(user.displayName); // edits in games now show your account name
  root.innerHTML = `
    <div class="card">
      <div class="spread">
        <div><h2 style="margin:0">${esc(user.displayName)}</h2><div class="muted small">@${esc(user.handle)} · ${esc(user.provider)} account</div></div>
        <div style="display:flex; gap:6px">
          <button class="ghost small" id="editname">Edit name</button>
          <button class="danger small" id="logout">Log out</button>
        </div>
      </div>
      <p style="margin-top:12px"><a href="/u/${esc(user.handle)}">View your public profile →</a></p>
    </div>
    <h2>Your stats</h2>
    <div id="mystats"><p class="muted">Loading…</p></div>`;
  document.getElementById('editname').onclick = async () => {
    const n = window.prompt('Change your name:', user.displayName);
    if (n && n.trim()) { try { await api.updateMe(n.trim()); refresh(); } catch (e) { toast(e.message); } }
  };
  document.getElementById('logout').onclick = async () => { await api.logout(); toast('Logged out'); refresh(); };
  api.userStats(user.handle)
    .then(({ user: u, stats }) => {
      const el = document.getElementById('mystats');
      el.innerHTML = renderStatsHTML(u, stats);
      animateCounts(el);
    })
    .catch(() => { document.getElementById('mystats').innerHTML = '<p class="muted">No stats yet.</p>'; });
}

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <div class="row tight" style="margin-bottom:14px">
        <button class="secondary" data-tab="login">Log in</button>
        <button class="secondary" data-tab="signup">Create account</button>
      </div>
      <div id="tab"></div>
    </div>
    <div id="google-slot"></div>
    <p class="center" style="margin-top:18px"><a href="/" id="no-account">Continue without an account →</a></p>
    <p class="hint center">You can play and settle games without signing up. An account just lets you follow your overall stats over time.</p>`;
  const tabEl = root.querySelector('#tab');
  const show = (t) => {
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    t === 'signup' ? signupForm(tabEl) : loginForm(tabEl);
  };
  root.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  show('login');
  setupGoogle(document.getElementById('google-slot'));
}

function loginForm(el) {
  el.innerHTML = `
    <label>Name</label><input id="l-handle" placeholder="yourname" autocapitalize="none" autocomplete="username" />
    <label>Passcode</label><input id="l-pin" type="password" placeholder="your passcode" autocomplete="current-password" />
    <button id="l-go" style="width:100%;margin-top:14px">Log in</button>`;
  const go = async () => {
    try {
      await api.login(el.querySelector('#l-handle').value.trim(), el.querySelector('#l-pin').value);
      afterAuth();
    } catch (e) { toast(e.message); }
  };
  el.querySelector('#l-go').onclick = go;
  el.querySelector('#l-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

function signupForm(el) {
  el.innerHTML = `
    <label>Name <span class="muted">(also your profile at /u/name)</span></label>
    <input id="s-name" placeholder="max" autocapitalize="none" autocomplete="username" />
    <p class="hint" id="s-name-hint" style="margin-top:5px">3–20 characters · lowercase letters, numbers or _</p>
    <label>Passcode <span class="muted">(you’ll use it to log in)</span></label>
    <input id="s-pin" type="password" placeholder="at least 4 characters" autocomplete="new-password" />
    <label>Confirm passcode</label>
    <input id="s-pin2" type="password" placeholder="re-enter passcode" autocomplete="new-password" />
    <button id="s-go" style="width:100%;margin-top:14px">Create account</button>`;

  const nameEl = el.querySelector('#s-name');
  const hint = el.querySelector('#s-name-hint');
  const handleOf = (v) => v.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  // Live preview of the normalised handle, so there are no surprises after submit.
  nameEl.addEventListener('input', () => {
    const raw = nameEl.value.trim();
    const h = handleOf(raw);
    hint.classList.remove('bad', 'ok');
    if (!raw) { hint.textContent = '3–20 characters · lowercase letters, numbers or _'; return; }
    if (h.length < 3 || h.length > 20) {
      hint.textContent = `Your profile will be /u/${h || '…'} — needs 3–20 characters`;
      hint.classList.add('bad');
    } else {
      hint.textContent = `Your profile will be /u/${h}`;
      hint.classList.add('ok');
    }
  });

  const go = async () => {
    const name = nameEl.value.trim();
    const handle = handleOf(name);
    const pin = el.querySelector('#s-pin').value;
    const pin2 = el.querySelector('#s-pin2').value;
    if (handle.length < 3 || handle.length > 20) { toast('Name must be 3–20 letters, numbers or _'); return; }
    if (pin.length < 4) { toast('Passcode must be at least 4 characters'); return; }
    if (pin !== pin2) { toast('Passcodes don’t match — re-enter to confirm'); return; }
    try {
      await api.signup(name, name, pin); // name doubles as handle
      afterAuth();
    } catch (e) { toast(e.message); }
  };
  el.querySelector('#s-go').onclick = go;
  el.querySelector('#s-pin2').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

async function setupGoogle(slot) {
  let cfg = {};
  try { cfg = await api.config(); } catch {}
  if (!cfg.googleClientId) {
    slot.innerHTML = '<p class="hint center" style="margin-top:14px">Google sign-in isn’t enabled on this server.</p>';
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true; s.defer = true;
  s.onload = () => {
    window.google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: async (resp) => {
        try { await api.googleAuth(resp.credential); afterAuth(); }
        catch (e) { toast(e.message); }
      },
    });
    slot.innerHTML = '<div class="center small muted" style="margin:14px 0 8px">or</div><div id="gbtn" class="center"></div>';
    window.google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'filled_black', size: 'large', shape: 'pill' });
  };
  document.head.appendChild(s);
}

refresh();
