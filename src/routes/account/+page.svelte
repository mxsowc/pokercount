<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import { money, fmtSigned } from '$lib/utils/money';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  let user = $derived($page.data?.user ?? null);
  let tab = $state<'login' | 'signup'>('login');
  let stats = $state<any>(null);

  // Login form
  let loginHandle = $state('');
  let loginPin = $state('');

  // Signup form
  let signupName = $state('');
  let signupPin = $state('');
  let signupPin2 = $state('');
  let handlePreview = $derived(signupName.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));

  async function doLogin() {
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: loginHandle.trim(), pin: loginPin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Login failed'); return; }
      await invalidateAll();
      toast('Logged in');
    } catch (e: any) { toast(e.message); }
  }

  async function doSignup() {
    if (handlePreview.length < 3 || handlePreview.length > 20) { toast('Name must be 3-20 characters'); return; }
    if (signupPin.length < 4) { toast('Passcode must be at least 4 characters'); return; }
    if (signupPin !== signupPin2) { toast("Passcodes don't match"); return; }
    try {
      const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: signupName, displayName: signupName, pin: signupPin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Signup failed'); return; }
      await invalidateAll();
      toast('Account created');
    } catch (e: any) { toast(e.message); }
  }

  async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    await invalidateAll();
    toast('Logged out');
  }

  async function loadStats() {
    if (!user) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.handle)}/stats`);
      const data = await res.json();
      stats = data.stats;
    } catch {}
  }

  $effect(() => { if (user) loadStats(); });
</script>

<svelte:head><title>potcount — account</title></svelte:head>

<div class="wrap">
  <h1 class="text-2xl font-bold mb-4">Account</h1>

  {#if user}
    <!-- Logged in -->
    <div class="card">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold m-0">{user.displayName}</h2>
          <div class="text-muted text-sm">@{user.handle} · {user.provider}</div>
        </div>
        <button class="btn-small btn-danger" onclick={doLogout}>Log out</button>
      </div>
      <p class="mt-3"><a href="/u/{user.handle}">View your public profile →</a></p>
    </div>

    {#if stats}
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3">Your stats</h2>
      <div class="grid grid-cols-3 gap-2.5 max-[380px]:grid-cols-2">
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {stats.totalProfit >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(stats.totalProfit)}</div>
          <div class="text-muted text-xs mt-1">total profit</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {stats.avgProfit >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{stats.gamesPlayed ? fmtSigned(stats.avgProfit) : '—'}</div>
          <div class="text-muted text-xs mt-1">avg / game</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.gamesPlayed ? stats.profitablePct + '%' : '—'}</div>
          <div class="text-muted text-xs mt-1">% profitable</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {(stats.best?.net ?? 0) >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{stats.best ? fmtSigned(stats.best.net) : '—'}</div>
          <div class="text-muted text-xs mt-1">best night</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {(stats.worst?.net ?? 0) >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{stats.worst ? fmtSigned(stats.worst.net) : '—'}</div>
          <div class="text-muted text-xs mt-1">worst night</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.gamesPlayed}</div>
          <div class="text-muted text-xs mt-1">games played</div>
        </div>
      </div>
    {/if}

  {:else}
    <!-- Not logged in -->
    <div class="card">
      <div class="flex gap-2 mb-3.5">
        <button class="btn-small flex-1 {tab === 'login' ? 'btn' : 'btn-secondary'}" onclick={() => tab = 'login'}>Log in</button>
        <button class="btn-small flex-1 {tab === 'signup' ? 'btn' : 'btn-secondary'}" onclick={() => tab = 'signup'}>Create account</button>
      </div>

      {#if tab === 'login'}
        <label class="block text-xs text-muted font-medium mb-1">Name</label>
        <input class="input" bind:value={loginHandle} placeholder="yourname" autocapitalize="none" autocomplete="username" />
        <label class="block text-xs text-muted font-medium mb-1 mt-3">Passcode</label>
        <input class="input" type="password" bind:value={loginPin} placeholder="your passcode" autocomplete="current-password"
          onkeydown={(e) => { if (e.key === 'Enter') doLogin(); }} />
        <button class="btn w-full mt-4" onclick={doLogin}>Log in</button>
      {:else}
        <label class="block text-xs text-muted font-medium mb-1">Name <span class="text-muted">(also your profile at /u/name)</span></label>
        <input class="input" bind:value={signupName} placeholder="max" autocapitalize="none" autocomplete="username" />
        {#if signupName.trim()}
          <p class="text-xs mt-1 {handlePreview.length >= 3 && handlePreview.length <= 20 ? 'text-accent' : 'text-danger'}">
            Your profile will be /u/{handlePreview || '…'}
          </p>
        {/if}
        <label class="block text-xs text-muted font-medium mb-1 mt-3">Passcode <span class="text-muted">(you'll use it to log in)</span></label>
        <input class="input" type="password" bind:value={signupPin} placeholder="at least 4 characters" autocomplete="new-password" />
        <label class="block text-xs text-muted font-medium mb-1 mt-3">Confirm passcode</label>
        <input class="input" type="password" bind:value={signupPin2} placeholder="re-enter passcode" autocomplete="new-password"
          onkeydown={(e) => { if (e.key === 'Enter') doSignup(); }} />
        <button class="btn w-full mt-4" onclick={doSignup}>Create account</button>
      {/if}
    </div>
    <p class="text-center mt-4"><a href="/">Continue without an account →</a></p>
    <p class="text-muted text-xs text-center mt-1">An account just lets you follow your stats over time.</p>
  {/if}
</div>
