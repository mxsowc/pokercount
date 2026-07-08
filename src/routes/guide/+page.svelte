<script lang="ts">
  let { data } = $props();
  const guides = $derived(data.guides as { slug: string; emoji: string; title: string; tagline: string; description: string; readMins: number }[]);
</script>

<svelte:head>
  <link rel="canonical" href="https://potcount.com/guide" />
</svelte:head>

<div class="wrap">
  <header class="pt-6 pb-2 text-center max-md:text-left">
    <p class="text-accent uppercase tracking-[0.18em] text-xs font-bold mb-3">Guides</p>
    <h1 class="text-[clamp(2rem,7vw,3rem)] font-bold tracking-tight leading-tight mb-3" style="font-family: var(--font-display); letter-spacing: -0.03em;">
      Everything potcount does, explained
    </h1>
    <p class="text-muted text-[1.05rem] max-w-[54ch] mx-auto max-md:mx-0 mb-2">
      No manual energy. Just short, straight walkthroughs of how to run a home poker night —
      from the first buy-in to the last "yep, got your Tikkie".
    </p>
  </header>

  <div class="grid gap-3 sm:grid-cols-2 mt-8">
    {#each guides as g (g.slug)}
      <a href="/guide/{g.slug}" class="card !mb-0 no-underline text-text hover:border-accent/50 transition-colors flex gap-3.5 items-start">
        <span class="text-2xl shrink-0 leading-none mt-0.5">{g.emoji}</span>
        <span class="min-w-0">
          <span class="font-bold block">{g.title}</span>
          <span class="text-muted text-sm block mt-1">{g.tagline}</span>
          <span class="text-faint text-xs block mt-2">{g.readMins} min read</span>
        </span>
      </a>
    {/each}
  </div>

  <div class="card mt-8 text-center">
    <h2 class="text-base font-bold m-0">Ready to run one?</h2>
    <p class="text-muted mt-1.5 mb-3">Open a game and share one code — the whole table keeps its own score.</p>
    <a href="/?start=open" class="btn no-underline inline-block">Start a home game — free</a>
  </div>
</div>
