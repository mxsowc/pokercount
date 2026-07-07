<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { ago } from '$lib/utils/time';
  import { toast } from '$lib/stores/toast';
  import { unreadCount } from '$lib/stores/notifications';

  let user = $derived($page.data?.user ?? null);
  let items = $state<any[]>([]);
  let loading = $state(true);
  let acting = $state<string | null>(null);

  onMount(async () => {
    if (!user) { loading = false; return; }
    try {
      const r = await fetch('/api/me/notifications');
      if (r.ok) items = (await r.json()).notifications || [];
    } catch { /* offline */ }
    loading = false;
    // Mark everything read now that they're on screen, and clear the nav badge.
    // (Read ≠ resolved — a debt action stays available until you tap it.)
    try {
      await fetch('/api/me/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      unreadCount.set(0);
    } catch { /* best effort */ }
  });

  const DEBT_TYPES = new Set(['debt_owe', 'debt_owed', 'debt_confirm', 'debt_confirmed']);
  const isDebt = (t: string) => DEBT_TYPES.has(t);
  const icon = (t: string) =>
    t === 'follow' ? '👤' : t === 'reaction' ? '👏' : t === 'comment' ? '💬' : t === 'award' ? '🏆'
    : t === 'game_message' ? '💬'
    : t === 'debt_owe' ? '💸' : t === 'debt_owed' ? '💰' : t === 'debt_confirm' ? '🤝' : t === 'debt_confirmed' ? '✅'
    : '🔔';

  function href(n: any): string | null {
    if (n.type === 'follow' && n.actorHandle) return `/u/${n.actorHandle}`;
    if (n.gameCode) return `/game?g=${n.gameCode}`;
    return null;
  }

  // Act on a debt notification by driving the existing settlement endpoint:
  // "already paid?" marks the transfer paid (the receiver is then asked to
  // confirm); "already received?" confirms receipt (settles that leg outright).
  async function act(n: any, kind: 'paid' | 'confirmed') {
    if (acting) return;
    if (!n.gameId || !n.transferId) { toast('This reminder is missing its payment link'); return; }
    acting = n.id;
    const body = kind === 'paid' ? { paid: true } : { confirmed: true };
    try {
      const r = await fetch(`/api/games/${n.gameId}/settlement/${n.transferId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast(d.error || 'Could not update'); return; }
      items = items.filter((x) => x.id !== n.id);
      toast(kind === 'paid' ? "Marked as paid — they'll confirm they got it" : 'Marked settled ✓');
    } catch { toast('Could not reach the server'); }
    finally { acting = null; }
  }

  function dismiss(n: any) { items = items.filter((x) => x.id !== n.id); }
</script>

<svelte:head><title>Notifications · potcount</title></svelte:head>

<div class="wrap">
  <h1 class="text-2xl font-bold tracking-tight mt-4 mb-4 font-display">Notifications</h1>

  {#if !user}
    <div class="banner banner-info">Sign in to see your notifications. <a href="/account">Sign in</a></div>
  {:else if loading}
    <p class="text-muted">Loading…</p>
  {:else if items.length === 0}
    <div class="card text-center py-9">
      <div class="text-3xl mb-2" aria-hidden="true">🔔</div>
      <p class="font-semibold text-lg mb-1">Nothing yet</p>
      <p class="text-muted text-sm mb-5 max-w-[40ch] mx-auto">Follows, reactions, comments, end-of-night awards and unpaid-debt reminders from your poker crew show up here.</p>
      <a href="/" class="btn inline-block no-underline">Open a game</a>
    </div>
  {:else}
    <div class="flex flex-col gap-1.5">
      {#each items as n (n.id)}
        {#if isDebt(n.type)}
          <!-- Debt reminder / confirmation — actionable inline -->
          <div class="flex gap-3 p-3 rounded-xl border {n.read ? 'border-border-soft bg-surface' : 'border-accent/30 bg-accent/[.06]'}">
            <span class="text-xl shrink-0 mt-0.5" aria-hidden="true">{icon(n.type)}</span>
            <div class="min-w-0 flex-1">
              <div class="text-sm">
                {n.text || `${n.actorName} ${n.type}`}
                {#if n.gameCode}<a href="/game?g={n.gameCode}" class="text-muted no-underline hover:underline"> · #{n.gameCode}</a>{/if}
                <span class="text-faint text-xs"> · {ago(n.at)}</span>
              </div>

              {#if n.type === 'debt_owe'}
                <div class="flex gap-2 mt-2">
                  <button class="btn-small btn" disabled={acting === n.id} onclick={() => act(n, 'paid')}>Already paid?</button>
                  <a href="/game?g={n.gameCode}" class="btn-small btn-secondary no-underline">Open settle-up</a>
                </div>
              {:else if n.type === 'debt_owed' || n.type === 'debt_confirm'}
                <div class="flex gap-2 mt-2">
                  <button class="btn-small btn" disabled={acting === n.id} onclick={() => act(n, 'confirmed')}>Already received?</button>
                  <button class="btn-small btn-ghost" disabled={acting === n.id} onclick={() => dismiss(n)}>Not yet</button>
                </div>
                {#if n.type === 'debt_confirm'}
                  <p class="text-xs text-faint mt-1.5">Confirming counts it toward {n.actorName}'s payment record.</p>
                {/if}
              {/if}
            </div>
          </div>
        {:else}
          {@const link = href(n)}
          <svelte:element this={link ? 'a' : 'div'} href={link ?? undefined}
            class="flex items-center gap-3 p-3 rounded-xl border no-underline text-text {n.read ? 'border-border-soft bg-surface' : 'border-accent/30 bg-accent/[.06]'} {link ? 'hover:border-border active:scale-[.99] transition-transform' : ''}">
            <span class="text-xl shrink-0" aria-hidden="true">{icon(n.type)}</span>
            <span class="min-w-0 flex-1 text-sm">
              <b>{n.actorName}</b> {n.text}
              {#if n.gameCode && n.type !== 'follow'}<span class="text-muted"> · #{n.gameCode}</span>{/if}
            </span>
            <span class="text-faint text-xs shrink-0">{ago(n.at)}</span>
          </svelte:element>
        {/if}
      {/each}
    </div>
  {/if}
</div>
