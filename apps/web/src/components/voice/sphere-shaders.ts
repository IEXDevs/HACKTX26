// GLSL for the voice sphere. Kept apart from the component so it can be checked on its own.

// 3D simplex noise by Ashima Arts and Stefan Gustavson (MIT license).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

// The surface: two layers of noise, twisted around the vertical axis when thinking.
const SURFACE = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSwirl;
uniform float uBreath;
${NOISE}
float field(vec3 n) {
  float a = uSwirl * (uTime * 0.8 + n.y * 2.2);
  float c = cos(a);
  float s = sin(a);
  vec3 q = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
  float n1 = snoise(q * 1.5 + vec3(0.0, uTime * 0.5, uTime * 0.25));
  float n2 = snoise(q * 3.2 + vec3(uTime * 0.7, -uTime * 0.4, 0.0));
  return n1 * 0.65 + n2 * 0.35;
}
float radius(vec3 n, out float f) {
  f = field(n);
  float band = uSwirl * 0.03 * sin(n.y * 7.0 - uTime * 2.0 + atan(n.z, n.x + 1e-5) * 2.0);
  return 1.0 + uBreath + uAmp * 0.08 + f * (0.035 + uAmp * 0.18) + band;
}
`;

export const BODY_VERT = /* glsl */ `
${SURFACE}
varying vec3 vNormal;
varying vec3 vView;
varying float vField;
void main() {
  vec3 n = normalize(position);
  float f;
  vec3 p = n * radius(n, f);
  vec3 t1 = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec3 n1 = normalize(n + t1 * 0.02);
  vec3 n2 = normalize(n + t2 * 0.02);
  float g;
  vec3 p1 = n1 * radius(n1, g);
  vec3 p2 = n2 * radius(n2, g);
  vec3 dn = normalize(cross(p1 - p, p2 - p));
  if (dot(dn, n) < 0.0) dn = -dn;
  vField = f;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  vNormal = normalize(normalMatrix * dn);
  gl_Position = projectionMatrix * mv;
}
`;

export const BODY_FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uLight;
uniform float uDim;
uniform float uRim;
uniform float uAmp;
varying vec3 vNormal;
varying vec3 vView;
varying float vField;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);
  vec3 L = normalize(vec3(-0.45, 0.65, 0.65));
  float diff = clamp(dot(N, L), 0.0, 1.0);
  float spec = pow(clamp(dot(N, normalize(L + V)), 0.0, 1.0), 48.0);
  vec3 base = mix(uDeep, uMid, smoothstep(-0.6, 0.7, vField) * (0.55 + 0.45 * diff));
  vec3 col = base * (0.35 + 0.8 * diff);
  col += uLight * fres * (0.45 + 0.9 * uRim + 0.6 * uAmp);
  col += vec3(spec * 0.55);
  gl_FragColor = vec4(col * uDim, 1.0);
  #include <colorspace_fragment>
}
`;

export const DOTS_VERT = /* glsl */ `
${SURFACE}
uniform float uPx;
uniform float uDots;
varying float vAlpha;
void main() {
  vec3 n = normalize(position);
  float f;
  vec3 p = n * radius(n, f) * (1.1 + uAmp * 0.08);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPx * (1.6 + uAmp * 2.2 + max(f, 0.0) * 1.4);
  vAlpha = uDots * (0.25 + 0.75 * smoothstep(-0.2, 0.8, f));
  gl_Position = projectionMatrix * mv;
}
`;

export const DOTS_FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uDim;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  gl_FragColor = vec4(uLight * uDim, a);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`;
