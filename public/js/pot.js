import { resolve } from '/src/index.js';
import { equityAt } from '/src/equity.js';
import { haptic } from '/js/fx.js';
import { capturePhoto, recognizeCards, hasRecognizer, setCardRecognizer, mockRecognizer } from '/js/cardscan.js';
import { onnxRecognizer } from '/js/cardscan-onnx.js';

const root = document.getElementById('pot-app');

// SPIKE: scan setup.
//   default      → try real on-device recognition (ONNX Runtime Web + a YOLOv8
//                  model at /models/cards-yolov8.onnx); fall back to the mock if
//                  the model/runtime can't load, so the flow still demos.
//   ?scan=mock   → force the placeholder recognizer (ignores the photo).
//   ?scan=off    → disable scanning entirely (graceful "tap to enter" fallback).
const scanMode = new URLSearchParams(location.search).get('scan');
let usedMockFallback = false; // true once we've had to drop to placeholder cards
let mockNoteShown = false;
// Auto-fill floor: a guess below this confidence is dropped (slot left empty for
// the user) rather than shown as a confident-looking wrong card.
const SCAN_TRUST = 0.45;
if (scanMode === 'mock') {
  setCardRecognizer(mockRecognizer());
  usedMockFallback = true;
} else if (scanMode !== 'off') {
  // Run inference at high resolution — card pips are tiny, and the model has a
  // dynamic input, so this is the biggest free accuracy lever (slower on WASM,
  // fast on WebGPU). Drop to 960 if it's too slow on your device.
  const real = onnxRecognizer({ size: 1280 });
  const mock = mockRecognizer();
  setCardRecognizer(async (bitmap, opts) => {
    try {
      return await real(bitmap, opts);
    } catch (e) {
      if (e.code === 'model-unavailable' || e.message === 'ort-load-failed') {
        usedMockFallback = true; // no model installed — demo with placeholders
        return mock(bitmap, opts);
      }
      throw e; // a genuine inference error: let scanField surface it
    }
  });
}

const state = {
  game: 'holdem',
  hiLo: false,
  boards: 1, // 1 or 2
  runs: 1, // runs per board (run it twice / thrice)
  players: [
    { name: '', hole: '', amount: '', folded: false },
    { name: '', hole: '', amount: '', folded: false },
  ],
  runouts: {}, // key `${board}-${run}` -> card string
};

// ---- read current DOM values back into state (before any structural redraw) --
function syncFromDOM() {
  // Cards live in state (written by the picker); only the typed fields are read.
  root.querySelectorAll('[data-player]').forEach((row) => {
    const i = +row.dataset.player;
    const p = state.players[i];
    if (!p) return;
    p.name = row.querySelector('[data-f="name"]').value;
    p.amount = row.querySelector('[data-f="amount"]').value;
    p.folded = row.querySelector('[data-f="folded"]').checked;
  });
}

// A tap-to-pick segmented control (replaces the native <select>).
function seg(name, options, current) {
  return `<div class="segmented" style="--n:${options.length}">
    ${options.map((o) => `<button type="button" class="seg-opt${String(o.value) === String(current) ? ' active' : ''}" data-seg-name="${name}" data-val="${o.value}">${o.label}</button>`).join('')}
  </div>`;
}

// ---- render ------------------------------------------------------------------
function render() {
  const holeCount = state.game === 'omaha' ? 4 : 2;
  root.innerHTML = `
    <div class="card">
      <h3>Game</h3>
      <label>Variant</label>
      ${seg('game', [{ value: 'omaha', label: 'Omaha / PLO' }, { value: 'holdem', label: "Hold'em" }], state.game)}
      <label>Boards</label>
      ${seg('boards', [{ value: 1, label: 'Single board' }, { value: 2, label: 'Double board' }], state.boards)}
      <label>Run it</label>
      ${seg('runs', [{ value: 1, label: 'Once' }, { value: 2, label: 'Twice' }, { value: 3, label: '3 times' }], state.runs)}
      <label>Hi-Lo split</label>
      ${seg('hiLo', [{ value: 'no', label: 'High only' }, { value: 'yes', label: '8-or-better' }], state.hiLo ? 'yes' : 'no')}
    </div>

    <div class="card">
      <h3>Community cards ${state.boards * state.runs > 1 ? `(${state.boards} board${state.boards > 1 ? 's' : ''} × ${state.runs} run${state.runs > 1 ? 's' : ''})` : ''}</h3>
      ${boardInputs()}
      <p class="hint">Tap a slot to pick a card. 3–5 cards per board.</p>
    </div>

    <div class="card">
      <h3>Players · amount in the pot</h3>
      ${state.players.map((p, i) => playerRow(p, i, holeCount)).join('')}
      <div class="list-add">
        <button class="secondary" data-act="add-player">+ Add player</button>
        <button class="ghost" data-act="example">Load example</button>
      </div>
      <p class="hint">“In pot” = how much that player put in. Short stacks make side pots automatically;
        whoever folded still funds the pot but can’t win it.</p>
    </div>

    <div class="split-cta"><button style="width:100%" data-act="compute">Split the pot</button></div>
    <div id="result" style="margin-top:16px"></div>
  `;
  wire();
}

function boardInputs() {
  let html = '';
  for (let b = 0; b < state.boards; b++) {
    for (let r = 0; r < state.runs; r++) {
      const key = `${b}-${r}`;
      const label =
        (state.boards > 1 ? `Board ${b + 1}` : 'Board') +
        (state.runs > 1 ? ` · Run ${r + 1}` : '');
      html += `<label>${label}</label>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
          ${cardSlots('board:' + key)}
          <button type="button" class="ghost small" data-scan="board:${key}">📷 Scan</button>
        </div>`;
    }
  }
  return html;
}

function playerRow(p, i, holeCount) {
  return `
    <div class="card" style="background:var(--surface-2);padding:12px" data-player="${i}">
      <div class="row tight">
        <input data-f="name" placeholder="Player ${i + 1}" value="${esc(p.name)}" style="flex:1.2" />
        <input data-f="amount" type="number" inputmode="decimal" step="any" min="0" placeholder="in pot" value="${esc(p.amount)}" style="flex:.8" />
      </div>
      <div class="small muted" style="margin-top:10px;margin-bottom:2px">${holeCount} hole cards</div>
      ${cardSlots('hole:' + i)}
      <label class="spread" style="margin-top:8px;cursor:pointer">
        <span class="small muted">Folded (forfeits, still funds pot)</span>
        <input data-f="folded" type="checkbox" ${p.folded ? 'checked' : ''} style="width:auto" />
      </label>
      ${state.players.length > 2 ? `<button class="small danger" data-rm="${i}" style="margin-top:6px">Remove</button>` : ''}
    </div>`;
}

// ---- events ------------------------------------------------------------------
function wire() {
  root.querySelectorAll('.seg-opt').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.classList.contains('active')) return;
      syncFromDOM();
      const name = b.dataset.segName, val = b.dataset.val;
      if (name === 'game') {
        state.game = val;
        const hc = val === 'omaha' ? 4 : 2; // trim extra hole cards for Hold'em
        state.players.forEach((p) => { p.hole = parseTokens(p.hole).slice(0, hc).join(' '); });
      } else if (name === 'hiLo') state.hiLo = val === 'yes';
      else if (name === 'boards') state.boards = +val;
      else if (name === 'runs') state.runs = +val;
      haptic(8);
      render();
    }));

  root.querySelectorAll('[data-slot]').forEach((b) =>
    b.addEventListener('click', () => { syncFromDOM(); openPicker(b.dataset.slot, +b.dataset.idx); }));

  root.querySelectorAll('[data-scan]').forEach((b) =>
    b.addEventListener('click', () => scanField(b.dataset.scan, b)));

  root.querySelector('[data-act="add-player"]')?.addEventListener('click', () => {
    syncFromDOM();
    state.players.push({ name: '', hole: '', amount: '', folded: false });
    render();
  });
  root.querySelectorAll('[data-rm]').forEach((b) =>
    b.addEventListener('click', () => {
      syncFromDOM();
      state.players.splice(+b.dataset.rm, 1);
      render();
    }));
  root.querySelector('[data-act="example"]')?.addEventListener('click', loadExample);
  root.querySelector('[data-act="compute"]')?.addEventListener('click', compute);
}

// ---- compute -----------------------------------------------------------------
const SCALE = 100; // run the integer-chip engine in cents so decimals are exact

function compute() {
  syncFromDOM();
  const out = document.getElementById('result');
  try {
    const players = state.players.map((p, i) => {
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`Enter a valid "in pot" amount for ${p.name || 'Player ' + (i + 1)}`);
      return {
        id: 'p' + i,
        name: p.name.trim() || 'Player ' + (i + 1),
        hole: cards(p.hole),
        contributed: Math.round(amount * SCALE),
        folded: p.folded,
      };
    });
    const nameOf = Object.fromEntries(players.map((p) => [p.id, p.name]));

    const boards = [];
    for (let b = 0; b < state.boards; b++) {
      const runs = [];
      for (let r = 0; r < state.runs; r++) {
        const c = cards(state.runouts[`${b}-${r}`] || '');
        const label =
          (state.boards > 1 ? `Board ${b + 1}` : 'Board') + (state.runs > 1 ? ` Run ${r + 1}` : '');
        if (c.length < 3 || c.length > 5) throw new Error(`${label}: enter 3–5 community cards`);
        runs.push(c);
      }
      boards.push({ runs });
    }

    const result = resolve({
      game: state.game,
      hiLo: state.hiLo,
      players: players.map(({ name, ...p }) => p),
      boards,
    });

    let eqHTML = '';
    try { eqHTML = renderEquity(players, boards); } catch { eqHTML = ''; }
    out.innerHTML = renderResult(result, nameOf, players) + eqHTML;
  } catch (e) {
    out.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

// Fun stat: each contesting player's exact chance to win, measured AT THE FLOP
// and AT THE TURN (only the cards known by that street are used; the rest are
// enumerated over every possibility). Hi-lo shows expected pot share + a
// scoop / win-high / win-low breakdown.
function renderEquity(builtPlayers, boards) {
  const need = state.game === 'omaha' ? 4 : 2;
  const contesting = builtPlayers.filter((p) => !p.folded);
  if (contesting.length < 2) return '';
  if (contesting.some((p) => p.hole.length !== need)) return ''; // need everyone's full hand
  const playersArg = contesting.map((p) => ({ id: p.id, hole: p.hole }));
  const nameOf = (pid) => contesting.find((p) => p.id === pid).name;

  let html = '<h3>Chances of winning</h3>';
  for (let b = 0; b < boards.length; b++) {
    const full = boards[b].runs[0];
    const streets = [];
    if (full.length >= 3) streets.push({ label: 'After the flop', board: full.slice(0, 3), unit: 'turn+river combos' });
    if (full.length >= 4) streets.push({ label: 'After the turn', board: full.slice(0, 4), unit: 'possible rivers' });

    for (const st of streets) {
      let r;
      try { r = equityAt({ game: state.game, players: playersArg, board: st.board, hiLo: state.hiLo }); }
      catch { continue; }
      const head = (boards.length > 1 ? `Board ${b + 1} · ` : '') + st.label;
      html += `<div class="seg" style="border-left-color:var(--gold)">
        <div class="small muted" style="margin-bottom:8px">${esc(head)} — ${esc(st.board.join(' '))} · ${r.runouts.toLocaleString()} ${st.unit}</div>`;
      for (const e of r.equity.slice().sort((a, c) => c.equity - a.equity)) {
        const pct = e.equity * 100;
        const sub = state.hiLo
          ? `<div class="eqsub">scoop ${Math.round(e.scoop * 100)}% · high ${Math.round(e.winHigh * 100)}% · low ${Math.round(e.winLow * 100)}%</div>`
          : '';
        html += `<div class="eqrow">
          <span class="eqname">${esc(nameOf(e.id))}</span>
          <div class="eqbar"><div class="eqfill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="eqpct">${pct.toFixed(1)}%</span>
        </div>${sub}`;
      }
      html += '</div>';
    }
  }
  html += `<p class="hint">${state.hiLo
    ? 'Bars show each player’s expected <b>share of the pot</b> (hi-lo splits it). “scoop” = win the whole pot; “high”/“low” = win that half. Folded players excluded.'
    : 'Each player’s exact chance to win once the remaining cards run out — found by checking every possible runout. Folded players excluded.'}</p>`;
  return html;
}

// ---- card graphics + visual showdown (so you can confirm the cards) ----------
const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
function cardHTML(str, i = 0) {
  const m = /^([2-9tjqkatTJQKA])([cdhs])$/i.exec((str || '').trim());
  if (!m) return '';
  const rank = m[1].toUpperCase() === 'T' ? '10' : m[1].toUpperCase();
  const suit = m[2].toLowerCase();
  const red = suit === 'h' || suit === 'd';
  return `<div class="pcard${red ? ' red' : ''}" style="animation-delay:${i * 45}ms"><span>${rank}</span><b>${SUIT[suit]}</b></div>`;
}

function renderShowdown(r, players) {
  // Which players won something on each (board, run) segment.
  const winners = {};
  for (const seg of r.breakdown) {
    const k = `${seg.board}-${seg.run}`;
    (winners[k] = winners[k] || new Set());
    [...(seg.highWinners || []), ...(seg.lowWinners || [])].forEach((id) => winners[k].add(id));
  }

  let html = '<h3>Showdown</h3>';
  for (let b = 0; b < state.boards; b++) {
    for (let rn = 0; rn < state.runs; rn++) {
      const k = `${b}-${rn}`;
      const board = cards(state.runouts[k] || '');
      const wins = winners[k] || new Set();
      const label =
        (state.boards > 1 ? `Board ${b + 1}` : 'Board') + (state.runs > 1 ? ` · Run ${rn + 1}` : '');
      html += `<div class="showdown">
        <div class="sd-label">${label}</div>
        <div class="sd-board">${board.map((c, i) => cardHTML(c, i)).join('') || '<span class="muted small">—</span>'}</div>
        <div class="sd-players">
          ${players.map((p) => {
            const won = wins.has(p.id);
            const tag = p.folded
              ? '<span class="pill">folded</span>'
              : (won ? '<span class="pill win">won</span>' : '');
            return `<div class="sd-player${won ? ' won' : ''}${p.folded ? ' folded' : ''}">
              <div class="sd-cards">${(p.hole || []).map((c, i) => cardHTML(c, i)).join('') || '<span class="muted small">no cards</span>'}</div>
              <div class="sd-name">${esc(p.name)} ${tag}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }
  }
  return html;
}

function renderResult(r, nameOf, players) {
  const fmt = (cents) => '€' + (cents / SCALE).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const name = (id) => nameOf[id] || id;

  // Final totals (authoritative).
  const totals = players
    .map((p) => ({ name: p.name, amt: r.awards[p.id] || 0, contributed: p.contributed, folded: p.folded }))
    .sort((a, b) => b.amt - a.amt);

  let html = '<h2>Result</h2>';

  if (r.returned) {
    html += `<div class="banner info">Uncalled bet of <b>${fmt(r.returned.amount)}</b> returned to ${esc(name(r.returned.id))} (no one matched it).</div>`;
  }

  html += renderShowdown(r, players);

  html += '<h3>Pots</h3>';
  r.pots.forEach((pot, i) => {
    const label = i === 0 ? 'Main pot' : `Side pot ${i}`;
    html += `<div class="seg breakdown"><b>${label}: ${fmt(pot.amount)}</b><br>
      <span class="small muted">contested by ${pot.eligible.map((id) => esc(name(id))).join(', ')}</span></div>`;
  });

  html += '<h3>How each pot was won</h3><div class="breakdown">';
  r.breakdown.forEach((seg) => {
    if (seg.amount === 0) return;
    const where =
      (r.pots.length > 1 ? (seg.pot === 0 ? 'Main pot' : `Side pot ${seg.pot}`) : 'Pot') +
      (state.boards > 1 ? ` · Board ${seg.board + 1}` : '') +
      (state.runs > 1 ? ` · Run ${seg.run + 1}` : '');
    let line;
    if (seg.walkover) {
      line = `${esc(name(seg.highWinners[0]))} takes ${fmt(seg.amount)} uncontested`;
    } else if (seg.lowWinners && seg.lowWinners.length) {
      const high = seg.highWinners.map((id) => esc(name(id))).join(' & ');
      const low = seg.lowWinners.map((id) => esc(name(id))).join(' & ');
      line = `<span class="who">High ½:</span> ${high} (${seg.highHand})<br>
              <span class="who">Low ½:</span> ${low} (${seg.lowHand})`;
    } else {
      const who = seg.highWinners.map((id) => esc(name(id))).join(' & ');
      line = `${who} win${seg.highWinners.length > 1 ? ' (split)' : 's'} ${fmt(seg.amount)}${seg.highHand && seg.highHand !== 'uncontested' ? ` with ${seg.highHand}` : ''}${seg.scoop ? ' — scoops (no qualifying low)' : ''}`;
    }
    html += `<div class="seg"><div class="small muted">${where} · ${fmt(seg.amount)}</div>${line}</div>`;
  });
  html += '</div>';

  html += '<h3>Each player collects</h3>';
  totals.forEach((t) => {
    const net = t.amt - t.contributed;
    html += `<div class="player">
      <div><span class="name">${esc(t.name)}</span> ${t.folded ? '<span class="pill">folded</span>' : ''}</div>
      <div style="text-align:right">
        <div class="amt">${fmt(t.amt)}</div>
        <div class="meta">${net >= 0 ? '+' : ''}${fmt(net)} vs put in ${fmt(t.contributed)}</div>
      </div>
    </div>`;
  });

  html += `<p class="small muted center" style="margin-top:8px">Total distributed ${fmt(r.total)} — matches every chip put in.</p>`;
  return html;
}

// ---- example -----------------------------------------------------------------
function loadExample() {
  state.game = 'omaha';
  state.hiLo = false;
  state.boards = 2;
  state.runs = 1;
  state.players = [
    { name: 'Alice', hole: 'Ah Kh Qh Jh', amount: '100', folded: false }, // short all-in
    { name: 'Bob', hole: 'As Ks Qs Js', amount: '300', folded: false },
    { name: 'Cara', hole: '2c 2d 7c 8d', amount: '300', folded: false }, // covers
  ];
  state.runouts = { '0-0': 'Th 9h 4c 2s 5d', '1-0': '8s 6s 5s 2h Kd' };
  render();
  setTimeout(compute, 0);
}

// ---- util --------------------------------------------------------------------
function cards(str) {
  return (str || '').replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ===== tap-to-pick card system ================================================
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = ['s', 'h', 'd', 'c'];

function normCard(tok) {
  const m = /^([2-9tjqka])([cdhs])$/i.exec(tok);
  return m ? m[1].toUpperCase() + m[2].toLowerCase() : null;
}
function parseTokens(str) {
  return (str || '').replace(/,/g, ' ').trim().split(/\s+/).map(normCard).filter(Boolean);
}
function cardParts(tok) {
  const suit = tok[1];
  return { rank: tok[0] === 'T' ? '10' : tok[0], suit, red: suit === 'h' || suit === 'd' };
}

// A field is "hole:<playerIndex>" or "board:<board>-<run>".
function fieldCount(ref) { return ref.startsWith('hole') ? (state.game === 'omaha' ? 4 : 2) : 5; }
function fieldValue(ref) {
  const [kind, key] = ref.split(':');
  return kind === 'hole' ? (state.players[+key] ? state.players[+key].hole : '') : (state.runouts[key] || '');
}
function setFieldValue(ref, val) {
  const [kind, key] = ref.split(':');
  if (kind === 'hole') { if (state.players[+key]) state.players[+key].hole = val; }
  else state.runouts[key] = val;
}

function cardSlots(ref) {
  const count = fieldCount(ref);
  const toks = parseTokens(fieldValue(ref));
  let html = '<div class="cardslots">';
  for (let i = 0; i < count; i++) {
    const t = toks[i];
    if (t) {
      const p = cardParts(t);
      html += `<button type="button" class="slot card${p.red ? ' red' : ''}" data-slot="${ref}" data-idx="${i}"><span>${p.rank}</span><b>${SUIT[p.suit]}</b></button>`;
    } else {
      html += `<button type="button" class="slot empty" data-slot="${ref}" data-idx="${i}">+</button>`;
    }
  }
  return html + '</div>';
}

// Every card already used elsewhere (so the picker can grey out duplicates).
function usedCards(exRef, exIdx) {
  const set = new Set();
  state.players.forEach((p, i) =>
    parseTokens(p.hole).forEach((t, idx) => { if (!(exRef === `hole:${i}` && idx === exIdx)) set.add(t); }));
  Object.entries(state.runouts).forEach(([k, v]) =>
    parseTokens(v).forEach((t, idx) => { if (!(exRef === `board:${k}` && idx === exIdx)) set.add(t); }));
  return set;
}

// ---- scan a field from a photo (SPIKE) ----
// Snap → recognizer guesses → we drop them into the field as a DRAFT through the
// same validation the manual picker uses (canonicalize, drop dupes/already-placed
// cards, cap at the field's card count). The user then fixes any wrong card with
// the existing tap picker. The scan is an accelerator, never the source of truth.
async function scanField(ref, btn) {
  if (!hasRecognizer()) {
    alert('Card scanning is turned off (?scan=off) — tap each slot to pick cards.');
    return;
  }
  syncFromDOM();
  const file = await capturePhoto();
  if (!file) return; // cancelled

  if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; } // model + wasm load on first run

  let results;
  try {
    results = await recognizeCards(file, { count: fieldCount(ref), kind: ref.split(':')[0] });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📷 Scan'; }
    if (e && e.code === 'bad-classes') {
      alert('The recognition model’s card list looks wrong (' + e.message + '). '
        + 'Every card would be mislabelled — fix /models/cards-classes.json to match the model before scanning.');
    } else {
      alert('Couldn’t read that photo. Try again with the cards flat, spread out and well lit — '
        + 'or tap each slot to enter them.');
    }
    return;
  }

  setFieldValue(ref, ''); // replacing this field — free its cards for dedupe
  const used = usedCards(ref, -1);
  const want = fieldCount(ref);
  const seen = new Set();
  const tokens = [];
  for (const r of results) {
    if (r && r.confidence != null && r.confidence < SCAN_TRUST) continue; // too shaky to auto-fill
    const card = normCard(r && r.card);
    if (!card || seen.has(card) || used.has(card)) continue; // invalid / duplicate / used elsewhere
    seen.add(card);
    tokens.push(card);
    if (tokens.length >= want) break;
  }
  setFieldValue(ref, tokens.join(' '));
  haptic(12);
  render(); // slots update; user can tap any wrong card to fix it

  if (usedMockFallback && !mockNoteShown) {
    mockNoteShown = true;
    alert('No recognition model is installed (/models/cards-yolov8.onnx), so these are '
      + 'PLACEHOLDER cards — not read from your photo. The flow is real; the model is the '
      + 'missing piece (see /models/README.md). Tap any slot to correct a card.');
  } else if (!usedMockFallback) {
    if (tokens.length === 0) {
      alert('No cards recognized confidently. Try flatter, well-lit, non-overlapping cards — '
        + 'or tap each slot to enter them.');
    } else if (tokens.length < want) {
      alert(`Filled ${tokens.length} of ${want} cards I’m confident about — tap the empty slots `
        + 'to add the rest. (Low-confidence guesses are left blank on purpose.)');
    }
    // else: full confident read — the user just reviews the slots.
  }
  // Phase 2: surface low-confidence cards (results[i].confidence) so the user
  // knows which to double-check, instead of treating every guess as equal.
}

// ---- the picker (bottom sheet) ----
let pickerRef = null, pickerIdx = 0, pickRank = null, pickSuit = null;

const picker = document.createElement('div');
picker.className = 'picker-backdrop';
picker.hidden = true;
picker.innerHTML = `<div class="picker-sheet" role="dialog" aria-label="Pick a card">
  <div class="picker-head"><b id="picker-title">Pick a card</b><button class="ghost small" id="picker-done">Done</button></div>
  <div id="picker-body"></div>
</div>`;
document.body.appendChild(picker);
picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(); });
picker.querySelector('#picker-done').addEventListener('click', closePicker);

function openPicker(ref, idx) {
  pickerRef = ref; pickerIdx = idx;
  const existing = parseTokens(fieldValue(ref))[idx];
  pickRank = existing ? existing[0] : null;
  pickSuit = existing ? existing[1] : null;
  picker.hidden = false;
  renderPicker();
}
function closePicker() { picker.hidden = true; pickerRef = null; render(); }

function renderPicker() {
  const used = usedCards(pickerRef, pickerIdx);
  const which = pickerRef.startsWith('hole') ? 'hole card' : 'board card';
  picker.querySelector('#picker-title').textContent = `Pick a ${which} (${pickerIdx + 1})`;

  const rankBtns = RANKS.map((r) => {
    const fullyUsed = SUITS.every((s) => used.has(r + s));
    const sel = r === pickRank ? ' pick-sel' : '';
    const label = r === 'T' ? '10' : r;
    return `<button type="button" class="prank${sel}" data-rank="${r}" ${fullyUsed ? 'disabled' : ''}>${label}</button>`;
  }).join('');

  const suitBtns = SUITS.map((s) => {
    const disabled = !pickRank || used.has(pickRank + s);
    const sel = s === pickSuit ? ' pick-sel' : '';
    const red = s === 'h' || s === 'd' ? ' suit-red' : '';
    return `<button type="button" class="psuit${red}${sel}" data-suit="${s}" ${disabled ? 'disabled' : ''}>${SUIT[s]}</button>`;
  }).join('');

  picker.querySelector('#picker-body').innerHTML = `
    <div class="picker-hint">1. Rank</div>
    <div class="picker-ranks">${rankBtns}</div>
    <div class="picker-hint">2. Suit</div>
    <div class="picker-suits">${suitBtns}</div>
    <button class="ghost small" id="picker-clear">Clear this card</button>`;

  picker.querySelectorAll('[data-rank]').forEach((b) =>
    b.addEventListener('click', () => { pickRank = b.dataset.rank; if (used.has(pickRank + pickSuit)) pickSuit = null; tryCommit(); }));
  picker.querySelectorAll('[data-suit]').forEach((b) =>
    b.addEventListener('click', () => { pickSuit = b.dataset.suit; tryCommit(); }));
  picker.querySelector('#picker-clear').addEventListener('click', clearCard);
}

function tryCommit() {
  if (!pickRank || !pickSuit) { renderPicker(); return; }
  haptic(9);
  const card = pickRank + pickSuit;
  const toks = parseTokens(fieldValue(pickerRef));
  const wasAppend = pickerIdx >= toks.length;
  if (pickerIdx < toks.length) toks[pickerIdx] = card; else toks.push(card);
  setFieldValue(pickerRef, toks.slice(0, fieldCount(pickerRef)).join(' '));
  render(); // update the slots behind the sheet

  const filled = parseTokens(fieldValue(pickerRef)).length;
  if (wasAppend && filled < fieldCount(pickerRef)) {
    pickerIdx = filled; pickRank = null; pickSuit = null; renderPicker(); // next card
  } else {
    closePicker();
  }
}

function clearCard() {
  const toks = parseTokens(fieldValue(pickerRef));
  if (pickerIdx < toks.length) { toks.splice(pickerIdx, 1); setFieldValue(pickerRef, toks.join(' ')); }
  closePicker();
}

render();
