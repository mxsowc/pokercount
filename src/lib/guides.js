// Content for the /guide section — step-by-step, plain-English walkthroughs of
// every potcount feature. This is authored, trusted content (no user input), so
// the article renderer is allowed to {@html} the block strings for light inline
// markup (<strong>, <a>). Keep the voice like the rest of the app: poker-native,
// a little cheeky, never a boring manual.
//
// Block types a section can contain:
//   { p }      paragraph (inline HTML allowed)
//   { sub }    an <h3> sub-heading inside a section
//   { steps }  an ordered list (each item may contain inline HTML)
//   { tip }    a highlighted 💡 callout
//   { note }   a quieter aside

/** @typedef {{ p?: string, sub?: string, steps?: string[], tip?: string, note?: string }} Block */
/** @typedef {{ slug: string, emoji: string, title: string, seoTitle: string, description: string, tagline: string, readMins: number, sections: { h: string, blocks: Block[] }[], faq?: { q: string, a: string }[] }} Guide */

/** @type {Guide[]} */
export const GUIDES = [
  {
    slug: 'how-to-track-a-home-poker-game',
    emoji: '🎴',
    title: 'Track a home poker game, start to finish',
    seoTitle: 'How to Track a Home Poker Game (Step by Step) | potcount',
    description: 'The complete walkthrough: open a game, get everyone adding their own buy-ins, cash out, and lock in the night — no notebook, no arguments.',
    tagline: 'From "who\'s in?" to "we\'re square" — the whole night, tracked.',
    readMins: 4,
    sections: [
      {
        h: 'Open the game (20 seconds)',
        blocks: [
          { p: 'Tap <strong>Open a game</strong> on the home screen. Give it a name (or keep the auto-generated one — "Sat 12 Jul — Please no pocket jacks" is a vibe), pick your currency, and you\'re live.' },
          { p: 'Currency isn\'t just €/$/£. Type <strong>"chips"</strong>, <strong>"big blinds"</strong>, even <strong>"BTC"</strong> — potcount tracks in whatever unit your table thinks in and does the math in that unit.' },
          { tip: 'Set a <strong>default buy-in</strong> when you open the game. It pre-fills the amount every time someone sits down, so adding a player is one tap instead of three.' },
        ],
      },
      {
        h: 'Get everyone in',
        blocks: [
          { p: 'Every game gets a short <strong>4-digit code</strong> and a share link (and a QR code for the person across the table). Send it in the group chat.' },
          { p: 'Here\'s the good part: <strong>everyone opens the same game on their own phone</strong> and adds their own buy-ins. No single scorekeeper sweating over everyone\'s chips. Anyone with the code can add players, log buy-ins and help keep it straight — it\'s collaborative by design.' },
          { sub: 'Want tighter control?' },
          { p: 'Hit <strong>Lock table</strong> and new people can\'t self-join by code anymore — you (the host) add players yourself. Handy once the table\'s set and you don\'t want a random code-holder wandering in.' },
        ],
      },
      {
        h: 'Play: buy-ins & top-ups',
        blocks: [
          { p: 'Someone rebuys after running into quad kings? Tap their name, add a <strong>top-up</strong>. Every buy-in and top-up stacks up under each player, and the <strong>live pot total</strong> at the top always shows how much is on the table.' },
          { note: 'Made a typo? Every entry is editable, and there\'s a full activity log of who changed what — so a fat-fingered €500 buy-in is a two-tap fix, not a 20-minute argument.' },
        ],
      },
      {
        h: 'Cash out & lock in',
        blocks: [
          { p: 'When the cards are in the air for the last time, each player enters their <strong>final chip count</strong> — what they\'re walking away with. potcount shows a <strong>live settlement preview</strong> as the stacks come in, so you can spot a miscount before it matters.' },
          { steps: [
            'Everyone enters their final stack.',
            'Check the totals balance (chips out should equal chips in — potcount flags it if they don\'t).',
            'Tap <strong>Lock in</strong>. The night is now frozen and the settlement is final.',
          ] },
          { p: 'That\'s it — potcount now knows exactly who\'s up, who\'s down, and the shortest path to square everyone up. Which is the next guide →' },
        ],
      },
    ],
    faq: [
      { q: 'Does everyone need the app?', a: 'No app at all — it runs in the browser. The host shares a code or link and everyone taps in. No download, no signup required to play.' },
      { q: 'What if the numbers don\'t balance at the end?', a: 'potcount shows the discrepancy live as final stacks come in, so you can find the miscount before locking in. It never forces a broken settlement.' },
      { q: 'Can I use it for chips instead of money?', a: 'Yes. Pick "chips" (or any unit) when you open the game and everything is tracked in chips; you can settle the cash value later.' },
    ],
  },

  {
    slug: 'how-to-settle-up-after-poker',
    emoji: '🤝',
    title: 'Settle up after poker — and actually get paid',
    seoTitle: 'How to Settle Up After a Poker Game (Who Pays Who) | potcount',
    description: 'The fewest-payments settlement, marking a payment as paid, the two-sided "confirm you got it" step, and the nudges that stop a debt from being forgotten.',
    tagline: 'The math is the easy part. Getting Dave to actually pay is why this exists.',
    readMins: 4,
    sections: [
      {
        h: 'Who pays who, in the fewest payments',
        blocks: [
          { p: 'The naive way to settle a 6-person game is a dozen little Venmos flying in every direction. potcount instead computes the <strong>minimum number of transfers</strong> that squares everyone up. Three people owe, two are owed? You might get away with just three payments total.' },
          { p: 'Each player sees <strong>their own line</strong>: exactly who to pay (or who\'s paying them) and how much. No mental math, no "wait, who am I sending this to?"' },
        ],
      },
      {
        h: 'Mark a payment as paid',
        blocks: [
          { p: 'When you send your payment — Tikkie, Venmo, cold hard cash — tap the transfer and mark it <strong>Paid</strong>. That\'s your side of the handshake: "money\'s sent."' },
          { note: 'potcount never touches the money itself. It\'s the scoreboard, not the bank — you pay however your table already pays.' },
        ],
      },
      {
        h: 'The other half: confirm you got it',
        blocks: [
          { p: 'Here\'s the bit most trackers miss. A payment isn\'t really done until the <strong>receiver confirms they actually got it</strong>. So when you\'re owed money and someone marks it paid, you get a <strong>Confirm received</strong> action.' },
          { steps: [
            'Payer marks the transfer <strong>Paid</strong> ("I sent it").',
            'Receiver taps <strong>Confirm received</strong> ("yep, landed").',
            'Now it\'s truly settled — both sides agreed.',
          ] },
          { tip: 'This two-sided handshake is what makes settlement trustworthy. "I paid you weeks ago" vs "no you didn\'t" just… stops being a conversation.' },
        ],
      },
      {
        h: 'The gentle nagging (so you don\'t have to)',
        blocks: [
          { p: 'A day after the game, if a payment\'s still open, potcount quietly nudges <strong>both</strong> people: the debtor gets "you still owe €20", the person owed gets "you\'re still owed €20 — already got it?". It repeats at most weekly, so it\'s a nudge, not a nag.' },
          { p: 'On your home screen, any finished game where <strong>you</strong> still owe or still need to confirm a payment gets pushed to the top with an amber flag — it won\'t quietly disappear into history until the money\'s actually sorted.' },
          { note: 'Bonus: every confirmed payment feeds your <strong>settlement-speed</strong> stat — a quiet flex for the people who always pay first, and a gentle shame ticker for those who… don\'t.' },
        ],
      },
    ],
    faq: [
      { q: 'Does potcount handle the actual payment?', a: 'No. It calculates who owes who and tracks what\'s been paid and confirmed, but the money moves however your group already pays — cash, Tikkie, Venmo, whatever. potcount never holds or transfers funds.' },
      { q: 'Why confirm a payment I already marked paid?', a: 'The payer marks "paid" and the receiver confirms "received" — a two-sided handshake so there\'s never a he-said-she-said about whether money actually landed.' },
      { q: 'What if someone just never pays?', a: 'potcount keeps the debt visible and nudges both sides after 24 hours (then weekly). It can\'t force a payment, but it makes forgetting impossible.' },
    ],
  },

  {
    slug: 'split-a-poker-pot',
    emoji: '🍰',
    title: 'Split any pot with the Split tool',
    seoTitle: 'How to Split a Poker Pot — Side Pots, All-ins, Run It Twice | potcount',
    description: 'The standalone Split tool for the gnarly pots: multiway all-ins, side pots, run-it-twice, double boards and hi-lo — no game needed, instant answer.',
    tagline: 'When the table goes "…so who wins what?", this is the answer machine.',
    readMins: 3,
    sections: [
      {
        h: 'When to reach for it',
        blocks: [
          { p: 'Sometimes you don\'t need a whole tracked night — you just need to settle <strong>one messy pot right now</strong>. Three players all-in for different amounts, a chopped pot, a run-it-twice that half the table can\'t agree on. That\'s the <strong><a href="/pot">Split tool</a></strong>.' },
          { p: 'It\'s instant and needs no game, no code, no signup. Open it, punch in the numbers, done.' },
        ],
      },
      {
        h: 'What it handles',
        blocks: [
          { p: 'This isn\'t just "divide by number of winners". It does the stuff that actually starts arguments:' },
          { steps: [
            '<strong>Side pots & unequal all-ins</strong> — three players all-in for €20, €60 and €100 builds the main pot and side pots correctly, and awards each to the right winner.',
            '<strong>Run it twice</strong> (or more) — deal the rest of the board multiple times and split the pot across the runs.',
            '<strong>Double board</strong> — two boards, one pot, each board worth half.',
            '<strong>Hi-lo</strong> — split between the high hand and a qualifying low.',
            '<strong>Equity</strong> — not sure who\'s ahead? It can run the odds so you can chop by equity instead of arguing.',
          ] },
        ],
      },
      {
        h: 'Using it',
        blocks: [
          { steps: [
            'Open <strong><a href="/pot">the Split tool</a></strong>.',
            'Enter each player\'s stake in the pot (their all-in amount).',
            'Set who won — or the boards / runs for the fancy stuff.',
            'Read off exactly what each player collects.',
          ] },
          { tip: 'Mid-game and it\'s just one weird pot? Use Split to settle it and carry on — you don\'t have to break your tracked game to do it.' },
        ],
      },
    ],
    faq: [
      { q: 'Do I need an account to split a pot?', a: 'No. The Split tool is instant and needs no signup or game — just open it and enter the numbers.' },
      { q: 'Can it handle three players all-in for different amounts?', a: 'Yes — that\'s exactly what side-pot logic is for. It builds the main and side pots and awards each to the correct winner.' },
      { q: 'Does it do run-it-twice and double boards?', a: 'Both, plus hi-lo splits and equity calculations for when you want to chop by odds.' },
    ],
  },

  {
    slug: 'why-create-a-potcount-account',
    emoji: '📈',
    title: 'Why bother with an account?',
    seoTitle: 'Why Create a potcount Account — Stats, Profiles & History | potcount',
    description: 'You can play without one — but an account turns a night of tracking into a running story: profit history, streaks, profiles, awards, leaderboards and cross-device sync.',
    tagline: 'Playing without an account is fine. Playing with one is a career.',
    readMins: 3,
    sections: [
      {
        h: 'You don\'t need one — but here\'s the pitch',
        blocks: [
          { p: 'You can track and settle a whole game without signing up. An account is optional. But without one, every night is amnesia — the numbers vanish when the game ends. With one, they become <strong>your record</strong>.' },
        ],
      },
      {
        h: 'What you actually get',
        blocks: [
          { sub: 'Your all-time story' },
          { p: 'A running <strong>profit history</strong> across every game — up or down, all-time, on one line. Plus average per game, % of nights you finished up, your <strong>best night</strong> and your <strong>worst beat</strong>, and hourly rate if you log your hours.' },
          { sub: 'Streaks & bragging rights' },
          { p: 'Win streaks, loss streaks (❄️), and <strong>peer-voted awards</strong> your table hands out — "hardest to read", the ice-cold bluffer, whatever your crew decides. They stick to your profile.' },
          { sub: 'A profile people can find' },
          { p: 'A public profile at <strong>/u/yourhandle</strong> (as public or private as you want). Follow your regular crew, see their stats, and climb your <strong>city and global leaderboards</strong>.' },
          { sub: 'It follows you everywhere' },
          { p: 'Play on your phone, check stats on your laptop. Any game your account is seated in <strong>surfaces automatically when you sign in</strong> — even on a device you\'ve never opened it on.' },
          { sub: 'Get pinged when it matters' },
          { p: 'Notifications for join requests, someone following you, awards, and — crucially — when a payment\'s outstanding or someone\'s confirmed they paid you.' },
        ],
      },
      {
        h: 'The community angle',
        blocks: [
          { p: 'Set your <strong>home city</strong> and you show up on the local <a href="/homegames">home-games directory</a>, so nearby players can find your table. Private types can stay off it entirely — your call, changeable anytime.' },
          { tip: 'Signing in is genuinely two taps with Google or Apple, or a name + passcode. No email required, no spam — the monthly stats recap is strictly opt-in.' },
        ],
      },
    ],
    faq: [
      { q: 'Can I use potcount without an account?', a: 'Yes — you can track and settle entire games with no signup. An account only adds saved stats, history, profiles and cross-device sync.' },
      { q: 'Is my profile public?', a: 'You choose: public, members-only, or private. Private profiles are kept off the city directory and hide detailed stats.' },
      { q: 'Will you email me?', a: 'Only if you opt in to the monthly stats recap. No email is required to have an account, and there\'s no other marketing mail.' },
    ],
  },

  {
    slug: 'host-or-join-an-open-game',
    emoji: '📍',
    title: 'Host or find an open home game',
    seoTitle: 'How to Host or Join an Open Home Poker Game by City | potcount',
    description: 'List your table so local players can find it, set the blinds and buy-in, and approve who sits down — or browse open games in your city and request a seat.',
    tagline: 'The group chat is full. Time to find some new degens.',
    readMins: 3,
    sections: [
      {
        h: 'Finding a game near you',
        blocks: [
          { p: 'Head to the <strong><a href="/homegames">home-games directory</a></strong> and pick your city. You\'ll see the local players and any <strong>open games</strong> looking for people — with the stakes (blinds), buy-in and how many seats are left.' },
          { p: 'See one you like? Tap <strong>Request to join</strong>. The host gets your request and decides — you\'re never dropped into a stranger\'s game automatically, and they\'re never forced to take you.' },
          { note: 'Open games are <strong>social play, in blinds only</strong> — no real-money stakes are shown or handled. It\'s about finding people to play with, not running a casino.' },
        ],
      },
      {
        h: 'Hosting an open game',
        blocks: [
          { p: 'Opening a game? Flip on <strong>List publicly</strong> and set it up so people know what they\'re signing up for:' },
          { steps: [
            'Pick your <strong>city</strong> — that\'s where it shows up.',
            'Set the <strong>blinds</strong> (e.g. 1/2) so people know the stakes.',
            'Set <strong>max players</strong> so the table can\'t overfill.',
            'Set a <strong>buy-in</strong> — a fixed amount, or a min–max range in blinds.',
          ] },
          { p: 'Now requests roll in and <strong>you approve or decline each one</strong>. Approve someone and they\'re seated; the table fills up to your cap and no further. You\'re the bouncer.' },
        ],
      },
      {
        h: 'Staying in control',
        blocks: [
          { p: 'You decide who plays, full stop. Requests are yours to approve or reject, the player cap is enforced automatically, and you can stop listing the game any time — it drops off the directory immediately.' },
          { tip: 'Under-18s are kept off the directory entirely and can\'t request to join — open games are 18+.' },
        ],
      },
    ],
    faq: [
      { q: 'Can anyone just join my public game?', a: 'No. Public games are approval-only — players send a request and you approve or decline each one. Nobody is seated without your say-so.' },
      { q: 'Are open games for real money?', a: 'They\'re shown as social play in blinds only — potcount never shows or handles real-money stakes on the public directory. How your table actually plays is between the players.' },
      { q: 'How do I stop listing my game?', a: 'Turn off public listing any time and it drops from the city directory immediately.' },
    ],
  },
];

/** @param {string} slug @returns {Guide | null} */
export function getGuide(slug) {
  return GUIDES.find((g) => g.slug === slug) || null;
}
