<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll, goto } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import { money, fmtSigned } from '$lib/utils/money';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import CountryPicker from '$lib/components/CountryPicker.svelte';
  import { countryName } from '$lib/utils/currencies.js';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  let user = $derived($page.data?.user ?? null);
  let tab = $state<'login' | 'signup'>('login');
  let stats = $state<any>(null);
  let badges = $state<any>(null);
  let config = $state<{ googleClientId?: string | null; appleClientId?: string | null }>({});

  // Login form
  let loginHandle = $state('');
  let loginPin = $state('');

  // Signup form
  let signupName = $state('');
  let signupPin = $state('');
  let showPin = $state(false);
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
    try {
      const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: signupName, displayName: signupName, pin: signupPin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Signup failed'); return; }
      await afterAuth('Account created');
    } catch (e: any) { toast(e.message); }
  }

  async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    stats = null;
    selectedGames = new Set();
    selectMode = false;
    await invalidateAll();
    toast('Logged out');
  }

  // ---- multi-select game stats -----------------------------------------------
  let selectedGames = $state(new Set<string>());
  let selectMode = $state(false);
  const selectedStats = $derived.by(() => {
    if (!stats?.recent || selectedGames.size === 0) return null;
    // Only sum games already in the display currency — non-convertible games
    // (chips / big blinds / Bitcoin) keep their own unit and can't be totalled.
    const picked = stats.recent.filter((r: any) => selectedGames.has(r.id) && r.net != null && r.unit === stats.unit);
    if (!picked.length) return null;
    const totalC = picked.reduce((s: number, r: any) => s + Math.round(r.net * 100), 0);
    const profitable = picked.filter((r: any) => r.net > 0).length;
    const best = picked.reduce((b: any, r: any) => (!b || r.net > b.net ? r : b), null);
    const worst = picked.reduce((w: any, r: any) => (!w || r.net < w.net ? r : w), null);
    return {
      count: picked.length,
      total: Math.round(totalC) / 100,
      avg: Math.round(totalC / picked.length) / 100,
      profitablePct: Math.round((profitable / picked.length) * 100),
      best, worst,
    };
  });
  function toggleGame(id: string) {
    const next = new Set(selectedGames);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedGames = next;
  }
  function clearSelection() { selectedGames = new Set(); selectMode = false; }

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


  let showPrivacy = $state(false);
  const PRIVACY_LABELS: Record<string, string> = {
    public: 'Public · anyone can see it',
    members: 'Members · signed-in users only',
    private: 'Private · only you',
  };
  async function setPrivacy(level: string) {
    if ((user.privacy || 'public') === level) return;
    await putMe({ privacy: level }, 'Privacy updated');
  }

  async function loadStats() {
    if (!user) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.handle)}/stats`);
      const data = await res.json();
      stats = data.stats;
      badges = data.badges || null;
    } catch {}
  }

  $effect(() => { if (user) loadStats(); });

  // ---- account: email + linked sign-in methods + deletion -------------------
  // Private self-only details (email, PIN/provider state) from GET /api/me — the
  // page's `user` from $page.data is the public view and omits these.
  let account = $state<any>(null);
  let emailInput = $state('');
  let savingEmail = $state(false);
  const connected = $derived(account ? new Set<string>([account.primaryProvider, ...(account.linkedProviders || [])]) : new Set<string>());
  const canDisconnect = (p: string) => !!account?.linkedProviders?.includes(p);

  async function loadAccount() {
    if (!user) { account = null; return; }
    try {
      const res = await fetch('/api/me');
      const data = await res.json();
      if (data?.user) { account = data; emailInput = data.email || ''; }
    } catch {}
  }
  $effect(() => { if (user) loadAccount(); else account = null; });

  async function saveEmail() {
    savingEmail = true;
    try {
      const res = await fetch('/api/me', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Could not save email'); return; }
      account = data; emailInput = data.email || '';
      await invalidateAll();
      toast(account.email ? 'Email saved' : 'Email removed');
    } catch (e: any) { toast(e.message); }
    finally { savingEmail = false; }
  }

  async function linkGoogle(credential: string) {
    try {
      const res = await fetch('/api/me/link/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Could not link Google'); return; }
      await Promise.all([invalidateAll(), loadAccount()]);
      toast('Google linked');
    } catch (e: any) { toast(e.message); }
  }

  async function doAppleLink() {
    if (appleBusy || !appleInited) return;
    appleBusy = true;
    try {
      const AppleID = (window as any).AppleID;
      const resp = await AppleID.auth.signIn();
      const idToken = resp?.authorization?.id_token;
      const res = await fetch('/api/me/link/apple', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Could not link Apple'); return; }
      await Promise.all([invalidateAll(), loadAccount()]);
      toast('Apple linked');
    } catch (err: any) {
      if (err?.error !== 'popup_closed_by_user') toast('Apple linking failed');
    } finally { appleBusy = false; }
  }

  async function unlink(provider: 'google' | 'apple') {
    const label = provider === 'apple' ? 'Apple' : 'Google';
    if (!confirm(`Disconnect ${label} from your account? You'll still be able to sign in your original way.`)) return;
    try {
      const res = await fetch('/api/me/unlink', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Could not disconnect'); return; }
      await Promise.all([invalidateAll(), loadAccount()]);
      toast(`${label} disconnected`);
    } catch (e: any) { toast(e.message); }
  }

  // Render Google's official button into the signed-in "link" slot (separate from
  // the signed-out sign-in slot). The single global onGoogle callback branches on
  // whether we're signed in, so the same init serves both.
  async function renderGoogleLink() {
    if (!config.googleClientId) return;
    try {
      await loadScript('https://accounts.google.com/gsi/client?hl=en');
      const google = (window as any).google;
      if (!googleInited) { google.accounts.id.initialize({ client_id: config.googleClientId, callback: onGoogle }); googleInited = true; }
      const el = document.getElementById('google-link-btn');
      if (el && !el.childElementCount) {
        google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'medium', shape: 'pill', text: 'continue_with', width: 200, locale: 'en' });
      }
    } catch { /* button just won't appear */ }
  }

  // When signed in, prepare the OAuth widgets for any provider not yet connected.
  $effect(() => {
    if (!browser || !user || !account) return;
    if (config.googleClientId && !connected.has('google')) renderGoogleLink();
    if (config.appleClientId && !connected.has('apple')) initApple();
  });

  // ---- danger zone: delete account ------------------------------------------
  let dangerOpen = $state(false);
  let delConfirm = $state('');
  let delPin = $state('');
  let deleting = $state(false);
  const delReady = $derived(
    !!user &&
    delConfirm.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') === user.handle &&
    (!account?.hasPin || delPin.length >= 4)
  );
  async function deleteAccount() {
    if (!delReady || deleting) return;
    deleting = true;
    try {
      const res = await fetch('/api/me/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: delConfirm.trim(), pin: delPin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Could not delete account'); return; }
      await invalidateAll();
      toast('Your account has been deleted');
      await goto('/');
    } catch (e: any) { toast(e.message); }
    finally { deleting = false; }
  }

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
    // Same Google button serves two purposes: when already signed in it LINKS the
    // Google identity to this account; otherwise it signs in / signs up.
    if (user) { await linkGoogle(resp.credential); return; }
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: resp.credential }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Google sign-in failed'); return; }
      await afterAuth('Signed in with Google');
    } catch (e: any) { toast(e.message); }
  }

  // Google's button is *drawn* by its script into #google-btn. It must be
  // (re)drawn whenever the signed-out view is on screen — the page isn't
  // re-mounted after logout, so a one-shot onMount call leaves it blank until a
  // refresh. ?hl=en + locale:'en' force English to match the Apple button.
  let googleInited = false;
  async function renderGoogle() {
    if (!config.googleClientId) return;
    try {
      await loadScript('https://accounts.google.com/gsi/client?hl=en');
      const google = (window as any).google;
      if (!googleInited) {
        google.accounts.id.initialize({ client_id: config.googleClientId, callback: onGoogle });
        googleInited = true;
      }
      const el = document.getElementById('google-btn');
      if (el && !el.childElementCount) {
        google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280, locale: 'en' });
      }
    } catch (e: any) { /* button just won't appear */ }
  }

  // Apple: manually call signIn() from our own button instead of Apple's
  // auto-rendered widget. The rendered button + $effect re-draws caused the
  // Apple popup to re-trigger (Face ID loop). A manual call gives us full
  // control and a busy guard.
  let appleInited = false;
  let appleBusy = $state(false);
  let appleReady = $state(false);
  async function initApple() {
    if (!config.appleClientId || appleInited) return;
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      const AppleID = (window as any).AppleID;
      AppleID.auth.init({ clientId: config.appleClientId, scope: 'name email', redirectURI: window.location.origin, usePopup: true });
      appleInited = true;
      appleReady = true;
    } catch { /* SDK failed to load — button stays hidden */ }
  }
  async function doAppleSignIn() {
    if (appleBusy || !appleInited) return;
    appleBusy = true;
    try {
      const AppleID = (window as any).AppleID;
      const resp = await AppleID.auth.signIn();
      const idToken = resp?.authorization?.id_token;
      const nm = resp?.user?.name ? [resp.user.name.firstName, resp.user.name.lastName].filter(Boolean).join(' ') : undefined;
      const res = await fetch('/api/auth/apple', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, name: nm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Apple sign-in failed'); return; }
      await afterAuth('Signed in with Apple');
    } catch (err: any) {
      if (err?.error !== 'popup_closed_by_user') toast('Apple sign-in failed');
    } finally {
      appleBusy = false;
    }
  }

  onMount(async () => {
    if (!browser) return;
    try { config = await (await fetch('/api/config')).json(); } catch {}
  });

  // (Re)draw Google's official button whenever the signed-out view is shown —
  // the page isn't re-mounted after logout, so onMount alone would leave it blank.
  // Apple is init-once (no re-render needed — we draw our own button).
  $effect(() => {
    if (!browser || user) return;
    if (config.googleClientId) renderGoogle();
    if (config.appleClientId) initApple();
  });

  // ---- one-time onboarding questions ----------------------------------------
  let obAge = $state('');
  let obCountry = $state(''); // ISO-2 country code from the picker
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

  // ---- region (sets the default currency for games you open) ----------------
  let editRegion = $state(false);
  let regionCode = $state('');
  let savingRegion = $state(false);
  $effect(() => { if (user) regionCode = user.country || ''; });
  async function saveRegion() {
    savingRegion = true;
    try {
      await fetch('/api/me/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: regionCode }),
      });
      await invalidateAll();
      editRegion = false;
      toast('Region updated');
    } catch (e: any) { toast(e.message); }
    finally { savingRegion = false; }
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

      <!-- Display name / handle -->
      <label class="block text-xs text-muted font-medium mb-1 mt-4">Name</label>
      <div class="flex gap-2">
        <input class="input flex-1" bind:value={nameInput} maxlength="40" autocapitalize="none"
               onkeydown={(e) => { if (e.key === 'Enter') saveName(); }} />
        <button class="btn-small btn" disabled={savingName || !nameInput.trim() || nameInput.trim() === user.displayName} onclick={saveName}>Save</button>
      </div>
      <p class="text-muted text-xs mt-1">Your profile lives at /u/{nameInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || '…'}</p>

      <!-- Privacy (collapsed summary + reveal) -->
      <div class="mt-4 pt-4 border-t border-border-soft">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs text-muted font-medium">Profile privacy</div>
            <div class="font-semibold">{PRIVACY_LABELS[user.privacy || 'public']}</div>
          </div>
          <button class="btn-small btn-ghost shrink-0" onclick={() => showPrivacy = !showPrivacy}>
            {showPrivacy ? 'Done' : 'Change privacy settings'}
          </button>
        </div>
        {#if showPrivacy}
          <div class="flex gap-1.5 mt-3">
            {#each [['public', 'Public', 'Anyone'], ['members', 'Members', 'Signed-in only'], ['private', 'Private', 'Only me']] as [val, label, desc]}
              <button class="btn-small flex-1 flex-col !py-2 {(user.privacy || 'public') === val ? 'btn' : 'btn-secondary'}" onclick={() => setPrivacy(val)}>
                <span class="font-semibold">{label}</span>
                <span class="text-[11px] opacity-70 font-normal">{desc}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Region: sets the default currency for games you open -->
      <div class="mt-4 pt-4 border-t border-border-soft">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs text-muted font-medium">Region · sets your default game currency ({user.homeUnit || '€'})</div>
            <div class="font-semibold">{user.country ? countryName(user.country) : 'Not set — defaults to €'}</div>
          </div>
          <button class="btn-small btn-ghost shrink-0" onclick={() => { editRegion = !editRegion; regionCode = user.country || ''; }}>
            {editRegion ? 'Done' : 'Change'}
          </button>
        </div>
        {#if editRegion}
          <div class="flex gap-2 mt-3">
            <div class="flex-1"><CountryPicker bind:value={regionCode} /></div>
            <button class="btn-small btn" disabled={savingRegion} onclick={saveRegion}>Save</button>
          </div>
        {/if}
      </div>

      {#if account}
        <!-- Email: optional, unverified contact + newsletter enablement -->
        <div class="mt-4 pt-4 border-t border-border-soft">
          <label class="block text-xs text-muted font-medium mb-1" for="acct-email">Email <span class="text-faint font-normal">· optional</span></label>
          <div class="flex gap-2">
            <input id="acct-email" class="input flex-1" type="email" bind:value={emailInput} placeholder="you@example.com"
                   autocapitalize="none" autocomplete="email"
                   onkeydown={(e) => { if (e.key === 'Enter') saveEmail(); }} />
            <button class="btn-small btn" disabled={savingEmail || emailInput.trim() === (account.email || '')} onclick={saveEmail}>Save</button>
          </div>
          <p class="text-muted text-xs mt-1">A way to reach you and to hold onto your stats if you forget your passcode. We don't verify it — for a guaranteed recovery login, connect Google or Apple below.</p>
        </div>

        <!-- Linked sign-in methods -->
        {#if config.googleClientId || config.appleClientId}
          <div class="mt-4 pt-4 border-t border-border-soft">
            <div class="text-xs text-muted font-medium mb-2">Ways to sign in</div>
            <div class="flex flex-col gap-2.5">
              {#if config.googleClientId}
                <div class="flex items-center justify-between gap-2 min-h-9">
                  <span class="text-sm font-semibold">Google{#if connected.has('google')}<span class="text-faint font-normal"> · connected{account.primaryProvider === 'google' ? ' (primary)' : ''}</span>{/if}</span>
                  {#if connected.has('google')}
                    {#if canDisconnect('google')}<button class="btn-small btn-ghost shrink-0" onclick={() => unlink('google')}>Disconnect</button>{/if}
                  {:else}
                    <div id="google-link-btn" class="shrink-0"></div>
                  {/if}
                </div>
              {/if}
              {#if config.appleClientId}
                <div class="flex items-center justify-between gap-2 min-h-9">
                  <span class="text-sm font-semibold">Apple{#if connected.has('apple')}<span class="text-faint font-normal"> · connected{account.primaryProvider === 'apple' ? ' (primary)' : ''}</span>{/if}</span>
                  {#if connected.has('apple')}
                    {#if canDisconnect('apple')}<button class="btn-small btn-ghost shrink-0" onclick={() => unlink('apple')}>Disconnect</button>{/if}
                  {:else}
                    <button class="btn-small btn-secondary shrink-0" onclick={doAppleLink} disabled={appleBusy || !appleReady}>{appleBusy ? 'Connecting…' : 'Connect'}</button>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/if}

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
        <CountryPicker bind:value={obCountry} />
        <p class="text-xs text-faint mt-1">We'll use this to default the currency when you open a game.</p>
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
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3">
        Your stats
        {#if stats.gamesPlayed}<span class="normal-case tracking-normal text-faint font-normal">· in {stats.unit}</span>{/if}
      </h2>
      {#if stats.otherGames > 0}
        <p class="text-xs text-faint mb-3">{stats.otherGames} game{stats.otherGames === 1 ? '' : 's'} in chips / other units aren't included in the totals.</p>
      {/if}
      <div class="grid grid-cols-3 gap-2.5 max-[380px]:grid-cols-2">
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {stats.totalProfit >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(stats.totalProfit, stats.unit)}</div>
          <div class="text-muted text-xs mt-1">total profit</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {stats.avgProfit >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{stats.gamesPlayed ? fmtSigned(stats.avgProfit, stats.unit) : '—'}</div>
          <div class="text-muted text-xs mt-1">avg / game</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.gamesPlayed ? stats.profitablePct + '%' : '—'}</div>
          <div class="text-muted text-xs mt-1">% profitable</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {(stats.best?.net ?? 0) >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{stats.best ? fmtSigned(stats.best.net, stats.unit) : '—'}</div>
          <div class="text-muted text-xs mt-1">best night</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {(stats.worst?.net ?? 0) >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{stats.worst ? fmtSigned(stats.worst.net, stats.unit) : '—'}</div>
          <div class="text-muted text-xs mt-1">worst night</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.gamesPlayed}</div>
          <div class="text-muted text-xs mt-1">games played</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {stats.streak?.kind === 'win' ? 'text-win' : stats.streak?.kind === 'loss' ? 'text-danger' : ''}" style="font-family:var(--font-display)">
            {stats.streak && stats.streak.current > 0 ? `${stats.streak.kind === 'win' ? '🔥' : '❄️'} ${stats.streak.current}${stats.streak.kind === 'win' ? 'W' : 'L'}` : '—'}
          </div>
          <div class="text-muted text-xs mt-1">current streak</div>
        </div>
        {#if stats.hourly}
          <div class="card text-center !mb-0">
            <div class="text-xl font-extrabold tabular-nums {stats.hourly.rate >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(stats.hourly.rate, stats.unit)}<span class="text-sm text-muted">/h</span></div>
            <div class="text-muted text-xs mt-1">per hour · {stats.hourly.games}g</div>
          </div>
        {/if}
      </div>

      {#if stats.curve && stats.curve.length >= 2}
        <div class="card mt-3 text-win">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs uppercase tracking-widest text-muted font-semibold">Profit over time</span>
            <span class="text-sm font-bold tabular-nums {stats.totalProfit >= 0 ? 'text-win' : 'text-danger'}">{fmtSigned(stats.totalProfit, stats.unit)}</span>
          </div>
          <Sparkline points={stats.curve.map((p: any) => p.cum)} />
        </div>
      {/if}

      <!-- Badges -->
      {#if badges?.hardestToRead > 0}
        <div class="flex flex-wrap gap-2 mt-4">
          <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-2 border border-border text-sm">
            <span>🎭</span>
            <span class="font-semibold">Hardest to read</span>
            <span class="text-muted">× {badges.hardestToRead}</span>
          </div>
        </div>
      {/if}

      <!-- Recent games with multi-select -->
      {#if stats.recent?.length}
        <div class="flex items-center justify-between mt-6 mb-3">
          <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Your games</h2>
          {#if selectMode}
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted">{selectedGames.size} selected</span>
              <button class="btn-small btn-ghost !py-1.5 !px-2.5" onclick={clearSelection}>Done</button>
            </div>
          {:else}
            <button class="btn-small btn-ghost !py-1.5 !px-2.5" onclick={() => selectMode = true}>Compare</button>
          {/if}
        </div>

        {#if selectedStats}
          <div class="card !border-accent/40 mb-3">
            <div class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Selected {selectedStats.count} games</div>
            <div class="grid grid-cols-3 gap-2">
              <div class="text-center">
                <div class="text-lg font-extrabold tabular-nums {selectedStats.total >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(selectedStats.total, stats.unit)}</div>
                <div class="text-muted text-[.65rem]">total</div>
              </div>
              <div class="text-center">
                <div class="text-lg font-extrabold tabular-nums {selectedStats.avg >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(selectedStats.avg, stats.unit)}</div>
                <div class="text-muted text-[.65rem]">avg / game</div>
              </div>
              <div class="text-center">
                <div class="text-lg font-extrabold tabular-nums" style="font-family:var(--font-display)">{selectedStats.profitablePct}%</div>
                <div class="text-muted text-[.65rem]">profitable</div>
              </div>
            </div>
          </div>
        {/if}

        {#each stats.recent as r (r.id)}
          {#if selectMode}
            <button class="transfer-row w-full text-left {selectedGames.has(r.id) ? '!border-accent' : ''}" onclick={() => toggleGame(r.id)}>
              <span class="w-5 h-5 rounded border shrink-0 grid place-items-center {selectedGames.has(r.id) ? 'bg-accent border-accent text-accent-ink' : 'border-border'}">
                {#if selectedGames.has(r.id)}<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
              </span>
              <span class="font-semibold truncate">{r.name}</span>
              <span class="text-muted text-sm shrink-0">#{r.id}</span>
              {#if r.net != null}
                <span class="ml-auto font-bold tabular-nums shrink-0 {r.net >= 0 ? 'text-win' : 'text-danger'}">{fmtSigned(r.net, r.unit)}</span>
              {:else}
                <span class="pill ml-auto shrink-0">in progress</span>
              {/if}
            </button>
          {:else}
            <a href="/game?g={r.id}" class="transfer-row no-underline text-text hover:border-border">
              <span class="font-semibold truncate">{r.name}</span>
              <span class="text-muted text-sm shrink-0">#{r.id}</span>
              {#if r.net != null}
                <span class="ml-auto font-bold tabular-nums shrink-0 {r.net >= 0 ? 'text-win' : 'text-danger'}">{fmtSigned(r.net, r.unit)}</span>
              {:else}
                <span class="pill ml-auto shrink-0">in progress</span>
              {/if}
            </a>
          {/if}
        {/each}
      {/if}
    {/if}

    <!-- Danger zone: delete account (kept low-key + behind a reveal so it isn't hit by accident) -->
    <div class="card mt-6 !border-danger/30">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-danger">Delete account</div>
          <div class="text-muted text-xs">Erases your profile, stats, email and follows. Games you played stay for everyone else — they just stop linking back to you.</div>
        </div>
        <button class="btn-small btn-ghost shrink-0" onclick={() => { dangerOpen = !dangerOpen; delConfirm = ''; delPin = ''; }}>
          {dangerOpen ? 'Cancel' : 'Delete…'}
        </button>
      </div>
      {#if dangerOpen}
        <div class="mt-3 pt-3 border-t border-border-soft">
          <p class="text-xs text-muted mb-2">
            This can't be undone. To confirm, type your username <span class="font-semibold text-text">{user.handle}</span>{#if account?.hasPin} and your passcode{/if}.
          </p>
          <input class="input" bind:value={delConfirm} placeholder="your username" autocapitalize="none" autocomplete="off" spellcheck="false" />
          {#if account?.hasPin}
            <input class="input mt-2" type="password" bind:value={delPin} placeholder="your passcode" autocomplete="off" />
          {/if}
          <button class="btn-small btn-danger w-full mt-3" disabled={!delReady || deleting} onclick={deleteAccount}>
            {deleting ? 'Deleting…' : 'Permanently delete my account'}
          </button>
        </div>
      {/if}
    </div>

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
        <div class="relative">
          <input class="input w-full !pr-16" type={showPin ? 'text' : 'password'} bind:value={signupPin} placeholder="at least 4 characters" autocomplete="new-password"
            onkeydown={(e) => { if (e.key === 'Enter') doSignup(); }} />
          <button type="button" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-text" onclick={() => showPin = !showPin}>{showPin ? 'Hide' : 'Show'}</button>
        </div>
        <button class="btn w-full mt-4" onclick={doSignup}>Create account</button>
      {/if}

      {#if config.googleClientId || config.appleClientId}
        <div class="flex items-center gap-3 my-4 text-muted text-xs">
          <span class="h-px bg-border flex-1"></span> or <span class="h-px bg-border flex-1"></span>
        </div>
        <div class="flex flex-col items-stretch gap-2">
          {#if config.googleClientId}
            <div id="google-btn" class="flex justify-center"></div>
          {/if}
          {#if config.appleClientId && appleReady}
            <button class="apple-btn" onclick={doAppleSignIn} disabled={appleBusy}>
              <svg viewBox="0 0 17 20" width="17" height="20" fill="currentColor"><path d="M13.26 10.37c-.02-2.26 1.84-3.34 1.93-3.4-1.05-1.54-2.69-1.75-3.27-1.78-1.39-.14-2.72.82-3.43.82-.71 0-1.81-.8-2.98-.78a4.39 4.39 0 00-3.69 2.25c-1.57 2.73-.4 6.77 1.13 8.99.75 1.08 1.64 2.3 2.81 2.26 1.13-.05 1.55-.73 2.91-.73 1.36 0 1.74.73 2.92.71 1.21-.02 1.98-1.1 2.72-2.19a9.56 9.56 0 001.24-2.54c-.03-.01-2.37-.91-2.39-3.61zM11.04 3.65a3.95 3.95 0 00.9-2.83A4.02 4.02 0 009.34 2a3.76 3.76 0 00-.93 2.73c1.07.08 2.15-.47 2.63-1.08z"/></svg>
              {appleBusy ? 'Signing in…' : 'Continue with Apple'}
            </button>
          {/if}
        </div>
      {/if}
    </div>
    <p class="text-center mt-4"><a href="/">Continue without an account →</a></p>
    <p class="text-muted text-xs text-center mt-1">An account just lets you follow your stats over time.</p>
    <p class="text-muted text-xs text-center mt-1">By creating an account you agree to our <a href="/privacy">privacy policy</a>.</p>
  {/if}

  <!-- Help / contact — always shown (signed in or not) -->
  <p class="text-muted text-xs text-center mt-8">
    Found a bug or have a question?
    <a href="mailto:info@fatcloud.nl?subject=potcount%20%E2%80%94%20bug%20%2F%20question">info@fatcloud.nl</a>
  </p>
</div>

<!-- Avatar crop / position modal -->
{#if cropOpen}
  <div class="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
       onclick={(e) => { if (e.target === e.currentTarget) closeCrop(); }}>
    <div class="card max-w-sm w-full" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-1">Position your photo</h3>
      <p class="text-muted text-xs mb-3">Drag to move · slider to zoom. The circle is what others see.</p>
      <div class="relative mx-auto overflow-hidden rounded-full bg-surface-2 touch-none select-none cursor-grab active:cursor-grabbing"
           style="width:{CROP_V}px;height:{CROP_V}px;max-width:100%"
           onpointerdown={cropPointerDown} onpointermove={cropPointerMove} onpointerup={cropPointerUp} onpointercancel={cropPointerUp}>
        {#if cropImg}
          <img src={cropSrc} alt="" draggable="false"
               style="position:absolute;left:{cropX}px;top:{cropY}px;width:{cropImg.naturalWidth * dispScale()}px;height:{cropImg.naturalHeight * dispScale()}px;max-width:none;" />
        {/if}
        <div class="pointer-events-none absolute inset-0 rounded-full" style="box-shadow:inset 0 0 0 2px rgba(255,255,255,.25);"></div>
      </div>
      <input type="range" min="1" max="4" step="0.01" class="w-full mt-3" value={cropScale}
             oninput={(e) => onZoom(parseFloat((e.target as HTMLInputElement).value))} />
      <div class="flex gap-2 mt-2">
        <button class="btn flex-1" disabled={avatarBusy} onclick={confirmCrop}>{avatarBusy ? 'Saving…' : 'Save photo'}</button>
        <button class="btn-small btn-secondary" disabled={avatarBusy} onclick={closeCrop}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .apple-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 280px;
    height: 44px;
    margin: 0 auto;
    padding: 0 16px;
    border-radius: 20px;
    border: none;
    background: #000;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .apple-btn:hover { opacity: 0.85; }
  .apple-btn:active { opacity: 0.7; }
  .apple-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
