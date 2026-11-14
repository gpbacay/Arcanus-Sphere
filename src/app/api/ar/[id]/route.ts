// One AR experience.
//   GET    /api/ar/:id                 -> the experience, with its target image (a data URL) when it has one
//   PATCH  /api/ar/:id  form: name?, image?  -> the experience
//   DELETE /api/ar/:id
import { deleteExperience, readExperience, updateExperience } from "@/modules/sphere/experience-store";
import { arAllowed, arFail, arImage, arJson } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  if (!arAllowed(request)) return arJson({ error: "Not available to other sites." }, 403);
  try {
    return arJson(await readExperience((await ctx.params).id));
  } catch (err) {
    return arFail(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  if (!arAllowed(request)) return arJson({ error: "Not available to other sites." }, 403);
  try {
    const form = await request.formData();
    const name = form.get("name");
    return arJson(await updateExperience((await ctx.params).id, { ...(name != null ? { name: String(name) } : {}), image: await arImage(form) }));
  } catch (err) {
    return arFail(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  if (!arAllowed(request)) return arJson({ error: "Not available to other sites." }, 403);
  try {
    await deleteExperience((await ctx.params).id);
    return arJson({ ok: true });
  } catch (err) {
    return arFail(err);
  }
}
