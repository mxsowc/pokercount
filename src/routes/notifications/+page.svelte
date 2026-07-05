<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { ago } from '$lib/utils/time';
  import { unreadCount } from '$lib/stores/notifications';

  let user = $derived($page.data?.user ?? null);
  let items = $state<any[]>([]);
  let loading = $state(true);

  onMount(async () => {
    if (!user) { loading = false; return; }
    try {
      const r = await fetch('/api/me/notifications');
      if (r.ok) items = (await r.json()).notifications || [];
    } catch { /* offline */ }
    loading = false;
    // Mark everything read now that they're on screen, and clear the nav badge.
    try {
      await fetch('/api/me/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      unreadCount.set(0);
    } catch { /* best effort */ }
  });

  const icon = (t: string) => (t === 'follow' ? '👤' : t === 'reaction' ? '👏' : t === 'comment' ? '💬' : t === 'award' ? '🏆' : '🔔');
  function href(n: any): string | null {
    if (n.type === 'follow' && n.actorHandle) return `/u/${n.actorHandle}`;
    if (n.gameCode) return `/game?g=${n.gameCode}`;
    return null;
  }
</script>

<svelte:head><title>Notifications · potcount</title></svelte:head>

<div class="wrap">
  <h1 class="text-2xl font-bold tracking-tight mt-4 mb-4" style="font-family:var(--font-display)">Notifications</h1>

  {#if !user}
    <div class="banner banner-info">Sign in to see your notifications. <a href="/account">Sign in</a></div>
  {:else if loading}
    <p class="text-muted">Loading…</p>
  {:else if items.length === 0}
    <div class="card text-center py-9">
      <div class="text-3xl mb-2" aria-hidden="true">🔔</div>
      <p class="font-semibold text-lg mb-1">Nothing yet</p>
      <p class="text-muted text-sm mb-5 max-w-[40ch] mx-auto">Follows, reactions, comments and end-of-night awards from your poker crew show up here.</p>
      <a href="/" class="btn inline-block no-underline">Open a game</a>
    </div>
  {:else}
    <div class="flex flex-col gap-1.5">
      {#each items as n (n.id)}
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
      {/each}
    </div>
  {/if}
</div>
