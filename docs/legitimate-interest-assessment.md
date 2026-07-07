# Legitimate Interest Assessment (LIA) — public city directory

**Controller:** FatCloud (potcount) · KvK 42069102 · Jacques Veltmanstraat 54, Amsterdam · info@fatcloud.nl
**Processing:** Listing a user's **self-chosen username + city** on the public, search-indexable city directory (`/homegames`, `/homegames/[city]`) and open-game listings.
**Lawful basis relied on:** Article 6(1)(f) GDPR — legitimate interest.
**Last reviewed:** 2026-07-07.

> This is an internal accountability record (GDPR Art. 5(2)), not legal advice. It should be reviewed and signed off by NL counsel before public launch, and re-reviewed if the data shown, the indexing, or the gambling-law posture changes.

## 1. Purpose / interest test — is there a legitimate interest?

**Interest:** Helping people discover local home poker games and the players near them, so a peer-to-peer community can form. This is a real, present interest, central to the product, and lawful. It also benefits users (finding local games) and hosts (filling tables).

**Necessity:** Some public, per-city surface is necessary to let non-registered people discover games via search — an app-only, logged-in directory would not be discoverable and would not serve the interest. The processing is limited to what that requires.

## 2. Necessity / data-minimisation test

Only the **minimum** fields needed to make the directory useful are published:

- **Username (handle):** self-authored, freely changeable, pseudonymous. Needed so a listing is attributable and clickable through to a profile.
- **City:** the grouping key; the whole point of a *city* directory.

Explicitly **NOT** published on the directory: real display name, avatar/photo, email, stats, buy-in amounts in real money (open games are shown in blinds only). Richer data (name/photo/stats) appears only on the user's own profile page `/u/[handle]`, one deliberate click away, and only if the profile is public.

Self-declared minors (`ageRange === 'under 18'`) are excluded from every public surface.

## 3. Balancing test — interest vs. the individual's rights

| Factor | Assessment |
|---|---|
| **Nature of data** | Low-impact, pseudonymous (handle + city). No special categories (Art. 9). No real name or face. |
| **Reasonable expectations** | Reinforced by transparency: disclosed in the privacy policy (with basis + objection right), and surfaced at the point of collection (the city field in account settings). |
| **Impact on the individual** | Limited — a chosen username + city on a public page. Not a real identity or location; no address, no money figures. |
| **Search indexing** | Pages are indexable, which raises impact — mitigated by publishing only a pseudonym, and by removing a user's entry the moment they opt out (pages are live-rendered server-side). |
| **Gambling context** | Some reputational sensitivity (association with poker). Mitigated by pseudonymity and blinds-only (social, non-money) framing. This is the main residual risk and the reason counsel sign-off is required. |
| **Safeguards** | Minor exclusion; data minimisation; one-click opt-out; live de-listing; no money shown. |

**Conclusion:** With the pseudonymous, minimised data set and the safeguards above, the controller's interest is not overridden by the interests or fundamental rights of the data subject. The balance would **not** hold if real name or avatar were published on the indexed pages — hence they are not.

## 4. Right to object (Art. 21) & transparency

- **Objection mechanism:** setting the profile to *members-only* or *private*, or clearing the *city*, in account settings — one click, honoured immediately, no questions asked. Because the basis is legitimate interest, any objection is acted on without requiring the user to show grounds.
- **De-listing:** directory pages render server-side from live data, so an opt-out drops the user immediately; search-engine cache may lag.
- **Transparency:** privacy policy names the basis and the objection right; the city field in settings carries an inline notice.

## 5. Residual risks / to confirm with counsel

- Whether the balancing passes for *pseudonymous handle + city, search-indexed, in a poker context* (gambling-adjacency is the wildcard).
- Whether the profile-privacy toggle legally suffices as the Art. 21 mechanism, or a dedicated "remove me from the directory" control is preferred.
- Interaction with the separate NL gambling-law posture (facilitation / *besloten kring*) — the directory must be lawful to operate in the first place.
- Adequacy of self-declared age as the minor gate on a public, gambling-adjacent surface.
