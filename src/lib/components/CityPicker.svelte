<script lang="ts">
  // City input with a light typeahead: as you type, up to 3 matching cities are
  // suggested and the list narrows. Free text is always kept — `value` is exactly
  // what's typed (or the picked city), and the server canonicalizes it to a slug,
  // so a city that isn't in the list still works.
  import { suggestCities } from '$lib/citylist.js';

  let { value = $bindable(''), placeholder = 'e.g. Amsterdam', id = undefined, maxlength = 60 }:
    { value?: string; placeholder?: string; id?: string; maxlength?: number } = $props();

  let show = $state(false);
  let active = $state(-1);
  const matches = $derived(suggestCities(value, 3));
  // Hide the dropdown once the text already equals the only/exact suggestion.
  const visible = $derived(
    show && matches.length > 0 &&
    !(matches.length === 1 && matches[0].name.toLowerCase() === value.trim().toLowerCase())
  );

  function pick(c: { name: string }) { value = c.name; show = false; active = -1; }
  function onKey(e: KeyboardEvent) {
    if (!visible) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Escape') { show = false; }
  }
</script>

<div class="relative">
  <input class="input w-full" bind:value {placeholder} {id} {maxlength} autocomplete="off"
         autocapitalize="words" spellcheck="false"
         oninput={() => { show = true; active = -1; }}
         onfocus={() => { show = true; }}
         onkeydown={onKey}
         onblur={() => setTimeout(() => show = false, 150)} />
  {#if visible}
    <div class="absolute left-0 right-0 top-full mt-1 z-30 card !p-1 shadow-xl">
      {#each matches as c, i (c.name + c.country)}
        <button type="button"
                class="flex items-center justify-between gap-2.5 w-full text-left px-2.5 py-2 rounded-lg {i === active ? 'bg-surface-2' : 'hover:bg-surface-2'} transition-colors"
                onmousedown={(e) => { e.preventDefault(); pick(c); }}>
          <span class="font-semibold truncate">{c.name}</span>
          <span class="text-faint text-xs shrink-0">{c.country}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
