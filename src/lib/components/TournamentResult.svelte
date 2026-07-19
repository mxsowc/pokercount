<script lang="ts">
  // Tournament end flow: the host ranks the paid finishers and edits the payout
  // split (seeded from a proposed structure). potcount splits the prize pool
  // (= total buy-ins) across the places and settles with the normal engine.
  import { money } from '$lib/utils/money';
  import { proposePayouts, payoutCents, normalizePayouts } from '$lib/payouts.js';

  let {
    game,
    api,
    onSettled = (_g: any) => {},
  }: {
    game: any;
    api: (method: string, path: string, body?: any) => Promise<any>;
    onSettled?: (g: any) => void;
  } = $props();

  const unit = $derived(game?.unit || '€');
  const players = $derived((game?.players ?? []) as { id: string; name: string }[]);
  const poolCents = $derived(
    (game?.transactions ?? []).reduce((s: number, t: any) => s + Math.round((t.amount || 0) * 100), 0)
  );
  const pool = $derived(poolCents / 100);

  // Rows pair a payout % with the player who finished in that place. Seeded once
  // from the proposed structure for this field size.
  let rows = $state<{ pct: number; playerId: string }[]>(
    proposePayouts(game?.players?.length || 0).map((pct: number) => ({ pct, playerId: '' }))
  );

  const cents = $derived(payoutCents(poolCents, rows.map((r) => r.pct)));
  const check = $derived(normalizePayouts(rows.map((r) => r.pct)));
  const assigned = $derived(rows.map((r) => r.playerId).filter(Boolean));
  const allSeated = $derived(rows.every((r) => r.playerId) && new Set(assigned).size === assigned.length);
  const ordinal = (i: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'][i] || `${i + 1}th`;

  // Players available for a given row: unassigned, plus the row's own current pick.
  function optionsFor(i: number) {
    const taken = new Set(rows.filter((_, j) => j !== i).map((r) => r.playerId).filter(Boolean));
    return players.filter((p) => !taken.has(p.id));
  }

  function addPlace() { rows = [...rows, { pct: 0, playerId: '' }]; }
  function removePlace(i: number) { rows = rows.filter((_, j) => j !== i); }
  function resetProposed() {
    rows = proposePayouts(players.length).map((pct: number) => ({ pct, playerId: '' }));
  }

  let busy = $state(false);
  let err = $state('');
  async function lockIn() {
    if (!allSeated || !check.valid) return;
    busy = true; err = '';
    try {
      const g = await api('PUT', `/api/games/${game.id}/tournament`, {
        places: rows.map((r) => r.playerId),
        payouts: rows.map((r) => r.pct),
      });
      onSettled(g);
    } catch (e: any) {
      err = e.message || 'Could not lock in the result';
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Tournament result</h3>
    <span class="text-sm">Prize pool <b class="text-text tabular-nums">{money(pool, unit)}</b></span>
  </div>
  <p class="text-muted text-sm mt-1.5">Pick who finished in each paid place, tweak the split if you like, then lock it in.</p>

  <div class="grid gap-2 mt-3">
    {#each rows as row, i (i)}
      <div class="flex items-center gap-2 flex-wrap">
        <span class="w-8 shrink-0 text-sm font-semibold text-muted">{ordinal(i)}</span>
        <select class="input flex-1 min-w-[9rem]" bind:value={row.playerId}>
          <option value="" disabled>Who finished {ordinal(i)}?</option>
          {#each optionsFor(i) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
        <div class="flex items-center gap-1">
          <input class="input w-16 text-right" type="number" min="0" max="100" bind:value={row.pct} />
          <span class="text-muted text-sm">%</span>
        </div>
        <span class="w-20 text-right tabular-nums text-sm shrink-0">{money((cents[i] || 0) / 100, unit)}</span>
        {#if rows.length > 1}
          <button class="text-faint hover:text-danger text-lg leading-none px-1" title="Remove place" aria-label="Remove place" onclick={() => removePlace(i)}>×</button>
        {/if}
      </div>
    {/each}
  </div>

  <div class="flex items-center gap-3 mt-2.5 flex-wrap text-xs">
    <button class="text-accent hover:underline" onclick={addPlace} disabled={rows.length >= players.length}>+ Pay another place</button>
    <button class="text-muted hover:text-text" onclick={resetProposed}>Reset to proposed</button>
    <span class="ml-auto tabular-nums {check.valid ? 'text-muted' : 'text-danger'}">Total: {check.sum}%{check.valid ? '' : ' (must be 100)'}</span>
  </div>

  <button class="btn w-full mt-3" disabled={busy || !allSeated || !check.valid} onclick={lockIn}>
    {busy ? 'Settling…' : 'Lock in tournament result'}
  </button>
  {#if !allSeated}<p class="text-faint text-xs mt-1.5">Assign a player to every paid place first.</p>{/if}
  {#if err}<p class="text-danger text-sm mt-1.5">{err}</p>{/if}
</div>
