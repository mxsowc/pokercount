<script lang="ts">
  // SEO landing page targeting "home game poker". SSR (the root layout reads the
  // session cookie, so the tree is dynamic, not prerendered) — the full copy still
  // ships in the initial HTML for crawlers. Distinct copy from /poker-chip-tracker
  // and /poker-counter so these aren't near-duplicate pages.

  const TITLE = 'Home Game Poker — Run, Track & Settle Your Poker Night Free | potcount';
  const DESC = 'The free home game poker app: track every buy-in and top-up, work out who pays who in the fewest payments, keep everyone\'s stats over time, and find local home games by city. No app, no signup.';
  const PAGE_URL = 'https://potcount.com/home-game-poker';

  const faq = [
    { q: 'What is the best app for a home game of poker?', a: 'potcount is built specifically for home game poker: it tracks live buy-ins and top-ups, settles who pays who in the fewest payments, keeps a profit history for each player, and even lets you list a game so local players can find it. It runs in the browser with no app to install.' },
    { q: 'How do you keep track of money in a home poker game?', a: 'Open a game in potcount, share the 4-digit code with the table, and everyone logs their own buy-ins and top-ups on their phone. At the end you enter each player\'s final stack and potcount nets it all out — no notebook, no mental math.' },
    { q: 'How does it decide who pays who?', a: 'When the night ends it compares what each player put in against their final chips, then computes the smallest set of transfers that squares everyone up. It also tracks who has paid and who still owes, and nudges people who forget.' },
    { q: 'Is home game poker legal?', a: 'A private home game between people who know each other is legal in most places, but rules vary by country and region — you are responsible for making sure your game is lawful where you live. potcount is a scorekeeping tool; it never handles money or stakes.' },
    { q: 'Can I find local home games near me?', a: 'Yes — hosts can list a game publicly in their city, so you can browse open home games and request a seat. See the home-games directory by city.' },
    { q: 'Do all the players need an account?', a: 'No. Anyone can join a game with the code and add their own buy-ins without signing up. An account is optional — it just saves your stats, profit history and streaks across games.' },
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
    <p class="text-accent uppercase tracking-[0.18em] text-xs font-bold mb-3">Free · no signup · any stakes</p>
    <h1 class="text-[clamp(2.2rem,8vw,3.4rem)] font-bold tracking-tight leading-tight mb-3" style="font-family: var(--font-display); letter-spacing: -0.03em;">
      The free app for home game poker
    </h1>
    <p class="text-muted text-[1.05rem] max-w-[54ch] mx-auto max-md:mx-0 mb-6">
      Run your <strong class="text-text">home game poker</strong> night without the notebook: track every
      buy-in, settle up who pays who in the fewest payments, keep everyone's stats over time, and find
      local games near you. No app to install, no signup.
    </p>
    <div class="flex flex-col gap-2.5 w-full max-w-[400px] mx-auto max-md:mx-0">
      <a href="/?start=open" class="btn w-full py-[18px] text-[1.1rem] no-underline">Start your poker night — free</a>
      <a href="/homegames" class="btn btn-secondary w-full py-[16px] no-underline">Find local home games by city →</a>
    </div>
  </section>

  <section class="max-w-[680px] mx-auto mt-12">
    <h2 class="sub-label text-center mb-4">Everything a home poker game needs</h2>
    <div class="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">💰 Live buy-in tracking</div>
        <p class="text-muted text-xs">Every buy-in, rebuy and top-up logged as you play. Share the code and each player tracks their own.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">🧮 Who-pays-who settlement</div>
        <p class="text-muted text-xs">At the end it nets every stack and shows the fewest payments to square the table up.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">📈 Player stats &amp; history</div>
        <p class="text-muted text-xs">Profit over time, win/loss streaks and best-night records for your regular crew.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">📍 Find local games</div>
        <p class="text-muted text-xs">List your game in your city or browse open home games near you and request a seat.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">💸 Payment reminders</div>
        <p class="text-muted text-xs">It remembers who still owes and who's still owed, and nudges both sides until it's settled.</p>
      </div>
      <div class="card !mb-0">
        <div class="font-semibold text-sm mb-1">📲 No app, no signup</div>
        <p class="text-muted text-xs">Runs in any phone's browser. Start instantly — an account is optional.</p>
      </div>
    </div>
  </section>

  <section class="max-w-[680px] mx-auto mt-12">
    <h2 class="text-lg font-bold mb-3">Home game poker FAQ</h2>
    {#each faq as f}
      <div class="card !mb-2.5">
        <div class="font-semibold text-sm mb-1">{f.q}</div>
        <p class="text-muted text-sm">{f.a}</p>
      </div>
    {/each}
  </section>

  <section class="max-w-[400px] mx-auto mt-12 mb-10 text-center">
    <a href="/?start=open" class="btn w-full py-[18px] text-[1.1rem] no-underline">Start a home game — free, no signup</a>
    <p class="text-muted text-xs mt-3">Also a <a href="/poker-chip-tracker">poker chip tracker</a> and <a href="/poker-counter">poker counter</a>.</p>
  </section>
</div>
