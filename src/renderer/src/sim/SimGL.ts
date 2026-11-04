/**
 * WebGL2 renderer for the material-removal heightfield.
 *
 * Two cameras share one fragment shader:
 *  - Top view: orthographic, straight down (like looking at a 3-axis machine bed).
 *  - 3D view: perspective orbit camera; every pixel ray-marches the heightfield (the slab between
 *    the copper top Z0 and the spoilboard at −thickness), so trenches, slots and the board edges
 *    are real geometry. The cutter is ray-traced as a surface of revolution of its true profile.
 *
 * The machined surface is rebuilt with crisp edges (flat copper tops, steps where material was
 * removed, vertical walls at through-cuts) on smooth contours, so cuts stay sharp at any zoom
 * without showing the cell grid. A movable sun lights it: copper is shaded as polished metal
 * (dark where it reflects the dim studio, glinting where it mirrors the sun), FR4 as matte
 * laminate, and a short ray-march towards the sun casts shadows into trenches and slots.
 *
 * Both faces of the board live on the GPU at once (one height + design texture per face), so
 * switching Top/Bottom is instant and progress on a face persists while the other one is milled.
 */
import type { CamBasis } from './camera3d'

export type SimFace = 'top' | 'bottom'

export interface SimField {
  nx: number
  ny: number
  /** mm per cell */
  res: number
  width: number
  height: number
  thickness: number
  copperThickness: number
  top: Float32Array
  mat?: Uint8Array
  design?: Uint8Array | null
}

export interface SimViewTransform {
  /** stock-space point at screen centre (mm) */
  cx: number
  cy: number
  /** CSS px per mm */
  zoom: number
}

/** The cutter as the shader draws it in the 3D view. */
export interface SimToolShape {
  /** Tip position (stock mm, Z relative to the copper top of the face shown). */
  x: number
  y: number
  z: number
  /** Body radius mm. */
  radius: number
  /** Radius at the very tip mm (V-bit flat). */
  tipRadius: number
  /** tan(half point angle) for V-bits and drills, 0 for straight cutters. */
  slope: number
  shape: 'straight' | 'cone' | 'ball'
  fluteLength: number
  flutes: number
  /** Rotation angle (rad) of the flutes. */
  spin: number
  cutting: boolean
}

export interface SimDrawOptions {
  side: SimFace
  showDesign: boolean
  /** Perspective camera; when absent the top view `view` transform is used. */
  camera?: CamBasis | null
  /** Cutter to draw (3D view only). */
  tool?: SimToolShape | null
  /** Unit vector towards the sun (stock coordinates, Z up). */
  light?: [number, number, number]
}

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uTop;     // R16F, linear: surface height (mm, <= 0)
uniform sampler2D uDesign;  // R8, linear: 1 where the design wants copper
uniform sampler2D uMat;     // RG8, linear: r = copper left on top, g = cut through
uniform vec2 uViewport;     // css px
uniform vec3 uView;         // cx, cy, zoom (px/mm) — top view
uniform float uDpr;
uniform vec2 uTexMm;        // texture extent in mm (nx*res, ny*res)
uniform float uRes;
uniform vec2 uStock;        // stock width, height mm
uniform float uCopper;      // copper thickness mm
uniform float uThick;       // board thickness mm
uniform float uShowDesign;
uniform float uSeed;        // per-face variation of the copper finish
uniform vec3 uLight;        // direction towards the sun (unit)
// 3D view
uniform float u3D;
uniform vec3 uEye;
uniform vec3 uCamF;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform float uTanHalf;
uniform vec4 uTool;         // tip x, y, z, visible
uniform vec4 uToolG;        // radius, tip radius, slope, shape (0 straight, 1 cone, 2 ball)
uniform vec4 uToolL;        // flute length, spin, flutes, cutting
out vec4 outColor;

const float PI = 3.14159265;
const float SUN = 2.5;      // sun intensity

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

float edgeDist(vec2 w) {
  vec2 d = min(w, uStock - w);
  return min(d.x, d.y);
}

// Raw cell heights, linearly filtered (the texture clamps at its border).
float htex(vec2 w) { return max(texture(uTop, w / uTexMm).r, -uThick); }

// Bilinear surface for the coarse ray-march, shadows and occlusion. Outside the stock: the floor.
float hfield(vec2 w) {
  if (edgeDist(w) < 0.0) return -uThick;
  return htex(w);
}

// Cubic B-spline over a virtual grid twice as coarse as the cells: every node is one bilinear
// fetch between 2×2 cells. It removes the staircase of the cell grid; the sharp surface below
// then puts the crisp edges back where the material really changes.
void bsWeights(float f, out vec4 w) {
  float f2 = f * f, f3 = f2 * f;
  w = vec4(-f3 + 3.0 * f2 - 3.0 * f + 1.0, 3.0 * f3 - 6.0 * f2 + 4.0, -3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0, f3) / 6.0;
}

float hspline(vec2 w) {
  float g = uRes * 2.0;
  vec2 p = w / g - 0.5;
  vec2 i = floor(p);
  vec4 wx, wy;
  bsWeights(p.x - i.x, wx);
  bsWeights(p.y - i.y, wy);
  float v = 0.0;
  for (int y = 0; y < 4; y++) {
    float r = 0.0;
    for (int x = 0; x < 4; x++) r += wx[x] * htex((i + vec2(float(x) - 0.5, float(y) - 0.5)) * g);
    v += wy[y] * r;
  }
  return v;
}

// Material masks (r = copper, g = through), same reconstruction.
vec2 matspline(vec2 w) {
  float g = uRes * 2.0;
  vec2 p = w / g - 0.5;
  vec2 i = floor(p);
  vec4 wx, wy;
  bsWeights(p.x - i.x, wx);
  bsWeights(p.y - i.y, wy);
  vec2 v = vec2(0.0);
  for (int y = 0; y < 4; y++) {
    vec2 r = vec2(0.0);
    for (int x = 0; x < 4; x++) r += wx[x] * texture(uMat, (i + vec2(float(x) - 0.5, float(y) - 0.5)) * g / uTexMm).rg;
    v += wy[y] * r;
  }
  return v;
}

// The machined surface with crisp edges: copper that is left is a perfectly flat top at Z0,
// milled areas lie below the copper layer, through-cuts drop to the floor, and the stock ends in
// a vertical edge. Edges sit on smooth contours, so they are sharp at any zoom but never stepped.
float hsharp(vec2 w) {
  if (edgeDist(w) < 0.0) return -uThick;
  vec2 m = matspline(w);
  if (m.g > 0.5) return -uThick;
  float h = hspline(w);
  // next to holes and cut-outs the copper mask decides, elsewhere the (sub-cell exact) heights
  bool copper = m.g > 0.04 ? m.r > 0.5 : h > -0.5 * uCopper;
  if (copper) return 0.0;
  return min(h, -uCopper - 0.002);
}

// ───────────────────────── 3D: heightfield ray-march

bool under(vec3 ro, vec3 rd, float t) {
  vec3 q = ro + rd * t;
  return q.z <= hsharp(q.xy);
}

// First point where the ray goes below the surface. The surface lives in the slab
// -thickness <= z <= 0, so only that part of the ray is marched.
bool marchField(vec3 ro, vec3 rd, out vec3 hit) {
  hit = ro + rd * 1000.0;
  if (rd.z > -1e-5) return false;
  float t0 = max(0.0, -ro.z / rd.z);
  float tFloor = (-uThick - ro.z) / rd.z;
  float t1 = tFloor;
  // Only the part of the ray over the stock can hit anything but the flat floor: clip to it.
  vec2 lo = (vec2(-0.5) - ro.xy) / rd.xy;
  vec2 hi = (uStock + 0.5 - ro.xy) / rd.xy;
  vec2 tin = min(lo, hi);
  vec2 tout = max(lo, hi);
  t0 = max(t0, max(tin.x, tin.y));
  t1 = min(t1, min(tout.x, tout.y));
  hit = ro + rd * tFloor;
  if (t1 <= t0) return true;
  float horiz = max(length(rd.xy), 1e-6);
  float span = (t1 - t0) * horiz;
  float dt = max(uRes * 0.6, span / 400.0) / horiz;
  float tp = t0;
  float t = t0;
  for (int i = 0; i < 420; i++) {
    vec3 p = ro + rd * t;
    if (p.z <= hfield(p.xy)) {
      // The bilinear surface found the neighbourhood; now locate the sharp surface exactly.
      float a = tp;
      for (int k = 0; k < 4; k++) {
        if (a <= t0 || !under(ro, rd, a)) break;
        a = max(t0, a - 2.0 * dt);
      }
      float b = a;
      for (int k = 0; k < 16; k++) {
        b = min(b + dt * 0.5, tFloor);
        if (under(ro, rd, b)) break;
        a = b;
      }
      for (int k = 0; k < 14; k++) {
        float m = 0.5 * (a + b);
        if (under(ro, rd, m)) b = m; else a = m;
      }
      hit = ro + rd * b;
      return true;
    }
    if (t >= t1) break;
    tp = t;
    t = min(t + dt, t1);
  }
  hit = ro + rd * tFloor;
  return true;
}

// ───────────────────────── lighting

// Dim photo studio around the board (what the metal reflects besides the sun): dark floor, a
// softly lit ceiling, one large soft box and a thin strip light.
vec3 envLight(vec3 r, float rough) {
  float wd = 1.0 + rough * 3.0;
  float up = smoothstep(-0.25, 0.85, r.z);
  vec3 c = mix(vec3(0.035, 0.03, 0.028), vec3(0.10, 0.105, 0.12), up);
  vec2 da = normalize(vec2(-0.6, 0.8));
  float a = exp(-pow((dot(r.xy, da) - 0.30) / (0.09 * wd), 2.0) - pow(dot(r.xy, vec2(-da.y, da.x)) / (0.22 * wd), 2.0))
          * smoothstep(0.2, 0.7, r.z);
  float b = exp(-pow((dot(r.xy, normalize(vec2(0.9, -0.2))) - 0.50) / (0.05 * wd), 2.0)) * smoothstep(0.05, 0.45, r.z);
  float hor = exp(-pow(r.z / 0.28, 2.0));
  return c + vec3(1.0, 0.97, 0.93) * (a * 0.9 + b * 0.6) / wd + vec3(0.10, 0.08, 0.06) * hor;
}

// Cook-Torrance (GGX) highlight of the sun: the bright, moving glint on polished metal.
vec3 sunSpec(vec3 n, vec3 V, vec3 L, vec3 F0, float alpha) {
  float NoL = max(dot(n, L), 0.0);
  float NoV = max(dot(n, V), 1e-3);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 H = normalize(L + V);
  float NoH = max(dot(n, H), 0.0);
  float VoH = max(dot(V, H), 0.0);
  float a2 = alpha * alpha;
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = alpha * 0.5 + 0.05;
  float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
  return F * (D * G / max(4.0 * NoL * NoV, 1e-3)) * NoL * SUN;
}

// Dark studio surface the board lies on, gently lit around the board and fading to black.
vec3 backdrop(vec3 rd) {
  float t = clamp(rd.z * 0.8 + 0.7, 0.0, 1.0);
  return mix(lin(vec3(0.085, 0.085, 0.09)), lin(vec3(0.03, 0.03, 0.033)), t);
}

vec3 floorColor(vec2 w, float diff, float sh) {
  float r = length(w - uStock * 0.5) / max(length(uStock), 1.0);
  vec3 base = mix(lin(vec3(0.24, 0.24, 0.25)), lin(vec3(0.085, 0.085, 0.09)), smoothstep(0.3, 1.7, r));
  float od = max(-edgeDist(w), 0.0);
  float contact = 1.0 - 0.5 * exp(-od / 2.0);
  return base * (0.45 + 0.55 * diff * sh) * contact;
}

// ───────────────────────── 3D: the cutter

// Signed distance (conservative) to the cutter: its true profile up to the flute length, then the
// shank, up to a collet far above the board.
float toolSdf(vec3 p) {
  vec3 q = p - uTool.xyz;
  float rr = length(q.xy);
  float R = uToolG.x;
  float d;
  if (uToolG.w > 1.5) {
    d = q.z < R ? length(vec3(q.xy, q.z - R)) - R : rr - R;
  } else {
    float s = uToolG.z;
    float r = min(R, uToolG.y + max(q.z, 0.0) * s);
    d = (rr - r) / sqrt(1.0 + s * s);
    d = max(d, -q.z);
  }
  return max(d, q.z - uToolL.x - 30.0);
}

bool marchTool(vec3 ro, vec3 rd, float tmax, out float tHit) {
  tHit = 0.0;
  float t = 0.0;
  for (int i = 0; i < 110; i++) {
    float d = toolSdf(ro + rd * t);
    if (d < 0.0004 + t * 0.0004) { tHit = t; return true; }
    t += d;
    if (t > tmax) return false;
  }
  return false;
}

float toolShadow(vec3 p) {
  if (uTool.w < 0.5) return 1.0;
  float s = 1.0;
  float t = 0.02;
  for (int i = 0; i < 28; i++) {
    float d = toolSdf(p + uLight * t);
    if (d < 0.0005) return 0.2;
    s = min(s, 6.0 * d / t);
    t += clamp(d, 0.02, 3.0);
    if (t > 60.0) break;
  }
  return 0.2 + 0.8 * clamp(s, 0.0, 1.0);
}

vec3 shadeTool(vec3 p, vec3 rd) {
  float e = 0.0015;
  vec3 n = normalize(vec3(
    toolSdf(p + vec3(e, 0, 0)) - toolSdf(p - vec3(e, 0, 0)),
    toolSdf(p + vec3(0, e, 0)) - toolSdf(p - vec3(0, e, 0)),
    toolSdf(p + vec3(0, 0, e)) - toolSdf(p - vec3(0, 0, e))));
  vec3 q = p - uTool.xyz;
  vec3 V = -rd;
  float flutes = max(uToolL.z, 1.0);
  bool cutter = q.z < uToolL.x;
  // carbide cutter (dark grey, helical flutes) / polished steel shank
  vec3 alb = cutter ? lin(vec3(0.42, 0.43, 0.46)) : lin(vec3(0.72, 0.73, 0.76));
  if (cutter) {
    float ang = atan(q.y, q.x);
    float helix = uToolG.w > 0.5 && uToolG.w < 1.5 ? 0.0 : 1.4 / max(uToolG.x, 0.2);
    float band = 0.5 + 0.5 * cos(flutes * (ang + q.z * helix) - uToolL.y * flutes);
    alb *= 0.55 + 0.6 * smoothstep(0.15, 0.6, band);
  }
  float diff = max(dot(n, uLight), 0.0);
  vec3 col = alb * (0.10 + 0.45 * diff) + alb * envLight(reflect(rd, n), 0.35) * 0.8
           + sunSpec(n, V, uLight, vec3(0.55), cutter ? 0.35 : 0.15) * 0.6;
  // cutting: warm glow on the tip where it meets the material
  if (uToolL.w > 0.5) col += lin(vec3(1.0, 0.55, 0.2)) * exp(-max(q.z, 0.0) * 6.0) * 0.6;
  return col;
}

// ───────────────────────── materials

float shadowAt(vec2 w, float h) {
  if (h > -1e-4) return 1.0;
  vec2 dl = normalize(uLight.xy);
  float tanE = uLight.z / max(length(uLight.xy), 1e-3);
  float maxD = min((-h) / tanE, 6.0);
  float s = 1.0;
  // per-pixel jitter turns the banding of a short march into fine, invisible noise
  float jit = hash(gl_FragCoord.xy) - 0.5;
  for (int k = 1; k <= 14; k++) {
    float t = (float(k) + jit) / 14.0;
    float d = maxD * t * t + 0.004;
    float hs = hfield(w + dl * d);
    float ray = h + d * tanE;
    s = min(s, clamp(0.5 + (ray - hs) / (0.008 + 0.15 * d), 0.0, 1.0));
  }
  return s;
}

float occlusion(vec2 w, float h) {
  float occ = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785398 + 0.3;
    vec2 dir = vec2(cos(a), sin(a));
    float h1 = hfield(w + dir * 0.06);
    float h2 = hfield(w + dir * 0.22);
    occ += clamp((h1 - h) / 0.06, 0.0, 1.5) * 0.5 + clamp((h2 - h) / 0.22, 0.0, 1.5) * 0.5;
  }
  return clamp(1.0 - occ / 8.0 * 0.55, 0.35, 1.0);
}

// Reflectance (F0) of the copper foil. Very light tarnish here and there.
vec3 copperF0(vec2 w) {
  vec2 sw = w + uSeed * 37.0;
  float tone = fbm(sw * 0.12);
  vec3 c = lin(vec3(0.86, 0.51, 0.36));
  return mix(c, lin(vec3(0.74, 0.42, 0.29)), smoothstep(0.5, 0.85, tone) * 0.35);
}

// Handling and storage marks on the copper (0 = clean): broad oxidation blotches, small dark
// spots, the odd water-mark ring and fingerprints. Stained copper is darker and less shiny.
float copperStains(vec2 w) {
  vec2 sw = w + uSeed * 53.0;
  float blot = smoothstep(0.68, 0.80, fbm(sw * 0.07 + 3.1)) * 0.35;
  float spots = smoothstep(0.80, 0.86, fbm(sw * 0.55 + 11.0)) * 0.3;
  // water marks: thin darker rims of dried drops
  vec2 wc = floor(sw / 9.0);
  float ring = 0.0;
  if (hash(wc + 5.7) > 0.95) {
    vec2 c = (wc + 0.2 + 0.6 * vec2(hash(wc + 1.3), hash(wc + 2.9))) * 9.0;
    float rad = 0.8 + 1.6 * hash(wc + 4.1);
    float d = length(sw - c) + (noise((sw - c) * 1.3) - 0.5) * 0.35;
    ring = (1.0 - smoothstep(0.0, 0.10, abs(d - rad))) * 0.55 + (1.0 - smoothstep(rad - 0.2, rad, d)) * 0.12;
  }
  // fingerprints: an oval of fine curved ridges
  vec2 fc = floor(sw / 24.0);
  float fp = 0.0;
  if (hash(fc + 7.3) > 0.85) {
    vec2 c = (fc + 0.25 + 0.5 * vec2(hash(fc + 1.1), hash(fc + 2.2))) * 24.0;
    float ang = hash(fc + 3.3) * 6.2832;
    vec2 d = sw - c;
    d = vec2(cos(ang) * d.x - sin(ang) * d.y, sin(ang) * d.x + cos(ang) * d.y);
    d.y *= 0.7;
    float r = length(d + vec2(0.0, 0.08 * d.x * d.x));
    float mask = 1.0 - smoothstep(3.2, 5.5, r + (noise(d * 0.8) - 0.5) * 1.2);
    float ridges = 0.5 + 0.5 * sin(r * 13.0 + (noise(d * 2.0) - 0.5) * 4.0);
    fp = mask * (0.12 + smoothstep(0.5, 0.9, ridges) * 0.14);
  }
  return clamp(blot + spots + ring * 0.5 + fp * 0.6, 0.0, 1.0);
}

// FR4 glass-epoxy under the copper: one matte yellow-green everywhere it is exposed (trench
// floors and walls, holes, the board edge), with the glass weave only just visible.
vec3 fr4Albedo(vec2 w) {
  vec2 q = w / 0.42;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float over = mod(cell.x + cell.y, 2.0);
  float fib = over > 0.5 ? noise(vec2(w.x * 2.0, w.y * 140.0)) : noise(vec2(w.x * 140.0, w.y * 2.0));
  float bundle = over > 0.5 ? sin(f.y * 3.14159) : sin(f.x * 3.14159);
  vec3 c = lin(vec3(0.56, 0.63, 0.38));
  c *= 0.97 + 0.02 * bundle + 0.02 * fib;
  return c;
}

void main() {
  vec2 frag = gl_FragCoord.xy / uDpr;
  bool persp = u3D > 0.5;

  vec3 ro = vec3(0.0);
  vec3 rd = vec3(0.0, 0.0, -1.0);
  vec2 w;
  float hz;
  float tField = 1e9;
  float pix;  // mm covered by one css pixel at the surface point
  bool sky = false;
  if (persp) {
    vec2 nd = (frag - uViewport * 0.5) / (uViewport.y * 0.5) * uTanHalf;
    rd = normalize(uCamF + uCamR * nd.x + uCamU * nd.y);
    ro = uEye;
    vec3 hit;
    sky = !marchField(ro, rd, hit);
    w = hit.xy;
    hz = hit.z;
    tField = sky ? 1e9 : length(hit - ro);
    pix = min(tField, 1e4) * 2.0 * uTanHalf / uViewport.y;
  } else {
    pix = 1.0 / uView.z;
    w = uView.xy + (frag - uViewport * 0.5) * pix;
    hz = hsharp(w);
  }
  vec3 V = -rd;
  vec3 L = uLight;
  bool inside = edgeDist(w) >= 0.0;

  // Normal from the sharp surface, differentiated over about one pixel: flat tops stay exactly
  // flat and every edge is a crisp, one-pixel line at any zoom.
  float e = clamp(pix * 0.75, uRes * 0.02, uRes * 2.0);
  float hx = hsharp(w + vec2(e, 0.0)) - hsharp(w - vec2(e, 0.0));
  float hy = hsharp(w + vec2(0.0, e)) - hsharp(w - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));
  float diff = max(dot(n, L), 0.0);

  // Material by height: copper is the top layer, FR4 below it, the floor below the board.
  float fz = clamp(fwidth(hz) * 0.5, 1e-5, 0.004);
  float cu = smoothstep(-0.0015 - fz, -0.0005 + fz, hz);
  float thr = 1.0 - smoothstep(-uThick + 0.001, -uThick + 0.003 + fz, hz);

  float tanE = L.z / max(length(L.xy), 1e-3);
  bool nearBoard = edgeDist(w) > -min(uThick / tanE + 0.5, 8.0);
  float sh = nearBoard ? shadowAt(w, hz) : 1.0;
  float ao = (!nearBoard || hz > -1e-4) ? 1.0 : occlusion(w, hz);
  if (persp && nearBoard) sh *= toolShadow(vec3(w, hz));

  // Copper: polished metal — dark where it reflects the dim room, glowing where it mirrors the
  // sun. In the top view a virtual eye high above the board centre stands in for the camera.
  vec3 Vc = persp ? V : normalize(vec3(uStock * 0.5 - w, length(uStock) * 1.4));
  // fine rolling / brushing marks along X bend the reflection slightly (anisotropic sheen)
  float streak = noise(vec2(w.x * 0.6, w.y * 55.0 + uSeed * 3.0)) - 0.5;
  float streak2 = noise(vec2(w.x * 0.15, w.y * 9.0 + uSeed)) - 0.5;
  vec3 nb = n.z > 0.999 ? normalize(n + vec3(0.0, streak * 0.03 + streak2 * 0.02, 0.0)) : n;
  float NoV = max(dot(nb, Vc), 1e-3);
  float stain = copperStains(w);
  vec3 F0 = mix(copperF0(w), lin(vec3(0.42, 0.25, 0.21)), stain * 0.65);
  vec3 Fv = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
  vec3 copper = sunSpec(nb, Vc, L, F0, 0.11 + 0.2 * stain) * sh * (1.0 - 0.55 * stain)
              + Fv * envLight(reflect(-Vc, nb), 0.25 + 0.5 * stain) * ao * (1.0 - 0.3 * stain)
              + F0 * (0.035 + 0.05 * stain) * diff * sh;

  // FR4 (matte)
  vec3 fa = fr4Albedo(w);
  vec3 fr4 = fa * (0.30 + 0.50 * diff * mix(1.0, sh, 0.6)) * mix(1.0, ao, 0.5) + sunSpec(n, V, L, vec3(0.03), 0.4) * sh;

  vec3 col = mix(fr4, copper, cu);
  col = mix(col, floorColor(w, diff, sh) * ao, thr);

  if (uShowDesign > 0.5 && inside) {
    float dm = texture(uDesign, w / uTexMm).r;
    float dfw = max(fwidth(dm), 1e-4);
    float edge = 1.0 - smoothstep(dfw * 0.6, dfw * 2.2, abs(dm - 0.5));
    float fill = smoothstep(0.5 - dfw, 0.5 + dfw, dm);
    col = mix(col, lin(vec3(0.25, 0.85, 1.0)), fill * 0.22);
    col = mix(col, lin(vec3(0.55, 0.95, 1.0)), edge * 0.85);
  }

  // Cutting glow on the material around the tool tip.
  if (uTool.w > 0.5 && uToolL.w > 0.5) {
    float dr = length(w - uTool.xy) / max(uToolG.x, 0.05);
    col += lin(vec3(1.0, 0.6, 0.25)) * exp(-dr * dr * 1.5) * 0.18;
  }

  if (persp) {
    // the floor fades into the dark studio
    float diag = length(uStock);
    float far = length(w - uStock * 0.5);
    col = mix(col, backdrop(rd), smoothstep(diag * 1.0, diag * 3.0, far));
    if (sky) col = backdrop(rd);
    float tTool;
    if (uTool.w > 0.5 && marchTool(ro, rd, min(tField, 1e5), tTool)) col = shadeTool(ro + rd * tTool, rd);
  }

  // filmic (ACES fit) tone curve: bright reflections roll off instead of clipping; then gamma
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  outColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`

/** Unit vector towards a sun at `azimuth` (deg, counter-clockwise from +X) and `elevation` (deg). */
export function sunDirection(azimuth: number, elevation: number): [number, number, number] {
  const az = (azimuth * Math.PI) / 180
  const el = (Math.min(88, Math.max(3, elevation)) * Math.PI) / 180
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
}

interface FaceTextures {
  top: WebGLTexture
  design: WebGLTexture
  mat: WebGLTexture
  nx: number
  ny: number
  res: number
  width: number
  height: number
  thickness: number
  copperThickness: number
  hasDesign: boolean
}

/**
 * Material codes (0 copper / 1 FR4 / 2 through) → RG8 masks: r = copper, g = through. Filtered
 * linearly in the shader and thresholded at ½, the masks give smooth sub-cell material edges.
 * Without `mat` the masks are derived from the heights.
 */
function matToRG(
  mat: Uint8Array | undefined,
  top: Float32Array,
  f: { copperThickness: number; thickness: number }
): Uint8Array {
  const n = top.length
  const out = new Uint8Array(n * 2)
  if (mat && mat.length === n) {
    for (let i = 0; i < n; i++) {
      const m = mat[i]
      out[i * 2] = m === 0 ? 255 : 0
      out[i * 2 + 1] = m === 2 ? 255 : 0
    }
  } else {
    const cu = -f.copperThickness + 1e-6
    const th = -f.thickness + 1e-6
    for (let i = 0; i < n; i++) {
      const z = top[i]
      out[i * 2] = z >= cu ? 255 : 0
      out[i * 2 + 1] = z <= th ? 255 : 0
    }
  }
  return out
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('Could not create a WebGL shader')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
  return s
}

const UNIFORMS = [
  'uTop',
  'uDesign',
  'uMat',
  'uViewport',
  'uView',
  'uDpr',
  'uTexMm',
  'uRes',
  'uStock',
  'uCopper',
  'uThick',
  'uShowDesign',
  'uSeed',
  'uLight',
  'u3D',
  'uEye',
  'uCamF',
  'uCamR',
  'uCamU',
  'uTanHalf',
  'uTool',
  'uToolG',
  'uToolL'
] as const

export class SimGL {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private faces: Partial<Record<SimFace, FaceTextures>> = {}
  private loc = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
  private buf: WebGLBuffer | null
  private vao: WebGLVertexArrayObject | null
  readonly maxTextureSize: number
  /** Kept for backwards compatibility with the first prototype. */
  showDesign = false

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false })
    if (!gl) throw new Error('WebGL2 is not available on this computer')
    canvas.addEventListener('webglcontextlost', () => console.error('Simulation: WebGL context lost'))
    this.gl = gl
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    const p = gl.createProgram()
    if (!p) throw new Error('Could not create a WebGL program')
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS))
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error')
    this.prog = p
    this.buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    const aPos = gl.getAttribLocation(p, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    for (const u of UNIFORMS) this.loc[u] = gl.getUniformLocation(p, u)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()
    if (!t) throw new Error('Could not create a WebGL texture')
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  hasFace(side: SimFace): boolean {
    return !!this.faces[side]
  }

  /** Full upload of one face (call when the field is created or its size changes). */
  setField(side: SimFace, f: SimField): void {
    const gl = this.gl
    let face = this.faces[side]
    if (!face) {
      face = {
        top: this.makeTex(),
        design: this.makeTex(),
        mat: this.makeTex(),
        nx: 0,
        ny: 0,
        res: f.res,
        width: f.width,
        height: f.height,
        thickness: f.thickness,
        copperThickness: f.copperThickness,
        hasDesign: false
      }
      this.faces[side] = face
    }
    Object.assign(face, {
      nx: f.nx,
      ny: f.ny,
      res: f.res,
      width: f.width,
      height: f.height,
      thickness: f.thickness,
      copperThickness: f.copperThickness
    })
    gl.bindTexture(gl.TEXTURE_2D, face.top)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, f.nx, f.ny, 0, gl.RED, gl.FLOAT, f.top)
    gl.bindTexture(gl.TEXTURE_2D, face.mat)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, f.nx, f.ny, 0, gl.RG, gl.UNSIGNED_BYTE, matToRG(f.mat, f.top, f))
    const n = f.nx * f.ny
    const d = new Uint8Array(n)
    if (f.design && f.design.length === n) for (let i = 0; i < n; i++) d[i] = f.design[i] ? 255 : 0
    face.hasDesign = !!f.design
    gl.bindTexture(gl.TEXTURE_2D, face.design)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, f.nx, f.ny, 0, gl.RED, gl.UNSIGNED_BYTE, d)
  }

  /** Uploads a rectangular region of heights (row-major (x1-x0)×(y1-y0), cells x0..x1-1, y0..y1-1). */
  updateRect(
    side: SimFace,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    top: Float32Array,
    mat?: Uint8Array
  ): void {
    const face = this.faces[side]
    if (!face) return
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0 || x0 < 0 || y0 < 0 || x1 > face.nx || y1 > face.ny) return
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, face.top)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RED, gl.FLOAT, top)
    gl.bindTexture(gl.TEXTURE_2D, face.mat)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RG, gl.UNSIGNED_BYTE, matToRG(mat, top, face))
  }

  /** Partial upload of full rows y0..y1 (inclusive) taken from a full-size height array. */
  updateRows(side: SimFace, top: Float32Array, y0: number, y1: number, mat?: Uint8Array): void {
    const face = this.faces[side]
    if (!face) return
    y0 = Math.max(0, y0)
    y1 = Math.min(face.ny - 1, y1)
    if (y1 < y0) return
    this.updateRect(
      side,
      0,
      y0,
      face.nx,
      y1 + 1,
      top.subarray(y0 * face.nx, (y1 + 1) * face.nx),
      mat?.subarray(y0 * face.nx, (y1 + 1) * face.nx)
    )
  }

  /** Stock size of the face that would be drawn (for camera fitting). */
  faceInfo(side: SimFace): { width: number; height: number; thickness: number } | null {
    const f = this.faces[side] ?? this.faces.top
    return f ? { width: f.width, height: f.height, thickness: f.thickness } : null
  }

  draw(view: SimViewTransform, cssW: number, cssH: number, dpr: number, opts: SimDrawOptions): void {
    const gl = this.gl
    const W = Math.max(1, Math.floor(cssW * dpr))
    const H = Math.max(1, Math.floor(cssH * dpr))
    if (this.canvas.width !== W) this.canvas.width = W
    if (this.canvas.height !== H) this.canvas.height = H
    gl.viewport(0, 0, W, H)
    gl.clearColor(0.03, 0.03, 0.033, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const f = this.faces[opts.side] ?? this.faces.top
    if (!f) return
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, f.top)
    gl.uniform1i(this.loc.uTop, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, f.design)
    gl.uniform1i(this.loc.uDesign, 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, f.mat)
    gl.uniform1i(this.loc.uMat, 2)
    gl.uniform2f(this.loc.uViewport, cssW, cssH)
    gl.uniform3f(this.loc.uView, view.cx, view.cy, view.zoom)
    gl.uniform1f(this.loc.uDpr, dpr)
    gl.uniform2f(this.loc.uTexMm, f.nx * f.res, f.ny * f.res)
    gl.uniform1f(this.loc.uRes, f.res)
    gl.uniform2f(this.loc.uStock, f.width, f.height)
    gl.uniform1f(this.loc.uCopper, f.copperThickness)
    gl.uniform1f(this.loc.uThick, f.thickness)
    gl.uniform1f(this.loc.uShowDesign, (opts.showDesign || this.showDesign) && f.hasDesign ? 1 : 0)
    gl.uniform1f(this.loc.uSeed, opts.side === 'bottom' ? 1 : 0)
    gl.uniform3f(this.loc.uLight, ...(opts.light ?? sunDirection(130, 50)))

    const cam = opts.camera
    gl.uniform1f(this.loc.u3D, cam ? 1 : 0)
    if (cam) {
      gl.uniform3f(this.loc.uEye, ...cam.eye)
      gl.uniform3f(this.loc.uCamF, ...cam.f)
      gl.uniform3f(this.loc.uCamR, ...cam.r)
      gl.uniform3f(this.loc.uCamU, ...cam.u)
      gl.uniform1f(this.loc.uTanHalf, cam.tanHalf)
    }
    const t = cam ? opts.tool : null
    if (t) {
      gl.uniform4f(this.loc.uTool, t.x, t.y, t.z, 1)
      gl.uniform4f(
        this.loc.uToolG,
        t.radius,
        t.tipRadius,
        t.slope,
        t.shape === 'ball' ? 2 : t.shape === 'cone' ? 1 : 0
      )
      gl.uniform4f(this.loc.uToolL, t.fluteLength, t.spin, t.flutes, t.cutting ? 1 : 0)
    } else {
      gl.uniform4f(this.loc.uTool, 0, 0, 0, 0)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** Drops the textures of all faces (e.g. before loading a new program). */
  clearFaces(): void {
    const gl = this.gl
    for (const f of Object.values(this.faces)) {
      if (!f) continue
      gl.deleteTexture(f.top)
      gl.deleteTexture(f.design)
      gl.deleteTexture(f.mat)
    }
    this.faces = {}
  }

  dispose(): void {
    const gl = this.gl
    this.clearFaces()
    gl.deleteBuffer(this.buf)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.prog)
  }
}
