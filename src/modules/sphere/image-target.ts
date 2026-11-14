// One picture, as an 8th Wall image target, so the orb can lock onto it.
// Landscape pictures are turned portrait first (isRotated), the same way a printed card is tracked: the engine's
// axes then match the picture as it looks, instead of standing on its side.
// ponytail: the longest edge is cut to 1280px. Send the full photo if a small print stops being found.

const MAX_EDGE = 1280;
export const MARKER_NAME = "arcanus-marker";

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read the target image."));
    image.src = src;
  });
}

/** Draw the picture at tracking size. Landscape is rotated 90° clockwise onto a portrait canvas. */
function prepare(image: HTMLImageElement) {
  const sw = image.naturalWidth || image.width;
  const sh = image.naturalHeight || image.height;
  if (!sw || !sh) throw new Error("That image has no size.");
  const fit = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * fit));
  const h = Math.max(1, Math.round(sh * fit));
  const rotate = w > h;
  const canvas = document.createElement("canvas");
  canvas.width = rotate ? h : w;
  canvas.height = rotate ? w : h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the target image.");
  if (rotate) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(image, 0, 0, w, h);
  return { imagePath: canvas.toDataURL("image/jpeg", 0.92), width: canvas.width, height: canvas.height, isRotated: rotate };
}

/** ImageTargetData for XR8.XrController.configure. `imagePath` is a data URL, so the engine never has to fetch it. */
export async function imageTargetData(src: string) {
  const prepared = prepare(await loadImage(src));
  const { imagePath, width, height, isRotated } = prepared;
  return {
    type: "PLANAR" as const,
    properties: { top: 0, left: 0, width, height, originalWidth: width, originalHeight: height, isRotated },
    imagePath,
    metadata: null,
    name: MARKER_NAME,
    resources: { originalImage: imagePath, croppedImage: imagePath, thumbnailImage: imagePath, luminanceImage: imagePath },
    created: Date.now(),
    updated: Date.now(),
  };
}
