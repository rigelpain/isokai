import { TAU } from './rng.js';
import { LAWS } from './laws.js';

const $ = (id) => document.getElementById(id);
const hsl = (th, s = 85, l = 60) => `hsl(${((th / TAU) * 360).toFixed(0)} ${s}% ${l}%)`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class UI {
  constructor() {
    this.phase = $('phase');
    this.pctx = this.phase.getContext('2d');
    this.tab = 'laws';
    this.journalOpen = false;
    this._ring = this._makeRing();
    for (const b of document.querySelectorAll('[data-tab]')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.refreshJournal();
      });
    }
    this.scanTimer = 0;
  }

  _makeRing() {
    const c = document.createElement('canvas');
    c.width = c.height = 300;
    const g = c.getContext('2d');
    const R = 120;
    for (let a = 0; a < 360; a += 2) {
      g.beginPath();
      const t0 = ((a - 90) * Math.PI) / 180, t1 = ((a + 2.5 - 90) * Math.PI) / 180;
      g.arc(150, 150, R, t0, t1);
      g.strokeStyle = `hsl(${a} 85% 58%)`;
      g.lineWidth = 14;
      g.stroke();
    }
    return c;
  }

  toast(html, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = html;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), kind === 'law' ? 7000 : 4200);
    setTimeout(() => el.remove(), kind === 'law' ? 7800 : 5000);
  }

  drawPhase(player, world, found) {
    const g = this.pctx;
    const S = this.phase.width;
    const c = S / 2;
    g.clearRect(0, 0, S, S);
    g.drawImage(this._ring, 0, 0, S, S);
    const R = S * 0.4;
    const ang = (th) => th - Math.PI / 2;
    // player needle
    const a = ang(player.th);
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a) * R * 0.92, c + Math.sin(a) * R * 0.92);
    g.stroke();
    g.fillStyle = hsl(player.th, 90, 65);
    g.beginPath();
    g.arc(c, c, S * 0.13, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.stroke();
    if (found.has('gravity')) {
      const s = ang(world.skyPhase);
      g.fillStyle = hsl(world.skyPhase, 90, 75);
      g.strokeStyle = '#000';
      g.beginPath();
      g.arc(c + Math.cos(s) * R, c + Math.sin(s) * R, S * 0.055, 0, TAU);
      g.fill();
      g.stroke();
      // the opposite side of the moon
      const o = s + Math.PI;
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.arc(c + Math.cos(o) * R, c + Math.sin(o) * R, S * 0.05, 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }
    const lines = [];
    if (found.has('gravity')) {
      const b = player.stat.buoy;
      lines.push(b > 0.5 ? `浮力 ↑ ${b.toFixed(1)}` : b < -0.5 ? `重さ ↓ ${(-b).toFixed(1)}` : '中立');
    }
    lines.push(`高度 ${player.stat.alt.toFixed(0)}`);
    if (found.has('time')) lines.push(`時間 ×${player.stat.tf.toFixed(2)}`);
    $('phaseinfo').innerHTML = lines.map(esc).join('<br>');
  }

  info(world, timeScale, fps, pr, found) {
    const L = world.life;
    $('info').innerHTML =
      `漂生体 ${L.count} ・ 光粒 ${world.motes.count} ・ 結晶 ${world.crystals.list.length}<br>` +
      `法則 ${found.size}/${LAWS.length} ・ 時間 ×${timeScale}<span class="dim"> ・ ${fps.toFixed(0)}fps ・ q${pr.toFixed(2)}</span>`;
  }

  setTarget(text) {
    const el = $('target');
    if (el.textContent !== text) el.textContent = text;
  }

  showScan(html) {
    const el = $('scan');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => el.classList.remove('show'), 9000);
  }

  setJournal(open) {
    this.journalOpen = open;
    $('journal').classList.toggle('show', open);
    if (open) this.refreshJournal();
  }

  bind(state) {
    this.state = state;
  }

  refreshJournal() {
    if (!this.journalOpen || !this.state) return;
    const { world, found } = this.state;
    for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const body = $('jbody');
    if (this.tab === 'laws') {
      let html = '';
      if (found.size === LAWS.length) html += `<p class="done">この世界の法則をすべて記した。「世界」タブから、別の法則を持つ世界へ行ける。</p>`;
      for (const l of LAWS) {
        if (found.has(l.id)) {
          html += `<div class="law found"><h3>◆ ${esc(l.name)}</h3><p>${esc(l.text(world.C))}</p></div>`;
        } else {
          html += `<div class="law"><h3>◇ ？？？</h3><p class="hint">${esc(l.hint)}</p></div>`;
        }
      }
      body.innerHTML = html;
    } else if (this.tab === 'species') {
      const pop = world.population || new Map();
      const rows = [...world.speciesSeen.entries()].sort((a, b) => (pop.get(b[0]) || 0) - (pop.get(a[0]) || 0));
      let html = `<p class="dim">観測した種 ${rows.length} ・ いま生きている形 ${pop.size}</p>`;
      if (!rows.length) html += '<p class="hint">漂生体に照準を合わせて F（またはクリック）で観測すると、ここに記録される。</p>';
      for (const [key, s] of rows) {
        const n = pop.get(key) || 0;
        html += `<div class="sp ${n ? '' : 'gone'}"><span class="dot" style="background:${hsl(s.th)}"></span><b>${esc(s.name)}</b> <span class="dim">${s.traits.map(esc).join('・')}</span><span class="n">${n ? n + ' 体' : '絶滅'}</span></div>`;
      }
      body.innerHTML = html;
    } else if (this.tab === 'eco') {
      const L = world.life;
      body.innerHTML = `<canvas id="chart" width="560" height="200"></canvas>
        <p class="legend"><span style="color:#7fe">■ 光食</span> <span style="color:#f68">■ 捕食</span> <span style="color:#fd6">■ 形の数</span> <span style="color:#99a">■ 光粒/10</span></p>
        <p>誕生 ${L.births} ・ 死 ${L.deaths} ・ 最大世代 ${L.maxGen} ・ 経過 ${Math.floor(world.time)} 秒</p>
        <p class="dim">この生態系は、あなたがいなくても動き続ける。T キーで時間を速めて、進化を眺めることもできる。</p>`;
      this.drawChart(world);
    } else {
      body.innerHTML = `<p>世界の種: <code>${world.seed}</code></p>
        <p class="dim">同じ種からは同じ世界が生まれる。URL の末尾 <code>#${world.seed}</code> を共有すれば、同じ世界を他の人も歩ける。</p>
        <p><button id="newworld">別の世界へ行く</button></p>
        <h3>操作</h3>
        <p class="keys">クリック: 視点を掴む / 観測　WASD: 移動　Shift: 速く<br>Q / E: 自分の位相（色）を回す　Space: 跳ぶ<br>F: 観測　R: 位相を放つ　Tab: 手帳<br>T: 時間の速さ　M: 音　Esc: 視点を離す</p>`;
      $('newworld').onclick = () => this.state.newWorld();
    }
  }

  drawChart(world) {
    const cv = document.getElementById('chart');
    if (!cv) return;
    const g = cv.getContext('2d');
    const H = world.history;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, 0, cv.width, cv.height);
    if (H.length < 2) return;
    let max = 10;
    for (const h of H) max = Math.max(max, h.g, h.p * 4, h.s * 8, h.m / 10);
    const series = [
      ['g', '#7fe', 1],
      ['p', '#f68', 4],
      ['s', '#fd6', 8],
      ['m', '#99a', 0.1],
    ];
    for (const [k, col, mul] of series) {
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      g.beginPath();
      H.forEach((h, i) => {
        const x = (i / (H.length - 1)) * cv.width;
        const y = cv.height - (h[k] * mul / max) * (cv.height - 10) - 4;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    }
    g.fillStyle = '#889';
    g.font = '11px sans-serif';
    g.fillText('捕食×4・形の数×8 で表示', 6, 14);
  }
}

export { hsl, esc };
