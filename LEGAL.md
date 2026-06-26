# potcount — Legal & Compliance Review (NL)

> ⚠️ **NOT LEGAL ADVICE.** Produced by an AI agent panel (a primary `legal-counsel`
> review + an independent adversarial second opinion), 2026-06-26. It is a good-faith
> **risk map** to brief a qualified Dutch lawyer — not a substitute for one. For
> gambling and payments specifically, get written confirmation from licensed NL counsel
> (a *kansspelen*/fintech specialist) and, where relevant, the **Kansspelautoriteit
> (KSA)**, **DNB**, and the payment apps **before shipping**. Law/enforcement evolve.

---

## Bottom line (your two questions)

**A. Is everything legally OK to operate potcount in the Netherlands?**
**⚠️ Conditional — defensible, with one fix needed now.** As a *neutral bookkeeping
tool* that holds no funds, takes no rake, and doesn't organise or host games, the app
is **not a regulated gambling operator or payment service**, and private adult home
poker is legal in NL. **But** two things need handling: the **"Under 18" onboarding
option** (a serious red flag in a gambling-adjacent app — see Risk 1) and the
**gambling-"facilitation" grey zone** (enforcement-dependent — Risk 2).

**B. Can we add the payment deep links?**
**⚠️ / ⛔ Split verdict — technically allowed, but constrained by the payment apps' own
rules, not by Dutch financial law.**
- ✅ **PSD2/DNB:** Generating a *pre-filled* deep link that the **user** confirms in
  **their own** app (potcount never touches funds) is **not** a regulated payment
  service. Both reviewers agree. This is the clearly-OK part.
- ⛔ **The real blocker is third-party Terms of Service:** **PayPal prohibits gambling
  debts/winnings** outright; **Revolut** blocks gambling for users with the gambling
  block on. The adversarial opinion rates account-termination risk **"very high"** if
  transfers get tagged as gambling. **Tikkie** (NL, ABN AMRO) has **no public gambling
  prohibition** and is the most viable.
- **Net:** Shippable **if** scoped to Tikkie/Revolut (verified), **PayPal excluded**,
  links shown **only post-settlement**, with disclaimers and an 18+ gate — and ideally
  after a one-line read from NL counsel. Don't market it as "pay your gambling debt".

---

## Where the two opinions agreed vs. diverged

| Topic | Primary counsel | Adversarial (risk-max) |
|---|---|---|
| App as neutral tracker | Legal / not a gambling op | Agrees — but "weaponisable" if marketed as organising games |
| PSD2 on deep links | Not a payment service ✅ | Agrees ✅ (low today; high only if you later auto-initiate payments) |
| Payment links overall | ⚠️ conditional (Tikkie/Revolut ok, not PayPal) | ⛔ likely problem — ToS termination risk; consider not shipping |
| "Under 18" option | High risk — add 18+ gate | **"Time bomb"** — remove it; GDPR Art. 8 + gambling |
| AML / Wwft | Low / out of scope | Low, but latent if a criminal-proceeds angle appears |
| KSA "facilitation" | Medium, enforcement-dependent | Moderate-to-high if a complaint lands |

---

## Risk register (consolidated)

| # | Area | Concern | Severity | Mitigation |
|---|------|---------|---------:|------------|
| 1 | **GDPR/AVG + gambling — minors** | Onboarding offers an **"Under 18"** age option in a poker tracker; no 18+ gate, no parental-consent path. GDPR Art. 8 (NL digital-consent age 16) + Wok 18+ for games of chance. | **High** | **Add a hard "18+" gate at signup; remove the "Under 18" option.** Update privacy policy to state 18+ and purpose of age data. |
| 2 | **Gambling — facilitation (Wok/KSA)** | KSA can act across the "chain" (software/payment facilitators) for unlicensed games of chance; poker is a game of chance in NL. A tracker that *settles poker debts* + promotional framing ("who has the boat?") could be construed as facilitating/promoting. | **Medium** | Keep strictly neutral framing ("bookkeeping aid"), add a "your game must be legal where you are / 18+" acknowledgement; don't market as organising leagues/tournaments. |
| 3 | **Payment apps' ToS** | PayPal bans gambling transactions; Revolut blocks gambling; Tikkie likely OK. App could be seen as routing users around these. | **High (commercial)** | Exclude PayPal; verify Tikkie + Revolut in writing; disclaimer "the app may decline this payment". |
| 4 | **PSD2 / DNB** | Becoming a payment-initiation service. | **Low** (today) | Keep it **deep links only** (user confirms in their app). Do **not** auto-initiate/escrow without DNB registration. |
| 5 | **AML / Wwft** | Facilitating settlement of (gambling) debts. | **Low** | None required while no funds are handled; document the "not a financial institution" position. |
| 6 | **GDPR — processors/minimisation** | DPAs with S3 host / Google / Apple / (future email); is age/"heard-from" minimised & purpose-stated? | **Medium** | Confirm DPAs exist; state purpose + retention; keep data-deletion/export (already present). |
| 7 | **Corporate/consumer** | Imprint completeness (KvK no., registered entity/address) for a Dutch operator. | **Low** | Add an imprint (entity, KvK, address) to the footer/terms. |

---

## The payment-deep-links decision, explicitly

1. **Regulatory (PSD2/DNB):** ✅ pre-filled, user-confirmed deep links = not a payment
   service. Don't cross into auto-initiation/escrow (that triggers DNB registration and
   pulls KSA/Wwft into scope).
2. **KSA gambling-facilitation:** ⚠️ low-medium; mitigated by neutral framing + showing
   links **only after the game has ended/settled**, never during play or in marketing.
3. **Third-party ToS (the actual constraint):**
   - **PayPal — exclude.** Prohibits gambling debts/winnings; high termination risk.
   - **Revolut — conditional.** Works unless the payer has the gambling block on; add a
     disclaimer.
   - **Tikkie — most viable (NL).** No public gambling ban; verify directly with ABN AMRO.
   - **Venmo — US-only;** skip for NL.
4. **AML:** ✅ not triggered (no funds handled).

**Ship-safe conditions:** Tikkie/Revolut only (PayPal excluded) · links appear only
post-settlement · clear disclaimer ("opens a third-party app; it may decline; you're
responsible for the amount and legality") · 18+ gate in place · neutral framing · ToS &
privacy updated · ideally a brief written OK from NL counsel + Tikkie/Revolut.

---

## Confirm with a licensed NL lawyer (kansspelen + fintech)

1. Does a non-custodial home-poker *bookkeeping* tool fall outside "offering/organising
   games of chance" under the Wok, or could the KSA treat it as a facilitator/promoter?
2. Confirm pre-filled, user-confirmed deep links stay outside PSD2/PISP scope.
3. Any Wwft suspicious-activity duty for a non-financial app recording gambling debts?
4. Correct way to age-gate (18+) and handle/remove minor data under AVG Art. 8.
5. KSA enforcement precedent against ancillary/facilitating services or unlicensed-
   gambling advertising.
6. Imprint / consumer-law requirements for the Dutch operating entity.

---

## What already looks fine

- **No money custody, no rake, no game hosting** → not a payment service (PSD2) and not
  an AML-regulated entity; strongest part of the position.
- **Terms of Service** exist (`src/routes/terms`) with a "bookkeeping aid only / money
  changes hands between players outside potcount" disclaimer and a calculation-accuracy
  waiver.
- **Privacy policy** (`src/routes/privacy`) is clear; **only a session login cookie** (no
  third-party tracking cookies); **account deletion + (data) export** present (GDPR
  Art. 17/20 in spirit); backups pruned ~2 weeks after deletion.
- **OAuth** via Google/Apple; their policies apply.

---

## #1 immediate, cheap fix (both reviewers flag it)

Remove the **"Under 18"** option from age onboarding and add an **18+ confirmation** at
signup. Files: `src/routes/account/+page.svelte` (the age `<select>` with the
`under 18` option) and the signup flow; reflect "18+ only" in `src/routes/privacy`/
`terms`. Low effort, removes the highest-severity exposure.

---

## Sources (selected; full set in the agent transcripts)

- Kansspelautoriteit (KSA): https://kansspelautoriteit.nl/english/
- NL Gambling Laws & Regulations 2026 (ICLG): https://iclg.com/practice-areas/gambling-laws-and-regulations/netherlands/
- Wet op de kansspelen: https://wetten.overheid.nl/jci1.3:c:BWBR0029439
- KSA used banks/payment firms vs illegal gambling (2026): https://tribuna.com/en/casino/news/2026-01-09-dutch-regulator-used-banks-and-payment-firms-to-block-illegal-online-gambling-documents-s/
- PSD2 (DNB): https://www.dnb.nl/en/sector-information/open-book-supervision/laws-and-eu-regulations/psd2/
- PayPal gambling prohibition: https://www.paypal.com/us/cshelp/article/what-gambling-activities-does-paypal-prohibit-help391
- Revolut gambling block: https://help.revolut.com/en-US/help/profile-and-plan/security-and-personal-data/gambling-block/what-is-gambling-block/
- GDPR Art. 8 (children): https://gdpr-info.eu/art-8-gdpr/
- Autoriteit Persoonsgegevens: https://www.autoriteitpersoonsgegevens.nl/
- Wwft (AML): https://www.afm.nl/en/sector/themas/belangrijke-europese-wet--en-regelgeving/wwft
