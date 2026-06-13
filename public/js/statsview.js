// Shared renderer for a player's stats card (used on the profile and account pages).

const fmt = (n) => (n >= 0 ? '+€' : '−€') + Math.abs(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const cls = (n) => (n >= 0 ? 'pos' : 'neg');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderStatsHTML(user, stats) {
  const u = (user.handle || 'me').replace(/[^a-z0-9_]/gi, ''); // stable key for count-ups
  return `
    <div class="card">
      <div class="spread">
        <div>
          <h2 style="margin:0">${esc(user.displayName)}</h2>
          <div class="muted small">@${esc(user.handle)}</div>
        </div>
        ${user.avatar ? `<img src="${esc(user.avatar)}" alt="" style="width:48px;height:48px;border-radius:50%" referrerpolicy="no-referrer">` : ''}
      </div>
      <div class="statgrid">
        <div class="stat"><div class="statnum ${cls(stats.totalProfit)}" data-count="${stats.totalProfit}" data-unit="€" data-countsign="1" data-countinit="0" data-countkey="tp-${u}">${fmt(stats.totalProfit)}</div><div class="statlbl">total profit</div></div>
        <div class="stat">${stats.gamesPlayed
          ? `<div class="statnum ${cls(stats.avgProfit)}" data-count="${stats.avgProfit}" data-unit="€" data-countsign="1" data-countinit="0" data-countkey="avg-${u}">${fmt(stats.avgProfit)}</div>`
          : '<div class="statnum">—</div>'}<div class="statlbl">avg / game</div></div>
        <div class="stat">${stats.gamesPlayed
          ? `<div class="statnum" data-count="${stats.profitablePct}" data-countsuffix="%" data-countint="1" data-countinit="0" data-countkey="pct-${u}">${stats.profitablePct}%</div>`
          : '<div class="statnum">—</div>'}<div class="statlbl">% profitable</div></div>
        <div class="stat">${stats.best
          ? `<div class="statnum ${cls(stats.best.net)}" data-count="${stats.best.net}" data-unit="€" data-countsign="1" data-countinit="0" data-countkey="best-${u}">${fmt(stats.best.net)}</div>`
          : '<div class="statnum">—</div>'}<div class="statlbl">best night</div></div>
        <div class="stat">${stats.worst
          ? `<div class="statnum ${cls(stats.worst.net)}" data-count="${stats.worst.net}" data-unit="€" data-countsign="1" data-countinit="0" data-countkey="worst-${u}">${fmt(stats.worst.net)}</div>`
          : '<div class="statnum">—</div>'}<div class="statlbl">worst night</div></div>
        <div class="stat"><div class="statnum" data-count="${stats.gamesPlayed}" data-countint="1" data-countinit="0" data-countkey="gp-${u}">${stats.gamesPlayed}</div><div class="statlbl">home games played</div></div>
      </div>
      <p class="hint" style="margin-top:10px">Profit is summed across finished games, in euros.</p>
    </div>

    ${stats.recent.length ? `
      <h3>Your games</h3>
      ${stats.recent.map((r) => {
        const tag = r.status === 'settled' ? ' · settled' : (r.net == null ? ' · in progress' : ' · ended');
        const right = r.net == null ? '<span class="pill">in progress</span>' : `<span class="amt ${cls(r.net)}">${fmt(r.net)}</span>`;
        return `<a class="transfer" href="/game?g=${r.id}" style="text-decoration:none;color:inherit">
          <span class="name">${esc(r.name)}</span>
          <span class="muted small">#${r.id}${tag}</span>
          ${right}
        </a>`;
      }).join('')}
    ` : '<p class="muted">No games yet.</p>'}
  `;
}
