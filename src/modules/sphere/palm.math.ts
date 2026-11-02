// The maths of resting Arcanus on a palm, with no three.js and no camera, so palm.check.ts can run it in plain Node.
// A hand arrives as 21 landmarks: `points` are (u, v) in the camera frame (0..1, top-left origin), `world` are (x, y) in
// metres around the hand's centre, with y down like the image. Landmark 0 is the wrist, 5/9/13/17 the knuckles.

export type Hand = { points: Float32Array; world: Float32Array };

/** The camera frame is drawn cover-fit into the canvas: scaled until it fills it, the overflow cropped evenly. */
export function coverScale(frameW: number, frameH: number, w: number, h: number) {
  return Math.max(w / frameW, h / frameH);
}

/** A point of the frame (u, v in 0..1) as normalised device coordinates on a w x h canvas. */
export function frameToNdc(u: number, v: number, frameW: number, frameH: number, w: number, h: number): [number, number] {
  const s = coverScale(frameW, frameH, w, h);
  const x = u * frameW * s - (frameW * s - w) / 2;
  const y = v * frameH * s - (frameH * s - h) / 2;
  return [(x / w) * 2 - 1, 1 - (y / h) * 2];
}

const KNUCKLES = [0, 5, 9, 13, 17];

/** The middle of the palm, as (u, v). */
export function palmCentre({ points }: Hand): [number, number] {
  let u = 0;
  let v = 0;
  for (const i of KNUCKLES) {
    u += points[2 * i];
    v += points[2 * i + 1];
  }
  return [u / KNUCKLES.length, v / KNUCKLES.length];
}

/**
 * Distance from the camera, in metres, along its axis. The hand's real size is known (world), so how big it looks (points)
 * gives the distance: pixels per metre by least squares over all 21 landmarks, which also copes with a tilted hand.
 * `focal` is the projection's 1 / tan(fov / 2): a length L across the view at distance Z spans focal * L / Z of the
 * screen's height. Returns null when the fit is nonsense.
 */
export function palmDepth({ points, world }: Hand, frameW: number, frameH: number, screenH: number, focal: number): number | null {
  let mx = 0, my = 0, wx = 0, wy = 0;
  for (let i = 0; i < 21; i++) {
    mx += points[2 * i] * frameW;
    my += points[2 * i + 1] * frameH;
    wx += world[2 * i];
    wy += world[2 * i + 1];
  }
  mx /= 21; my /= 21; wx /= 21; wy /= 21;
  let along = 0;
  let size = 0;
  for (let i = 0; i < 21; i++) {
    const dx = world[2 * i] - wx;
    const dy = world[2 * i + 1] - wy;
    along += (points[2 * i] * frameW - mx) * dx + (points[2 * i + 1] * frameH - my) * dy;
    size += dx * dx + dy * dy;
  }
  const pixelsPerMetre = along / size; // frame pixels
  if (!(pixelsPerMetre > 0)) return null;
  const screenPerMetre = pixelsPerMetre * coverScale(frameW, frameH, 1, screenH); // screen pixels per metre
  const z = (focal * screenH) / 2 / screenPerMetre; // a length L spans focal * L / Z of the half-height
  return z > 0.12 && z < 1.5 ? z : null; // beyond arm's reach either way: not a hand held out for Arcanus
}

/** An open hand: at least three of the four fingers reach out past their middle joint. A fist or a pointing hand is not. */
export function isOpen({ points }: Hand, frameW: number, frameH: number): boolean {
  const d = (a: number, b: number) => Math.hypot((points[2 * a] - points[2 * b]) * frameW, (points[2 * a + 1] - points[2 * b + 1]) * frameH);
  let out = 0;
  for (const [tip, joint] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (d(tip, 0) > d(joint, 0) * 1.1) out++;
  return out >= 3;
}

/**
 * The 1 Euro filter: smooth when the value is nearly still, so it does not shake, and quick when it moves, so it does not
 * lag. `cutoff` (Hz) is the smoothing at rest, `beta` how fast that opens up with speed.
 */
export class OneEuro {
  private x = 0;
  private dx = 0;
  private t = -1;
  private cutoff: number;
  private beta: number;
  constructor(cutoff = 1.2, beta = 8) {
    this.cutoff = cutoff;
    this.beta = beta;
  }
  reset() {
    this.t = -1;
  }
  filter(value: number, time: number) {
    if (this.t < 0) {
      this.x = value;
      this.dx = 0;
      this.t = time;
      return value;
    }
    const dt = Math.max(time - this.t, 1e-3);
    this.t = time;
    const alpha = (hz: number) => 1 / (1 + 1 / (2 * Math.PI * hz * dt));
    this.dx += ((value - this.x) / dt - this.dx) * alpha(1);
    this.x += (value - this.x) * alpha(this.cutoff + this.beta * Math.abs(this.dx));
    return this.x;
  }
}
