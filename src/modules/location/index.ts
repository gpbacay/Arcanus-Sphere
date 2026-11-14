"use client";

// Public API of the location module: where this device is, live from its GPS (the browser's Geolocation API), and
// the world map artifact (.arcanus/artifacts/world-map.html) shows it, through modules/artifacts' bridge. Arcanus runs on this device, so this is its position and the user's.
// Offline: the GPS keeps working (a phone's satellite fix needs no network; a desktop's Wi-Fi location does), the last
// fix is kept per account so a later visit still knows it, and places are named from public/geo/places.json.
import { scopedKey } from "@/modules/account";
import { Store } from "@/shared/store";
import { nearest, steady, whereLine, type Fix, type Near, type Place } from "./geo";

export { coordinates, placeName, type Fix, type Near } from "./geo";

/** off: not asked yet · asking: waiting for the first fix · live: fixes coming in · denied / unavailable: no fix. */
export type GpsStatus = "off" | "asking" | "live" | "denied" | "unavailable";
/** `prompting`: the browser's permission prompt is up, waiting for the user. */
export const gps = new Store<{ fix: Fix | null; status: GpsStatus; error?: string; prompting?: boolean }>({ fix: null, status: "off" });

const KEY = () => scopedKey("location_v1");
let watchId: number | null = null;
let restored = false;

/** The last fix kept on this device, until a live one comes in. */
function restore() {
  if (restored || gps.state.fix) return;
  restored = true;
  try {
    const fix = JSON.parse(localStorage.getItem(KEY()) ?? "null") as Fix | null;
    if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lon)) gps.set({ fix });
  } catch {
    /* nothing kept, or storage blocked */
  }
}

const reading = ({ coords, timestamp }: GeolocationPosition): Fix => ({
  lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy, at: timestamp, altitude: coords.altitude, heading: coords.heading, speed: coords.speed,
});

/** Keep a fix: shown, and saved for a later visit. */
function keep(fix: Fix) {
  gps.set({ fix, status: "live", error: undefined, prompting: false });
  try {
    localStorage.setItem(KEY(), JSON.stringify(fix));
  } catch {
    /* storage blocked: the fix lasts this session */
  }
}

/** Follow this device's position live. Asks for permission the first time; safe to call again. */
export function track() {
  restore();
  if (watchId !== null) return;
  if (!("geolocation" in navigator)) return gps.set({ status: "unavailable", error: "This browser has no location access." });
  if (gps.state.status !== "live") gps.set({ status: "asking", error: undefined });
  watchId = navigator.geolocation.watchPosition(
    // A reading that only wobbles inside its accuracy keeps the position where it is (geo steady).
    (pos) => keep(steady(gps.state.fix, reading(pos))),
    (err) => {
      gps.set({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable", error: err.message, prompting: false });
      if (err.code === err.PERMISSION_DENIED && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
}

/** Follow the position live only if the browser already allows it, so no permission prompt appears at load. */
export async function trackIfAllowed() {
  restore();
  const permission = await navigator.permissions?.query({ name: "geolocation" }).catch(() => null);
  if (permission?.state === "granted") track();
}

/**
 * Ask for this device's location now: the world map does this as it opens, so the browser's permission prompt comes
 * first. Already blocked, it asks nothing and says so. Allowed later in the site settings, it starts following.
 */
export async function askLocation() {
  restore();
  const permission = await navigator.permissions?.query({ name: "geolocation" }).catch(() => null);
  if (permission) permission.onchange = () => permission.state === "granted" && track();
  if (permission?.state === "denied") return gps.set({ status: "denied", prompting: false });
  gps.set({ prompting: permission?.state === "prompt" });
  track();
}

/**
 * Take the position again, from scratch: a fresh reading (none cached), kept as it comes rather than steadied. For when
 * the dot is in the wrong place: a fix that claimed a good accuracy would otherwise hold it there. The watch carries on.
 */
export async function recalibrate(): Promise<Fix | null> {
  await askLocation();
  if (gps.state.status === "denied" || !("geolocation" in navigator)) return null;
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        keep(reading(pos));
        resolve(gps.state.fix);
      },
      (err) => {
        gps.set({ error: err.message, prompting: false });
        resolve(null);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    ),
  );
}

/** The position now: the live fix, else the first one after asking (up to `wait` ms), else the last one kept. */
export function locate(wait = 10_000): Promise<Fix | null> {
  track();
  if (gps.state.status === "live" && gps.state.fix) return Promise.resolve(gps.state.fix);
  return new Promise((resolve) => {
    const done = () => {
      off();
      clearTimeout(timer);
      resolve(gps.state.fix);
    };
    const off = gps.subscribe(() => gps.state.status !== "asking" && done());
    const timer = setTimeout(done, wait);
  });
}

let places: Promise<Place[]> | null = null;
/** Natural Earth's ~7,000 populated places, from this site (kept offline by the service worker). */
function loadPlaces() {
  places ??= fetch("/geo/places.json").then((r) => (r.ok ? (r.json() as Promise<Place[]>) : Promise.reject(new Error(`places.json: ${r.status}`))));
  places.catch(() => (places = null));
  return places;
}

/** The named place closest to a fix, or null when the place list can't be read. */
export const nearPlace = (fix: Fix): Promise<Near | null> => loadPlaces().then((all) => nearest(all, fix.lat, fix.lon), () => null);

/** Arcanus's answer to "where am I" or ("self") "where are you". Null when there is no fix at all. */
export async function whereabouts(self: boolean): Promise<string | null> {
  const fix = await locate();
  if (!fix) return null;
  // Live while the GPS watch runs without error: a device that stays put gets no new readings, and is still live.
  return whereLine(fix, await nearPlace(fix), { self, live: gps.state.status === "live", now: Date.now() });
}

/** Why there is no fix, in words. */
export function noFixReason() {
  const { status, error } = gps.state;
  if (status === "denied") return "I can't see where we are: location access is blocked for this site. Allow it in the browser's site settings, then ask me again.";
  if (status === "unavailable") return `I can't get a position from this device right now${error ? ` (${error})` : ""}.`;
  return "I couldn't get a position from this device in time. Try again in a moment.";
}

