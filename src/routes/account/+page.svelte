<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll, goto } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import { money, fmtSigned } from '$lib/utils/money';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  let user = $derived($page.data?.user ?? null);
  let tab = $state<'login' | 'signup'>('login');
  let stats = $state<any>(null);
  let config = $state<{ googleClientId?: string | null; appleClientId?: string | null }>({});

  // Login form
  let loginHandle = $state('');
  let loginPin = $state('');

  // Signup form
  let signupName = $state('');
  let signupPin = $state('');
  let signupPin2 = $state('');
  let signupEmail = $state('');
  let wantNewsletter = $state(false);
  let handlePreview = $derived(signupName.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));

  // After a successful sign-in, return to wherever we were sent from (e.g. a game
  // page that wants you to claim your seat). Only local paths are honoured.
  async function afterAuth(msg: string) {
    await invalidateAll();
    toast(msg);
    const next = $page.url.searchParams.get('next');
    if (next && next.startsWith('/')) await goto(next);
  }

  async function doLogin() {
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: loginHandle.trim(), pin: loginPin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Login failed'); return; }
      await afterAuth('Logged in');
    } catch (e: any) { toast(e.message); }
  }

  async function doSignup() {
    if (handlePreview.length < 3 || handlePreview.length > 20) { toast('Name must be 3-20 characters'); return; }
    if (signupPin.length < 4) { toast('Passcode must be at least 4 characters'); return; }
    if (signupPin !== signupPin2) { toast("Passcodes don't match"); return; }
    try {
      const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: signupName, displayName: signupName, pin: signupPin, email: signupEmail.trim() || undefined, newsletter: wantNewsletter }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Signup failed'); return; }
      await afterAuth('Account created');
    } catch (e: any) { toast(e.message); }
  }

  async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    await invalidateAll();
    toast('Logged out');
  }

  // ---- profile editing ------------------------------------------------------
  let nameInput = $state('');
  let savingName = $state(false);
  let avatarBusy = $state(false);
  let fileEl = $state<HTMLInputElement | null>(null);
  // keep the name field in sync with the loaded user (and after saves)
  $effect(() => { if (user) nameInput = user.displayName; });

  async function putMe(body: any, okMsg: string) {
    const res = await fetch('/api/me', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Could not save'); return false; }
    await invalidateAll();
    toast(okMsg);
    return true;
  }

  async function saveName() {
    const name = nameInput.trim();
    if (!name || name === user.displayName) return;
    savingName = true;
    try { await putMe({ name }, 'Name updated'); } finally { savingName = false; }
  }

  // Resize+compress an image entirely in the browser to a small square-ish JPEG
  // data URL so we can store it inline without any upload/blob storage.
  // ---- crop/position picker -------------------------------------------------
  const CROP_V = 260; // on-screen viewport size (px)
  const CROP_OUT = 256; // exported square size (px)
  let cropOpen = $state(false);
  let cropImg = $state<HTMLImageElement | null>(null);
  let cropSrc = $state('');
  let cropScale = $state(1); // zoom multiplier ≥ 1 on top of "cover"
  let cropX = $state(0), cropY = $state(0); // image top-left within the viewport
  let cropDrag: { x: number; y: number; px: number; py: number } | null = null;

  const coverScale = () => cropImg ? Math.max(CROP_V / cropImg.naturalWidth, CROP_V / cropImg.naturalHeight) : 1;
  const dispScale = () => coverScale() * cropScale;
  function clampCrop() {
    if (!cropImg) return;
    const ds = dispScale();
    const w = cropImg.naturalWidth * ds, h = cropImg.naturalHeight * ds;
    cropX = Math.min(0, Math.max(CROP_V - w, cropX));
    cropY = Math.min(0, Math.max(CROP_V - h, cropY));
  }
  function centerCrop() {
    if (!cropImg) return;
    const ds = dispScale();
    cropX = (CROP_V - cropImg.naturalWidth * ds) / 2;
    cropY = (CROP_V - cropImg.naturalHeight * ds) / 2;
    clampCrop();
  }

  function onAvatarFile(e: Event) {
    const inp = e.target as HTMLInputElement;
    const file = inp.files?.[0];
    inp.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      cropImg = img; cropSrc = url; cropScale = 1;
      centerCrop();
      cropOpen = true;
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast("Couldn't read that image"); };
    img.src = url;
  }

  function cropPointerDown(e: PointerEvent) {
    cropDrag = { x: e.clientX, y: e.clientY, px: cropX, py: cropY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function cropPointerMove(e: PointerEvent) {
    if (!cropDrag) return;
    cropX = cropDrag.px + (e.clientX - cropDrag.x);
    cropY = cropDrag.py + (e.clientY - cropDrag.y);
    clampCrop();
  }
  function cropPointerUp() { cropDrag = null; }

  function onZoom(next: number) {
    // zoom around the viewport centre so it stays put
    const c = CROP_V / 2;
    const old = dispScale();
    const sx = (c - cropX) / old, sy = (c - cropY) / old;
    cropScale = next;
    const ds = dispScale();
    cropX = c - sx * ds; cropY = c - sy * ds;
    clampCrop();
  }

  function closeCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    cropOpen = false; cropImg = null; cropSrc = '';
  }

  async function confirmCrop() {
    if (!cropImg) return;
    avatarBusy = true;
    try {
      const ds = dispScale();
      const sW = CROP_V / ds, sH = CROP_V / ds;   // source rect (image px) shown in the viewport
      const sx = -cropX / ds, sy = -cropY / ds;
      const canvas = document.createElement('canvas');
      canvas.width = CROP_OUT; canvas.height = CROP_OUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(cropImg, sx, sy, sW, sH, 0, 0, CROP_OUT, CROP_OUT);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      if (await putMe({ avatar: dataUrl }, 'Photo updated')) closeCrop();
    } catch { toast("Couldn't process that image"); }
    finally { avatarBusy = false; }
  }

  async function resetAvatar() {
    avatarBusy = true;
    try { await putMe({ avatar: null }, user?.provider === 'google' ? 'Using your Google photo' : 'Photo removed'); }
    finally { avatarBusy = false; }
  }

  async function setPrivacy(level: string) {
    if (user.privacy === level) return;
    await putMe({ privacy: level }, 'Privacy updated');
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

  // ---- Social sign-in (Google / Apple) --------------------------------------
  function loadScript(src: string) {
    return new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(el);
    });
  }

  async function onGoogle(resp: any) {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: resp.credential, newsletter: wantNewsletter }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Google sign-in failed'); return; }
      await afterAuth('Signed in with Google');
    } catch (e: any) { toast(e.message); }
  }

  async function initGoogle() {
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      const google = (window as any).google;
      google.accounts.id.initialize({ client_id: config.googleClientId, callback: onGoogle });
      const el = document.getElementById('google-btn');
      if (el) google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
    } catch (e: any) { /* button just won't appear */ }
  }

  async function initApple() {
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      (window as any).AppleID.auth.init({ clientId: config.appleClientId, scope: 'name email', redirectURI: window.location.origin, usePopup: true });
    } catch (e: any) { /* button just won't work; handled on click */ }
  }

  async function onApple() {
    try {
      const resp = await (window as any).AppleID.auth.signIn();
      const idToken = resp?.authorization?.id_token;
      const nm = resp?.user?.name ? [resp.user.name.firstName, resp.user.name.lastName].filter(Boolean).join(' ') : undefined;
      const res = await fetch('/api/auth/apple', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, name: nm, newsletter: wantNewsletter }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Apple sign-in failed'); return; }
      await afterAuth('Signed in with Apple');
    } catch (e: any) {
      // The user closing the Apple popup throws — don't nag them about it.
      if (e?.error && e.error !== 'popup_closed_by_user') toast('Apple sign-in failed');
    }
  }

  onMount(async () => {
    if (!browser) return;
    try { config = await (await fetch('/api/config')).json(); } catch {}
    if (config.googleClientId) initGoogle();
    if (config.appleClientId) initApple();
  });

  // ---- one-time onboarding questions ----------------------------------------
  let obAge = $state('');
  let obCountry = $state('');
  let obHeard = $state('');
  let obSaving = $state(false);

  async function submitOnboarding(skip = false) {
    obSaving = true;
    try {
      await fetch('/api/me/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skip ? {} : { ageRange: obAge, country: obCountry, heardFrom: obHeard }),
      });
      await invalidateAll();
      if (!skip) toast('Thanks!');
    } catch (e: any) { toast(e.message); }
    finally { obSaving = false; }
  }
</script>

<svelte:head><title>potcount — account</title></svelte:head>

<div class="wrap">
  <h1 class="text-2xl font-bold mb-4">Account</h1>

  {#if user}
    <!-- Logged in -->
    <input type="file" accept="image/*" class="hidden" bind:this={fileEl} onchange={onAvatarFile} />
    <div class="card">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <!-- Avatar (click to change) -->
          <button class="relative w-14 h-14 shrink-0 rounded-full overflow-hidden grid place-items-center bg-accent/15 text-accent text-xl font-bold disabled:opacity-60"
                  title="Change photo" disabled={avatarBusy} onclick={() => fileEl?.click()}>
            {#if user.avatar}
              <img src={user.avatar} alt="" class="w-full h-full object-cover" referrerpolicy="no-referrer" />
            {:else}
              {(user.displayName || '?').charAt(0).toUpperCase()}
            {/if}
            <span class="absolute inset-x-0 bottom-0 text-[9px] leading-tight bg-black/55 text-white py-0.5 text-center">{avatarBusy ? '…' : 'Edit'}</span>
          </button>
          <div class="min-w-0">
            <h2 class="text-xl font-bold m-0 truncate">{user.displayName}</h2>
            <div class="text-muted text-sm truncate">@{user.handle} · {user.provider}</div>
          </div>
        </div>
        <button class="btn-small btn-danger shrink-0" onclick={doLogout}>Log out</button>
      </div>

      <div class="flex gap-2 mt-2.5">
        <button class="btn-small btn-secondary" disabled={avatarBusy} onclick={() => fileEl?.click()}>Upload photo</button>
        {#if user.avatar}
          <button class="btn-small btn-ghost" disabled={avatarBusy} onclick={resetAvatar}>{user.provider === 'google' ? 'Use Google photo' : 'Remove photo'}</button>
        {/if}
      </div>

      <!-- Display name / handle -->
      <label class="block text-xs text-muted font-medium mb-1 mt-4">Name</label>
      <div class="flex gap-2">
        <input class="input flex-1" bind:value={nameInput} maxlength="40" autocapitalize="none"
               onkeydown={(e) => { if (e.key === 'Enter') saveName(); }} />
        <button class="btn-small btn" disabled={savingName || !nameInput.trim() || nameInput.trim() === user.displayName} onclick={saveName}>Save</button>
      </div>
      <p class="text-muted text-xs mt-1">Your profile lives at /u/{nameInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || '…'}</p>

      <!-- Privacy -->
      <label class="block text-xs text-muted font-medium mb-1 mt-4">Profile privacy</label>
      <div class="flex gap-1.5">
        {#each [['public', 'Public', 'Anyone'], ['members', 'Members', 'Signed-in only'], ['private', 'Private', 'Only me']] as [val, label, desc]}
          <button class="btn-small flex-1 flex-col !py-2 {(user.privacy || 'public') === val ? 'btn' : 'btn-secondary'}" onclick={() => setPrivacy(val)}>
            <span class="font-semibold">{label}</span>
            <span class="text-[11px] opacity-70 font-normal">{desc}</span>
          </button>
        {/each}
      </div>

      <p class="mt-4"><a href="/u/{user.handle}">View your public profile →</a></p>
    </div>

    {#if user.onboarded === false}
      <div class="card mt-4 !border-accent/40">
        <h2 class="text-lg font-bold mb-1">Welcome to potcount 👋</h2>
        <p class="text-muted text-sm mb-3">A couple of quick questions (all optional) — it just helps us understand who's playing. See our <a href="/privacy">privacy policy</a>.</p>
        <label class="block text-xs text-muted font-medium mb-1">Age range</label>
        <select class="input" bind:value={obAge}>
          <option value="">Prefer not to say</option>
          <option value="under 18">Under 18</option>
          <option value="18-24">18–24</option>
          <option value="25-34">25–34</option>
          <option value="35-44">35–44</option>
          <option value="45-54">45–54</option>
          <option value="55+">55+</option>
        </select>
        <label class="block text-xs text-muted font-medium mb-1 mt-3">Where are you from?</label>
        <input class="input" bind:value={obCountry} placeholder="e.g. Poland" maxlength="60" autocapitalize="words" />
        <label class="block text-xs text-muted font-medium mb-1 mt-3">How did you hear about potcount?</label>
        <select class="input" bind:value={obHeard}>
          <option value="">Prefer not to say</option>
          <option value="friend">A friend</option>
          <option value="social">Social media</option>
          <option value="search">Search engine</option>
          <option value="other">Other</option>
        </select>
        <div class="flex gap-2 mt-4">
          <button class="btn flex-1" onclick={() => submitOnboarding(false)} disabled={obSaving}>Save</button>
          <button class="btn btn-secondary" onclick={() => submitOnboarding(true)} disabled={obSaving}>Skip</button>
        </div>
      </div>
    {/if}

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
        <label class="block text-xs text-muted font-medium mb-1 mt-3">Email <span class="text-muted">(optional)</span></label>
        <input class="input" type="email" bind:value={signupEmail} placeholder="you@example.com" autocomplete="email" autocapitalize="none" inputmode="email" />
        <label class="flex items-center gap-2 mt-3 text-sm text-muted cursor-pointer">
          <input type="checkbox" bind:checked={wantNewsletter} class="accent-accent w-4 h-4 shrink-0" />
          Email me occasional updates (you can opt out anytime)
        </label>
        <button class="btn w-full mt-4" onclick={doSignup}>Create account</button>
      {/if}

      {#if config.googleClientId || config.appleClientId}
        <div class="flex items-center gap-3 my-4 text-muted text-xs">
          <span class="h-px bg-border flex-1"></span> or <span class="h-px bg-border flex-1"></span>
        </div>
        {#if tab === 'login'}
          <label class="flex items-center gap-2 mb-2 text-sm text-muted cursor-pointer">
            <input type="checkbox" bind:checked={wantNewsletter} class="accent-accent w-4 h-4 shrink-0" />
            Email me occasional updates (you can opt out anytime)
          </label>
        {/if}
        <div class="flex flex-col items-stretch gap-2">
          {#if config.googleClientId}
            <div id="google-btn" class="flex justify-center"></div>
          {/if}
          {#if config.appleClientId}
            <button onclick={onApple}
              class="btn w-full !bg-black !text-white !border-black hover:opacity-90 flex items-center justify-center gap-2">
              <svg width="15" height="18" viewBox="0 0 14 17" fill="currentColor" aria-hidden="true">
                <path d="M11.7 9.02c-.02-1.86 1.52-2.75 1.59-2.8-.87-1.27-2.22-1.44-2.7-1.46-1.15-.12-2.24.67-2.82.67-.58 0-1.48-.66-2.43-.64-1.25.02-2.4.73-3.05 1.84-1.3 2.26-.33 5.6.93 7.43.62.9 1.36 1.9 2.32 1.87.93-.04 1.28-.6 2.41-.6 1.12 0 1.44.6 2.42.58 1-.02 1.63-.91 2.24-1.81.71-1.04 1-2.05 1.02-2.1-.02-.01-1.95-.75-1.96-2.98zM9.86 3.3c.51-.62.86-1.49.76-2.35-.74.03-1.63.49-2.16 1.11-.47.55-.89 1.43-.78 2.27.82.07 1.67-.42 2.18-1.03z"/>
              </svg>
              Continue with Apple
            </button>
          {/if}
        </div>
      {/if}
    </div>
    <p class="text-center mt-4"><a href="/">Continue without an account →</a></p>
    <p class="text-muted text-xs text-center mt-1">An account just lets you follow your stats over time.</p>
    <p class="text-muted text-xs text-center mt-1">By creating an account you agree to our <a href="/privacy">privacy policy</a>.</p>
  {/if}
</div>
