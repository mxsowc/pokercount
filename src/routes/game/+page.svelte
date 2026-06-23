<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { toast } from '$lib/stores/toast';
  import { money } from '$lib/utils/money';
  import { ago, shortDate } from '$lib/utils/time';
  import { haptic, celebrate } from '$lib/utils/fx';
  import { computeSettlement } from '$lib/engine/settle.js';
  import { onMount, onDestroy, tick } from 'svelte';

  // ---- state ----------------------------------------------------------------
  let game = $state<any>(null);
  let myAccount = $state<any>(null);
  let showActivity = $state(false);
  let showShareBanner = $state(false);
  let showTrackTip = $state(false); // host-only "how to keep score" recommendation
  let expanded = $state(new Set<string>());
  let loading = $state(true);
  let error = $state('');
  let identityDismissed = $state(false);
  let lastStatus = $state<string | null>(null);
  let liveStatus = $state<string | null>(null);

  // Money modal
  let modalOpen = $state(false);
  let modalTarget = $state('');
  let modalName = $state('');
  let modalType = $state<'buyin' | 'topup'>('buyin');
  let modalAmount = $state('20');

  // Join modal
  let joinOpen = $state(false);
  let joinNameVal = $state('');

  // Settlement editor
  let editingSettlement = $state(false);
  let draft = $state<any[]>([]);

  // Forgive-small-transfers threshold
  let forgiveMax = $state(3);

  // Live standings / per-player summary screen (shown over the active game)
  let activeView = $state<'play' | 'standings'>('play');

  // Bulk buy-in
  let bulkAmount = $state('20');

  // New player input + connection autocomplete
  let newPlayerName = $state('');
  let suggestions = $state<any[]>([]);
  let showSuggest = $state(false);
  let suggestActive = $state(-1);
  let pickedUserId = $state<string | null>(null); // set when a suggestion is chosen
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;

  // Claim-your-seat
  let claimOpen = $state(false);

  // Themed confirm dialog (replaces native confirm() — un-themeable & jarring on mobile)
  let confirmState = $state<{ message: string; label: string; danger: boolean; resolve: (v: boolean) => void } | null>(null);
  function askConfirm(message: string, label = 'Confirm', danger = false): Promise<boolean> {
    return new Promise((resolve) => { confirmState = { message, label, danger, resolve }; });
  }
  function answerConfirm(v: boolean) { confirmState?.resolve(v); confirmState = null; }

  const gameId = $derived($page.url.searchParams.get('g')?.replace(/[^0-9A-Za-z]/g, '') || '');
  const isNew = $derived($page.url.searchParams.get('new') === '1');

  // ---- actor / localStorage helpers -----------------------------------------
  function getActor() {
    if (!browser) return { id: '', name: '' };
    let id = localStorage.getItem('pc_actor_id');
    if (!id) { id = 'u_' + crypto.randomUUID().slice(0, 8); localStorage.setItem('pc_actor_id', id); }
    return { id, name: localStorage.getItem('pc_actor_name') || '' };
  }
  function setActorName(n: string) { if (browser) localStorage.setItem('pc_actor_name', n); }

  function actorHeaders(): Record<string, string> {
    const a = getActor();
    const h: Record<string, string> = { 'X-Actor-Id': a.id, 'X-Actor-Name': encodeURIComponent(a.name || 'Someone') };
    if (browser) {
      const pid = localStorage.getItem('pc_me_' + gameId);
      if (pid) h['X-Player-Id'] = pid;
      const ht = localStorage.getItem('pc_host_' + gameId);
      if (ht) h['X-Host-Token'] = ht;
    }
    return h;
  }

  async function api(method: string, path: string, body?: any) {
    const opts: RequestInit = { method, headers: { ...actorHeaders() } };
    if (body !== undefined) {
      (opts.headers as any)['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ---- derived values -------------------------------------------------------
  const myId = () => browser ? localStorage.getItem('pc_me_' + gameId) : null;
  // A seated player who linked an account exposes a `handle` (added server-side);
  // used to highlight their name and link straight to their public profile.
  const playerHandle = (pid: string): string | undefined =>
    game?.players?.find((p: any) => p.id === pid)?.handle;
  const iAmSeated = () => game?.players?.some((p: any) => p.id === myId());
  // Sum in integer cents (not floating major units) so displayed totals can't
  // drift from the cents-exact settlement engine (e.g. 1000×0.07 ≠ 69.999…).
  const invested = (pid: string) => (game?.transactions ?? []).filter((t: any) => t.playerId === pid).reduce((s: number, t: any) => s + Math.round(t.amount * 100), 0) / 100;
  const unit = $derived(game?.unit || '€');

  // Account ↔ seat linkage (for claim / leave)
  const mySeat = $derived(myAccount && game ? game.players.find((p: any) => p.userId === myAccount.id) ?? null : null);
  const unclaimedSeats = $derived(game ? game.players.filter((p: any) => !p.userId) : []);
  const seatedUserIds = $derived(new Set((game?.players ?? []).map((p: any) => p.userId).filter(Boolean)));
  // If an unclaimed seat name matches my account name, it's probably mine — pre-offer it.
  const suggestedClaim = $derived.by(() => {
    if (!myAccount) return null;
    const dn = (myAccount.displayName || '').trim().toLowerCase();
    return unclaimedSeats.find((p: any) => p.name.trim().toLowerCase() === dn) ?? null;
  });
  const totalIn = $derived(game ? game.transactions.reduce((s: number, t: any) => s + Math.round(t.amount * 100), 0) / 100 : 0);

  // Live settlement computation for the active game view
  let settlement = $derived.by(() => {
    if (!game || game.status !== 'active') return null;
    try {
      return computeSettlement(game.players, game.transactions, game.finalStacks);
    } catch { return null; }
  });
  const allEntered = $derived(game ? game.players.length > 0 && game.players.every((p: any) => game.finalStacks[p.id] != null) : false);

  // Live standings: rank the players who've cashed out by net; the rest are "still in".
  // Updates live for everyone as cash-outs come in over SSE.
  const liveStandings = $derived.by(() => {
    const lines = settlement?.lines ?? [];
    const ranked = lines
      .filter((l: any) => game?.finalStacks?.[l.playerId] != null)
      .slice()
      .sort((a: any, b: any) => (b.net ?? 0) - (a.net ?? 0));
    const pending = lines.filter((l: any) => game?.finalStacks?.[l.playerId] == null);
    return { ranked, pending };
  });
  // The viewer's own line (if they're seated on this device).
  const myLiveLine = $derived.by(() => {
    const id = myId();
    return id ? (settlement?.lines ?? []).find((l: any) => l.playerId === id) ?? null : null;
  });
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  // ---- confetti on status change --------------------------------------------
  $effect(() => {
    if (!game || !browser) return;
    if (lastStatus !== null && game.status !== lastStatus) {
      if (game.status === 'settled') { celebrate({ particles: 180 }); haptic([18, 40, 18]); }
      else if (game.status === 'ended') { celebrate({ particles: 100, power: 11 }); haptic(25); }
    }
    lastStatus = game.status;
  });

  // ---- SSE ------------------------------------------------------------------
  let unsub: (() => void) | null = null;

  onMount(async () => {
    if (!gameId) { window.location.href = '/'; return; }
    showShareBanner = isNew;
    identityDismissed = !!localStorage.getItem('pc_idban_' + gameId);
    // Show the host (this is the device that created the game) a one-time tip on
    // how to keep score, unless they've dismissed it for this game.
    showTrackTip = !!localStorage.getItem('pc_host_' + gameId) && !localStorage.getItem('pc_tracktip_' + gameId);
    bulkAmount = localStorage.getItem('pc_default_buyin') || '20';

    try {
      game = await api('GET', `/api/games/${gameId}`);
    } catch (e: any) {
      error = e.message?.includes('not found') ? `Game #${gameId} not found.` : 'Could not reach the server.';
      loading = false;
      return;
    }
    try { myAccount = (await api('GET', '/api/me')).user; } catch {}
    loading = false;
    if (showShareBanner) toast('Game started!');

    // SSE live updates
    const es = new EventSource(`/api/games/${gameId}/events`);
    es.addEventListener('update', (e) => { try { game = JSON.parse(e.data); } catch {} });
    es.addEventListener('open', () => { if (liveStatus) { liveStatus = null; toast('Reconnected'); } });
    es.addEventListener('error', () => {
      liveStatus = es.readyState === EventSource.CLOSED ? 'Live sync stopped — refresh to reconnect.' : 'Reconnecting…';
    });
    unsub = () => es.close();

    // Returned here from sign-in to claim a seat → open the picker.
    if ($page.url.searchParams.get('claim') === '1' && myAccount && !mySeat) {
      claimOpen = true;
    }
    // Note: we no longer auto-pop the join modal. Viewing a shared game shouldn't
    // hit a name-entry wall — people opt in via the "Take a seat" button instead.
  });
  onDestroy(() => unsub?.());

  // ---- describe log entries -------------------------------------------------
  function describe(e: any): string {
    const d = e.detail || {};
    switch (e.action) {
      case 'create': return 'created the game';
      case 'add_player': return 'added to the game';
      case 'remove_player': return 'removed from the game';
      case 'rename_player': return `renamed ${d.from} → ${d.to}`;
      case 'buyin': return `bought in ${money(d.amount, unit)}`;
      case 'topup': return `topped up ${money(d.amount, unit)}`;
      case 'edit_tx': return `changed ${d.type === 'topup' ? 'top-up' : 'buy-in'} from ${money(d.from, unit)} to ${money(d.to, unit)}`;
      case 'remove_tx': return `removed ${d.type === 'topup' ? 'top-up' : 'buy-in'} of ${money(d.amount, unit)}`;
      case 'set_final': return `cash-out ${d.from == null ? '—' : money(d.from, unit)} → ${d.to == null ? '—' : money(d.to, unit)}`;
      case 'close_game': return 'ended the game';
      case 'reopen_game': return 'reopened the game';
      case 'mark_paid': return `marked settled: ${d.from} → ${d.to} ${money(d.amount, unit)}`;
      case 'mark_unpaid': return `marked unsettled: ${d.from} → ${d.to} ${money(d.amount, unit)}`;
      case 'edit_settlement': return 'adjusted who pays who';
      default: return e.action;
    }
  }

  // ---- my balance callout ---------------------------------------------------
  function myBalance() {
    if (!game?.settlement || !myId()) return null;
    const s = game.settlement;
    const pid = game.players.find((p: any) => p.id === myId())?.id;
    if (!pid) return null;
    const line = s.lines?.find((l: any) => l.playerId === pid);
    if (!line) return null;
    const iOwe = s.transfers.filter((t: any) => t.from === pid);
    const owedToMe = s.transfers.filter((t: any) => t.to === pid);
    return { net: line.net, iOwe, owedToMe };
  }

  // ---- actions --------------------------------------------------------------
  async function addPlayer() {
    const name = newPlayerName.trim();
    if (!name && !pickedUserId) return;
    const body: any = {};
    if (name) body.name = name;
    if (pickedUserId) body.userId = pickedUserId; // auto-link this seat to a connection's account
    try {
      game = await api('POST', `/api/games/${gameId}/players`, body);
    } catch (e: any) { toast(e.message); return; }
    newPlayerName = ''; pickedUserId = null;
    suggestions = []; showSuggest = false; suggestActive = -1;
  }

  // Suggest people from your followers/following as you type (signed-in hosts only).
  function onPlayerInput() {
    pickedUserId = null; // typing invalidates any prior pick
    if (!myAccount) { showSuggest = false; return; }
    const q = newPlayerName.trim();
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/me/connections?q=${encodeURIComponent(q)}`);
        if (!res.ok) { suggestions = []; showSuggest = false; return; }
        const { connections } = await res.json();
        suggestions = connections.filter((c: any) => !seatedUserIds.has(c.id)).slice(0, 6);
        showSuggest = suggestions.length > 0;
        suggestActive = -1;
      } catch { suggestions = []; showSuggest = false; }
    }, 150);
  }

  function pickSuggestion(c: any) {
    newPlayerName = c.displayName;
    pickedUserId = c.id;
    showSuggest = false; suggestions = []; suggestActive = -1;
  }

  function onPlayerKey(e: KeyboardEvent) {
    if (showSuggest && suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); suggestActive = (suggestActive + 1) % suggestions.length; return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); suggestActive = (suggestActive - 1 + suggestions.length) % suggestions.length; return; }
      if (e.key === 'Enter' && suggestActive >= 0) { e.preventDefault(); pickSuggestion(suggestions[suggestActive]); return; }
      if (e.key === 'Escape') { showSuggest = false; return; }
    }
    if (e.key === 'Enter') addPlayer();
  }

  // ---- claim / leave a seat -------------------------------------------------
  async function claimSeat(playerId: string) {
    try {
      game = await api('POST', `/api/games/${gameId}/claim`, { playerId });
      claimOpen = false;
      toast('Seat claimed — it’s linked to your account');
    } catch (e: any) { toast(e.message); }
  }

  async function leaveSeat() {
    if (!(await askConfirm('Unlink this seat from your account? The seat and its buy-ins stay in the game.', 'Leave seat', true))) return;
    try {
      game = await api('DELETE', `/api/games/${gameId}/claim`);
      toast('Left the seat');
    } catch (e: any) { toast(e.message); }
  }

  function signInToClaim() {
    goto(`/account?next=${encodeURIComponent(`/game?g=${gameId}&claim=1`)}`);
  }

  // Parse a typed amount, accepting a comma decimal separator. Many phone
  // keypads only offer ',' (not '.'), and a type="number" field silently drops
  // it — so amount inputs are type="text" and normalised here instead.
  // Also strips spaces and grouping separators ("1.234,56", "1 000", "1,000")
  // so a thousands-separated number isn't mangled into NaN or a wrong value.
  const decAmt = (v: any): number =>
    Number(String(v ?? '').trim().replace(/\s/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));

  // The table's standard buy-in, used for the one-tap quick button (and the bulk
  // tool). Defaults from localStorage; kept in `bulkAmount`.
  const quickAmt = $derived(decAmt(bulkAmount) > 0 ? decAmt(bulkAmount) : 20);

  // One tap = book the standard buy-in (or top-up if they're already in) — no
  // modal. This is the most common action of the night, so it shouldn't cost a
  // full-screen context switch.
  async function quickBuyIn(pid: string, name: string) {
    if (browser) localStorage.setItem('pc_default_buyin', String(quickAmt));
    const hasPrior = game.transactions.some((t: any) => t.playerId === pid);
    try {
      game = await api('POST', `/api/games/${gameId}/transactions`, { playerId: pid, amount: quickAmt, type: hasPrior ? 'topup' : 'buyin' });
      haptic(12);
      toast(`${name} ${hasPrior ? 'topped up' : 'bought in'} ${money(quickAmt, unit)}`);
    } catch (e: any) { toast(e.message); }
  }

  function openMoneyModal(pid: string, name: string) {
    modalTarget = pid;
    modalName = name;
    const hasPrior = game.transactions.some((t: any) => t.playerId === pid);
    modalType = hasPrior ? 'topup' : 'buyin';
    modalAmount = ''; // start empty so "tap chips to stack" is honest (no pre-filled value to add onto)
    editTxId = null;
    modalOpen = true;
  }

  async function addMoney() {
    const amount = decAmt(modalAmount);
    if (!(amount > 0)) { toast('Enter an amount'); return; }
    try {
      if (editTxId) {
        game = await api('PATCH', `/api/games/${gameId}/transactions/${editTxId}`, { amount });
      } else {
        game = await api('POST', `/api/games/${gameId}/transactions`, { playerId: modalTarget, amount, type: modalType });
      }
      haptic(14);
      closeMoneyModal();
    } catch (e: any) { toast(e.message); }
  }

  function closeMoneyModal() { modalOpen = false; editTxId = null; }

  function toggleExpand(pid: string) {
    expanded.has(pid) ? expanded.delete(pid) : expanded.add(pid);
    expanded = new Set(expanded);
  }

  // Remove a single buy-in/top-up entered by mistake (server keeps an audit log).
  async function delTx(t: any) {
    try {
      game = await api('DELETE', `/api/games/${gameId}/transactions/${t.id}`);
      haptic(9);
      toast(`Removed ${t.type === 'topup' ? 'top-up' : 'buy-in'} of ${money(t.amount, unit)} · kept in activity log`);
    } catch (e: any) { toast(e.message); }
  }

  // Correct the amount of an existing entry (prefilled in the money modal).
  let editTxId = $state<string | null>(null);
  function editTx(t: any) {
    editTxId = t.id;
    modalTarget = t.playerId;
    modalName = game.players.find((p: any) => p.id === t.playerId)?.name || '';
    modalType = t.type === 'topup' ? 'topup' : 'buyin';
    modalAmount = String(t.amount);
    modalOpen = true;
  }

  function addChip(val: number | 'clear') {
    if (val === 'clear') { modalAmount = ''; return; }
    modalAmount = String(Math.round(((decAmt(modalAmount) || 0) + val) * 100) / 100);
    haptic(9);
  }

  async function setFinal(pid: string, val: string) {
    const amount = String(val).trim() === '' ? null : decAmt(val);
    game = await api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount });
  }

  // Type a profit/loss and we back-compute the stack: left = profit + what they bought in.
  async function setFinalFromProfit(pid: string, val: string) {
    if (val.trim() === '') return setFinal(pid, '');
    const profit = decAmt(val);
    if (Number.isNaN(profit)) return;
    const total = Math.round((profit + invested(pid)) * 100) / 100;
    return setFinal(pid, String(total));
  }

  async function setOut(pid: string) {
    game = await api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount: 0 });
    haptic(9);
  }

  async function markRestOut() {
    if (!(await askConfirm('Mark all remaining players as out (0)?', 'Mark out'))) return;
    const updates = game.players.filter((p: any) => game.finalStacks[p.id] == null).map((p: any) => ({ playerId: p.id, amount: 0 }));
    if (!updates.length) return;
    try { game = await api('PUT', `/api/games/${gameId}/final`, { updates }); haptic(12); }
    catch (e: any) { toast(e.message); }
  }

  // ---- "even out a miscount" -------------------------------------------------
  // When the books don't balance and nobody knows who miscounted, true them up.
  // Rule (decided for fairness): the surplus/shortfall is taken off the SIDE that
  // created it. Overcount (too many chips) → shave winners' winnings; undercount
  // (missing chips) → reduce losers' losses. Split proportionally within that
  // side, in exact integer cents. A zero-sum night can't have winners up more
  // than losers are down, and a loser/break-even player shouldn't pay for a
  // surplus they didn't create. Never flips a winner to a loser or vice-versa.
  let reconcileOpen = $state(false);

  // Distribute a signed cent `total` across `weights` proportionally, integer
  // cents, largest-remainder so the parts sum exactly to `total`.
  function splitCents(total: number, weights: number[]): number[] {
    const wsum = weights.reduce((a, b) => a + b, 0);
    if (wsum === 0) return weights.map(() => 0);
    const raw = weights.map((w) => (total * w) / wsum);
    const out = raw.map((x) => Math.trunc(x));
    let rem = total - out.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => ({ i, f: Math.abs(x - Math.trunc(x)) })).sort((a, b) => b.f - a.f);
    const step = total >= 0 ? 1 : -1;
    let k = 0;
    while (rem !== 0 && order.length) { out[order[k % order.length].i] += step; rem -= step; k++; }
    return out;
  }

  // Build the per-player proposal (all maths in cents). Returns null if balanced.
  function reconcileProposal() {
    if (!game) return null;
    const rows = game.players.map((p: any) => {
      const inv = Math.round(invested(p.id) * 100);
      const fin = Math.round((game.finalStacks[p.id] ?? 0) * 100);
      return { id: p.id, name: p.name, invC: inv, countedC: fin, netC: fin - inv, deltaC: 0, adjFinalC: fin, adjNetC: fin - inv };
    });
    const D = rows.reduce((s: number, r: any) => s + r.netC, 0); // >0 overcount, <0 undercount
    if (D === 0) return null;
    const side = D > 0 ? rows.filter((r: any) => r.netC > 0) : rows.filter((r: any) => r.netC < 0);
    const deltas = splitCents(-D, side.map((r: any) => Math.abs(r.netC)));
    side.forEach((r: any, i: number) => { r.deltaC = deltas[i]; r.adjNetC = r.netC + deltas[i]; r.adjFinalC = r.invC + r.adjNetC; });
    return { rows, D };
  }

  async function applyReconcile() {
    const prop = reconcileProposal();
    if (!prop) return;
    const updates = prop.rows.filter((r: any) => r.deltaC !== 0).map((r: any) => ({ playerId: r.id, amount: r.adjFinalC / 100 }));
    if (!updates.length) { reconcileOpen = false; return; }
    try {
      game = await api('PUT', `/api/games/${gameId}/final`, { updates });
      haptic([12, 30, 12]);
      reconcileOpen = false;
      toast('Books evened out');
    } catch (e: any) { toast(e.message); }
  }

  async function bulkBuyIn() {
    const amt = decAmt(bulkAmount);
    if (!(amt > 0)) { toast('Enter an amount'); return; }
    if (browser) localStorage.setItem('pc_default_buyin', String(amt));
    const targets = game.players.filter((p: any) => !game.transactions.some((t: any) => t.playerId === p.id));
    if (!targets.length) { toast('Everyone has bought in already'); return; }
    const entries = targets.map((p: any) => ({ playerId: p.id, amount: amt, type: 'buyin' }));
    try {
      game = await api('POST', `/api/games/${gameId}/transactions`, { entries });
      haptic([10, 30, 10]);
      toast(`Bought in ${targets.length} player${targets.length > 1 ? 's' : ''} for ${money(amt, unit)}`);
    } catch (e: any) { toast(e.message); }
  }

  async function closeGame() {
    if (!(await askConfirm('Lock in the final standings for everyone? Anyone can reopen it later.', 'Lock in'))) return;
    try {
      game = await api('POST', `/api/games/${gameId}/close`);
      showShareBanner = false;
    } catch (e: any) { toast(e.message); }
  }

  async function reopenGame() {
    if (!(await askConfirm('Reopen the game for everyone? This clears paid marks.', 'Reopen'))) return;
    try {
      game = await api('POST', `/api/games/${gameId}/reopen`);
    } catch (e: any) { toast(e.message); }
  }

  // Remove this game from *your* view only: unlink your account seat (so it drops
  // out of "My games") and forget it on this device. Anyone else who's linked
  // keeps the game and their access — the game itself is not destroyed.
  async function deleteGameForMe() {
    if (!(await askConfirm('Remove this game from your games? Anyone else linked to it keeps their access.', 'Delete', true))) return;
    if (myAccount && mySeat) {
      try { await api('DELETE', `/api/games/${gameId}/claim`); } catch (e: any) { toast(e.message); return; }
    }
    if (browser) {
      try {
        const list = JSON.parse(localStorage.getItem('pc_games') || '[]').filter((g: any) => g.id !== gameId);
        localStorage.setItem('pc_games', JSON.stringify(list));
      } catch {}
      localStorage.removeItem('pc_me_' + gameId);
      localStorage.removeItem('pc_host_' + gameId);
    }
    toast('Removed from your games');
    goto('/');
  }

  async function removePlayer(pid: string) {
    if (!(await askConfirm('Remove this player and their transactions?', 'Remove', true))) return;
    game = await api('DELETE', `/api/games/${gameId}/players/${pid}`);
  }

  async function markPaid(tid: string, paid: boolean) {
    if (!paid) haptic(14);
    game = await api('PUT', `/api/games/${gameId}/settlement/${tid}`, { paid });
  }

  async function joinAsPlayer() {
    const name = joinNameVal.trim();
    if (!name) { toast('Enter your name'); return; }
    setActorName(name);
    const res = await api('POST', `/api/games/${gameId}/join`, { name });
    game = res.game;
    if (browser) localStorage.setItem('pc_me_' + gameId, res.playerId);
    joinOpen = false;
  }

  async function copyAmount(amount: number) {
    try { await navigator.clipboard.writeText(String(amount)); toast('Amount copied'); } catch {}
  }

  // ---- settlement editor ----------------------------------------------------
  function settlementParties() {
    const s = game?.settlement;
    if (!s?.lines) return { debtors: [], creditors: [] };
    const debtors: any[] = [], creditors: any[] = [];
    for (const l of s.lines) {
      if (l.net < 0) debtors.push({ id: l.playerId, name: l.name, amount: -l.net });
      else if (l.net > 0) creditors.push({ id: l.playerId, name: l.name, amount: l.net });
    }
    return { debtors, creditors };
  }

  function startEditing() {
    editingSettlement = true;
    draft = (game.settlement?.transfers || []).map((t: any) => ({ from: t.from, to: t.to, amount: String(t.amount) }));
  }

  function addDraftLine() {
    const { debtors, creditors } = settlementParties();
    if (!debtors.length || !creditors.length) return;
    draft = [...draft, { from: debtors[0].id, to: creditors[0].id, amount: '' }];
  }

  function removeDraftLine(i: number) {
    draft = draft.filter((_: any, idx: number) => idx !== i);
  }

  function draftBalanced(): boolean {
    const { debtors, creditors } = settlementParties();
    const c = (x: any) => Math.round((decAmt(x) || 0) * 100);
    const out = new Map<string, number>(), inc = new Map<string, number>();
    for (const t of draft) {
      const amt = c(t.amount);
      if (amt > 0) {
        out.set(t.from, (out.get(t.from) || 0) + amt);
        inc.set(t.to, (inc.get(t.to) || 0) + amt);
      }
    }
    for (const d of debtors) {
      if ((out.get(d.id) || 0) !== c(d.amount)) return false;
    }
    for (const cr of creditors) {
      if ((inc.get(cr.id) || 0) !== c(cr.amount)) return false;
    }
    return true;
  }

  async function saveDraft() {
    try {
      const transfers = draft
        .map((t: any) => ({ from: t.from, to: t.to, amount: decAmt(t.amount) }))
        .filter((t: any) => t.amount > 0);
      game = await api('PUT', `/api/games/${gameId}/settlement`, { transfers });
      editingSettlement = false;
      draft = [];
      toast('Settlement updated');
    } catch (e: any) { toast(e.message); }
  }

  async function resetDraft() {
    const { computeSettlement } = await import('$lib/engine/settle.js');
    const auto = computeSettlement(game.players, game.transactions, game.finalStacks);
    draft = auto.transfers.map((t: any) => ({ from: t.from, to: t.to, amount: String(t.amount) }));
  }

  function shareLink() {
    const url = `${location.origin}/game?g=${gameId}`;
    if (navigator.share) { navigator.share({ title: 'potcount', text: `Join game #${gameId}`, url }).catch(() => {}); }
    else { navigator.clipboard.writeText(url).then(() => toast('Link copied')).catch(() => {}); }
  }

  async function updateGameName(e: Event) {
    const el = e.target as HTMLElement;
    const name = el.textContent?.trim();
    if (!name) { el.textContent = game.name; return; } // revert if cleared
    if (name !== game.name) {
      try {
        game = await api('PUT', `/api/games/${gameId}/meta`, { name });
      } catch (err: any) {
        el.textContent = game.name; // revert on failure
        toast(err.message);
      }
    }
  }

  // Inline-rename a seat (e.g. the auto-generated "Player 2" → a real name).
  async function renamePlayer(pid: string, e: Event) {
    const el = e.target as HTMLElement;
    const name = (el.textContent || '').trim();
    const p = game.players.find((x: any) => x.id === pid);
    if (!p) return;
    if (!name || name === p.name) { el.textContent = p.name; return; } // revert empty / no-op
    try {
      game = await api('PATCH', `/api/games/${gameId}/players/${pid}`, { name });
    } catch (err: any) {
      toast(err.message);
      el.textContent = p.name; // restore on failure (e.g. duplicate name)
    }
  }

  // Select the whole name on focus so a tap-to-edit replaces cleanly (mobile
  // contenteditable caret placement is otherwise fiddly).
  function selectAllText(e: Event) {
    const el = e.target as HTMLElement;
    const r = document.createRange(); r.selectNodeContents(el);
    const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
  }
  // The pencil button focuses its sibling editable name.
  function focusName(e: Event) {
    const span = (e.currentTarget as HTMLElement).parentElement?.querySelector('[contenteditable]') as HTMLElement | null;
    span?.focus();
  }

  function dismissIdentity() {
    identityDismissed = true;
    if (browser) localStorage.setItem('pc_idban_' + gameId, '1');
  }

  function dismissTrackTip() {
    showTrackTip = false;
    if (browser) localStorage.setItem('pc_tracktip_' + gameId, '1');
  }

  function promptName() {
    const n = window.prompt('Your name (shown next to your edits):', getActor().name || '');
    if (n?.trim()) { setActorName(n.trim()); }
  }
</script>

<svelte:head>
  <title>{game ? `potcount — ${game.name} #${game.id}` : 'potcount — game'}</title>
</svelte:head>

<div class="wrap">
  {#if loading}
    <p class="text-muted">Loading…</p>
  {:else if error}
    <div class="banner banner-warn">{error}</div>
    <p><a href="/">← Back home</a></p>
  {:else if game}

    <!-- Claim / leave your seat — link a seat to your account, or unlink one a
         host auto-connected to you. Shared by the active and summary views. -->
    {#snippet claimBanner()}
      {#if mySeat}
        <div class="text-xs text-muted mt-3 flex items-center gap-2 flex-wrap">
          <span>✓ Linked to your account as <b class="text-text">{mySeat.name}</b>.</span>
          <button class="underline hover:text-text" onclick={leaveSeat}>Not you? Leave</button>
        </div>
      {:else if myAccount && unclaimedSeats.length > 0}
        <div class="banner banner-info mt-3">
          {#if claimOpen}
            <div class="font-semibold mb-1.5">Which seat are you?</div>
            <div class="flex flex-wrap gap-1.5">
              {#each unclaimedSeats as p (p.id)}
                <button class="btn-small {suggestedClaim?.id === p.id ? 'btn' : 'btn-secondary'}" onclick={() => claimSeat(p.id)}>{p.name}{suggestedClaim?.id === p.id ? ' (you?)' : ''}</button>
              {/each}
            </div>
            <button class="btn-small btn-ghost mt-2" onclick={() => { claimOpen = false; if (game.status === 'active') { joinNameVal = getActor().name; joinOpen = true; } }}>I'm not listed</button>
          {:else if suggestedClaim}
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span>Are you <b>{suggestedClaim.name}</b>? Link this seat to your account.</span>
              <span class="flex gap-1.5">
                <button class="btn-small btn" onclick={() => claimSeat(suggestedClaim.id)}>Yes, that's me</button>
                <button class="btn-small btn-secondary" onclick={() => claimOpen = true}>Pick another</button>
              </span>
            </div>
          {:else}
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span>Played in this game? Claim your seat to track it on your profile.</span>
              <button class="btn-small btn" onclick={() => claimOpen = true}>Claim your seat</button>
            </div>
          {/if}
        </div>
      {:else if !myAccount}
        <div class="text-xs text-muted mt-3">
          Played in this game? <button class="underline hover:text-text" onclick={signInToClaim}>Sign in to claim your seat</button>.
        </div>
      {/if}
    {/snippet}

    <!-- Player name: a profile link (highlighted) if they linked an account,
         otherwise plain text. Shared by the live-standings and summary views. -->
    {#snippet playerName(line: any, cls = '')}
      {@const handle = playerHandle(line.playerId)}
      {#if handle}
        <a href="/u/{handle}" class="text-info font-semibold no-underline hover:underline {cls}" title="View {line.name}'s profile">{line.name}<span class="text-info/60 text-[0.7em] align-super ml-px">↗</span></a>
      {:else}
        <span class={cls}>{line.name}</span>
      {/if}
    {/snippet}

    <!-- Podium (top 3/2). `rows` must be pre-sorted by net, descending. -->
    {#snippet podiumBlock(rows: any[])}
      <div class="flex items-end justify-center gap-2.5 mb-5">
        {#each (rows.length >= 3 ? [rows[1], rows[0], rows[2]] : rows.slice(0, 2)) as l, i}
          {@const medal = rows.length >= 3 ? ['🥈', '🥇', '🥉'][i] : ['🥇', '🥈'][i]}
          {@const height = rows.length >= 3 ? [94, 124, 72][i] : [124, 94][i]}
          <div class="flex-1 max-w-[130px] flex flex-col items-center text-center">
            <div class="font-extrabold tabular-nums mb-1.5 {l.net >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{l.net >= 0 ? '+' : ''}{money(l.net, unit)}</div>
            <div class="w-full rounded-t-xl border border-border-soft border-b-0 flex flex-col items-center pt-3 gap-0.5 bg-surface-2" style="height:{height}px">
              <span class="text-[1.7rem]">{medal}</span>
            </div>
            <div class="mt-2 text-sm break-words">{@render playerName(l, 'font-semibold')}</div>
          </div>
        {/each}
      </div>
    {/snippet}

    {#if game.status === 'active'}
      <!-- ═══════════════════ ACTIVE GAME ═══════════════════ -->
     {#if activeView === 'standings'}
      <!-- ═══════════════════ LIVE STANDINGS / PER-PLAYER SUMMARY ═══════════════════ -->
      {@const ls = liveStandings}
      {@const myRank = myLiveLine ? ls.ranked.findIndex((l: any) => l.playerId === myLiveLine.playerId) : -1}
      <div class="flex items-center justify-between gap-2.5">
        <button class="btn-small btn-ghost" onclick={() => activeView = 'play'}>← Back to game</button>
        <span class="inline-flex items-center gap-1.5 text-xs font-bold text-accent uppercase tracking-widest"><span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>Live</span>
      </div>

      <div class="mt-3">
        <h1 class="text-2xl font-bold">{game.name}</h1>
        <div class="text-muted text-sm">Game <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{game.id}</span> · {ls.ranked.length}/{game.players.length} cashed out · {money(totalIn, unit)} in play</div>
      </div>

      <!-- Provisional notice — the game's still live, so the result can still change -->
      {#if !allEntered}
        <div class="banner banner-info mt-4 text-sm">
          ⏳ <b>Game still in progress.</b> These standings update live and podium places can still change — {ls.pending.length} player{ls.pending.length === 1 ? '' : 's'} still to cash out.
        </div>
      {/if}

      <!-- Your live result -->
      {#if myLiveLine}
        {@const mine = myLiveLine}
        {#if game.finalStacks[mine.playerId] != null}
          <div class="card mt-4 {mine.net > 0 ? '!border-win/50 !bg-win/[.08]' : mine.net < 0 ? '!border-danger/50 !bg-danger/[.08]' : ''}">
            <div class="text-xs uppercase tracking-widest font-bold text-muted">Your result so far</div>
            <div class="text-3xl font-extrabold mt-1 {mine.net >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">
              {mine.net > 0 ? 'Up ' : mine.net < 0 ? 'Down ' : 'Even '}{money(Math.abs(mine.net), unit)}
            </div>
            <div class="text-muted text-sm mt-1">
              In {money(mine.invested, unit)} · out {money(game.finalStacks[mine.playerId], unit)}{myRank >= 0 ? ` · ${ordinal(myRank + 1)} of ${ls.ranked.length}` : ''}
            </div>
          </div>
        {:else}
          <div class="card mt-4">
            <div class="text-xs uppercase tracking-widest font-bold text-muted">Your result</div>
            <p class="text-muted text-sm mt-1 mb-2.5">You haven't cashed out yet — enter how much you have left to see if you're up or down.</p>
            <button class="btn w-full" onclick={() => { activeView = 'play'; setTimeout(() => document.getElementById('cashout')?.scrollIntoView({ behavior: 'smooth' }), 60); }}>Cash out now</button>
          </div>
        {/if}
      {/if}

      <!-- Live podium -->
      {#if ls.ranked.length >= 2}
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3">Podium</h2>
        {@render podiumBlock(ls.ranked)}
      {:else}
        <div class="card mt-4 text-muted text-sm text-center">The podium fills in as players cash out — {ls.ranked.length} of {game.players.length} done so far.</div>
      {/if}

      <!-- Live standings -->
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-4 mb-3">Standings</h2>
      <div class="card">
        {#each ls.ranked as l, idx}
          <div class="flex items-center justify-between mb-1.5 {l.playerId === myId() ? 'font-bold' : ''}">
            <span>{idx + 1}. {@render playerName(l)} <span class="text-muted text-sm">in {money(l.invested, unit)}</span></span>
            <span class="font-bold tabular-nums {l.net >= 0 ? 'text-win' : 'text-danger'}">{l.net >= 0 ? '+' : ''}{money(l.net, unit)}</span>
          </div>
        {/each}
        {#each ls.pending as l}
          <div class="flex items-center justify-between mb-1.5 opacity-60 {l.playerId === myId() ? 'font-bold' : ''}">
            <span>{@render playerName(l)} <span class="text-muted text-sm">in {money(l.invested, unit)}</span></span>
            <span class="text-muted text-sm">still in</span>
          </div>
        {/each}
        {#if ls.ranked.length === 0 && ls.pending.length === 0}
          <p class="text-muted text-sm">No players yet.</p>
        {/if}
      </div>

      <!-- Live who-pays-who — the full financial standings, visible to everyone
           without anyone needing to formally "end" the game. -->
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-4 mb-3">Who pays who</h2>
      {#if !allEntered}
        <p class="text-muted text-sm">Settles up once everyone's cashed out — {ls.pending.length} still in.</p>
      {:else if settlement && settlement.transfers.length > 0}
        <div class="card">
          {#each settlement.transfers as t}
            <div class="transfer-row">
              <span class="font-semibold truncate min-w-0">{t.fromName}</span>
              <span class="text-accent font-extrabold shrink-0">→</span>
              <span class="font-semibold truncate min-w-0">{t.toName}</span>
              <span class="ml-auto font-bold tabular-nums">{money(t.amount, unit)}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted text-sm">No payments needed — everyone's even.</p>
      {/if}

      <!-- Reconciliation: the books don't have to balance, but flag any gap so people can fix it. -->
      {#if settlement && settlement.totalFinal > 0 && !settlement.balanced}
        <div class="banner banner-warn mt-3 text-sm">
          <div>Off by {money(Math.abs(settlement.discrepancy), unit)} — counted {money(settlement.totalFinal, unit)} of {money(settlement.totalInvested, unit)} bought in. Recount if you can.</div>
          {#if allEntered}
            <button class="btn-small btn w-full mt-2.5" onclick={() => reconcileOpen = true}>Can't find it? Even out the {money(Math.abs(settlement.discrepancy), unit)} →</button>
          {/if}
        </div>
      {/if}

      <!-- Optional: lock the summary in so the group can tick off who's paid. Anyone can do
           this (host isn't special); it switches everyone to the final summary. Not required —
           the standings above are already live for everyone. -->
      <div class="border-t border-border-soft mt-6 pt-4">
        <button class="btn-small btn-ghost w-full" onclick={closeGame}>Lock in & track who's paid</button>
        <p class="text-muted text-xs text-center mt-2">Optional — saves these final standings so everyone can tick off payments. Switches the whole game to the final summary (any player can reopen it).</p>
      </div>

     {:else}

      <!-- Header -->
      <div class="flex items-center justify-between gap-2.5">
        <div>
          <h1 class="text-2xl font-bold cursor-text border-b border-dashed border-transparent hover:border-border focus:border-accent focus:outline-none" contenteditable="true" title="Tap to rename" onfocus={selectAllText} onblur={updateGameName}>{game.name}</h1>
          <div class="text-muted text-sm">Game <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{game.id}</span> · {game.players.length} players · {money(totalIn, unit)} in play</div>
        </div>
        <button class="btn-small btn-ghost" onclick={shareLink}>Share</button>
      </div>

      <!-- Share banner -->
      {#if showShareBanner}
        <div class="banner banner-ok flex items-center justify-between mt-2.5">
          <span>Game open! Share code <b class="text-accent font-bold">#{game.id}</b> so players can join.</span>
          <div class="flex gap-1.5">
            <button class="btn-small btn-ghost" onclick={shareLink}>Copy link</button>
            <button class="btn-small btn-ghost" onclick={() => showShareBanner = false}>✕</button>
          </div>
        </div>
      {/if}

      <!-- Host-only: how to keep score. Recommends everyone-tracks-their-own. Dismissible. -->
      {#if showTrackTip}
        <div class="card mt-2.5 !border-accent/30 relative">
          <button class="absolute top-1.5 right-1.5 p-2 text-muted hover:text-text min-w-[40px] min-h-[40px] flex items-center justify-center" title="Dismiss" aria-label="Dismiss" onclick={dismissTrackTip}>✕</button>
          <div class="text-sm font-bold pr-8">How do you want to keep score?</div>
          <p class="text-muted text-sm mt-1.5">
            <b class="text-accent">Easiest, with the fewest mistakes:</b> have everyone open this game on their <b>own phone</b> and enter their own buy-ins, top-ups and cash-out. It stays consistent and nobody has to track someone else's chips.
          </p>
          <p class="text-muted text-sm mt-1.5">
            Prefer one scorekeeper? That works too — just pick <b>one person</b> to enter everything on this device.
          </p>
          <div class="flex gap-1.5 mt-3 flex-wrap">
            <button class="btn-small btn" onclick={shareLink}>Share the game link</button>
            <button class="btn-small btn-ghost" onclick={dismissTrackTip}>Got it</button>
          </div>
        </div>
      {/if}

      {@render claimBanner()}

      <!-- Identity: a thin line, not a full banner (only once you're seated/editing) -->
      {#if !identityDismissed}
        <div class="text-xs text-muted mt-2.5 flex items-center gap-2 flex-wrap">
          <span>Editing as <b class="text-text">{getActor().name || 'unknown'}</b> · changes are logged under this name.</span>
          <button class="underline hover:text-text py-2 -my-2" onclick={promptName}>Change</button>
          <button class="hover:text-text p-2 -m-2 min-w-[44px] min-h-[44px] flex items-center justify-center" title="Dismiss" onclick={dismissIdentity}>✕</button>
        </div>
      {/if}

      <!-- Players heading + take-a-seat / cash-out jump -->
      <div class="flex items-center justify-between mt-6 mb-3 gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Players</h2>
        <div class="flex gap-1.5">
          {#if !iAmSeated() && !mySeat}
            <button class="btn-small btn" onclick={() => { joinNameVal = getActor().name; joinOpen = true; }}>+ Take a seat</button>
          {/if}
          {#if totalIn > 0}
            <button class="btn-small btn-ghost" onclick={() => { activeView = 'standings'; window.scrollTo({ top: 0 }); }}>🏆 Standings</button>
            <button class="btn-small btn-ghost" onclick={() => document.getElementById('cashout')?.scrollIntoView({ behavior: 'smooth' })}>↓ Cash out</button>
          {/if}
        </div>
      </div>

      <!-- Player rows -->
      {#each game.players as p (p.id)}
        {@const inv = invested(p.id)}
        {@const final_ = game.finalStacks[p.id]}
        {@const net = (final_ ?? 0) - inv}
        {@const isExpanded = expanded.has(p.id)}
        <div class="player-row">
          <div>
            <div class="font-semibold">
              <span class="cursor-text rounded px-1 -mx-1 border-b border-dashed border-transparent hover:border-border hover:bg-surface-2 focus:bg-surface-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40" contenteditable="true" spellcheck="false"
                    title="Tap to rename"
                    onfocus={selectAllText}
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                    onblur={(e) => renamePlayer(p.id, e)}>{p.name}</span>
              <button class="text-muted hover:text-text text-xs align-middle ml-0.5 min-w-[44px] min-h-[44px] -my-2" title="Rename" onclick={focusName}>✎</button>
              {#if p.handle}<a href="/u/{p.handle}" class="text-info text-xs no-underline hover:underline ml-1" title="Linked to @{p.handle}">@{p.handle}</a>{/if}
              {#if p.id === myId()}<span class="pill pill-info ml-1">you</span>{/if}
              {#if final_ != null}<span class="pill ml-1 {net >= 0 ? 'pill-win' : 'pill-lose'}">{net >= 0 ? '+' : ''}{money(net, unit)}</span>{/if}
            </div>
            <button class="text-muted text-xs mt-0.5 hover:text-text {inv > 0 ? 'cursor-pointer underline decoration-dotted decoration-border underline-offset-2' : ''}"
                    onclick={() => { if (inv > 0) toggleExpand(p.id); }} title={inv > 0 ? 'Edit or remove buy-ins' : ''}>
              in {money(inv, unit)}{final_ != null ? ` · out ${money(final_, unit)}` : ''}
            </button>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <button class="btn-small btn" onclick={() => quickBuyIn(p.id, p.name)} title="Quick {invested(p.id) > 0 ? 'top-up' : 'buy-in'} of {money(quickAmt, unit)}">+{money(quickAmt, unit)}</button>
            <button class="btn-small btn-secondary !px-2.5" onclick={() => openMoneyModal(p.id, p.name)} title="Custom amount">+{unit}</button>
            <button class="btn-small btn-ghost !px-2.5 min-w-[44px]" title={inv > 0 ? 'View & edit buy-ins' : 'No buy-ins yet'} onclick={() => { expanded.has(p.id) ? expanded.delete(p.id) : expanded.add(p.id); expanded = new Set(expanded); }}>
              {#if inv > 0}<span class="text-xs tabular-nums">{game.transactions.filter((t: any) => t.playerId === p.id).length}</span>{/if}
              {isExpanded ? '▴' : '▾'}
            </button>
          </div>
        </div>
        {#if isExpanded}
          <div class="card !bg-surface-2 -mt-1 mb-2.5">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">{p.name}'s buy-ins</h3>
            {#each game.transactions.filter((t: any) => t.playerId === p.id) as t (t.id)}
              <div class="flex items-center justify-between gap-2 text-sm mb-2 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-3">
                <span class="text-muted">{t.type === 'topup' ? 'Top-up' : 'Buy-in'} · {shortDate(t.at)}</span>
                <div class="flex items-center gap-2 shrink-0">
                  <button class="font-semibold tabular-nums text-accent hover:text-accent-2 underline decoration-dotted underline-offset-2" title="Tap to change amount" onclick={() => editTx(t)}>{money(t.amount, unit)} ✎</button>
                  <button class="btn-small btn-ghost !px-3 text-danger" title="Remove this entry" onclick={() => delTx(t)}>✕</button>
                </div>
              </div>
            {:else}
              <p class="text-muted text-sm">No buy-ins yet — use the +{money(quickAmt, unit)} button.</p>
            {/each}
            <div class="border-t border-border-soft mt-3 pt-3 flex items-center justify-between">
              <span class="text-xs text-muted font-semibold">Total: {money(inv, unit)}</span>
              <button class="btn-small btn-danger" onclick={() => removePlayer(p.id)}>Remove player</button>
            </div>
          </div>
        {/if}
      {:else}
        <p class="text-muted">No players yet.</p>
      {/each}

      <!-- Add player (with follower/following autocomplete for signed-in hosts) -->
      <div class="flex gap-2 mt-2 relative">
        <div class="flex-1 relative">
          <input class="input w-full" placeholder={myAccount ? 'Add player — type to find friends' : 'Add player name'}
                 bind:value={newPlayerName} autocomplete="off"
                 oninput={onPlayerInput} onkeydown={onPlayerKey}
                 onfocus={() => { if (myAccount && newPlayerName.trim() === '' ) onPlayerInput(); }}
                 onblur={() => setTimeout(() => showSuggest = false, 150)} />
          {#if pickedUserId}
            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-info text-xs font-semibold" title="Will be linked to their account">↗ linked</span>
          {/if}
          {#if showSuggest && suggestions.length}
            <div class="absolute left-0 right-0 top-full mt-1 z-30 card !p-1 max-h-64 overflow-auto shadow-xl">
              {#each suggestions as c, i (c.id)}
                <button type="button"
                        class="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg {i === suggestActive ? 'bg-surface-2' : 'hover:bg-surface-2'} transition-colors"
                        onmousedown={(e) => { e.preventDefault(); pickSuggestion(c); }}>
                  <span class="w-7 h-7 shrink-0 rounded-full bg-accent/15 text-accent grid place-items-center text-sm font-bold">{(c.displayName || '?').charAt(0).toUpperCase()}</span>
                  <span class="min-w-0">
                    <span class="block font-semibold truncate">{c.displayName}</span>
                    <span class="block text-muted text-xs truncate">@{c.handle}</span>
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <button class="btn" onclick={addPlayer}>Add</button>
      </div>

      <!-- Bulk buy-in -->
      {#if game.players.length > 0}
        <div class="card !bg-surface-2 mt-2.5">
          <div class="flex items-center justify-between gap-2.5 flex-wrap">
            <span class="text-muted text-sm">Buy everyone in for the same amount</span>
            <div class="flex items-center gap-2">
              <span class="text-muted">{unit}</span>
              <input class="input !w-20 !py-2 !px-3" type="text" inputmode="decimal" bind:value={bulkAmount} />
              <button class="btn-small btn-secondary" onclick={bulkBuyIn}>Buy in all</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Cash-out section -->
      {@const entered = game.players.filter((p: any) => game.finalStacks[p.id] != null).length}
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3" id="cashout">Cash-out & settle</h2>
      <p class="text-muted text-xs mb-2">Enter how much each player has left at the end — or type their profit/loss and we'll work out the stack. Press <b>Enter</b> to jump to the next player.</p>
      <div class="card">
        <!-- live reconciliation, kept right by the inputs so it's visible while typing -->
        <div class="flex items-center justify-between text-xs mb-3 pb-2 border-b border-border-soft">
          <span class="text-muted">{entered}/{game.players.length} entered</span>
          <span class="tabular-nums {allEntered && settlement && !settlement.balanced ? 'text-danger font-semibold' : 'text-muted'}">
            {money(settlement?.totalFinal ?? 0, unit)} counted of {money(totalIn, unit)}
          </span>
        </div>
        {#each game.players as p, i (p.id)}
          {@const fs = game.finalStacks[p.id]}
          {@const isOut = fs === 0}
          {@const pl = fs != null ? Math.round((fs - invested(p.id)) * 100) / 100 : null}
          <div class="flex items-center justify-between mb-2 gap-2">
            <span class="font-medium truncate">{p.name}</span>
            <div class="flex items-center gap-1.5 shrink-0">
              <button class="btn-small btn-ghost {isOut ? '!bg-accent !text-accent-ink !border-transparent' : ''}" onclick={() => setOut(p.id)} title="Busted — nothing left">Out</button>
              <input class="input !w-[92px] !py-2 !px-2.5" type="text" inputmode="decimal" placeholder="left ({unit})"
                enterkeyhint={i < game.players.length - 1 ? 'next' : 'done'} data-cashidx={i}
                value={fs ?? ''}
                onchange={(e) => setFinal(p.id, (e.target as HTMLInputElement).value)}
                onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const el = e.target as HTMLInputElement; setFinal(p.id, el.value); const next = document.querySelector(`[data-cashidx="${i + 1}"]`) as HTMLInputElement | null; if (next) next.focus(); else el.blur(); } }} />
              <input class="input !w-[86px] !py-2 !px-2.5 tabular-nums {pl != null && pl > 0 ? '!text-win' : ''} {pl != null && pl < 0 ? '!text-danger' : ''}" type="text" inputmode="decimal" placeholder="P/L"
                title="Profit / loss — type a number here to set the stack from it"
                value={pl ?? ''}
                onchange={(e) => setFinalFromProfit(p.id, (e.target as HTMLInputElement).value)} />
            </div>
          </div>
        {:else}
          <p class="text-muted">Add players first.</p>
        {/each}
        {#if game.players.some((p: any) => game.finalStacks[p.id] == null) && game.players.some((p: any) => game.finalStacks[p.id] != null)}
          <button class="btn-small btn-ghost w-full mt-1" onclick={markRestOut}>Mark everyone left as out (0)</button>
        {/if}
      </div>

      <!-- Balance banner -->
      {#if settlement && settlement.totalFinal > 0}
        {#if settlement.balanced}
          <div class="banner banner-ok">Books balance. Total in = total out = {money(settlement.totalInvested, unit)}.</div>
        {:else}
          {@const diff = settlement.discrepancy}
          <div class="banner banner-warn">
            <div>Off by {money(Math.abs(diff), unit)} — counted {money(settlement.totalFinal, unit)} but {money(settlement.totalInvested, unit)} was bought in.
            {diff > 0 ? 'Too many chips counted' : 'Missing chips'} — recount if you can.</div>
            {#if allEntered}
              <button class="btn-small btn w-full mt-2.5" onclick={() => reconcileOpen = true}>Can't find it? Even out the {money(Math.abs(diff), unit)} →</button>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- Who pays who (preview) -->
      {#if !allEntered}
        <p class="text-muted text-sm">Enter every player's cash-out to see who pays who.</p>
      {:else if settlement && settlement.transfers.length > 0}
        <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mt-4 mb-2">Who pays who</h3>
        {#each settlement.transfers.slice().sort((a: any, b: any) => b.amount - a.amount) as t}
          <div class="transfer-row">
            <span class="font-semibold">{t.fromName}</span>
            <span class="text-accent font-extrabold">→</span>
            <span class="font-semibold">{t.toName}</span>
            <span class="ml-auto font-bold tabular-nums">{money(t.amount, unit)}</span>
          </div>
        {/each}
      {:else if allEntered}
        <p class="text-muted text-sm">No payments needed — everyone's even.</p>
      {/if}

      <!-- See my summary — a personal, live view. Doesn't end the game for anyone else. -->
      <button class="btn btn-secondary w-full mt-2.5" onclick={() => { activeView = 'standings'; window.scrollTo({ top: 0 }); }}>🏆 See my summary</button>

      <!-- Activity log -->
      <div class="border-t border-border-soft mt-6 pt-4">
        <button class="btn-small btn-ghost" onclick={() => showActivity = !showActivity}>
          {showActivity ? 'Hide' : 'Show'} all activity ({(game.log || []).length})
        </button>
        {#if showActivity}
          <div class="mt-3 flex flex-col gap-2">
            {#each (game.log || []).slice().reverse() as e (e.id)}
              <div class="text-sm border-l-2 border-border-soft pl-2.5">
                {#if e.playerName}<b>{e.playerName}</b> {/if}{describe(e)}<br/>
                <span class="text-muted text-xs">by {e.actorName} · {shortDate(e.at)}</span>
              </div>
            {:else}
              <p class="text-muted text-sm">No activity yet.</p>
            {/each}
          </div>
        {/if}
      </div>

      <div class="mt-6 text-center">
        <button class="btn-small btn-ghost text-danger hover:!border-danger/45" onclick={deleteGameForMe}>Delete game</button>
      </div>
     {/if}

    {:else}
      <!-- ═══════════════════ SUMMARY (ended/settled) ═══════════════════ -->
      {@const s = game.settlement || { transfers: [], lines: [], balanced: true }}
      {@const standings = (s.lines || []).slice().sort((a: any, b: any) => ((b.net ?? 0)) - ((a.net ?? 0)))}
      {@const allSettled = game.status === 'settled'}
      {@const bal = myBalance()}

      <div>
        <h1 class="text-2xl font-bold">{game.name}</h1>
        <div class="text-muted text-sm">
          Game <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{game.id}</span> ·
          <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold {allSettled ? 'bg-win/15 text-win border border-win' : 'bg-warn/15 text-[#f3cd6b] border border-warn'}">
            {allSettled ? 'All settled' : 'Game ended'}
          </span>
        </div>
      </div>

      {@render claimBanner()}

      <!-- My balance callout -->
      {#if bal}
        <div class="card mt-4 {bal.net > 0 ? '!border-win/50 !bg-win/[.08]' : bal.net < 0 ? '!border-danger/50 !bg-danger/[.08]' : ''}">
          <div class="text-xs uppercase tracking-widest font-bold text-muted">Your result</div>
          <div class="text-3xl font-extrabold mt-1 mb-2 {bal.net >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">
            {bal.net >= 0 ? '+' : ''}{money(bal.net, unit)}
          </div>
          {#each bal.iOwe as t}
            <div class="flex justify-between text-sm {t.paid ? 'opacity-50 line-through' : ''}">
              <span>You → {t.toName}</span><span class="font-semibold tabular-nums">{money(t.amount, unit)}</span>
            </div>
          {/each}
          {#each bal.owedToMe as t}
            <div class="flex justify-between text-sm {t.paid ? 'opacity-50 line-through' : ''}">
              <span>{t.fromName} → You</span><span class="font-semibold tabular-nums">{money(t.amount, unit)}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Podium -->
      {#if standings.length >= 2}
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3">Podium</h2>
        {@render podiumBlock(standings)}
      {/if}

      <!-- Final standings -->
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-4 mb-3">Final standings</h2>
      <div class="card">
        {#each standings as l, idx}
          <div class="flex items-center justify-between mb-1.5">
            <span>{idx + 1}. {@render playerName(l)} <span class="text-muted text-sm">in {money(l.invested, unit)}</span></span>
            <span class="font-bold tabular-nums {l.net >= 0 ? 'text-win' : 'text-danger'}">{l.net >= 0 ? '+' : ''}{money(l.net, unit)}</span>
          </div>
        {/each}
      </div>

      <!-- Who pays who -->
      <div class="flex items-center justify-between mt-4 mb-3">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Who pays who</h2>
        {#if s.transfers.length > 0 && !editingSettlement && s.balanced !== false}
          <button class="btn-small btn-ghost" onclick={startEditing}>Adjust</button>
        {/if}
      </div>

      {#if editingSettlement}
        <!-- Settlement editor -->
        {@const parties = settlementParties()}
        <p class="text-muted text-xs mb-3">Re-route payments however you like. Each person must still pay or receive their exact total.</p>
        {#each draft as t, i}
          <div class="transfer-row gap-1.5 flex-wrap">
            <div class="flex items-center gap-1.5 flex-1 min-w-0">
              <select class="input !py-2 !px-2 flex-1 min-w-0" bind:value={t.from}>
                {#each parties.debtors as d}<option value={d.id}>{d.name}</option>{/each}
              </select>
              <span class="text-accent font-extrabold shrink-0">→</span>
              <select class="input !py-2 !px-2 flex-1 min-w-0" bind:value={t.to}>
                {#each parties.creditors as c}<option value={c.id}>{c.name}</option>{/each}
              </select>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <input class="input !w-20 !py-2 !px-2" type="text" inputmode="decimal" bind:value={t.amount} />
              <button class="btn-small btn-danger" onclick={() => removeDraftLine(i)}>✕</button>
            </div>
          </div>
        {:else}
          <p class="text-muted text-sm mb-2">No payments — add one below.</p>
        {/each}
        <div class="flex gap-2 mt-2 mb-3 flex-wrap">
          <button class="btn-small btn-secondary" onclick={addDraftLine}>+ Add payment</button>
          <button class="btn-small btn-ghost" onclick={resetDraft}>Reset to suggested</button>
        </div>
        {#if draftBalanced()}
          <div class="banner banner-ok text-sm">Balanced — everyone's totals add up.</div>
        {:else}
          <div class="banner banner-warn text-sm">Not balanced yet — adjust amounts so every total matches.</div>
        {/if}
        <div class="flex gap-2">
          <button class="btn flex-1" onclick={saveDraft} disabled={!draftBalanced()}>Save plan</button>
          <button class="btn-small btn-secondary" onclick={() => { editingSettlement = false; draft = []; }}>Cancel</button>
        </div>
      {:else if s.transfers.length === 0}
        <div class="banner banner-ok">Everyone broke even — nothing to settle.</div>
      {:else}
        <p class="text-muted text-xs mb-2">Tap an amount to copy it. Use <b>Adjust</b> to change who pays who.</p>
        {#each s.transfers.slice().sort((a: any, b: any) => b.amount - a.amount) as t (t.id)}
          <div class="transfer-row {t.paid ? 'opacity-50' : ''}">
            <span class="font-semibold truncate min-w-0 {t.paid ? 'line-through' : ''}">{t.fromName}</span>
            <span class="text-accent font-extrabold shrink-0">→</span>
            <span class="font-semibold truncate min-w-0 {t.paid ? 'line-through' : ''}">{t.toName}</span>
            <span class="ml-auto font-bold tabular-nums cursor-pointer shrink-0 {t.paid ? 'line-through' : ''}" onclick={() => copyAmount(t.amount)} title="Tap to copy">{money(t.amount, unit)}</span>
            <button class="btn-small shrink-0 {t.paid ? 'btn-secondary' : 'btn'}" onclick={() => markPaid(t.id, !t.paid)}>{t.paid ? '✓ paid' : 'Mark paid'}</button>
          </div>
        {/each}
        {@const smallUnpaid = s.transfers.filter((t: any) => t.amount <= forgiveMax && !t.paid)}
        {#if smallUnpaid.length > 0}
          <div class="flex items-center gap-2 mt-2">
            <button class="btn-small btn-ghost flex-1 text-muted" onclick={() => smallUnpaid.forEach((t: any) => markPaid(t.id, true))}>
              Forgive {smallUnpaid.length === 1 ? '1 transfer' : smallUnpaid.length + ' transfers'} ≤ {money(forgiveMax, unit)}
            </button>
            <div class="flex items-center gap-0.5 shrink-0">
              <button class="btn-small btn-secondary !px-2.5" onclick={() => { if (forgiveMax > 1) forgiveMax--; }}>−</button>
              <span class="text-sm font-bold tabular-nums w-8 text-center">{forgiveMax}</span>
              <button class="btn-small btn-secondary !px-2.5" onclick={() => forgiveMax++}>+</button>
            </div>
          </div>
        {:else if s.transfers.some((t: any) => !t.paid)}
          <div class="flex items-center justify-end gap-0.5 mt-2">
            <span class="text-xs text-faint mr-1">Forgive ≤</span>
            <button class="btn-small btn-secondary !px-2.5" onclick={() => { if (forgiveMax > 1) forgiveMax--; }}>−</button>
            <span class="text-sm font-bold tabular-nums w-8 text-center">{forgiveMax}</span>
            <button class="btn-small btn-secondary !px-2.5" onclick={() => forgiveMax++}>+</button>
          </div>
        {/if}
      {/if}

      <!-- Claim your seat / create an account — follow your home-game stats -->
      {#if mySeat}
        <div class="banner banner-ok mt-4 flex items-center justify-between gap-2 flex-wrap">
          <span>✓ This game is saved to your stats as <b>{mySeat.name}</b>.</span>
          <a class="btn-small btn-secondary no-underline" href="/account">View your stats →</a>
        </div>
      {:else if myAccount && unclaimedSeats.length > 0}
        <div class="card mt-4 !border-accent/40 text-center">
          <div class="text-base font-bold">Claim your seat</div>
          <p class="text-muted text-sm mt-1 mb-3">Link your seat to your account to track this game in your home-game stats.</p>
          <div class="flex flex-wrap gap-1.5 justify-center">
            {#each unclaimedSeats as p (p.id)}
              <button class="btn-small {suggestedClaim?.id === p.id ? 'btn' : 'btn-secondary'}" onclick={() => claimSeat(p.id)}>I'm {p.name}{suggestedClaim?.id === p.id ? ' (you?)' : ''}</button>
            {/each}
          </div>
        </div>
      {:else if !myAccount}
        <div class="card mt-4 !border-accent/40 text-center">
          <div class="text-2xl mb-1">📈</div>
          <div class="text-base font-bold">Follow your home-game stats</div>
          <p class="text-muted text-sm mt-1 mb-3">Create a free account to claim your seat and track your wins, losses and results across every game.</p>
          <button class="btn w-full" onclick={signInToClaim}>Claim your seat &amp; sign up</button>
        </div>
      {/if}

      <!-- Reopen + activity — anyone in the game can reopen to keep editing. -->
      <div class="border-t border-border-soft mt-4 pt-4 flex items-center justify-between">
        <button class="btn-small btn-ghost" onclick={reopenGame}>↩ Reopen to edit</button>
        <button class="btn-small btn-ghost" onclick={() => showActivity = !showActivity}>
          {showActivity ? 'Hide' : 'Show'} activity ({(game.log || []).length})
        </button>
      </div>
      {#if showActivity}
        <div class="mt-3 flex flex-col gap-2">
          {#each (game.log || []).slice().reverse() as e (e.id)}
            <div class="text-sm border-l-2 border-border-soft pl-2.5">
              {#if e.playerName}<b>{e.playerName}</b> {/if}{describe(e)}<br/>
              <span class="text-muted text-xs">by {e.actorName} · {shortDate(e.at)}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-6 text-center">
        <button class="btn-small btn-ghost text-danger hover:!border-danger/45" onclick={deleteGameForMe}>Delete game</button>
      </div>
    {/if}
  {/if}
</div>

<!-- Live sync status banner -->
{#if liveStatus}
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 banner banner-warn max-w-[90%] text-center">{liveStatus}</div>
{/if}

<!-- Join Modal -->
{#if joinOpen}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onclick={(e) => { if (e.target === e.currentTarget) joinOpen = false }}>
    <div class="card max-w-sm w-full rounded-t-2xl sm:rounded-[16px]" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-1">Join this game</h3>
      <p class="text-muted text-sm mb-3">Game #{gameId} — enter your name to take a seat.</p>
      <input class="input mb-3" bind:value={joinNameVal} placeholder="Your name" maxlength="40" onkeydown={(e) => { if (e.key === 'Enter') joinAsPlayer(); }} />
      <button class="btn w-full" onclick={joinAsPlayer}>Join as player</button>
      <button class="btn-small btn-ghost w-full mt-2" onclick={() => joinOpen = false}>Just watch</button>
    </div>
  </div>
{/if}

<!-- Money Modal -->
{#if modalOpen}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onclick={(e) => { if (e.target === e.currentTarget) closeMoneyModal(); }}>
    <div class="card max-w-sm w-full rounded-t-2xl sm:rounded-[16px]" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">{editTxId ? 'Edit' : (modalType === 'buyin' ? 'Buy in' : 'Top up')} — {modalName}</h3>
      {#if !editTxId}
        <div class="flex gap-2 mb-3">
          <button class="btn-small flex-1 {modalType === 'buyin' ? 'btn' : 'btn-secondary'}" onclick={() => modalType = 'buyin'}>Buy-in</button>
          <button class="btn-small flex-1 {modalType === 'topup' ? 'btn' : 'btn-secondary'}" onclick={() => modalType = 'topup'}>Top-up</button>
        </div>
      {/if}
      <label class="block text-xs text-muted font-medium mb-2">{editTxId ? 'New amount' : 'Amount — tap chips to stack'}</label>
      {#if !editTxId}
        <div class="flex flex-wrap gap-2 mb-3">
          {#each [5, 10, 25, 50, 100] as v}
            <button class="w-[52px] h-[52px] rounded-full font-extrabold text-[.95rem] text-white border-[3px] border-dashed border-white/60 grid place-items-center cursor-pointer active:scale-90 transition-transform"
              style="background: {v === 5 ? '#d64545' : v === 10 ? '#3a78d6' : v === 25 ? '#2f9e6e' : v === 50 ? '#e08a2b' : '#1c1c1c'}; {v === 100 ? 'color: var(--color-gold); border-color: rgba(244,196,81,.6);' : ''}"
              onclick={() => addChip(v)}>{v}</button>
          {/each}
          <button class="w-[52px] h-[52px] rounded-full font-extrabold text-[.95rem] text-muted bg-surface-3 border border-border grid place-items-center cursor-pointer active:scale-90 transition-transform"
            onclick={() => addChip('clear')}>C</button>
        </div>
      {/if}
      <input class="input mb-3" type="text" inputmode="decimal" bind:value={modalAmount}
        onkeydown={(e) => { if (e.key === 'Enter') addMoney(); }} />
      <div class="flex gap-2">
        <button class="btn-small btn-secondary flex-1" onclick={closeMoneyModal}>Cancel</button>
        <button class="btn flex-1" onclick={addMoney}>{editTxId ? 'Save' : 'Add'}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Themed confirm dialog -->
{#if confirmState}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
       onclick={(e) => { if (e.target === e.currentTarget) answerConfirm(false); }}>
    <div class="card max-w-xs w-full" onclick={(e) => e.stopPropagation()}>
      <p class="mb-4">{confirmState.message}</p>
      <div class="flex gap-2">
        <button class="btn-small btn-secondary flex-1" onclick={() => answerConfirm(false)}>Cancel</button>
        <button class="btn flex-1 {confirmState.danger ? '!bg-danger !text-white' : ''}" onclick={() => answerConfirm(true)}>{confirmState.label}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Even-out-the-miscount preview -->
{#if reconcileOpen}
  {@const prop = reconcileProposal()}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4"
       onclick={(e) => { if (e.target === e.currentTarget) reconcileOpen = false; }}>
    <div class="card max-w-md w-full max-h-[88vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
      {#if !prop}
        <p>The books already balance — nothing to even out.</p>
        <button class="btn w-full mt-3" onclick={() => reconcileOpen = false}>Close</button>
      {:else}
        {@const over = prop.D > 0}
        <h3 class="text-lg font-bold mb-1">Even out the {money(Math.abs(prop.D) / 100, unit)} {over ? 'overcount' : 'shortfall'}</h3>
        <p class="text-muted text-sm mb-3">
          {#if over}
            There's <b class="text-text">{money(prop.D / 100, unit)}</b> more in counted chips than money was bought in. A night can't pay out more than went in, so we shave the extra off the <b class="text-text">winners</b> — split in proportion to how much each won. Players who lost or broke even are left exactly as counted.
          {:else}
            There's <b class="text-text">{money(-prop.D / 100, unit)}</b> less in counted chips than money was bought in. We close the gap by easing the <b class="text-text">losers'</b> losses — split in proportion to how much each is down. The winners are left exactly as counted.
          {/if}
        </p>

        <div class="overflow-x-auto -mx-1 px-1">
          <table class="w-full text-[13px] tabular-nums">
            <thead>
              <tr class="text-muted text-[11px] uppercase tracking-wide">
                <th class="text-left font-semibold py-1.5 pr-2">Player</th>
                <th class="text-right font-semibold py-1.5 px-1.5">Counted</th>
                <th class="text-right font-semibold py-1.5 px-1.5">Evened</th>
                <th class="text-right font-semibold py-1.5 pl-1.5">Change</th>
              </tr>
            </thead>
            <tbody>
              {#each prop.rows as r (r.id)}
                <tr class="border-t border-border-soft {r.deltaC === 0 ? 'text-muted' : ''}">
                  <td class="text-left py-2 pr-2 truncate max-w-[110px]">{r.name}</td>
                  <td class="text-right px-1.5">{money(r.countedC / 100, unit)}</td>
                  <td class="text-right px-1.5 font-semibold {r.deltaC !== 0 ? 'text-text' : ''}">{money(r.adjFinalC / 100, unit)}</td>
                  <td class="text-right pl-1.5 {r.deltaC < 0 ? 'text-danger' : r.deltaC > 0 ? 'text-win' : 'text-faint'}">
                    {r.deltaC === 0 ? '—' : (r.deltaC > 0 ? '+' : '') + money(r.deltaC / 100, unit)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="banner banner-ok text-xs mt-3">After this the books balance exactly ({money(settlement?.totalInvested ?? 0, unit)} in = out) and you can settle.</div>
        <div class="flex gap-2 mt-3">
          <button class="btn-small btn-secondary flex-1" onclick={() => reconcileOpen = false}>Cancel</button>
          <button class="btn flex-1" onclick={applyReconcile}>Even it out</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
