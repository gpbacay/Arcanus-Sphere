// The AR experiences on this computer.
//   GET  /api/ar                          -> { experiences }
//   POST /api/ar   form: name, type, image?  -> the new experience
import { createExperience, listExperiences } from "@/modules/sphere/experience-store";
import type { ExperienceType } from "@/modules/sphere/experience";
import { arAllowed, arFail, arImage, arJson } from "./http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!arAllowed(request)) return arJson({ error: "Not available to other sites." }, 403);
  try {
    return arJson({ experiences: await listExperiences() });
  } catch (err) {
    return arFail(err);
  }
}

export async function POST(request: Request) {
  if (!arAllowed(request)) return arJson({ error: "Not available to other sites." }, 403);
  try {
    const form = await request.formData();
    const picked = form.get("type");
    const type: ExperienceType | null = picked === "world" || picked === "image" ? picked : null;
    if (!type) return arJson({ error: "Choose world tracking or image tracking." }, 400);
    const experience = await createExperience({ name: String(form.get("name") ?? ""), type, image: await arImage(form) });
    return arJson(experience, 201);
  } catch (err) {
    return arFail(err);
  }
}
