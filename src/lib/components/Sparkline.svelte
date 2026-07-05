<script lang="ts">
  // Cumulative-profit sparkline. `points` = running totals, oldest → newest.
  let { points = [], height = 60 }: { points?: number[]; height?: number } = $props();

  const W = 240;
  // A single finished game still draws a line — start it from 0 (break-even).
  const series = $derived(points.length === 1 ? [0, points[0]] : points);
  const lo = $derived(Math.min(0, ...series));
  const hi = $derived(Math.max(0, ...series));
  const span = $derived(hi - lo || 1);
  const y = (v: number) => height - ((v - lo) / span) * height;
  const path = $derived.by(() => {
    const n = series.length;
    if (!n) return '';
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(n === 1 ? W : (i / (n - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
  });
  // Close the line down to the floor for a soft area fill under the curve.
  const area = $derived(path ? `${path} L${W},${height} L0,${height} Z` : '');
  const last = $derived(points[points.length - 1] ?? 0);
  const up = $derived(last >= 0);
  const stroke = $derived(up ? 'var(--color-win)' : 'var(--color-danger)');
</script>

{#if points.length}
  <div class="relative" style="height:{height}px">
    <svg viewBox="0 0 {W} {height}" width="100%" {height} preserveAspectRatio="none" class="block overflow-visible">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={stroke} stop-opacity="0.16" />
          <stop offset="1" stop-color={stroke} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" stroke="none" />
      <!-- break-even baseline -->
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" stroke-opacity="0.18" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" />
      <path d={path} fill="none" {stroke} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
    <!-- Fixed-px endpoint dot (a <circle> would squash under preserveAspectRatio=none). -->
    <span class="absolute w-2 h-2 rounded-full" style="right:0; top:{y(last)}px; transform:translateY(-50%); background:{stroke}; box-shadow:0 0 0 3px var(--color-bg)"></span>
  </div>
{/if}
