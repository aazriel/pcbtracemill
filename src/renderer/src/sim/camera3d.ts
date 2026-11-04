/**
 * Orbit camera for the 3D simulation view. Stock millimetres, Z up (Z0 = copper top of the face
 * shown). Screen positions are CSS pixels from the top-left corner of the viewport.
 */

export type Vec3 = [number, number, number]

export interface Orbit {
  /** Point the camera orbits around (stock mm). */
  tx: number
  ty: number
  tz: number
  /** Rotation about Z (rad); 0 = looking towards +Y, so the view starts like the top view. */
  yaw: number
  /** Elevation above the board plane (rad); π/2 = straight down. */
  pitch: number
  /** Distance from the target (mm). */
  dist: number
}

export interface CamBasis {
  eye: Vec3
  f: Vec3
  r: Vec3
  u: Vec3
  /** tan(vertical fov / 2) */
  tanHalf: number
}

export const FOV_Y = (35 * Math.PI) / 180
export const MIN_PITCH = (8 * Math.PI) / 180
export const MAX_PITCH = (89.5 * Math.PI) / 180

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function basis(o: Orbit): CamBasis {
  const cp = Math.cos(o.pitch)
  const eye: Vec3 = [
    o.tx + o.dist * cp * Math.sin(o.yaw),
    o.ty - o.dist * cp * Math.cos(o.yaw),
    o.tz + o.dist * Math.sin(o.pitch)
  ]
  const f = norm([o.tx - eye[0], o.ty - eye[1], o.tz - eye[2]])
  const r = norm(cross(f, [0, 0, 1]))
  const u = cross(r, f)
  return { eye, f, r, u, tanHalf: Math.tan(FOV_Y / 2) }
}

/** Screen position of a stock point, or null when it is behind the camera. */
export function project(
  b: CamBasis,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number
): [number, number] | null {
  const v: Vec3 = [x - b.eye[0], y - b.eye[1], z - b.eye[2]]
  const d = dot(v, b.f)
  if (d < 1e-3) return null
  const k = h / 2 / (d * b.tanHalf)
  return [w / 2 + dot(v, b.r) * k, h / 2 - dot(v, b.u) * k]
}

export function rayAt(b: CamBasis, w: number, h: number, sx: number, sy: number): Vec3 {
  const nx = ((sx - w / 2) / (h / 2)) * b.tanHalf
  const ny = ((h / 2 - sy) / (h / 2)) * b.tanHalf
  return norm([
    b.f[0] + b.r[0] * nx + b.u[0] * ny,
    b.f[1] + b.r[1] * nx + b.u[1] * ny,
    b.f[2] + b.r[2] * nx + b.u[2] * ny
  ])
}

/** Where the ray under a screen point meets the plane Z = `z` (null if it never does). */
export function pickPlane(
  b: CamBasis,
  w: number,
  h: number,
  sx: number,
  sy: number,
  z = 0
): [number, number] | null {
  const d = rayAt(b, w, h, sx, sy)
  if (d[2] > -1e-6) return null
  const t = (z - b.eye[2]) / d[2]
  if (t <= 0) return null
  return [b.eye[0] + d[0] * t, b.eye[1] + d[1] * t]
}

/** Orbit that frames a stock of the given size. */
export function fitOrbit(width: number, height: number, thickness: number, w: number, h: number): Orbit {
  const aspect = Math.max(0.2, w / Math.max(1, h))
  const radius = Math.hypot(width, height) / 2 + 4
  const tanV = Math.tan(FOV_Y / 2)
  const tanFit = Math.min(tanV, tanV * aspect)
  return {
    tx: width / 2,
    ty: height / 2,
    tz: -thickness / 2,
    yaw: (-20 * Math.PI) / 180,
    pitch: (52 * Math.PI) / 180,
    dist: (radius / tanFit) * 1.05
  }
}
