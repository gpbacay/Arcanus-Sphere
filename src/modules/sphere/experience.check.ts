// Run: node src/modules/sphere/experience.check.ts
import assert from "node:assert/strict";
import { experienceName, imageMime, MAX_NAME, validExperienceId, WORLD_ID } from "./experience.ts";

assert.equal(experienceName("  Desk   marker "), "Desk marker");
assert.equal(experienceName("a"), "a");
assert.equal(experienceName(" ".repeat(4)), null);
assert.equal(experienceName("x".repeat(MAX_NAME)), "x".repeat(MAX_NAME));
assert.equal(experienceName("x".repeat(MAX_NAME + 1)), null);
assert.equal(experienceName(12), null);

assert.equal(validExperienceId("ab".repeat(8)), true);
assert.equal(validExperienceId(WORLD_ID), false);
assert.equal(validExperienceId("AB".repeat(8)), false);
assert.equal(validExperienceId("../etc/passwd"), false);
assert.equal(validExperienceId("abcd"), false);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
assert.equal(imageMime(jpeg), "image/jpeg");
assert.equal(imageMime(png), "image/png");
assert.equal(imageMime(webp), "image/webp");
assert.equal(imageMime(gif), null);
assert.equal(imageMime(new Uint8Array()), null);

console.log("experience.check: ok");
