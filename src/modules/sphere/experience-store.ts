// AR experiences saved on this computer, so a phone that opens the page from this server can load the same ones.
// They are not per account: the phone is a different browser, and the QR code is how it gets here.
// ponytail: one JSON index plus one image file each, rewritten whole, in the home directory (outside the project,
// so saving one does not restart the dev server). Move to a database if this has to sync across computers.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { experienceName, imageMime, MAX_EXPERIENCES, MAX_IMAGE_BYTES, type Experience, type ExperienceType, validExperienceId } from "./experience";

export type StoredExperience = Experience & { mime?: string };

const DIR = path.join(os.homedir(), ".arcanus", "ar");
const INDEX = path.join(DIR, "index.json");

function reject(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function isRow(value: unknown): value is StoredExperience {
  if (!value || typeof value !== "object") return false;
  const row = value as StoredExperience;
  return validExperienceId(row.id) && experienceName(row.name) === row.name && (row.type === "world" || row.type === "image");
}

async function readIndex(): Promise<StoredExperience[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(INDEX, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isRow) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    reject(500, "Could not read saved AR experiences.");
  }
}

/** Write via a temp file so a reader never sees a half-written index or image. Rename over the old file only if it is in the way. */
async function place(file: string, data: Buffer | string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, file);
  } catch {
    await fs.rm(file, { force: true });
    await fs.rename(tmp, file);
  }
}

let tail: Promise<unknown> = Promise.resolve();
function lock<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const imageFile = (id: string) => path.join(DIR, `${id}.img`);

export function listExperiences(): Promise<StoredExperience[]> {
  return readIndex();
}

export function readExperience(id: string): Promise<StoredExperience & { image: string | null }> {
  if (!validExperienceId(id)) reject(404, "That experience is not on this computer.");
  return lock(async () => {
    const row = (await readIndex()).find((item) => item.id === id);
    if (!row) reject(404, "That experience is not on this computer.");
    if (row.type !== "image") return { ...row, image: null };
    try {
      const bytes = await fs.readFile(imageFile(id));
      const mime = imageMime(bytes) ?? row.mime ?? "image/jpeg";
      return { ...row, image: `data:${mime};base64,${bytes.toString("base64")}` };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...row, image: null };
      reject(500, "Could not read the target image.");
    }
  });
}

export function createExperience(input: { name: string; type: ExperienceType; image?: Buffer }): Promise<StoredExperience> {
  return lock(async () => {
    const name = experienceName(input.name);
    if (!name) reject(400, "Give it a name, up to 60 characters.");
    if (input.type !== "world" && input.type !== "image") reject(400, "Choose world tracking or image tracking.");
    const items = await readIndex();
    if (items.length >= MAX_EXPERIENCES) reject(400, "24 experiences is the limit. Delete one first.");
    const id = randomBytes(8).toString("hex");
    let mime: string | undefined;
    if (input.type === "image") {
      if (!input.image?.length) reject(400, "Image tracking needs a target image.");
      if (input.image.length > MAX_IMAGE_BYTES) reject(413, "That image is over 6 MB.");
      mime = imageMime(input.image) ?? reject(400, "Use a JPEG, PNG, or WebP image.");
      await place(imageFile(id), input.image);
    }
    const row: StoredExperience = { id, name, type: input.type, ...(mime ? { mime } : {}) };
    try {
      await place(INDEX, JSON.stringify([...items, row]));
    } catch (err) {
      if (mime) await fs.rm(imageFile(id), { force: true });
      throw err;
    }
    return row;
  });
}

export function updateExperience(id: string, input: { name?: string; image?: Buffer }): Promise<StoredExperience> {
  return lock(async () => {
    if (!validExperienceId(id)) reject(404, "That experience is not on this computer.");
    const items = await readIndex();
    const index = items.findIndex((item) => item.id === id);
    const current = items[index];
    if (!current) reject(404, "That experience is not on this computer.");
    const next: StoredExperience = { ...current };
    if (input.name !== undefined) {
      const name = experienceName(input.name);
      if (!name) reject(400, "Give it a name, up to 60 characters.");
      next.name = name;
    }
    if (input.image) {
      if (current.type !== "image") reject(400, "World tracking has no target image.");
      if (input.image.length > MAX_IMAGE_BYTES) reject(413, "That image is over 6 MB.");
      next.mime = imageMime(input.image) ?? reject(400, "Use a JPEG, PNG, or WebP image.");
      await place(imageFile(id), input.image);
    }
    if (next.name === current.name && next.mime === current.mime) return current;
    items[index] = next;
    await place(INDEX, JSON.stringify(items));
    return next;
  });
}

export function deleteExperience(id: string): Promise<void> {
  return lock(async () => {
    if (!validExperienceId(id)) reject(404, "That experience is not on this computer.");
    const items = await readIndex();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) reject(404, "That experience is not on this computer.");
    await place(INDEX, JSON.stringify(next));
    await fs.rm(imageFile(id), { force: true });
  });
}
