// The pane and the AR page talk to this computer's saved experiences. The header is what /api/ar requires.
import { WORLD_ID, type Experience, validExperienceId } from "./experience";

const HEADERS = { "x-arcanus": "ar" };

export type ExperienceDetail = Experience & { image: string | null };

async function read<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not reach AR experiences on this computer.");
  return data as T;
}

export function listSavedExperiences(): Promise<Experience[]> {
  return fetch("/api/ar", { headers: HEADERS, cache: "no-store" })
    .then((res) => read<{ experiences: Experience[] }>(res))
    .then((data) => (Array.isArray(data.experiences) ? data.experiences.filter((item) => item.id !== WORLD_ID && validExperienceId(item.id)) : []));
}

export async function readExperience(id: string): Promise<ExperienceDetail | null> {
  const res = await fetch(`/api/ar/${encodeURIComponent(id)}`, { headers: HEADERS, cache: "no-store" });
  if (res.status === 404) return null;
  return read<ExperienceDetail>(res);
}

function form(fields: { name?: string; type?: string; image?: Blob }) {
  const body = new FormData();
  if (fields.name !== undefined) body.set("name", fields.name);
  if (fields.type !== undefined) body.set("type", fields.type);
  if (fields.image) body.set("image", fields.image);
  return body;
}

export function createSavedExperience(fields: { name: string; type: "world" | "image"; image?: Blob }): Promise<Experience> {
  return fetch("/api/ar", { method: "POST", headers: HEADERS, body: form(fields) }).then((res) => read<Experience>(res));
}

export function updateSavedExperience(id: string, fields: { name?: string; image?: Blob }): Promise<Experience> {
  return fetch(`/api/ar/${encodeURIComponent(id)}`, { method: "PATCH", headers: HEADERS, body: form(fields) }).then((res) => read<Experience>(res));
}

export async function deleteSavedExperience(id: string) {
  const res = await fetch(`/api/ar/${encodeURIComponent(id)}`, { method: "DELETE", headers: HEADERS });
  await read(res);
}
