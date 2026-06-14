<script lang="ts">
  import { money } from '$lib/utils/money';
  import { haptic } from '$lib/utils/fx';
  import { toast } from '$lib/stores/toast';
  import { browser } from '$app/environment';

  const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  const SUITS = ['s', 'h', 'd', 'c'] as const;
  const SUIT_SYM: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SCALE = 100;

  // ---- state ----------------------------------------------------------------
  let game = $state<'holdem' | 'omaha'>('holdem');
  let hiLo = $state(false);
  let boardCount = $state(1);
  let runCount = $state(1);
  let players = $state([
    { name: '', hole: '', amount: '', folded: false },
    { name: '', hole: '', amount: '', folded: false },
  ]);
  let runouts = $state<Record<string, string>>({});
  let result = $state<any>(null);
  let resultHTML = $state('');

  // Picker
  let pickerOpen = $state(false);
  let pickerRef = $state('');
  let pickerIdx = $state(0);
  let pickRank = $state<string | null>(null);

  const holeCount = $derived(game === 'omaha' ? 4 : 2);

  // ---- card helpers ---------------------------------------------------------
  function normCard(tok: string): string | null {
    const m = /^([2-9tjqka])([cdhs])$/i.exec(tok);
    return m ? m[1].toUpperCase() + m[2].toLowerCase() : null;
  }
  function parseTokens(str: string): string[] {
    return (str || '').replace(/,/g, ' ').trim().split(/\s+/).map(normCard).filter(Boolean) as string[];
  }
  function fieldCount(ref: string): number {
    return ref.startsWith('hole') ? holeCount : 5;
  }
  function fieldValue(ref: string): string {
    const [kind, key] = ref.split(':');
    return kind === 'hole' ? (players[+key]?.hole || '') : (runouts[key] || '');
  }
  function setFieldValue(ref: string, val: string) {
    const [kind, key] = ref.split(':');
    if (kind === 'hole') {
      const i = +key;
      if (players[i]) {
        players[i].hole = val;
        // Trigger reactivity by reassigning the array
        players = players;
      }
    } else {
      runouts[key] = val;
      // Trigger reactivity
      runouts = runouts;
    }
  }
  function usedCards(exRef: string, exIdx: number): Set<string> {
    const set = new Set<string>();
    players.forEach((p, i) => parseTokens(p.hole).forEach((t, idx) => { if (!(exRef === `hole:${i}` && idx === exIdx)) set.add(t); }));
    Object.entries(runouts).forEach(([k, v]) => parseTokens(v).forEach((t, idx) => { if (!(exRef === `board:${k}` && idx === exIdx)) set.add(t); }));
    return set;
  }
  function cardParts(tok: string) {
    if (!tok || tok.length < 2) return { rank: '?', suit: '?', sym: '?', red: false };
    const suit = tok[1];
    return { rank: tok[0] === 'T' ? '10' : tok[0], suit, sym: SUIT_SYM[suit] || '?', red: suit === 'h' || suit === 'd' };
  }
  function getSlots(ref: string): (string | null)[] {
    const toks = parseTokens(fieldValue(ref));
    const count = fieldCount(ref);
    return Array.from({ length: count }, (_, i) => toks[i] || null);
  }

  // ---- picker ---------------------------------------------------------------
  function openPicker(ref: string, idx: number) {
    try {
      pickerRef = ref;
      pickerIdx = idx;
      const existing = parseTokens(fieldValue(ref))[idx];
      pickRank = existing ? existing[0] : null;
      pickerOpen = true;
    } catch (e) {
      console.error('Open picker error:', e);
    }
  }
  function closePicker() { pickerOpen = false; }

  // Compute used cards on demand (not $derived) to avoid reactive loops during picker updates
  function getPickerUsed(): Set<string> {
    return pickerOpen ? usedCards(pickerRef, pickerIdx) : new Set<string>();
  }

  function selectRank(r: string) {
    pickRank = r;
  }
  function selectSuit(s: string) {
    try {
      if (!pickRank) return;
      const card = pickRank + s;
      if (getPickerUsed().has(card)) return;
      haptic(9);

      const currentVal = fieldValue(pickerRef);
      const toks = parseTokens(currentVal);
      if (pickerIdx < toks.length) toks[pickerIdx] = card;
      else toks.push(card);
      const maxCount = fieldCount(pickerRef);
      const newToks = toks.slice(0, maxCount);
      const newVal = newToks.join(' ');

      // Only update if the value actually changed
      if (newVal !== currentVal) {
        setFieldValue(pickerRef, newVal);
      }

      // Auto-advance to next empty slot or close
      if (newToks.length < maxCount) {
        pickerIdx = newToks.length;
        pickRank = null;
      } else {
        pickerOpen = false;
      }
    } catch (e) {
      console.error('Card pick error:', e);
      // Don't crash the page — just close the picker
      pickerOpen = false;
    }
  }
  function clearPickerCard() {
    try {
      const toks = parseTokens(fieldValue(pickerRef));
      if (pickerIdx < toks.length) { toks.splice(pickerIdx, 1); setFieldValue(pickerRef, toks.join(' ')); }
    } catch (e) {
      console.error('Clear card error:', e);
    }
    closePicker();
  }

  // ---- segmented control helper ---------------------------------------------
  type SegOption = { value: string; label: string };

  // ---- player management ----------------------------------------------------
  function addPlayer() { players = [...players, { name: '', hole: '', amount: '', folded: false }]; }
  function removePlayer(i: number) { if (players.length > 2) players = players.filter((_, idx) => idx !== i); }

  // ---- compute --------------------------------------------------------------
  async function compute() {
    result = null;
    resultHTML = '';
    try {
      const { resolve } = await import('$lib/engine/index.js');
      const builtPlayers = players.map((p, i) => {
        const amount = Number(p.amount);
        if (!Number.isFinite(amount) || amount < 0) throw new Error(`Enter a valid "in pot" amount for ${p.name || 'Player ' + (i + 1)}`);
        return {
          id: 'p' + i, name: p.name.trim() || 'Player ' + (i + 1),
          hole: parseTokens(p.hole), // raw card strings — the engine parses them (passing objects throws)
          contributed: Math.round(amount * SCALE), folded: p.folded,
        };
      });

      const boards: any[] = [];
      for (let b = 0; b < boardCount; b++) {
        const runs: any[] = [];
        for (let r = 0; r < runCount; r++) {
          const c = parseTokens(runouts[`${b}-${r}`] || ''); // raw card strings for the engine
          const label = (boardCount > 1 ? `Board ${b + 1}` : 'Board') + (runCount > 1 ? ` Run ${r + 1}` : '');
          if (c.length < 3 || c.length > 5) throw new Error(`${label}: enter 3-5 community cards`);
          runs.push(c);
        }
        boards.push({ runs });
      }

      const r = resolve({ game, hiLo, players: builtPlayers.map(({ name, ...p }) => p), boards });
      const nameOf = Object.fromEntries(builtPlayers.map(p => [p.id, p.name]));
      const name = (id: string) => nameOf[id] || id;
      const fmt = (cents: number) => '€' + (cents / SCALE).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const esc = (s: string) => String(s).replace(/[&<>"]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

      // Build result HTML (same format as original)
      let html = '<h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3">Result</h2>';

      if (r.returned) {
        html += `<div class="banner banner-info">Uncalled bet of <b>${fmt(r.returned.amount)}</b> returned to ${esc(name(r.returned.id))}.</div>`;
      }

      const potLabel = (i: number) => (i === 0 ? 'Main pot' : `Side pot ${i}`);

      // ---- "Why these amounts?" — plain-English notes for the situations in THIS hand ----
      const why: string[] = [];
      if (r.pots.length > 1) {
        why.push(`Players put in different amounts, so the money splits into ${r.pots.length} pots — you can only win the pots you fully matched.`);
        builtPlayers.filter(p => !p.folded).forEach(p => {
          const inPots = r.pots.map((pt: any, i: number) => (pt.eligible.includes(p.id) ? i : -1)).filter((i: number) => i >= 0);
          const top = inPots[inPots.length - 1];
          if (top != null && top < r.pots.length - 1) {
            why.push(`<b>${esc(name(p.id))}</b> only put in ${fmt(p.contributed)}, so even with the best hand the most they can win is the ${potLabel(top).toLowerCase()} — the bigger side pot${r.pots.length - top > 2 ? 's go' : ' goes'} to whoever put in more.`);
          }
        });
      }
      if (r.returned) why.push(`<b>${esc(name(r.returned.id))}</b> bet ${fmt(r.returned.amount)} more than anyone matched, so it's returned — uncalled money is never won.`);
      if (builtPlayers.some(p => p.folded)) why.push(`Folded players' chips stay in the pots, but they can't win any of it.`);
      if (boardCount > 1) why.push(`Double board: every pot is split evenly across both boards.`);
      else if (runCount > 1) why.push(`Run ${runCount === 2 ? 'twice' : runCount + ' times'}: every pot is split evenly across the runs.`);
      if (hiLo) why.push(`Hi-Lo: each pot is halved — best high hand takes one half, best qualifying 8-or-better low takes the other.`);
      if (why.length) {
        html += `<details class="bg-surface-2 rounded-[10px] p-3 mt-4 mb-1"><summary class="cursor-pointer font-semibold select-none">Why these amounts?</summary><ul class="mt-2 space-y-1.5 text-muted text-sm list-disc pl-4">${why.map(w => `<li>${w}</li>`).join('')}</ul></details>`;
      }

      // Showdown visualization
      html += '<h3 class="text-xs font-semibold uppercase tracking-widest text-muted mt-4 mb-2">Showdown</h3>';
      const winners: Record<string, Set<string>> = {};
      for (const seg of r.breakdown as any[]) {
        const k = `${seg.board}-${seg.run}`;
        if (!winners[k]) winners[k] = new Set();
        [...(seg.highWinners || []), ...(seg.lowWinners || [])].forEach((id: string) => winners[k].add(id));
      }
      for (let b = 0; b < boardCount; b++) {
        for (let rn = 0; rn < runCount; rn++) {
          const k = `${b}-${rn}`;
          const boardCards = parseTokens(runouts[k] || '');
          const wins = winners[k] || new Set();
          const label = (boardCount > 1 ? `Board ${b + 1}` : 'Board') + (runCount > 1 ? ` · Run ${rn + 1}` : '');
          html += `<div class="card !bg-surface !mb-3"><div class="text-xs uppercase tracking-widest text-muted font-bold mb-2">${label}</div>`;
          html += `<div class="flex flex-wrap gap-1 p-3 rounded-xl bg-gradient-to-b from-accent/20 to-surface-2 border border-border mb-3">`;
          boardCards.forEach((c, i) => {
            const p = cardParts(c);
            html += `<div class="inline-flex flex-col items-center justify-center w-[38px] h-[52px] rounded-lg bg-gradient-to-br from-white to-gray-100 border border-gray-200 font-extrabold leading-none shadow-md ${p.red ? 'text-red-500' : 'text-gray-800'}"><span class="text-sm">${p.rank}</span><b class="text-base -mt-0.5">${p.sym}</b></div>`;
          });
          html += '</div>';
          html += '<div class="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">';
          builtPlayers.forEach(pl => {
            const won = wins.has(pl.id);
            const holeCards = parseTokens(players[+pl.id.slice(1)].hole);
            const tag = pl.folded ? '<span class="pill">folded</span>' : (won ? '<span class="pill pill-win">won</span>' : '');
            html += `<div class="p-2 rounded-lg bg-surface-2 border ${won ? 'border-accent shadow-[0_0_26px_-8px_var(--color-accent-glow)]' : 'border-border-soft'} ${pl.folded ? 'opacity-45' : ''}">`;
            html += `<div class="flex flex-wrap gap-1 mb-1">`;
            holeCards.forEach(c => {
              const p = cardParts(c);
              html += `<div class="inline-flex flex-col items-center justify-center w-[34px] h-[46px] rounded-md bg-gradient-to-br from-white to-gray-100 border border-gray-200 font-extrabold leading-none shadow-sm ${p.red ? 'text-red-500' : 'text-gray-800'} ${pl.folded ? 'grayscale-[.8]' : ''}"><span class="text-xs">${p.rank}</span><b class="text-sm -mt-0.5">${p.sym}</b></div>`;
            });
            html += `</div><div class="text-sm font-semibold">${esc(pl.name)} ${tag}</div></div>`;
          });
          html += '</div></div>';
        }
      }

      // ---- Each pot: amount + who won it (per board) ----
      html += '<h3 class="text-xs font-semibold uppercase tracking-widest text-muted mt-4 mb-2">Each pot</h3>';
      const byPot: Record<number, any[]> = {};
      r.breakdown.forEach((seg: any) => { if (seg.amount !== 0) (byPot[seg.pot] ||= []).push(seg); });
      r.pots.forEach((pot: any, i: number) => {
        html += `<div class="bg-surface-2 rounded-[10px] p-3 mb-2 border-l-[3px] border-border">`;
        html += `<div class="flex items-baseline justify-between gap-2"><b>${potLabel(i)}</b><span class="font-bold tabular-nums" style="font-family:var(--font-display)">${fmt(pot.amount)}</span></div>`;
        // Side pots: a plain, compact note of who's actually in it (no chip grid).
        if (i > 0) html += `<div class="text-muted text-xs mt-0.5">${pot.eligible.map((id: string) => esc(name(id))).join(', ')} only</div>`;
        (byPot[i] || []).forEach((seg: any) => {
          const board = boardCount > 1 ? `Board ${seg.board + 1}` : (runCount > 1 ? `Run ${seg.run + 1}` : '');
          let who: string, hand = '';
          if (seg.walkover) {
            who = esc(name(seg.highWinners[0]));
          } else if (seg.lowWinners?.length) {
            who = `${seg.highWinners.map((id: string) => esc(name(id))).join(' & ')} (high) / ${seg.lowWinners.map((id: string) => esc(name(id))).join(' & ')} (low)`;
          } else {
            who = `${seg.highWinners.map((id: string) => esc(name(id))).join(' & ')}${seg.highWinners.length > 1 ? ' (split)' : ''}`;
            if (seg.highHand && seg.highHand !== 'uncontested') hand = ` <span class="text-muted">· ${esc(seg.highHand)}</span>`;
          }
          html += `<div class="flex items-baseline gap-2 text-sm mt-1.5 pt-1.5 border-t border-border-soft">${board ? `<span class="text-muted text-xs w-16 shrink-0">${board}</span>` : ''}<span class="flex-1"><b>${who}</b>${hand}</span><span class="font-semibold tabular-nums shrink-0">${fmt(seg.amount)}</span></div>`;
        });
        html += `</div>`;
      });

      // Each player collects
      html += '<h3 class="text-xs font-semibold uppercase tracking-widest text-muted mt-4 mb-2">Each player collects</h3>';
      const totals = builtPlayers.map(p => ({ name: p.name, amt: r.awards[p.id] || 0, contributed: p.contributed, folded: p.folded })).sort((a, b) => b.amt - a.amt);
      totals.forEach(t => {
        const net = t.amt - t.contributed;
        html += `<div class="player-row"><div><span class="font-semibold">${esc(t.name)}</span> ${t.folded ? '<span class="pill">folded</span>' : ''}</div><div class="text-right"><div class="font-bold tabular-nums" style="font-family:var(--font-display)">${fmt(t.amt)}</div><div class="text-muted text-xs">${net >= 0 ? '+' : ''}${fmt(net)} vs put in ${fmt(t.contributed)}</div></div></div>`;
      });
      html += `<p class="text-muted text-xs text-center mt-2">Total distributed ${fmt(r.total)} — matches every chip put in.</p>`;

      // ---- Equity / chances of winning (flop + turn) ----
      try {
        const { equityAt } = await import('$lib/engine/equity.js');
        const need = game === 'omaha' ? 4 : 2;
        const contesting = builtPlayers.filter(p => !p.folded);
        if (contesting.length >= 2 && contesting.every(p => p.hole.length === need)) {
          const eqPlayers = contesting.map(p => ({ id: p.id, hole: p.hole }));
          const eqName = (pid: string) => contesting.find(p => p.id === pid)?.name || pid;

          let eqHTML = '<h3 class="text-xs font-semibold uppercase tracking-widest text-muted mt-6 mb-2">Chances of winning</h3>';
          for (let b = 0; b < boards.length; b++) {
            const full = boards[b].runs[0];
            const streets: { label: string; board: any[]; unit: string }[] = [];
            if (full.length >= 3) streets.push({ label: 'After the flop', board: full.slice(0, 3), unit: 'turn+river combos' });
            if (full.length >= 4) streets.push({ label: 'After the turn', board: full.slice(0, 4), unit: 'possible rivers' });

            for (const st of streets) {
              let eq;
              try { eq = equityAt({ game, players: eqPlayers, board: st.board, hiLo }); }
              catch { continue; }
              const head = (boards.length > 1 ? `Board ${b + 1} · ` : '') + st.label;
              eqHTML += `<div class="bg-surface-2 border-l-[3px] p-3 rounded-r-[9px] mb-2" style="border-left-color:var(--color-gold)">`;
              eqHTML += `<div class="text-muted text-xs mb-2">${esc(head)} — ${eq.runouts.toLocaleString()} ${st.unit}</div>`;
              for (const e of eq.equity.slice().sort((a: any, c: any) => c.equity - a.equity)) {
                const pct = e.equity * 100;
                const sub = hiLo
                  ? `<div class="text-muted text-xs ml-[106px] -mt-0.5 mb-1.5">scoop ${Math.round(e.scoop * 100)}% · high ${Math.round(e.winHigh * 100)}% · low ${Math.round(e.winLow * 100)}%</div>`
                  : '';
                eqHTML += `<div class="flex items-center gap-2.5 my-1.5">
                  <span class="w-24 shrink-0 text-sm font-semibold truncate">${esc(eqName(e.id))}</span>
                  <div class="flex-1 h-3 bg-surface border border-border rounded-full overflow-hidden">
                    <div class="h-full rounded-full bg-gradient-to-r from-accent to-gold" style="width:${pct.toFixed(1)}%"></div>
                  </div>
                  <span class="w-14 shrink-0 text-right tabular-nums font-extrabold text-sm">${pct.toFixed(1)}%</span>
                </div>${sub}`;
              }
              eqHTML += '</div>';
            }
          }
          eqHTML += `<p class="text-muted text-xs mt-2">${hiLo
            ? 'Bars show expected pot share (hi-lo splits). "scoop" = win whole pot. Folded players excluded.'
            : "Each player's exact chance to win — computed by checking every possible runout. Folded players excluded."}</p>`;
          html += eqHTML;
        }
      } catch { /* equity calculation failed — skip silently */ }

      resultHTML = html;
    } catch (e: any) {
      resultHTML = `<div class="banner banner-warn mt-4">${e.message}</div>`;
    }
  }

  // ---- example ---------------------------------------------------------------
  function loadExample() {
    game = 'omaha';
    hiLo = false;
    boardCount = 2;
    runCount = 1;
    players = [
      { name: 'Alice', hole: 'Ah Kh Qh Jh', amount: '100', folded: false },
      { name: 'Bob', hole: 'As Ks Qs Js', amount: '300', folded: false },
      { name: 'Cara', hole: '2c 2d 7c 8d', amount: '300', folded: false },
    ];
    runouts = { '0-0': 'Th 9h 4c 2s 5d', '1-0': '8s 6s 5s 2h Kd' };
    setTimeout(compute, 0);
  }
</script>

<svelte:head><title>potcount — pot splitter</title></svelte:head>

<div class="wrap">
  <h1 class="text-2xl font-bold mb-1">Pot splitter</h1>
  <p class="text-muted text-sm mb-4">Tap the slots to pick cards. We'll work out who gets what.</p>

  <!-- Game options -->
  <div class="card">
    <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Game</h3>

    <label class="block text-xs text-muted font-medium mb-1">Variant</label>
    <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-3">
      <button class="py-2.5 rounded-lg font-semibold text-sm transition-all {game === 'omaha' ? 'bg-gradient-to-b from-accent to-[#18b07e] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { game = 'omaha'; haptic(8); }}>Omaha / PLO</button>
      <button class="py-2.5 rounded-lg font-semibold text-sm transition-all {game === 'holdem' ? 'bg-gradient-to-b from-accent to-[#18b07e] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { game = 'holdem'; haptic(8); }}>Hold'em</button>
    </div>

    <label class="block text-xs text-muted font-medium mb-1">Boards</label>
    <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-3">
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {boardCount === 1 ? 'bg-gradient-to-b from-accent to-[#18b07e] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { boardCount = 1; haptic(8); }}>Single board</button>
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {boardCount === 2 ? 'bg-gradient-to-b from-accent to-[#18b07e] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { boardCount = 2; haptic(8); }}>Double board</button>
    </div>

    <label class="block text-xs text-muted font-medium mb-1">Run it</label>
    <div class="grid grid-cols-3 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-3">
      {#each [{ v: 1, l: 'Once' }, { v: 2, l: 'Twice' }, { v: 3, l: '3 times' }] as opt}
        <button class="py-2 rounded-lg font-semibold text-sm transition-all {runCount === opt.v ? 'bg-gradient-to-b from-accent to-[#18b07e] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
          onclick={() => { runCount = opt.v; haptic(8); }}>{opt.l}</button>
      {/each}
    </div>

    <label class="block text-xs text-muted font-medium mb-1">Hi-Lo split</label>
    <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1">
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {!hiLo ? 'bg-gradient-to-b from-accent to-[#18b07e] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { hiLo = false; haptic(8); }}>High only</button>
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {hiLo ? 'bg-gradient-to-b from-accent to-[#18b07e] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { hiLo = true; haptic(8); }}>8-or-better</button>
    </div>
  </div>

  <!-- Community cards -->
  <div class="card">
    <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">
      Community cards {boardCount * runCount > 1 ? `(${boardCount} board${boardCount > 1 ? 's' : ''} × ${runCount} run${runCount > 1 ? 's' : ''})` : ''}
    </h3>
    {#each { length: boardCount } as _, b}
      {#each { length: runCount } as _, r}
        {@const ref = `board:${b}-${r}`}
        {@const slots = getSlots(ref)}
        {@const label = (boardCount > 1 ? `Board ${b + 1}` : 'Board') + (runCount > 1 ? ` · Run ${r + 1}` : '')}
        <label class="block text-xs text-muted font-medium mb-1">{label}</label>
        <div class="flex flex-wrap gap-[7px] mb-3">
          {#each slots as card, i}
            {#if card}
              {@const p = cardParts(card)}
              <button class="w-[46px] h-[60px] rounded-lg flex flex-col items-center justify-center font-extrabold leading-none shadow-md border bg-gradient-to-br from-white to-gray-100 border-gray-200 active:scale-95 transition-transform {p.red ? 'text-red-500' : 'text-gray-800'}"
                onclick={() => openPicker(ref, i)}>
                <span class="text-base">{p.rank}</span><b class="text-lg -mt-0.5">{p.sym}</b>
              </button>
            {:else}
              <button class="w-[46px] h-[60px] rounded-lg border-2 border-dashed border-border bg-surface-2 text-faint text-2xl grid place-items-center hover:border-accent hover:text-accent active:scale-95 transition-all cursor-pointer"
                onclick={() => openPicker(ref, i)}>+</button>
            {/if}
          {/each}
        </div>
      {/each}
    {/each}
    <p class="text-muted text-xs">Tap a slot to pick a card. 3–5 cards per board.</p>
  </div>

  <!-- Players -->
  <div class="card">
    <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Players · amount in the pot</h3>
    {#each players as p, i}
      {@const ref = `hole:${i}`}
      {@const slots = getSlots(ref)}
      <div class="card !bg-surface-2 !p-3 !mb-2">
        <div class="flex gap-2 mb-2">
          <input class="input flex-[1.2] !py-2 !px-3" bind:value={p.name} placeholder="Player {i + 1}" />
          <input class="input flex-[0.8] !py-2 !px-3" type="number" inputmode="decimal" step="any" min="0" bind:value={p.amount} placeholder="in pot" />
        </div>
        <div class="text-muted text-xs mb-1">{holeCount} hole cards</div>
        <div class="flex flex-wrap gap-[7px] mb-2">
          {#each slots as card, si}
            {#if card}
              {@const cp = cardParts(card)}
              <button class="w-[46px] h-[60px] rounded-lg flex flex-col items-center justify-center font-extrabold leading-none shadow-md border bg-gradient-to-br from-white to-gray-100 border-gray-200 active:scale-95 transition-transform {cp.red ? 'text-red-500' : 'text-gray-800'}"
                onclick={() => openPicker(ref, si)}>
                <span class="text-base">{cp.rank}</span><b class="text-lg -mt-0.5">{cp.sym}</b>
              </button>
            {:else}
              <button class="w-[46px] h-[60px] rounded-lg border-2 border-dashed border-border bg-surface text-faint text-2xl grid place-items-center hover:border-accent hover:text-accent active:scale-95 transition-all cursor-pointer"
                onclick={() => openPicker(ref, si)}>+</button>
            {/if}
          {/each}
        </div>
        <label class="flex items-center justify-between cursor-pointer">
          <span class="text-muted text-xs">Folded (forfeits, still funds pot)</span>
          <input type="checkbox" bind:checked={p.folded} class="accent-accent w-4 h-4" />
        </label>
        {#if players.length > 2}
          <button class="btn-small btn-danger mt-1.5" onclick={() => removePlayer(i)}>Remove</button>
        {/if}
      </div>
    {/each}
    <div class="flex gap-2 mt-2">
      <button class="btn-small btn-secondary flex-1" onclick={addPlayer}>+ Add player</button>
      <button class="btn-small btn-ghost flex-1" onclick={loadExample}>Load example</button>
    </div>
    <p class="text-muted text-xs mt-2">"In pot" = how much that player put in. Short stacks make side pots automatically; whoever folded still funds the pot but can't win it.</p>
  </div>

  <div class="sticky bottom-3 z-10 mt-1">
    <button class="btn w-full shadow-xl" onclick={compute}>Split the pot</button>
  </div>

  <!-- Results -->
  <div id="result">
    {#if resultHTML}
      {@html resultHTML}
    {/if}
  </div>
</div>

<!-- Card picker bottom sheet -->
{#if pickerOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end justify-center"
    onclick={(e) => { if (e.target === e.currentTarget) closePicker(); }}
    onkeydown={(e) => { if (e.key === 'Escape') closePicker(); }}
    role="dialog" aria-modal="true">
    <div class="w-full max-w-[640px] bg-surface border-t border-border-soft rounded-t-2xl p-4 pb-[calc(20px+env(safe-area-inset-bottom,0px))]"
      onclick={(e) => e.stopPropagation()}>
      <div class="flex items-center justify-between mb-2">
        <b style="font-family:var(--font-display)">Pick a {pickerRef.startsWith('hole') ? 'hole' : 'board'} card ({pickerIdx + 1})</b>
        <button class="btn-small btn-ghost" onclick={closePicker}>Done</button>
      </div>

      {#if !pickRank}
        <div class="text-xs uppercase tracking-widest text-muted mb-2">1. Rank</div>
        <div class="grid grid-cols-7 gap-[7px]">
          {#each RANKS as r}
            {@const allUsed = SUITS.every(s => getPickerUsed().has(r + s))}
            <button class="py-3.5 rounded-xl font-extrabold text-lg bg-surface-2 border border-border text-text hover:bg-surface-3 active:scale-95 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              style="font-family:var(--font-display)"
              disabled={allUsed}
              onclick={() => selectRank(r)}>{r === 'T' ? '10' : r}</button>
          {/each}
        </div>
      {:else}
        <div class="text-xs uppercase tracking-widest text-muted mb-2">2. Suit for {pickRank === 'T' ? '10' : pickRank}</div>
        <div class="grid grid-cols-4 gap-2">
          {#each SUITS as s}
            {@const used = getPickerUsed().has(pickRank + s)}
            <button class="py-4 rounded-xl text-3xl leading-none bg-surface-2 border border-border hover:bg-surface-3 active:scale-95 transition-all disabled:opacity-20 disabled:cursor-not-allowed {s === 'h' || s === 'd' ? 'text-red-400' : 'text-text'}"
              disabled={used}
              onclick={() => selectSuit(s)}>{SUIT_SYM[s]}</button>
          {/each}
        </div>
        <button class="btn-small btn-ghost w-full mt-3" onclick={() => pickRank = null}>← Back to ranks</button>
      {/if}
      <button class="btn-small btn-ghost w-full mt-3" onclick={clearPickerCard}>Clear this card</button>
    </div>
  </div>
{/if}
