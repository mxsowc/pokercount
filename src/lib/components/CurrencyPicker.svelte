<script lang="ts">
  // Searchable currency picker with free-text entry. `value` is the stored unit
  // string (a symbol like "€", a word like "chips", or anything the user types).
  import { CURRENCIES } from '$lib/utils/currencies.js';

  let { value = $bindable(''), placeholder = '€, $, zł, BB, chips…', id = undefined }:
    { value?: string; placeholder?: string; id?: string } = $props();

  let show = $state(false);
  let active = $state(-1);
  const matches = $derived.by(() => {
    const q = String(value || '').trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter((c) => c.s.toLowerCase().includes(q) || c.n.toLowerCase().includes(q));
  });
  function pick(c: { s: string; n: string }) { value = c.s; show = false; active = -1; }
  function onKey(e: KeyboardEvent) {
    if (!show || !matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Escape') { show = false; }
  }
</script>

<div class="relative">
  <input class="input w-full" bind:value {placeholder} {id} autocomplete="off"
         oninput={() => { show = true; active = -1; }}
         onfocus={() => { show = true; }}
         onkeydown={onKey}
         onblur={() => setTimeout(() => show = false, 150)} />
  {#if show && matches.length}
    <div class="absolute left-0 right-0 top-full mt-1 z-30 card !p-1 max-h-56 overflow-auto shadow-xl">
      {#each matches as c, i (c.s)}
        <button type="button"
                class="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg {i === active ? 'bg-surface-2' : 'hover:bg-surface-2'} transition-colors"
                onmousedown={(e) => { e.preventDefault(); pick(c); }}>
          <span class="w-9 shrink-0 font-bold tabular-nums">{c.s}</span>
          <span class="text-muted text-sm truncate">{c.n}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
