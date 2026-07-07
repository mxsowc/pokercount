<script lang="ts">
  import { ago } from '$lib/utils/time';
  import { tick } from 'svelte';

  // A game's coordination thread. Presentational: the parent owns the game state
  // and passes a `send` that POSTs + refreshes it (so this works live via SSE in
  // both the scheduled lobby and the running table).
  let { messages = [], meId = null, canPost = false, signedIn = true, send }:
    { messages?: any[]; meId?: string | null; canPost?: boolean; signedIn?: boolean; send: (text: string) => Promise<void> } = $props();

  let text = $state('');
  let busy = $state(false);
  let scroller = $state<HTMLDivElement | null>(null);

  // Keep the newest message in view (own sends land at the bottom; live SSE
  // messages append too). Only snap when already near the bottom would be nicer,
  // but for a small coordination thread always-snap is fine.
  $effect(() => {
    void messages.length;
    if (scroller) tick().then(() => { if (scroller) scroller.scrollTop = scroller.scrollHeight; });
  });

  async function submit(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    busy = true;
    try { await send(t); text = ''; }
    catch { /* error is toasted by the caller; keep the draft so it isn't lost */ }
    finally { busy = false; }
  }
</script>

<div class="flex flex-col gap-2">
  {#if messages.length === 0}
    <p class="text-muted text-sm">No messages yet — say hi, share the address, sort out timing.</p>
  {:else}
    <div bind:this={scroller} class="flex flex-col gap-2 max-h-[46vh] overflow-y-auto pr-1">
      {#each messages as m (m.id)}
        {@const mine = !!m.userId && m.userId === meId}
        <div class="flex flex-col {mine ? 'items-end' : 'items-start'}">
          <div class="max-w-[85%] rounded-2xl px-3 py-2 text-sm {mine ? 'bg-accent/15 border border-accent/25' : 'bg-surface-2 border border-border-soft'}">
            <div class="text-xs text-muted mb-0.5">
              {#if m.handle}
                <a href="/u/{m.handle}" class="font-semibold text-info no-underline hover:underline">{m.name}</a>
              {:else}
                <span class="font-semibold">{m.name}</span>
              {/if}
              <span class="text-faint"> · {ago(m.at)}</span>
            </div>
            <div class="whitespace-pre-wrap break-words">{m.text}</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if canPost}
    <form class="flex gap-2 mt-1" onsubmit={submit}>
      <input class="input flex-1 !py-2.5" bind:value={text} maxlength="500" placeholder="Message the table…" aria-label="Message the table" enterkeyhint="send" />
      <button type="submit" class="btn !px-4" disabled={busy || !text.trim()}>Send</button>
    </form>
  {:else if !signedIn}
    <p class="text-xs text-faint">Sign in and join the game to post in the chat.</p>
  {:else}
    <p class="text-xs text-faint">Join the game to post in the chat.</p>
  {/if}
</div>
