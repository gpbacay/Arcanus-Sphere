import assert from "node:assert/strict";
import { ago, distanceKm, nearest, placeName, steady, whereLine, type Place } from "./geo.ts";

// London to Paris is about 344 km.
assert.ok(Math.abs(distanceKm(51.5074, -0.1278, 48.8566, 2.3522) - 344) < 2);
assert.equal(distanceKm(1, 2, 1, 2), 0);

const places: Place[] = [
  ["Manila", "Metropolitan Manila", "Philippines", 14.6042, 120.9822, 11100000],
  ["Davao", "Davao del Sur", "Philippines", 7.11, 125.63, 1402000],
  ["Tokyo", "Tokyo", "Japan", 35.685, 139.7514, 35676000],
];
assert.equal(nearest(places, 7.07, 125.61)?.place[0], "Davao");
assert.equal(nearest([], 0, 0), null);
assert.equal(placeName(nearest(places, 7.07, 125.61)), "in or near Davao, Davao del Sur, Philippines");
assert.match(placeName(nearest(places, 10, 124)), /^about \d+ km from Davao, Philippines$/);
assert.equal(placeName({ place: ["Tokyo", "Tokyo", "Japan", 0, 0, 0], km: 1 }), "in or near Tokyo, Japan"); // region = name: said once

assert.equal(ago(3000), "just now");
assert.equal(ago(45_000), "45 seconds ago");
assert.equal(ago(10 * 60_000), "10 minutes ago");

const fix = { lat: 7.0731, lon: 125.6128, accuracy: 12.4, at: 1000 };
const near = nearest(places, fix.lat, fix.lon);
assert.equal(
  whereLine(fix, near, { self: false, live: true, now: 1000 }),
  "You're in or near Davao, Davao del Sur, Philippines. That's latitude 7.0731, longitude 125.6128, within about 12 metres (live from this device's location).",
);
assert.match(whereLine(fix, near, { self: true, live: false, now: 1000 + 120_000 }), /^I run on this device, so I'm where you are: in or near Davao.*\(last known position, 2 minutes ago\)\.$/);

// The dot holds still through a reading's wobble, and moves when the device does or a sharper reading comes in.
const here = { lat: 7.0731, lon: 125.6128, accuracy: 50, at: 1 };
const wobble = { lat: 7.0733, lon: 125.6126, accuracy: 60, at: 2 }; // ~30 m off, inside the accuracy
assert.deepEqual(steady(here, wobble), { ...here, at: 2 });
const walked = { lat: 7.0761, lon: 125.6128, accuracy: 40, at: 3 }; // ~330 m north
assert.deepEqual(steady(here, walked), walked);
const sharper = { lat: 7.0732, lon: 125.6127, accuracy: 8, at: 4 };
assert.deepEqual(steady(here, sharper), sharper);
assert.deepEqual(steady(null, here), here);

console.log("geo ok");
