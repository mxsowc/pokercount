import { api, subscribe, toast, money, getActor, setActorName, getMyPlayerId, setMyPlayerId, rememberGame, forgetGame } from '/js/api.js';
import { computeSettlement } from '/src/settle.js';
import { haptic, celebrate, animateCounts } from '/js/fx.js';

let lastStatus = null; // to detect live status transitions for celebrations

// Wrap an async click/change handler so a failed network call surfaces a toast
// instead of vanishing as a silent unhandled rejection (and leaving the UI stale).
const guarded = (fn) => async (e) => {
  try { await fn(e); }
  catch (err) { toast(err?.message || 'Something went wrong — try again'); }
};

const params = new URLSearchParams(location.search);
const id = (params.get('g') || '').replace(/[^0-9A-Za-z]/g, '');
const app = document.getElementById('app');
let game = null;
let showActivity = false;
let showShareBanner = params.get('new') === '1';
const expanded = new Set(); // player ids whose history panel is open
let editingSettlement = false; // "adjust who pays who" mode
let draft = null; // draft transfer plan while editing: [{from,to,amount}]
let myAccount = null; // signed-in user, or null (anonymous)
let identityDismissed = localStorage.getItem('pc_idban_' + id); // hide "You are X" banner

if (!id) location.href = '/';

const myId = () => getMyPlayerId(id);
const iAmSeated = () => game && game.players.some((p) => p.id === myId());

// ---- identity ----------------------------------------------------------------
function promptName() {
  const n = window.prompt('Your name (shown next to your edits):', getActor().name || '');
  if (n && n.trim()) { setActorName(n); if (game) render(); }
}

// ---- focus preservation across live re-renders -------------------------------
function captureFocus() {
  const el = document.activeElement;
  if (el && el.dataset && el.dataset.focuskey) {
    return { key: el.dataset.focuskey, start: el.selectionStart, end: el.selectionEnd };
  }
  return null;
}
function restoreFocus(f) {
  if (!f) return;
  const el = document.querySelector(`[data-focuskey="${f.key}"]`);
  if (el) {
    el.focus();
    try { el.setSelectionRange(f.start, f.end); } catch {}
  }
}

const invested = (pid) =>
  game.transactions.filter((t) => t.playerId === pid).reduce((s, t) => s + t.amount, 0);

// ---- render ------------------------------------------------------------------
function render() {
  // Celebrate live status changes (not on first load / page refresh).
  if (lastStatus !== null && game.status !== lastStatus) {
    if (game.status === 'settled') { celebrate({ particles: 180 }); haptic([18, 40, 18]); }
    else if (game.status === 'ended') { celebrate({ particles: 100, power: 11 }); haptic(25); }
  }
  lastStatus = game.status;

  const f = captureFocus();
  const unit = game.unit || '€';
  const totalIn = game.transactions.reduce((s, t) => s + t.amount, 0);
  const settlement = computeSettlement(game.players, game.transactions, game.finalStacks);
  // Are all cash-outs in? Until then, "who pays who" is based on treating blanks
  // as 0, which would show misleading transfers — so we hold it back.
  const allEntered = game.players.length > 0 && game.players.every((p) => game.finalStacks[p.id] != null);
  const me = getActor().name;
  const amHost = !game.hostId
    || game.hostId === getActor().id
    || (myAccount && (game.ownerId === myAccount.id || game.hostId === 'user:' + myAccount.id));
  const defaultBuyin = localStorage.getItem('pc_default_buyin') || 20;

  if (game.status && game.status !== 'active') { renderSummary(unit, amHost); restoreFocus(f); return; }

  app.innerHTML = `
    <div class="spread">
      <div>
        <h1 contenteditable data-focuskey="gname" id="gname" class="editable-title" title="Tap to rename">${esc(game.name)}</h1>
        <div class="small muted">Game <span class="code-badge">#${game.id}</span> · ${game.players.length} players · <span data-count="${totalIn}" data-unit="${unit}" data-countkey="ingame-${game.id}">${money(totalIn, unit)}</span> in play</div>
      </div>
    </div>
    ${showShareBanner ? `
    <div class="banner ok spread" style="margin-top:10px">
      <span>Game open! Share code <b class="code-badge" style="font-size:1rem">#${game.id}</b> so players can join.</span>
      <span style="display:flex; gap:6px">
        <button class="ghost small" id="copy-code">Copy link</button>
        <button class="ghost small" id="dismiss-share">✕</button>
      </span>
    </div>` : ''}
    ${!identityDismissed ? `
    <div class="banner info spread" style="margin-top:10px">
      <span>You are <b>${esc(me || 'unknown')}</b> — every edit is logged under this name.</span>
      <span style="display:flex; gap:6px">
        <button class="ghost small" id="whoami">Change</button>
        <button class="ghost small" id="dismiss-identity">✕</button>
      </span>
    </div>` : ''}

    <div class="spread" style="margin-top:${identityDismissed ? '10' : '0'}px">
      <h2 style="margin-top:12px">Players</h2>
      ${totalIn > 0 ? '<button class="ghost small" id="jump-cashout">↓ Cash out</button>' : ''}
    </div>
    <div id="players">${game.players.map((p) => playerRow(p, unit)).join('') || '<p class="muted">No players yet.</p>'}</div>
    <div class="list-add">
      <input id="new-player" placeholder="Add player name" data-focuskey="newplayer" />
      <button id="add-player">Add</button>
    </div>
    ${game.players.length ? `
      <div class="card" style="background:var(--surface-2); margin-top:10px">
        <div class="spread" style="gap:10px; flex-wrap:wrap">
          <span class="small muted">Buy everyone in for the same amount</span>
          <span style="display:flex; gap:8px; align-items:center">
            <span class="muted">${unit}</span>
            <input id="bulk-amount" type="number" inputmode="decimal" step="any" min="0" value="${defaultBuyin}"
              data-focuskey="bulk-amount" style="max-width:84px; padding:8px" />
            <button class="secondary small" id="bulk-buyin">Buy in all</button>
          </span>
        </div>
      </div>` : ''}

    <h2 id="cashout-section">Cash-out & settle</h2>
    <p class="hint">Enter how much each player has left at the end. ${money(settlement.totalFinal, unit)} counted of ${money(totalIn, unit)} bought in.</p>
    <div class="card">
      ${game.players.map((p) => finalRow(p, unit)).join('') || '<p class="muted">Add players first.</p>'}
      ${game.players.some((p) => game.finalStacks[p.id] == null) && game.players.some((p) => game.finalStacks[p.id] != null)
        ? '<button class="ghost small" id="rest-out" style="width:100%; margin-top:4px">Mark everyone left as out (0)</button>'
        : ''}
    </div>

    ${settleBanner(settlement, unit)}
    ${!allEntered
      ? '<p class="muted small">Enter every player’s cash-out to see who pays who.</p>'
      : settlement.transfers.length ? `
      <h3>Who pays who</h3>
      ${settlement.transfers.map((t) => `
        <div class="transfer">
          <span class="name">${esc(t.fromName)}</span>
          <span class="arrow">→</span>
          <span class="name">${esc(t.toName)}</span>
          <span class="amt">${money(t.amount, unit)}</span>
        </div>`).join('')}
    ` : '<p class="muted small">No payments needed — everyone’s even.</p>'}

    ${amHost
      ? `<button id="close-game" class="secondary" style="width:100%; margin-top:10px">End game &amp; show summary</button>`
      : (allEntered && settlement.balanced && myPlayerIdInGame()
        ? `<button id="close-game" class="secondary" style="width:100%; margin-top:10px">End game &amp; show summary</button>
           <p class="hint">The books balance, so any player can end the game — handy if the host has already left.</p>`
        : '<p class="hint">When everyone has cashed out and the books balance, any player can end the game (the host can end it any time).</p>')}

    <hr class="divider" />
    <div class="spread">
      <button class="ghost small" id="toggle-activity">${showActivity ? 'Hide' : 'Show'} all activity (${(game.log || []).length})</button>
      <a class="small" href="/pot">Need to split a pot? →</a>
    </div>
    ${showActivity ? activityList(unit) : ''}
  `;

  wire();
  restoreFocus(f);
  animateCounts(app);
}

function playerRow(p, unit) {
  const inv = invested(p.id);
  const final = game.finalStacks[p.id];
  const net = (final ?? 0) - inv;
  const open = expanded.has(p.id);
  const txCount = game.transactions.filter((t) => t.playerId === p.id).length;
  const netPill = final == null ? '' :
    `<span class="pill ${net >= 0 ? 'win' : 'lose'}">${net >= 0 ? '+' : ''}${money(net, unit)}</span>`;
  const youTag = p.id === myId() ? ' <span class="pill info">you</span>' : '';
  return `
    <div>
      <div class="player">
        <div>
          <div class="name">${esc(p.name)}${youTag} ${netPill}</div>
          <div class="meta">in ${money(inv, unit)}${final != null ? ` · out ${money(final, unit)}` : ''} · ${txCount} entr${txCount === 1 ? 'y' : 'ies'}</div>
        </div>
        <div class="actions">
          <button class="small secondary" data-add="${p.id}" data-name="${esc(p.name)}">+ Money</button>
          <button class="small ghost" data-hist="${p.id}">${open ? '▾' : '▸'} log</button>
        </div>
      </div>
      ${open ? historyPanel(p, unit) : ''}
    </div>`;
}

function historyPanel(p, unit) {
  const txs = game.transactions.filter((t) => t.playerId === p.id);
  const entries = (game.log || []).filter((e) => e.playerId === p.id).slice().reverse();
  return `
    <div class="card" style="margin:-2px 0 10px; background:var(--surface-2)">
      <h3>Buy-ins & top-ups — edit amounts</h3>
      ${txs.length ? txs.map((t) => `
        <div class="spread small" style="margin-bottom:6px">
          <span>${t.type === 'topup' ? 'top-up' : 'buy-in'} <span class="muted">${time(t.at)}</span></span>
          <span style="display:flex; gap:6px; align-items:center">
            <input type="number" inputmode="decimal" step="any" min="0" value="${t.amount}"
              data-edittx="${t.id}" data-focuskey="tx-${t.id}" style="max-width:100px; padding:6px" />
            <button class="small danger" data-deltx="${t.id}">undo</button>
          </span>
        </div>`).join('') : '<p class="muted small">No buy-ins yet — use “+ Money”.</p>'}
      <hr class="divider" />
      <h3>Edit history</h3>
      ${entries.length ? entries.map((e) => `
        <div class="small" style="margin-bottom:7px; border-left:2px solid var(--border); padding-left:8px">
          ${describe(e, unit)}<br>
          <span class="muted">by ${esc(e.actorName)} · ${time(e.at)}</span>
        </div>`).join('') : '<p class="muted small">No changes recorded yet.</p>'}
      <button class="danger small" data-remove="${p.id}" style="width:100%; margin-top:10px">Remove ${esc(p.name)} and all transactions</button>
    </div>`;
}

function finalRow(p, unit) {
  const v = game.finalStacks[p.id];
  const out = v === 0;
  return `
    <div class="spread" style="margin-bottom:8px">
      <span>${esc(p.name)}</span>
      <span style="display:flex; gap:6px; align-items:center">
        <button type="button" class="ghost small${out ? ' is-out' : ''}" data-out="${p.id}" title="Busted — nothing left">Out</button>
        <input style="max-width:120px" type="number" inputmode="decimal" step="any" min="0"
          placeholder="left (${unit})" data-final="${p.id}" data-focuskey="final-${p.id}"
          value="${v == null ? '' : v}" />
      </span>
    </div>`;
}

function settleBanner(s, unit) {
  if (s.totalFinal === 0) return '';
  if (s.balanced) return `<div class="banner ok">Books balance. Total in = total out = ${money(s.totalInvested, unit)}.</div>`;
  const diff = s.discrepancy;
  return `<div class="banner warn">Off by ${money(Math.abs(diff), unit)} — counted ${money(s.totalFinal, unit)} but ${money(s.totalInvested, unit)} was bought in. ${diff > 0 ? 'Too many chips counted' : 'Missing chips'} — recount before paying out.</div>`;
}

function activityList(unit) {
  const log = (game.log || []).slice().reverse();
  if (!log.length) return '<p class="muted small">No activity yet.</p>';
  return '<div class="stack" style="margin-top:10px">' + log.map((e) => `
    <div class="small" style="border-left:2px solid var(--border); padding-left:8px">
      ${e.playerName ? `<b>${esc(e.playerName)}</b> ` : ''}${describe(e, unit)}<br>
      <span class="muted">by ${esc(e.actorName)} · ${time(e.at)}</span>
    </div>`).join('') + '</div>';
}

// ---- describe a log entry ----------------------------------------------------
function describe(e, unit) {
  const d = e.detail || {};
  switch (e.action) {
    case 'create': return 'created the game';
    case 'add_player': return 'added to the game';
    case 'remove_player': return 'removed from the game';
    case 'rename_player': return `renamed ${esc(d.from)} → ${esc(d.to)}`;
    case 'buyin': return `bought in <b>${money(d.amount, unit)}</b>`;
    case 'topup': return `topped up <b>${money(d.amount, unit)}</b>`;
    case 'edit_tx': return `changed a ${d.type === 'topup' ? 'top-up' : 'buy-in'} from ${money(d.from, unit)} to <b>${money(d.to, unit)}</b>`;
    case 'remove_tx': return `removed a ${d.type === 'topup' ? 'top-up' : 'buy-in'} of ${money(d.amount, unit)}`;
    case 'set_final': return `set cash-out ${d.from == null ? '—' : money(d.from, unit)} → <b>${d.to == null ? '—' : money(d.to, unit)}</b>`;
    case 'close_game': return 'ended the game';
    case 'reopen_game': return 'reopened the game';
    case 'mark_paid': return `marked settled: ${esc(d.from)} → ${esc(d.to)} <b>${money(d.amount, unit)}</b>`;
    case 'mark_unpaid': return `marked unsettled: ${esc(d.from)} → ${esc(d.to)} ${money(d.amount, unit)}`;
    case 'edit_settlement': return 'adjusted who pays who';
    default: return esc(e.action);
  }
}
function time(iso) {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// ---- events ------------------------------------------------------------------
function wire() {
  app.querySelector('#whoami')?.addEventListener('click', promptName);
  app.querySelector('#dismiss-identity')?.addEventListener('click', () => {
    identityDismissed = '1';
    localStorage.setItem('pc_idban_' + id, '1');
    render();
  });
  app.querySelector('#jump-cashout')?.addEventListener('click', () => {
    document.getElementById('cashout-section')?.scrollIntoView({ behavior: 'smooth' });
  });
  app.querySelector('#dismiss-share')?.addEventListener('click', () => { showShareBanner = false; render(); });
  app.querySelector('#copy-code')?.addEventListener('click', shareLink);
  app.querySelector('#add-player')?.addEventListener('click', addPlayer);
  app.querySelector('#new-player')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });
  app.querySelector('#bulk-buyin')?.addEventListener('click', bulkBuyIn);

  app.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => openMoneyModal(b.dataset.add, b.dataset.name)));
  app.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', guarded(async () => {
      if (confirm('Remove this player and their transactions?')) {
        game = await api.removePlayer(id, b.dataset.remove);
        render();
      }
    })));
  app.querySelectorAll('[data-hist]').forEach((b) =>
    b.addEventListener('click', () => {
      const pid = b.dataset.hist;
      expanded.has(pid) ? expanded.delete(pid) : expanded.add(pid);
      render();
    }));
  app.querySelectorAll('[data-edittx]').forEach((inp) =>
    inp.addEventListener('change', guarded(async () => {
      const v = Number(inp.value);
      if (!(v > 0)) { toast('Amount must be more than 0'); return; }
      game = await api.editTx(id, inp.dataset.edittx, v);
      render();
    })));
  app.querySelectorAll('[data-deltx]').forEach((b) =>
    b.addEventListener('click', guarded(async () => { game = await api.removeTx(id, b.dataset.deltx); render(); })));

  app.querySelectorAll('[data-final]').forEach((inp) =>
    inp.addEventListener('change', guarded(async () => {
      const val = inp.value === '' ? null : Number(inp.value);
      game = await api.setFinal(id, inp.dataset.final, val);
      render();
    })));
  // One-tap "busted" — sets a player's cash-out to 0.
  app.querySelectorAll('[data-out]').forEach((b) =>
    b.addEventListener('click', guarded(async () => {
      haptic(9);
      game = await api.setFinal(id, b.dataset.out, 0);
      render();
    })));
  // Bulk: everyone who hasn't cashed out yet busted to 0. Stop and report on the
  // first failure so we never leave some players set and others silently skipped.
  app.querySelector('#rest-out')?.addEventListener('click', guarded(async () => {
    const left = game.players.filter((p) => game.finalStacks[p.id] == null);
    if (!left.length) return;
    if (!confirm(`Mark ${left.length} player${left.length > 1 ? 's' : ''} as out with nothing left?`)) return;
    haptic(12);
    try {
      for (const p of left) game = await api.setFinal(id, p.id, 0);
    } finally {
      render(); // reflect whatever did get saved, even if one call failed
    }
  }));

  const gname = app.querySelector('#gname');
  gname?.addEventListener('blur', guarded(async () => {
    const name = gname.textContent.trim();
    if (name && name !== game.name) { game = await api.setMeta(id, { name }); }
  }));

  app.querySelector('#toggle-activity')?.addEventListener('click', () => { showActivity = !showActivity; render(); });

  app.querySelector('#close-game')?.addEventListener('click', guarded(async () => {
    const s = computeSettlement(game.players, game.transactions, game.finalStacks);
    const missing = game.players.filter((p) => game.finalStacks[p.id] == null);
    let msg = 'End the game and show the summary? You can reopen it later to make changes.';
    if (missing.length) {
      msg = `${missing.length} player${missing.length > 1 ? "s haven't" : " hasn't"} entered a cash-out — they'll be recorded as losing their whole buy-in. End the game anyway?`;
    } else if (!s.balanced) {
      msg = `Heads up — the books are off by ${money(Math.abs(s.discrepancy), game.unit || '€')}. End the game anyway?`;
    }
    if (confirm(msg)) { game = await api.closeGame(id); showShareBanner = false; render(); }
  }));
}

// ---- summary view (game ended) ----------------------------------------------
function ordinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'; }

function renderSummary(unit, amHost) {
  const s = game.settlement || { transfers: [], lines: [], balanced: true, discrepancy: 0 };
  const standings = (s.lines || []).slice().sort((a, b) => (b.net || 0) - (a.net || 0));
  const top = standings.slice(0, 3);
  const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i); // center the winner
  const paid = s.transfers.filter((t) => t.paid).length;
  const allSettled = game.status === 'settled';

  app.innerHTML = `
    <div class="spread">
      <div>
        <h1>${esc(game.name)}</h1>
        <div class="small muted">Game <span class="code-badge">#${game.id}</span> ·
          <span class="status-badge ${allSettled ? 'settled' : 'ended'}">${allSettled ? 'All settled' : 'Game ended'}</span></div>
      </div>
    </div>

    ${top.length ? `
      <h2>Podium</h2>
      <div class="podium">
        ${order.map((i) => {
          const l = top[i];
          const medal = ['🥇', '🥈', '🥉'][i];
          return `<div class="podium-col r${i + 1}">
            <div class="podium-amt ${l.net >= 0 ? 'pos' : 'neg'}" data-count="${l.net}" data-unit="${unit}" data-countsign="1" data-countinit="0" data-countkey="pod-${game.id}-${l.playerId}">${l.net >= 0 ? '+' : ''}${money(l.net, unit)}</div>
            <div class="podium-bar"><span class="medal">${medal}</span><span class="place">${ordinal(i + 1)}</span></div>
            <div class="podium-name">${esc(l.name)}</div>
          </div>`;
        }).join('')}
      </div>` : ''}

    <h2>Final standings</h2>
    <div class="card">
      ${standings.map((l, idx) => `
        <div class="spread" style="margin-bottom:6px">
          <span>${idx + 1}. ${esc(l.name)} <span class="muted small">in ${money(l.invested, unit)}${l.finalStack != null ? ` · out ${money(l.finalStack, unit)}` : ''}</span></span>
          <span style="font-weight:700; color:${l.net >= 0 ? 'var(--accent)' : 'var(--danger)'}">${l.net >= 0 ? '+' : ''}${money(l.net, unit)}</span>
        </div>`).join('')}
    </div>

    ${!s.balanced ? `<div class="banner warn">Note: the books were off by ${money(Math.abs(s.discrepancy), unit)} when the game closed.</div>` : ''}

    ${!editingSettlement ? myBalanceCallout(s, unit) : ''}

    <div class="spread">
      <h2 style="margin-bottom:0">Who pays who ${s.transfers.length && !editingSettlement ? `<span class="small muted">(${paid}/${s.transfers.length} settled)</span>` : ''}</h2>
      ${s.transfers.length && !editingSettlement && s.balanced !== false ? '<button class="ghost small" id="adjust-pay">Adjust</button>' : ''}
    </div>
    ${editingSettlement ? renderSettlementEditor(s, unit) : staticBalances(s, unit, allSettled)}

    ${!myAccount ? `<div class="banner info" style="margin-top:10px">📈 Follow your overall stats — total profit, win rate and more — across every game. <a href="/account">Create an account →</a></div>` : ''}

    <hr class="divider" />
    <div class="spread">
      ${amHost ? '<button class="ghost small" id="reopen-game">↩ Reopen to edit</button>' : '<span class="small muted">Only the host can reopen.</span>'}
      <button class="ghost small" id="toggle-activity">${showActivity ? 'Hide' : 'Show'} all activity (${(game.log || []).length})</button>
    </div>
    ${showActivity ? activityList(unit) : ''}
  `;
  wireSummary();
  animateCounts(app);
}

// Which player is "me" in this game — my account-linked seat, else my device seat.
function myPlayerIdInGame() {
  if (myAccount) {
    const linked = game.players.find((p) => p.userId === myAccount.id);
    if (linked) return linked.id;
  }
  const local = myId();
  return local && game.players.some((p) => p.id === local) ? local : null;
}

// The most important line for the viewer: what they owe / are owed, up top.
function myBalanceCallout(s, unit) {
  const myPid = myPlayerIdInGame();
  if (!myPid) return '';
  const iOwe = (s.transfers || []).filter((t) => t.from === myPid);
  const owed = (s.transfers || []).filter((t) => t.to === myPid);
  if (!iOwe.length && !owed.length) {
    return `<div class="mybal even"><div class="mybal-h">Your result</div><div class="mybal-amt">All square</div>
      <div class="mybal-sub">You don’t owe anyone and no one owes you.</div></div>`;
  }
  const owing = iOwe.length > 0; // a settled player is only ever on one side
  const list = owing ? iOwe : owed;
  const total = list.reduce((a, t) => a + t.amount, 0);
  const allPaid = list.every((t) => t.paid);
  const head = owing ? (allPaid ? 'You paid' : 'You owe') : (allPaid ? 'You received' : 'You’re owed');
  const lines = list.map((t) => {
    const who = owing ? t.toName : t.fromName;
    return `<div class="mybal-line ${t.paid ? 'paid' : ''}">
      <span>${owing ? 'pay' : 'from'} <b>${esc(who)}</b></span>
      <span class="amt">${money(t.amount, unit)} ${t.paid ? '✓' : ''}</span>
    </div>`;
  }).join('');
  return `<div class="mybal ${owing ? 'owe' : 'get'}${allPaid ? ' done' : ''}">
    <div class="mybal-h">${head}</div>
    <div class="mybal-amt">${money(total, unit)}</div>
    <div class="mybal-list">${lines}</div>
  </div>`;
}

// Read-only list of payments with "Mark paid" buttons.
function staticBalances(s, unit, allSettled) {
  let html = allSettled
    ? '<div class="banner ok">✅ All balances settled — this game is done.</div>'
    : (s.transfers.length
        ? '<p class="hint">Tap “Mark paid” once a payment is made. Use <b>Adjust</b> to change who pays who.</p>'
        : '<div class="banner ok">Everyone broke even — nothing to settle.</div>');
  html += s.transfers.map((t) => `
    <div class="transfer ${t.paid ? 'paid' : ''}">
      <span class="name">${esc(t.fromName)}</span><span class="arrow">→</span><span class="name">${esc(t.toName)}</span>
      <span class="amt" data-copy="${t.amount}" style="cursor:pointer" title="Tap to copy">${money(t.amount, unit)}</span>
      <button class="small ${t.paid ? 'secondary' : ''}" data-pay="${t.id}" data-paid="${t.paid ? 1 : 0}">${t.paid ? '✓ paid' : 'Mark paid'}</button>
    </div>
    ${t.paid ? `<div class="small muted" style="margin:-4px 0 8px 6px">settled${t.paidBy ? ` · by ${esc(t.paidBy)}` : ''}${t.paidAt ? ` · ${time(t.paidAt)}` : ''}</div>` : ''}
  `).join('');
  return html;
}

// Debtors (owe money) and creditors (owed money) from the frozen balances.
function settlementParties(s) {
  const debtors = [], creditors = [];
  for (const l of s.lines || []) {
    if (l.net < 0) debtors.push({ id: l.playerId, name: l.name, amount: -l.net });
    else if (l.net > 0) creditors.push({ id: l.playerId, name: l.name, amount: l.net });
  }
  return { debtors, creditors };
}

const cents = (x) => Math.round(Number(x || 0) * 100);

// Editable payment plan with a live balance check.
function renderSettlementEditor(s, unit) {
  const { debtors, creditors } = settlementParties(s);

  // Remaining to pay / receive after the current draft.
  const out = new Map(), inc = new Map();
  for (const t of draft) {
    out.set(t.from, (out.get(t.from) || 0) + cents(t.amount));
    inc.set(t.to, (inc.get(t.to) || 0) + cents(t.amount));
  }
  const remDebt = debtors.map((d) => ({ ...d, rem: cents(d.amount) - (out.get(d.id) || 0) }));
  const remCred = creditors.map((c2) => ({ ...c2, rem: cents(c2.amount) - (inc.get(c2.id) || 0) }));
  const balanced = remDebt.every((d) => d.rem === 0) && remCred.every((c2) => c2.rem === 0);

  const dOpt = (sel) => debtors.map((d) => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  const cOpt = (sel) => creditors.map((c2) => `<option value="${c2.id}" ${c2.id === sel ? 'selected' : ''}>${esc(c2.name)}</option>`).join('');

  const lines = draft.map((t, i) => `
    <div class="transfer" style="gap:6px">
      <select data-ef="from" data-i="${i}" style="flex:1; padding:8px">${dOpt(t.from)}</select>
      <span class="arrow">→</span>
      <select data-ef="to" data-i="${i}" style="flex:1; padding:8px">${cOpt(t.to)}</select>
      <input type="number" inputmode="decimal" step="any" min="0" data-ef="amt" data-i="${i}"
        data-focuskey="ef-amt-${i}" value="${t.amount}" style="max-width:84px; padding:8px" />
      <button class="small danger" data-rmline="${i}">✕</button>
    </div>`).join('');

  const chip = (p) => `<span class="pill ${p.rem === 0 ? 'win' : 'lose'}">${esc(p.name)}: ${p.rem === 0 ? 'ok' : (p.rem > 0 ? money(p.rem / 100, unit) + ' left' : 'over ' + money(-p.rem / 100, unit))}</span>`;

  return `
    <p class="hint">Re-route payments however you like. Each person must still pay or receive their exact total — the checks below turn green when it adds up.</p>
    ${lines || '<p class="muted small">No payments — add one below.</p>'}
    <div style="display:flex; gap:8px; margin:10px 0; flex-wrap:wrap">
      <button class="secondary small" id="add-line">+ Add payment</button>
      <button class="ghost small" id="reset-auto">Reset to suggested</button>
    </div>
    <div class="card" style="background:var(--surface-2)">
      <h3>Still to settle</h3>
      <div style="display:flex; flex-wrap:wrap; gap:6px">
        ${[...remDebt, ...remCred].map(chip).join('')}
      </div>
    </div>
    ${balanced ? '<div class="banner ok small">Balanced — everyone’s totals add up.</div>' : '<div class="banner warn small">Not balanced yet — adjust the amounts so every chip is “ok”.</div>'}
    <div style="display:flex; gap:8px">
      <button id="save-pay" ${balanced ? '' : 'disabled'} style="flex:1">Save plan</button>
      <button class="secondary" id="cancel-pay" style="flex:0 0 auto">Cancel</button>
    </div>`;
}

function syncDraftFromDOM() {
  app.querySelectorAll('[data-ef="from"]').forEach((el) => { draft[+el.dataset.i].from = el.value; });
  app.querySelectorAll('[data-ef="to"]').forEach((el) => { draft[+el.dataset.i].to = el.value; });
  app.querySelectorAll('[data-ef="amt"]').forEach((el) => { draft[+el.dataset.i].amount = el.value; });
}

function wireSummary() {
  app.querySelectorAll('[data-copy]').forEach((el) =>
    el.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(el.dataset.copy); toast('Amount copied'); }
      catch { /* text is visible anyway */ }
    }));
  app.querySelectorAll('[data-pay]').forEach((b) =>
    b.addEventListener('click', guarded(async () => {
      const wasPaid = b.dataset.paid === '1';
      if (!wasPaid) haptic(14);
      game = await api.markTransfer(id, b.dataset.pay, !wasPaid);
      render();
    })));
  app.querySelector('#reopen-game')?.addEventListener('click', guarded(async () => {
    if (confirm('Reopen the game? This unlocks editing and clears the paid marks.')) {
      game = await api.reopenGame(id);
      render();
    }
  }));
  app.querySelector('#toggle-activity')?.addEventListener('click', () => { showActivity = !showActivity; render(); });

  // ---- settlement editor ----
  app.querySelector('#adjust-pay')?.addEventListener('click', () => {
    editingSettlement = true;
    draft = (game.settlement.transfers || []).map((t) => ({ from: t.from, to: t.to, amount: t.amount }));
    render();
  });
  app.querySelector('#cancel-pay')?.addEventListener('click', () => { editingSettlement = false; draft = null; render(); });
  app.querySelectorAll('[data-ef]').forEach((el) =>
    el.addEventListener('change', () => { syncDraftFromDOM(); render(); }));
  app.querySelectorAll('[data-rmline]').forEach((b) =>
    b.addEventListener('click', () => { syncDraftFromDOM(); draft.splice(+b.dataset.rmline, 1); render(); }));
  app.querySelector('#add-line')?.addEventListener('click', () => {
    syncDraftFromDOM();
    const { debtors, creditors } = settlementParties(game.settlement);
    if (!debtors.length || !creditors.length) return;
    draft.push({ from: debtors[0].id, to: creditors[0].id, amount: '' });
    render();
  });
  app.querySelector('#reset-auto')?.addEventListener('click', () => {
    const auto = computeSettlement(game.players, game.transactions, game.finalStacks);
    draft = auto.transfers.map((t) => ({ from: t.from, to: t.to, amount: t.amount }));
    render();
  });
  app.querySelector('#save-pay')?.addEventListener('click', async () => {
    syncDraftFromDOM();
    try {
      game = await api.editSettlement(id, draft.filter((t) => Number(t.amount) > 0));
      editingSettlement = false; draft = null;
      render();
    } catch (e) { toast(e.message); }
  });
}

async function addPlayer() {
  const inp = app.querySelector('#new-player');
  const name = inp.value.trim();
  if (!name) return;
  try {
    game = await api.addPlayer(id, name); // server rejects a duplicate name
    inp.value = '';
    render();
  } catch (e) {
    toast(e.message); // e.g. There's already a player called "X" in this game.
  }
}

// Buy in everyone who hasn't bought in yet, for the same amount. Safe to re-use
// as players join — it only touches players with no buy-in yet.
async function bulkBuyIn() {
  const amt = Number(app.querySelector('#bulk-amount').value);
  if (!(amt > 0)) { toast('Enter an amount'); return; }
  localStorage.setItem('pc_default_buyin', amt);
  const targets = game.players.filter((p) => !game.transactions.some((t) => t.playerId === p.id));
  if (!targets.length) { toast('Everyone has bought in already'); return; }
  const btn = app.querySelector('#bulk-buyin');
  if (btn) btn.disabled = true;
  let done = 0;
  try {
    for (const p of targets) { game = await api.addTx(id, p.id, amt, 'buyin'); done++; }
    haptic([10, 30, 10]);
    toast(`Bought in ${targets.length} player${targets.length > 1 ? 's' : ''} for ${money(amt, game.unit || '€')}`);
  } catch (e) {
    toast(done ? `Stopped after ${done} — ${e.message}` : (e.message || 'Could not buy in'));
  } finally {
    if (btn) btn.disabled = false;
    render(); // reflect whatever was saved
  }
}

// ---- backdrop click to close dialogs -----------------------------------------
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---- money modal -------------------------------------------------------------
const modal = document.getElementById('money-modal');
let modalTarget = null;
// A player's first money is a "buy-in"; anything after is a "top-up". We derive
// this automatically so the user never has to pick — same meaningful log labels,
// no decision to make.
let modalType = 'buyin';

// Poker-chip quick amounts — tap chips to stack up a buy-in.
modal.querySelectorAll('#modal-chips [data-chip]').forEach((b) =>
  b.addEventListener('click', () => {
    const amt = modal.querySelector('#modal-amount');
    if (b.dataset.chip === 'clear') amt.value = '';
    else amt.value = String(Math.round(((Number(amt.value) || 0) + Number(b.dataset.chip)) * 100) / 100);
    haptic(9);
  }));

function openMoneyModal(pid, name) {
  modalTarget = pid;
  const hasPrior = game.transactions.some((t) => t.playerId === pid);
  modalType = hasPrior ? 'topup' : 'buyin';
  modal.querySelector('#modal-title').textContent = hasPrior ? `Top up — ${name}` : `Buy in — ${name}`;
  const amt = modal.querySelector('#modal-amount');
  amt.value = localStorage.getItem('pc_default_buyin') || '15';
  if (modal.open) modal.close(); // guard: showModal() throws if already open
  modal.showModal();
  setTimeout(() => amt.focus(), 50);
}

modal.querySelector('#modal-add').addEventListener('click', async () => {
  const btn = modal.querySelector('#modal-add');
  const amount = Number(modal.querySelector('#modal-amount').value);
  if (!(amount > 0)) { toast('Enter an amount'); return; }
  btn.disabled = true;
  let updated = null;
  try {
    updated = await api.addTx(id, modalTarget, amount, modalType);
  } catch (e) {
    toast(e.message || 'Could not add money');
  } finally {
    btn.disabled = false;
  }
  // Only close + re-render on success — and keep a render error from masquerading
  // as an "add failed" (the money is already saved at this point).
  if (updated) {
    game = updated;
    haptic(14);
    modal.close();
    render();
  }
});
modal.querySelector('#modal-amount').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); modal.querySelector('#modal-add').click(); }
});

// ---- share -------------------------------------------------------------------
async function shareLink() {
  const url = `${location.origin}/game?g=${id}`;
  const data = { title: 'pokercount', text: `Join the game (code #${id})`, url };
  if (navigator.share) { try { await navigator.share(data); return; } catch {} }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); }
  catch { prompt('Copy this link:', url); }
}
document.getElementById('share').addEventListener('click', shareLink);

// ---- util --------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- newcomer join gate ------------------------------------------------------
// Someone opening a shared link who hasn't taken a seat on this device yet.
const joinModal = document.getElementById('join-modal');
function openJoinGate() {
  const nameInput = joinModal.querySelector('#join-name');
  nameInput.value = getActor().name || '';
  joinModal.querySelector('#join-sub').textContent = `Game #${id} — enter your name to take a seat.`;
  joinModal.showModal();
  setTimeout(() => nameInput.focus(), 50);
}
joinModal.querySelector('#join-go').addEventListener('click', async () => {
  const name = joinModal.querySelector('#join-name').value.trim();
  if (!name) { toast('Enter your name'); return; }
  setActorName(name);
  let res;
  try {
    res = await api.joinGame(id, name); // server rejects a duplicate name (keep the modal open)
  } catch (e) {
    toast(e.message);
    return;
  }
  game = res.game;
  setMyPlayerId(id, res.playerId);
  rememberGame(game);
  joinModal.close();
  render();
});
joinModal.querySelector('#join-watch').addEventListener('click', () => {
  if (!getActor().name) setActorName('Spectator');
  joinModal.close();
  render();
});

// ---- boot --------------------------------------------------------------------
(async () => {
  try {
    game = await api.getGame(id);
  } catch (e) {
    const missing = String(e.message || '').toLowerCase().includes('not found');
    if (missing) {
      forgetGame(id); // drop the dead link from "Continue a game"
      app.innerHTML = `<div class="banner warn">Game <b>#${esc(id)}</b> no longer exists, so it's been removed from your list.</div><p><a href="/">← Back home</a></p>`;
    } else {
      app.innerHTML = `<div class="banner warn">Couldn't reach the server. Check it's running and try again.</div><p><a href="/">← Back home</a></p>`;
    }
    return;
  }
  try { myAccount = (await api.me()).user; } catch {}
  render();
  if (showShareBanner) toast('Game started!');
  rememberGame(game); // refresh last-seen so it shows under "Continue a game"
  subscribe(id, (g) => { game = g; render(); });
  // If this device hasn't taken a seat in this game yet, offer to join.
  if (!iAmSeated()) openJoinGate();
})();
