// Where a position is, in words: pure functions, so geo.check.ts runs them in Node. The places are Natural Earth's
// populated places (public domain), shipped in public/geo/places.json so naming a place works offline.

/** One reading of this device's position. `at`: when it was taken (ms since epoch). `accuracy`: metres. */
export type Fix = { lat: number; lon: number; accuracy: number; at: number; altitude?: number | null; heading?: number | null; speed?: number | null };
/** A populated place: [name, region, country, lat, lon, population]. */
export type Place = [string, string, string, number, number, number];
export type Near = { place: Place; km: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The closest place to a position. ponytail: a linear scan of ~7,000 places, well under a millisecond. */
export function nearest(places: Place[], lat: number, lon: number): Near | null {
  let best: Near | null = null;
  for (const place of places) {
    const km = distanceKm(lat, lon, place[3], place[4]);
    if (!best || km < best.km) best = { place, km };
  }
  return best;
}

/** "Davao, Davao del Sur, Philippines", or "about 40 km from Davao, Philippines" when the closest place is far. */
export function placeName(near: Near | null) {
  if (!near) return "somewhere I can't name";
  const [name, region, country] = near.place;
  const full = [name, region !== name ? region : "", country].filter(Boolean).join(", ");
  return near.km < 15 ? `in or near ${full}` : `about ${Math.round(near.km)} km from ${name}, ${country}`;
}

/** How long ago, in words a voice can say. */
export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 10 ? "just now" : s < 90 ? `${s} seconds ago` : s < 5400 ? `${Math.round(s / 60)} minutes ago` : `${Math.round(s / 3600)} hours ago`;
}

/** Latitude and longitude, written so they read and speak the same. */
export const coordinates = (fix: Fix) => `latitude ${fix.lat.toFixed(4)}, longitude ${fix.lon.toFixed(4)}`;

/**
 * Arcanus's answer to "where am I" / "where are you". It runs on this device, so its position is the user's.
 * `live`: the fix comes from a running GPS watch; otherwise it is the last one kept.
 */
export function whereLine(fix: Fix, near: Near | null, { self, live, now }: { self: boolean; live: boolean; now: number }) {
  const lead = self ? "I run on this device, so I'm where you are" : "You're";
  const when = live ? "live from this device's location" : `last known position, ${ago(now - fix.at)}`;
  return `${lead}${self ? ": " : " "}${placeName(near)}. That's ${coordinates(fix)}, within about ${Math.round(fix.accuracy)} metres (${when}).`;
}
