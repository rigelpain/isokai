import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { World } from './world.js';
import { Player } from './player.js';
import { UI, hsl, esc } from './ui.js';
import { Audio } from './audio.js';
import { LAWS, LAW_BY_ID } from './laws.js';
import { TAU } from './rng.js';

// ---- seed ---------------------------------------------------------------
function readSeed() {
  const m = location.hash.match(/(\d+)/);
  if (m) return Number(m[1]) >>> 0;
  const s = (Math.random() * 1e9) >>> 0;
  history.replaceState(null, '', '#' + s);
  return s;
}
const seed = readSeed();
addEventListener('hashchange', () => location.reload());

// ---- renderer -------------------------------------------------------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
const MAX_PR = Math.min(window.devicePixelRatio || 1, 2);
let pr = Math.min(MAX_PR, 1.25);
renderer.setPixelRatio(pr);
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 2000);
scene.fog = new THREE.FogExp2(0x000000, 0.0034);
scene.add(new THREE.HemisphereLight(0x8899ff, 0x221133, 1.2));
const sun = new THREE.DirectionalLight(0xffeedd, 1.6);
sun.position.set(0.4, 0.8, 0.3);
scene.add(sun);

const composer = new EffectComposer(renderer, {
  frameBufferType: THREE.HalfFloatType,
  multisampling: Math.min(4, renderer.capabilities.maxSamples || 0),
});
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ intensity: 1.15, luminanceThreshold: 0.32, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 });
const bloomPass = new EffectPass(camera, bloom);
composer.addPass(bloomPass);
let bloomOn = true;

// ---- world ---------------------------------------------------------------
const world = new World(seed, scene);
const player = new Player(world, camera, canvas);
const ui = new UI();
const audio = new Audio();

const SAVE_KEY = 'isokai:' + seed;
const found = new Set();
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
  for (const id of s.laws || []) if (LAW_BY_ID[id]) found.add(id);
  for (const [k, v] of s.species || []) world.speciesSeen.set(k, v);
} catch (e) { /* storage unavailable */ }
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ laws: [...found], species: [...world.speciesSeen.entries()] }));
  } catch (e) { /* ignore */ }
}

ui.bind({
  world,
  found,
  newWorld: () => {
    location.hash = '#' + ((Math.random() * 1e9) >>> 0);
  },
});

function discover(id) {
  if (found.has(id)) return;
  found.add(id);
  save();
  const law = LAW_BY_ID[id];
  audio.discover();
  ui.toast(`<small>法則を発見 ${found.size}/${LAWS.length}</small><b>${esc(law.name)}</b><span>${esc(law.text(world.C))}</span>${law.instrument ? `<em>${esc(law.instrument)}</em>` : ''}`, 'law');
  if (found.size === LAWS.length) {
    setTimeout(() => ui.toast('<b>この世界の法則をすべて記した。</b><span>Tab →「世界」から、まったく別の法則を持つ世界へ行ける。</span>', 'law'), 2500);
  }
  ui.refreshJournal();
}

// ---- input ---------------------------------------------------------------
const overlay = document.getElementById('overlay');
let started = false;
let timeScale = 1;
const SCALES = [1, 3, 6];

function begin() {
  started = true;
  for (const k in player.stat) if (typeof player.stat[k] === 'number' && k !== 'tf') player.stat[k] = 0;
  overlay.classList.add('hide');
  audio.start();
  player.lock();
}
document.getElementById('go').addEventListener('click', begin);
document.getElementById('seedlabel').textContent = seed;

canvas.addEventListener('click', () => {
  if (!started) return;
  if (!player.locked) {
    if (ui.journalOpen) ui.setJournal(false);
    player.lock();
  } else scan();
});
document.getElementById('jclose').addEventListener('click', () => {
  ui.setJournal(false);
  player.lock();
});

addEventListener('keydown', (e) => {
  if (!started) {
    if (e.code === 'Enter' || e.code === 'Space') begin();
    return;
  }
  switch (e.code) {
    case 'Tab':
      e.preventDefault();
      ui.setJournal(!ui.journalOpen);
      if (ui.journalOpen) document.exitPointerLock?.();
      else player.lock();
      break;
    case 'KeyF':
      scan();
      break;
    case 'KeyR': {
      const moved = player.pulse();
      if (moved >= 0) {
        audio.chime(220 * Math.pow(2, player.th / TAU), 0.9, 0.12, 'triangle');
        if (moved >= 25) discover('pulse');
      }
      break;
    }
    case 'KeyT':
      timeScale = SCALES[(SCALES.indexOf(timeScale) + 1) % SCALES.length];
      ui.toast(`時間の流れ ×${timeScale}`);
      break;
    case 'KeyM':
      ui.toast(audio.toggle() ? '音: オフ' : '音: オン');
      break;
    case 'KeyB':
      bloomOn = !bloomOn;
      bloomPass.enabled = bloomOn;
      ui.toast(bloomOn ? '光の滲み: オン' : '光の滲み: オフ');
      break;
  }
});

// ---- scanning ------------------------------------------------------------
const fwd = new THREE.Vector3();
let target = -1;
const marker = new THREE.Mesh(
  new THREE.TorusGeometry(1, 0.06, 6, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, blending: THREE.AdditiveBlending })
);
marker.renderOrder = 10;
marker.visible = false;
scene.add(marker);

function scan() {
  if (target < 0) {
    ui.toast('照準の先に観測できるものがない');
    return;
  }
  const L = world.life;
  const i = target;
  const key = L.KEY[i];
  const sp = world.species(key);
  const isNew = !world.speciesSeen.has(key);
  world.speciesSeen.set(key, { name: sp.name, traits: sp.traits, th: L.TH[i] });
  save();
  audio.chime(880, 0.5, 0.08);
  const e = L.E[i], cap = L.G.repro[i] * L.G.size[i];
  ui.showScan(
    `<h3><span class="dot" style="background:${hsl(L.TH[i])}"></span>${esc(sp.name)}${isNew ? ' <em>新種記録</em>' : ''}</h3>
     <p class="dim">${sp.traits.map(esc).join('・')}</p>
     <table>
      <tr><td>世代</td><td>${L.GEN[i]}</td></tr>
      <tr><td>齢</td><td>${L.AGE[i].toFixed(0)} 秒</td></tr>
      <tr><td>体格</td><td>${L.G.size[i].toFixed(2)}</td></tr>
      <tr><td>速さ</td><td>${L.G.speed[i].toFixed(1)}</td></tr>
      <tr><td>感覚</td><td>${L.G.sense[i].toFixed(0)}</td></tr>
      <tr><td>肉食度</td><td>${(L.G.carn[i] * 100).toFixed(0)}%</td></tr>
      <tr><td>固有の回転</td><td>${L.G.om[i] >= 0 ? '+' : ''}${L.G.om[i].toFixed(2)}</td></tr>
      <tr><td>分裂まで</td><td>${Math.min(100, (e / cap) * 100).toFixed(0)}%</td></tr>
      <tr><td>食べた数</td><td>${L.EATEN[i]}</td></tr>
     </table>`
  );
  if (sp.carn) discover('predation');
  else {
    graze++;
    if (graze >= 2) discover('graze');
  }
  if (L.GEN[i] >= 4) discover('heredity');
  if (found.has('heredity') === false && L.GEN[i] > 0 && L.GEN[i] < 4) ui.toast(`世代 ${L.GEN[i]}。もっと古い血筋を探せ…`);
}
let graze = 0;

// ---- quality governor ----------------------------------------------------
let ema = 16.7;
let slowT = 0, fastT = 0;
function govern(dtMs, dt) {
  ema += (dtMs - ema) * 0.05;
  if (ema > 18.2) { slowT += dt; fastT = 0; }
  else if (ema < 13) { fastT += dt; slowT = 0; }
  else { slowT = 0; fastT = 0; }
  if (slowT > 1.2) {
    slowT = 0;
    if (pr > 0.55) setPR(pr - 0.15);
    else if (bloomOn) { bloomOn = false; bloomPass.enabled = false; }
  } else if (fastT > 4 && pr < MAX_PR) {
    fastT = 0;
    setPR(Math.min(MAX_PR, pr + 0.1));
  }
}
function setPR(v) {
  pr = v;
  renderer.setPixelRatio(pr);
  resize();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  world.motes.material.uniforms.uScale.value = (0.7 * h * pr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
}
addEventListener('resize', resize);
resize();

// ---- loop ----------------------------------------------------------------
let last = performance.now();
let realTime = 0;
let frameN = 0;
let fps = 60, fpsAcc = 0, fpsN = 0;
let lastNewSpeciesToast = 0;
const everKeys = new Set();
let lastHistLen = 0;

function checkLaws() {
  const st = player.stat;
  if (st.highT > 2.5) discover('gravity');
  if (st.pull > 2 || st.push > 2) discover('force');
  if (st.drift > 1.2) discover('sync');
  if (st.crystalT > 3) discover('time');
  if (player.onGround && world.terrain.wearAt(player.pos.x, player.pos.z) > 0.15) discover('memory');
  // events since last frame
  for (const e of world.events) {
    const d = Math.hypot(e.x - player.pos.x, e.z - player.pos.z);
    if (e.type === 'death' && d < 24) discover('cycle');
    if (e.type === 'crystal') {
      if (d < 170) discover('crystal');
      ui.toast(d < 170 ? '<b>すぐ近くで結晶が生まれた</b>' : 'どこか遠くで、結晶が生まれた気配がする');
      audio.chime(330, 2.5, 0.08);
    }
    if (e.type === 'immigration') ui.toast('どこかに胞子の雨が降った（生命の再来）');
  }
}

function checkEvolution() {
  if (world.history.length === lastHistLen || !world.population) return;
  lastHistLen = world.history.length;
  let fresh = null;
  for (const k of world.population.keys()) {
    if (!everKeys.has(k)) {
      everKeys.add(k);
      if (world.time > 40) fresh = k;
    }
  }
  if (fresh !== null && realTime - lastNewSpeciesToast > 25) {
    lastNewSpeciesToast = realTime;
    const s = world.species(fresh);
    ui.toast(`新しい形が生まれた: <b>${esc(s.name)}</b> <span class="dim">${s.traits.map(esc).join('・')}</span>`);
  }
  if (ui.journalOpen && ui.tab !== 'laws') ui.refreshJournal();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = now - last;
  last = now;
  const dt = Math.min(dtMs / 1000, 0.1);
  realTime += dt;

  const simDt = dt * timeScale;
  const steps = timeScale > 1 ? Math.min(3, Math.ceil(timeScale / 2)) : 1;
  for (let s = 0; s < steps; s++) world.step(simDt / steps);
  if (started) player.update(dt);
  else {
    player.yaw += dt * 0.04;
    camera.position.copy(player.pos);
    camera.rotation.set(-0.05, player.yaw, 0, 'YXZ');
  }

  if (started) checkLaws();
  world.events.length = 0;
  checkEvolution();

  if ((frameN & 1) === 0) {
    player.forward(fwd);
    target = world.life.pick(player.pos, fwd, 90, 0.985);
  }
  if (target >= 0 && world.life.alive[target]) {
    const L = world.life;
    const s = L.G.size[target];
    marker.visible = true;
    marker.position.set(L.X[target], L.Y[target] + s * 0.6, L.Z[target]);
    marker.quaternion.copy(camera.quaternion);
    marker.scale.setScalar(s * 1.6 + 0.6);
    marker.material.color.setHSL(L.TH[target] / TAU, 0.9, 0.7);
    ui.setTarget(`${world.speciesSeen.has(L.KEY[target]) ? world.species(L.KEY[target]).name : '未知の漂生体'}  [F] 観測`);
  } else {
    marker.visible = false;
    target = -1;
    ui.setTarget('');
  }

  scene.fog.color.copy(world.fogColor);
  world.terrain.material.uniforms.uFogDen.value = scene.fog.density;
  world.motes.material.uniforms.uFogDen.value = scene.fog.density * 0.6;
  world.updateVisuals(camera.position, realTime);
  if ((frameN & 1) === 0) ui.drawPhase(player, world, found);
  audio.update(player.th, player.stat.alt, player.stat.tf);

  composer.render(dt);

  fpsAcc += dtMs;
  fpsN++;
  if (fpsAcc > 500) {
    fps = (fpsN * 1000) / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
    ui.info(world, timeScale, fps, pr, found);
  }
  if (frameN > 30) govern(dtMs, dt);
  frameN++;
}
world.sample();
for (const k of world.population.keys()) everKeys.add(k);
requestAnimationFrame(frame);

// for debugging / perf checks from the console
window.__isokai = { world, player, renderer, composer, scene, camera, found, discover, get pr() { return pr; } };
