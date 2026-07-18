<script lang="ts">
  let { data } = $props();
  const cities = $derived(
    data.cities as { slug: string; label: string; players: number; games: number }[]
  );
</script>

<svelte:head>
  <link rel="canonical" href="https://potcount.com/homegames" />
</svelte:head>

<div class="wrap">
  <header class="mb-6">
    <h1 class="text-2xl font-extrabold font-display m-0">Find a home poker game near you</h1>
    <p class="text-muted mt-2 max-w-[52ch]">
      Home games, by city. See the local players on potcount, then find an open table
      or start your own — keep score for the whole table and track everyone's record over time.
    </p>
  </header>

  {#if cities.length}
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Cities</h2>
    <div class="grid gap-2.5 sm:grid-cols-2">
      {#each cities as c (c.slug)}
        <a href="/homegames/{c.slug}"
           class="transfer-row no-underline text-text hover:border-border">
          <span class="font-semibold truncate">{c.label}</span>
          <span class="ml-auto flex items-center gap-2 shrink-0">
            {#if c.games > 0}
              <span class="pill !border-accent/45 text-accent tabular-nums">{c.games} open</span>
            {/if}
            <span class="text-muted text-sm tabular-nums">
              {c.players} player{c.players === 1 ? '' : 's'}
            </span>
          </span>
        </a>
      {/each}
    </div>
  {:else}
    <div class="card">
      <p class="m-0">No cities yet — be the first. <a href="/?host=open" class="text-accent">Start a home game</a> and set your city on your profile to put your town on the map.</p>
    </div>
  {/if}

  <div class="card mt-8">
    <h2 class="text-base font-bold m-0">Hosting one?</h2>
    <p class="text-muted mt-1.5 mb-3">Open a table, share one code, and everyone keeps their own score. Social play, blinds only.</p>
    <a href="/?host=open" class="btn no-underline inline-block">Start a home game</a>
  </div>
</div>
