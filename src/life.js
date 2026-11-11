import * as THREE from 'three';
import { TAU, gauss, hashInt, wrapPhase } from './rng.js';
import { Grid } from './grid.js';
import { WORLD } from './terrain.js';
import { glowMaterial } from './crystals.js';

export const MAX = 1600;
const LIM = WORLD / 2 - 40;
const NR = 16; // interaction radius between creatures
const PRED = 0.55; // carnivory threshold

// gene: [min, max]
const GENES = {
  size: [0.5, 2.6],
  speed: [1.5, 10],
  sense: [5, 32],
  carn: [0, 1],
  om: [-0.7, 0.7],
  repro: [5, 18],
  coup: [0, 1.6],
  life: [70, 260],
};
const GK = Object.keys(GENES);

const SYL = ['ル', 'ミ', 'ア', 'ソ', 'ヴェ', 'キ', 'オル', 'ナ', 'ザ', 'エ', 'リ', 'ト', 'フ', 'ヨ', 'シャ', 'ウ', 'ネ', 'ラ', 'ク', 'イ', 'ゼ', 'ポ', 'ム', 'ティ', 'ヘ', 'ロ'];

export function speciesKey(size, speed, carn, om) {
  const c = carn > PRED ? 1 : 0;
  const s = Math.min(3, Math.floor((size - 0.5) / 0.55));
  const v = Math.min(2, Math.floor((speed - 1.5) / 3));
  const o = om > 0.18 ? 2 : om < -0.18 ? 0 : 1;
  return c * 1000 + s * 100 + v * 10 + o;
}

export function speciesInfo(key, seed) {
  let h = hashInt(key * 7919 + seed);
  const n = 2 + (h % 2);
  let name = '';
  for (let k = 0; k < n; k++) {
    h = hashInt(h + k + 1);
    name += SYL[h % SYL.length];
  }
  const carn = Math.floor(key / 1000);
  const s = Math.floor(key / 100) % 10;
  const v = Math.floor(key / 10) % 10;
  const o = key % 10;
  const traits = [
    carn ? '捕食' : '光食',
    ['微小', '小型', '中型', '大型'][s],
    ['緩慢', '並速', '俊敏'][v],
    ['逆旋', '静位', '順旋'][o],
  ];
  return { name: name + (carn ? 'ガ' : 'ム'), traits, carn: !!carn };
}

// Drifters: autonomous creatures with a genome. They eat, flee, hunt,
// synchronise their phase, split with mutation, and die back into light.
export class Life {
  constructor(world, rng) {
    this.w = world;
    this.rng = rng;
    const F = () => new Float32Array(MAX);
    this.X = F(); this.Y = F(); this.Z = F(); this.VX = F(); this.VZ = F();
    this.TH = F(); this.E = F(); this.AGE = F(); this.WA = F();
    this.G = {};
    for (const k of GK) this.G[k] = F();
    this.GEN = new Int32Array(MAX);
    this.KEY = new Int32Array(MAX);
    this.ID = new Int32Array(MAX);
    this.EATEN = new Int32Array(MAX);
    this.alive = new Uint8Array(MAX);
    this.free = [];
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);
    this.hi = 0;
    this.count = 0;
    this.nextId = 1;
    this.grid = new Grid(WORLD, NR, MAX);
    this.births = 0;
    this.deaths = 0;
    this.maxGen = 0;
    this.immigrantAcc = 0;

    const gGeo = new THREE.IcosahedronGeometry(0.7, 1);
    gGeo.scale(1, 0.75, 1.35);
    const pGeo = new THREE.ConeGeometry(0.55, 2.2, 5);
    pGeo.rotateX(Math.PI / 2);
    this.gMesh = new THREE.InstancedMesh(gGeo, glowMaterial({ color: 0xffffff }, 0.38), MAX);
    this.pMesh = new THREE.InstancedMesh(pGeo, glowMaterial({ color: 0xffffff, flatShading: true }, 0.3), MAX);
    for (const m of [this.gMesh, this.pMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  randomGenome(archetype) {
    const rng = this.rng;
    const g = {};
    for (const k of GK) {
      const [a, b] = GENES[k];
      g[k] = a + rng() * (b - a);
    }
    if (archetype === 'pred') {
      g.carn = 0.7 + rng() * 0.25;
      g.size = 1.4 + rng() * 0.8;
      g.speed = 5 + rng() * 3;
      g.repro = 10 + rng() * 6;
    } else {
      g.carn = rng() * 0.3;
      g.size = 0.6 + rng() * 1.2;
      g.speed = 2.5 + rng() * 4;
    }
    return g;
  }

  spawn(x, z, g, energy, gen, th) {
    if (this.free.length === 0) return -1;
    const i = this.free.pop();
    this.X[i] = x; this.Z[i] = z;
    this.Y[i] = this.w.terrain.heightAt(x, z);
    this.VX[i] = 0; this.VZ[i] = 0;
    this.TH[i] = th;
    this.E[i] = energy;
    this.AGE[i] = 0;
    this.WA[i] = this.rng() * TAU;
    for (const k of GK) this.G[k][i] = g[k];
    this.GEN[i] = gen;
    this.EATEN[i] = 0;
    this.ID[i] = this.nextId++;
    this.KEY[i] = speciesKey(g.size, g.speed, g.carn, g.om);
    this.alive[i] = 1;
    if (i >= this.hi) this.hi = i + 1;
    this.count++;
    if (gen > this.maxGen) this.maxGen = gen;
    return i;
  }

  genomeOf(i) {
    const g = {};
    for (const k of GK) g[k] = this.G[k][i];
    return g;
  }

  mutate(g) {
    const rng = this.rng;
    const out = {};
    const big = rng() < 0.03;
    for (const k of GK) {
      const [a, b] = GENES[k];
      let v = g[k] + gauss(rng) * (b - a) * (big ? 0.18 : 0.045);
      out[k] = v < a ? a : v > b ? b : v;
    }
    return out;
  }

  kill(i, release) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
    this.deaths++;
    if (release) {
      const n = Math.max(1, Math.min(8, Math.round(this.G.size[i] * 1.5 + Math.max(0, this.E[i]) * 0.4)));
      this.w.motes.releaseAt(this.X[i], this.Y[i], this.Z[i], n, this.TH[i]);
    }
    this.w.onDeath(this.X[i], this.Z[i]);
  }

  seed(n, nPred) {
    const rng = this.rng;
    const arche = [];
    for (let a = 0; a < 3; a++) arche.push(this.randomGenome('graze'));
    const herdCenters = [];
    for (let k = 0; k < 9; k++) herdCenters.push([(rng() - 0.5) * WORLD * 0.7, (rng() - 0.5) * WORLD * 0.7, rng() * TAU]);
    for (let k = 0; k < n; k++) {
      const hc = herdCenters[k % herdCenters.length];
      const g = this.mutate(arche[k % 3]);
      this.spawn(hc[0] + gauss(rng) * 14, hc[1] + gauss(rng) * 14, g, 6 + rng() * 4, 0, wrapPhase(hc[2] + gauss(rng) * 0.8));
    }
    const pa = this.randomGenome('pred');
    for (let k = 0; k < nPred; k++) {
      this.spawn((rng() - 0.5) * WORLD * 0.7, (rng() - 0.5) * WORLD * 0.7, this.mutate(pa), 6, 0, rng() * TAU);
    }
  }

  step(dt) {
    const w = this.w;
    const C = w.C;
    const rng = this.rng;
    const { X, Y, Z, VX, VZ, TH, E, AGE, WA, GEN, alive } = this;
    const { size: GS, speed: GV, sense: GSE, carn: GC, om: GO, repro: GR, coup: GCP, life: GL } = this.G;
    const grid = this.grid;
    grid.build(this.hi, X, Z, (i) => alive[i] === 1);
    const n = grid.n;
    const start = grid.start, items = grid.items;
    const motes = w.motes;
    const terrain = w.terrain;
    const crystals = w.crystals;
    const mon = w.monoliths;
    const attr = C.attrSign;
    const syncG = C.syncSign * C.syncK;

    // immigration keeps the world from dying out entirely
    if (this.count < 40) {
      this.immigrantAcc += dt;
      if (this.immigrantAcc > 4) {
        this.immigrantAcc = 0;
        const x = (rng() - 0.5) * WORLD * 0.6, z = (rng() - 0.5) * WORLD * 0.6;
        const g = this.randomGenome(rng() < 0.2 ? 'pred' : 'graze');
        const th = rng() * TAU;
        for (let k = 0; k < 10; k++) this.spawn(x + gauss(rng) * 6, z + gauss(rng) * 6, this.mutate(g), 4, 0, th);
        w.onImmigration(x, z);
      }
    }

    // predators drift in from elsewhere if they vanish for long
    if (this.predCount === 0) {
      this.noPredT = (this.noPredT || 0) + dt;
      if (this.noPredT > 120 && this.count > 120) {
        this.noPredT = 0;
        this.predCount = -1;
        const x = (rng() - 0.5) * WORLD * 0.6, z = (rng() - 0.5) * WORLD * 0.6;
        const g = this.randomGenome('pred');
        const th = rng() * TAU;
        for (let k = 0; k < 5; k++) this.spawn(x + gauss(rng) * 6, z + gauss(rng) * 6, this.mutate(g), 8, 0, th);
        w.onImmigration(x, z);
      }
    } else this.noPredT = 0;

    const hiNow = this.hi;
    for (let i = 0; i < hiNow; i++) {
      if (!alive[i]) continue;
      const xi = X[i], zi = Z[i];
      const h = dt * crystals.timeAt(xi, zi);
      const si = GS[i], ci = GC[i], thi = TH[i];
      const isPred = ci > PRED;
      let sinS = 0, nn = 0, fx = 0, fz = 0;
      let prey = -1, preyD = 1e9, threat = -1, threatD = 1e9;
      let cx = grid.cx(xi), cz = grid.cx(zi);
      for (let jz = Math.max(0, cz - 1); jz <= Math.min(n - 1, cz + 1); jz++) {
        for (let jx = Math.max(0, cx - 1); jx <= Math.min(n - 1, cx + 1); jx++) {
          const c = jz * n + jx;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const j = items[k];
            if (j === i || !alive[j]) continue;
            const dx = X[j] - xi, dz = Z[j] - zi;
            const d2 = dx * dx + dz * dz;
            if (d2 > NR * NR) continue;
            const d = Math.sqrt(d2) + 1e-4;
            const dth = TH[j] - thi;
            if (d < 10) { sinS += Math.sin(dth); nn++; }
            let f = (attr * Math.cos(dth) * 1.4) / (d + 3);
            const minD = (si + GS[j]) * 0.75;
            if (d < minD) f -= (minD - d) * 4;
            fx += (dx / d) * f; fz += (dz / d) * f;
            const cj = GC[j];
            if (isPred && GS[j] < si * 0.95 && cj < ci - 0.15 && d < preyD) { prey = j; preyD = d; }
            else if (cj > PRED && si < GS[j] * 0.95 && ci < cj - 0.15 && d < threatD && d < GSE[i]) { threat = j; threatD = d; }
          }
        }
      }
      // monolith currents
      for (let m = 0; m < mon.length; m++) {
        const M = mon[m];
        const dx = M.x - xi, dz = M.z - zi;
        const d2 = dx * dx + dz * dz;
        if (d2 > 4900 || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const f = (attr * Math.cos(M.th - thi) * 3) / (1 + d / 12) / d;
        fx += dx * f; fz += dz * f;
      }

      let wa = WA[i] + gauss(rng) * 1.2 * h;
      WA[i] = wa;
      let dirx = Math.cos(wa) * 0.35, dirz = Math.sin(wa) * 0.35;
      let urgency = 0.55;
      if (threat >= 0) {
        dirx = -(X[threat] - xi) / threatD * 2; dirz = -(Z[threat] - zi) / threatD * 2;
        urgency = 1.3;
      } else if (prey >= 0) {
        dirx = (X[prey] - xi) / preyD * 1.5; dirz = (Z[prey] - zi) / preyD * 1.5;
        urgency = 1.15;
        if (preyD < (si + GS[prey]) * 0.7) {
          E[i] += E[prey] * 0.8 * ci + GS[prey] * 3.2 * ci;
          this.EATEN[i]++;
          this.kill(prey, false);
          w.motes.releaseAt(X[prey], Y[prey], Z[prey], 1, TH[prey]);
        }
      }
      if (threat < 0 && (prey < 0 || !isPred) && E[i] < GR[i] * si * 1.5) {
        const m = motes.nearestGround(xi, zi, GSE[i]);
        if (m >= 0) {
          const dx = motes.X[m] - xi, dz = motes.Z[m] - zi;
          const d = Math.sqrt(dx * dx + dz * dz) + 1e-4;
          dirx = (dx / d) * 1.2; dirz = (dz / d) * 1.2;
          urgency = 0.9;
          if (d < 1.3 + si) {
            E[i] += 1.3 * (1 - ci * 0.85);
            this.EATEN[i]++;
            motes.kill(m);
          }
        }
      }
      const dl = Math.sqrt(dirx * dirx + dirz * dirz) + 1e-4;
      const sp = GV[i] * urgency;
      const tx = (dirx / dl) * sp + fx, tz = (dirz / dl) * sp + fz;
      const blend = Math.min(1, 2.5 * h);
      let vx = VX[i] + (tx - VX[i]) * blend;
      let vz = VZ[i] + (tz - VZ[i]) * blend;
      const vm2 = vx * vx + vz * vz;
      const vmax = GV[i] * 1.6;
      if (vm2 > vmax * vmax) { const s = vmax / Math.sqrt(vm2); vx *= s; vz *= s; }
      let nx = xi + vx * h, nz = zi + vz * h;
      if (nx > LIM) { nx = LIM; vx = -Math.abs(vx); WA[i] = Math.PI; }
      else if (nx < -LIM) { nx = -LIM; vx = Math.abs(vx); WA[i] = 0; }
      if (nz > LIM) { nz = LIM; vz = -Math.abs(vz); WA[i] = -Math.PI / 2; }
      else if (nz < -LIM) { nz = -LIM; vz = Math.abs(vz); WA[i] = Math.PI / 2; }
      X[i] = nx; Z[i] = nz; VX[i] = vx; VZ[i] = vz;
      Y[i] = terrain.heightAt(nx, nz);
      terrain.deposit(nx, nz, 0.05 * si * h);

      // phase dynamics (Kuramoto-like)
      let th = thi + h * (GO[i] + (syncG * GCP[i] * sinS) / (nn || 1));
      if (th > TAU) th -= TAU; else if (th < 0) th += TAU;
      TH[i] = th;

      // metabolism
      E[i] -= h * (0.034 * si * si + 0.0032 * si * (vx * vx + vz * vz) + 0.0015 * GSE[i]);
      const age = (AGE[i] += h);
      if (E[i] <= 0 || age > GL[i] * (0.7 + 0.3 * si)) {
        this.kill(i, true);
        continue;
      }
      // reproduction by fission
      if (E[i] > GR[i] * si && this.free.length > 0 && age > 6) {
        const g = this.mutate(this.genomeOf(i));
        const e = E[i] * 0.42;
        E[i] = e;
        const a = rng() * TAU;
        const c = this.spawn(nx + Math.cos(a) * si * 1.5, nz + Math.sin(a) * si * 1.5, g, e, GEN[i] + 1, wrapPhase(th + gauss(rng) * 0.3));
        if (c >= 0) this.births++;
      }
    }
    while (this.hi > 0 && !alive[this.hi - 1]) this.hi--;
  }

  // Herd scan for crystallization: returns {x,z,th} or null.
  findCrystalSeed(minCount) {
    const g = this.grid;
    const n = g.n;
    const C = this.w.C;
    let best = null;
    let bestScore = 0;
    for (let c = 0; c < n * n; c++) {
      const s = g.start[c], e = g.start[c + 1];
      const cnt = e - s;
      if (cnt < minCount) continue;
      let sx = 0, sz = 0, cs = 0, sn = 0, m = 0;
      for (let k = s; k < e; k++) {
        const i = g.items[k];
        if (!this.alive[i]) continue;
        sx += this.X[i]; sz += this.Z[i];
        cs += Math.cos(this.TH[i]); sn += Math.sin(this.TH[i]);
        m++;
      }
      if (m < minCount) continue;
      const R = Math.sqrt(cs * cs + sn * sn) / m;
      const ok = C.syncSign > 0 ? R > 0.88 : R < 0.15;
      if (!ok) continue;
      const score = m * (C.syncSign > 0 ? R : 1 - R);
      if (score > bestScore) {
        bestScore = score;
        best = { x: sx / m, z: sz / m, th: wrapPhase(Math.atan2(sn, cs)) };
      }
    }
    return best;
  }

  render(time) {
    const { X, Y, Z, VX, VZ, TH, E, alive } = this;
    const GS = this.G.size, GC = this.G.carn, GR = this.G.repro;
    const { _m, _q, _p, _s, _c, _up } = this;
    let ng = 0, np = 0;
    for (let i = 0; i < this.hi; i++) {
      if (!alive[i]) continue;
      const s = GS[i];
      const pred = GC[i] > PRED;
      const yaw = Math.atan2(VX[i], VZ[i]);
      _q.setFromAxisAngle(_up, yaw);
      const bob = pred ? 0 : Math.abs(Math.sin(time * 5 + i)) * 0.25 * s;
      _p.set(X[i], Y[i] + s * 0.55 + bob, Z[i]);
      const fat = 0.75 + 0.35 * Math.min(1, E[i] / (GR[i] * s));
      _s.set(s * fat * 1.3, s * fat * 1.3, s * 1.3);
      _m.compose(_p, _q, _s);
      _c.setHSL(TH[i] / 6.2831853, pred ? 0.95 : 0.75, pred ? 0.5 : 0.6);
      if (pred) {
        this.pMesh.setMatrixAt(np, _m);
        this.pMesh.setColorAt(np, _c);
        np++;
      } else {
        this.gMesh.setMatrixAt(ng, _m);
        this.gMesh.setColorAt(ng, _c);
        ng++;
      }
    }
    this.gMesh.count = ng;
    this.pMesh.count = np;
    for (const m of [this.gMesh, this.pMesh]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }

  // nearest creature to a ray (scan target). Returns index or -1.
  pick(origin, dir, maxDist, coneCos) {
    let best = -1, bestScore = -Infinity;
    const { X, Y, Z, alive } = this;
    for (let i = 0; i < this.hi; i++) {
      if (!alive[i]) continue;
      const dx = X[i] - origin.x, dy = Y[i] + this.G.size[i] * 0.5 - origin.y, dz = Z[i] - origin.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > maxDist || d < 0.5) continue;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (cos < coneCos) continue;
      const score = cos * 4 - d / maxDist;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
}
