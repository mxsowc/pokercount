<script lang="ts">
  import { page } from '$app/stores';
  import { toast } from '$lib/stores/toast';
  import { browser } from '$app/environment';
  import PublicGameCard from '$lib/components/PublicGameCard.svelte';

  let { data } = $props();
  const game = $derived(data.game);
  const user = $derived($page.data?.user ?? null);

  function copyLink() {
    if (!browser) return;
    navigator.clipboard.writeText(location.href)
      .then(() => toast('Link copied — paste it in your group chat'))
      .catch(() => {});
  }
</script>

<svelte:head>
  <title>{data.meta.title}</title>
  <meta name="description" content={data.meta.description} />
  <meta property="og:title" content={data.meta.title} />
  <meta property="og:description" content={data.meta.description} />
</svelte:head>

<div class="wrap" style="max-width:32rem">
  <div class="flex items-center justify-between gap-2 mb-4">
    <h1 class="text-xl font-bold m-0">Open home game</h1>
    <button class="btn-small btn-ghost" onclick={copyLink}>Copy link</button>
  </div>

  <PublicGameCard {game} {user} backTo={`/g/${game.id}`} />

  {#if game.citySlug}
    <p class="text-center mt-4">
      <a href="/homegames/{game.citySlug}" class="text-sm">← More games in {game.city}</a>
    </p>
  {/if}
  <p class="text-muted text-xs text-center mt-4">
    potcount keeps score for the whole table and tracks every player's record — free, nothing to install.
  </p>
</div>
