import * as THREE from 'three';
import { smoothstep } from './rng.js';

export const WORLD = 640;
export const RES = 256;
const HALF = WORLD / 2;

// Height field whose shape is the noise plus a "memory" of everything that
// walked on it. The GPU reads it from one float texture (R = height, G = wear),
// so the ground can be re-carved without touching any geometry.
export class Terrain {
  constructor(noise) {
    this.cell = WORLD / (RES - 1);
    const N = RES * RES;
    this.base = new Float32Array(N);
    this.wear = new Float32Array(N);
    this.h = new Float32Array(N);
    this.data = new Float32Array(N * 2);
    this.acc = 0;

    for (let iz = 0; iz < RES; iz++) {
      for (let ix = 0; ix < RES; ix++) {
        const x = -HALF + ix * this.cell;
        const z = -HALF + iz * this.cell;
        let hgt = noise.fbm(x * 0.0055, z * 0.0055, 5) * 30;
        let ridge = 1 - Math.abs(noise.noise(x * 0.011 + 50, z * 0.011 - 30));
        hgt += ridge * ridge * ridge * 16;
        const mesa = noise.noise(x * 0.0042 - 90, z * 0.0042 + 12);
        hgt += smoothstep(0.18, 0.3, mesa) * 20;
        const basin = noise.noise(x * 0.003 + 300, z * 0.003 - 200);
        hgt -= smoothstep(0.2, 0.45, basin) * 18;
        const e = Math.max(Math.abs(x), Math.abs(z)) / HALF;
        hgt += smoothstep(0.8, 1.0, e) * 80;
        this.base[iz * RES + ix] = hgt;
      }
    }
    this._rebuild();

    this.tex = new THREE.DataTexture(this.data, RES, RES, THREE.RGFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(WORLD, WORLD, RES - 1, RES - 1);
    geo.rotateX(-Math.PI / 2);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), WORLD);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.tex },
        uCell: { value: this.cell },
        uRes: { value: RES },
        uWorld: { value: WORLD },
        uSky: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uFogDen: { value: 0.004 },
        uLight: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
        uTime: { value: 0 },
        uGlow: { value: new THREE.Color(0.2, 0.9, 0.8) },
        uCam: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uCell; uniform float uRes; uniform float uWorld;
        varying vec3 vPos; varying vec3 vNrm; varying float vWear;
        float hAt(ivec2 c){ c = clamp(c, ivec2(0), ivec2(int(uRes) - 1)); return texelFetch(uTex, c, 0).r; }
        void main(){
          vec2 g = (position.xz + uWorld * 0.5) / uCell;
          ivec2 c = ivec2(floor(g + 0.5));
          vec2 s = texelFetch(uTex, c, 0).rg;
          vWear = s.g;
          float hL = hAt(c - ivec2(1,0)), hR = hAt(c + ivec2(1,0));
          float hD = hAt(c - ivec2(0,1)), hU = hAt(c + ivec2(0,1));
          vNrm = normalize(vec3(hL - hR, 2.0 * uCell, hD - hU));
          vec3 p = vec3(position.x, s.r, position.z);
          vPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSky; uniform vec3 uFog; uniform float uFogDen; uniform vec3 uLight;
        uniform float uTime; uniform vec3 uGlow; uniform vec3 uCam;
        varying vec3 vPos; varying vec3 vNrm; varying float vWear;
        vec3 hue(float t){ return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + 1.0), u.x), u.y); }
        void main(){
          vec3 n = normalize(vNrm);
          float h = vPos.y;
          float slope = 1.0 - n.y;
          float dist = length(vPos - uCam);
          vec3 low = vec3(0.012, 0.004, 0.03), mid = vec3(0.012, 0.03, 0.045), high = vec3(0.22, 0.18, 0.32);
          vec3 col = mix(low, mid, smoothstep(-15.0, 6.0, h));
          col = mix(col, high, smoothstep(24.0, 50.0, h));
          // alien lichen patches
          float pn = vn(vPos.xz * 0.045) * 0.65 + vn(vPos.xz * 0.17) * 0.35;
          vec3 lichen = hue(pn * 0.7 + 0.45 + vn(vPos.xz * 0.01) * 0.5) * 0.045;
          col = mix(col, lichen, 0.75 * smoothstep(0.56, 0.68, pn) * (1.0 - smoothstep(0.3, 0.6, slope)));
          col = mix(col, vec3(0.06, 0.012, 0.04), smoothstep(0.3, 0.7, slope));
          // glowing specks near the viewer
          float sk = vn(vPos.xz * 1.7);
          col += hue(pn + 0.2) * smoothstep(0.9, 0.97, sk) * 0.5 * (1.0 - smoothstep(15.0, 70.0, dist));
          // contour lines
          float cl = abs(fract(h * 0.25) - 0.5);
          col += hue(h * 0.012 + uTime * 0.003) * 0.05 * smoothstep(0.46, 0.5, cl) * (1.0 - smoothstep(40.0, 220.0, dist));
          float diff = max(dot(n, uLight), 0.0);
          vec3 lit = col * (2.0 * uSky + 0.35 + 1.3 * diff);
          float w = smoothstep(0.02, 0.5, vWear);
          lit += uGlow * w * (0.35 + 0.2 * sin(uTime * 2.0 + vPos.x * 0.2 + vPos.z * 0.2));
          float f = 1.0 - exp(-pow(dist * uFogDen, 2.0));
          gl_FragColor = vec4(mix(lit, uFog, f), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  _rebuild() {
    const { base, wear, h, data } = this;
    for (let i = 0, n = h.length; i < n; i++) {
      const v = base[i] - wear[i] * 2.5;
      h[i] = v;
      data[i * 2] = v;
      data[i * 2 + 1] = wear[i];
    }
  }

  heightAt(x, z) {
    let gx = (x + HALF) / this.cell;
    let gz = (z + HALF) / this.cell;
    if (gx < 0) gx = 0; else if (gx > RES - 1.001) gx = RES - 1.001;
    if (gz < 0) gz = 0; else if (gz > RES - 1.001) gz = RES - 1.001;
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * RES + ix;
    const h = this.h;
    const a = h[i] + (h[i + 1] - h[i]) * fx;
    const b = h[i + RES] + (h[i + RES + 1] - h[i + RES]) * fx;
    return a + (b - a) * fz;
  }

  _index(x, z) {
    const ix = Math.round((x + HALF) / this.cell);
    const iz = Math.round((z + HALF) / this.cell);
    if (ix < 0 || iz < 0 || ix >= RES || iz >= RES) return -1;
    return iz * RES + ix;
  }

  wearAt(x, z) {
    const i = this._index(x, z);
    return i < 0 ? 0 : this.wear[i];
  }

  deposit(x, z, a) {
    const i = this._index(x, z);
    if (i < 0) return;
    const w = this.wear[i] + a;
    this.wear[i] = w > 1 ? 1 : w;
  }

  // dt = simulated seconds. The ground slowly forgets.
  update(dt) {
    this.acc += dt;
    if (this.acc < 0.3) return;
    const k = Math.pow(0.988, this.acc);
    this.acc = 0;
    const wear = this.wear;
    for (let i = 0, n = wear.length; i < n; i++) wear[i] *= k;
    this._rebuild();
    this.tex.needsUpdate = true;
  }
}
