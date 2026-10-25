/* Precipitadores electrostáticos — presentación interactiva */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const TAU = Math.PI * 2;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- Stage scaling ---------------- */
  const stage = $('#stage');
  let scale = 1;
  function fitStage() {
    const vp = document.documentElement;
    scale = Math.min(vp.clientWidth / 1600, vp.clientHeight / 900);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    canvases.forEach(c => c.resize());
  }

  /* ---------------- KaTeX ---------------- */
  function renderTex() {
    if (!window.katex) return;
    $$('[data-tex]').forEach(el => {
      const display = el.classList.contains('tex') || el.id === 'eq24';
      try {
        katex.render(el.dataset.tex, el, { displayMode: display, throwOnError: false, trust: true, strict: 'ignore' });
      } catch (e) { el.textContent = el.dataset.tex; }
    });
  }

  /* ---------------- Canvas helper ---------------- */
  const canvases = [];
  class Surface {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 0; this.h = 0;
      canvases.push(this);
      this.resize();
    }
    resize() {
      const w = this.c.clientWidth, h = this.c.clientHeight;
      if (!w || !h) return;
      const q = Math.min(2, Math.max(1, (devicePixelRatio || 1) * scale));
      this.c.width = Math.round(w * q);
      this.c.height = Math.round(h * q);
      this.ctx.setTransform(q, 0, 0, q, 0, 0);
      const changed = w !== this.w || h !== this.h;
      this.w = w; this.h = h;
      if (changed && this.onResize) this.onResize();
    }
  }

  /* ---------------- Background ---------------- */
  const bg = (() => {
    const c = $('#bg'), ctx = c.getContext('2d');
    let w, h, specks = [];
    function resize() {
      const q = Math.min(2, devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      c.width = w * q; c.height = h * q;
      ctx.setTransform(q, 0, 0, q, 0, 0);
      specks = Array.from({ length: Math.round(w * h / 30000) }, () => ({
        x: rand(0, w), y: rand(0, h), r: rand(.5, 1.6), vx: rand(4, 12), ph: rand(0, TAU), a: rand(.15, .45)
      }));
    }
    function tick(dt) {
      ctx.clearRect(0, 0, w, h);
      for (const d of specks) {
        d.x += d.vx * dt; d.ph += dt * .7;
        if (d.x > w + 5) { d.x = -5; d.y = rand(0, h); }
        ctx.fillStyle = `rgba(201,164,92,${d.a})`;
        ctx.beginPath(); ctx.arc(d.x, d.y + Math.sin(d.ph) * 5, d.r, 0, TAU); ctx.fill();
      }
    }
    addEventListener('resize', resize);
    resize();
    return { tick };
  })();

  /* ---------------- ESP simulation (top view) ---------------- */
  class ESPSim extends Surface {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.ambient = !!opts.ambient;
      this.V = opts.V ?? 45; this.U = opts.U ?? 1; this.Sy = opts.Sy ?? 115;
      this.parts = []; this.stuck = []; this.out = []; this.acc = 0; this.t = 0; this.effT = 0;
      this.onEff = opts.onEff || null;
      this.warm = false;
    }
    geo() {
      const { w, h } = this;
      const x0 = this.ambient ? w * 0.18 : 70;
      const x1 = this.ambient ? w + 10 : w - 50;
      const cy = h / 2;
      const ref = h * (this.ambient ? 0.3 : 0.34);
      const hw = ref * (this.Sy / 115);
      const wires = [];
      for (let i = 0; i < 5; i++) wires.push(x0 + (x1 - x0) * (0.14 + i * 0.18));
      return { x0, x1, cy, ref, hw, wires };
    }
    reset() { this.parts = []; this.stuck = []; this.out = []; }
    spawn(G) {
      this.parts.push({
        x: G.x0 - rand(0, 30), y: G.cy + rand(-.96, .96) * G.hw,
        q: 0, m: rand(.5, 1.5), r: rand(1.2, 2.8), n: rand(0, TAU)
      });
    }
    record(c) {
      this.out.push(c ? 1 : 0);
      if (this.out.length > 260) this.out.shift();
    }
    step(dt) {
      const G = this.geo();
      const L = G.x1 - G.x0, base = L / 2.6;
      const Vn = this.V / 55;
      this.acc += dt * (this.ambient ? 90 : 60) * this.U;
      while (this.acc > 1) { this.acc--; this.spawn(G); }
      const keep = [];
      for (const p of this.parts) {
        const rel = (p.y - G.cy) / G.hw;
        let d = 1e9;
        for (const wx of G.wires) d = Math.min(d, Math.hypot(p.x - wx, p.y - G.cy));
        if (this.V > 0) {
          const k = Vn * (5 * Math.exp(-d / (G.ref * .5)) + .12);
          p.q += k * (1 - p.q) * dt;
        }
        const E = Vn * (115 / this.Sy) * (.45 + .85 * Math.exp(-d / (G.ref * .42)));
        const sg = p.y >= G.cy ? 1 : -1;
        p.n += dt * rand(2, 5);
        const turb = Math.sin(p.n) * G.ref * .12;
        const vx = this.U * base * (1 - .45 * Math.pow(Math.abs(rel), 6)) + Math.cos(p.n * .7) * 6;
        const vy = sg * p.q * p.m * E * G.ref * .56 + turb;
        p.px = p.x; p.py = p.y;
        p.x += vx * dt; p.y += vy * dt;
        if (Math.abs(p.y - G.cy) >= G.hw) {
          if (p.q > 0.06) {
            this.stuck.push({ x: p.x, y: G.cy + sg * (G.hw - rand(0, 3.5)), life: 0, r: p.r });
            this.record(true);
            continue;
          }
          p.y = G.cy + sg * (G.hw - 1);
        }
        if (p.x > G.x1) { this.record(false); continue; }
        keep.push(p);
      }
      this.parts = keep;
      for (const s of this.stuck) s.life += dt;
      this.stuck = this.stuck.filter(s => s.life < 30);
      if (this.stuck.length > 2200) this.stuck.splice(0, this.stuck.length - 2200);
    }
    tick(dt) {
      if (!this.w) return;
      if (!this.warm) { for (let i = 0; i < 150; i++) this.step(1 / 30); this.warm = true; }
      this.t += dt;
      this.step(dt);
      this.draw();
      this.effT += dt;
      if (this.onEff && this.effT > .35) {
        this.effT = 0;
        if (this.out.length > 30) this.onEff(this.out.reduce((a, b) => a + b, 0) / this.out.length);
      }
    }
    draw() {
      const { ctx, w, h, t } = this;
      const G = this.geo();
      const Vn = this.V / 55;
      ctx.clearRect(0, 0, w, h);

      // channel fill
      const gr = ctx.createLinearGradient(0, G.cy - G.hw, 0, G.cy + G.hw);
      gr.addColorStop(0, 'rgba(226,205,152,0.07)');
      gr.addColorStop(.5, `rgba(255,184,77,${0.02 + 0.05 * Vn})`);
      gr.addColorStop(1, 'rgba(226,205,152,0.07)');
      ctx.fillStyle = gr;
      ctx.fillRect(G.x0, G.cy - G.hw, G.x1 - G.x0, G.hw * 2);

      // flow chevrons
      ctx.strokeStyle = 'rgba(201,180,130,0.10)';
      ctx.lineWidth = 1.5;
      const sp = 70, off = (t * 60 * this.U) % sp;
      for (let x = G.x0 + off; x < G.x1; x += sp) {
        for (const fy of [-.55, 0, .55]) {
          const y = G.cy + fy * G.hw;
          ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x, y); ctx.lineTo(x - 6, y + 6); ctx.stroke();
        }
      }

      // plates
      for (const s of [-1, 1]) {
        const y = G.cy + s * G.hw;
        ctx.save();
        ctx.shadowColor = 'rgba(226,205,152,.8)'; ctx.shadowBlur = 14;
        ctx.strokeStyle = '#c9a45c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(G.x0, y); ctx.lineTo(G.x1, y); ctx.stroke();
        ctx.restore();
      }

      // stuck dust
      for (const s of this.stuck) {
        const a = Math.min(1, s.life * 4) * (1 - s.life / 30);
        ctx.fillStyle = `rgba(222,200,150,${a * .85})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * .9, 0, TAU); ctx.fill();
      }

      // field hint lines from wires to plates
      if (this.V > 0) {
        ctx.strokeStyle = `rgba(255,184,77,${0.06 + 0.08 * Vn})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
        ctx.lineDashOffset = -t * 20;
        for (const wx of G.wires) {
          for (const a of [-.6, -.3, 0, .3, .6]) {
            for (const s of [-1, 1]) {
              ctx.beginPath(); ctx.moveTo(wx, G.cy);
              ctx.quadraticCurveTo(wx + a * G.hw * .5, G.cy + s * G.hw * .5, wx + a * G.hw * 1.1, G.cy + s * G.hw);
              ctx.stroke();
            }
          }
        }
        ctx.setLineDash([]);
      }

      // particles
      for (const p of this.parts) {
        const q = clamp(p.q, 0, 1);
        const r = Math.round(lerp(150, 236, q)), g = Math.round(lerp(160, 210, q)), b = Math.round(lerp(150, 150, q));
        ctx.fillStyle = `rgba(${r},${g},${b},${lerp(.55, .95, q)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        if (p.px != null && !this.ambient) {
          ctx.strokeStyle = `rgba(${r},${g},${b},.25)`; ctx.lineWidth = p.r;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (p.x - p.px) * 5, p.y - (p.y - p.py) * 5); ctx.stroke();
        }
      }

      // wires + corona
      for (const wx of G.wires) {
        if (this.V > 0) {
          const R = 14 + 26 * Vn * (1 + .12 * Math.sin(t * 7 + wx));
          const rg = ctx.createRadialGradient(wx, G.cy, 0, wx, G.cy, R);
          rg.addColorStop(0, `rgba(255,200,110,${.55 * Vn + .2})`);
          rg.addColorStop(.4, `rgba(255,150,60,${.22 * Vn})`);
          rg.addColorStop(1, 'rgba(255,140,60,0)');
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(wx, G.cy, R, 0, TAU); ctx.fill();
          // ion sparks
          ctx.fillStyle = 'rgba(255,220,160,.9)';
          for (let i = 0; i < 4; i++) {
            const a = rand(0, TAU), rr = rand(5, R * .9);
            ctx.fillRect(wx + Math.cos(a) * rr, G.cy + Math.sin(a) * rr, 1.4, 1.4);
          }
        }
        ctx.fillStyle = this.V > 0 ? '#ffd08a' : '#5f7d70';
        ctx.beginPath(); ctx.arc(wx, G.cy, 4.5, 0, TAU); ctx.fill();
      }

      if (!this.ambient) {
        ctx.font = '500 12px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(226,205,152,.85)';
        ctx.textAlign = 'left';
        ctx.fillText('PLACA COLECTORA · 0 V', G.x0, G.cy - G.hw - 14);
        ctx.fillText('PLACA COLECTORA · 0 V', G.x0, G.cy + G.hw + 24);
        ctx.fillStyle = 'rgba(255,184,77,.9)';
        ctx.textAlign = 'center';
        ctx.fillText(this.V > 0 ? `ALAMBRES · ${this.V} kV` : 'ALAMBRES · SIN TENSIÓN', G.wires[2], G.cy - 22);
        ctx.fillStyle = 'rgba(201,180,130,.8)';
        ctx.save();
        ctx.translate(G.x0 - 30, G.cy); ctx.rotate(-Math.PI / 2);
        ctx.fillText('ENTRADA →', 0, 0);
        ctx.restore();
        ctx.save();
        ctx.translate(G.x1 + 28, G.cy); ctx.rotate(-Math.PI / 2);
        ctx.fillText('SALIDA →', 0, 0);
        ctx.restore();
        // separation marker
        ctx.strokeStyle = 'rgba(224,190,120,.7)'; ctx.lineWidth = 1;
        const mx = G.x1 - 18;
        ctx.beginPath(); ctx.moveTo(mx, G.cy); ctx.lineTo(mx, G.cy - G.hw); ctx.stroke();
        ctx.fillStyle = 'rgba(224,190,120,.9)'; ctx.textAlign = 'right';
        ctx.fillText(`Sy = ${this.Sy} mm`, mx - 8, G.cy - G.hw / 2);
      }
    }
  }

  /* ---------------- Pipe (problem slide) ---------------- */
  class Pipe extends Surface {
    constructor(c) { super(c); this.p = []; this.acc = 0; this.t = 0; this.flash = []; }
    tick(dt) {
      const { ctx, w, h } = this; if (!w) return;
      this.t += dt;
      const cy = h / 2, ph = h * .34, bx0 = w * .4, bx1 = w * .62;
      this.acc += dt * 70;
      while (this.acc > 1) {
        this.acc--;
        this.p.push({ x: -5, y: cy + rand(-.9, .9) * ph, r: rand(1.2, 3), v: rand(.85, 1.15), cap: Math.random() < .88, dead: false, tone: rand(0, 1) });
      }
      ctx.clearRect(0, 0, w, h);
      // pipe walls
      ctx.strokeStyle = 'rgba(201,180,130,.25)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, cy - ph - 10); ctx.lineTo(w, cy - ph - 10); ctx.moveTo(0, cy + ph + 10); ctx.lineTo(w, cy + ph + 10); ctx.stroke();
      // ESP box
      const bg = ctx.createLinearGradient(bx0, 0, bx1, 0);
      bg.addColorStop(0, 'rgba(226,205,152,.05)'); bg.addColorStop(.5, 'rgba(255,184,77,.10)'); bg.addColorStop(1, 'rgba(226,205,152,.05)');
      ctx.fillStyle = bg;
      ctx.fillRect(bx0, cy - ph - 30, bx1 - bx0, ph * 2 + 60);
      ctx.strokeStyle = 'rgba(226,205,152,.5)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(bx0, cy - ph - 30, bx1 - bx0, ph * 2 + 60);
      for (let i = 0; i < 4; i++) {
        const x = bx0 + (bx1 - bx0) * (.2 + i * .2);
        const a = .4 + .25 * Math.sin(this.t * 6 + i);
        ctx.strokeStyle = `rgba(255,184,77,${a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, cy - ph - 18); ctx.lineTo(x, cy + ph + 18); ctx.stroke();
      }
      // particles
      const sp = w / 4.5;
      const keep = [];
      for (const p of this.p) {
        p.x += sp * p.v * dt;
        if (p.cap && p.x > bx0 + 10 && !p.dead) {
          const toward = p.y > cy ? cy + ph + 26 : cy - ph - 26;
          p.y += (toward - p.y) * dt * 3.2;
          if (Math.abs(toward - p.y) < 6) { p.dead = true; this.flash.push({ x: p.x, y: toward, l: 0 }); continue; }
        }
        if (p.x > w + 5 || p.dead) continue;
        const inBox = p.x > bx0 && p.cap;
        ctx.fillStyle = inBox ? 'rgba(236,214,160,.9)' : (p.tone > .5 ? 'rgba(176,150,120,.85)' : 'rgba(140,140,150,.8)');
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        keep.push(p);
      }
      this.p = keep;
      this.flash = this.flash.filter(f => (f.l += dt) < .5);
      for (const f of this.flash) {
        ctx.fillStyle = `rgba(226,205,152,${.6 * (1 - f.l / .5)})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2 + f.l * 10, 0, TAU); ctx.fill();
      }
      ctx.font = '500 12px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(176,150,120,.95)'; ctx.fillText('GAS CONTAMINADO', w * .18, cy - ph - 30);
      ctx.fillStyle = 'rgba(255,184,77,.95)'; ctx.fillText('PRECIPITADOR', (bx0 + bx1) / 2, cy - ph - 44);
      ctx.fillStyle = 'rgba(239,232,214,.95)'; ctx.fillText('GAS MÁS LIMPIO', w * .82, cy - ph - 30);
    }
  }

  /* ---------------- Mini step animations ---------------- */
  class StepCorona extends Surface {
    constructor(c) { super(c); this.ions = []; this.p = []; this.t = 0; }
    tick(dt) {
      const { ctx, w, h } = this; if (!w) return;
      this.t += dt; const cx = w / 2, cy = h / 2;
      this.ia = (this.ia || 0) + dt * 70;
      for (; this.ia > 1; this.ia--) { const a = rand(0, TAU); this.ions.push({ x: cx, y: cy, vx: Math.cos(a) * rand(40, 90), vy: Math.sin(a) * rand(40, 90), l: 0 }); }
      if (Math.random() < dt * 4) this.p.push({ x: -5, y: cy + rand(-60, 60), q: 0 });
      ctx.clearRect(0, 0, w, h);
      const R = 34 + 5 * Math.sin(this.t * 6);
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.8);
      rg.addColorStop(0, 'rgba(255,200,110,.7)'); rg.addColorStop(.5, 'rgba(255,150,60,.18)'); rg.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, R * 1.8, 0, TAU); ctx.fill();
      this.ions = this.ions.filter(i => (i.l += dt) < 1.4);
      ctx.fillStyle = 'rgba(255,215,150,.9)';
      for (const i of this.ions) { i.x += i.vx * dt; i.y += i.vy * dt; ctx.fillRect(i.x, i.y, 1.6, 1.6); }
      this.p = this.p.filter(p => p.x < w + 10);
      for (const p of this.p) {
        p.x += 45 * dt;
        const d = Math.hypot(p.x - cx, p.y - cy);
        p.q = clamp(p.q + dt * 2.5 * Math.exp(-d / 60), 0, 1);
        ctx.fillStyle = `rgba(${lerp(150, 236, p.q)},${lerp(160, 210, p.q)},${lerp(150, 150, p.q)},.95)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, TAU); ctx.fill();
        if (p.q > .5) { ctx.fillStyle = '#0f2b22'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillText('+', p.x, p.y + 3); }
      }
      ctx.fillStyle = '#ffd08a'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.fill();
    }
  }
  class StepDrift extends Surface {
    constructor(c) { super(c); this.p = []; this.st = []; }
    tick(dt) {
      const { ctx, w, h } = this; if (!w) return;
      const top = 30, bot = h - 30, cy = h / 2;
      if (Math.random() < dt * 9) this.p.push({ x: -5, y: cy + rand(-30, 30), s: Math.random() < .5 ? -1 : 1 });
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#c9a45c'; ctx.lineWidth = 3; ctx.shadowColor = 'rgba(226,205,152,.8)'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(w, top); ctx.moveTo(0, bot); ctx.lineTo(w, bot); ctx.stroke();
      ctx.shadowBlur = 0;
      const keep = [];
      for (const p of this.p) {
        p.x += 60 * dt; p.y += p.s * 42 * dt;
        if (p.y < top + 3 || p.y > bot - 3) { this.st.push({ x: p.x, y: p.y < cy ? top + 3 : bot - 3, l: 0 }); continue; }
        if (p.x < w + 5) keep.push(p);
        ctx.strokeStyle = 'rgba(255,184,77,.6)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + p.s * 14); ctx.stroke();
        ctx.fillStyle = 'rgba(236,214,160,.95)'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, TAU); ctx.fill();
      }
      this.p = keep;
      this.st = this.st.filter(s => (s.l += dt) < 5);
      for (const s of this.st) { ctx.fillStyle = `rgba(222,200,150,${1 - s.l / 5})`; ctx.beginPath(); ctx.arc(s.x, s.y, 2.6, 0, TAU); ctx.fill(); }
      ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(255,184,77,.85)'; ctx.textAlign = 'right';
      ctx.fillText('F = qE', w - 12, cy + 4);
    }
  }
  class StepClean extends Surface {
    constructor(c) { super(c); this.t = 0; this.fall = []; this.layer = 0; }
    tick(dt) {
      const { ctx, w, h } = this; if (!w) return;
      this.t += dt;
      const cyc = this.t % 4, px = w / 2;
      ctx.clearRect(0, 0, w, h);
      let shake = 0;
      if (cyc < 3) this.layer = cyc / 3;
      else {
        shake = Math.sin(cyc * 60) * 3 * (4 - cyc);
        if (this.layer > 0) {
          for (let i = 0; i < 6; i++) this.fall.push({ x: px + rand(-14, 14), y: rand(30, h - 70), vy: rand(20, 60) });
          this.layer = Math.max(0, this.layer - dt * 2);
        }
      }
      // hopper
      ctx.strokeStyle = 'rgba(201,180,130,.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px - 60, h - 44); ctx.lineTo(px - 16, h - 14); ctx.lineTo(px + 16, h - 14); ctx.lineTo(px + 60, h - 44); ctx.stroke();
      // plate
      ctx.fillStyle = '#c9a45c'; ctx.fillRect(px - 3 + shake, 24, 6, h - 80);
      // dust layer
      ctx.fillStyle = 'rgba(176,150,120,.85)';
      const lw = 2 + this.layer * 10;
      ctx.fillRect(px - 3 - lw + shake, 24, lw, h - 80);
      ctx.fillRect(px + 3 + shake, 24, lw, h - 80);
      this.fall = this.fall.filter(f => f.y < h - 18);
      for (const f of this.fall) { f.vy += 300 * dt; f.y += f.vy * dt; ctx.fillRect(f.x, f.y, 2.4, 2.4); }
      if (cyc >= 3) { ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(201,180,130,.9)'; ctx.textAlign = 'left'; ctx.fillText('golpeteo', px + 26, 40); }
    }
  }

  /* ---------------- Potential gradient (eq. 3) ---------------- */
  class GradField extends Surface {
    constructor(c) { super(c); this.img = null; this.dots = []; this.t = 0; }
    onResize() { this.img = null; }
    phi(x, y) {
      const { w, h } = this;
      const cx = w / 2, cy = h / 2;
      const dx = Math.abs(x - cx) / (w / 2);
      const r = Math.hypot(x - cx, (y - cy) * .9) / (w / 2);
      const lin = 1 - dx;
      const rad = 1 - Math.log(1 + 6 * Math.min(r, 1)) / Math.log(7);
      return clamp(.55 * lin + .45 * rad * lin, 0, 1);
    }
    build() {
      const { w, h } = this;
      const off = document.createElement('canvas');
      const s = 3; off.width = Math.ceil(w / s); off.height = Math.ceil(h / s);
      const o = off.getContext('2d'), im = o.createImageData(off.width, off.height);
      for (let j = 0; j < off.height; j++) for (let i = 0; i < off.width; i++) {
        const v = this.phi(i * s, j * s);
        const k = (j * off.width + i) * 4;
        // deep blue -> cyan -> amber
        const r = v < .5 ? lerp(8, 30, v * 2) : lerp(30, 240, (v - .5) * 2);
        const g = v < .5 ? lerp(40, 150, v * 2) : lerp(150, 190, (v - .5) * 2);
        const b = v < .5 ? lerp(30, 105, v * 2) : lerp(105, 80, (v - .5) * 2);
        im.data[k] = r; im.data[k + 1] = g; im.data[k + 2] = b; im.data[k + 3] = 120;
      }
      o.putImageData(im, 0, 0);
      this.img = off;
    }
    tick(dt) {
      const { ctx, w, h } = this; if (!w) return;
      if (!this.img) this.build();
      this.t += dt;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.img, 0, 0, w, h);
      // contour-ish lines
      const cx = w / 2, cy = h / 2;
      // E arrows
      ctx.strokeStyle = 'rgba(234,241,251,.55)'; ctx.fillStyle = 'rgba(234,241,251,.55)'; ctx.lineWidth = 1.2;
      for (let y = 50; y < h - 20; y += 52) for (let x = 30; x < w - 20; x += 52) {
        const e = 2;
        const gx = -(this.phi(x + e, y) - this.phi(x - e, y)), gy = -(this.phi(x, y + e) - this.phi(x, y - e));
        const m = Math.hypot(gx, gy); if (m < 1e-5) continue;
        const L = clamp(m * 900, 6, 20), ux = gx / m, uy = gy / m;
        ctx.beginPath(); ctx.moveTo(x - ux * L / 2, y - uy * L / 2); ctx.lineTo(x + ux * L / 2, y + uy * L / 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + ux * L / 2, y + uy * L / 2);
        ctx.lineTo(x + ux * L / 2 - ux * 5 - uy * 3, y + uy * L / 2 - uy * 5 + ux * 3);
        ctx.lineTo(x + ux * L / 2 - ux * 5 + uy * 3, y + uy * L / 2 - uy * 5 - ux * 3); ctx.fill();
      }
      // moving test charges following E
      if (this.dots.length < 18 && Math.random() < dt * 8) { const a = rand(0, TAU); this.dots.push({ x: cx + Math.cos(a) * 10, y: cy + Math.sin(a) * 10 }); }
      this.dots = this.dots.filter(d => d.x > 4 && d.x < w - 4 && d.y > 4 && d.y < h - 4);
      ctx.fillStyle = '#ffffff';
      for (const d of this.dots) {
        const e = 2;
        const gx = -(this.phi(d.x + e, d.y) - this.phi(d.x - e, d.y)), gy = -(this.phi(d.x, d.y + e) - this.phi(d.x, d.y - e));
        const m = Math.hypot(gx, gy) || 1;
        d.x += gx / m * 70 * dt; d.y += gy / m * 70 * dt;
        ctx.beginPath(); ctx.arc(d.x, d.y, 2.4, 0, TAU); ctx.fill();
      }
      // plates and wire
      ctx.fillStyle = '#c9a45c'; ctx.fillRect(0, 0, 4, h); ctx.fillRect(w - 4, 0, 4, h);
      ctx.fillStyle = '#ffd08a'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, TAU); ctx.fill();
      ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,208,138,.95)'; ctx.fillText('ϕ máx', cx, cy - 16);
      ctx.fillStyle = 'rgba(226,205,152,.95)'; ctx.fillText('0 V', 22, h - 14); ctx.fillText('0 V', w - 22, h - 14);
    }
  }

  /* ---------------- Instances ---------------- */
  const effEl = $('#espEff');
  const sims = {
    cover: new ESPSim($('#coverCanvas'), { ambient: true, V: 55 }),
    outro: new ESPSim($('#outroCanvas'), { ambient: true, V: 45 }),
    esp: new ESPSim($('#espCanvas'), {
      onEff: e => {
        effEl.textContent = Math.round(e * 100) + '%';
        effEl.style.color = e > .6 ? 'var(--green)' : e > .3 ? 'var(--amber)' : 'var(--red)';
      }
    }),
    pipe: new Pipe($('#pipeCanvas')),
    s1: new StepCorona($('#step1')),
    s2: new StepDrift($('#step2')),
    s3: new StepClean($('#step3')),
    grad: new GradField($('#gradCanvas')),
  };

  // ESP controls
  $$('.seg[data-ctrl]').forEach(seg => {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('button', seg).forEach(x => x.classList.toggle('on', x === b));
      const k = seg.dataset.ctrl, v = +b.dataset.v;
      sims.esp[k] = v;
      sims.esp.out = [];
      effEl.textContent = '…';
      if (k === 'V') $('#oV').textContent = v + ' kV';
      if (k === 'U') $('#oU').textContent = v + ' m/s';
      if (k === 'Sy') { $('#oS').textContent = v + ' mm'; sims.esp.reset(); }
    });
  });

  /* ---------------- Slide hooks ---------------- */
  const active = new Set();
  const hooks = {
    cover: { enter() { active.add(sims.cover); }, leave() { active.delete(sims.cover); } },
    outro: { enter() { active.add(sims.outro); }, leave() { active.delete(sims.outro); } },
    esp: { enter() { active.add(sims.esp); }, leave() { active.delete(sims.esp); } },
    pipe: { enter() { active.add(sims.pipe); }, leave() { active.delete(sims.pipe); } },
    steps: {
      enter() { [sims.s1, sims.s2, sims.s3].forEach(s => active.add(s)); },
      leave() { [sims.s1, sims.s2, sims.s3].forEach(s => active.delete(s)); }
    },
    counters: {
      enter(sl) {
        $$('[data-count]', sl).forEach(el => {
          const to = +el.dataset.count, t0 = performance.now() + 450, dur = 1400;
          const f = now => {
            const k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
            el.textContent = Math.round(to * e);
            if (k < 1 && sl.classList.contains('active')) requestAnimationFrame(f);
          };
          el.textContent = '0';
          requestAnimationFrame(f);
        });
      },
      leave() {}
    },
    gloss: (() => {
      let timer = null, i = 0, hover = false;
      const keys = ['eta', 'wp', 'l', 'u', 's'];
      function hl(k) {
        $$('.vk').forEach(v => v.classList.toggle('hl', !!k && v.classList.contains('vk-' + k)));
        $$('.gloss .g').forEach(g => g.classList.toggle('hl', g.dataset.k === k));
      }
      $$('.gloss .g').forEach(g => {
        g.addEventListener('mouseenter', () => { hover = true; hl(g.dataset.k); });
        g.addEventListener('mouseleave', () => { hover = false; });
      });
      return {
        enter() { i = 0; timer = setInterval(() => { if (!hover) hl(keys[i++ % keys.length]); }, 1800); },
        leave() { clearInterval(timer); hl(null); }
      };
    })(),
    calc: { enter() {}, leave() {} },
  };
  // gradient field lives on a slide without data-on; attach by canvas parent
  const gradSlide = $('#gradCanvas').closest('.slide');

  /* ---------------- Calculator (eq. 24) ---------------- */
  (() => {
    const ids = ['sWp', 'sL', 'sU', 'sS'];
    const fmt = { sWp: v => v.toFixed(3) + ' m/s', sL: v => v.toFixed(2) + ' m', sU: v => v.toFixed(2) + ' m/s', sS: v => (v * 1000).toFixed(0) + ' mm' };
    const out = { sWp: '#cWp', sL: '#cL', sU: '#cU', sS: '#cS' };
    const X = x => 40 + x / 5 * 510, Y = e => 180 - e * 160;
    let d = '', a = '';
    for (let i = 0; i <= 100; i++) {
      const x = i / 100 * 5, e = 1 - Math.exp(-x);
      d += (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(e).toFixed(1);
    }
    a = d + ` L${X(5)} 180 L${X(0)} 180 Z`;
    $('#etaCurve').setAttribute('d', d);
    $('#etaArea').setAttribute('d', a);
    let lastK = null, hlTimer = null;
    function update(changed) {
      const v = Object.fromEntries(ids.map(id => [id, +$('#' + id).value]));
      ids.forEach(id => {
        const el = $('#' + id);
        el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
        $(out[id]).textContent = fmt[id](v[id]);
      });
      const x = v.sWp * v.sL / (v.sU * v.sS);
      const eta = 1 - Math.exp(-x);
      $('#cEta').textContent = (eta * 100).toFixed(1) + '%';
      $('#cEta').style.color = eta > .6 ? 'var(--green)' : eta > .3 ? 'var(--amber)' : 'var(--red)';
      $('#cX').textContent = x.toFixed(2);
      const xc = Math.min(x, 5);
      $('#etaDot').setAttribute('cx', X(xc)); $('#etaDot').setAttribute('cy', Y(1 - Math.exp(-xc)));
      const l = $('#etaV'); l.setAttribute('x1', X(xc)); l.setAttribute('x2', X(xc)); l.setAttribute('y1', 180); l.setAttribute('y2', Y(1 - Math.exp(-xc)));
      if (changed) {
        $$('.trend .t').forEach(t => t.classList.toggle('hl', t.dataset.k === changed));
        clearTimeout(hlTimer); hlTimer = setTimeout(() => $$('.trend .t').forEach(t => t.classList.remove('hl')), 1600);
      }
    }
    ids.forEach(id => $('#' + id).addEventListener('input', () => update(id)));
    update();
  })();

  /* ---------------- Navigation ---------------- */
  const slides = $$('.slide');
  const N = slides.length;
  const dotsEl = $('#dots');
  $('#tot').textContent = String(N).padStart(2, '0');
  slides.forEach((_, i) => {
    const b = document.createElement('button');
    b.setAttribute('aria-label', 'Ir a la diapositiva ' + (i + 1));
    b.addEventListener('click', () => go(i));
    dotsEl.appendChild(b);
  });
  let cur = -1;

  function hookFor(sl) {
    return sl.dataset.on ? hooks[sl.dataset.on] : null;
  }
  function go(i, opts = {}) {
    i = clamp(i, 0, N - 1);
    if (i === cur) return;
    const back = i < cur;
    if (cur >= 0) {
      const old = slides[cur];
      old.classList.remove('active');
      old.classList.toggle('prev', !back);
      const h = hookFor(old); if (h) h.leave(old);
      if (old === gradSlide) active.delete(sims.grad);
    }
    const sl = slides[i];
    sl.classList.remove('prev');
    // fragments: hidden when entering forward, all shown when coming back
    $$('[data-frag]', sl).forEach(f => f.classList.toggle('shown', back && !opts.fresh));
    sl.classList.add('active');
    cur = i;
    document.body.dataset.theme = sl.classList.contains('paper') ? 'paper' : 'dark';
    requestAnimationFrame(() => canvases.forEach(c => c.resize()));
    const h = hookFor(sl); if (h) h.enter(sl);
    if (sl === gradSlide) active.add(sims.grad);
    $('#cur').textContent = String(i + 1).padStart(2, '0');
    const sec = $('#secName');
    sec.style.opacity = 0;
    setTimeout(() => { sec.textContent = sl.dataset.section || ''; sec.style.opacity = 1; }, 200);
    $('#progress').style.width = ((i + 1) / N * 100) + '%';
    $$('button', dotsEl).forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); });
    history.replaceState(null, '', '#' + (i + 1));
  }
  function next() {
    const hidden = $$('[data-frag]:not(.shown)', slides[cur]);
    if (hidden.length) { hidden[0].classList.add('shown'); return; }
    go(cur + 1);
    hideHint();
  }
  function prev() { go(cur - 1); hideHint(); }
  let hintHidden = false;
  function hideHint() { if (!hintHidden) { hintHidden = true; $('#hint').style.opacity = 0; } }

  addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input')) {
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
    }
    if (lb.classList.contains('on')) { if (e.key === 'Escape' || e.key === ' ') closeLB(); return; }
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': case 'Enter': e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'PageUp': case 'Backspace': e.preventDefault(); prev(); break;
      case 'Home': go(0); break;
      case 'End': go(N - 1); break;
      case 'f': case 'F': toggleFS(); break;
    }
  });
  $('#nextBtn').addEventListener('click', next);
  $('#prevBtn').addEventListener('click', prev);
  function toggleFS() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  $('#fsBtn').addEventListener('click', toggleFS);

  // touch swipe
  let tx = null, ty = null;
  addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', e => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && !(e.target.matches && e.target.matches('input'))) (dx < 0 ? next : prev)();
    tx = null;
  });

  /* ---------------- Lightbox ---------------- */
  const lb = $('#lightbox');
  $$('.fig .paper').forEach(p => p.addEventListener('click', () => {
    $('img', lb).src = $('img', p).src;
    lb.classList.add('on');
  }));
  function closeLB() { lb.classList.remove('on'); }
  lb.addEventListener('click', closeLB);

  /* ---------------- Main loop ---------------- */
  let last = performance.now(), T = 0;
  function loop(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
    bg.tick(dt, T);
    active.forEach(s => s.tick(dt));
    requestAnimationFrame(loop);
  }

  /* ---------------- Boot ---------------- */
  addEventListener('resize', fitStage);
  if (window.ResizeObserver) new ResizeObserver(fitStage).observe($('#viewport'));
  renderTex();
  fitStage();
  const start = clamp((parseInt(location.hash.slice(1), 10) || 1) - 1, 0, N - 1);
  go(start, { fresh: true });
  addEventListener('hashchange', () => {
    const n = parseInt(location.hash.slice(1), 10);
    if (n) go(n - 1, { fresh: true });
  });
  requestAnimationFrame(loop);
  if (document.fonts) document.fonts.ready.then(() => canvases.forEach(c => c.resize()));
})();
