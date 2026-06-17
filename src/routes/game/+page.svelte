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
  const invested = (pid: string) => (game?.transactions ?? []).filter((t: any) => t.playerId === pid).reduce((s: number, t: any) => s + t.amount, 0);
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
  const totalIn = $derived(game ? game.transactions.reduce((s: number, t: any) => s + t.amount, 0) : 0);

  // Live settlement computation for the active game view
  let settlement = $derived.by(() => {
    if (!game || game.status !== 'active') return null;
    try {
      return computeSettlement(game.players, game.transactions, game.finalStacks);
    } catch { return null; }
  });
  const allEntered = $derived(game ? game.players.length > 0 && game.players.every((p: any) => game.finalStacks[p.id] != null) : false);

  const amHost = $derived.by(() => {
    if (!game) return false;
    if (!game.hostId) return true;
    if (browser && localStorage.getItem('pc_host_' + gameId)) return true;
    if (game.hostId === getActor().id) return true;
    if (myAccount && (game.ownerId === myAccount.id || game.hostId === 'user:' + myAccount.id)) return true;
    return false;
  });

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

    // Auto-prompt to join — but a signed-in user with an unclaimed seat to grab
    // should claim it (via the banner) rather than create a duplicate.
    const canClaimInstead = myAccount && (mySeat || unclaimedSeats.length > 0);
    if (!iAmSeated() && game.status === 'active' && !canClaimInstead) {
      joinNameVal = getActor().name;
      joinOpen = true;
    }
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
    if (!confirm('Unlink this seat from your account? The seat and its buy-ins stay in the game.')) return;
    try {
      game = await api('DELETE', `/api/games/${gameId}/claim`);
      toast('Left the seat');
    } catch (e: any) { toast(e.message); }
  }

  function signInToClaim() {
    goto(`/account?next=${encodeURIComponent(`/game?g=${gameId}&claim=1`)}`);
  }

  function openMoneyModal(pid: string, name: string) {
    modalTarget = pid;
    modalName = name;
    const hasPrior = game.transactions.some((t: any) => t.playerId === pid);
    modalType = hasPrior ? 'topup' : 'buyin';
    modalAmount = (browser && localStorage.getItem('pc_default_buyin')) || '20';
    modalOpen = true;
  }

  async function addMoney() {
    const amount = Number(modalAmount);
    if (!(amount > 0)) { toast('Enter an amount'); return; }
    try {
      game = await api('POST', `/api/games/${gameId}/transactions`, { playerId: modalTarget, amount, type: modalType });
      haptic(14);
      modalOpen = false;
    } catch (e: any) { toast(e.message); }
  }

  function addChip(val: number | 'clear') {
    if (val === 'clear') { modalAmount = ''; return; }
    modalAmount = String(Math.round(((Number(modalAmount) || 0) + val) * 100) / 100);
    haptic(9);
  }

  async function setFinal(pid: string, val: string) {
    const amount = val === '' ? null : Number(val);
    game = await api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount });
  }

  async function setOut(pid: string) {
    game = await api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount: 0 });
    haptic(9);
  }

  async function markRestOut() {
    if (!confirm('Mark all remaining players as out (0)?')) return;
    for (const p of game.players) {
      if (game.finalStacks[p.id] == null) {
        game = await api('PUT', `/api/games/${gameId}/final`, { playerId: p.id, amount: 0 });
      }
    }
    haptic(12);
  }

  async function bulkBuyIn() {
    const amt = Number(bulkAmount);
    if (!(amt > 0)) { toast('Enter an amount'); return; }
    if (browser) localStorage.setItem('pc_default_buyin', String(amt));
    const targets = game.players.filter((p: any) => !game.transactions.some((t: any) => t.playerId === p.id));
    if (!targets.length) { toast('Everyone has bought in already'); return; }
    for (const p of targets) game = await api('POST', `/api/games/${gameId}/transactions`, { playerId: p.id, amount: amt, type: 'buyin' });
    haptic([10, 30, 10]);
    toast(`Bought in ${targets.length} player${targets.length > 1 ? 's' : ''} for ${money(amt, unit)}`);
  }

  async function closeGame() {
    if (!confirm('End the game and show the summary?')) return;
    game = await api('POST', `/api/games/${gameId}/close`);
    showShareBanner = false;
  }

  async function reopenGame() {
    if (!confirm('Reopen the game? This clears paid marks.')) return;
    game = await api('POST', `/api/games/${gameId}/reopen`);
  }

  // Remove this game from *your* view only: unlink your account seat (so it drops
  // out of "My games") and forget it on this device. Anyone else who's linked
  // keeps the game and their access — the game itself is not destroyed.
  async function deleteGameForMe() {
    if (!confirm('Remove this game from your games? Anyone else linked to it keeps their access.')) return;
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
    if (!confirm('Remove this player and their transactions?')) return;
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
    const c = (x: any) => Math.round(Number(x || 0) * 100);
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
      const transfers = draft.filter((t: any) => Number(t.amount) > 0);
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
    if (name && name !== game.name) {
      game = await api('PUT', `/api/games/${gameId}/meta`, { name });
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

  function dismissIdentity() {
    identityDismissed = true;
    if (browser) localStorage.setItem('pc_idban_' + gameId, '1');
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

    {#if game.status === 'active'}
      <!-- ═══════════════════ ACTIVE GAME ═══════════════════ -->

      <!-- Header -->
      <div class="flex items-center justify-between gap-2.5">
        <div>
          <h1 class="text-2xl font-bold cursor-text" contenteditable="true" onblur={updateGameName}>{game.name}</h1>
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

      <!-- Identity banner -->
      {#if !identityDismissed}
        <div class="banner banner-info flex items-center justify-between mt-2.5">
          <span>You are <b>{getActor().name || 'unknown'}</b> — every edit is logged under this name.</span>
          <div class="flex gap-1.5">
            <button class="btn-small btn-ghost" onclick={promptName}>Change</button>
            <button class="btn-small btn-ghost" onclick={dismissIdentity}>✕</button>
          </div>
        </div>
      {/if}

      {@render claimBanner()}

      <!-- Players heading + cash-out jump -->
      <div class="flex items-center justify-between mt-6 mb-3">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Players</h2>
        {#if totalIn > 0}
          <button class="btn-small btn-ghost" onclick={() => document.getElementById('cashout')?.scrollIntoView({ behavior: 'smooth' })}>↓ Cash out</button>
        {/if}
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
              <span class="cursor-text rounded px-0.5 -mx-0.5 hover:bg-surface-2 focus:bg-surface-2 focus:outline-none" contenteditable="true" spellcheck="false"
                    title="Tap to rename"
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                    onblur={(e) => renamePlayer(p.id, e)}>{p.name}</span>
              {#if p.handle}<a href="/u/{p.handle}" class="text-info text-xs no-underline hover:underline ml-1" title="Linked to @{p.handle}">@{p.handle}</a>{/if}
              {#if p.id === myId()}<span class="pill pill-info ml-1">you</span>{/if}
              {#if final_ != null}<span class="pill ml-1 {net >= 0 ? 'pill-win' : 'pill-lose'}">{net >= 0 ? '+' : ''}{money(net, unit)}</span>{/if}
            </div>
            <div class="text-muted text-xs mt-0.5">in {money(inv, unit)}{final_ != null ? ` · out ${money(final_, unit)}` : ''}</div>
          </div>
          <div class="flex gap-2 shrink-0">
            <button class="btn-small btn-secondary" onclick={() => openMoneyModal(p.id, p.name)}>+ Money</button>
            <button class="btn-small btn-ghost" onclick={() => { expanded.has(p.id) ? expanded.delete(p.id) : expanded.add(p.id); expanded = new Set(expanded); }}>
              {isExpanded ? '▾' : '▸'} log
            </button>
          </div>
        </div>
        {#if isExpanded}
          <div class="card !bg-surface-2 -mt-1 mb-2.5">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Transactions</h3>
            {#each game.transactions.filter((t: any) => t.playerId === p.id) as t (t.id)}
              <div class="flex items-center justify-between text-sm mb-1.5">
                <span>{t.type === 'topup' ? 'top-up' : 'buy-in'} <span class="text-muted">{shortDate(t.at)}</span></span>
                <span class="font-semibold">{money(t.amount, unit)}</span>
              </div>
            {:else}
              <p class="text-muted text-sm">No buy-ins yet — use "+ Money".</p>
            {/each}
            <button class="btn-small btn-danger w-full mt-3" onclick={() => removePlayer(p.id)}>Remove {p.name} and all transactions</button>
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
              <input class="input !w-20 !py-2 !px-3" type="number" inputmode="decimal" step="any" min="0" bind:value={bulkAmount} />
              <button class="btn-small btn-secondary" onclick={bulkBuyIn}>Buy in all</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Cash-out section -->
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3" id="cashout">Cash-out & settle</h2>
      <p class="text-muted text-xs mb-2">Enter how much each player has left at the end. {settlement ? `${money(settlement.totalFinal, unit)} counted of ${money(totalIn, unit)} bought in.` : ''}</p>
      <div class="card">
        {#each game.players as p (p.id)}
          {@const isOut = game.finalStacks[p.id] === 0}
          <div class="flex items-center justify-between mb-2 gap-2">
            <span class="font-medium">{p.name}</span>
            <div class="flex items-center gap-1.5">
              <button class="btn-small btn-ghost {isOut ? '!bg-accent !text-accent-ink !border-transparent' : ''}" onclick={() => setOut(p.id)} title="Busted — nothing left">Out</button>
              <input class="input !w-[120px] !py-2 !px-3" type="number" inputmode="decimal" step="any" min="0" placeholder="left ({unit})"
                value={game.finalStacks[p.id] ?? ''} onchange={(e) => setFinal(p.id, (e.target as HTMLInputElement).value)} />
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
            Off by {money(Math.abs(diff), unit)} — counted {money(settlement.totalFinal, unit)} but {money(settlement.totalInvested, unit)} was bought in.
            {diff > 0 ? 'Too many chips counted' : 'Missing chips'} — recount before paying out.
          </div>
        {/if}
      {/if}

      <!-- Who pays who (preview) -->
      {#if !allEntered}
        <p class="text-muted text-sm">Enter every player's cash-out to see who pays who.</p>
      {:else if settlement && settlement.transfers.length > 0}
        <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mt-4 mb-2">Who pays who</h3>
        {#each settlement.transfers as t}
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

      <!-- End game -->
      {#if amHost}
        <button class="btn btn-secondary w-full mt-2.5" onclick={closeGame}>End game & show summary</button>
      {/if}

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

    {:else}
      <!-- ═══════════════════ SUMMARY (ended/settled) ═══════════════════ -->
      {@const s = game.settlement || { transfers: [], lines: [], balanced: true }}
      {@const standings = (s.lines || []).slice().sort((a: any, b: any) => ((b.net ?? 0)) - ((a.net ?? 0)))}
      {@const allSettled = game.status === 'settled'}
      {@const bal = myBalance()}

      <!-- Player name: a profile link (highlighted) if they linked an account,
           otherwise plain text for players who played without one. -->
      {#snippet playerName(line: any, cls = '')}
        {@const handle = playerHandle(line.playerId)}
        {#if handle}
          <a href="/u/{handle}" class="text-info font-semibold no-underline hover:underline {cls}" title="View {line.name}'s profile">{line.name}<span class="text-info/60 text-[0.7em] align-super ml-px">↗</span></a>
        {:else}
          <span class={cls}>{line.name}</span>
        {/if}
      {/snippet}

      <div>
        <h1 class="text-2xl font-bold">{game.name}</h1>
        <div class="text-muted text-sm">
          Game <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{game.id}</span> ·
          <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold {allSettled ? 'bg-accent/15 text-accent border border-accent' : 'bg-warn/15 text-[#f3cd6b] border border-warn'}">
            {allSettled ? 'All settled' : 'Game ended'}
          </span>
        </div>
      </div>

      {@render claimBanner()}

      <!-- My balance callout -->
      {#if bal}
        <div class="card mt-4 {bal.net > 0 ? '!border-accent/50 !bg-accent/[.08]' : bal.net < 0 ? '!border-danger/50 !bg-danger/[.08]' : ''}">
          <div class="text-xs uppercase tracking-widest font-bold text-muted">Your result</div>
          <div class="text-3xl font-extrabold mt-1 mb-2 {bal.net >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">
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
        <div class="flex items-end justify-center gap-2.5 mb-5">
          {#each (standings.length >= 3 ? [standings[1], standings[0], standings[2]] : standings.slice(0, 2)) as l, i}
            {@const medal = standings.length >= 3 ? ['🥈', '🥇', '🥉'][i] : ['🥇', '🥈'][i]}
            {@const height = standings.length >= 3 ? [94, 124, 72][i] : [124, 94][i]}
            <div class="flex-1 max-w-[130px] flex flex-col items-center text-center">
              <div class="font-extrabold tabular-nums mb-1.5 {l.net >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{l.net >= 0 ? '+' : ''}{money(l.net, unit)}</div>
              <div class="w-full rounded-t-xl border border-border-soft border-b-0 flex flex-col items-center pt-3 gap-0.5 bg-surface-2" style="height:{height}px">
                <span class="text-[1.7rem]">{medal}</span>
              </div>
              <div class="mt-2 text-sm break-words">{@render playerName(l, 'font-semibold')}</div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Final standings -->
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-4 mb-3">Final standings</h2>
      <div class="card">
        {#each standings as l, idx}
          <div class="flex items-center justify-between mb-1.5">
            <span>{idx + 1}. {@render playerName(l)} <span class="text-muted text-sm">in {money(l.invested, unit)}</span></span>
            <span class="font-bold tabular-nums {l.net >= 0 ? 'text-accent' : 'text-danger'}">{l.net >= 0 ? '+' : ''}{money(l.net, unit)}</span>
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
          <div class="transfer-row gap-1.5">
            <select class="input !py-2 !px-2 flex-1" bind:value={t.from}>
              {#each parties.debtors as d}<option value={d.id}>{d.name}</option>{/each}
            </select>
            <span class="text-accent font-extrabold shrink-0">→</span>
            <select class="input !py-2 !px-2 flex-1" bind:value={t.to}>
              {#each parties.creditors as c}<option value={c.id}>{c.name}</option>{/each}
            </select>
            <input class="input !w-20 !py-2 !px-2" type="number" inputmode="decimal" step="any" min="0" bind:value={t.amount} />
            <button class="btn-small btn-danger" onclick={() => removeDraftLine(i)}>✕</button>
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
        {#each s.transfers as t (t.id)}
          <div class="transfer-row {t.paid ? 'opacity-50' : ''}">
            <span class="font-semibold {t.paid ? 'line-through' : ''}">{t.fromName}</span>
            <span class="text-accent font-extrabold">→</span>
            <span class="font-semibold {t.paid ? 'line-through' : ''}">{t.toName}</span>
            <span class="ml-auto font-bold tabular-nums cursor-pointer {t.paid ? 'line-through' : ''}" onclick={() => copyAmount(t.amount)} title="Tap to copy">{money(t.amount, unit)}</span>
            <button class="btn-small {t.paid ? 'btn-secondary' : 'btn'}" onclick={() => markPaid(t.id, !t.paid)}>{t.paid ? '✓ paid' : 'Mark paid'}</button>
          </div>
        {/each}
      {/if}

      <!-- Account prompt -->
      {#if !myAccount}
        <div class="banner banner-info mt-4">📈 Follow your stats across every game. <a href="/account">Create an account →</a></div>
      {/if}

      <!-- Reopen + activity -->
      <div class="border-t border-border-soft mt-4 pt-4 flex items-center justify-between">
        {#if amHost}
          <button class="btn-small btn-ghost" onclick={reopenGame}>↩ Reopen to edit</button>
        {:else}
          <span class="text-muted text-sm">Only the host can reopen.</span>
        {/if}
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
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onclick={(e) => { if (e.target === e.currentTarget) joinOpen = false }}>
    <div class="card max-w-sm w-full" onclick={(e) => e.stopPropagation()}>
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
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onclick={(e) => { if (e.target === e.currentTarget) modalOpen = false }}>
    <div class="card max-w-sm w-full" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">{modalType === 'buyin' ? 'Buy in' : 'Top up'} — {modalName}</h3>
      <div class="flex gap-2 mb-3">
        <button class="btn-small flex-1 {modalType === 'buyin' ? 'btn' : 'btn-secondary'}" onclick={() => modalType = 'buyin'}>Buy-in</button>
        <button class="btn-small flex-1 {modalType === 'topup' ? 'btn' : 'btn-secondary'}" onclick={() => modalType = 'topup'}>Top-up</button>
      </div>
      <label class="block text-xs text-muted font-medium mb-2">Amount — tap chips to stack</label>
      <div class="flex flex-wrap gap-2 mb-3">
        {#each [5, 10, 25, 50, 100] as v}
          <button class="w-[52px] h-[52px] rounded-full font-extrabold text-[.95rem] text-white border-[3px] border-dashed border-white/60 grid place-items-center cursor-pointer active:scale-90 transition-transform"
            style="background: {v === 5 ? '#d64545' : v === 10 ? '#3a78d6' : v === 25 ? '#2f9e6e' : v === 50 ? '#e08a2b' : '#1c1c1c'}; {v === 100 ? 'color: var(--color-gold); border-color: rgba(244,196,81,.6);' : ''}"
            onclick={() => addChip(v)}>{v}</button>
        {/each}
        <button class="w-[52px] h-[52px] rounded-full font-extrabold text-[.95rem] text-muted bg-surface-3 border border-border grid place-items-center cursor-pointer active:scale-90 transition-transform"
          onclick={() => addChip('clear')}>C</button>
      </div>
      <input class="input mb-3" type="number" inputmode="decimal" step="any" min="0" bind:value={modalAmount}
        onkeydown={(e) => { if (e.key === 'Enter') addMoney(); }} />
      <div class="flex gap-2">
        <button class="btn-small btn-secondary flex-1" onclick={() => modalOpen = false}>Cancel</button>
        <button class="btn flex-1" onclick={addMoney}>Add</button>
      </div>
    </div>
  </div>
{/if}
