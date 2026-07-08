// A compact gazetteer of major world cities for the city typeahead. Free text is
// always allowed (your city is captured whether or not it's in this list — the
// server canonicalizes it to a slug); this just offers quick, correctly-spelled
// suggestions as you type. Netherlands-first, then a broad world spread.
//
// Shape: [displayName, country]. Kept small on purpose (~180 cities) so it ships
// inline with no network call.

/** @type {Array<[string, string]>} */
export const WORLD_CITIES = [
  // Netherlands
  ['Amsterdam', 'Netherlands'], ['Rotterdam', 'Netherlands'], ['The Hague', 'Netherlands'],
  ['Utrecht', 'Netherlands'], ['Eindhoven', 'Netherlands'], ['Groningen', 'Netherlands'],
  ['Tilburg', 'Netherlands'], ['Breda', 'Netherlands'], ['Nijmegen', 'Netherlands'],
  ['Haarlem', 'Netherlands'], ['Arnhem', 'Netherlands'], ['Leiden', 'Netherlands'],
  ['Maastricht', 'Netherlands'], ["'s-Hertogenbosch", 'Netherlands'], ['Almere', 'Netherlands'],
  ['Delft', 'Netherlands'], ['Zwolle', 'Netherlands'], ['Enschede', 'Netherlands'],
  // Poland
  ['Warsaw', 'Poland'], ['Kraków', 'Poland'], ['Łódź', 'Poland'], ['Wrocław', 'Poland'],
  ['Poznań', 'Poland'], ['Gdańsk', 'Poland'], ['Katowice', 'Poland'], ['Lublin', 'Poland'],
  // UK & Ireland
  ['London', 'United Kingdom'], ['Manchester', 'United Kingdom'], ['Birmingham', 'United Kingdom'],
  ['Leeds', 'United Kingdom'], ['Glasgow', 'United Kingdom'], ['Edinburgh', 'United Kingdom'],
  ['Liverpool', 'United Kingdom'], ['Bristol', 'United Kingdom'], ['Dublin', 'Ireland'],
  // Germany
  ['Berlin', 'Germany'], ['Munich', 'Germany'], ['Hamburg', 'Germany'], ['Cologne', 'Germany'],
  ['Frankfurt', 'Germany'], ['Stuttgart', 'Germany'], ['Düsseldorf', 'Germany'], ['Leipzig', 'Germany'],
  // France, Belgium, Lux
  ['Paris', 'France'], ['Marseille', 'France'], ['Lyon', 'France'], ['Toulouse', 'France'],
  ['Nice', 'France'], ['Bordeaux', 'France'], ['Brussels', 'Belgium'], ['Antwerp', 'Belgium'],
  ['Ghent', 'Belgium'], ['Luxembourg', 'Luxembourg'],
  // Iberia
  ['Madrid', 'Spain'], ['Barcelona', 'Spain'], ['Valencia', 'Spain'], ['Seville', 'Spain'],
  ['Bilbao', 'Spain'], ['Málaga', 'Spain'], ['Lisbon', 'Portugal'], ['Porto', 'Portugal'],
  // Italy
  ['Rome', 'Italy'], ['Milan', 'Italy'], ['Naples', 'Italy'], ['Turin', 'Italy'],
  ['Florence', 'Italy'], ['Bologna', 'Italy'], ['Venice', 'Italy'],
  // Nordics
  ['Copenhagen', 'Denmark'], ['Stockholm', 'Sweden'], ['Gothenburg', 'Sweden'], ['Malmö', 'Sweden'],
  ['Oslo', 'Norway'], ['Bergen', 'Norway'], ['Helsinki', 'Finland'], ['Reykjavík', 'Iceland'],
  // Central & Eastern Europe
  ['Vienna', 'Austria'], ['Zurich', 'Switzerland'], ['Geneva', 'Switzerland'], ['Bern', 'Switzerland'],
  ['Prague', 'Czechia'], ['Brno', 'Czechia'], ['Budapest', 'Hungary'], ['Bratislava', 'Slovakia'],
  ['Bucharest', 'Romania'], ['Sofia', 'Bulgaria'], ['Zagreb', 'Croatia'], ['Ljubljana', 'Slovenia'],
  ['Belgrade', 'Serbia'], ['Athens', 'Greece'], ['Thessaloniki', 'Greece'],
  // Baltics & wider east
  ['Vilnius', 'Lithuania'], ['Riga', 'Latvia'], ['Tallinn', 'Estonia'], ['Kyiv', 'Ukraine'],
  ['Istanbul', 'Turkey'], ['Ankara', 'Turkey'], ['Moscow', 'Russia'], ['Saint Petersburg', 'Russia'],
  // Middle East
  ['Dubai', 'United Arab Emirates'], ['Abu Dhabi', 'United Arab Emirates'], ['Tel Aviv', 'Israel'],
  ['Doha', 'Qatar'], ['Riyadh', 'Saudi Arabia'],
  // North America
  ['New York', 'United States'], ['Los Angeles', 'United States'], ['Chicago', 'United States'],
  ['San Francisco', 'United States'], ['Las Vegas', 'United States'], ['Miami', 'United States'],
  ['Boston', 'United States'], ['Seattle', 'United States'], ['Austin', 'United States'],
  ['Denver', 'United States'], ['Atlanta', 'United States'], ['Washington', 'United States'],
  ['Toronto', 'Canada'], ['Montreal', 'Canada'], ['Vancouver', 'Canada'], ['Calgary', 'Canada'],
  ['Mexico City', 'Mexico'], ['Guadalajara', 'Mexico'],
  // South America
  ['São Paulo', 'Brazil'], ['Rio de Janeiro', 'Brazil'], ['Buenos Aires', 'Argentina'],
  ['Santiago', 'Chile'], ['Lima', 'Peru'], ['Bogotá', 'Colombia'], ['Medellín', 'Colombia'],
  // Asia
  ['Tokyo', 'Japan'], ['Osaka', 'Japan'], ['Seoul', 'South Korea'], ['Singapore', 'Singapore'],
  ['Hong Kong', 'Hong Kong'], ['Bangkok', 'Thailand'], ['Kuala Lumpur', 'Malaysia'],
  ['Jakarta', 'Indonesia'], ['Manila', 'Philippines'], ['Ho Chi Minh City', 'Vietnam'],
  ['Hanoi', 'Vietnam'], ['Mumbai', 'India'], ['Delhi', 'India'], ['Bangalore', 'India'],
  ['Shanghai', 'China'], ['Beijing', 'China'], ['Shenzhen', 'China'], ['Taipei', 'Taiwan'],
  // Oceania & Africa
  ['Sydney', 'Australia'], ['Melbourne', 'Australia'], ['Brisbane', 'Australia'], ['Perth', 'Australia'],
  ['Auckland', 'New Zealand'], ['Wellington', 'New Zealand'], ['Cape Town', 'South Africa'],
  ['Johannesburg', 'South Africa'], ['Cairo', 'Egypt'], ['Lagos', 'Nigeria'], ['Nairobi', 'Kenya'],
];

// Prebuilt lowercase search index (name + country), kept alongside the tuple.
const INDEXED = WORLD_CITIES.map(([name, country]) => ({
  name, country, key: (name + ' ' + country).toLowerCase(),
  nameLower: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
}));

/** Up to `limit` city suggestions for a typed query. Prefix matches rank above
 *  substring matches, so the list narrows sensibly as you type. Empty query → [].
 *  @param {string} query @param {number} [limit] @returns {Array<{name:string,country:string}>} */
export function suggestCities(query, limit = 3) {
  const q = String(query || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!q) return [];
  const prefix = [], contains = [];
  for (const c of INDEXED) {
    if (c.nameLower.startsWith(q)) prefix.push(c);
    else if (c.nameLower.includes(q) || c.key.includes(q)) contains.push(c);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit).map(({ name, country }) => ({ name, country }));
}
