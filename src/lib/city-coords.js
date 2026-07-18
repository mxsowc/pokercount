// Approximate coordinates for the curated cities (see $lib/cities CITIES), so the
// "use my location" convenience can map a device's lat/lon to the nearest known
// city — entirely first-party, no third-party reverse-geocoding call. Cities not
// in this list simply aren't matched; the user types their city manually.

/** @type {Record<string, [number, number]>} slug → [lat, lon] */
export const CITY_COORDS = {
  amsterdam: [52.37, 4.90], rotterdam: [51.92, 4.48], 'the-hague': [52.08, 4.31],
  utrecht: [52.09, 5.12], eindhoven: [51.44, 5.48], groningen: [53.22, 6.57],
  tilburg: [51.56, 5.09], breda: [51.59, 4.78], nijmegen: [51.84, 5.86],
  haarlem: [52.38, 4.64], arnhem: [51.98, 5.91], leiden: [52.16, 4.49],
  maastricht: [50.85, 5.69], "'s-hertogenbosch": [51.70, 5.30],
  london: [51.51, -0.13], berlin: [52.52, 13.40], paris: [48.86, 2.35],
  'new-york': [40.71, -74.01], 'san-francisco': [37.77, -122.42], 'los-angeles': [34.05, -118.24],
};

/** Great-circle distance in km between two lat/lon points (haversine). */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The curated city nearest to a device's coordinates, or null if none is within
 *  `maxKm` (so someone far from every listed city isn't mis-placed).
 *  @param {number} lat @param {number} lon @param {number} [maxKm]
 *  @returns {{ slug: string, km: number } | null} */
export function nearestCity(lat, lon, maxKm = 120) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  for (const [slug, [clat, clon]] of Object.entries(CITY_COORDS)) {
    const km = haversineKm(lat, lon, clat, clon);
    if (!best || km < best.km) best = { slug, km };
  }
  return best && best.km <= maxKm ? best : null;
}
