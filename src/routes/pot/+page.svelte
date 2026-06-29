<script lang="ts">
  import { money } from '$lib/utils/money';
  import { haptic } from '$lib/utils/fx';
  import { toast } from '$lib/stores/toast';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';

  onMount(() => { loadActiveGame(); });

  // Parse a typed amount: accept a comma decimal (phone keypads) and strip
  // spaces / thousands separators so "1.234,56" / "1 000" / "1,000" don't mangle.
  const decAmt = (v: any): number =>
    Number(String(v ?? '').trim().replace(/\s/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));

  const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  const SUITS = ['s', 'h', 'd', 'c'] as const;
  const SUIT_SYM: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SCALE = 100;

  // ---- active game context ---------------------------------------------------
  // Read the user's most recent active game so we can offer player names and
  // currency as quick-fill options — zero friction for mid-game pot splits.
  let activeGame = $state<any>(null);
  let activeGamePlayers = $state<string[]>([]);
  let activeGameUnit = $state('€');

  async function loadActiveGame() {
    if (!browser) return;
    try {
      const list = JSON.parse(localStorage.getItem('pc_games') || '[]');
      const recent = list.find((g: any) => g.status === 'active') || list[0];
      if (!recent?.id) return;
      const res = await fetch(`/api/games/${recent.id}`);
      if (!res.ok) return;
      const g = await res.json();
      if (g.status !== 'active') return;
      activeGame = g;
      activeGamePlayers = g.players.map((p: any) => p.name);
      activeGameUnit = g.unit || '€';
    } catch { /* offline or no game — fine */ }
  }

  let selectedFromGame = $state<Set<string>>(new Set());
  let allInFromGame = $state<Set<string>>(new Set());
  let potBefore = $state('');
  let showPotBefore = $state(false);

  function toggleGamePlayer(name: string) {
    const next = new Set(selectedFromGame);
    if (next.has(name)) { next.delete(name); allInFromGame.delete(name); }
    else next.add(name);
    selectedFromGame = next;
    allInFromGame = new Set(allInFromGame);
    haptic(8);
  }

  function toggleAllIn(name: string) {
    const next = new Set(allInFromGame);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    allInFromGame = next;
    haptic(8);
  }

  function applySelectedPlayers() {
    if (selectedFromGame.size < 2) { toast('Pick at least 2 players'); return; }
    const potBeforeAmt = decAmt(potBefore) || 0;
    const selectedNames = [...selectedFromGame];
    // If there's a pot-before and no all-ins, split evenly as starting amounts.
    // With all-ins, leave amounts blank — the user needs to enter the actual
    // per-player totals since they'll differ.
    const perPlayer = potBeforeAmt > 0 && allInFromGame.size === 0
      ? String(Math.round((potBeforeAmt / selectedNames.length) * 100) / 100)
      : '';
    players = selectedNames.map(name => ({
      name, hole: '',
      amount: allInFromGame.has(name) ? '' : perPlayer,
      folded: false,
    }));
    // Toast a helpful reminder for all-in situations
    if (allInFromGame.size > 0) {
      const names = [...allInFromGame].join(', ');
      toast(`${names} marked all-in — enter each player's total in the pot`);
    }
    haptic(12);
  }

  // ---- state ----------------------------------------------------------------
  let game = $state<'holdem' | 'omaha'>('holdem');
  let hiLo = $state(false);
  let boardCount = $state(1);
  let runCount = $state(1);
  // When running it 2–3×, how much of the board is dealt ONCE (shared) before the
  // runs diverge: 'none' = whole board each run, 'flop' = share flop & run
  // turn+river, 'turn' = share flop+turn & run only the river.
  let runShare = $state<'none' | 'flop' | 'turn'>('none');
  const sharedCount = $derived(runCount > 1 ? { none: 0, flop: 3, turn: 4 }[runShare] : 0);
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

  // ---- total pot → auto-fill ------------------------------------------------
  // Enter the total pot once; we divide among non-all-in players, subtracting
  // any amounts already entered (all-in players who typed their own number).
  let totalPot = $state('');
  let showTotalPot = $state(false);

  function splitTotalPot() {
    const total = decAmt(totalPot);
    if (!(total > 0)) { toast('Enter the total pot amount'); return; }
    // Sum amounts already entered (typically all-in players)
    const fixed = players.reduce((sum, p) => {
      const a = decAmt(p.amount);
      return sum + (a > 0 ? a : 0);
    }, 0);
    // Players with no amount yet get an equal share of the remainder
    const unfilled = players.filter(p => !(decAmt(p.amount) > 0));
    if (unfilled.length === 0) { toast('Every player already has an amount'); return; }
    const remainder = total - fixed;
    if (remainder <= 0) { toast('All-in amounts already exceed the total pot'); return; }
    const each = Math.round((remainder / unfilled.length) * 100) / 100;
    unfilled.forEach(p => { p.amount = String(each); });
    players = players; // trigger reactivity
    haptic(12);
  }

  // ---- smart guidance -------------------------------------------------------
  // Contextual hints that appear based on the current state — never blocks,
  // just a one-liner to help the user avoid the most common mistakes.
  const amounts = $derived(players.map(p => decAmt(p.amount) || 0));
  const hasAmounts = $derived(amounts.some(a => a > 0));
  const allSame = $derived(hasAmounts && new Set(amounts.filter(a => a > 0)).size === 1);
  const hasFolded = $derived(players.some(p => p.folded));
  const shortStack = $derived(hasAmounts && !allSame && amounts.filter(a => a > 0).length >= 2);

  // ---- card helpers ---------------------------------------------------------
  function normCard(tok: string): string | null {
    const m = /^([2-9tjqka])([cdhs])$/i.exec(tok);
    return m ? m[1].toUpperCase() + m[2].toLowerCase() : null;
  }
  function parseTokens(str: string): string[] {
    return (str || '').replace(/,/g, ' ').trim().split(/\s+/).map(normCard).filter(Boolean) as string[];
  }
  function fieldCount(ref: string): number {
    if (ref.startsWith('hole')) return holeCount;
    if (ref.endsWith('-shared')) return sharedCount;   // the dealt-once prefix
    return 5 - sharedCount;                             // each run's remaining cards (or full board)
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
      // Clamp typed input to this field's slot budget so a run / shared field can
      // never hold more cards than it should (which would overflow the board).
      const max = fieldCount(ref);
      const toks = parseTokens(val);
      runouts[key] = toks.length > max ? toks.slice(0, max).join(' ') : val;
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
  // All card fields in fill order: every player's hole cards, then each board/run.
  function allRefs(): string[] {
    const refs = players.map((_, i) => `hole:${i}`);
    for (let b = 0; b < boardCount; b++) {
      if (sharedCount > 0) refs.push(`board:${b}-shared`);
      for (let r = 0; r < runCount; r++) refs.push(`board:${b}-${r}`);
    }
    return refs;
  }
  // The next unfilled slot at or after `ref`, so the picker can flow across fields
  // (player 1 → player 2 → board) without closing between each.
  function nextEmptyAfter(ref: string): { ref: string; idx: number } | null {
    const refs = allRefs();
    for (let j = Math.max(0, refs.indexOf(ref)); j < refs.length; j++) {
      const filled = parseTokens(fieldValue(refs[j])).length;
      if (filled < fieldCount(refs[j])) return { ref: refs[j], idx: filled };
    }
    return null;
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

      // Auto-advance: next empty slot in this field, else flow into the next
      // field (next player or the board), else close once the hand is complete.
      if (newToks.length < maxCount) {
        pickerIdx = newToks.length;
        pickRank = null;
      } else {
        const nxt = nextEmptyAfter(pickerRef);
        if (nxt) { pickerRef = nxt.ref; pickerIdx = nxt.idx; pickRank = null; }
        else pickerOpen = false;
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

  const sharedFor = (rc: number, rs: 'none' | 'flop' | 'turn') => (rc > 1 ? { none: 0, flop: 3, turn: 4 }[rs] : 0);

  // Switch run structure WITHOUT losing cards already entered. We rebuild each
  // run's full board under the old split, then re-divide it under the new one —
  // so e.g. a flop entered while running once becomes the "dealt once" flop when
  // you switch to running turn + river twice, and existing turn/river cards stay
  // on their run. Brand-new runs start empty (you'll deal them differently).
  function setRunStructure(nextRunCount: number, nextRunShare: 'none' | 'flop' | 'turn') {
    const oldShared = sharedFor(runCount, runShare);
    const newShared = sharedFor(nextRunCount, nextRunShare);
    if (oldShared !== newShared || nextRunCount !== runCount) {
      const next: Record<string, string> = {};
      for (let b = 0; b < boardCount; b++) {
        const oldSharedCards = oldShared > 0 ? parseTokens(runouts[`${b}-shared`] || '').slice(0, oldShared) : [];
        const fulls: string[][] = [];
        for (let r = 0; r < runCount; r++) {
          const tail = parseTokens(runouts[`${b}-${r}`] || '').slice(0, 5 - oldShared);
          fulls.push([...oldSharedCards, ...tail].slice(0, 5));
        }
        if (newShared > 0) next[`${b}-shared`] = (fulls[0] || []).slice(0, newShared).join(' ');
        for (let r = 0; r < nextRunCount; r++) {
          const full = r < fulls.length ? fulls[r] : []; // brand-new runs start empty
          next[`${b}-${r}`] = full.slice(newShared, 5).join(' ');
        }
      }
      runouts = next;
    }
    runCount = nextRunCount;
    runShare = nextRunShare;
  }

  // ---- compute --------------------------------------------------------------
  async function compute() {
    result = null;
    resultHTML = '';
    try {
      const { resolve } = await import('$lib/engine/index.js');
      const builtPlayers = players.map((p, i) => {
        // accept comma decimals (phone keypads) — see the text input below
        const amount = decAmt(p.amount);
        if (!Number.isFinite(amount) || amount < 0) throw new Error(`Enter a valid "in pot" amount for ${p.name || 'Player ' + (i + 1)}`);
        return {
          id: 'p' + i, name: p.name.trim() || 'Player ' + (i + 1),
          hole: parseTokens(p.hole), // raw card strings — the engine parses them (passing objects throws)
          contributed: Math.round(amount * SCALE), folded: p.folded,
        };
      });

      const boards: any[] = [];
      for (let b = 0; b < boardCount; b++) {
        // Cards dealt once before the runs diverge (e.g. a shared flop), prepended to every run.
        // Clamp each piece to its slot budget so the assembled board can never exceed 5 cards
        // (e.g. stale cards left over from a different run setup don't overflow it).
        const shared = sharedCount > 0 ? parseTokens(runouts[`${b}-shared`] || '').slice(0, sharedCount) : [];
        const runs: any[] = [];
        for (let r = 0; r < runCount; r++) {
          const tail = parseTokens(runouts[`${b}-${r}`] || '').slice(0, 5 - sharedCount);
          const c = [...shared, ...tail]; // full board = shared + this run's cards
          const label = (boardCount > 1 ? `Board ${b + 1}` : 'Board') + (runCount > 1 ? ` Run ${r + 1}` : '');
          if (c.length < 3) throw new Error(`${label}: enter at least the flop (3 community cards)`);
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
            html += `<div class="p-2 rounded-lg bg-surface-2 border ${won ? 'border-win shadow-[0_0_26px_-8px_var(--color-win-glow)]' : 'border-border-soft'} ${pl.folded ? 'opacity-45' : ''}">`;
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

      // Each player collects — with a plain-English breakdown of where each chip
      // comes from, so you can physically push the pot one piece at a time.
      html += '<h3 class="text-xs font-semibold uppercase tracking-widest text-muted mt-4 mb-2">Each player collects</h3>';

      // Source/fraction wording for one segment (one pot, on one board/run).
      const potName = (i: number) => (r.pots.length > 1 ? potLabel(i).toLowerCase() : 'the pot');
      const boardName = (b: number) => (boardCount > 1 ? (b === 0 ? 'top board' : 'bottom board') : '');
      const runName = (rn: number) => (runCount > 1 ? `run ${rn + 1}` : '');
      const sourceLabel = (seg: any) => [potName(seg.pot), boardName(seg.board), runName(seg.run)].filter(Boolean).join(' · ');
      const fracWord = (n: number) => (({ 1: 'all of', 2: '½ of', 3: '⅓ of', 4: '¼ of' } as Record<number, string>)[n] || `1/${n} of`);
      const describe = (seg: any, pid: string) => {
        const src = sourceLabel(seg);
        const inHigh = (seg.highWinners || []).includes(pid);
        const inLow = (seg.lowWinners || []).includes(pid);
        if (seg.walkover) return `all of ${src}`;
        if (seg.lowWinners?.length) { // hi-lo: this segment split into halves
          if (inHigh && inLow) return `high + low of ${src}`;
          if (inLow) return `${seg.lowWinners.length > 1 ? 'shared ' : ''}low half of ${src}`;
          return `${seg.highWinners.length > 1 ? 'shared ' : ''}high half of ${src}`;
        }
        return `${fracWord(seg.highWinners.length)} ${src}`; // high-only / scoop
      };
      // Only worth itemising when the pot actually splits into pieces.
      const showBreakdown = r.pots.length > 1 || boardCount > 1 || runCount > 1 || hiLo;

      const totals = builtPlayers.map(p => ({ id: p.id, name: p.name, amt: r.awards[p.id] || 0, contributed: p.contributed, folded: p.folded })).sort((a, b) => b.amt - a.amt);
      totals.forEach(t => {
        const net = t.amt - t.contributed;
        const lines: string[] = [];
        if (r.returned && r.returned.id === t.id) lines.push(`uncalled bet back — <b>${fmt(r.returned.amount)}</b>`);
        for (const seg of r.breakdown as any[]) {
          const got = seg.shares?.[t.id] || 0;
          if (got > 0) lines.push(`${describe(seg, t.id)} — <b>${fmt(got)}</b>`);
        }
        const breakdown = (showBreakdown && lines.length)
          ? `<div class="text-xs text-muted mt-1.5 pt-1.5 border-t border-border-soft flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">${lines.map(l => `<span>${l}</span>`).join('')}</div>`
          : '';
        html += `<div class="player-row !flex-col !items-stretch gap-0"><div class="flex items-center justify-between gap-2"><div><span class="font-semibold">${esc(t.name)}</span> ${t.folded ? '<span class="pill">folded</span>' : ''}</div><div class="text-right"><div class="font-bold tabular-nums" style="font-family:var(--font-display)">${fmt(t.amt)}</div><div class="text-muted text-xs">${net >= 0 ? '+' : ''}${fmt(net)} vs put in ${fmt(t.contributed)}</div></div></div>${breakdown}</div>`;
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
            // Cards on the OTHER board(s) are out of the deck for this board's
            // runout enumeration — pass them as `dead` so a double board's two
            // equities use one consistent remaining deck (not a fresh 52 each).
            const dead = boards.flatMap((bd, j) => (j === b ? [] : bd.runs[0]));
            const streets: { label: string; board: any[]; unit: string }[] = [];
            if (full.length >= 3) streets.push({ label: 'After the flop', board: full.slice(0, 3), unit: 'turn+river combos' });
            if (full.length >= 4) streets.push({ label: 'After the turn', board: full.slice(0, 4), unit: 'possible rivers' });

            for (const st of streets) {
              let eq;
              try { eq = equityAt({ game, players: eqPlayers, board: st.board, hiLo, dead }); }
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
      // Escape: error messages embed the user's raw card text (e.g. "Invalid card:
      // ..."), and this string is rendered with {@html}, so an unescaped message
      // would be an HTML-injection vector.
      const msg = String(e?.message ?? 'Could not compute that').replace(/[&<>"]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
      resultHTML = `<div class="banner banner-warn mt-4">${msg}</div>`;
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
  <p class="text-muted text-sm mb-3">Tap the slots to pick cards — or type them (e.g. <code class="text-text">Ah Kh</code>). We'll work out who gets what.</p>

  <!-- Active game context — tap players who are in the hand -->
  {#if activeGame && activeGamePlayers.length >= 2}
    <div class="card !bg-surface !p-3 !mb-3 border-accent/30">
      <div class="text-sm mb-2.5">
        <span class="text-accent font-semibold">#{activeGame.id}</span>
        <span class="text-muted ml-1">{activeGame.name}</span>
        <span class="text-muted"> — who's in this hand?</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        {#each activeGamePlayers as name}
          {@const selected = selectedFromGame.has(name)}
          {@const isAllIn = allInFromGame.has(name)}
          <button class="text-sm px-3 py-1.5 rounded-lg border transition-all active:scale-95 {selected ? 'bg-accent/15 border-accent text-accent font-semibold' : 'bg-surface-2 border-border text-text hover:border-accent/40'}"
            onclick={() => toggleGamePlayer(name)}>
            {#if selected}✓ {/if}{name}
          </button>
        {/each}
      </div>

      <!-- Per-player all-in toggles — only shown when 2+ players selected -->
      {#if selectedFromGame.size >= 2}
        <div class="flex flex-wrap gap-1.5 mt-2">
          {#each [...selectedFromGame] as name}
            {@const isAllIn = allInFromGame.has(name)}
            <button class="text-xs px-2.5 py-1 rounded-lg border transition-all active:scale-95 {isAllIn ? 'bg-warn/15 border-warn text-[#f3cd6b] font-semibold' : 'bg-surface-2 border-border-soft text-muted hover:border-warn/40'}"
              onclick={() => toggleAllIn(name)}
              title="{name} is all-in for less">
              {name} {isAllIn ? '· all-in' : ''}
            </button>
          {/each}
          <span class="text-xs text-faint self-center ml-0.5">all-in?</span>
        </div>

        <!-- Optional: pot already built before this action -->
        {#if !showPotBefore}
          <button class="text-xs text-muted underline decoration-dotted mt-2" onclick={() => showPotBefore = true}>
            Pot already has money in it?
          </button>
        {:else}
          <div class="flex items-center gap-2 mt-2">
            <span class="text-xs text-muted shrink-0">Pot before:</span>
            <input class="input !py-1.5 !px-3 !text-sm flex-1" type="text" inputmode="decimal"
              bind:value={potBefore} placeholder="e.g. 50" />
            <span class="text-xs text-muted shrink-0">{activeGameUnit}</span>
            <button class="text-xs text-faint hover:text-text" onclick={() => { showPotBefore = false; potBefore = ''; }}>✕</button>
          </div>
          <p class="text-xs text-faint mt-1">We'll split it evenly as each player's starting contribution.</p>
        {/if}

        <button class="btn-small btn w-full mt-2.5" onclick={applySelectedPlayers}>
          Set up for {selectedFromGame.size} players{allInFromGame.size ? ` (${allInFromGame.size} all-in)` : ''}
        </button>
      {/if}
    </div>
  {/if}

  <button class="btn-small btn-secondary mb-4" onclick={loadExample}>Try an example →</button>

  <!-- Game options -->
  <div class="card">
    <!-- Variant: the only choice most hands need -->
    <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1">
      <button class="py-2.5 rounded-lg font-semibold text-sm transition-all {game === 'holdem' ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { game = 'holdem'; haptic(8); }}>Hold'em</button>
      <button class="py-2.5 rounded-lg font-semibold text-sm transition-all {game === 'omaha' ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => { game = 'omaha'; haptic(8); }}>Omaha / PLO</button>
    </div>

    {#if game === 'omaha'}
      <div class="flex gap-1.5 mt-3 flex-wrap">
        <button class="btn-small {boardCount === 2 ? 'btn' : 'btn-secondary'}" onclick={() => { boardCount = boardCount === 2 ? 1 : 2; haptic(8); }}>
          {boardCount === 2 ? '✓ Double board' : 'Double board'}
        </button>
        <button class="btn-small {hiLo ? 'btn' : 'btn-secondary'}" onclick={() => { hiLo = !hiLo; haptic(8); }}>
          {hiLo ? '✓ Hi-Lo' : 'Hi-Lo'}
        </button>
      </div>
    {/if}

    <details class="mt-3">
      <summary class="text-sm text-muted cursor-pointer">{game === 'omaha' ? 'Run it twice · more options' : 'Double board · run it twice · hi-lo'}</summary>

      <label class="block text-xs text-muted font-medium mb-1 mt-3">Boards</label>
      <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-3">
        <button class="py-2 rounded-lg font-semibold text-sm transition-all {boardCount === 1 ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
          onclick={() => { boardCount = 1; haptic(8); }}>Single board</button>
        <button class="py-2 rounded-lg font-semibold text-sm transition-all {boardCount === 2 ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
          onclick={() => { boardCount = 2; haptic(8); }}>Double board</button>
      </div>

      <label class="block text-xs text-muted font-medium mb-1">Run it</label>
      <div class="grid grid-cols-3 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-3">
        {#each [{ v: 1, l: 'Once' }, { v: 2, l: 'Twice' }, { v: 3, l: '3 times' }] as opt}
          <button class="py-2 rounded-lg font-semibold text-sm transition-all {runCount === opt.v ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
            onclick={() => { setRunStructure(opt.v, runShare); haptic(8); }}>{opt.l}</button>
        {/each}
      </div>

      {#if runCount > 1}
        <label class="block text-xs text-muted font-medium mb-1">Run which cards {runCount} times</label>
        <div class="grid grid-cols-3 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-1">
          {#each [{ v: 'none', l: 'Whole board' }, { v: 'flop', l: 'Turn + river' }, { v: 'turn', l: 'River only' }] as opt}
            <button class="py-2 rounded-lg font-semibold text-xs sm:text-sm transition-all {runShare === opt.v ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
              onclick={() => { setRunStructure(runCount, opt.v as any); haptic(8); }}>{opt.l}</button>
          {/each}
        </div>
        <p class="text-muted text-xs mb-3">
          {runShare === 'none'
            ? 'Each run gets a completely separate board.'
            : runShare === 'flop'
              ? `Flop is dealt once; turn + river run ${runCount} different ways.`
              : `Flop + turn are dealt once; only the river runs ${runCount} different ways.`}
        </p>
      {/if}

      <label class="block text-xs text-muted font-medium mb-1">Hi-Lo split</label>
      <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1">
        <button class="py-2 rounded-lg font-semibold text-sm transition-all {!hiLo ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
          onclick={() => { hiLo = false; haptic(8); }}>High only</button>
        <button class="py-2 rounded-lg font-semibold text-sm transition-all {hiLo ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
          onclick={() => { hiLo = true; haptic(8); }}>8-or-better</button>
      </div>
    </details>
  </div>

  <!-- Community cards -->
  <div class="card">
    <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">
      Community cards {boardCount * runCount > 1 ? `(${boardCount} board${boardCount > 1 ? 's' : ''} × ${runCount} run${runCount > 1 ? 's' : ''})` : ''}
    </h3>
    {#snippet cardSlots(ref: string)}
      {@const slots = getSlots(ref)}
      <div class="flex flex-wrap gap-[7px]">
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
    {/snippet}
    {#snippet typeInput(ref: string, label?: string)}
      {#if label}
        <!-- Inline label variant — used by the run-it-twice fork, where the type
             fields sit in a compact stack under the card fork. -->
        <div class="flex items-center gap-2 mt-1.5">
          <span class="text-[11px] text-muted w-16 shrink-0">{label}</span>
          <input class="input !py-1.5 !px-3 !text-sm font-mono flex-1 min-w-0" placeholder="or type — e.g. Th 9h"
            value={fieldValue(ref)} oninput={(e) => setFieldValue(ref, (e.target as HTMLInputElement).value)} autocapitalize="none" autocomplete="off" spellcheck="false" />
        </div>
      {:else}
        <input class="input !py-1.5 !px-3 !text-sm mt-2 font-mono" placeholder="or type — e.g. Th 9h 4c"
          value={fieldValue(ref)} oninput={(e) => setFieldValue(ref, (e.target as HTMLInputElement).value)} autocapitalize="none" autocomplete="off" spellcheck="false" />
      {/if}
    {/snippet}

    {#each { length: boardCount } as _, b}
      {#if sharedCount > 0 && runCount > 1}
        <!-- One board that forks: the shared flop is dealt once, and the turn+river
             runs branch straight off it. The runs are centred against the flop so
             each one straddles the flop's line (one nudged up, one down) — it reads
             as a single continuous board diverging into its runouts, not as
             separate rows. -->
        <div class="rounded-xl border border-border-soft p-3 mb-3">
          {#if boardCount > 1}<div class="text-xs text-muted font-medium mb-2">Board {b + 1}</div>{/if}
          <!-- Card fork (the type-to-enter fields live in the stack below). -->
          <div class="flex items-center gap-x-2 overflow-x-auto pb-1">
            <!-- Shared flop, dealt once -->
            <div class="shrink-0">
              <div class="text-xs text-muted font-medium mb-1.5">{sharedCount === 3 ? 'Flop' : 'Flop + turn'} · dealt once</div>
              {@render cardSlots(`board:${b}-shared`)}
            </div>
            <!-- Runs branch off, vertically straddling the flop line -->
            <div class="shrink-0 flex flex-col gap-1.5">
              {#each { length: runCount } as _, r}
                <div>
                  <div class="text-[11px] text-accent/90 font-semibold mb-1">Run {r + 1} · {sharedCount === 3 ? 'turn + river' : 'river'}</div>
                  {@render cardSlots(`board:${b}-${r}`)}
                </div>
              {/each}
            </div>
          </div>
          <!-- Optional type-to-enter, one compact labelled row per part -->
          <div class="mt-2">
            {@render typeInput(`board:${b}-shared`, sharedCount === 3 ? 'Flop' : 'Flop+T')}
            {#each { length: runCount } as _, r}
              {@render typeInput(`board:${b}-${r}`, `Run ${r + 1}`)}
            {/each}
          </div>
        </div>
      {:else}
        {#each { length: runCount } as _, r}
          {@const base = (boardCount > 1 ? `Board ${b + 1}` : 'Board') + (runCount > 1 ? ` · Run ${r + 1}` : '')}
          <div class="mb-3">
            <div class="text-xs text-muted font-medium mb-1.5">{base}</div>
            {@render cardSlots(`board:${b}-${r}`)}
            {@render typeInput(`board:${b}-${r}`)}
          </div>
        {/each}
      {/if}
    {/each}
    <p class="text-muted text-xs">Tap a slot to pick a card. 3–5 cards per board.{#if sharedCount > 0 && runCount > 1} The shared cards are dealt once; each run only needs its remaining card{sharedCount === 3 ? 's' : ''}.{:else if boardCount > 1} Each board is dealt independently.{/if}</p>
  </div>

  <!-- Players -->
  <div class="card">
    <div class="flex items-center justify-between gap-2 mb-2">
      <h3 class="text-xs font-semibold uppercase tracking-widest text-muted m-0">Players</h3>
      {#if !showTotalPot}
        <button class="text-xs text-muted underline decoration-dotted" onclick={() => showTotalPot = true}>Enter total pot</button>
      {/if}
    </div>

    {#if showTotalPot}
      <div class="bg-surface-2 rounded-xl p-3 mb-3 border border-border-soft">
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted shrink-0 font-medium">Total pot</span>
          <input class="input !py-1.5 !px-3 !text-sm flex-1" type="text" inputmode="decimal"
            bind:value={totalPot} placeholder="e.g. 150"
            onkeydown={(e) => { if (e.key === 'Enter') splitTotalPot(); }} />
          <button class="btn-small btn" onclick={splitTotalPot}>Split</button>
          <button class="text-xs text-faint hover:text-text shrink-0 p-1" onclick={() => { showTotalPot = false; totalPot = ''; }}>✕</button>
        </div>
        <p class="text-xs text-faint mt-1.5">Players with an amount already filled in keep theirs (all-in). The rest is split evenly among the others.</p>
      </div>
    {/if}
    {#each players as p, i}
      {@const ref = `hole:${i}`}
      {@const slots = getSlots(ref)}
      <div class="card !bg-surface-2 !p-3 !mb-2 {allInFromGame.has(p.name) ? '!border-warn/30' : ''}">
        {#if allInFromGame.has(p.name)}
          <div class="text-xs text-[#f3cd6b] font-semibold mb-1.5">All-in — enter their total in the pot</div>
        {/if}
        <div class="flex gap-2 mb-2">
          <div class="flex-[1.2] relative">
            <input class="input w-full !py-2 !px-3" bind:value={p.name} placeholder="Player {i + 1}" autocomplete="off"
              onfocus={(e) => { (e.target as HTMLElement).dataset.showSuggest = '1'; }}
              onblur={(e) => { setTimeout(() => { (e.target as HTMLElement).dataset.showSuggest = ''; }, 150); }} />
            {#if activeGamePlayers.length > 0 && !p.name}
              <div class="absolute top-full left-0 right-0 z-20 mt-1 bg-surface border border-border rounded-xl shadow-xl max-h-40 overflow-y-auto">
                {#each activeGamePlayers.filter(n => !players.some((pp, j) => j !== i && pp.name === n)) as suggestion}
                  <button class="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 first:rounded-t-xl last:rounded-b-xl"
                    onmousedown={(e) => { e.preventDefault(); players[i].name = suggestion; players = players; }}>
                    {suggestion}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <input class="input flex-[0.8] !py-2 !px-3" type="text" inputmode="decimal" bind:value={p.amount} placeholder="in pot ({activeGameUnit})" />
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
        <input class="input !py-1.5 !px-3 !text-sm mb-2 font-mono" placeholder="or type — e.g. {game === 'omaha' ? 'Ah Kh Qh Jh' : 'Ah Kh'}"
          value={fieldValue(ref)} oninput={(e) => setFieldValue(ref, (e.target as HTMLInputElement).value)} autocapitalize="none" autocomplete="off" spellcheck="false" />
        <label class="flex items-center justify-between cursor-pointer">
          <span class="text-muted text-xs">Folded (forfeits, still funds pot)</span>
          <input type="checkbox" bind:checked={p.folded} class="accent-accent w-4 h-4" />
        </label>
        <!-- Per-player all-in hint -->
        {#if shortStack && amounts[i] > 0 && !p.folded}
          {@const myAmt = amounts[i]}
          {@const maxAmt = Math.max(...amounts)}
          {#if myAmt < maxAmt}
            {@const maxWin = amounts.reduce((s: number, a: number) => s + Math.min(a, myAmt), 0)}
            <div class="text-xs text-warn mt-1.5">All-in short — can only win up to {money(maxWin, '€')} (main pot)</div>
          {:else if myAmt === maxAmt && amounts.filter(a => a > 0 && a < maxAmt).length > 0}
            <div class="text-xs text-accent mt-1.5">Covers all — eligible for every pot</div>
          {/if}
        {/if}
        {#if players.length > 2}
          <button class="btn-small btn-danger mt-1.5" onclick={() => removePlayer(i)}>Remove</button>
        {/if}
      </div>
    {/each}
    <div class="flex gap-2 mt-2">
      <button class="btn-small btn-secondary w-full" onclick={addPlayer}>+ Add player</button>
    </div>
    <!-- Contextual guidance — appears based on the state of the hand -->
    {#if !hasAmounts}
      <p class="text-muted text-xs mt-2">"In pot" = how much that player put in this hand (not the total pot). Different amounts? That's fine — we'll split into side pots automatically.</p>
    {:else if shortStack}
      <div class="banner banner-info text-xs mt-2 !mb-0 !p-2.5">
        Different amounts — we'll create side pots. The short stack can only win what they matched. Make sure each amount is what that player actually put in, not the total pot.
      </div>
    {:else if allSame && !hasFolded}
      <p class="text-accent text-xs mt-2 font-medium">All matched at {money(amounts.find(a => a > 0) || 0, '€')} each — straight split, no side pots.</p>
    {:else if hasFolded && allSame}
      <p class="text-muted text-xs mt-2">Folded players' chips stay in the pot but they can't win. Everyone else matched evenly.</p>
    {:else}
      <p class="text-muted text-xs mt-2">"In pot" = how much that player put in. Short stacks make side pots automatically.</p>
    {/if}

    {#if boardCount > 1 && hasAmounts}
      <p class="text-muted text-xs mt-1">Double board: each pot splits evenly across both boards — enter the same "in pot" amounts, not half.</p>
    {/if}
    {#if runCount > 1 && hasAmounts}
      <p class="text-muted text-xs mt-1">Running it {runCount === 2 ? 'twice' : runCount + ' times'}: each pot splits across the runs — enter full "in pot" amounts.</p>
    {/if}
    {#if hiLo && hasAmounts}
      <p class="text-muted text-xs mt-1">Hi-Lo: each pot is halved — best high takes one half, best qualifying low (8-or-better) takes the other. No qualifier? High scoops.</p>
    {/if}
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
