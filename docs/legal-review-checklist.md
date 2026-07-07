# potcount — Legal review checklist (hand this to a Dutch lawyer)

**Status:** Draft prepared with an AI legal-research assistant — **NOT legal advice.** Everything
below (Terms, Privacy, landing copy) has been written to the *strongest enforceable* form we can, but
**must be signed off by a licensed NL lawyer** (ideally one gambling/KSA specialist + one privacy
specialist) before you rely on it or launch the public directory.

Last compiled: 2026-07-07.

---

## The reality check up front

- **"Bulletproof / no responsibility at all" is not fully achievable.** NL/EU consumer law will not
  uphold a total exclusion of liability against a consumer (death/personal injury, intent/gross
  negligence, and mandatory consumer rights always survive). Our Terms include those carve-outs *on
  purpose* — removing them would make the whole liability clause easier for a court to strike.
- **Accuracy is the strongest defence.** Do **not** claim "potcount never involves money" — *private*
  games use real currency; only *public/listed* games are blinds-only. The true, strong line (used
  everywhere in our copy) is: **"potcount records and calculates; it never holds, receives, transfers,
  or is owed money."** An exaggerated disclaimer is easier for a regulator/court to disregard.

---

## Priority sign-off items (for the lawyer)

1. **Gambling posture — HIGHEST PRIORITY (KSA specialist).**
   Is our "scorekeeper, not a gambling operator/facilitator" characterisation sound? Specifically:
   - Does the **public city directory** ("find home games in your city") risk the *promotion/
     facilitation* limb — **"bevorderen van deelneming", Art. 1(1)(b) Wet op de kansspelen** — even
     though listed games are blinds-only/no-stakes and host-approved?
   - Do **private** games keep the *besloten kring* (closed-circle) comfort, or does publicly listing
     games to strangers forfeit it?
   - Clauses to review: `terms/+page.svelte` → "What potcount is not", "Private and public games",
     "Real-money gambling…". Landing → hero + "Open your games to friends" band + footer disclaimer.

2. **Payment / financial posture (PSD2 / Wft).**
   Confirm "not a payment service / not a payment institution." Safe today because **no money moves
   through the app** (verified: no payment/escrow/deep-link code). **Re-open this before ever shipping
   any payment deep-link / "pay them" feature.**

3. **Liability cap & exclusions.**
   Which parts of the "as is" warranty disclaimer, the liability limitation/cap, and the indemnity
   actually survive against consumers — and the right cap figure (currently "the amount you paid" =
   €0; counsel suggested a modest fixed floor may be more defensible). Clauses: `terms` → "No
   warranty", "Limitation of liability", "Indemnity", "Your own risk".

4. **International transfers & processor DPAs (privacy).**
   Confirm the real transfer mechanism for each US-based processor and that signed **Art. 28 GDPR
   DPAs** exist:
   - **Resend** (email), **Google** + **Apple** (OAuth sign-in), **Cloudflare R2** (backups).
   - Are they DPF-certified, or do we rely on SCCs? State the real safeguard. Clause: `privacy` →
     processors paragraph + not to be relied on until verified.

5. **City-directory legal basis.**
   Is **legitimate interest (Art. 6(1)(f)) with opt-out (Art. 21)** defensible at scale for a
   gambling-adjacent directory, or should listing become **explicit opt-in**? (Our default is
   currently opt-out via `privacy:'public'`.) Clause: `privacy` → "Public profile & the city directory".

6. **Retention periods.**
   Set concrete numbers (GDPR expects them): dormant-account auto-delete, email/server/access logs,
   and confirm the **~2-week backup purge** matches the Cloudflare R2 rotation in
   `src/lib/server/backup.js`. Clause: `privacy` → deletion/backups.

7. **Age (18+) verification.**
   Is self-declaration enough for a gambling-adjacent community, or is more required? (Under-18s are
   already excluded from the directory + a signup age handling exists.)

8. **Imprint accuracy.**
   Exact registered legal form/name, **KvK 42069102** (founder confirms correct), address, and a
   VAT/BTW number if applicable — must match the KvK register. Clause: `terms` → "Operator".

9. **Advertising/marketing copy (KSA).**
   Sign off the landing disclaimer + "find games / open games for friends" framing against the KSA
   advertising rules (**Besluit werving, reclame en verslavingspreventie**).

---

## Engineering / product items that affect the legal posture (fix before public launch)

- **Public-game read exposure (HIGH).** A public game's internal id is published on `/homegames`, and
  the **unauthenticated** game read (`GET /api/games/[id]`) + SSE (`…/events`) return the *full*
  payload — roster, audit log, and chat. So attendee identities and any posted content leak to
  anonymous visitors on public games.
  - Mitigated for **chat** already (chat blocked on public games + stripped in `withProfiles`).
  - **Still open:** roster + audit log. Needs a **participant-gated read** for `visibility:'public'`
    games. This is the discovery feature's read model — owner: the discovery workstream.
- **Discovery-page copy leads with money framing.** `/homegames` and `/homegames/[city]` currently say
  things like "we track every buy-in and work out who pays who" / "everyone sees their own money in
  real time." On the **public** directory surface this undercuts the social-play defence. Re-copy to
  social/blinds framing (money/settlement language is fine only on the *private-tracker* marketing).

---

## What already looks solid (baseline for the lawyer)

- **No money flows through the app** — pure calculator, no payment/escrow/fee/deep-link code.
- **Imprint present** (FatCloud, KvK) in Terms.
- **PIN hashing** (salted scrypt), **single strictly-necessary session cookie**, **no ad/tracking
  cookies**, self-hosted fonts → clean "no cookie banner" basis (Telecommunicatiewet).
- **Opt-in newsletter** (unticked by default) with one-tap unsubscribe, separated from account email.
- **Minors excluded** from public surfaces; 18+ gate.
- **Data-minimised directory** (handle + city only on indexed pages) with a working Art. 21 objection
  route (profile privacy / clear city).
- **Real self-service erasure**, with seat-unlinking so shared game history survives without a profile
  link.

---

## Relevant files
- Terms: `src/routes/terms/+page.svelte`
- Privacy: `src/routes/privacy/+page.svelte`
- Landing: `src/routes/+page.svelte`
- Directory (copy to align): `src/routes/homegames/+page.svelte`, `src/routes/homegames/[city]/+page.svelte`
- Data model / processors: `src/lib/types.ts`, `src/lib/server/users.js`, `src/lib/server/email.js`,
  `src/lib/server/backup.js`, `src/lib/server/debt-reminders.js`, `src/lib/engine/settle.js`
- Public-game read path: `src/routes/api/games/[id]/+server.ts`, `src/routes/api/games/[id]/events/+server.ts`
