// Single source of truth for currencies & countries — shared by the client
// (currency/country pickers, home-page default) and the server (FX conversion in
// fx.js). Plain JS + JSDoc so it can be imported from .svelte, server .js, and
// node --test alike.

/** The currency/unit options offered in the pickers. `s` is the stored unit
 *  string (symbol or word), `n` is the human label. Free text is also allowed.
 *  @type {{ s: string, n: string }[]} */
export const CURRENCIES = [
  { s: '€', n: 'Euro' }, { s: '$', n: 'US Dollar' }, { s: '£', n: 'British Pound' },
  { s: 'zł', n: 'Polish Złoty' }, { s: 'CHF', n: 'Swiss Franc' }, { s: '¥', n: 'Japanese Yen / Chinese Yuan' },
  { s: '₹', n: 'Indian Rupee' }, { s: 'kr', n: 'Scandinavian Krone/Krona' }, { s: 'C$', n: 'Canadian Dollar' },
  { s: 'A$', n: 'Australian Dollar' }, { s: '₺', n: 'Turkish Lira' }, { s: 'R$', n: 'Brazilian Real' },
  { s: '₽', n: 'Russian Ruble' }, { s: '₩', n: 'Korean Won' }, { s: '₪', n: 'Israeli Shekel' },
  { s: 'Kč', n: 'Czech Koruna' }, { s: 'Ft', n: 'Hungarian Forint' }, { s: '฿', n: 'Thai Baht' },
  { s: 'R', n: 'South African Rand' }, { s: '₿', n: 'Bitcoin' },
  { s: 'BB', n: 'Big blinds' }, { s: 'chips', n: 'Chips (no money)' },
];

// A game's unit is a free-text symbol/word. For FX we map the symbols we know to
// an ISO 4217 code so monthly rates can convert between them. Ambiguous symbols
// pick the most common currency (¥→JPY, kr→SEK). Anything not here (₿ Bitcoin,
// BB, chips, custom text) is treated as NON-convertible and left out of money
// stats — there's no sane exchange rate for "big blinds" or "chips".
/** @type {Record<string, string>} */
export const SYMBOL_TO_ISO = {
  '€': 'EUR', '$': 'USD', '£': 'GBP', 'zł': 'PLN', 'CHF': 'CHF', '¥': 'JPY',
  '₹': 'INR', 'kr': 'SEK', 'C$': 'CAD', 'A$': 'AUD', '₺': 'TRY', 'R$': 'BRL',
  '₽': 'RUB', '₩': 'KRW', '₪': 'ILS', 'Kč': 'CZK', 'Ft': 'HUF', '฿': 'THB', 'R': 'ZAR',
};

// ISO → the symbol we display. Includes a few extras (NOK/DKK/CNY) so a player's
// country can default to a sensible symbol even though those collapse onto the
// same glyph for conversion (≈ "somewhat accurate", as agreed).
/** @type {Record<string, string>} */
export const ISO_TO_SYMBOL = {
  EUR: '€', USD: '$', GBP: '£', PLN: 'zł', CHF: 'CHF', JPY: '¥', CNY: '¥', INR: '₹',
  SEK: 'kr', NOK: 'kr', DKK: 'kr', CAD: 'C$', AUD: 'A$', TRY: '₺', BRL: 'R$', RUB: '₽',
  KRW: '₩', ILS: '₪', CZK: 'Kč', HUF: 'Ft', THB: '฿', ZAR: 'R',
};

/** Is this unit something we can attach an exchange rate to? (Bitcoin / chips /
 *  big blinds / custom text are not.)  @param {string} unit */
export function isConvertibleUnit(unit) {
  return Object.prototype.hasOwnProperty.call(SYMBOL_TO_ISO, unit);
}

// Countries for the searchable picker. `ccy` is the ISO currency; it only affects
// the default game currency, which collapses to a supported symbol (or € when we
// don't carry that currency's symbol).
/** @type {{ code: string, name: string, ccy: string }[]} */
export const COUNTRIES = [
  { code: 'AF', name: 'Afghanistan', ccy: 'AFN' }, { code: 'AL', name: 'Albania', ccy: 'ALL' },
  { code: 'DZ', name: 'Algeria', ccy: 'DZD' }, { code: 'AD', name: 'Andorra', ccy: 'EUR' },
  { code: 'AO', name: 'Angola', ccy: 'AOA' }, { code: 'AG', name: 'Antigua and Barbuda', ccy: 'XCD' },
  { code: 'AR', name: 'Argentina', ccy: 'ARS' }, { code: 'AM', name: 'Armenia', ccy: 'AMD' },
  { code: 'AU', name: 'Australia', ccy: 'AUD' }, { code: 'AT', name: 'Austria', ccy: 'EUR' },
  { code: 'AZ', name: 'Azerbaijan', ccy: 'AZN' }, { code: 'BS', name: 'Bahamas', ccy: 'BSD' },
  { code: 'BH', name: 'Bahrain', ccy: 'BHD' }, { code: 'BD', name: 'Bangladesh', ccy: 'BDT' },
  { code: 'BB', name: 'Barbados', ccy: 'BBD' }, { code: 'BY', name: 'Belarus', ccy: 'BYN' },
  { code: 'BE', name: 'Belgium', ccy: 'EUR' }, { code: 'BZ', name: 'Belize', ccy: 'BZD' },
  { code: 'BJ', name: 'Benin', ccy: 'XOF' }, { code: 'BT', name: 'Bhutan', ccy: 'BTN' },
  { code: 'BO', name: 'Bolivia', ccy: 'BOB' }, { code: 'BA', name: 'Bosnia and Herzegovina', ccy: 'BAM' },
  { code: 'BW', name: 'Botswana', ccy: 'BWP' }, { code: 'BR', name: 'Brazil', ccy: 'BRL' },
  { code: 'BN', name: 'Brunei', ccy: 'BND' }, { code: 'BG', name: 'Bulgaria', ccy: 'BGN' },
  { code: 'BF', name: 'Burkina Faso', ccy: 'XOF' }, { code: 'BI', name: 'Burundi', ccy: 'BIF' },
  { code: 'KH', name: 'Cambodia', ccy: 'KHR' }, { code: 'CM', name: 'Cameroon', ccy: 'XAF' },
  { code: 'CA', name: 'Canada', ccy: 'CAD' }, { code: 'CV', name: 'Cape Verde', ccy: 'CVE' },
  { code: 'CF', name: 'Central African Republic', ccy: 'XAF' }, { code: 'TD', name: 'Chad', ccy: 'XAF' },
  { code: 'CL', name: 'Chile', ccy: 'CLP' }, { code: 'CN', name: 'China', ccy: 'CNY' },
  { code: 'CO', name: 'Colombia', ccy: 'COP' }, { code: 'KM', name: 'Comoros', ccy: 'KMF' },
  { code: 'CG', name: 'Congo (Republic)', ccy: 'XAF' }, { code: 'CD', name: 'Congo (DRC)', ccy: 'CDF' },
  { code: 'CR', name: 'Costa Rica', ccy: 'CRC' }, { code: 'CI', name: "Côte d'Ivoire", ccy: 'XOF' },
  { code: 'HR', name: 'Croatia', ccy: 'EUR' }, { code: 'CU', name: 'Cuba', ccy: 'CUP' },
  { code: 'CY', name: 'Cyprus', ccy: 'EUR' }, { code: 'CZ', name: 'Czechia', ccy: 'CZK' },
  { code: 'DK', name: 'Denmark', ccy: 'DKK' }, { code: 'DJ', name: 'Djibouti', ccy: 'DJF' },
  { code: 'DM', name: 'Dominica', ccy: 'XCD' }, { code: 'DO', name: 'Dominican Republic', ccy: 'DOP' },
  { code: 'EC', name: 'Ecuador', ccy: 'USD' }, { code: 'EG', name: 'Egypt', ccy: 'EGP' },
  { code: 'SV', name: 'El Salvador', ccy: 'USD' }, { code: 'GQ', name: 'Equatorial Guinea', ccy: 'XAF' },
  { code: 'ER', name: 'Eritrea', ccy: 'ERN' }, { code: 'EE', name: 'Estonia', ccy: 'EUR' },
  { code: 'SZ', name: 'Eswatini', ccy: 'SZL' }, { code: 'ET', name: 'Ethiopia', ccy: 'ETB' },
  { code: 'FJ', name: 'Fiji', ccy: 'FJD' }, { code: 'FI', name: 'Finland', ccy: 'EUR' },
  { code: 'FR', name: 'France', ccy: 'EUR' }, { code: 'GA', name: 'Gabon', ccy: 'XAF' },
  { code: 'GM', name: 'Gambia', ccy: 'GMD' }, { code: 'GE', name: 'Georgia', ccy: 'GEL' },
  { code: 'DE', name: 'Germany', ccy: 'EUR' }, { code: 'GH', name: 'Ghana', ccy: 'GHS' },
  { code: 'GR', name: 'Greece', ccy: 'EUR' }, { code: 'GD', name: 'Grenada', ccy: 'XCD' },
  { code: 'GT', name: 'Guatemala', ccy: 'GTQ' }, { code: 'GN', name: 'Guinea', ccy: 'GNF' },
  { code: 'GW', name: 'Guinea-Bissau', ccy: 'XOF' }, { code: 'GY', name: 'Guyana', ccy: 'GYD' },
  { code: 'HT', name: 'Haiti', ccy: 'HTG' }, { code: 'HN', name: 'Honduras', ccy: 'HNL' },
  { code: 'HK', name: 'Hong Kong', ccy: 'HKD' }, { code: 'HU', name: 'Hungary', ccy: 'HUF' },
  { code: 'IS', name: 'Iceland', ccy: 'ISK' }, { code: 'IN', name: 'India', ccy: 'INR' },
  { code: 'ID', name: 'Indonesia', ccy: 'IDR' }, { code: 'IR', name: 'Iran', ccy: 'IRR' },
  { code: 'IQ', name: 'Iraq', ccy: 'IQD' }, { code: 'IE', name: 'Ireland', ccy: 'EUR' },
  { code: 'IL', name: 'Israel', ccy: 'ILS' }, { code: 'IT', name: 'Italy', ccy: 'EUR' },
  { code: 'JM', name: 'Jamaica', ccy: 'JMD' }, { code: 'JP', name: 'Japan', ccy: 'JPY' },
  { code: 'JO', name: 'Jordan', ccy: 'JOD' }, { code: 'KZ', name: 'Kazakhstan', ccy: 'KZT' },
  { code: 'KE', name: 'Kenya', ccy: 'KES' }, { code: 'KI', name: 'Kiribati', ccy: 'AUD' },
  { code: 'KW', name: 'Kuwait', ccy: 'KWD' }, { code: 'KG', name: 'Kyrgyzstan', ccy: 'KGS' },
  { code: 'LA', name: 'Laos', ccy: 'LAK' }, { code: 'LV', name: 'Latvia', ccy: 'EUR' },
  { code: 'LB', name: 'Lebanon', ccy: 'LBP' }, { code: 'LS', name: 'Lesotho', ccy: 'LSL' },
  { code: 'LR', name: 'Liberia', ccy: 'LRD' }, { code: 'LY', name: 'Libya', ccy: 'LYD' },
  { code: 'LI', name: 'Liechtenstein', ccy: 'CHF' }, { code: 'LT', name: 'Lithuania', ccy: 'EUR' },
  { code: 'LU', name: 'Luxembourg', ccy: 'EUR' }, { code: 'MO', name: 'Macau', ccy: 'MOP' },
  { code: 'MG', name: 'Madagascar', ccy: 'MGA' }, { code: 'MW', name: 'Malawi', ccy: 'MWK' },
  { code: 'MY', name: 'Malaysia', ccy: 'MYR' }, { code: 'MV', name: 'Maldives', ccy: 'MVR' },
  { code: 'ML', name: 'Mali', ccy: 'XOF' }, { code: 'MT', name: 'Malta', ccy: 'EUR' },
  { code: 'MH', name: 'Marshall Islands', ccy: 'USD' }, { code: 'MR', name: 'Mauritania', ccy: 'MRU' },
  { code: 'MU', name: 'Mauritius', ccy: 'MUR' }, { code: 'MX', name: 'Mexico', ccy: 'MXN' },
  { code: 'FM', name: 'Micronesia', ccy: 'USD' }, { code: 'MD', name: 'Moldova', ccy: 'MDL' },
  { code: 'MC', name: 'Monaco', ccy: 'EUR' }, { code: 'MN', name: 'Mongolia', ccy: 'MNT' },
  { code: 'ME', name: 'Montenegro', ccy: 'EUR' }, { code: 'MA', name: 'Morocco', ccy: 'MAD' },
  { code: 'MZ', name: 'Mozambique', ccy: 'MZN' }, { code: 'MM', name: 'Myanmar', ccy: 'MMK' },
  { code: 'NA', name: 'Namibia', ccy: 'NAD' }, { code: 'NR', name: 'Nauru', ccy: 'AUD' },
  { code: 'NP', name: 'Nepal', ccy: 'NPR' }, { code: 'NL', name: 'Netherlands', ccy: 'EUR' },
  { code: 'NZ', name: 'New Zealand', ccy: 'NZD' }, { code: 'NI', name: 'Nicaragua', ccy: 'NIO' },
  { code: 'NE', name: 'Niger', ccy: 'XOF' }, { code: 'NG', name: 'Nigeria', ccy: 'NGN' },
  { code: 'KP', name: 'North Korea', ccy: 'KPW' }, { code: 'MK', name: 'North Macedonia', ccy: 'MKD' },
  { code: 'NO', name: 'Norway', ccy: 'NOK' }, { code: 'OM', name: 'Oman', ccy: 'OMR' },
  { code: 'PK', name: 'Pakistan', ccy: 'PKR' }, { code: 'PW', name: 'Palau', ccy: 'USD' },
  { code: 'PS', name: 'Palestine', ccy: 'ILS' }, { code: 'PA', name: 'Panama', ccy: 'USD' },
  { code: 'PG', name: 'Papua New Guinea', ccy: 'PGK' }, { code: 'PY', name: 'Paraguay', ccy: 'PYG' },
  { code: 'PE', name: 'Peru', ccy: 'PEN' }, { code: 'PH', name: 'Philippines', ccy: 'PHP' },
  { code: 'PL', name: 'Poland', ccy: 'PLN' }, { code: 'PT', name: 'Portugal', ccy: 'EUR' },
  { code: 'QA', name: 'Qatar', ccy: 'QAR' }, { code: 'RO', name: 'Romania', ccy: 'RON' },
  { code: 'RU', name: 'Russia', ccy: 'RUB' }, { code: 'RW', name: 'Rwanda', ccy: 'RWF' },
  { code: 'KN', name: 'Saint Kitts and Nevis', ccy: 'XCD' }, { code: 'LC', name: 'Saint Lucia', ccy: 'XCD' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', ccy: 'XCD' }, { code: 'WS', name: 'Samoa', ccy: 'WST' },
  { code: 'SM', name: 'San Marino', ccy: 'EUR' }, { code: 'ST', name: 'São Tomé and Príncipe', ccy: 'STN' },
  { code: 'SA', name: 'Saudi Arabia', ccy: 'SAR' }, { code: 'SN', name: 'Senegal', ccy: 'XOF' },
  { code: 'RS', name: 'Serbia', ccy: 'RSD' }, { code: 'SC', name: 'Seychelles', ccy: 'SCR' },
  { code: 'SL', name: 'Sierra Leone', ccy: 'SLE' }, { code: 'SG', name: 'Singapore', ccy: 'SGD' },
  { code: 'SK', name: 'Slovakia', ccy: 'EUR' }, { code: 'SI', name: 'Slovenia', ccy: 'EUR' },
  { code: 'SB', name: 'Solomon Islands', ccy: 'SBD' }, { code: 'SO', name: 'Somalia', ccy: 'SOS' },
  { code: 'ZA', name: 'South Africa', ccy: 'ZAR' }, { code: 'KR', name: 'South Korea', ccy: 'KRW' },
  { code: 'SS', name: 'South Sudan', ccy: 'SSP' }, { code: 'ES', name: 'Spain', ccy: 'EUR' },
  { code: 'LK', name: 'Sri Lanka', ccy: 'LKR' }, { code: 'SD', name: 'Sudan', ccy: 'SDG' },
  { code: 'SR', name: 'Suriname', ccy: 'SRD' }, { code: 'SE', name: 'Sweden', ccy: 'SEK' },
  { code: 'CH', name: 'Switzerland', ccy: 'CHF' }, { code: 'SY', name: 'Syria', ccy: 'SYP' },
  { code: 'TW', name: 'Taiwan', ccy: 'TWD' }, { code: 'TJ', name: 'Tajikistan', ccy: 'TJS' },
  { code: 'TZ', name: 'Tanzania', ccy: 'TZS' }, { code: 'TH', name: 'Thailand', ccy: 'THB' },
  { code: 'TL', name: 'Timor-Leste', ccy: 'USD' }, { code: 'TG', name: 'Togo', ccy: 'XOF' },
  { code: 'TO', name: 'Tonga', ccy: 'TOP' }, { code: 'TT', name: 'Trinidad and Tobago', ccy: 'TTD' },
  { code: 'TN', name: 'Tunisia', ccy: 'TND' }, { code: 'TR', name: 'Turkey', ccy: 'TRY' },
  { code: 'TM', name: 'Turkmenistan', ccy: 'TMT' }, { code: 'TV', name: 'Tuvalu', ccy: 'AUD' },
  { code: 'UG', name: 'Uganda', ccy: 'UGX' }, { code: 'UA', name: 'Ukraine', ccy: 'UAH' },
  { code: 'AE', name: 'United Arab Emirates', ccy: 'AED' }, { code: 'GB', name: 'United Kingdom', ccy: 'GBP' },
  { code: 'US', name: 'United States', ccy: 'USD' }, { code: 'UY', name: 'Uruguay', ccy: 'UYU' },
  { code: 'UZ', name: 'Uzbekistan', ccy: 'UZS' }, { code: 'VU', name: 'Vanuatu', ccy: 'VUV' },
  { code: 'VA', name: 'Vatican City', ccy: 'EUR' }, { code: 'VE', name: 'Venezuela', ccy: 'VES' },
  { code: 'VN', name: 'Vietnam', ccy: 'VND' }, { code: 'YE', name: 'Yemen', ccy: 'YER' },
  { code: 'ZM', name: 'Zambia', ccy: 'ZMW' }, { code: 'ZW', name: 'Zimbabwe', ccy: 'ZWL' },
];

/** @type {Map<string, { code: string, name: string, ccy: string }>} */
const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));

/** The default game-currency symbol for a country. Accepts an ISO-2 code (what
 *  the picker stores) or, for older free-text values, a country name. Falls back
 *  to € when the country or its currency symbol isn't one we carry.
 *  @param {string | null | undefined} input @returns {string} */
export function currencyForCountry(input) {
  if (!input) return '€';
  const s = String(input).trim();
  let c = byCode.get(s.toUpperCase());
  if (!c) { const low = s.toLowerCase(); c = COUNTRIES.find((x) => x.name.toLowerCase() === low); }
  if (!c) return '€';
  return ISO_TO_SYMBOL[c.ccy] || '€';
}

/** Display name for a stored country code (or echoes a free-text value back).
 *  @param {string | null | undefined} input @returns {string} */
export function countryName(input) {
  if (!input) return '';
  const c = byCode.get(String(input).trim().toUpperCase());
  return c ? c.name : String(input);
}
