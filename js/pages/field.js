import { $, $$, esc, toast, download, copy } from '../app.js';
import { FieldView, routeCode, routeSteps } from '../fieldview.js';
import * as P from '../physics.js';

let fv, raf;
export function destroy() { fv?.destroy(); cancelAnimationFrame(raf); }

export function defaultRoute(field, zone = 0) {
  zone = +zone || 0;
  const L = field.zones?.[zone] || { x: 0, y: 0, w: 300, h: 300 };
  const cx = L.x + L.w / 2, onRight = cx > field.width / 2;
  return { zone, start: { x: Math.round(cx), y: Math.round(L.y + Math.min(L.h / 2, 180)), a: onRight ? 180 : 0 }, points: [] };
}

// Execute steps with optional noise; returns pose timeline
export function simulateSteps(start, steps, noise = { turn: 0, straight: 0 }, seed = 5) {
  const R = P.rng(seed); const out = [{ ...start, t: 0 }];
  let { x, y, a } = start, t = 0;
  for (const s of steps) {
    if (s.kind === 'turn') {
      const err = noise.turn ? R.gauss() * noise.turn : 0, total = -s.v + -err, n = Math.max(2, Math.abs(total) / 6);
      for (let i = 1; i <= n; i++) { t += Math.abs(total) / n / 200; out.push({ x, y, a: a + total * i / n, t }); }
      a += total;
    } else if (s.kind === 'straight') {
      const d = s.v * (1 + (noise.straight ? R.gauss() * noise.straight : 0)), n = Math.max(2, Math.abs(d) / 15);
      for (let i = 1; i <= n; i++) { t += Math.abs(d) / n / 400; out.push({ x: x + Math.cos(a * Math.PI / 180) * d * i / n, y: y + Math.sin(a * Math.PI / 180) * d * i / n, a, t }); }
      x += Math.cos(a * Math.PI / 180) * d; y += Math.sin(a * Math.PI / 180) * d;
    } else if (s.kind === 'wait') { t += s.v / 1000; out.push({ x, y, a, t }); }
  }
  return out;
}

export async function render(el, ctx) {
  const field = ctx.comp;
  const programs = (await ctx.store.getPrograms()).filter(p => !p.route || (p.route.comp || 'fll-bioglow') === field.id);
  let prog = programs.find(p => p.route && p.id === sessionStorage.getItem('fllsim.route')) || null;
  let route = prog?.route ? JSON.parse(JSON.stringify(prog.route)) : defaultRoute(field);
  route.comp = field.id;
  let mode = 'add', drag = null; const undo = [];

  el.innerHTML = `
  <div class="row" style="margin-bottom:14px"><h2 style="margin:0">${esc(field.name)} · 1:1</h2><span class="spacer"></span>
    ${ctx.session.kind === 'admin' ? '<a class="btn" href="#/comps">＋ Add / edit fields</a><a class="btn" href="#/rules">📄 Rules</a>' : ''}<select class="in" id="progSel" style="width:auto"></select><button class="btn" id="newProg">+ New run</button><button class="btn primary" id="save">Save run</button></div>
  <div class="card" style="padding:12px">
    <div class="toolbar">
      <button class="btn sm" data-mode="add">＋ Add point</button><button class="btn sm" data-mode="move">✥ Move</button><button class="btn sm" data-mode="start">⌖ Set start</button>
      <button class="btn sm" id="rotL">⟲ start −15°</button><button class="btn sm" id="rotR">⟳ start +15°</button>
      <select class="in" id="side" style="width:auto;padding:5px 8px">${(field.zones.length ? field.zones : [{ name: 'Start' }]).map((z, i) => `<option value="${i}">${esc(z.name)}</option>`).join('')}</select>
      <span class="spacer"></span>
      <button class="btn sm" id="undo">Undo</button><button class="btn sm danger" id="clear">Clear</button>
      <select class="in" id="noiseSel" style="width:auto;padding:5px 8px"><option value="">Perfect robot</option><option value="LQR">With LQR error</option><option value="Gyro">With Gyro error</option><option value="PID">With PID error</option></select>
      <button class="btn sm teal" id="play">▶ Simulate run</button>
    </div>
    <div class="fieldwrap"><canvas id="fc"></canvas></div>
    <div class="small muted" id="hud" style="margin-top:8px">Tap the field to add points. Grid = ${field.grid / 10} cm. Field ${field.width} × ${field.height} mm.</div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Route points <span class="tag" id="len"></span></h3><div class="wplist" id="wps"></div>
      <p class="small muted" style="margin:8px 0 0">“Action” is a line of Python run at that point, e.g. <span class="mono">arm.run_angle(500, 90)</span>. Tick ↩ to drive there backwards.</p></div>
    <div class="card"><h3>Pybricks code <span class="row" style="margin-left:auto"><button class="btn sm" id="cp">Copy</button><button class="btn sm" id="dl">.py</button><button class="btn sm teal" id="toCode">Open in Code →</button></span></h3>
      <pre class="code" id="code"></pre></div>
  </div>`;

  function progOptions() {
    $('#progSel').innerHTML = `<option value="">${prog ? '' : '• '}Unsaved run</option>` + programs.filter(p => p.route).map(p => `<option value="${p.id}" ${prog?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }
  progOptions();
  $('#side').value = route.zone ?? 0;

  fv = new FieldView($('#fc'), {
    field, robot: ctx.robot,
    onPointer(kind, pt, e, down) {
      pt.x = Math.max(0, Math.min(field.width, pt.x)); pt.y = Math.max(0, Math.min(field.height, pt.y));
      if (kind === 'move') $('#hud').textContent = `x ${pt.x.toFixed(0)} mm · y ${pt.y.toFixed(0)} mm`;
      if (kind === 'down') {
        snapshot();
        if (mode === 'add') { route.points.push({ x: Math.round(pt.x), y: Math.round(pt.y), action: '', rev: false }); update(); }
        else if (mode === 'start') { route.start.x = Math.round(pt.x); route.start.y = Math.round(pt.y); update(); drag = 'start'; }
        else {
          const all = [route.start, ...route.points];
          let best = null, bd = 60;
          all.forEach((p, i) => { const d = Math.hypot(p.x - pt.x, p.y - pt.y); if (d < bd) { bd = d; best = i; } });
          drag = best;
        }
      }
      if (kind === 'move' && down && drag != null) {
        const p = drag === 'start' || drag === 0 ? route.start : route.points[drag - 1];
        p.x = Math.round(pt.x); p.y = Math.round(pt.y); update(false);
      }
      if (kind === 'up') { drag = null; update(); }
    },
  });
  fv.route = route;

  function snapshot() { undo.push(JSON.stringify(route)); if (undo.length > 60) undo.shift(); }
  function setMode(m) { mode = m; $$('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); }
  setMode('add');
  $$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  function update(full = true) {
    fv.route = route; fv.poses = []; fv.trail = []; fv.draw();
    const name = prog?.name || 'Unsaved run';
    $('#code').textContent = routeCode(route, ctx.robot, name);
    const steps = routeSteps(route);
    const dist = steps.filter(s => s.kind === 'straight').reduce((a, s) => a + Math.abs(s.v), 0);
    $('#len').textContent = `${route.points.length} pts · ${(dist / 1000).toFixed(2)} m`;
    if (!full) return;
    $('#wps').innerHTML = route.points.map((p, i) => `<div class="wp"><span class="n">${String(i + 1).padStart(2, '0')}</span>
      <div class="grid" style="grid-template-columns:62px 62px 1fr;gap:4px"><input data-i="${i}" data-k="x" value="${p.x}"><input data-i="${i}" data-k="y" value="${p.y}"><input data-i="${i}" data-k="action" placeholder="action (python)" value="${esc(p.action || '')}"></div>
      <div class="row" style="gap:4px"><label title="drive backwards" class="small"><input type="checkbox" data-i="${i}" data-k="rev" ${p.rev ? 'checked' : ''}>↩</label><button class="btn sm" data-del="${i}">✕</button></div></div>`).join('') || '<p class="small muted">No points yet.</p>';
    $$('#wps input').forEach(inp => inp.onchange = () => {
      const p = route.points[+inp.dataset.i]; snapshot();
      if (inp.dataset.k === 'rev') p.rev = inp.checked; else if (inp.dataset.k === 'action') p.action = inp.value; else p[inp.dataset.k] = +inp.value;
      update();
    });
    $$('#wps [data-del]').forEach(b => b.onclick = () => { snapshot(); route.points.splice(+b.dataset.del, 1); update(); });
  }
  update();

  $('#rotL').onclick = () => { snapshot(); route.start.a = (route.start.a + 15) % 360; update(); };
  $('#rotR').onclick = () => { snapshot(); route.start.a = (route.start.a - 15 + 360) % 360; update(); };
  $('#side').onchange = () => { snapshot(); const r = defaultRoute(field, $('#side').value); route.zone = r.zone; route.start = r.start; update(); };
  $('#undo').onclick = () => { if (undo.length) { route = JSON.parse(undo.pop()); update(); } };
  $('#clear').onclick = () => { snapshot(); route.points = []; update(); };
  $('#cp').onclick = () => copy($('#code').textContent);
  $('#dl').onclick = () => download((prog?.name || 'run').replace(/\W+/g, '_') + '.py', $('#code').textContent);

  $('#play').onclick = () => {
    cancelAnimationFrame(raf);
    const k = $('#noiseSel').value;
    let noise = { turn: 0, straight: 0 };
    if (k) {
      const plant = P.plantFromRobot(ctx.robot), gains = ctx.build.gains || {};
      const mk = { LQR: () => P.makeLQR(P.designLQR(plant, gains.lqrQ), plant), PID: () => P.makePID({ kp: 0.02, ki: 0, kd: 0.001, tol: 1, ...(gains.pid || {}) }), Gyro: () => P.makeGyro(gains.gyro || {}, plant) }[k];
      const r = P.runTurnTest(mk, plant, 21);
      noise = { turn: Math.sqrt(r.results.reduce((s, x) => s + x.error ** 2, 0) / r.results.length), straight: 0.004 };
    }
    const tl = simulateSteps(route.start, routeSteps(route), noise, Math.floor(Math.random() * 1e6));
    const ideal = simulateSteps(route.start, routeSteps(route));
    const t0 = performance.now(), end = tl.at(-1).t;
    const step = now => {
      const t = (now - t0) / 1000 * 1.5;
      const i = tl.findIndex(p => p.t > t), idx = i === -1 ? tl.length - 1 : Math.max(0, i - 1);
      fv.trail = tl.slice(0, idx + 1); fv.poses = [tl[idx]]; fv.draw();
      if (t < end) raf = requestAnimationFrame(step);
      else {
        const a = tl.at(-1), b = ideal.at(-1);
        $('#hud').innerHTML = k ? `Finished: off target by <b>${Math.hypot(a.x - b.x, a.y - b.y).toFixed(0)} mm</b> and <b>${Math.abs(((a.a - b.a + 540) % 360) - 180).toFixed(1)}°</b> with ${k} turn error (σ ${noise.turn.toFixed(2)}°/turn). Run again: every run is different.` : `Finished in ${end.toFixed(1)} s (ideal robot).`;
      }
    };
    raf = requestAnimationFrame(step);
  };

  $('#progSel').onchange = () => {
    const p = programs.find(p => p.id === $('#progSel').value);
    prog = p || null; sessionStorage.setItem('fllsim.route', p?.id || '');
    route = p?.route ? JSON.parse(JSON.stringify(p.route)) : defaultRoute(field); $('#side').value = route.zone ?? 0; update();
  };
  $('#newProg').onclick = () => { prog = null; sessionStorage.removeItem('fllsim.route'); route = defaultRoute(field, $('#side').value); progOptions(); update(); };
  async function save() {
    const name = prog?.name || prompt('Name this run', `Run ${programs.filter(p => p.route).length + 1}`);
    if (!name) return null;
    try {
      route.comp = field.id;
      const saved = await ctx.store.saveProgram({ ...(prog || {}), name, route, code: routeCode(route, ctx.robot, name) });
      prog = saved; const i = programs.findIndex(p => p.id === saved.id); if (i >= 0) programs[i] = saved; else programs.push(saved);
      sessionStorage.setItem('fllsim.route', saved.id); progOptions(); update(); toast('Run saved');
      return saved;
    } catch (e) { toast(e.message, 4000); return null; }
  }
  $('#save').onclick = save;
  $('#toCode').onclick = async () => { const s = await save(); if (s) { sessionStorage.setItem('fllsim.prog', s.id); ctx.go('code'); } };
}
