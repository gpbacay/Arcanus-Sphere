// What an AR experience is allowed to be. Shared by the pane, the AR page, and the save on this computer.
// Two kinds: world tracking (the orb in the room) and image tracking (the orb on a picture).

export type ExperienceType = "world" | "image";

export type Experience = {
  id: string;
  name: string;
  type: ExperienceType;
};

/** The world-tracking experience that has always been here. It is not a file: it is the app. */
export const WORLD_ID = "world";

export const WORLD_EXPERIENCE: Experience = { id: WORLD_ID, name: "World tracking", type: "world" };

export const MAX_NAME = 60;
export const MAX_IMAGE_BYTES = 6_000_000;
export const MAX_EXPERIENCES = 24;

/** A usable name, or null. Spaces at the ends and runs of spaces are folded away. */
export function experienceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > MAX_NAME) return null;
  return name;
}

/** Ids are 16 hex chars from the server. Anything else is not a file we will open. */
export function validExperienceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
}

/** JPEG, PNG, or WebP, from the file's own bytes. A renamed GIF is still a GIF. */
export function imageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
