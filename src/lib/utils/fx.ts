// Delight utilities — haptics, confetti, count-up. Dependency-free, respects prefers-reduced-motion.

const reduce = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function haptic(pattern: number | number[] = 12) {
  try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

export function celebrate(opts: { particles?: number; spread?: number; power?: number; colors?: string[] } = {}) {
  if (typeof window === 'undefined' || reduce()) return;
  const { particles = 140, spread = 78, power = 13, colors = ['#34d399', '#f4c451', '#ffffff', '#6ea8ff', '#ff5f6d'] } = opts;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const cx = innerWidth / 2, cy = innerHeight * 0.3;
  const parts = Array.from({ length: particles }, () => {
    const angle = (-90 + (Math.random() * spread - spread / 2)) * Math.PI / 180;
    const v = power * (0.45 + Math.random());
    return { x: cx + (Math.random() - 0.5) * 60, y: cy, vx: Math.cos(angle) * v + (Math.random() - 0.5) * 4, vy: Math.sin(angle) * v - Math.random() * 3, g: 0.26 + Math.random() * 0.12, size: 4 + Math.random() * 6, color: colors[(Math.random() * colors.length) | 0], rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.32, life: 0, ttl: 95 + Math.random() * 45 };
  });
  let frame = 0;
  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    for (const p of parts) {
      if (p.life > p.ttl) continue;
      alive++;
      p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
      ctx.translate(p.x * dpr, p.y * dpr);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size * dpr / 2, -p.size * dpr / 2, p.size * dpr, p.size * dpr * 0.62);
      ctx.restore();
    }
    if (alive > 0 && frame < 260) requestAnimationFrame(tick);
    else canvas.remove();
  }
  requestAnimationFrame(tick);
}
