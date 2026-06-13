// Delight utilities — haptics, confetti, count-up. Dependency-free, and all
// respect prefers-reduced-motion.

const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A short, subtle vibration on supported devices. */
export function haptic(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

/** A celebratory confetti burst from the upper third of the screen. */
export function celebrate(opts = {}) {
  if (reduce()) return;
  const {
    particles = 140, spread = 78, power = 13,
    colors = ['#34d399', '#f4c451', '#ffffff', '#6ea8ff', '#ff5f6d'],
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;

  const cx = innerWidth / 2, cy = innerHeight * 0.3;
  const parts = Array.from({ length: particles }, () => {
    const angle = (-90 + (Math.random() * spread - spread / 2)) * Math.PI / 180;
    const v = power * (0.45 + Math.random());
    return {
      x: cx + (Math.random() - 0.5) * 60, y: cy,
      vx: Math.cos(angle) * v + (Math.random() - 0.5) * 4,
      vy: Math.sin(angle) * v - Math.random() * 3,
      g: 0.26 + Math.random() * 0.12,
      size: 4 + Math.random() * 6,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.32,
      life: 0, ttl: 95 + Math.random() * 45,
    };
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

// --- count-up -------------------------------------------------------------
// Elements opt in with data-count="<number>" plus optional:
//   data-unit="€"  data-countsign="1" (show +/−)  data-countsuffix="%"
//   data-countint="1" (whole numbers)  data-countinit="0" (first reveal from N)
//   data-countkey="..." (stable id so re-renders only animate real changes)
const lastShown = new Map();

function fmtEl(el, value) {
  const unit = el.dataset.unit || '';
  const suffix = el.dataset.countsuffix || '';
  const sign = el.dataset.countsign === '1';
  const int = el.dataset.countint === '1';
  const neg = value < 0;
  const abs = Math.abs(value);
  const num = int
    ? Math.round(abs).toLocaleString()
    : abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const body = unit + num + suffix;
  return sign ? (neg ? '−' : '+') + body : (neg ? '−' : '') + body;
}

export function animateCounts(scope = document) {
  const els = scope.querySelectorAll('[data-count]');
  els.forEach((el) => {
    const target = Number(el.dataset.count);
    const key = el.dataset.countkey || el.dataset.count;
    let from;
    if (el.dataset.countinit != null && !lastShown.has(key)) from = Number(el.dataset.countinit);
    else from = lastShown.has(key) ? lastShown.get(key) : target;
    lastShown.set(key, target);

    if (reduce() || from === target) { el.textContent = fmtEl(el, target); return; }
    const start = performance.now(), dur = 680;
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      el.textContent = fmtEl(el, from + (target - from) * e);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}
