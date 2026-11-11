import * as THREE from 'three';
import { TAU, smoothstep } from './rng.js';
import { WORLD } from './terrain.js';

const MAXC = 48;
const TG = 80; // time grid resolution
const TCELL = WORLD / TG;
export const CRYSTAL_R = 26;

export function glowMaterial(base, glow = 0.45) {
  const m = new THREE.MeshLambertMaterial(base);
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ${glow.toFixed(3)};`
    );
  };
  return m;
}

// Crystals bend time around themselves. New ones are born from large herds.
export class Crystals {
  constructor(world) {
    this.w = world;
    this.list = [];
    this.tf = new Float32Array(TG * TG).fill(1);
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), glowMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }, 0.9), MAXC);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const ringGeo = new THREE.RingGeometry(CRYSTAL_R - 1.2, CRYSTAL_R, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), MAXC);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    this.mesh.setColorAt(0, this._c.set(1, 1, 1));
    this.rings.setColorAt(0, this._c);
  }

  get full() {
    return this.list.length >= MAXC;
  }

  add(x, z, th) {
    if (this.full) return null;
    const c = { x, z, th, y: this.w.terrain.heightAt(x, z), born: this.w.time, acc: 0 };
    this.list.push(c);
    const k = this.w.C.timeFactor;
    const r = CRYSTAL_R;
    const g0x = Math.floor((x - r + WORLD / 2) / TCELL), g1x = Math.ceil((x + r + WORLD / 2) / TCELL);
    const g0z = Math.floor((z - r + WORLD / 2) / TCELL), g1z = Math.ceil((z + r + WORLD / 2) / TCELL);
    for (let gz = Math.max(0, g0z); gz <= Math.min(TG - 1, g1z); gz++) {
      for (let gx = Math.max(0, g0x); gx <= Math.min(TG - 1, g1x); gx++) {
        const cx = -WORLD / 2 + (gx + 0.5) * TCELL, cz = -WORLD / 2 + (gz + 0.5) * TCELL;
        const d = Math.hypot(cx - x, cz - z);
        const infl = 1 - smoothstep(r * 0.45, r, d);
        if (infl <= 0) continue;
        const v = 1 + (k - 1) * infl;
        const i = gz * TG + gx;
        this.tf[i] = k < 1 ? Math.min(this.tf[i], v) : Math.max(this.tf[i], v);
      }
    }
    return c;
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const c of this.list) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { c: best, d: Math.sqrt(bd) } : null;
  }

  timeAt(x, z) {
    let gx = ((x + WORLD / 2) / TCELL) | 0;
    let gz = ((z + WORLD / 2) / TCELL) | 0;
    if (gx < 0) gx = 0; else if (gx >= TG) gx = TG - 1;
    if (gz < 0) gz = 0; else if (gz >= TG) gz = TG - 1;
    return this.tf[gz * TG + gx];
  }

  step(dt) {
    const motes = this.w.motes;
    for (const c of this.list) {
      c.acc += dt * 0.7;
      while (c.acc > 1) {
        c.acc -= 1;
        const a = Math.random() * TAU;
        motes.spawn(c.x + Math.cos(a) * 3, c.y + 6, c.z + Math.sin(a) * 3, c.th, 2);
      }
    }
  }

  render(time) {
    const { _m, _q, _p, _s, _c, _up } = this;
    let n = 0;
    for (const c of this.list) {
      const age = time - c.born;
      const grow = Math.min(1, age / 4);
      _q.setFromAxisAngle(_up, time * 0.3 + c.x);
      _p.set(c.x, c.y + 8 + Math.sin(time * 0.8 + c.z) * 1.2, c.z);
      _s.set(3.2 * grow, 8 * grow, 3.2 * grow);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      _c.setHSL(c.th / TAU, 0.7, 0.62);
      this.mesh.setColorAt(n, _c);
      _q.identity();
      _p.set(c.x, c.y + 0.6, c.z);
      _s.set(grow, 1, grow);
      _m.compose(_p, _q, _s);
      this.rings.setMatrixAt(n, _m);
      this.rings.setColorAt(n, _c);
      n++;
    }
    this.mesh.count = n;
    this.rings.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      this.rings.instanceMatrix.needsUpdate = true;
      this.rings.instanceColor.needsUpdate = true;
    }
  }
}
