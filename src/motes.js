import * as THREE from 'three';
import { TAU, wrapPhase } from './rng.js';
import { Grid } from './grid.js';
import { WORLD } from './terrain.js';

export const MAXM = 5000;
const LIM = WORLD / 2 - 30;

// Light motes: the food of this world. Their weight follows the phase law,
// so they rain down and float up as the sky turns.
export class Motes {
  constructor(world, rng) {
    this.w = world;
    this.X = new Float32Array(MAXM);
    this.Y = new Float32Array(MAXM);
    this.Z = new Float32Array(MAXM);
    this.VX = new Float32Array(MAXM);
    this.VY = new Float32Array(MAXM);
    this.VZ = new Float32Array(MAXM);
    this.TH = new Float32Array(MAXM);
    this.OM = new Float32Array(MAXM);
    this.GY = new Float32Array(MAXM);
    this.alive = new Uint8Array(MAXM);
    this.free = [];
    for (let i = MAXM - 1; i >= 0; i--) this.free.push(i);
    this.hi = 0;
    this.count = 0;
    this.grid = new Grid(WORLD, 16, MAXM);
    this.rng = rng;

    this.vents = [];
    for (let i = 0; i < 11; i++) {
      this.vents.push({ x: (rng() - 0.5) * WORLD * 0.75, z: (rng() - 0.5) * WORLD * 0.75, th: rng() * TAU, rate: 2.6 + rng() * 2.4, acc: 0 });
    }

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXM * 3).fill(-1e5);
    this.col = new Float32Array(MAXM * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), WORLD);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 }, uFogDen: { value: 0.004 } },
      vertexShader: /* glsl */ `
        attribute vec3 aCol; uniform float uScale; uniform float uFogDen;
        varying vec3 vCol;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          gl_PointSize = clamp(uScale / d, 1.5, 48.0);
          gl_Position = projectionMatrix * mv;
          vCol = aCol * exp(-pow(d * uFogDen, 2.0));
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(p));
          a *= a;
          gl_FragColor = vec4(vCol * a * 1.8, 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.geo = geo;
    this._c = new THREE.Color();
    this.frame = 0;
  }

  spawn(x, y, z, th, vy = 0) {
    if (this.free.length === 0) return -1;
    const i = this.free.pop();
    this.X[i] = x; this.Y[i] = y; this.Z[i] = z;
    this.VX[i] = (this.rng() - 0.5) * 2; this.VZ[i] = (this.rng() - 0.5) * 2; this.VY[i] = vy;
    this.TH[i] = th;
    this.OM[i] = (this.rng() - 0.5) * 0.25;
    this.GY[i] = this.w.terrain.heightAt(x, z);
    this.alive[i] = 1;
    if (i >= this.hi) this.hi = i + 1;
    this.count++;
    return i;
  }

  kill(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
    this.pos[i * 3 + 1] = -1e5;
  }

  releaseAt(x, y, z, n, th) {
    for (let k = 0; k < n; k++) {
      const i = this.spawn(x + (this.rng() - 0.5) * 2, y + 0.5, z + (this.rng() - 0.5) * 2, wrapPhase(th + (this.rng() - 0.5) * 1.5), 3 + this.rng() * 4);
      if (i >= 0) { this.VX[i] *= 3; this.VZ[i] *= 3; }
    }
  }

  step(dt, time) {
    const w = this.w;
    const C = w.C;
    const rng = this.rng;
    // vents breathe new light into the world
    for (const v of this.vents) {
      v.acc += dt * v.rate;
      while (v.acc > 1) {
        v.acc -= 1;
        if (this.count < MAXM - 400) {
          const a = rng() * TAU, r = rng() * 6;
          this.spawn(v.x + Math.cos(a) * r, w.terrain.heightAt(v.x, v.z) + 0.5, v.z + Math.sin(a) * r, wrapPhase(v.th + (rng() - 0.5) * 2.2), 4 + rng() * 6);
        }
      }
    }
    // a thin rain of light everywhere
    this.rainAcc = (this.rainAcc || 0) + dt * 14;
    while (this.rainAcc > 1) {
      this.rainAcc -= 1;
      if (this.count < MAXM - 600) {
        const x = (rng() - 0.5) * LIM * 2, z = (rng() - 0.5) * LIM * 2;
        this.spawn(x, w.terrain.heightAt(x, z) + 25 + rng() * 40, z, rng() * TAU);
      }
    }
    const { X, Y, Z, VX, VY, VZ, TH, OM, GY, alive } = this;
    const sky = w.skyPhase;
    const G = C.G * 0.45 * C.gravSign;
    const mon = w.monoliths;
    const crystals = w.crystals;
    const terrain = w.terrain;
    const heavy = this.frame & 1; // ground height refresh every other step
    for (let i = 0, hi = this.hi; i < hi; i++) {
      if (!alive[i]) continue;
      const h = dt * crystals.timeAt(X[i], Z[i]);
      let th = TH[i] + OM[i] * h;
      if (th > TAU) th -= TAU; else if (th < 0) th += TAU;
      TH[i] = th;
      let vy = VY[i] + (-G * Math.cos(th - sky) - 0.12 * C.G) * h;
      vy *= 1 - 0.7 * h;
      let vx = VX[i], vz = VZ[i];
      const x = X[i], z = Z[i];
      for (let m = 0; m < mon.length; m++) {
        const M = mon[m];
        const dx = M.x - x, dz = M.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 3600 || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const f = (C.attrSign * Math.cos(M.th - th) * 7) / (1 + d / 10) / d;
        vx += dx * f * h;
        vz += dz * f * h;
      }
      vx += Math.sin(z * 0.013 + time * 0.07) * 0.6 * h;
      vz += Math.cos(x * 0.011 - time * 0.05) * 0.6 * h;
      const damp = 1 - 0.9 * h;
      vx *= damp; vz *= damp;
      let nx = x + vx * h, nz = z + vz * h, ny = Y[i] + vy * h;
      if (nx > LIM) { nx = LIM; vx = -Math.abs(vx); } else if (nx < -LIM) { nx = -LIM; vx = Math.abs(vx); }
      if (nz > LIM) { nz = LIM; vz = -Math.abs(vz); } else if (nz < -LIM) { nz = -LIM; vz = Math.abs(vz); }
      if (heavy || (i & 7) === 0) GY[i] = terrain.heightAt(nx, nz);
      const gy = GY[i];
      if (ny < gy + 0.35) { ny = gy + 0.35; if (vy < 0) vy = 0; }
      else if (ny > gy + 75) { ny = gy + 75; if (vy > 0) vy = 0; }
      X[i] = nx; Y[i] = ny; Z[i] = nz; VX[i] = vx; VY[i] = vy; VZ[i] = vz;
    }
    this.frame++;
    // ground motes are edible
    this.grid.build(this.hi, X, Z, (i) => alive[i] && Y[i] < GY[i] + 3.2);
  }

  nearestGround(x, z, r) {
    const g = this.grid;
    const n = g.n;
    const rc = Math.ceil(r / g.cell);
    const cx = g.cx(x), cz = g.cx(z);
    let best = -1, bd = r * r;
    const { X, Z, alive } = this;
    for (let j = Math.max(0, cz - rc); j <= Math.min(n - 1, cz + rc); j++) {
      for (let i = Math.max(0, cx - rc); i <= Math.min(n - 1, cx + rc); i++) {
        const c = j * n + i;
        for (let k = g.start[c], e = g.start[c + 1]; k < e; k++) {
          const m = g.items[k];
          if (!alive[m]) continue;
          const dx = X[m] - x, dz = Z[m] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = m; }
        }
      }
    }
    return best;
  }

  // Emit the player's phase. Returns how many motes were moved hard.
  pulse(px, py, pz, th, radius) {
    const C = this.w.C;
    const { X, Y, Z, VX, VY, VZ, TH, alive } = this;
    let moved = 0;
    const r2 = radius * radius;
    for (let i = 0; i < this.hi; i++) {
      if (!alive[i]) continue;
      const dx = px - X[i], dy = py - Y[i], dz = pz - Z[i];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2 || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      const s = (C.attrSign * Math.cos(TH[i] - th) * 26) / (1 + d / 12);
      VX[i] += (dx / d) * s; VY[i] += (dy / d) * s; VZ[i] += (dz / d) * s;
      if (Math.abs(s) > 4) moved++;
    }
    return moved;
  }

  render() {
    const { X, Y, Z, TH, alive, pos, col } = this;
    const doCol = (this.frame & 3) === 0;
    const c = this._c;
    for (let i = 0, hi = this.hi; i < hi; i++) {
      if (!alive[i]) continue;
      const k = i * 3;
      pos[k] = X[i]; pos[k + 1] = Y[i]; pos[k + 2] = Z[i];
      if (doCol) {
        c.setHSL(TH[i] / TAU, 0.9, 0.6);
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    const p = this.geo.attributes.position;
    p.needsUpdate = true;
    p.clearUpdateRanges();
    p.addUpdateRange(0, this.hi * 3);
    if (doCol) {
      const a = this.geo.attributes.aCol;
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.hi * 3);
    }
    this.geo.setDrawRange(0, this.hi);
  }
}
