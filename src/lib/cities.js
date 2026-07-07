// Canonical city model.
//
// A user's `city` is free text (people know their own city best), but for clean,
// stable, SEO-friendly URLs (/homegames/amsterdam) and for grouping "adam" with
// "Amsterdam", we canonicalize every free-text value to a slug. A curated
// gazetteer maps the cities we care about most to nice display labels + country;
// any other city still gets a page, with a label derived from the user's text.

// A directory/city page needs real content before it's worth indexing — a page
// listing one lonely player is thin content that can drag the whole domain's
// quality signal down. Below this many public players a city page is rendered
// but marked noindex (and kept out of the sitemap) until it fills in.
export const INDEXABLE_MIN_PLAYERS = 3;

// Common variants / abbreviations → canonical slug. Applied after slugifying, so
// keys here are already in slug form.
const ALIASES = /** @type {Record<string,string>} */ ({
  adam: 'amsterdam',
  'a-dam': 'amsterdam',
  mokum: 'amsterdam',
  'den-haag': 'the-hague',
  'the-hague-nl': 'the-hague',
  's-gravenhage': 'the-hague',
  'den-bosch': 's-hertogenbosch',
  nyc: 'new-york',
  'new-york-city': 'new-york',
  sf: 'san-francisco',
  la: 'los-angeles',
});

// Curated gazetteer: slug → { label, country }. Drives nice page titles and seeds
// the directory. Netherlands-first (potcount is NL-based) plus a few beyond so the
// model isn't NL-only. Unlisted cities still get a page — label from the user's text.
export const CITIES = /** @type {Record<string,{label:string,country:string}>} */ ({
  amsterdam: { label: 'Amsterdam', country: 'Netherlands' },
  rotterdam: { label: 'Rotterdam', country: 'Netherlands' },
  'the-hague': { label: 'The Hague', country: 'Netherlands' },
  utrecht: { label: 'Utrecht', country: 'Netherlands' },
  eindhoven: { label: 'Eindhoven', country: 'Netherlands' },
  groningen: { label: 'Groningen', country: 'Netherlands' },
  tilburg: { label: 'Tilburg', country: 'Netherlands' },
  breda: { label: 'Breda', country: 'Netherlands' },
  nijmegen: { label: 'Nijmegen', country: 'Netherlands' },
  haarlem: { label: 'Haarlem', country: 'Netherlands' },
  arnhem: { label: 'Arnhem', country: 'Netherlands' },
  leiden: { label: 'Leiden', country: 'Netherlands' },
  maastricht: { label: 'Maastricht', country: 'Netherlands' },
  's-hertogenbosch': { label: "'s-Hertogenbosch", country: 'Netherlands' },
  london: { label: 'London', country: 'United Kingdom' },
  berlin: { label: 'Berlin', country: 'Germany' },
  paris: { label: 'Paris', country: 'France' },
  'new-york': { label: 'New York', country: 'United States' },
  'san-francisco': { label: 'San Francisco', country: 'United States' },
  'los-angeles': { label: 'Los Angeles', country: 'United States' },
});

/** Canonicalize free text (or a raw URL segment) to a city slug: strip accents,
 *  lowercase, collapse everything non-alphanumeric to single hyphens, then apply
 *  the alias map. `'Ámsterdam '` and `'ADAM'` both → `'amsterdam'`.
 *  @param {string | null | undefined} text @returns {string} */
export function citySlug(text) {
  const base = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents: é → e, ü → u
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ALIASES[base] || base;
}

/** Title-case a slug as a fallback label for unlisted cities. */
/** @param {string} slug @returns {string} */
export function labelFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Best display label for a slug: the curated label, else the nicest free-text
 *  casing we saw for it, else the title-cased slug.
 *  @param {string} slug @param {string} [fallbackText] @returns {string} */
export function cityLabel(slug, fallbackText) {
  if (CITIES[slug]) return CITIES[slug].label;
  const t = String(fallbackText || '').trim();
  return t || labelFromSlug(slug);
}

/** @param {string} slug @returns {string | null} */
export function cityCountry(slug) {
  return CITIES[slug]?.country || null;
}
