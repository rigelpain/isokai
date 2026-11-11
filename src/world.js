import * as THREE from 'three';
import { mulberry32, makeNoise, TAU } from './rng.js';
import { makeConstants } from './laws.js';
import { Terrain, WORLD } from './terrain.js';
import { Sky } from './sky.js';
import { Motes } from './motes.js';
import { Life, speciesInfo } from './life.js';
import { Crystals, glowMaterial } from './crystals.js';

export function phaseColor(th, out, s = 0.8, l = 0.58) {
  return out.setHSL((((th / TAU) % 1) + 1) % 1, s, l);
}

export class World {
  constructor(seed, scene) {
    this.seed = seed;
    this.scene = scene;
    const rng = mulberry32(seed);
    this.rng = rng;
    this.C = makeConstants(rng);
    this.time = 0;
    this.skyPhase = rng() * TAU;
    this.events = []; // {type, x, z, t}
    this.listeners = [];

    const noise = makeNoise(rng);
    this.terrain = new Terrain(noise);
    scene.add(this.terrain.mesh);

    this.sky = new Sky();
    scene.add(this.sky.mesh);

    // phase pillars
    this.monoliths = [];
    const pillarGeo = new THREE.CylinderGeometry(2.6, 3.6, 1, 6);
    const ringGeo = new THREE.TorusGeometry(7, 0.35, 6, 40);
    for (let k = 0; k < 11; k++) {
      let x, z, tries = 0;
      do {
        x = (rng() - 0.5) * WORLD * 0.78;
        z = (rng() - 0.5) * WORLD * 0.78;
        tries++;
      } while (tries < 30 && this.monoliths.some((m) => (m.x - x) ** 2 + (m.z - z) ** 2 < 90 * 90));
      const th = (k / 11) * TAU + rng() * 0.3;
      const H = 30 + rng() * 40;
      const y = this.terrain.heightAt(x, z);
      const col = phaseColor(th, new THREE.Color(), 0.85, 0.55);
      const group = new THREE.Group();
      const pillar = new THREE.Mesh(pillarGeo, glowMaterial({ color: col }, 0.55));
      pillar.scale.y = H;
      pillar.position.y = H / 2 - 2;
      group.add(pillar);
      const rings = [];
      for (let r = 0; r < 3; r++) {
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.position.y = H * (0.45 + r * 0.22);
        ring.scale.setScalar(0.8 + r * 0.35);
        ring.userData.spin = (rng() - 0.5) * 1.2;
        group.add(ring);
        rings.push(ring);
      }
      group.position.set(x, y, z);
      scene.add(group);
      this.monoliths.push({ x, z, y, H, th, cy: y + H * 0.6, group, rings });
    }

    this.crystals = new Crystals(this);
    scene.add(this.crystals.mesh, this.crystals.rings);
    for (let k = 0; k < 4; k++) this.crystals.add((rng() - 0.5) * WORLD * 0.7, (rng() - 0.5) * WORLD * 0.7, rng() * TAU);

    this.motes = new Motes(this, rng);
    scene.add(this.motes.points);
    for (let k = 0; k < 1800; k++) {
      const x = (rng() - 0.5) * WORLD * 0.85, z = (rng() - 0.5) * WORLD * 0.85;
      this.motes.spawn(x, this.terrain.heightAt(x, z) + rng() * 40, z, rng() * TAU);
    }

    this.life = new Life(this, rng);
    scene.add(this.life.gMesh, this.life.pMesh);
    this.life.seed(340, 26);

    this.crystalAcc = 0;
    this.lastCrystalT = 70; // the first herd crystal appears after ~95 s
    this.fogColor = new THREE.Color();
    this.skyTop = new THREE.Color();
    this.moonColor = new THREE.Color();
    this._tmp = new THREE.Color();
    this.speciesSeen = new Map(); // key -> info
    this.history = []; // population samples
    this.histAcc = 0;
  }

  species(key) {
    return speciesInfo(key, this.seed);
  }

  emit(type, x, z) {
    this.events.push({ type, x, z, t: this.time });
    if (this.events.length > 2000) this.events.length = 0;
  }

  onDeath(x, z) { this.emit('death', x, z); }
  onImmigration(x, z) { this.emit('immigration', x, z); }

  step(dt) {
    this.time += dt;
    this.skyPhase = (this.skyPhase + (TAU / this.C.skyPeriod) * dt) % TAU;
    this.motes.step(dt, this.time);
    this.life.step(dt);
    this.crystals.step(dt);
    this.terrain.update(dt);

    this.crystalAcc += dt;
    if (this.crystalAcc > 1.5) {
      this.crystalAcc = 0;
      if (!this.crystals.full && this.time - this.lastCrystalT > 25) {
        const s = this.life.findCrystalSeed(14);
        if (s) {
          const near = this.crystals.nearest(s.x, s.z);
          if (!near || near.d > 45) {
            this.crystals.add(s.x, s.z, s.th);
            this.lastCrystalT = this.time;
            this.emit('crystal', s.x, s.z);
          }
        }
      }
    }

    this.histAcc += dt;
    if (this.histAcc > 2) {
      this.histAcc = 0;
      this.sample();
    }
  }

  sample() {
    const L = this.life;
    let g = 0, p = 0;
    const per = new Map();
    for (let i = 0; i < L.hi; i++) {
      if (!L.alive[i]) continue;
      if (L.G.carn[i] > 0.55) p++; else g++;
      const k = L.KEY[i];
      per.set(k, (per.get(k) || 0) + 1);
    }
    this.population = per;
    L.predCount = p;
    this.history.push({ t: this.time, g, p, s: per.size, m: this.motes.count });
    if (this.history.length > 300) this.history.shift();
  }

  updateVisuals(camPos, realTime) {
    const sp = this.skyPhase;
    phaseColor(sp, this.moonColor, 0.85, 0.6);
    phaseColor(sp, this._tmp, 0.6, 0.18);
    this.fogColor.setRGB(0.012, 0.008, 0.028).lerp(this._tmp, 0.22);
    this.skyTop.setRGB(0.004, 0.003, 0.012).lerp(this._tmp, 0.08);
    this.sky.update(sp, realTime, camPos, this.moonColor, this.skyTop, this.fogColor);
    const tu = this.terrain.material.uniforms;
    tu.uSky.value.copy(this.fogColor);
    tu.uFog.value.copy(this.fogColor);
    tu.uTime.value = this.time;
    tu.uCam.value.copy(camPos);
    for (const m of this.monoliths) {
      for (const r of m.rings) {
        r.rotation.x = Math.PI / 2 + Math.sin(realTime * 0.3 + m.x) * 0.3;
        r.rotation.z += r.userData.spin * 0.016;
      }
    }
    this.motes.render();
    this.life.render(realTime);
    this.crystals.render(this.time);
  }
}
