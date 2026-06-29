<script lang="ts">
  let { data, form } = $props();
</script>

<svelte:head><title>potcount — unsubscribe</title><meta name="robots" content="noindex" /></svelte:head>

<div class="wrap" style="max-width:28rem">
  <h1 class="text-2xl font-bold mb-4">Email</h1>
  <div class="card">
    {#if form?.done}
      <h2 class="text-lg font-bold mb-1">Unsubscribed ✓</h2>
      <p class="text-muted text-sm">You won't get the monthly summary email any more. You can turn it back on whenever you like from your <a href="/account">account settings</a>.</p>
    {:else if !data.ok}
      <h2 class="text-lg font-bold mb-1">This link isn't valid</h2>
      <p class="text-muted text-sm">It may have expired or been mistyped. You can manage email from your <a href="/account">account settings</a>.</p>
    {:else if !data.subscribed}
      <h2 class="text-lg font-bold mb-1">Already unsubscribed</h2>
      <p class="text-muted text-sm">{data.handle ? '@' + data.handle : 'This account'} isn't subscribed to the monthly summary. Manage email in <a href="/account">account settings</a>.</p>
    {:else}
      <h2 class="text-lg font-bold mb-1">Unsubscribe?</h2>
      <p class="text-muted text-sm mb-3">Stop sending the monthly summary email to {data.handle ? '@' + data.handle : 'this account'}?</p>
      <form method="POST">
        <button class="btn-small btn-danger w-full" type="submit">Unsubscribe me</button>
      </form>
      <p class="text-faint text-xs text-center mt-2">You'll still be able to see all your stats in the app.</p>
    {/if}
  </div>
</div>
