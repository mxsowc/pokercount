<script lang="ts">
  // One open-game card, shared by the city directory and the /g/[id] share page.
  // Owns the request-to-join flow, including the mid-flow "create an account to
  // send" step for signed-out visitors (the request is stashed and auto-sent
  // after they sign up — see pc_pending_join).
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';

  let { game, user, backTo = '' }: { game: any; user: any; backTo?: string } = $props();

  // Coming back from the mid-flow signup: if a request was stashed for THIS game
  // and we're now signed in, finish it automatically (once), then clear it.
  onMount(() => {
    if (!browser || !user) return;
    try {
      const pend = JSON.parse(localStorage.getItem('pc_pending_join') || 'null');
      if (pend && pend.gameId === game.id) {
        localStorage.removeItem('pc_pending_join');
        if (!game.youSeated && !game.youRequested && !game.youRejected) send(pend.message || '');
      }
    } catch {}
  });

  const seatsLabel = (g: any) => (g.maxPlayers > 0 ? `${g.seated}/${g.maxPlayers} seats` : `${g.seated} seated`);
  const buyInLabel = (g: any) => (!g.minBuyIn ? '' : g.maxBuyIn > 0 ? `${g.minBuyIn}–${g.maxBuyIn} blinds` : `${g.minBuyIn} blinds`);

  // 'idle' | 'form' | 'busy' | 'sent' | 'seated' | 'rejected' | error string
  let state = $state<string>('idle');
  let message = $state('');
  const status = $derived(
    state !== 'idle' ? state
      : game.youSeated ? 'seated'
      : game.youRequested ? 'sent'
      : game.youRejected ? 'rejected'
      : 'idle'
  );

  // Where to come back to after a mid-flow signup (so the pending request auto-sends).
  const returnTo = $derived(backTo || (browser ? location.pathname + location.search : `/g/${game.id}`));

  async function send(msg: string) {
    state = 'busy';
    try {
      const res = await fetch(`/api/games/${game.id}/join-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not send request');
      state = 'sent';
      return true;
    } catch (e: any) { state = e.message || 'Could not send request'; return false; }
  }

  // Signed-out: stash the request, then bounce to signup; it auto-sends on return.
  function startRequest() {
    if (!user) { state = 'form'; return; }
    state = 'form';
  }
  async function submitRequest() {
    if (!user) {
      if (browser) localStorage.setItem('pc_pending_join', JSON.stringify({ gameId: game.id, message: message.trim() }));
      // Send them to sign up, returning here to finish automatically.
      location.href = `/account?next=${encodeURIComponent(returnTo)}`;
      return;
    }
    await send(message.trim());
  }
</script>

<div class="card !mb-0">
  <div class="flex items-center gap-2 flex-wrap">
    <span class="font-semibold truncate">{game.name}</span>
    {#if game.format}<span class="pill shrink-0 font-semibold">{game.format}</span>{/if}
    {#if game.blinds}<span class="pill !border-accent/45 text-accent shrink-0 tabular-nums">{game.blinds.small}/{game.blinds.big} blinds</span>{/if}
    {#if game.scheduledFor}<span class="pill shrink-0">scheduled</span>{/if}
  </div>

  <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted mt-2 tabular-nums">
    <span>{seatsLabel(game)}</span>
    {#if game.minBuyIn > 0}<span>Buy-in: {buyInLabel(game)}</span>{/if}
    {#if game.city}<span>{game.city}</span>{/if}
  </div>

  {#if game.note}
    <p class="text-sm text-muted mt-2 whitespace-pre-wrap">{game.note}</p>
  {/if}

  <!-- Group settle-up speed: aggregate only, private profiles excluded, ≥2 players. -->
  {#if game.settle}
    <div class="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold
                {game.settle.level === 'green' ? 'text-win' : game.settle.level === 'yellow' ? 'text-[#f3cd6b]' : 'text-danger'}"
         title="Average time these players take to settle up after a game — {game.settle.count} players counted">
      <span>⏱</span><span>Settles up in ~{game.settle.avgDays}d on average</span>
    </div>
  {/if}

  {#if game.host}
    <div class="flex items-center gap-2 mt-3 pt-3 border-t border-border-soft">
      {#if game.host.avatar}<img src={game.host.avatar} alt="" class="w-6 h-6 rounded-full shrink-0" referrerpolicy="no-referrer" />{/if}
      <span class="text-sm text-muted">Hosted by <a href="/u/{game.host.handle}" class="text-text font-semibold hover:text-accent">{game.host.displayName}</a></span>
    </div>
  {/if}

  {#if game.roster?.length}
    <div class="flex flex-wrap gap-1.5 mt-2">
      {#each game.roster as p}
        {#if p.handle}<a href="/u/{p.handle}" class="pill no-underline hover:border-accent/50">@{p.handle}</a>
        {:else}<span class="pill">{p.name}</span>{/if}
      {/each}
    </div>
  {/if}

  <!-- Join action -->
  <div class="mt-3">
    {#if status === 'seated'}
      <span class="text-win text-sm font-semibold">✓ You're in this game.</span>
    {:else if status === 'sent'}
      <span class="text-win text-sm font-semibold">✓ Request sent — the host will decide.</span>
    {:else if status === 'rejected'}
      <span class="text-muted text-sm">The host declined a previous request, so you can't request this game again.</span>
    {:else if status === 'form'}
      <div class="flex flex-col gap-2">
        <textarea class="input text-sm min-h-[60px] resize-y" bind:value={message} maxlength="200"
          placeholder="Add a note for the host (optional) — e.g. how you play, who you know"></textarea>
        <div class="flex gap-2">
          <button class="btn-small btn" onclick={submitRequest}>{user ? 'Send request' : 'Create account & send'}</button>
          <button class="btn-small btn-ghost" onclick={() => (state = 'idle')}>Cancel</button>
        </div>
        {#if !user}<p class="text-xs text-faint">You'll make a quick account to send it — your note is kept and sent automatically.</p>{/if}
      </div>
    {:else}
      <button class="btn-small btn" disabled={status === 'busy'} onclick={startRequest}>
        {status === 'busy' ? 'Sending…' : 'Request to join'}
      </button>
      {#if status !== 'idle' && status !== 'busy'}<span class="text-danger text-sm ml-2">{status}</span>{/if}
    {/if}
  </div>
</div>
