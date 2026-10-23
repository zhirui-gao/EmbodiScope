/**
 * Rotation utilities. Matrices are row-major 3x3 arrays (m[r*3+c]); a 4x4 transform is row-major 16 numbers.
 * Euler conventions are named by the sequence of *extrinsic* (fixed-axis) rotations, the robotics/ROS
 * convention for roll-pitch-yaw: "xyz" extrinsic == R = Rz(yaw) * Ry(pitch) * Rx(roll).
 */
export type Mat3 = number[]
export type Mat4 = number[]
export type Vec3 = [number, number, number]

export type RotationRepr =
  | 'quat_xyzw'
  | 'quat_wxyz'
  | 'euler_xyz' // extrinsic x-y-z == roll/pitch/yaw (ROS, scipy 'xyz')
  | 'euler_zyx' // extrinsic z-y-x (scipy 'zyx')
  | 'euler_XYZ' // intrinsic X-Y-Z (scipy 'XYZ')
  | 'euler_ZYX' // intrinsic Z-Y-X == extrinsic xyz
  | 'rotvec' // axis-angle as rotation vector
  | 'rot6d' // first two columns of R (Zhou et al. 2019)
  | 'matrix' // 9 numbers row-major

export const ROTATION_DIMS: Record<RotationRepr, number> = {
  quat_xyzw: 4,
  quat_wxyz: 4,
  euler_xyz: 3,
  euler_zyx: 3,
  euler_XYZ: 3,
  euler_ZYX: 3,
  rotvec: 3,
  rot6d: 6,
  matrix: 9,
}

export const ROTATION_LABELS: Record<RotationRepr, string> = {
  quat_xyzw: 'Quaternion (x, y, z, w)',
  quat_wxyz: 'Quaternion (w, x, y, z)',
  euler_xyz: 'Euler RPY, extrinsic xyz (ROS)',
  euler_zyx: 'Euler extrinsic zyx',
  euler_XYZ: 'Euler intrinsic XYZ',
  euler_ZYX: 'Euler intrinsic ZYX (= extrinsic xyz)',
  rotvec: 'Rotation vector (axis·angle)',
  rot6d: '6D rotation (2 columns)',
  matrix: 'Rotation matrix 3×3',
}

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}

export function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}
export function rotY(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}
export function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

/** Quaternion (x, y, z, w) -> matrix. Non-unit quaternions are normalised. */
export function quatToMat(x: number, y: number, z: number, w: number): Mat3 {
  const n = Math.hypot(x, y, z, w) || 1
  x /= n; y /= n; z /= n; w /= n
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}

/** Matrix -> quaternion [x, y, z, w] with w >= 0. */
export function matToQuat(m: Mat3): [number, number, number, number] {
  const tr = m[0] + m[4] + m[8]
  let x, y, z, w
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s
  }
  return w < 0 ? [-x, -y, -z, -w] : [x, y, z, w]
}

export function rotvecToMat(rx: number, ry: number, rz: number): Mat3 {
  const th = Math.hypot(rx, ry, rz)
  if (th < 1e-12) return [...IDENTITY3]
  const s = Math.sin(th / 2) / th
  return quatToMat(rx * s, ry * s, rz * s, Math.cos(th / 2))
}

export function matToRotvec(m: Mat3): Vec3 {
  const [x, y, z, w] = matToQuat(m)
  const s = Math.hypot(x, y, z)
  if (s < 1e-12) return [0, 0, 0]
  const th = 2 * Math.atan2(s, w)
  return [(x / s) * th, (y / s) * th, (z / s) * th]
}

export function rot6dToMat(v: number[]): Mat3 {
  // columns a1 = v[0..2], a2 = v[3..5] -> Gram-Schmidt
  let a1: Vec3 = [v[0], v[1], v[2]]
  const n1 = Math.hypot(...a1) || 1
  a1 = [a1[0] / n1, a1[1] / n1, a1[2] / n1]
  const a2: Vec3 = [v[3], v[4], v[5]]
  const d = a1[0] * a2[0] + a1[1] * a2[1] + a1[2] * a2[2]
  let b2: Vec3 = [a2[0] - d * a1[0], a2[1] - d * a1[1], a2[2] - d * a1[2]]
  const n2 = Math.hypot(...b2) || 1
  b2 = [b2[0] / n2, b2[1] / n2, b2[2] / n2]
  const b3: Vec3 = [a1[1] * b2[2] - a1[2] * b2[1], a1[2] * b2[0] - a1[0] * b2[2], a1[0] * b2[1] - a1[1] * b2[0]]
  return [a1[0], b2[0], b3[0], a1[1], b2[1], b3[1], a1[2], b2[2], b3[2]]
}

export function eulerToMat(a: number, b: number, c: number, order: 'xyz' | 'zyx' | 'XYZ' | 'ZYX'): Mat3 {
  switch (order) {
    case 'xyz': // extrinsic x then y then z: R = Rz(c) Ry(b) Rx(a)
      return mul3(rotZ(c), mul3(rotY(b), rotX(a)))
    case 'zyx': // extrinsic z then y then x: R = Rx(c) Ry(b) Rz(a)
      return mul3(rotX(c), mul3(rotY(b), rotZ(a)))
    case 'XYZ': // intrinsic X, Y', Z'': R = Rx(a) Ry(b) Rz(c)
      return mul3(rotX(a), mul3(rotY(b), rotZ(c)))
    case 'ZYX': // intrinsic Z, Y', X'': R = Rz(a) Ry(b) Rx(c)
      return mul3(rotZ(a), mul3(rotY(b), rotX(c)))
  }
}

/** Convert a rotation given in any supported representation to a matrix. */
export function toMatrix(repr: RotationRepr, v: ArrayLike<number>): Mat3 {
  switch (repr) {
    case 'quat_xyzw':
      return quatToMat(v[0], v[1], v[2], v[3])
    case 'quat_wxyz':
      return quatToMat(v[1], v[2], v[3], v[0])
    case 'euler_xyz':
      return eulerToMat(v[0], v[1], v[2], 'xyz')
    case 'euler_zyx':
      return eulerToMat(v[0], v[1], v[2], 'zyx')
    case 'euler_XYZ':
      return eulerToMat(v[0], v[1], v[2], 'XYZ')
    case 'euler_ZYX':
      return eulerToMat(v[0], v[1], v[2], 'ZYX')
    case 'rotvec':
      return rotvecToMat(v[0], v[1], v[2])
    case 'rot6d':
      return rot6dToMat(Array.from(v))
    case 'matrix':
      return Array.from(v).slice(0, 9)
  }
}

/** Geodesic angle (rad) between two rotation matrices. */
export function rotationAngle(a: Mat3, b: Mat3): number {
  const r = mul3(transpose3(a), b)
  const c = (r[0] + r[4] + r[8] - 1) / 2
  return Math.acos(Math.max(-1, Math.min(1, c)))
}

/** Build a row-major 4x4 transform. */
export function makeTransform(R: Mat3, t: Vec3): Mat4 {
  return [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1]
}

export function invertTransform(T: Mat4): Mat4 {
  const R: Mat3 = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]]
  const Rt = transpose3(R)
  const t = apply3(Rt, [T[3], T[7], T[11]])
  return makeTransform(Rt, [-t[0], -t[1], -t[2]])
}

export function mul4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c]
  return o
}

export function applyTransform(T: Mat4, p: Vec3): Vec3 {
  return [
    T[0] * p[0] + T[1] * p[1] + T[2] * p[2] + T[3],
    T[4] * p[0] + T[5] * p[1] + T[6] * p[2] + T[7],
    T[8] * p[0] + T[9] * p[1] + T[10] * p[2] + T[11],
  ]
}
