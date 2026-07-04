<script lang="ts">
  import { page } from '$app/stores';
  import { goto, invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';
  import { toast } from '$lib/stores/toast';
  import { money, parseAmount } from '$lib/utils/money';
  import { AWARDS } from '$lib/awards';
  import { ago, shortDate } from '$lib/utils/time';
  import { haptic, celebrate } from '$lib/utils/fx';
  import { computeSettlement } from '$lib/engine/settle.js';
  import QrCode from '$lib/components/QrCode.svelte';
  import CurrencyPicker from '$lib/components/CurrencyPicker.svelte';
  import { onMount, onDestroy, tick } from 'svelte';

  // ---- state ----------------------------------------------------------------
  let game = $state<any>(null);
  let myAccount = $state<any>(null);
  let myStreak = $state<{ current: number; kind: 'win' | 'loss' | 'none' } | null>(null); // signed-in user's run, for the share message
  let showActivity = $state(false);
  let seriesData = $state<any>(null);
  let showShareBanner = $state(false);
  let showTrackTip = $state(false); // host-only "how to keep score" recommendation
  let amHost = $state(false); // this device opened the game (holds the host token)
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
  let quickCashout = $state('');
  let quickCashoutBusy = $state(false);
  let actionBusy = $state(new Set<string>());

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

  // ---- Nit game (side game) -------------------------------------------------
  // While on, every seated player "holds a button" until they win a pot. When
  // exactly one holder remains, that player has lost. No money attached.
  const nit = $derived(game?.nitGame ?? null);
  const nitCleared = $derived(new Set<string>(nit?.cleared ?? []));
  const nitHolders = $derived.by(() =>
    nit?.on && game ? game.players.filter((p: any) => !nitCleared.has(p.id)) : []
  );
  const nitLoser = $derived(
    nit?.on && game && game.players.length >= 2 && nitHolders.length === 1 ? nitHolders[0] : null
  );
  async function toggleNitGame() {
    try { game = await api('POST', `/api/games/${gameId}/nit`, { on: !(game?.nitGame?.on) }); }
    catch (err: any) { toast(err.message); }
  }
  async function markNitWon(pid: string) {
    try { game = await api('POST', `/api/games/${gameId}/nit`, { playerId: pid }); }
    catch (err: any) { toast(err.message); }
  }
  // Announce the loser once, for everyone (SSE keeps `game` in sync across devices).
  let lastNitLoser = $state<string | null>(null);
  $effect(() => {
    if (!browser) return;
    const id = nitLoser?.id ?? null;
    if (id && id !== lastNitLoser) { haptic(25); toast(`🎯 ${nitLoser?.name} has lost the nit game`); }
    lastNitLoser = id;
  });

  // Account ↔ seat linkage (for claim / leave)
  const mySeat = $derived(myAccount && game ? game.players.find((p: any) => p.userId === myAccount.id) ?? null : null);
  // Which seat is "me": prefer the seat linked to my account, fall back to this
  // device's seat token. (Account-linked players don't always have pc_me set on
  // every device, and pc_me can point at a different seat than the linked one.)
  const mySeatId = (): string | null => mySeat?.id ?? myId();
  const unclaimedSeats = $derived(game ? game.players.filter((p: any) => !p.userId) : []);
  const seatedUserIds = $derived(new Set((game?.players ?? []).map((p: any) => p.userId).filter(Boolean)));
  // If an unclaimed seat name matches my account name, it's probably mine — pre-offer it.
  const suggestedClaim = $derived.by(() => {
    if (!myAccount) return null;
    const dn = (myAccount.displayName || '').trim().toLowerCase();
    return unclaimedSeats.find((p: any) => p.name.trim().toLowerCase() === dn) ?? null;
  });

  // Once the game is done, pull the signed-in user's current win/loss streak (it
  // already includes this game) so the share message can flag a hot/cold run.
  // Streaks only exist for signed-in users; fetched once per finished game.
  let streakFetchedFor: string | null = null; // plain (non-reactive) guard
  $effect(() => {
    if (!browser) return;
    const finished = !!game && game.status !== 'active';
    const handle = myAccount?.handle;
    const gid = game?.id;
    if (!finished || !handle || !gid || streakFetchedFor === gid) return;
    streakFetchedFor = gid;
    api('GET', `/api/users/${encodeURIComponent(handle)}/stats`)
      .then((r: any) => { myStreak = r?.stats?.streak ?? null; })
      .catch(() => { streakFetchedFor = null; });
  });
  const totalIn = $derived(game ? game.transactions.reduce((s: number, t: any) => s + Math.round(t.amount * 100), 0) / 100 : 0);
  const totalCashedOut = $derived(game ? Object.values(game.finalStacks as Record<string, number>).reduce((s: number, v: number) => v != null ? s + Math.round(v * 100) : s, 0) / 100 : 0);
  const stillInPlay = $derived(totalIn - totalCashedOut);

  // Live settlement computation for the active game view
  let settlement = $derived.by(() => {
    if (!game || game.status !== 'active') return null;
    try {
      return computeSettlement(game.players, game.transactions, game.finalStacks);
    } catch { return null; }
  });
  const allEntered = $derived(game ? game.players.length > 0 && game.players.every((p: any) => game.finalStacks[p.id] != null) : false);
  // Everyone's cashed out but the game is still open (in the play view): float a
  // sticky "Lock in" bar so the finish action isn't buried at the end of a long scroll.
  const stickyLockin = $derived(!!game && game.status === 'active' && allEntered && activeView === 'play');

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
  // The viewer's own line (account-linked seat, or this device's seat).
  const myLiveLine = $derived.by(() => {
    const id = mySeatId();
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
    amHost = !!localStorage.getItem('pc_host_' + gameId);
    showTrackTip = amHost && !localStorage.getItem('pc_tracktip_' + gameId);
    bulkAmount = localStorage.getItem('pc_default_buyin') || '20';

    try {
      game = await api('GET', `/api/games/${gameId}`);
    } catch (e: any) {
      error = e.message?.includes('not found') ? `Game #${gameId} not found.` : 'Could not reach the server.';
      loading = false;
      return;
    }
    // Prefer the table's standard buy-in set at creation (falls back to the device default).
    if (game?.defaultBuyIn > 0) bulkAmount = String(game.defaultBuyIn);
    try { myAccount = (await api('GET', '/api/me')).user; } catch {}
    // Load series data if this game belongs to one
    if (game.series) {
      try { seriesData = await api('GET', `/api/series?name=${encodeURIComponent(game.series)}`); } catch {}
    }
    loading = false;
    if (showShareBanner) toast('Game started!');

    // SSE live updates
    const es = new EventSource(`/api/games/${gameId}/events`);
    es.addEventListener('update', (e) => {
      try {
        const next = JSON.parse(e.data);
        // Ignore a frame older than what we already hold, so a slow/late delivery
        // can't overwrite newer state (e.g. a just-returned POST result).
        if (!game || (next.version ?? 0) >= (game.version ?? 0)) game = next;
      } catch {}
    });
    // The game was deleted (empty/abandoned) — bounce anyone viewing it home.
    es.addEventListener('deleted', () => { toast('This game was deleted'); goto('/'); });
    es.addEventListener('open', () => { if (liveStatus) { liveStatus = null; toast('Reconnected'); } });
    es.addEventListener('error', () => {
      liveStatus = es.readyState === EventSource.CLOSED ? 'Live sync stopped — refresh to reconnect.' : 'Reconnecting…';
    });
    unsub = () => es.close();

    // Returned here from sign-in to claim a seat. If exactly ONE unclaimed seat
    // matches the account name, link it automatically (they already said "that's
    // me" by signing in); anything ambiguous (0 or >1) still opens the picker.
    if ($page.url.searchParams.get('claim') === '1' && myAccount && !mySeat) {
      const dn = (myAccount.displayName || '').trim().toLowerCase();
      const matches = unclaimedSeats.filter((p: any) => p.name.trim().toLowerCase() === dn);
      if (matches.length === 1) claimSeat(matches[0].id);
      else claimOpen = true;
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
      case 'auto_close': return 'auto-closed after 24 hours';
      case 'reopen_game': return 'reopened the game';
      case 'mark_paid': return `marked settled: ${d.from} → ${d.to} ${money(d.amount, unit)}`;
      case 'mark_unpaid': return `marked unsettled: ${d.from} → ${d.to} ${money(d.amount, unit)}`;
      case 'edit_settlement': return 'adjusted who pays who';
      case 'pay_actual': return `paid ${d.from} → ${d.to} ${money(d.amount, unit)} (recomputed the rest)`;
      case 'nit_on': return 'turned the nit game on';
      case 'nit_off': return 'turned the nit game off';
      case 'nit_won': return `${d.name} won a pot (cleared their nit)`;
      case 'nit_undo': return `undid ${d.name}'s nit clear`;
      default: return e.action;
    }
  }

  // A stable, *delicate* tint per name so the same person always reads as the
  // same subtle shade — enough to pick your own name out of the who-pays-who list
  // at a glance, without turning it into a rainbow. Low saturation, high lightness
  // keeps every name legible on the dark rows.
  function nameColor(name: string): string {
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 45% 82%)`;
  }

  // ---- my balance callout ---------------------------------------------------
  function myBalance() {
    const pid = mySeatId();
    if (!game?.settlement || !pid) return null;
    const s = game.settlement;
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

  // Sign in / sign up WITHOUT leaving the game — a full-page hop to /account tore
  // down the live view and SSE and dropped the win card. A PIN-first inline modal
  // signs in, refreshes the account in place, and claims the seat. Google/Apple
  // (their own SDK lifecycle) still route to /account via the modal's link.
  let authOpen = $state(false);
  let authTab = $state<'login' | 'signup'>('signup');
  let authHandle = $state('');
  let authName = $state('');
  let authPin = $state('');
  let authBusy = $state(false);

  function signInToClaim() {
    authName = getActor().name || '';
    authHandle = '';
    authPin = '';
    authTab = 'signup';
    authOpen = true;
  }
  function oauthClaim() {
    goto(`/account?next=${encodeURIComponent(`/game?g=${gameId}&claim=1`)}`);
  }

  async function submitAuth() {
    if (authBusy) return;
    let res: Response;
    if (authTab === 'login') {
      if (!authHandle.trim() || !authPin) { toast('Enter your name and passcode'); return; }
    } else {
      if (authName.trim().length < 3) { toast('Name must be at least 3 characters'); return; }
      if (authPin.length < 4) { toast('Passcode must be at least 4 digits'); return; }
    }
    authBusy = true;
    try {
      res = authTab === 'login'
        ? await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: authHandle.trim(), pin: authPin }) })
        : await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: authName.trim(), displayName: authName.trim(), pin: authPin, newsletter: false }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || (authTab === 'login' ? 'Login failed' : 'Sign-up failed')); authBusy = false; return; }
      // Refresh the account locally (no reload / no SSE teardown) + the nav.
      myAccount = (await api('GET', '/api/me')).user;
      invalidateAll();
      authOpen = false;
      toast(authTab === 'login' ? 'Signed in' : 'Account created');
      await claimAfterAuth();
    } catch (e: any) { toast(e.message); }
    finally { authBusy = false; }
  }

  // After signing in, link the matching seat automatically when unambiguous.
  async function claimAfterAuth() {
    if (!myAccount || mySeat) return;
    const dn = (myAccount.displayName || '').trim().toLowerCase();
    const matches = unclaimedSeats.filter((p: any) => p.name.trim().toLowerCase() === dn);
    if (matches.length === 1) await claimSeat(matches[0].id);
    else if (unclaimedSeats.length > 0) claimOpen = true;
  }

  // Parse a typed amount, accepting a comma decimal separator (many phone keypads
  // only offer ',') and thousands separators. Shared, unit-tested parser — see
  // parseAmount in $lib/utils/money. Old inline version silently 1000×-mangled any
  // 3-decimal entry like "10.000".
  const decAmt = (v: any): number => parseAmount(v);

  // The table's standard buy-in, used for the one-tap quick button (and the bulk
  // tool). Defaults from localStorage; kept in `bulkAmount`.
  const quickAmt = $derived(decAmt(bulkAmount) > 0 ? decAmt(bulkAmount) : 20);

  // One tap = book the standard buy-in (or top-up if they're already in) — no
  // modal. This is the most common action of the night, so it shouldn't cost a
  // full-screen context switch.
  async function quickBuyIn(pid: string, name: string) {
    if (actionBusy.has('qi:' + pid)) return;
    actionBusy = new Set([...actionBusy, 'qi:' + pid]);
    if (browser) localStorage.setItem('pc_default_buyin', String(quickAmt));
    const hasPrior = game.transactions.some((t: any) => t.playerId === pid);
    try {
      game = await api('POST', `/api/games/${gameId}/transactions`, { playerId: pid, amount: quickAmt, type: hasPrior ? 'topup' : 'buyin' });
      haptic(12);
      toast(`${name} ${hasPrior ? 'topped up' : 'bought in'} ${money(quickAmt, unit)}`);
    } catch (e: any) { toast(e.message); }
    finally { const s = new Set(actionBusy); s.delete('qi:' + pid); actionBusy = s; }
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
    if (!(await askConfirm(`Remove this ${t.type === 'topup' ? 'top-up' : 'buy-in'} of ${money(t.amount, unit)}? It stays in the activity log.`, 'Remove', true))) return;
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
    try { game = await api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount }); }
    catch (e: any) { toast(e.message); }
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
    try { game = await api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount: 0 }); haptic(9); }
    catch (e: any) { toast(e.message); }
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

  // ---- hours played (for the signed-in user's €/hr stat) --------------------
  let hoursInput = $state('');
  let savingHours = $state(false);
  let editingHours = $state(false);
  async function saveHours() {
    const h = decAmt(hoursInput);
    if (!(h > 0)) { toast('Enter the hours played'); return; }
    savingHours = true;
    try { game = await api('PUT', `/api/games/${gameId}/hours`, { hours: h }); hoursInput = ''; toast('Hours saved'); }
    catch (e: any) { toast(e.message); }
    finally { savingHours = false; }
  }
  async function clearHours() {
    savingHours = true;
    try { game = await api('PUT', `/api/games/${gameId}/hours`, { hours: null }); hoursInput = ''; toast('Hours cleared'); }
    catch (e: any) { toast(e.message); }
    finally { savingHours = false; }
  }

  // Remove this game. If it has NO buy-ins it's an empty/abandoned table, so we
  // destroy it server-side (otherwise it lingers as a phantom "active" game).
  // Once there are buy-ins it has real history: we only unlink your account seat
  // and forget it on this device — anyone else linked keeps their access.
  async function deleteGameForMe() {
    const empty = !(game?.transactions?.length);
    const prompt = empty
      ? 'Delete this game? It has no buy-ins, so it will be removed for everyone.'
      : 'Remove this game from your games? Anyone else linked to it keeps their access.';
    if (!(await askConfirm(prompt, 'Delete', true))) return;
    try {
      if (empty) await api('DELETE', `/api/games/${gameId}`);
      else if (myAccount && mySeat) await api('DELETE', `/api/games/${gameId}/claim`);
    } catch (e: any) { toast(e.message); return; }
    if (browser) {
      try {
        const list = JSON.parse(localStorage.getItem('pc_games') || '[]').filter((g: any) => g.id !== gameId);
        localStorage.setItem('pc_games', JSON.stringify(list));
      } catch {}
      localStorage.removeItem('pc_me_' + gameId);
      localStorage.removeItem('pc_host_' + gameId);
    }
    toast(empty ? 'Game deleted' : 'Removed from your games');
    goto('/');
  }

  async function removePlayer(pid: string) {
    if (!(await askConfirm('Remove this player and their transactions?', 'Remove', true))) return;
    try { game = await api('DELETE', `/api/games/${gameId}/players/${pid}`); }
    catch (e: any) { toast(e.message); }
  }

  async function markPaid(tid: string, paid: boolean) {
    if (!paid) haptic(14);
    try { game = await api('PUT', `/api/games/${gameId}/settlement/${tid}`, { paid }); }
    catch (e: any) { toast(e.message); }
  }

  // "Paid a different amount" — record the actual amount on a payment, then the
  // server re-solves the remaining payments (so e.g. paying €50 on a €40 debt
  // routes the €10 change back to you in the optimal way).
  let payDiff = $state<{ id: string; amount: string } | null>(null);
  function startPayDiff(t: any) { payDiff = { id: t.id, amount: String(t.amount) }; }
  async function confirmPayDiff() {
    if (!payDiff) return;
    const amt = decAmt(payDiff.amount);
    if (!(Number.isFinite(amt) && amt >= 0)) { toast('Enter a valid amount'); return; }
    const tid = payDiff.id;
    try {
      game = await api('PUT', `/api/games/${gameId}/settlement/${tid}`, { paid: true, amount: amt });
      payDiff = null;
      haptic(12);
      toast('Recorded — remaining payments recomputed');
    } catch (e: any) { toast(e.message); }
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

  // Share opens a sheet with the code, link and a QR — the QR is the in-person
  // win: pass the phone round and everyone scans to join, no typing the code.
  let shareOpen = $state(false);
  // Share the short, pretty code link (?g=3599) — it resolves to whichever game
  // currently holds that code, which is exactly this live game. (gameId may be the
  // long internal id if the host opened via a permanent link; prefer the code.)
  const shareUrl = () => `${location.origin}/game?g=${game?.code ?? gameId}`;
  function shareLink() { shareOpen = true; }
  function copyShareLink() {
    navigator.clipboard.writeText(shareUrl()).then(() => toast('Link copied')).catch(() => toast('Could not copy'));
  }
  function nativeShare() {
    // Embed the link IN the text (not just the `url` field): some chat apps
    // (Telegram, WhatsApp) keep only `text` and drop `url`, which strips the link
    // and its rich preview — leaving a bare "Join game #1234". Inline always shows.
    const msg = `Join game #${game?.code ?? gameId}\n${shareUrl()}`;
    if (navigator.share) navigator.share({ title: 'potcount', text: msg }).catch(() => {});
    else copyShareLink();
  }
  async function toggleLock() {
    try {
      game = await api('PUT', `/api/games/${gameId}/lock`, { locked: !game.locked });
      toast(game.locked ? 'Table locked — you add players' : 'Table open — anyone with the link can join');
    } catch (e: any) { toast(e.message || 'Could not change lock'); }
  }

  // Just the payments, as plain text to drop in the group chat to settle up.
  function copyWhoPaysWho() {
    const transfers = (game?.settlement?.transfers || []).filter((t: any) => !t.paid);
    if (!transfers.length) { toast('No payments to copy'); return; }
    let text = `${game.name} #${game.code} — who pays who\n`;
    for (const t of transfers) text += `${t.fromName} → ${t.toName}: ${money(t.amount, unit)}\n`;
    navigator.clipboard.writeText(text.trim())
      .then(() => toast('Copied — paste in your group chat'))
      .catch(() => toast('Could not copy'));
  }

  // A "🔥 3W streak" / "❄️ 3L streak" tag for the signed-in user when they're on a
  // run of 3+ (running hot or cold). Empty otherwise. Only signed-in users have a streak.
  function myStreakTag(): string {
    const s = myStreak;
    if (!s || (s.current ?? 0) < 3) return '';
    if (s.kind === 'win') return ` (🔥 ${s.current}W streak)`;
    if (s.kind === 'loss') return ` (❄️ ${s.current}L streak)`;
    return '';
  }

  function shareResult() {
    // Prefer the frozen, locked-in settlement; before lock-in (active game), fall
    // back to the LIVE one so you can still share the night the same way if you
    // forgot to lock in. Same text format either way.
    const src = game?.settlement?.lines ? game.settlement : settlement;
    if (!src?.lines?.length) { toast('Nothing to share yet — enter some cash-outs first'); return; }
    const lines = src.lines.slice().sort((a: any, b: any) => (b.net ?? 0) - (a.net ?? 0));
    const medals = ['🥇', '🥈', '🥉'];
    let text = `${game.name} #${game.code}\n\n`;
    lines.forEach((l: any, i: number) => {
      const medal = i < 3 ? medals[i] + ' ' : '   ';
      const sign = l.net >= 0 ? '+' : '';
      const tag = mySeat && l.playerId === mySeat.id ? myStreakTag() : '';
      text += `${medal}${l.name}: ${sign}${money(l.net, unit)}${tag}\n`;
    });
    const transfers = (src.transfers || [])
      .filter((t: any) => !t.paid)
      .slice().sort((a: any, b: any) => b.amount - a.amount);
    if (transfers.length) {
      text += '\nWho pays who:\n';
      for (const t of transfers) {
        text += `${t.fromName} → ${t.toName}: ${money(t.amount, unit)}\n`;
      }
    }
    // Growth nudge for the group chat — read mostly by people without an account.
    // "Lock in your results" (ownership + loss-aversion) with a concrete, in-voice
    // benefit rather than salesy "free account" ad-speak.
    text += `\n🔒 Lock in your results — keep track of your sessions:`;
    text += `\npotcount.com/game?g=${gameId}`;
    // Pass only `text`: the game name + code is already its first line, and the
    // link is inlined at the bottom — passing `title`/`url` makes the share sheet
    // repeat them (the doubled header / second link).
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => toast('Results copied — paste in your group chat')).catch(() => {});
    }
  }

  // Cast an end-of-night award vote (one per award per game).
  async function castVote(award: { key: string; emoji: string; label: string }, p: any) {
    try {
      const res = await api('POST', `/api/games/${gameId}/vote`, { category: award.key, playerId: p.id });
      game = { ...game, votes: { ...game.votes, [award.key]: res.votes } };
      haptic(14);
      toast(`${award.emoji} ${award.label}: ${p.name}`);
    } catch (e: any) { toast(e.message); }
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

  // Change the game's currency mid-session. This relabels the unit only — amounts
  // already entered keep their numbers (no FX conversion), which is what you want
  // when you simply picked the wrong symbol at the start.
  let unitEditOpen = $state(false);
  let unitDraft = $state('');
  let savingUnit = $state(false);
  function openUnitEdit() { unitDraft = unit; unitEditOpen = true; }
  async function saveUnit() {
    const next = unitDraft.trim();
    if (!next || next === unit) { unitEditOpen = false; return; }
    savingUnit = true;
    try {
      game = await api('PUT', `/api/games/${gameId}/meta`, { unit: next });
      unitEditOpen = false;
      toast(`Currency changed to ${next}`);
    } catch (err: any) {
      toast(err.message);
    } finally { savingUnit = false; }
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
  <title>{game ? `potcount — ${game.name} #${game.code}` : 'potcount — game'}</title>
</svelte:head>

<div class="wrap" style={stickyLockin ? 'padding-bottom: calc(112px + env(safe-area-inset-bottom, 0px))' : undefined}>
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
            <div class="font-extrabold tabular-nums mb-1.5 {l.net > 0 ? 'text-win' : l.net < 0 ? 'text-danger' : 'text-muted'}" style="font-family:var(--font-display)">{l.net === 0 ? 'Even' : (l.net < 0 ? '−' : '+') + money(Math.abs(l.net), unit)}</div>
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
        <div class="text-muted text-sm">Game <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{game.code}</span> · {ls.ranked.length}/{game.players.length} cashed out · {money(stillInPlay, unit)} in play</div>
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
            <div class="text-xs uppercase tracking-widest font-bold text-muted">{allEntered ? 'Your result' : 'Your result so far'}</div>
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
            <p class="text-muted text-sm mt-1 mb-2.5">You haven't cashed out yet — enter how much you have left.</p>
            <form class="flex gap-2" onsubmit={(e) => {
              e.preventDefault();
              const pid = mine.playerId;
              const raw = quickCashout.trim();
              const amount = raw === '' ? null : decAmt(raw);
              if (amount == null || Number.isNaN(amount) || amount < 0) return;
              quickCashoutBusy = true;
              api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount }).then(g => { game = g; haptic(9); }).finally(() => { quickCashoutBusy = false; });
            }}>
              <input class="input flex-1 !py-2.5" type="text" inputmode="decimal" placeholder="Chips left ({unit})" bind:value={quickCashout} />
              <button type="submit" class="btn !px-5" disabled={quickCashoutBusy}>Go</button>
            </form>
            <button class="btn-small btn-ghost w-full mt-2" disabled={quickCashoutBusy} onclick={() => {
              const pid = mine.playerId;
              quickCashoutBusy = true;
              api('PUT', `/api/games/${gameId}/final`, { playerId: pid, amount: 0 }).then(g => { game = g; haptic(9); }).finally(() => { quickCashoutBusy = false; });
            }}>I'm out — nothing left</button>
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
          <div class="flex items-center justify-between mb-1.5 {l.playerId === mySeatId() ? 'font-bold' : ''}">
            <span>{idx + 1}. {@render playerName(l)} <span class="text-muted text-sm">in {money(l.invested, unit)}</span></span>
            <span class="font-bold tabular-nums {l.net > 0 ? 'text-win' : l.net < 0 ? 'text-danger' : 'text-muted'}">{l.net === 0 ? 'Even' : (l.net < 0 ? '−' : '+') + money(Math.abs(l.net), unit)}</span>
          </div>
        {/each}
        {#each ls.pending as l}
          <div class="flex items-center justify-between mb-1.5 opacity-60 {l.playerId === mySeatId() ? 'font-bold' : ''}">
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
              <span class="font-semibold truncate min-w-0" style="color:{nameColor(t.fromName)}">{t.fromName}</span>
              <span class="text-accent font-extrabold shrink-0">→</span>
              <span class="font-semibold truncate min-w-0" style="color:{nameColor(t.toName)}">{t.toName}</span>
              <span class="ml-auto font-bold tabular-nums">{money(t.amount, unit)}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted text-sm">No payments needed — everyone's even.</p>
      {/if}

      <!-- Reconciliation: only a real miscount once EVERYONE has cashed out. While
           players are still in, the gap is just their uncounted stacks — see the
           "still in" note above — so don't cry "recount". -->
      {#if allEntered && settlement && !settlement.balanced}
        <div class="banner banner-warn mt-3 text-sm">
          <div>Off by {money(Math.abs(settlement.discrepancy), unit)} — counted {money(settlement.totalFinal, unit)} of {money(settlement.totalInvested, unit)} bought in. Recount if you can.</div>
          <button class="btn-small btn w-full mt-2.5" onclick={() => reconcileOpen = true}>Can't find it? Even out the {money(Math.abs(settlement.discrepancy), unit)} →</button>
        </div>
      {/if}

      <!-- Optional: lock the summary in so the group can tick off who's paid. Anyone can do
           this (host isn't special); it switches everyone to the final summary. Not required —
           the standings above are already live for everyone. -->
      <div class="border-t border-border-soft mt-6 pt-4">
        <button class="btn w-full" onclick={closeGame}>Lock in & track who's paid</button>
        <p class="text-muted text-xs text-center mt-2">Finishes the game and freezes these standings so everyone can tick off who's paid. <b>Until you tap this the game stays open</b>, so you can keep fixing cash-outs or even out a miscount. Any player can reopen it later.</p>
        <!-- Share even without locking in — same shared format as the final summary. -->
        <button class="btn btn-secondary w-full mt-3" onclick={shareResult}>Share your night</button>
      </div>

     {:else}

      <!-- Header -->
      <div class="flex items-start justify-between gap-2.5">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold cursor-text border-b border-dashed border-transparent hover:border-border focus:border-accent focus:outline-none" contenteditable="true" title="Tap to rename" onfocus={selectAllText} onblur={updateGameName}>{game.name}</h1>
          <div class="text-muted text-sm">Game <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{game.code}</span> · {game.players.length} players · {money(stillInPlay, unit)} in play</div>
        </div>
        <div class="flex flex-wrap justify-end gap-1.5 shrink-0">
          <button class="btn-small {nit?.on ? 'btn' : 'btn-ghost'}" onclick={toggleNitGame} title="Nit game — a fun side game: the last player still holding a button (who hasn't won a pot) loses">🎯 Nit game{nit?.on && nitHolders.length > 1 ? ' · ' + nitHolders.length : ''}</button>
          <button class="btn-small btn-ghost" onclick={openUnitEdit} title="Change currency">💱 {unit}</button>
          <button class="btn-small btn-ghost" onclick={shareLink}>Share</button>
        </div>
      </div>

      <!-- Nit game: explain it while it's running (so the 🎯 buttons make sense) -->
      {#if nit?.on}
        <p class="text-muted text-xs mt-1.5 flex items-start gap-1.5">
          <span aria-hidden="true">🎯</span>
          <span><b class="text-text">Nit game on.</b> Tap a player's 🎯 each time they win a pot. The last one still holding it (never won a pot) loses.</span>
        </p>
      {/if}

      <!-- Change-currency popover -->
      {#if unitEditOpen}
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
             onclick={(e) => { if (e.target === e.currentTarget) unitEditOpen = false; }}>
          <div class="card max-w-xs w-full" onclick={(e) => e.stopPropagation()}>
            <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-1">Change currency</h3>
            <p class="text-muted text-xs mb-3">This relabels the unit — amounts already entered keep their numbers (no conversion).</p>
            <CurrencyPicker bind:value={unitDraft} />
            <div class="flex gap-2 mt-3">
              <button class="btn flex-1" disabled={savingUnit || !unitDraft.trim()} onclick={saveUnit}>{savingUnit ? 'Saving…' : 'Save'}</button>
              <button class="btn-small btn-secondary" disabled={savingUnit} onclick={() => unitEditOpen = false}>Cancel</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Share banner -->
      {#if showShareBanner}
        <div class="banner banner-ok flex items-center justify-between mt-2.5">
          <span>Game open! Share code <b class="text-accent font-bold">#{game.code}</b> so players can join.</span>
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

      <!-- Nit game: the last player still holding a button has lost -->
      {#if nitLoser}
        <div class="banner banner-warn mt-2.5 flex items-center justify-between gap-2">
          <span>🎯 <b>{nitLoser.name}</b> has lost the nit game</span>
          <button class="btn-small btn-ghost shrink-0" onclick={toggleNitGame} title="End the nit game">End</button>
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
      {#if game.status === 'active' && game.players.length > 0}
        <p class="text-xs text-faint mb-3 -mt-1">Tap <b class="text-accent-2 font-semibold">+{money(quickAmt, unit)}</b> to add a buy-in, or <b class="text-accent-2 font-semibold">Other</b> for a different amount.</p>
      {/if}

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
              {#if final_ != null}<span class="pill ml-1 {net >= 0 ? 'pill-win' : 'pill-lose'}">{net < 0 ? '−' : '+'}{money(Math.abs(net), unit)}</span>{/if}
            </div>
            <button class="text-muted text-xs mt-0.5 hover:text-text {inv > 0 ? 'cursor-pointer underline decoration-dotted decoration-border underline-offset-2' : ''}"
                    onclick={() => { if (inv > 0) toggleExpand(p.id); }} title={inv > 0 ? 'Edit or remove buy-ins' : ''}>
              in {money(inv, unit)}{final_ != null ? ` · out ${money(final_, unit)}` : ''}
            </button>
          </div>
          <div class="flex gap-1.5 shrink-0">
            {#if nit?.on}
              {@const cleared = nitCleared.has(p.id)}
              <button class="btn-small {cleared ? 'btn-secondary opacity-60' : 'btn-ghost'} !px-2.5 min-w-[44px]"
                      title={cleared ? `${p.name} has won a pot — tap to undo` : `Mark ${p.name} won a pot (clears their nit)`}
                      onclick={() => markNitWon(p.id)}>{cleared ? '✓' : '🎯'}</button>
            {/if}
            <button class="btn-small btn" onclick={() => quickBuyIn(p.id, p.name)} title="Quick {invested(p.id) > 0 ? 'top-up' : 'buy-in'} of {money(quickAmt, unit)}">+{money(quickAmt, unit)}</button>
            <button class="btn-small !px-3 font-semibold text-accent border border-accent/45 bg-accent/10 hover:bg-accent/20" onclick={() => openMoneyModal(p.id, p.name)} title="Add a different amount">Other</button>
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
                <span class="text-muted">{t.type === 'topup' ? 'Top-up' : 'Buy-in'} · {shortDate(t.at)}{#if t.by} · <span class="text-faint">by {t.by}</span>{/if}</span>
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
              <input class="input !w-[86px] !py-2 !px-2.5 tabular-nums {pl != null && pl > 0 ? '!text-win' : ''} {pl != null && pl < 0 ? '!text-danger' : ''}" type="text" inputmode="decimal" placeholder="+/- P/L"
                enterkeyhint={i < game.players.length - 1 ? 'next' : 'done'} data-plidx={i}
                title="Profit / loss — type a number here to set the stack from it"
                value={pl ?? ''}
                onchange={(e) => setFinalFromProfit(p.id, (e.target as HTMLInputElement).value)}
                onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const el = e.target as HTMLInputElement; setFinalFromProfit(p.id, el.value); const next = document.querySelector(`[data-plidx="${i + 1}"]`) as HTMLInputElement | null; if (next) next.focus(); else el.blur(); } }} />
            </div>
          </div>
        {:else}
          <p class="text-muted">Add players first.</p>
        {/each}
        {#if game.players.length > 0 && game.players.some((p: any) => game.finalStacks[p.id] == null)}
          <button class="btn-small btn-ghost w-full mt-1" onclick={markRestOut}>{game.players.every((p: any) => game.finalStacks[p.id] == null) ? 'Mark everyone as out (0)' : 'Mark everyone left as out (0)'}</button>
        {/if}
      </div>

      <!-- Balance banner — only meaningful once everyone has cashed out; before
           that the live "counted X of Y" counter above gives running feedback. -->
      {#if allEntered && settlement}
        {#if settlement.balanced}
          <div class="banner banner-ok">Books balance. Total in = total out = {money(settlement.totalInvested, unit)}.</div>
        {:else}
          {@const diff = settlement.discrepancy}
          <div class="banner banner-warn">
            <div>Off by {money(Math.abs(diff), unit)} — counted {money(settlement.totalFinal, unit)} but {money(settlement.totalInvested, unit)} was bought in.
            {diff > 0 ? 'Too many chips counted' : 'Missing chips'} — recount if you can.</div>
            <button class="btn-small btn w-full mt-2.5" onclick={() => reconcileOpen = true}>Can't find it? Even out the {money(Math.abs(diff), unit)} →</button>
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
            <span class="font-semibold" style="color:{nameColor(t.fromName)}">{t.fromName}</span>
            <span class="text-accent font-extrabold">→</span>
            <span class="font-semibold" style="color:{nameColor(t.toName)}">{t.toName}</span>
            <span class="ml-auto font-bold tabular-nums">{money(t.amount, unit)}</span>
          </div>
        {/each}
      {:else if allEntered}
        <p class="text-muted text-sm">No payments needed — everyone's even.</p>
      {/if}

      <!-- Finish the game — explicit, never automatic. Only once everyone's cashed
           out, so corrections/even-out happen first. "See my summary" is just a
           preview (doesn't end the game). -->
      {#if allEntered}
        <button class="btn w-full mt-3" onclick={closeGame}>Lock in & track who's paid</button>
        <p class="text-muted text-xs text-center mt-1.5">Finishes the game. It stays open until you tap this — fix a cash-out or even out a miscount above first.</p>
      {/if}
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
                {#if e.playerName}<b>{e.playerName}</b>{' '}{/if}{describe(e)}<br/>
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

      <div class="flex items-start justify-between gap-2">
        <div>
          <h1 class="text-2xl font-bold">{game.name}</h1>
          <div class="text-muted text-sm">
            Game <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{game.code}</span> ·
            <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold {allSettled ? 'bg-win/15 text-win border border-win' : 'bg-warn/15 text-[#f3cd6b] border border-warn'}">
              {allSettled ? 'All settled' : 'Game ended'}
            </span>
          </div>
        </div>
      </div>

      {@render claimBanner()}

      <!-- My balance callout -->
      {#if bal}
        <div class="card mt-4 {bal.net > 0 ? '!border-win/50 !bg-win/[.08]' : bal.net < 0 ? '!border-danger/50 !bg-danger/[.08]' : ''}">
          <div class="text-xs uppercase tracking-widest font-bold text-muted">Your result</div>
          <div class="text-3xl font-extrabold mt-1 mb-2 {bal.net >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">
            {bal.net < 0 ? '−' : '+'}{money(Math.abs(bal.net), unit)}
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

      <!-- Share your night — the viral moment, kept up top so it isn't missed. -->
      {#if standings.length >= 2}
        <button class="btn btn-secondary w-full mt-4" onclick={shareResult}>Share your night</button>
      {/if}

      {#if myAccount && mySeat}
        {@const myHours = game.hours?.[mySeat.id] ?? null}
        {#if myHours != null && !editingHours}
          <div class="flex items-center gap-3 mt-4 px-1 text-sm text-muted">
            <span>{myHours}h logged</span>
            <button class="btn-small btn-ghost !py-1 !px-2 text-xs" onclick={() => { hoursInput = String(myHours); editingHours = true; }}>Edit</button>
            <button class="btn-small btn-ghost !py-1 !px-2 text-xs" disabled={savingHours} onclick={clearHours}>Clear</button>
          </div>
        {:else if myHours != null && editingHours}
          <div class="flex gap-2 mt-4 px-1">
            <input class="input flex-1 !py-2" type="text" inputmode="decimal" placeholder="e.g. 4 or 3.5"
              bind:value={hoursInput} onkeydown={(e) => { if (e.key === 'Enter') { saveHours(); editingHours = false; } }} />
            <button class="btn-small btn" disabled={savingHours || !hoursInput.trim()} onclick={() => { saveHours(); editingHours = false; }}>Update</button>
            <button class="btn-small btn-ghost" onclick={() => { editingHours = false; }}>Cancel</button>
          </div>
        {:else}
          <div class="card mt-4">
            <div class="text-xs uppercase tracking-widest font-bold text-muted">Hours played</div>
            <p class="text-muted text-xs mt-1 mb-2">Optional — how long did you play? Powers your {unit}/hr stat.</p>
            <div class="flex gap-2">
              <input class="input flex-1 !py-2" type="text" inputmode="decimal" placeholder="e.g. 4 or 3.5"
                bind:value={hoursInput} onkeydown={(e) => { if (e.key === 'Enter') saveHours(); }} />
              <button class="btn-small btn" disabled={savingHours || !hoursInput.trim()} onclick={saveHours}>Save</button>
            </div>
          </div>
        {/if}
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
            <span class="font-bold tabular-nums {l.net > 0 ? 'text-win' : l.net < 0 ? 'text-danger' : 'text-muted'}">{l.net === 0 ? 'Even' : (l.net < 0 ? '−' : '+') + money(Math.abs(l.net), unit)}</span>
          </div>
        {/each}
      </div>

      <!-- Who pays who -->
      <div class="flex items-center justify-between mt-4 mb-3 gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Who pays who</h2>
        {#if s.transfers.length > 0 && !editingSettlement && s.balanced !== false}
          <div class="flex gap-1.5 shrink-0">
            <button class="btn-small btn-ghost" onclick={copyWhoPaysWho}>Copy</button>
            <button class="btn-small btn-ghost" onclick={startEditing}>Adjust</button>
          </div>
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
        <p class="text-muted text-xs mb-2">Tap an amount to copy it. Paid a different amount? Tap <b>≠</b> and we'll recompute the rest. Use <b>Adjust</b> to change who pays who.</p>
        {#each s.transfers.slice().sort((a: any, b: any) => b.amount - a.amount) as t (t.id)}
          <div class="transfer-row {t.paid ? 'opacity-50' : ''}">
            <span class="font-semibold truncate min-w-0 {t.paid ? 'line-through' : ''}" style="color:{nameColor(t.fromName)}">{t.fromName}</span>
            <span class="text-accent font-extrabold shrink-0">→</span>
            <span class="font-semibold truncate min-w-0 {t.paid ? 'line-through' : ''}" style="color:{nameColor(t.toName)}">{t.toName}</span>
            <span class="ml-auto font-bold tabular-nums cursor-pointer shrink-0 {t.paid ? 'line-through' : ''}" onclick={() => copyAmount(t.amount)} title="Tap to copy">{money(t.amount, unit)}</span>
            {#if !t.paid}
              <button class="btn-small btn-secondary shrink-0 !px-2.5" title="Paid a different amount — recompute the rest" onclick={() => startPayDiff(t)}>≠</button>
            {/if}
            <button class="btn-small shrink-0 {t.paid ? 'btn-secondary' : 'btn'}" onclick={() => markPaid(t.id, !t.paid)}>{t.paid ? '✓ paid' : 'Mark paid'}</button>
          </div>
          {#if payDiff?.id === t.id}
            <div class="bg-surface-2 rounded-[10px] p-3 mb-2 -mt-1 border-l-[3px] border-accent">
              <div class="text-xs text-muted mb-2">How much did <b class="text-text">{t.fromName}</b> actually give <b class="text-text">{t.toName}</b>? We'll mark it paid and recompute everyone else (any change comes back to them).</div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-muted text-sm">{unit}</span>
                <input class="input !w-24 !py-2 !px-2.5" type="text" inputmode="decimal" bind:value={payDiff!.amount}
                  onkeydown={(e) => { if (e.key === 'Enter') confirmPayDiff(); }} autocomplete="off" />
                <button class="btn-small btn" onclick={confirmPayDiff}>Record &amp; recompute</button>
                <button class="btn-small btn-ghost" onclick={() => payDiff = null}>Cancel</button>
              </div>
            </div>
          {/if}
        {/each}
        {@const smallUnpaid = s.transfers.filter((t: any) => t.amount <= forgiveMax && !t.paid)}
        {#if smallUnpaid.length > 0}
          <div class="flex items-center gap-2 mt-2">
            <button class="btn-small btn-ghost flex-1 text-muted" onclick={async () => { for (const t of smallUnpaid) await markPaid(t.id, true); }}>
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

      <!-- Series leaderboard — running scoreboard across recurring games -->
      {#if seriesData && seriesData.gameCount > 1}
        <div class="card mt-4">
          <div class="flex items-center justify-between gap-2 mb-2">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted m-0">{seriesData.series} — {seriesData.gameCount} games</h3>
          </div>
          {#each seriesData.leaderboard.slice(0, 5) as entry, idx}
            {@const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : ''}
            <div class="flex items-center justify-between text-sm mb-1">
              <span>{medal} {entry.name} <span class="text-muted text-xs">{entry.games}g · {entry.wins}w</span></span>
              <span class="font-bold tabular-nums {entry.totalNet >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{entry.totalNet >= 0 ? '+' : ''}{money(entry.totalNet, unit)}</span>
            </div>
          {/each}
          {#if seriesData.leaderboard.length > 5}
            <p class="text-xs text-muted mt-1">+{seriesData.leaderboard.length - 5} more</p>
          {/if}
        </div>
      {/if}

      <!-- End-of-night awards — peer-voted, signed-in players with a seat only -->
      {#if myAccount && mySeat && standings.length >= 3}
        {@const eligiblePlayers = game.players.filter((p: any) => p.userId && p.userId !== myAccount.id)}
        {#if eligiblePlayers.length > 0}
          <div class="card mt-4 !p-3">
            <div class="text-xs font-semibold uppercase tracking-widest text-muted mb-2.5">End-of-night awards</div>
            <div class="flex flex-col gap-3">
              {#each AWARDS as award (award.key)}
                {@const myVote = game.votes?.[award.key]?.[myAccount.id]}
                <div>
                  <div class="text-sm font-semibold mb-1.5">{award.emoji} {award.q}</div>
                  {#if myVote}
                    {@const votedPlayer = game.players.find((p: any) => p.id === myVote)}
                    <p class="text-sm text-muted">You voted for <b class="text-text">{votedPlayer?.name || '?'}</b></p>
                  {:else}
                    <div class="flex flex-wrap gap-1.5">
                      {#each eligiblePlayers as p (p.id)}
                        <button class="btn-small btn-secondary" onclick={() => castVote(award, p)}>{p.name}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            <p class="text-xs text-faint mt-2.5">Only you and other signed-in players can vote. One vote each per award.</p>
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
        {@const myLine = standings.find((l: any) => l.playerId === myId())}
        {@const won = myLine && myLine.net > 0}
        <div class="card mt-4 !border-accent/40 text-center">
          {#if won}
            <div class="text-2xl mb-1">🏆</div>
            <div class="text-base font-bold">You're up {money(myLine.net, unit)} tonight</div>
            <p class="text-muted text-sm mt-1 mb-3">Lock this in — create an account in 10 seconds and this win goes on your permanent record.</p>
          {:else}
            <div class="text-2xl mb-1">📈</div>
            <div class="text-base font-bold">Track your stats across every game</div>
            <p class="text-muted text-sm mt-1 mb-3">Create a free account to claim your seat and see your running record over time.</p>
          {/if}
          <button class="btn w-full" onclick={signInToClaim}>{won ? 'Save this win' : 'Claim your seat & sign up'}</button>
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

<!-- Sticky "Lock in" bar — floats above the bottom nav once everyone's cashed
     out, so finishing the night doesn't require scrolling to the very bottom. -->
{#if stickyLockin}
  <div class="fixed left-0 right-0 z-40 px-4" style="bottom: calc(62px + env(safe-area-inset-bottom, 0px))">
    <div class="max-w-[560px] mx-auto">
      <button class="btn w-full shadow-xl" onclick={closeGame}>Lock in &amp; track who's paid</button>
    </div>
  </div>
{/if}

<!-- Live sync status banner -->
{#if liveStatus}
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 banner banner-warn max-w-[90%] text-center">{liveStatus}</div>
{/if}

<!-- Share Modal — code + link + QR (scan to join in person) -->
{#if shareOpen}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onclick={(e) => { if (e.target === e.currentTarget) shareOpen = false }}>
    <div class="card max-w-sm w-full rounded-t-2xl sm:rounded-[16px] text-center" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-1">Invite players</h3>
      <div class="text-3xl font-extrabold tracking-widest text-accent mb-1" style="font-family:var(--font-display)">#{game?.code ?? gameId}</div>
      <p class="text-muted text-xs mb-3">Scan to join, or share the link</p>
      <div class="flex justify-center mb-3"><QrCode data={shareUrl()} size={208} /></div>
      <div class="flex gap-2">
        <button class="btn-small btn-secondary flex-1" onclick={copyShareLink}>Copy link</button>
        <button class="btn-small btn flex-1" onclick={nativeShare}>Share…</button>
      </div>
      {#if amHost}
        <button class="w-full mt-3 flex items-center justify-between gap-3 p-3 rounded-xl border border-border text-left" onclick={toggleLock}>
          <span>
            <span class="block text-sm font-semibold">{game?.locked ? '🔒 Table locked' : '🔓 Open to anyone'}</span>
            <span class="block text-xs text-muted">{game?.locked ? 'Only you can add players. Tap to open.' : 'Anyone with the code/link can join. Tap to lock.'}</span>
          </span>
          <span class="text-xs font-semibold text-accent shrink-0">{game?.locked ? 'Open' : 'Lock'}</span>
        </button>
      {:else if game?.locked}
        <p class="text-xs text-muted mt-3">🔒 The host locked this table — ask them to add you.</p>
      {/if}
      <button class="btn-small btn-ghost w-full mt-2" onclick={() => shareOpen = false}>Done</button>
    </div>
  </div>
{/if}

<!-- Join Modal -->
{#if joinOpen}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onclick={(e) => { if (e.target === e.currentTarget) joinOpen = false }}>
    <div class="card max-w-sm w-full rounded-t-2xl sm:rounded-[16px]" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-1">Join this game</h3>
      <p class="text-muted text-sm mb-3">Game #{game?.code ?? gameId} — enter your name to take a seat.</p>
      <input class="input mb-3" bind:value={joinNameVal} placeholder="Your name" maxlength="40" autocapitalize="words" autocomplete="name" enterkeyhint="go" onkeydown={(e) => { if (e.key === 'Enter') joinAsPlayer(); }} />
      <button class="btn w-full" onclick={joinAsPlayer}>Join as player</button>
      <button class="btn-small btn-ghost w-full mt-2" onclick={() => joinOpen = false}>Just watch</button>
    </div>
  </div>
{/if}

<!-- Claim/sign-in Modal — inline PIN sign-in so you never leave the game -->
{#if authOpen}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onclick={(e) => { if (e.target === e.currentTarget) authOpen = false }}>
    <div class="card max-w-sm w-full rounded-t-2xl sm:rounded-[16px]" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-1">{authTab === 'login' ? 'Log in' : 'Claim your seat'}</h3>
      <p class="text-muted text-sm mb-3">{authTab === 'login' ? 'Sign in to link your seat and save your stats.' : 'Create an account to link your seat and keep your stats — just a name and a passcode.'}</p>
      <div class="flex gap-2 mb-3">
        <button class="btn-small flex-1 {authTab === 'signup' ? 'btn' : 'btn-secondary'}" onclick={() => authTab = 'signup'}>Create account</button>
        <button class="btn-small flex-1 {authTab === 'login' ? 'btn' : 'btn-secondary'}" onclick={() => authTab = 'login'}>Log in</button>
      </div>
      {#if authTab === 'login'}
        <input class="input mb-2" bind:value={authHandle} placeholder="Your name / @handle" maxlength="40" autocapitalize="none" autocomplete="username" enterkeyhint="next" />
        <input class="input mb-3" bind:value={authPin} type="password" inputmode="numeric" placeholder="Passcode" autocomplete="current-password" enterkeyhint="go" onkeydown={(e) => { if (e.key === 'Enter') submitAuth(); }} />
      {:else}
        <input class="input mb-2" bind:value={authName} placeholder="Your name" maxlength="40" autocapitalize="words" autocomplete="name" enterkeyhint="next" />
        <input class="input mb-3" bind:value={authPin} type="password" inputmode="numeric" placeholder="Choose a passcode (4+ digits)" autocomplete="new-password" enterkeyhint="go" onkeydown={(e) => { if (e.key === 'Enter') submitAuth(); }} />
      {/if}
      <button class="btn w-full" disabled={authBusy} onclick={submitAuth}>{authBusy ? 'Just a sec…' : (authTab === 'login' ? 'Log in & claim seat' : 'Create account & claim seat')}</button>
      <button class="btn-small btn-ghost w-full mt-2" onclick={oauthClaim}>More sign-in options (Google, Apple) →</button>
      <button class="btn-small btn-ghost w-full mt-1" onclick={() => authOpen = false}>Cancel</button>
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
