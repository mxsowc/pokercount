<script lang="ts">
  // Searchable country picker. `value` is the stored ISO-2 code (e.g. "PL"); the
  // input shows the country name. Pick-only (no free text) so we can reliably map
  // the choice to a default game currency.
  import { COUNTRIES, countryName } from '$lib/utils/currencies.js';

  let { value = $bindable(''), placeholder = 'Start typing your country…' }:
    { value?: string; placeholder?: string } = $props();

  const sorted = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
  let query = $state(value ? countryName(value) : '');
  let show = $state(false);
  let active = $state(-1);

  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => c.name.toLowerCase().includes(q));
  });
  function pick(c: { code: string; name: string }) { value = c.code; query = c.name; show = false; active = -1; }
  // Revert half-typed text to the chosen country's name when focus leaves.
  function revert() { query = value ? countryName(value) : ''; }
  function onKey(e: KeyboardEvent) {
    if (!show || !matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Escape') { show = false; revert(); }
  }
</script>

<div class="relative">
  <input class="input w-full" bind:value={query} {placeholder} autocomplete="off"
         oninput={() => { show = true; active = -1; if (value) value = ''; }}
         onfocus={() => { show = true; }}
         onkeydown={onKey}
         onblur={() => setTimeout(() => { show = false; revert(); }, 150)} />
  {#if show && matches.length}
    <div class="absolute left-0 right-0 top-full mt-1 z-30 card !p-1 max-h-56 overflow-auto shadow-xl">
      {#each matches as c, i (c.code)}
        <button type="button"
                class="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg {i === active ? 'bg-surface-2' : 'hover:bg-surface-2'} transition-colors"
                onmousedown={(e) => { e.preventDefault(); pick(c); }}>
          <span class="truncate">{c.name}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
