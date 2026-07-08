<script lang="ts">
  // SEO landing page targeting "poker counter" (and "poker chip counter" / "poker
  // money counter"). SSR so the full copy ships in the initial HTML for crawlers.
  // Distinct copy from /poker-chip-tracker and /home-game-poker to avoid near-duplicates.

  const TITLE = 'Poker Counter — Count Buy-ins, Chips & Who Owes Who, Free | potcount';
  const DESC = 'A free poker counter for home games: count every buy-in and top-up, keep a running pot total, and tally who owes who at the end — settled in the fewest payments. No app, no signup.';
  const PAGE_URL = 'https://potcount.com/poker-counter';

  const faq = [
    { q: 'What is a poker counter?', a: 'A poker counter keeps a running count of the money in a game — every buy-in, rebuy and top-up per player, the total pot on the table, and, at the end, how much each person is up or down. potcount does all of it automatically so nobody has to keep a tally on paper.' },
    { q: 'Is the poker counter free?', a: 'Yes — potcount is completely free. There is no app to install and no signup needed to start counting a game.' },
    { q: 'Does it count chips or money?', a: 'Both. Pick any unit when you open the game — euros, dollars, pounds, "chips", or "big blinds" — and it counts in that unit. You can even count purely in chips and settle the cash value later.' },
    { q: 'Can it count the pot as we play?', a: 'Yes. Every buy-in and top-up updates the running total live, so you always know how much is on the table and how much each player has put in.' },
    { q: 'How does it count who owes who at the end?', a: 'Enter each player\'s final chip count and it nets that against what they bought in for, then works out the smallest set of payments that settles everyone up — and tracks who has actually paid.' },
    { q: 'Can everyone count their own buy-ins?', a: 'Yes. Share the 4-digit code and each player adds their own buy-ins and top-ups on their phone, so the count stays right without one person tracking the whole table.' },
  ];
  const faqLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  })}<\/script>`;
</script>

<svelte:head>
  <title>{TITLE}</title>
  <meta name="description" content={DESC} />
  <link rel="canonical" href={PAGE_URL} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={TITLE} />
  <meta property="og:description" content={DESC} />
  <meta property="og:url" content={PAGE_URL} />
  <meta property="og:image" content="https://potcount.com/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  {@html faqLd}
</svelte:head>

<div class="wrap">
  <section class="pt-6 pb-2 text-center max-md:text-left">
    <p class="text-accent uppercase tracking-[0.18em] text-xs font-bold mb-3">Free · no signup · any unit</p>
    <h1 class="text-[clamp(2.2rem,8vw,3.4rem)] font-bold tracking-tight leading-tight mb-3" style="font-family: var(--font-display); letter-spacing: -0.03em;">
      The free poker counter for home games
    </h1>
    <p class="text-muted text-[1.05rem] max-w-[54ch] mx-auto max-md:mx-0 mb-6">
      Count every buy-in, keep a live <strong class="text-text">pot total</strong>, and tally exactly
      who's up, who's down and <strong class="text-text">who owes who</strong> — settled in the fewest
      payments. potcount is the "pot counter" that does the math for you. No app, no signup.
    </p>
    <div class="flex flex-col gap-2.5 w-full max-w-[400px] mx-auto max-md:mx-0">
      <a href="/?start=open" class="btn w-full py-[18px] text-[1.1rem] no-underline">Start counting — it's free</a>
      <a href="/pot" class="btn btn-secondary w-full py-[16px] no-underline">Just counting one pot? Use the split tool →</a>
    </div>
  </section>

  <section class="max-w-[680px] mx-auto mt-12">
    <h2 class="sub-label text-center mb-4">What it counts for you</h2>
    <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1 max-md:gap-2.5">
      <div class="bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5">
        <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">💰</div>
        <div>
          <div class="font-semibold text-sm">Buy-ins per player</div>
          <div class="text-muted text-xs mt-1 leading-snug">Every buy-in, rebuy and top-up, counted as you go.</div>
        </div>
      </div>
      <div class="bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5">
        <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🪙</div>
        <div>
          <div class="font-semibold text-sm">The live pot</div>
          <div class="text-muted text-xs mt-1 leading-snug">A running total of everything on the table, always up to date.</div>
        </div>
      </div>
      <div class="bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5">
        <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🧮</div>
        <div>
          <div class="font-semibold text-sm">Who owes who</div>
          <div class="text-muted text-xs mt-1 leading-snug">Final counts netted into the fewest payments to settle up.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="max-w-[680px] mx-auto mt-12">
    <h2 class="text-lg font-bold mb-3">Poker counter FAQ</h2>
    {#each faq as f}
      <div class="card !mb-2.5">
        <div class="font-semibold text-sm mb-1">{f.q}</div>
        <p class="text-muted text-sm">{f.a}</p>
      </div>
    {/each}
  </section>

  <section class="max-w-[400px] mx-auto mt-12 mb-10 text-center">
    <a href="/?start=open" class="btn w-full py-[18px] text-[1.1rem] no-underline">Open a game — free, no signup</a>
    <p class="text-muted text-xs mt-3">Also a <a href="/poker-chip-tracker">poker chip tracker</a> for <a href="/home-game-poker">home game poker</a>.</p>
  </section>
</div>
