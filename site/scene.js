// Friday's core: ~18k glowing particles that morph between shapes as you scroll
// (orb -> voice ring -> memory cards -> time spiral -> orb -> burst) and pulse with her voice.
import * as THREE from "three";

const canvas = document.getElementById("scene");
const F = window.FRIDAY || { amp: 0, stage: 0, x: 0, dim: 1 };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
} catch {
  canvas.remove();
  throw new Error("WebGL unavailable; page works without the scene");
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 9);

const N = innerWidth < 700 ? 9000 : 18000;
const rnd = new Float32Array(N);
const shapes = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(N * 3));
const rand = (a, b) => a + Math.random() * (b - a);

for (let i = 0; i < N; i++) {
  rnd[i] = Math.random();
  const k = i * 3;
  // 0: the core orb (fibonacci sphere with a dense shell and a faint inner cloud)
  const shell = i % 7 !== 0;
  const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963;
  const R = shell ? 2 : rand(0.2, 1.7);
  shapes[0].set([Math.cos(th) * rr * R, y * R, Math.sin(th) * rr * R], k);
  // 1: voice, a tilted ring of standing waves
  const a = (i / N) * Math.PI * 2 * 3, band = rand(-0.12, 0.12);
  const wave = Math.sin(a * 6) * 0.35 * Math.sin(a * 1.5);
  const r1 = 2.4 + band + wave * (i % 3 === 0 ? 1 : 0.4);
  shapes[1].set([Math.cos(a) * r1, Math.sin(a * 6) * 0.25 + rand(-0.05, 0.05), Math.sin(a) * r1], k);
  // 2: memory, a curved wall of floating note cards (outline + three lines of "text"), facing you
  const card = i % 20, col = card % 5, row = Math.floor(card / 5);
  const W = 0.62, H = 0.42, roll = Math.random();
  let cu, cv;
  if (roll < 0.6) { // outline
    const e = Math.random() * 2 * (W + H) * 2;
    if (e < 2 * W) { cu = -W + e; cv = H; } else if (e < 2 * W + 2 * H) { cu = W; cv = H - (e - 2 * W); }
    else if (e < 4 * W + 2 * H) { cu = W - (e - 2 * W - 2 * H); cv = -H; } else { cu = -W; cv = -H + (e - 4 * W - 2 * H); }
  } else { // text lines
    const line = Math.floor(rand(0, 3));
    cu = rand(-W * 0.8, W * (line === 2 ? 0.2 : 0.75)); cv = H * 0.45 - line * H * 0.42;
  }
  const ang = (col - 2) * 0.36, depth = Math.sin((row * 5 + col) * 12.9898) * 0.6;
  const wx = Math.sin(ang) * 4.2 + cu * Math.cos(ang), wz = Math.cos(ang) * 4.2 - 4.2 - cu * Math.sin(ang) + depth;
  shapes[2].set([wx, (row - 1.5) * 1.15 + cv + Math.sin(col * 1.7) * 0.15, wz], k);
  // 3: time, a spiral galaxy (your week, orbiting)
  const arm = i % 3, d = Math.pow(Math.random(), 0.6) * 3.2, sa = arm * 2.094 + d * 1.6 + rand(-0.25, 0.25) / (d + 0.4);
  shapes[3].set([Math.cos(sa) * d, rand(-0.08, 0.08) * (3.4 - d), Math.sin(sa) * d], k);
  // 4: back to the orb, tighter and brighter, for the demo
  shapes[4].set([shapes[0][k] * 0.85, shapes[0][k + 1] * 0.85, shapes[0][k + 2] * 0.85], k);
  // 5: burst, a wide field for the final call to action
  const bR = rand(3, 9), bt = Math.random() * Math.PI * 2, bp = Math.acos(rand(-1, 1));
  shapes[5].set([Math.sin(bp) * Math.cos(bt) * bR, Math.cos(bp) * bR * 0.6, Math.sin(bp) * Math.sin(bt) * bR - 2], k);
}

const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(shapes[0], 3));
shapes.forEach((s, i) => geo.setAttribute(`s${i}`, new THREE.BufferAttribute(s, 3)));
geo.setAttribute("rnd", new THREE.BufferAttribute(rnd, 1));

const mat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 }, uStage: { value: 0 }, uAmp: { value: 0 }, uDim: { value: 1 },
    uSize: { value: 26 * renderer.getPixelRatio() },
  },
  vertexShader: /* glsl */ `
    attribute vec3 s0; attribute vec3 s1; attribute vec3 s2; attribute vec3 s3; attribute vec3 s4; attribute vec3 s5;
    attribute float rnd;
    uniform float uTime, uStage, uAmp, uSize;
    varying float vR; varying float vGlow;
    float step01(float s, float k) { return smoothstep(0.0, 1.0, clamp((s - k) * 1.35 - rnd * 0.35, 0.0, 1.0)); }
    void main() {
      vec3 p = s0;
      p = mix(p, s1, step01(uStage, 0.0));
      p = mix(p, s2, step01(uStage, 1.0));
      p = mix(p, s3, step01(uStage, 2.0));
      p = mix(p, s4, step01(uStage, 3.0));
      p = mix(p, s5, step01(uStage, 4.0));
      // breathing + voice-driven ripple
      float n = sin(p.x * 2.1 + uTime * 0.9) * sin(p.y * 2.7 - uTime * 0.7) * sin(p.z * 1.9 + uTime * 0.5);
      p += normalize(p + 1e-4) * (n * (0.06 + uAmp * 0.55) + uAmp * 0.25 * sin(rnd * 40.0 + uTime * 9.0));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * (0.35 + rnd * 0.9) * (1.0 + uAmp * 1.2) / -mv.z;
      vR = rnd; vGlow = uAmp;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uDim;
    varying float vR; varying float vGlow;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d);
      vec3 amber = vec3(1.0, 0.71, 0.28), ember = vec3(1.0, 0.42, 0.18), hot = vec3(1.0, 0.95, 0.85);
      vec3 c = mix(amber, ember, smoothstep(0.55, 1.0, vR));
      c = mix(c, hot, smoothstep(0.92, 1.0, vR) + vGlow * 0.35);
      gl_FragColor = vec4(c, a * (0.55 + vGlow * 0.45) * uDim);
    }`,
});
const points = new THREE.Points(geo, mat);
const group = new THREE.Group();
group.add(points);
scene.add(group);

// faint dust in the background for depth
const dustN = 1200, dust = new Float32Array(dustN * 3);
for (let i = 0; i < dustN; i++) dust.set([rand(-14, 14), rand(-9, 9), rand(-12, -2)], i * 3);
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffb547, size: 0.025, transparent: true, opacity: 0.35, depthWrite: false }));
scene.add(dustPts);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < 700 ? 60 : 45;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const mouse = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
addEventListener("pointermove", (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

const s = { stage: 0, x: 0, dim: 1 };
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  s.stage += (F.stage - s.stage) * (F.qa ? 1 : Math.min(1, dt * 4));
  s.x += (F.x - s.x) * Math.min(1, dt * 3);
  s.dim += (F.dim - s.dim) * Math.min(1, dt * 3);
  eased.x += (mouse.x - eased.x) * 0.05; eased.y += (mouse.y - eased.y) * 0.05;

  mat.uniforms.uTime.value = t;
  mat.uniforms.uStage.value = s.stage;
  mat.uniforms.uAmp.value = F.amp;
  mat.uniforms.uDim.value = s.dim;

  const cw = Math.max(0, 1 - Math.abs(s.stage - 2) * 1.6);
  group.position.x = s.x + 0.7 * cw * Math.sign(s.x);
  group.scale.setScalar(1 - 0.32 * cw);
  group.position.y = innerWidth < 900 ? 1.6 * Math.max(0, 1 - s.stage) : 0;
  // the card wall faces you; every other shape slowly turns. Tilt per shape so rings and the spiral read from above.
  const cardW = Math.max(0, 1 - Math.abs(s.stage - 2) * 1.6);
  const spin = (reduce ? 0 : t * 0.08) + s.stage * 0.9;
  group.rotation.y = spin * (1 - cardW) + Math.sin(t * 0.3) * 0.18 * cardW + eased.x * 0.6;
  const tilts = [0.15, 0.95, 0.05, 1.05, 0.15, 0.1];
  const si = Math.min(4, Math.floor(s.stage)), sf = s.stage - si;
  group.rotation.x = tilts[si] + (tilts[si + 1] - tilts[si]) * sf + eased.y * 0.4;
  camera.position.z = 9 - Math.sin(Math.min(s.stage, 4) / 4 * Math.PI) * 1.6;
  dustPts.rotation.y = t * 0.01;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
