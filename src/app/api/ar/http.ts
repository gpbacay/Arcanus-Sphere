// Shared by the AR experience routes. The phone that scans the QR is this same app, so it may call them;
// another site in the browser may not (it cannot set this header without a preflight these routes never answer).
import { MAX_IMAGE_BYTES } from "@/modules/sphere/experience";

const HEADERS = { "cache-control": "no-store" };

export function arJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: HEADERS });
}

export function arAllowed(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  return (!site || site === "same-origin") && request.headers.get("x-arcanus") === "ar";
}

export function arFail(err: unknown) {
  const status = err && typeof err === "object" && "status" in err && typeof err.status === "number" ? err.status : 500;
  const error = err instanceof Error ? err.message : "Could not save the experience.";
  return arJson({ error }, status >= 400 && status < 600 ? status : 500);
}

/** The optional image field of a create or replace. Empty means "no new image". */
export async function arImage(form: FormData): Promise<Buffer | undefined> {
  const value = form.get("image");
  if (!(value instanceof Blob) || value.size === 0) return undefined;
  if (value.size > MAX_IMAGE_BYTES) throw Object.assign(new Error("That image is over 6 MB."), { status: 413 });
  return Buffer.from(await value.arrayBuffer());
}
