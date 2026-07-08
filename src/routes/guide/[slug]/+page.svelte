<script lang="ts">
  let { data } = $props();
  const guide = $derived(data.guide as any);
  const prev = $derived(data.prev as { slug: string; title: string; emoji: string } | null);
  const next = $derived(data.next as { slug: string; title: string; emoji: string } | null);

  const canonical = $derived(`https://potcount.com/guide/${guide.slug}`);

  // Article + FAQ structured data. < is escaped so authored copy can't break the
  // <script> tag. The guide content is trusted (authored, not user input).
  const jsonLd = $derived(
    '<' + 'script type="application/ld+json">' +
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          headline: guide.title,
          description: guide.description,
          url: canonical,
          mainEntityOfPage: canonical,
          publisher: { '@type': 'Organization', name: 'potcount', url: 'https://potcount.com' },
        },
        ...(guide.faq?.length
          ? [{
              '@type': 'FAQPage',
              mainEntity: guide.faq.map((f: any) => ({
                '@type': 'Question', name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a },
              })),
            }]
          : []),
      ],
    }).replace(/</g, '\\u003c') +
    '<' + '/script>'
  );
</script>

<svelte:head>
  <link rel="canonical" href={canonical} />
  {@html jsonLd}
</svelte:head>

<div class="wrap">
  <nav class="text-sm text-muted mb-3">
    <a href="/guide" class="hover:text-text">Guides</a>
    <span class="mx-1.5 text-faint">/</span>
    <span class="text-text">{guide.title}</span>
  </nav>

  <header class="mb-8">
    <div class="text-4xl mb-2">{guide.emoji}</div>
    <h1 class="text-[clamp(1.9rem,6vw,2.6rem)] font-extrabold font-display leading-tight m-0">{guide.title}</h1>
    <p class="text-muted text-lg mt-2">{guide.tagline}</p>
    <p class="text-faint text-xs mt-2">{guide.readMins} min read</p>
  </header>

  {#each guide.sections as s}
    <section class="mb-8">
      <h2 class="text-lg font-bold mb-3">{s.h}</h2>
      {#each s.blocks as b}
        {#if b.sub}
          <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mt-4 mb-1.5">{b.sub}</h3>
        {:else if b.p}
          <p class="text-[1.02rem] leading-relaxed text-text/90 mb-3">{@html b.p}</p>
        {:else if b.steps}
          <ol class="list-decimal pl-5 space-y-1.5 mb-3 text-text/90 marker:text-accent marker:font-bold">
            {#each b.steps as step}<li class="pl-1 leading-relaxed">{@html step}</li>{/each}
          </ol>
        {:else if b.tip}
          <div class="card !mb-3 !border-accent/30 flex gap-2.5">
            <span class="shrink-0">💡</span><p class="m-0 text-sm text-text/90">{@html b.tip}</p>
          </div>
        {:else if b.note}
          <p class="text-muted text-sm mb-3 pl-3 border-l-2 border-border-soft">{@html b.note}</p>
        {/if}
      {/each}
    </section>
  {/each}

  {#if guide.faq?.length}
    <section class="mb-8">
      <h2 class="text-lg font-bold mb-3">FAQ</h2>
      {#each guide.faq as f}
        <div class="card !mb-2.5">
          <div class="font-semibold text-sm mb-1">{f.q}</div>
          <p class="text-muted text-sm m-0">{f.a}</p>
        </div>
      {/each}
    </section>
  {/if}

  <!-- CTA -->
  <div class="card text-center !border-accent/25">
    <p class="font-semibold m-0">Enough reading — deal a hand.</p>
    <a href="/?start=open" class="btn no-underline inline-block mt-3">Start a home game — free</a>
  </div>

  <!-- Keep reading -->
  {#if prev || next}
    <div class="grid gap-2.5 sm:grid-cols-2 mt-6">
      {#if prev}
        <a href="/guide/{prev.slug}" class="transfer-row no-underline text-text hover:border-border">
          <span class="text-muted text-xs shrink-0">← Previous</span>
          <span class="ml-auto font-semibold truncate text-right">{prev.emoji} {prev.title}</span>
        </a>
      {/if}
      {#if next}
        <a href="/guide/{next.slug}" class="transfer-row no-underline text-text hover:border-border">
          <span class="text-muted text-xs shrink-0">Next →</span>
          <span class="ml-auto font-semibold truncate text-right">{next.emoji} {next.title}</span>
        </a>
      {/if}
    </div>
  {/if}

  <p class="text-center mt-6"><a href="/guide" class="text-muted text-sm hover:text-text">← All guides</a></p>
</div>
