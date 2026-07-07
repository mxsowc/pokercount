<script lang="ts">
  // Sparkline chart. `points` = data series, oldest → newest.
  // `baseline` anchors the zero line (false = auto-range, no baseline drawn).
  // `color` overrides the stroke color (default: green if last ≥ 0, red if below).
  let { points = [], height = 60, baseline = 0 as number | false, color = '' }: { points?: number[]; height?: number; baseline?: number | false; color?: string } = $props();

  const W = 240;
  const series = $derived(points.length === 1 ? [0, points[0]] : points);
  const lo = $derived(baseline !== false ? Math.min(baseline, ...series) : Math.min(...series));
  const hi = $derived(baseline !== false ? Math.max(baseline, ...series) : Math.max(...series));
  const span = $derived(hi - lo || 1);
  const y = (v: number) => height - ((v - lo) / span) * height;
  const path = $derived.by(() => {
    const n = series.length;
    if (!n) return '';
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(n === 1 ? W : (i / (n - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
  });
  const area = $derived(path ? `${path} L${W},${height} L0,${height} Z` : '');
  const last = $derived(points[points.length - 1] ?? 0);
  const stroke = $derived(color || (last >= 0 ? 'var(--color-win)' : 'var(--color-danger)'));
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
      {#if baseline !== false}
        <line x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} stroke="currentColor" stroke-opacity="0.18" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" />
      {/if}
      <path d={path} fill="none" {stroke} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
    <!-- Fixed-px endpoint dot (a <circle> would squash under preserveAspectRatio=none). -->
    <span class="absolute w-2 h-2 rounded-full" style="right:0; top:{y(last)}px; transform:translateY(-50%); background:{stroke}; box-shadow:0 0 0 3px var(--color-bg)"></span>
  </div>
{/if}
