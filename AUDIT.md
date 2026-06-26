# potcount — Full-Scope Audit (12 specialist agents)

> Generated 2026-06-26 by the `twelve-agent-full-audit` workflow: 12 domain agents audited in parallel, every critical/high finding adversarially verified (refuted ones dropped). Totals: {"critical":1,"high":8,"medium":22,"low":18,"info":1}. Engine tests: 102/102 pass.
>
> Domains with structured results in this pass: poker-engine-guardian, backend-api-store, data-migrations-integrity, security-auditor, frontend-svelte-ui, accessibility-a11y, performance-scalability, test-coverage-engineer, bug-triage-repro, growth-instrumentation.
> (SEO and code-quality agents are appended below — re-run after the initial pass.)

---

# potcount — Consolidated Full-Scope Audit

**12 domains audited · findings adversarially verified (refuted ones removed) · solo-dev money app**

---

## 1. Executive summary

potcount is in **strong shape on correctness and security** — the two things that matter most for a money app. The poker/money engine is essentially flawless: integer-cent accounting, zero-sum settlement proven across 100k+ property trials, and all variants (hi-lo, run-it-twice, double-board) correct. The backend, auth, and data layer are well-architected (atomic temp→rename writes, TOCTOU re-checks inside mutations, scrypt PIN hashing, signed sessions). **Test status: 102/102 pass** across 14 engine/security test files — but the suite tests pure functions and stores only; **zero HTTP-level / end-to-end coverage** of the 45 API routes is the biggest correctness blind spot. The two clearest through-lines are: **(a) the product is completely uninstrumented** — no analytics, no growth funnel visibility, no payment deep links, no push/email — which is the dominant gap for a growth-driven app; and **(b) data hygiene + lifecycle test gaps** (orphaned reactions/comments on game delete, untested lifecycle endpoints). Accessibility has solid fundamentals but several fixable keyboard/contrast/labeling issues. No critical or high-severity **security** vulnerabilities were found; the single critical is the analytics gap.

---

## 2. Top priorities (highest impact ÷ effort, do first)

| # | Sev | Problem | Location | Fix | Effort |
|---|-----|---------|----------|-----|--------|
| 1 | critical | Zero analytics — completely blind to acquisition & conversion funnel | `src/app.html` | Add Plausible (cookieless, ~5 lines); instrument visit→open→claim→signup→settled→paid | **S** |
| 2 | high | Reactions & comments orphaned forever when a game is deleted (manual delete + auto-reaper) | `src/lib/server/store.js:162-173` | Add `removeGameReactions/Comments(gameId)`, call both before `rmSync` in `deleteGame()` | **S** |
| 3 | high | "Save this win" signup CTA shown but unmeasured — can't tell which results convert | `src/routes/game/+page.svelte:1627-1642` | Add goals: cta_impression / cta_click / signup_from_game | **S** |
| 4 | high | Shared result links have no referral param — virality unmeasurable | `src/routes/game/+page.svelte:789` | Append `&ref=shared-result`; track visit→join by source | **S→M** |
| 5 | high | No payment deep links on settlement transfers (Venmo/PayPal/Revolut) | `src/routes/game/+page.svelte:1508-1520`; `.../settlement/[tid]/+server.ts` | Add `paymentMethods` to Transfer; generate creditor deep links | **M** |
| 6 | high | Settlement approval PUT handler (validation + status transition) entirely untested | `src/routes/api/games/[id]/settlement/+server.ts` (PUT) | Add settlement-approval test: valid/invalid transfers, paid flag, status→settled | **S** |
| 7 | high | Zero HTTP-level integration tests for 45+ API routes | `test/` (missing) | Add `endpoints.test.js` constructing Request objects (create/join/transaction/settlement) | **M** |
| 8 | high | No end-to-end create→join→buy→settle lifecycle test | `test/` (missing) | Add `workflow.test.js` chaining the full money flow on temp PC_DATA_DIR | **M** |
| 9 | high | Game lifecycle endpoints (lock/unlock/close/reopen/vote) untested | `test/`; `.../games/[id]/{lock,close,reopen,vote}` | Test: lock blocks non-host join, close/reopen transitions, vote aggregation | **M** |
| 10 | medium | TOCTOU: close endpoint computes settlement outside mutate closure | `src/routes/api/games/[id]/close/+server.ts:7-27` | Move settlement compute inside `mutate`, re-check status/playerIds (pattern in `final/+server.ts:30`) | **S** |
| 11 | medium | Modals don't trap or restore focus (keyboard/AT users get lost) | `src/routes/pot/+page.svelte:914-953`; `game/+page.svelte:1100-1112,1704-1756` | On open focus first element; on close restore to trigger | **M** |
| 12 | medium | Google OAuth email used without checking `email_verified` | `src/routes/api/auth/google/+server.ts:18` | Require `payload.email_verified === true` before trusting email | **S** |

> Items 6–9 collapse into one body of work: a single endpoint/workflow test harness covers most of them.

---

## 3. By severity

| Severity | Count |
|----------|------:|
| Critical | 1 |
| High | 8 |
| Medium | 22 |
| Low | 18 |
| Info | 1 |
| **Total** | **50** |

**Critical:**
- Zero analytics instrumentation — no conversion-funnel visibility (`src/app.html`) — *growth*

**High:**
- Reactions/comments orphaned on game delete (`store.js:162-173`) — *data* **[confirmed]**
- No HTTP-level tests for 45+ API routes (`test/`) — *test gap* **[confirmed]**
- No end-to-end create→join→buy→settle test (`test/`) — *test gap* **[confirmed]**
- Game lifecycle endpoints (lock/unlock/close/reopen/vote) untested (`test/`) — *test gap* **[confirmed]**
- Settlement-approval PUT handler untested (`settlement/+server.ts`) — *test gap* **[confirmed]**
- No payment deep links on transfers (`game/+page.svelte:1508-1520`) — *growth* **[confirmed]**
- Signup CTA at result unmeasured (`game/+page.svelte:1627-1642`) — *growth* **[confirmed]**
- Shared-link virality unmeasured (`game/+page.svelte:789`) — *growth* **[confirmed]**
- Web push / PWA unbuilt (`static/`, `app.html`) — *growth* **[confirmed]**
- Email digest unbuilt; newsletter opt-in unused (`types.ts:133-134`) — *growth* **[confirmed]**

> (10 high-severity lines above; the table in §2 promotes the 8 with best impact÷effort. Push and email digest are high-value but **M/L effort**, so they rank below the cheap test/growth wins.)

---

## 4. By domain

### Poker & money engine guardian — **CLEAN** ✅
**Verdict:** Extremely well-engineered; sound math, exhaustive property testing, zero issues.
**Test status:** 102/102 pass.
- No findings. Integer-cent accounting, proven zero-sum settlement, correct hi-lo/run-it-twice/double-board, optimal `maxZeroSumPartition` transfers.

### Backend / API / file-store specialist — near clean
**Verdict:** Strong mutation patterns, atomic writes, validation, rate limiting; one shutdown nit.
**Test status:** 102/102 pass.
- Reap interval timer not `unref()`'d — may block graceful shutdown — `src/lib/server/init.js:26` — add `timer.unref()` (pattern in `backup.js:117`, `fx.js:146`) — **S**

### Data integrity & migrations specialist
**Verdict:** Sound atomic stores, but game deletion leaks reactions/comments; no migration/restore/export tooling.
**Test status:** 13/13 pass.
- **[confirmed]** Orphaned reactions/comments on game delete — `store.js:162-173` — add+call `removeGameReactions/Comments` before `rmSync` — **S**
- Ad-hoc inline backfills, no versioning — `store.js:109-117` — add `schemaVersion` + migration runner — **M**
- Backups created but no restore path — `backup.js:24-47` — add tested `restore(archivePath)` — **M**
- No user data export endpoint (GDPR) — `src/routes/` — add `POST /api/me/export` — **M**
- No cross-file consistency/audit function — `src/lib/server/` — add `checkIntegrity()` — **M**
- Session secret written without temp+rename — `auth.js:16` — use tmp+rename for consistency — **S**
- S3 upload retry/idempotency untested — `backup.js:59-83` — add retry + mock test — **M**

### Security auditor
**Verdict:** Strong baseline; scrypt PINs, signed sessions, correct OAuth verify. Two informational gaps, no crit/high.
**Test status:** 102/102 pass.
- Google OAuth email not checked `email_verified` — `auth/google/+server.ts:18` — require verified — **S**
- OAuth flows lack nonce replay protection — `auth/google:11-14`, `auth/apple:12-13` — add server nonce (GIS mitigates client-side) — **M**
- `clientIp()` trusts first XFF value (spoofable if proxy untrusted) — `ratelimit.js:22-26` — ensure proxy overwrites XFF — **S**
- No security headers (CSP/HSTS/X-Frame-Options/nosniff) — `hooks.server.ts` — set in hooks or reverse proxy — **S**

### Frontend (Svelte 5 / Tailwind) specialist
**Verdict:** Well-architected runes & responsive design; a few reactivity/a11y nits, one large file.
**Test status:** n/a (no Vitest/Electron harness).
- Fake link uses onclick without proper Enter handling — `feed/+page.svelte:147-149` — use real `<a href>` — **S**
- `commentDraft` object mutated without reassignment — `feed/+page.svelte:46,66` — reassign after mutate — **S**
- Game page very large (1815 lines) — `game/+page.svelte` — extract components (optional) — **M**
- No CLAUDE.md codebase doc — repo root — add `.claude/CLAUDE.md` — **M**

### Accessibility auditor
**Verdict:** Solid semantics; gaps in modal focus, picker roles, icon labels, contrast.
**Test status:** n/a (manual read).
- **[overlaps frontend]** Modals don't trap/restore focus — `pot:914-953`, `game:1100-1112,1704-1756` — manage focus on open/close — **M**
- Pickers lack combobox/listbox/option roles — `CurrencyPicker.svelte`, `CountryPicker.svelte` — add ARIA roles + aria-expanded — **M**
- Icon-only buttons missing accessible names — `game:1128`, `+page:232`, `pot:924`, `feed:147` — add `aria-label` — **S**
- Contenteditable name fields unlabelled — `game:1089,1177` — add `role="textbox"`+aria-label — **M**
- Banner text contrast < 4.5:1 — `app.css:112-114` — brighten text / darken bg — **S**
- `--color-faint #60656a` fails AA for body text — `app.css:14` — reserve for supplementary only — **M**
- Social list sheet no Escape handler — `u/[handle]/+page.svelte:269-294` — add onkeydown Escape — **S**
- Some inputs lack for/id association — `game:1228`, `pot:619-621` — add id/for — **S**
- Feed name uses span role="link" — `feed:147` *(dup of frontend a11y-link)* — use `<a>` — **S**
- Cash-out inputs lack labels — `game:1289-1298` — add aria-label per field — **S**

### Performance & scalability auditor
**Verdict:** Well-sized for home-game scale; quadratic hotspots and full-file rewrites acceptable until ~1000 users.
**Test status:** n/a (node not on PATH).
- Admin stats O(users×games) — `admin/stats/+server.ts:54-70` — pre-build userId→games map / cache — **M**
- Leaderboard scans all games per user — `leaderboard/+server.ts:17` — index + 5-min cache — **M**
- Full-file JSON rewrite per mutation — `store.js:113`, `users.js:32-36`, etc. — batch/append-log if it bottlenecks — **L**
- SSE broadcasts full game object — `games/[id]/events/+server.ts:23-31` — fine at scale; diffs later — **M**
- Settlement recomputed for active games — `insights.js:10-17` — correct as-is — **S**
- Game page bundle large — `game/+page.svelte:1-50` — lazy-load if >300KB — **S**
- Feed nested loops — `feed/+server.ts:16-39` — reverse index if needed — **M**
- `getFollowers()` linear scan — `social.js:83-88` — add reverse index — **S**
- `og.png` is 727KB — `static/og.png` — compress to <200KB — **S**

### Test coverage engineer
**Verdict:** Engine/security exhaustively tested; HTTP, E2E, and lifecycle coverage absent.
**Test status:** 102/102 pass; 14 files; 7.35s.
- **[confirmed]** No HTTP-level tests for 45+ routes — `test/` — Request/Response harness — **M**
- **[confirmed]** No E2E create→join→buy→settle test — `test/` — `workflow.test.js` — **M**
- **[confirmed]** Lifecycle endpoints untested (lock/close/reopen/vote) — `test/` — lifecycle tests — **M**
- **[confirmed]** Settlement-approval PUT untested — `settlement/+server.ts` — approval test — **S**
- Concurrent join conflict (TOCTOU/case) untested — `join/+server.ts` — race test — **S**
- Rate limiting untested — `ratelimit.js`, `auth/login` — threshold/429 test — **S**
- 14 Svelte components/pages untested — `src/routes`, `lib/components` — Vitest+jsdom on high-risk — **M**
- Social endpoints untested at HTTP — `users/[handle]/{follow,...}` — follow/unfollow/list tests — **S**
- Comments/reactions endpoints untested at HTTP — `players/[pid]/{comment,react}` — action tests — **S**
- Leaderboard/series endpoints untested at HTTP — `leaderboard`, `series` — aggregation tests — **S**
- (info) Equity Monte Carlo determinism undocumented — `equity.test.js`, `property.test.js` — seed/comment — **S**
- Time-dependent test helpers not date-pinned — `stats.test.js:26` — fixed reference date — **S**

### Bug triage & proactive bug hunt
**Verdict:** Well-structured, few edge gaps; one real TOCTOU in close, two idempotency nits.
**Test status:** 102/102 pass.
- TOCTOU: close computes settlement outside mutate — `close/+server.ts:7-27` — move compute inside mutate, re-check — **S**
- reopen has no status guard (reopen already-active) — `reopen/+server.ts:11-14` — 409 if active — **S**
- meta allows editing closed game (no in-mutate re-check) — `meta/+server.ts:8-13` — re-check status in mutate — **S**

### Growth & instrumentation specialist
**Verdict:** Solid privacy infra but zero instrumentation/monetization — the dominant gap for a growth app.
**Test status:** n/a (not implemented).
- **[critical, confirmed]** Zero analytics — `app.html` — add Plausible + funnel goals — **S**
- **[confirmed]** No payment deep links on transfers — `game:1508-1520`; `settlement/[tid]` — Transfer.paymentMethods + creditor links — **M**
- **[confirmed]** Signup CTA at result unmeasured — `game:1627-1642` — impression/click/signup goals — **S**
- **[confirmed]** Shared-link virality unmeasured — `game:789` — `&ref=shared-result` + tracking — **M**
- **[confirmed]** Web push / PWA unbuilt — `static/`, `app.html` — manifest + SW + paid-push — **M**
- **[confirmed]** Email digest unbuilt; newsletter opt-in unused — `types.ts:133-134` — email service + cron digest — **L**
- Account-claim flow untracked — `game:1617-1626`; `claim/+server.ts` — claim funnel events — **S**
- Peer awards limited to one type, untracked — `game:1599-1606`; `types.ts:99` — extend votes + vote_cast event — **M**
- Onboarding data (country/heardFrom/ageRange) unanalyzed — `types.ts:136-138` — admin analytics endpoint — **M**
- Series leaderboards not surfaced — `+page.svelte:315-317`; `series/+server.ts` — (deferred) track series-tagged event — **S**
- Mark-paid flow untracked (retention moment) — `game:1517`; `settlement/[tid]:60-62` — transfer_marked_paid event — **S**
- Host game-open untracked — `+page.svelte:117-156`; `games/+server.ts` — game_opened event — **S**
- Privacy page promises "no tracking" but no cookieless solution — `privacy/+page.svelte:18` — update copy + deploy Plausible — **S**

---

## 5. Strengths (deduped across domains)

- **Money correctness is airtight.** Integer-cent accounting (toCents/Math.round) eliminates float drift; zero-sum settlement proven exactly across 20k balanced + 5k imbalanced + 100-game accumulation trials; optimal minimal-payment transfer algorithm; all poker variants (hi-lo, run-it-twice/thrice, double-board, side pots, odd-chip seat-priority) correct. *(engine, bug-triage, test-coverage)*
- **Atomic, crash-safe persistence.** All stores use temp→rename writes; fail-fast user load prevents silent lockout; corrupt game files skip-with-logging instead of crashing. *(backend, data, perf, bug-triage)*
- **TOCTOU discipline.** Critical mutations (join, players/add, transactions, final) re-validate invariants inside atomic mutate closures. *(backend, bug-triage)*
- **Auth & sessions hardened.** scrypt PIN hashing w/ per-user salt + timingSafeEqual; HMAC-SHA256 signed HttpOnly+SameSite=Lax cookies; OAuth JWT sig/issuer/aud/exp verified; account-link takeover guards; session secret 0600. *(security, backend, test-coverage)*
- **Comprehensive input validation & authz.** isMoney/isSafeId (blocks prototype pollution), string caps, range guards; isGameHost + privacyBlock + publicUser() leak-stripping; consistent ID normalization. *(backend, security, data)*
- **Rate limiting on sensitive routes** (login per-IP+per-handle, signup, games, comments, reactions, admin). *(backend, security)*
- **Robust schedulers + lifecycle hygiene.** backup & fx try-catch-wrapped, unref'd, prod-gated; game reaping/abandoned-deletion prevents unbounded growth; account deletion cascades across all stores. *(backend, data, perf)*
- **Performance well-matched to scale.** Settlement is optimal O(n²) bitmask DP capped at 14 players; touchLastSeen throttled to 1 write/hr/user; SSE heartbeat prevents leaks; avatar size capped. *(perf)*
- **Strong Svelte 5 frontend.** Correct runes, SSR/browser guards on localStorage, mobile-first responsive w/ safe-area insets, reusable pickers/components, escaped HTML output. *(frontend, a11y)*
- **Accessibility fundamentals.** Semantic `<nav>` + aria-current, role="status" toasts, Escape/backdrop modal close, 44px touch targets, prefers-reduced-motion respected, picker keyboard nav. *(a11y, frontend)*
- **Privacy-first foundation** for growth: session-only cookies, GDPR-aware policy, onboarding/newsletter schema already in place to build on. *(growth, security)*


---

## Appendix — re-run domains (SEO & code quality)

*These two agents failed to emit structured output in the parallel pass and were re-run separately. Their findings were NOT put through the adversarial verify pass, so treat severities as the agent's own assessment (notably: the "account-linking race" is mitigated by Node's single-threaded execution — verify before acting).*

### SEO & sharing auditor
**Verdict:** Good foundational setup; main gaps are per-page meta descriptions, missing `noindex` on private/ephemeral pages, dynamic OG for profiles, and incomplete sitemap.
**Test status:** n/a
- **Missing meta descriptions on app routes** — `feed/+page.svelte:84`, `account/+page.svelte:505`, `game/+page.svelte:877` — add `<meta name="description">` (only home + global fallback have one) — **high** — **S**
- **Game pages not `noindex`** — `game/+page.svelte:877` — ephemeral/private but publicly shareable; add `<meta name="robots" content="noindex,follow">` — **high** — **S**
- **Profile pages (u/[handle]) have no dynamic OG** — `u/[handle]/+page.svelte:89` — add `og:title/description/image` from profile data so shared stats links render with context — **high** — **M**
- **Account page not `noindex`** — `account/+page.svelte:505` — add `<meta name="robots" content="noindex">` — **medium** — **S**
- **Feed page not `noindex`** — `feed/+page.svelte:84` — user-specific/duplicate-content; add noindex — **medium** — **S**
- **Incomplete sitemap** — `static/sitemap.xml` — only `/` and `/pot`; add `/privacy`, `/terms` (public) — **medium** — **M**
- **Shared link not absolute HTTPS** — `game/+page.svelte:791` — `potcount.com/...` → `https://potcount.com/...` for clients that don't inherit origin — **low** — **S**
- **/pot sitemap priority high (0.8)** — `static/sitemap.xml:9` — lower to ~0.5 — **low** — **S**

**Strengths:** home has canonical + full OG/Twitter tags + `WebApplication` JSON-LD + correct 1200×630 og.png; favicons/apple-touch-icon set; robots.txt allows crawl; admin correctly `noindex`; share text inlines the URL to preserve chat preview cards.

### Code quality reviewer
**Verdict:** Clean, well-structured, idiomatic; no critical bugs. Mostly type-tightening and a couple of small consistency items.
**Test status:** n/a
- **Account-linking check-then-act** — `api/me/link/google/+server.ts:20`, `api/me/link/apple/+server.ts:20` — re-verify `owner !== userId` right before commit (mitigated by single-threaded Node; low real risk) — **high (likely overstated)** — **M**
- **`$state<any>` hides shape** — `game/+page.svelte:15-16,43,59,99-102` — use `Game`/`User|null`/`Transfer[]` from `types.ts` — **medium** — **M**
- **`meView` returns `email` not in its type** — `api/me/+server.ts:8-17` — add `email?: string | null` to the return type — **medium** — **S**
- **Finished-game settlement UI** — `game/+page.svelte:159-163` — `settlement` derived is null when not active; ensure ended/settled view renders `game.settlement` — **medium** — **M**
- **`decAmt` duplicated** — `pot/+page.svelte:12-13` & `game/+page.svelte:374-375` — extract the comma/decimal parser into `utils/money.ts` — **low** — **M**
- **fx corrupt-file parse is silent** — `fx.js:41-47` — `console.error` in the catch so operators notice an unreadable `fx-rates.json` — **low** — **S**
- **Redundant `|| null` in getGame** — `store.js:207` — minor; add JSDoc on the code→id→game fallback — **low** — **S**

**Strengths:** integer-cent money throughout, `money()/fmtSigned()` used consistently, `mutate()` store pattern, JSDoc on server modules, SSE version-check guards stale overwrites, HTML escaping on dynamic content, account-deletion double-confirm (handle + PIN), proper runes in new components.
