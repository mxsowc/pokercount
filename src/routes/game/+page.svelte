<script lang="ts">
  import { page } from '$app/stores';
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

  // New player input
  let newPlayerName = $state('');

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
  const iAmSeated = () => game?.players?.some((p: any) => p.id === myId());
  const invested = (pid: string) => (game?.transactions ?? []).filter((t: any) => t.playerId === pid).reduce((s: number, t: any) => s + t.amount, 0);
  const unit = $derived(game?.unit || '€');
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

    if (!iAmSeated() && game.status === 'active') {
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
    if (!name) return;
    newPlayerName = '';
    game = await api('POST', `/api/games/${gameId}/players`, { name });
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
              {p.name}
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

      <!-- Add player -->
      <div class="flex gap-2 mt-2">
        <input class="input flex-1" placeholder="Add player name" bind:value={newPlayerName} onkeydown={(e) => { if (e.key === 'Enter') addPlayer(); }} />
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
          <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold {allSettled ? 'bg-accent/15 text-accent border border-accent' : 'bg-warn/15 text-[#f3cd6b] border border-warn'}">
            {allSettled ? 'All settled' : 'Game ended'}
          </span>
        </div>
      </div>

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
              <div class="mt-2 font-semibold text-sm break-words">{l.name}</div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Final standings -->
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-4 mb-3">Final standings</h2>
      <div class="card">
        {#each standings as l, idx}
          <div class="flex items-center justify-between mb-1.5">
            <span>{idx + 1}. {l.name} <span class="text-muted text-sm">in {money(l.invested, unit)}</span></span>
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
        <p class="text-muted text-xs mb-2">Tap an amount to copy it for Venmo / Cash App. Use <b>Adjust</b> to change who pays who.</p>
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
