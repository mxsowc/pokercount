<script lang="ts">
  // A shareable 9:16 "story" card (1080×1920) drawn on a canvas from the user's
  // stats, then handed to the native share sheet (Instagram, Messages, …) via the
  // Web Share API — with a plain download as the fallback. Everything is drawn
  // client-side and self-contained (logo is an inline SVG), so no server render.
  import { fmtSigned, money } from '$lib/utils/money';
  import { statementFilename } from '$lib/utils/statement';
  import { toast } from '$lib/stores/toast';

  let { open = $bindable(false), stats, user }:
    { open?: boolean; stats: any; user: any } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let busy = $state(false);
  let rendered = $state(false);

  const W = 1080, H = 1920;

  // Brand palette (mirrors app.css — canvas can't read CSS vars).
  const C = {
    bg: '#0a0b0d', surface: '#16181b', border: 'rgba(255,255,255,0.09)',
    text: '#e9ebed', muted: '#9aa0a6', faint: '#666b70',
    accent: '#da7756', win: '#34d399', danger: '#ff5f6d', gold: '#f4c451',
  };

  // The chip logo, inline so the canvas never makes a network request.
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15.3" fill="#a85a3a"/>
    <g fill="#eef2f6">
      <rect x="13.9" y="0.7" width="4.2" height="5.2" rx="2"/>
      <g transform="rotate(60 16 16)"><rect x="13.9" y="0.7" width="4.2" height="5.2" rx="2"/></g>
      <g transform="rotate(120 16 16)"><rect x="13.9" y="0.7" width="4.2" height="5.2" rx="2"/></g>
      <g transform="rotate(180 16 16)"><rect x="13.9" y="0.7" width="4.2" height="5.2" rx="2"/></g>
      <g transform="rotate(240 16 16)"><rect x="13.9" y="0.7" width="4.2" height="5.2" rx="2"/></g>
      <g transform="rotate(300 16 16)"><rect x="13.9" y="0.7" width="4.2" height="5.2" rx="2"/></g>
    </g>
    <circle cx="16" cy="16" r="12.1" fill="#da7756"/>
    <circle cx="16" cy="16" r="9" fill="none" stroke="#f3cd6b" stroke-width="0.9" stroke-dasharray="0.2 2.55" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="7.2" fill="#140c0a"/>
    <path transform="translate(16 16) scale(0.6) translate(-12 -11.6)" fill="#f3cd6b"
      d="M12 2C12 2 4.5 8.4 4.5 13.4C4.5 15.9 6.2 17.5 8.2 17.5C9.4 17.5 10.4 16.9 11 16.1C10.8 18.3 10 19.9 8.6 20.9L15.4 20.9C14 19.9 13.2 18.3 13 16.1C13.6 16.9 14.6 17.5 15.8 17.5C17.8 17.5 19.5 15.9 19.5 13.4C19.5 8.4 12 2 12 2Z"/>
  </svg>`;

  function loadImg(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Shrink the font until the text fits `maxW`, so a long "+€12,340" never clips.
  function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, family: string, start: number, maxW: number) {
    let size = start;
    do {
      ctx.font = `${weight} ${size}px ${family}`;
      if (ctx.measureText(text).width <= maxW) break;
      size -= 4;
    } while (size > 24);
    return size;
  }

  async function render() {
    if (!canvas || !stats) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Make sure the brand fonts are ready before we measure/draw text.
    try { await (document as any).fonts?.ready; } catch {}
    const DISP = "'Space Grotesk', system-ui, sans-serif";
    const BODY = "'Inter', system-ui, sans-serif";
    const PAD = 96;
    const contentW = W - PAD * 2;

    // ---- background: deep base + a warm accent glow up top ------------------
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, -120, 40, W / 2, -120, 1100);
    glow.addColorStop(0, 'rgba(218,119,86,0.28)');
    glow.addColorStop(1, 'rgba(218,119,86,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const profit = stats.totalProfit ?? 0;
    const good = profit >= 0;
    const heroColor = good ? C.win : C.danger;

    // ---- header: logo + wordmark -------------------------------------------
    try {
      const logo = await loadImg('data:image/svg+xml;utf8,' + encodeURIComponent(LOGO_SVG));
      const size = 112;
      const lx = W / 2 - size / 2 - 108;
      ctx.drawImage(logo, lx, 120, size, size);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `700 60px ${DISP}`;
      ctx.fillStyle = C.text;
      ctx.fillText('potcount', lx + size + 20, 120 + size / 2 + 2);
    } catch { /* logo optional */ }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // ---- hero: net across home games ---------------------------------------
    ctx.fillStyle = C.muted;
    ctx.font = `600 34px ${BODY}`;
    ctx.fillText('MY HOME-GAME TALLY', W / 2, 400);

    const heroText = fmtSigned(profit, stats.unit);
    const heroSize = fitFont(ctx, heroText, '700', DISP, 176, contentW);
    ctx.font = `700 ${heroSize}px ${DISP}`;
    ctx.fillStyle = heroColor;
    ctx.shadowColor = good ? 'rgba(52,211,153,0.35)' : 'rgba(255,95,109,0.35)';
    ctx.shadowBlur = 60;
    ctx.fillText(heroText, W / 2, 400 + 40 + heroSize * 0.72);
    ctx.shadowBlur = 0;

    // ---- subline: @handle · N games ----------------------------------------
    const heroBottom = 400 + 40 + heroSize * 0.72;
    ctx.font = `600 40px ${DISP}`;
    ctx.fillStyle = C.text;
    const games = stats.gamesPlayed ?? 0;
    ctx.fillText(`@${user.handle}`, W / 2, heroBottom + 78);
    ctx.font = `400 30px ${BODY}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(`across ${games} home game${games === 1 ? '' : 's'} · in ${stats.unit}`, W / 2, heroBottom + 120);

    // ---- stat tiles (2×2) ---------------------------------------------------
    const tiles = [
      { label: 'Win rate', value: games ? `${stats.profitablePct}%` : '—', color: C.text },
      { label: 'Avg / game', value: games ? fmtSigned(stats.avgProfit, stats.unit) : '—', color: (stats.avgProfit ?? 0) >= 0 ? C.win : C.danger },
      { label: 'Best night', value: stats.best ? fmtSigned(stats.best.net, stats.unit) : '—', color: C.win },
      { label: 'Worst night', value: stats.worst ? fmtSigned(stats.worst.net, stats.unit) : '—', color: C.danger },
    ];
    const gap = 28;
    const tileW = (contentW - gap) / 2;
    const tileH = 190;
    const gridTop = heroBottom + 190;
    tiles.forEach((t, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = PAD + col * (tileW + gap);
      const y = gridTop + row * (tileH + gap);
      ctx.fillStyle = C.surface;
      roundRect(ctx, x, y, tileW, tileH, 28);
      ctx.fill();
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, tileW, tileH, 28);
      ctx.stroke();
      const cx = x + tileW / 2;
      const vText = String(t.value);
      const vSize = fitFont(ctx, vText, '700', DISP, 64, tileW - 56);
      ctx.font = `700 ${vSize}px ${DISP}`;
      ctx.fillStyle = t.color;
      ctx.textAlign = 'center';
      ctx.fillText(vText, cx, y + tileH / 2 + 6);
      ctx.font = `500 27px ${BODY}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(t.label.toUpperCase(), cx, y + tileH - 34);
    });

    // ---- bankroll curve -----------------------------------------------------
    const curve: number[] = (stats.curve ?? []).map((p: any) => p.cum);
    const curveTop = gridTop + tileH * 2 + gap + 60;
    if (curve.length >= 2) {
      ctx.textAlign = 'left';
      ctx.font = `600 28px ${BODY}`;
      ctx.fillStyle = C.muted;
      ctx.fillText('BANKROLL OVER TIME', PAD, curveTop);
      const boxY = curveTop + 30, boxH = 300, boxW = contentW;
      const series = curve;
      const lo = Math.min(0, ...series), hi = Math.max(0, ...series);
      const span = (hi - lo) || 1;
      const px = (i: number) => PAD + (series.length === 1 ? boxW : (i / (series.length - 1)) * boxW);
      const py = (v: number) => boxY + boxH - ((v - lo) / span) * boxH;
      const last = series[series.length - 1] ?? 0;
      const line = last >= 0 ? C.win : C.danger;
      // baseline (break-even)
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 8]);
      ctx.beginPath(); ctx.moveTo(PAD, py(0)); ctx.lineTo(PAD + boxW, py(0)); ctx.stroke();
      ctx.setLineDash([]);
      // area fill
      const fill = ctx.createLinearGradient(0, boxY, 0, boxY + boxH);
      fill.addColorStop(0, last >= 0 ? 'rgba(52,211,153,0.26)' : 'rgba(255,95,109,0.26)');
      fill.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      series.forEach((v, i) => { const X = px(i), Y = py(v); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
      ctx.lineTo(PAD + boxW, boxY + boxH);
      ctx.lineTo(PAD, boxY + boxH);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      // line
      ctx.beginPath();
      series.forEach((v, i) => { const X = px(i), Y = py(v); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
      ctx.strokeStyle = line;
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      // endpoint dot
      ctx.beginPath();
      ctx.arc(px(series.length - 1), py(last), 9, 0, Math.PI * 2);
      ctx.fillStyle = line; ctx.fill();
    }

    // ---- footer -------------------------------------------------------------
    ctx.textAlign = 'center';
    ctx.font = `600 34px ${DISP}`;
    ctx.fillStyle = C.accent;
    ctx.fillText('potcount.app', W / 2, H - 118);
    ctx.font = `400 27px ${BODY}`;
    ctx.fillStyle = C.faint;
    ctx.fillText('Count the pot. Settle up. Play on.', W / 2, H - 74);

    rendered = true;
  }

  async function toBlob(): Promise<Blob | null> {
    if (!canvas) return null;
    return new Promise((res) => canvas!.toBlob((b) => res(b), 'image/png'));
  }

  async function share() {
    busy = true;
    try {
      const blob = await toBlob();
      if (!blob) throw new Error('render failed');
      const file = new File([blob], statementFilename(user.handle, 'png'), { type: 'image/png' });
      const nav = navigator as any;
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: 'My home-game stats', text: 'Keeping score of our home poker nights on potcount 🃏' });
      } else {
        downloadBlob(blob);
        toast('Image saved — share it to your story');
      }
    } catch (e: any) {
      // User dismissing the share sheet is not an error; anything else → save it.
      if (e?.name !== 'AbortError') {
        const blob = await toBlob();
        if (blob) downloadBlob(blob);
        toast("Couldn't open the share sheet — saved the image instead");
      }
    } finally { busy = false; }
  }

  async function download() {
    busy = true;
    try {
      const blob = await toBlob();
      if (blob) { downloadBlob(blob); toast('Image saved'); }
    } finally { busy = false; }
  }

  function downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = statementFilename(user.handle, 'png');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function close() { open = false; }

  // (Re)draw whenever the modal opens.
  $effect(() => {
    if (open && canvas && stats) { rendered = false; render(); }
  });
</script>

{#if open}
  <div class="fixed inset-0 bg-black/75 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
       onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="card max-w-sm w-full !p-4" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-sm font-semibold uppercase tracking-widest text-muted mb-1">Share your stats</h3>
      <p class="text-muted text-xs mb-3">A story-sized card for Instagram, WhatsApp or Messages.</p>
      <div class="rounded-xl overflow-hidden border border-border bg-surface-2 mx-auto" style="max-width:270px">
        <canvas bind:this={canvas} width={W} height={H} class="block w-full h-auto {rendered ? '' : 'opacity-0'}"></canvas>
        {#if !rendered}
          <div class="aspect-[9/16] grid place-items-center text-muted text-sm">Rendering…</div>
        {/if}
      </div>
      <div class="flex gap-2 mt-4">
        <button class="btn flex-1" disabled={busy || !rendered} onclick={share}>{busy ? '…' : 'Share'}</button>
        <button class="btn-small btn-secondary" disabled={busy || !rendered} onclick={download}>Save image</button>
        <button class="btn-small btn-ghost" onclick={close}>Close</button>
      </div>
    </div>
  </div>
{/if}
