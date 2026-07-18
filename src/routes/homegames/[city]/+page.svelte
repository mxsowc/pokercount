<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fmtSigned } from '$lib/utils/money';
  import CityPicker from '$lib/components/CityPicker.svelte';
  import PublicGameCard from '$lib/components/PublicGameCard.svelte';
  import { citySlug } from '$lib/cities.js';

  let { data } = $props();

  // Browse another city: type/pick a city and jump to its directory page.
  let searchCity = $state('');
  function goCity(e: Event) {
    e.preventDefault();
    const c = searchCity.trim();
    if (c) goto(`/homegames/${citySlug(c)}`);
  }
  const label = $derived(data.label as string);
  const slug = $derived(data.slug as string);
  // Directory is data-minimised: handle only (no real name / photo on the indexed
  // page). Full profile is one click deeper at /u/[handle].
  const playerCount = $derived((data.playerCount ?? 0) as number);
  const topPlayers = $derived(
    (data.topPlayers ?? null) as { rank: number; handle: string; net: number; games: number; you: boolean }[] | null
  );
  const openGames = $derived(
    (data.openGames ?? []) as { id: string; name: string; seated: number; maxPlayers: number; minBuyIn: number; maxBuyIn: number; blinds: { small: number; big: number } | null; scheduledFor: string | null; host: { handle: string; displayName: string; avatar: string | null } | null; roster: { name: string; handle: string | null }[]; note?: string | null; youRequested?: boolean; youSeated?: boolean }[]
  );
  const indexable = $derived(data.indexable as boolean);
  const user = $derived($page.data?.user ?? null);

  const canonical = $derived(`https://potcount.com/homegames/${slug}`);

  const faqs = $derived([
    {
      q: `How do I find a home poker game in ${label}?`,
      a: `Browse the local players below, follow the ones you know, and join their next game with a single code. If there isn't a game running yet, start one — it's free.`,
    },
    {
      q: `Is potcount free?`,
      a: `Yes. potcount keeps score for the whole table and tracks each player's record over time. There's nothing to install and no account needed to join a game.`,
    },
    {
      q: `Can I host my own home game in ${label}?`,
      a: `Absolutely. Open a table, share one code with your friends, and everyone keeps their own score in real time. Social play, blinds only.`,
    },
  ]);

  // Structured data: breadcrumb + the roster as an ItemList + the FAQ. Serialized
  // with < escaped so a display name can never break out of the <script> tag.
  const jsonLd = $derived(
    '<' + 'script type="application/ld+json">' +
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home games', item: 'https://potcount.com/homegames' },
            { '@type': 'ListItem', position: 2, name: label, item: canonical },
          ],
        },
        {
          '@type': 'CollectionPage',
          name: `Home Poker Games in ${label}`,
          url: canonical,
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: playerCount,
          },
        },
        {
          '@type': 'FAQPage',
          mainEntity: faqs.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        },
      ],
    }).replace(/</g, '\\u003c') +
    '<' + '/script>'
  );
</script>

<svelte:head>
  <link rel="canonical" href={canonical} />
  {#if !indexable}
    <!-- Thin until this city fills in — crawlable, but kept out of the index. -->
    <meta name="robots" content="noindex, follow" />
  {/if}
  {@html jsonLd}
</svelte:head>

<div class="wrap">
  <nav class="text-sm text-muted mb-3">
    <a href="/homegames" class="hover:text-text">Home games</a>
    <span class="mx-1.5 text-faint">/</span>
    <span class="text-text">{label}</span>
  </nav>

  <header class="mb-6">
    <h1 class="text-2xl font-extrabold font-display m-0">Home Poker Games in {label}</h1>
    <p class="text-muted mt-2 max-w-[54ch]">
      {#if playerCount}
        {playerCount} local player{playerCount === 1 ? '' : 's'} on potcount. Find a home game,
        follow the regulars, or start your own table — free, nothing to install.
      {:else}
        No players in {label} yet. Be the first: start a home game and set {label} as your
        city, and this becomes the place locals find you.
      {/if}
    </p>
  </header>

  <!-- Browse a different city -->
  <form class="flex gap-2 mb-8" onsubmit={goCity}>
    <div class="flex-1"><CityPicker bind:value={searchCity} placeholder="Browse another city — e.g. Berlin" /></div>
    <button class="btn btn-secondary shrink-0 no-underline" type="submit">Browse →</button>
  </form>

  {#if openGames.length}
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Open games in {label}</h2>
    <div class="grid gap-2.5 mb-8">
      {#each openGames as g (g.id)}
        <PublicGameCard game={g} {user} backTo={`/homegames/${slug}`} />
      {/each}
    </div>
  {/if}

  {#if playerCount}
    <div class="flex items-baseline justify-between gap-2 mb-3">
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Ranking in {label}</h2>
      <span class="text-faint text-xs">{playerCount} player{playerCount === 1 ? '' : 's'}</span>
    </div>
    {#if topPlayers}
      {#if topPlayers.length}
        <div class="flex flex-col gap-2">
          {#each topPlayers as p (p.handle)}
            <a href="/u/{p.handle}" class="player-row no-underline text-text hover:border-border {p.you ? '!border-accent' : ''}">
              <div class="flex items-center gap-3 min-w-0">
                <span class="w-6 text-center font-bold tabular-nums shrink-0 {p.rank <= 3 ? 'text-base' : 'text-muted'}">{p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank}</span>
                <div class="min-w-0">
                  <div class="font-semibold text-[.95rem] truncate">@{p.handle}{#if p.you}<span class="text-muted font-normal"> · you</span>{/if}</div>
                  <div class="text-muted text-xs">{p.games} game{p.games === 1 ? '' : 's'}</div>
                </div>
              </div>
              <div class="font-extrabold tabular-nums shrink-0 {p.net >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(p.net)}</div>
            </a>
          {/each}
        </div>
        <p class="text-faint text-xs mt-3">Top {topPlayers.length} by all-time profit (in €). Only the top 10 are shown.</p>
      {:else}
        <p class="text-muted text-sm">No ranked players in {label} yet — play a game to get on the board.</p>
      {/if}
    {:else}
      <div class="card">
        <p class="text-muted text-sm m-0"><a href="/account?next=/homegames/{slug}">Sign in</a> to see the top-10 ranking for {label}.</p>
      </div>
    {/if}
  {/if}

  <div class="card mt-8">
    <h2 class="text-base font-bold m-0">Host a game in {label}</h2>
    <p class="text-muted mt-1.5 mb-3">Open a table, share one code, and everyone keeps their own score in real time.</p>
    <a href="/?host=open&city={encodeURIComponent(label)}" class="btn no-underline inline-block">Start a home game</a>
  </div>

  <section class="mt-8">
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Questions</h2>
    {#each faqs as f (f.q)}
      <div class="card !mb-2.5">
        <h3 class="text-base font-semibold m-0">{f.q}</h3>
        <p class="text-muted mt-1.5 mb-0">{f.a}</p>
      </div>
    {/each}
  </section>
</div>
