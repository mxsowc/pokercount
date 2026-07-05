<script lang="ts">
  // SEO landing page targeting "poker chip tracker". Server-rendered (the root
  // layout reads the session cookie, so the tree is dynamic, not prerendered) —
  // SSR still ships the full copy in the initial HTML for crawlers. Reuses the
  // app's design system; the CTA deep-links into the home page's "Open a game" form.

  const TITLE = 'Poker Chip Tracker — Track Buy-ins & Settle Up Free | potcount';
  const DESC = 'Free poker chip tracker for home games. Track every buy-in, rebuy and top-up, then see exactly who pays who in the fewest payments. No app to install, no signup.';
  const PAGE_URL = 'https://potcount.com/poker-chip-tracker';

  // FAQ structured data → eligible for rich results / "People also ask".
  const faq = [
    { q: 'Is the poker chip tracker free?', a: 'Yes — potcount is completely free, with no app to install and no signup required to start tracking a game.' },
    { q: 'How does it work out who pays who?', a: 'When the game ends you enter each player\'s final chip count. potcount nets every buy-in and top-up against the final stacks and works out the smallest set of payments that settles everyone up.' },
    { q: 'Can other players add their own buy-ins?', a: 'Yes. Share the 4-digit game code and anyone at the table can add their own buy-ins and top-ups on their phone — the host doesn\'t have to track everyone.' },
    { q: 'Does it work for cash games and any currency?', a: 'It works for any home cash game and any unit — euros, dollars, pounds, or even "chips" or "big blinds". You pick the unit when you open the game.' },
    { q: 'Do I need to create an account?', a: 'No. You can track and settle a whole game without an account. Signing in is optional — it just saves your results, stats and profit history over time.' },
    { q: 'Does everyone at the table need to download an app?', a: 'No — there is nothing to download. potcount runs in the browser. The host opens a game and shares a short code, link or QR; everyone else just taps it to join and add their own buy-ins. No app, no signup required.' },
    { q: 'How is it different from Splitwise?', a: 'Splitwise splits shared bills evenly between people. potcount is built for poker: it tracks live buy-ins and top-ups through the night, then nets each player\'s final chip count against what they put in and works out who pays who in the fewest payments — the exact settlement a bill-splitter can\'t do.' },
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
  <!-- Hero -->
  <section class="pt-6 pb-2 text-center max-md:text-left">
    <p class="text-accent uppercase tracking-[0.18em] text-xs font-bold mb-3">Free · no signup · any currency</p>
    <h1 class="text-[clamp(2.2rem,8vw,3.4rem)] font-bold tracking-tight leading-tight mb-3" style="font-family: var(--font-display); letter-spacing: -0.03em;">
      The free poker chip tracker for home games
    </h1>
    <p class="text-muted text-[1.05rem] max-w-[52ch] mx-auto max-md:mx-0 mb-6">
      Log every buy-in, rebuy and top-up as you play — then at the end potcount works out exactly
      <strong class="text-text">who pays who</strong>, in the fewest payments. No app to install, no signup.
    </p>
    <div class="flex flex-col gap-2.5 w-full max-w-[400px] mx-auto max-md:mx-0">
      <a href="/?start=open" class="btn w-full py-[18px] text-[1.1rem] no-underline">Start tracking — it's free</a>
      <a href="/pot" class="btn btn-secondary w-full py-[16px] no-underline">Just splitting one pot? Use the split tool →</a>
    </div>
  </section>

  <!-- How it works -->
  <section class="max-w-[680px] mx-auto mt-12">
    <h2 class="sub-label text-center mb-4">How the chip tracker works</h2>
    <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1 max-md:gap-2.5">
      <div class="bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5">
        <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🎴</div>
        <div>
          <div class="font-semibold text-sm">Open a game</div>
          <div class="text-muted text-xs mt-1 leading-snug">Name it, pick your currency, get a 4-digit code.</div>
        </div>
      </div>
      <div class="bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5">
        <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">💰</div>
        <div>
          <div class="font-semibold text-sm">Track every chip</div>
          <div class="text-muted text-xs mt-1 leading-snug">Add buy-ins &amp; top-ups as you play — or share the code so players add their own.</div>
        </div>
      </div>
      <div class="bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5">
        <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🧮</div>
        <div>
          <div class="font-semibold text-sm">Settle up</div>
          <div class="text-muted text-xs mt-1 leading-snug">Enter final stacks and it shows who pays who in the fewest payments.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Why potcount -->
  <section class="max-w-[680px] mx-auto mt-12">
    <h2 class="text-lg font-bold mb-3">Why use potcount to track your chips?</h2>
    <div class="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">🧮 Automatic settlement</div>
        <p class="text-muted text-xs">No more arguing over who owes who. It nets every buy-in against final stacks and gives the fewest payments to square up.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">📲 No app, no signup</div>
        <p class="text-muted text-xs">Runs in the browser on any phone. Start tracking instantly — an account is optional and only saves your history.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">👥 Everyone adds their own</div>
        <p class="text-muted text-xs">Share the code and each player logs their own buy-ins — the host doesn't have to keep score for the whole table.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">📈 Stats &amp; profiles</div>
        <p class="text-muted text-xs">Sign in to keep a running profit history, win/loss streaks and best-night records across all your games.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">💶 Any currency or unit</div>
        <p class="text-muted text-xs">Euros, dollars, pounds — or "chips" and "big blinds". Pick the unit when you open the game.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">🔗 Lives on the server</div>
        <p class="text-muted text-xs">Anyone with the code can keep adding and settle later, even after the host closes the app.</p>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="max-w-[680px] mx-auto mt-12">
    <h2 class="text-lg font-bold mb-3">Poker chip tracker FAQ</h2>
    {#each faq as f}
      <div class="card !mb-2.5">
        <div class="font-semibold text-sm mb-1">{f.q}</div>
        <p class="text-muted text-sm">{f.a}</p>
      </div>
    {/each}
  </section>

  <!-- Final CTA -->
  <section class="max-w-[400px] mx-auto mt-12 mb-10 text-center">
    <a href="/?start=open" class="btn w-full py-[18px] text-[1.1rem] no-underline">Open a game — free, no signup</a>
    <p class="text-muted text-xs mt-3">Already have a code? <a href="/">Join a game →</a></p>
  </section>
</div>
