// A "camera" for the background that reacts to the drums.
//  - kick (bass hit): a zoom punch plus a push in a direction that turns each kick
//    (down, left, up, right…), so a run of kicks moves the scene around instead of thumping in place
//  - snare/clap (mid-band hit): a quick sideways shake with a little tilt, alternating sides
// Springs pull everything back to center with a small bounce. Moves are capped so the
// screen never shifts more than ~4% of its size. (Pure, tested.)

export interface CameraState {
  /** shift, as a fraction of the smaller screen side */
  x: number;
  y: number;
  /** extra zoom (0.03 = 3% bigger) */
  zoom: number;
  /** tilt in radians */
  rot: number;
}

export const CAMERA_CAP = { shift: 0.04, zoom: 0.04, rot: 0.03 };

/** Kick directions, in turn: down, left, up, right. */
const KICK_DIRS: [number, number][] = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];

const STIFFNESS = 120; // spring strength
const DAMPING = 12; // < 2·√120 ≈ 22, so it bounces a little before settling

type Axis = keyof CameraState;
const AXES: Axis[] = ["x", "y", "zoom", "rot"];

export class SpringCamera {
  pos: CameraState = { x: 0, y: 0, zoom: 0, rot: 0 };
  private vel: CameraState = { x: 0, y: 0, zoom: 0, rot: 0 };
  private kicks = 0;
  private snares = 0;
  /** 0 = off, 1 = subtle, 1.8 = strong */
  strength = 1;

  /** A kick drum. `power` 0..1 (how hard), `boost` > 1 makes moves bigger (chorus). */
  kick(power = 1, boost = 1): void {
    if (this.strength <= 0) return;
    const k = this.strength * boost * Math.max(0.3, Math.min(1, power));
    const [dx, dy] = KICK_DIRS[this.kicks++ % KICK_DIRS.length];
    this.vel.x += dx * 0.27 * k;
    this.vel.y += dy * 0.27 * k;
    this.vel.zoom += 0.55 * k;
  }

  /** A snare or clap: a sideways jolt and tilt, alternating left and right. */
  snare(power = 1, boost = 1): void {
    if (this.strength <= 0) return;
    const k = this.strength * boost * Math.max(0.3, Math.min(1, power));
    const side = this.snares++ % 2 === 0 ? 1 : -1;
    this.vel.x += side * 0.36 * k;
    this.vel.rot += side * 0.18 * k;
  }

  /** Advance the springs by `dt` seconds. */
  update(dt: number): void {
    let left = Math.min(dt, 0.25);
    while (left > 0) {
      const step = Math.min(left, 1 / 120); // small steps keep the spring stable
      left -= step;
      for (const a of AXES) {
        const acc = -STIFFNESS * this.pos[a] - DAMPING * this.vel[a];
        this.vel[a] += acc * step;
        this.pos[a] += this.vel[a] * step;
      }
      this.clamp();
    }
  }

  reset(): void {
    this.pos = { x: 0, y: 0, zoom: 0, rot: 0 };
    this.vel = { x: 0, y: 0, zoom: 0, rot: 0 };
  }

  private clamp(): void {
    const cap = (a: Axis, lo: number, hi: number) => {
      if (this.pos[a] > hi) {
        this.pos[a] = hi;
        this.vel[a] = Math.min(0, this.vel[a]);
      } else if (this.pos[a] < lo) {
        this.pos[a] = lo;
        this.vel[a] = Math.max(0, this.vel[a]);
      }
    };
    cap("x", -CAMERA_CAP.shift, CAMERA_CAP.shift);
    cap("y", -CAMERA_CAP.shift, CAMERA_CAP.shift);
    cap("zoom", -0.01, CAMERA_CAP.zoom);
    cap("rot", -CAMERA_CAP.rot, CAMERA_CAP.rot);
  }
}

/** Zoom needed so a shifted/tilted/zoomed-out picture still covers the whole screen. */
export function overscan(c: CameraState, w: number, h: number): number {
  const m = Math.min(w, h);
  const shift = Math.max((Math.abs(c.x) * m * 2) / w, (Math.abs(c.y) * m * 2) / h);
  const tilt = Math.abs(Math.sin(c.rot)) * (Math.max(w, h) / Math.min(w, h));
  return 1 + shift + tilt + Math.max(0, -c.zoom) + 0.005;
}
