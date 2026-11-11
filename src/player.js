import * as THREE from 'three';
import { TAU, wrapPhase } from './rng.js';
import { WORLD } from './terrain.js';

const EYE = 1.7;
const LIM = WORLD / 2 - 12;

// You are a drifter too: you have a phase, so the same laws act on you.
export class Player {
  constructor(world, camera, dom) {
    this.w = world;
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.1;
    // start heavy (grounded): the sky will turn and lift you sooner or later
    this.th = wrapPhase(world.C.gravSign > 0 ? world.skyPhase : world.skyPhase + Math.PI);
    this.keys = new Set();
    this.onGround = false;
    this.pulseCd = 0;
    this.locked = false;
    // stats used for discovering laws
    this.stat = { pull: 0, push: 0, drift: 0, highT: 0, crystalT: 0, force: 0, tf: 1, buoy: 0, alt: 0 };

    // spawn on a free spot near the middle
    let best = null;
    for (let k = 0; k < 40; k++) {
      const x = (world.rng() - 0.5) * 120, z = (world.rng() - 0.5) * 120;
      const h = world.terrain.heightAt(x, z);
      if (!best || Math.abs(h) < Math.abs(best[2])) best = [x, z, h];
    }
    this.pos.set(best[0], best[2] + EYE + 2, best[1]);

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      // without pointer lock (iframes etc.) you can still drag to look
      if (!this.locked && !(e.buttons & 1 && e.target === dom)) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });

    this.pulseMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.pulseMesh.visible = false;
    this.pulseT = 1;
    world.scene.add(this.pulseMesh);
  }

  lock() {
    try {
      const r = this.dom.requestPointerLock?.();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* pointer lock unavailable: drag to look instead */ }
  }

  forward(out) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  // Returns number of motes moved by a pulse (or -1 when on cooldown)
  pulse() {
    if (this.pulseCd > 0) return -1;
    this.pulseCd = 1.2;
    const p = this.pos;
    const moved = this.w.motes.pulse(p.x, p.y, p.z, this.th, 45);
    // creatures get a push too
    const L = this.w.life;
    const C = this.w.C;
    for (let i = 0; i < L.hi; i++) {
      if (!L.alive[i]) continue;
      const dx = p.x - L.X[i], dz = p.z - L.Z[i];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 45 || d < 0.1) continue;
      const s = (C.attrSign * Math.cos(L.TH[i] - this.th) * 16) / (1 + d / 12);
      L.VX[i] += (dx / d) * s;
      L.VZ[i] += (dz / d) * s;
    }
    this.pulseT = 0;
    this.pulseMesh.visible = true;
    this.pulseMesh.material.color.setHSL(this.th / TAU, 0.9, 0.6);
    return moved;
  }

  update(dt) {
    const w = this.w;
    const C = w.C;
    const k = this.keys;
    const st = this.stat;
    this.pulseCd -= dt;

    // phase control
    let turning = false;
    if (k.has('KeyQ')) { this.th -= 1.6 * dt; turning = true; }
    if (k.has('KeyE')) { this.th += 1.6 * dt; turning = true; }
    // passive synchronisation with nearby drifters
    const L = w.life;
    let sinS = 0, n = 0;
    for (let i = 0; i < L.hi; i++) {
      if (!L.alive[i]) continue;
      const dx = L.X[i] - this.pos.x, dz = L.Z[i] - this.pos.z, dy = L.Y[i] - this.pos.y;
      if (dx * dx + dz * dz + dy * dy > 196) continue;
      sinS += Math.sin(L.TH[i] - this.th);
      n++;
    }
    if (n > 0 && !turning) {
      const d = C.syncSign * C.syncK * 0.9 * (sinS / n) * Math.min(1, n / 4) * dt;
      this.th += d;
      st.drift += Math.abs(d);
    }
    this.th = wrapPhase(this.th);

    // horizontal control
    const sp = k.has('ShiftLeft') || k.has('ShiftRight') ? 34 : 14;
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const ax = (mx * cy + mz * sy) * sp;
    const az = (-mx * sy + mz * cy) * sp;
    const v = this.vel;
    const resp = this.onGround ? 6 : 2.5;
    v.x += (ax - v.x) * Math.min(1, resp * dt);
    v.z += (az - v.z) * Math.min(1, resp * dt);

    // the phase-gravity law
    const dsky = this.th - w.skyPhase;
    const buoy = -C.G * (C.gravSign * Math.cos(dsky) + 0.22);
    st.buoy = buoy;
    v.y += buoy * dt;
    if (k.has('Space') && this.onGround) { v.y = 9; this.onGround = false; }

    // monolith forces
    let fpull = 0, fpush = 0;
    for (const M of w.monoliths) {
      const dx = M.x - this.pos.x, dy = M.cy - this.pos.y, dz = M.z - this.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 110 * 110) continue;
      const d = Math.sqrt(d2) + 0.01;
      const f = (C.attrSign * Math.cos(M.th - this.th) * C.attrStrength) / (1 + d / 14);
      v.x += (dx / d) * f * dt * 0.6;
      v.y += (dy / d) * f * dt * 0.6;
      v.z += (dz / d) * f * dt * 0.6;
      if (f > 0) fpull = Math.max(fpull, f); else fpush = Math.max(fpush, -f);
      // don't walk through pillars
      const hd = Math.sqrt(dx * dx + dz * dz);
      if (hd < 5 && this.pos.y < M.y + M.H) {
        this.pos.x -= (dx / hd) * (5 - hd);
        this.pos.z -= (dz / hd) * (5 - hd);
      }
    }
    st.force = fpull > fpush ? fpull : -fpush;
    if (fpull > 11) st.pull += dt;
    if (fpush > 11) st.push += dt;

    const vd = Math.exp(-0.5 * dt);
    v.y *= vd;
    if (v.y > 40) v.y = 40; else if (v.y < -60) v.y = -60;
    this.pos.addScaledVector(v, dt);
    this.pos.x = Math.max(-LIM, Math.min(LIM, this.pos.x));
    this.pos.z = Math.max(-LIM, Math.min(LIM, this.pos.z));

    const g = w.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < g + EYE) {
      this.pos.y = g + EYE;
      if (v.y < 0) v.y = 0;
      this.onGround = true;
    } else {
      this.onGround = this.pos.y < g + EYE + 0.15;
    }
    if (this.pos.y > g + 160) { this.pos.y = g + 160; if (v.y > 0) v.y = 0; }
    st.alt = this.pos.y - g - EYE;
    if (st.alt > 18) st.highT += dt;

    const tf = w.crystals.timeAt(this.pos.x, this.pos.z);
    st.tf = tf;
    if (Math.abs(tf - 1) > 0.25) st.crystalT += dt;

    // camera
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    if (this.pulseMesh.visible) {
      this.pulseT += dt / 0.7;
      const t = this.pulseT;
      this.pulseMesh.position.copy(this.pos);
      this.pulseMesh.scale.setScalar(2 + t * 43);
      this.pulseMesh.material.opacity = (1 - t) * 0.5;
      if (t >= 1) this.pulseMesh.visible = false;
    }
  }
}
