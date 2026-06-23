<script lang="ts">
  import qrcode from 'qrcode-generator';
  // Renders `data` as a crisp, dependency-light QR (SVG modules on white, with a
  // quiet-zone margin so it scans reliably).
  let { data = '', size = 220 }: { data?: string; size?: number } = $props();
  const M = 2; // quiet-zone modules

  const qr = $derived.by(() => {
    if (!data) return null;
    try {
      const q = qrcode(0, 'M'); // type 0 = auto-fit, error-correction M
      q.addData(data);
      q.make();
      const n = q.getModuleCount();
      const rects: { x: number; y: number }[] = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) rects.push({ x: c, y: r });
      return { n, rects };
    } catch { return null; }
  });
</script>

{#if qr}
  <svg viewBox="{-M} {-M} {qr.n + M * 2} {qr.n + M * 2}" width={size} height={size}
       shape-rendering="crispEdges" role="img" aria-label="QR code to join" class="rounded-lg">
    <rect x={-M} y={-M} width={qr.n + M * 2} height={qr.n + M * 2} fill="#ffffff" />
    {#each qr.rects as m}
      <rect x={m.x} y={m.y} width="1" height="1" fill="#0a0f0d" />
    {/each}
  </svg>
{/if}
