import { $, $$, esc, toast, download, copy } from '../app.js';
import * as O from '../omni.js';
import { rng } from '../physics.js';

const COL = { LQR: '#ffb020', PID: '#f472b6' };
let raf = 0, cleanups = [], replayToken = null;
export function destroy() { cancelAnimationFrame(raf); cleanups.forEach(f => f()); cleanups = []; }
const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); cleanups.push(() => t.removeEventListener(ev, fn, opt)); };
const rad = d => d * Math.PI / 180;

export async function render(el, ctx) {
  const build = ctx.build;
  const o = build.omni = { ...O.defaultOmni(), ...(build.omni || {}) };
  o.pid = { ...O.defaultOmni().pid, ...o.pid }; o.lqrQ = { ...O.defaultOmni().lqrQ, ...o.lqrQ };
  build.soccer ||= { L: 2450, W: 1550, goal: 300, retW: 170, retD: 50, reach: 30, level: 'medium', ctrl: 'LQR', autoLock: true };
  const S = build.soccer;
  const save = () => ctx.saveBuild(build);
  let tab = sessionStorage.getItem('fllsim.soccerTab') || 'lab';

  el.innerHTML = `
  <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Soccer</h2>
    <div class="proglist" style="margin-left:10px"><button class="btn sm" data-t="lab">Heading lab</button><button class="btn sm" data-t="joy">Joystick → degree</button><button class="btn sm" data-t="match">Soccer sim</button></div></div>
  <div class="grid side">
    <div class="card" style="align-self:start"><h3>Omni robot</h3>
      <label class="f">Drive</label><select class="in" id="cfg">${Object.entries(O.CONFIGS).map(([k, c]) => `<option value="${k}">${c.name}</option>`).join('')}</select>
      <canvas id="robotPic" width="260" height="200" style="width:100%;margin-top:8px;background:var(--bg);border-radius:10px"></canvas>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
        <div><label class="f">Wheel Ø mm</label><input class="in mono" data-o="wheelD" type="number" value="${o.wheelD}"></div>
        <div><label class="f">Centre→wheel mm</label><input class="in mono" data-o="radius" type="number" value="${o.radius}"></div>
        <div><label class="f">Motor °/s</label><input class="in mono" data-o="motorMax" type="number" value="${o.motorMax}"></div>
        <div><label class="f">Mass kg</label><input class="in mono" data-o="mass" type="number" step="0.05" value="${o.mass}"></div>
        <div><label class="f">Deadzone %</label><input class="in mono" data-o="deadzone" type="number" value="${o.deadzone}"></div>
      </div>
      <label class="small" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px"><input type="checkbox" id="rotP" ${o.rotPriority ? 'checked' : ''}> Rotation priority (keep facing even at full speed)</label>
      <label class="small" style="display:flex;gap:8px;align-items:flex-start;margin-top:6px"><input type="checkbox" id="fieldRel" ${o.fieldRelative ? 'checked' : ''}> Field-relative driving (stick up = toward goal)</label>
      <div id="portsBox"></div>
      <div class="kv small" id="omniKv" style="margin-top:10px"></div>
    </div>
    <div id="pane"></div>
  </div>`;

  function robotPic() {
    const c = $('#robotPic'), x = c.getContext('2d'), W = c.width, H = c.height, cx = W / 2, cy = H / 2 + 6;
    x.clearRect(0, 0, W, H);
    x.strokeStyle = '#2f3c52'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, 62, 0, 7); x.stroke();
    x.fillStyle = '#ffb020'; x.beginPath(); x.moveTo(cx, cy - 80); x.lineTo(cx - 9, cy - 66); x.lineTo(cx + 9, cy - 66); x.fill();
    x.font = '11px ui-monospace, monospace'; x.textAlign = 'center';
    const C = O.CONFIGS[o.config];
    C.wheels.forEach((p, i) => {
      const px = cx + Math.sin(rad(p)) * 62, py = cy - Math.cos(rad(p)) * 62;
      x.save(); x.translate(px, py); x.rotate(rad(p)); x.fillStyle = '#374151'; x.strokeStyle = '#8b98ab'; x.fillRect(-14, -6, 28, 12); x.strokeRect(-14, -6, 28, 12); x.restore();
      x.fillStyle = '#e7ecf3'; x.fillText(`${C.labels[i]} ${o.ports[i] || ''}`, cx + Math.sin(rad(p)) * 90, cy - Math.cos(rad(p)) * 88 + 4);
    });
    x.fillStyle = '#8b98ab'; x.fillText('front', cx, 12);
  }
  function portsUI() {
    const C = O.CONFIGS[o.config];
    $('#portsBox').innerHTML = `<label class="f">Motor ports & directions</label><div class="grid" style="grid-template-columns:auto 1fr 1fr;gap:6px;align-items:center">` +
      C.wheels.map((_, i) => `<span class="mono small">${C.labels[i]}</span><select class="in" data-port="${i}">${'ABCDEF'.split('').map(p => `<option ${o.ports[i] === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <select class="in" data-dir="${i}"><option ${o.dirs[i] !== 'COUNTERCLOCKWISE' ? 'selected' : ''}>CLOCKWISE</option><option ${o.dirs[i] === 'COUNTERCLOCKWISE' ? 'selected' : ''}>COUNTERCLOCKWISE</option></select>`).join('') + '</div>';
    $$('[data-port]').forEach(s => s.onchange = () => { o.ports[+s.dataset.port] = s.value; save(); robotPic(); });
    $$('[data-dir]').forEach(s => s.onchange = () => { o.dirs[+s.dataset.dir] = s.value; save(); });
  }
  function kv() {
    const P = O.omniPlant(o);
    $('#omniKv').innerHTML = [['Top speed forward', (P.wheelSpeed * O.maxSpeedAt(o.config, 0) / 1000).toFixed(2) + ' m/s'], ['Top speed sideways', (P.wheelSpeed * O.maxSpeedAt(o.config, 90) / 1000).toFixed(2) + ' m/s'],
      ['Max spin', P.maxRate.toFixed(0) + ' °/s'], ['Time constant', (P.tau * 1000).toFixed(0) + ' ms']].map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
  }
  $('#cfg').value = o.config;
  $('#cfg').onchange = () => { o.config = $('#cfg').value; save(); robotPic(); portsUI(); kv(); show(); };
  $$('[data-o]').forEach(i => i.onchange = () => { o[i.dataset.o] = +i.value; save(); kv(); });
  $('#rotP').onchange = e => { o.rotPriority = e.target.checked; save(); };
  $('#fieldRel').onchange = e => { o.fieldRelative = e.target.checked; save(); };
  robotPic(); portsUI(); kv();

  function show() {
    cancelAnimationFrame(raf); cleanups.forEach(f => f()); cleanups = [];
    $$('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    sessionStorage.setItem('fllsim.soccerTab', tab);
    ({ lab: labPane, joy: joyPane, match: matchPane })[tab]();
  }
  $$('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; show(); });

  // ================= HEADING LAB =================
  function labPane() {
    let lqr = O.lqrForOmni(o), res = null;
    $('#pane').innerHTML = `<div class="grid" style="align-content:start">
      <div class="card"><div class="row"><h3 style="margin:0">Always face forward: LQR vs PID</h3><span class="spacer"></span>
        <select class="in" id="mode" style="width:auto"><option value="fwd">Face forward (0°)</option><option value="lock">Goal lock</option></select>
        <button class="btn primary" id="run">▶ Run test</button><button class="btn" id="tune">⚙ Auto-tune</button></div>
        <p class="small muted" style="margin:8px 0 0">12 s of random joystick moves in 8 directions plus 5 bumps (ball hits and opponent pushes). Each wheel has ±4% motor mismatch, which twists the robot while it drives. Both controllers get exactly the same moves and bumps.</p></div>
      <div class="grid g2">
        ${['LQR', 'PID'].map(k => `<div class="card ctrl-col" style="--c:${COL[k]}"><h3 style="color:${COL[k]}">${k}<span class="tag" id="m-${k}">—</span></h3>
          <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:6px">${k === 'LQR'
            ? `<div><label class="f">Q angle</label><input class="in mono" data-g="lqrQ.qAngle" value="${+o.lqrQ.qAngle.toPrecision(4)}"></div><div><label class="f">Q integral</label><input class="in mono" data-g="lqrQ.qInt" value="${+o.lqrQ.qInt.toPrecision(4)}"></div><div class="small muted mono" id="kq" style="align-self:end"></div>`
            : `<div><label class="f">Kp</label><input class="in mono" data-g="pid.kp" value="${+o.pid.kp.toPrecision(4)}"></div><div><label class="f">Ki</label><input class="in mono" data-g="pid.ki" value="${+o.pid.ki.toPrecision(4)}"></div><div><label class="f">Kd</label><input class="in mono" data-g="pid.kd" value="${+o.pid.kd.toPrecision(4)}"></div>`}</div>
          <div class="kv small" id="r-${k}" style="margin-top:10px"></div>
          <div class="row" style="margin-top:10px"><button class="btn sm" data-cp="${k}">Copy Pybricks code</button><button class="btn sm" data-dl="${k}">.py</button></div></div>`).join('')}
      </div>
      <div class="card"><h3>Heading error <span class="tag">° vs time</span></h3><canvas class="chart" id="chart"></canvas>
        <p class="small muted" style="margin:6px 0 0">Dashed: ±2°. Grey ticks: bumps.</p></div>
      <div class="card"><h3>Replay <span class="tag">2× speed</span></h3><canvas id="replay" style="width:100%;display:block;background:#0f2a1f;border-radius:10px"></canvas></div>
    </div>`;
    const showK = () => { $('#kq').textContent = `K=[${lqr.k1.toFixed(2)}, ${lqr.k2.toFixed(3)}, ${lqr.k3.toFixed(2)}]`; };
    showK();
    $$('[data-g]').forEach(i => i.onchange = () => { const [a, b] = i.dataset.g.split('.'); o[a][b] = +i.value; lqr = O.lqrForOmni(o); showK(); save(); });
    const code = k => O.omniCode(o, k);
    $$('[data-cp]').forEach(b => b.onclick = () => copy(code(b.dataset.cp)));
    $$('[data-dl]').forEach(b => b.onclick = () => download(`omni_${o.config}_${b.dataset.dl.toLowerCase()}.py`, code(b.dataset.dl)));

    function run() {
      const P = O.omniPlant(o), goalLock = $('#mode').value === 'lock';
      res = { LQR: O.headingTest(o, O.holdLQR(lqr, P), { goalLock }), PID: O.headingTest(o, O.holdPID(o.pid), { goalLock }) };
      for (const k of ['LQR', 'PID']) {
        const r = res[k];
        $('#m-' + k).textContent = `RMS ${r.rms.toFixed(2)}°`;
        $('#r-' + k).innerHTML = [['RMS error', r.rms.toFixed(2) + '°'], ['Worst error', r.max.toFixed(1) + '°'], ['Time within ±2°', (r.inBand * 100).toFixed(0) + '%']].map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
      }
      chart(); replay();
    }
    function chart() {
      const c = $('#chart'), dpr = devicePixelRatio || 1; c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
      const x = c.getContext('2d'); x.scale(dpr, dpr); const W = c.clientWidth, H = c.clientHeight, pad = 40;
      const T = 12, eMax = Math.max(4, Math.min(30, Math.max(res.LQR.max, res.PID.max)));
      const sx = t => pad + (W - pad - 6) * t / T, sy = e => H / 2 - (H / 2 - 10) * Math.max(-1, Math.min(1, e / eMax));
      x.strokeStyle = '#253042'; x.beginPath(); x.moveTo(pad, H / 2); x.lineTo(W, H / 2); x.stroke();
      x.setLineDash([4, 4]); [2, -2].forEach(v => { x.beginPath(); x.moveTo(pad, sy(v)); x.lineTo(W, sy(v)); x.stroke(); }); x.setLineDash([]);
      x.fillStyle = '#8b98ab'; x.font = '11px ui-monospace, monospace'; x.textAlign = 'right';
      x.fillText('+' + eMax.toFixed(0) + '°', pad - 4, 14); x.fillText('−' + eMax.toFixed(0) + '°', pad - 4, H - 4); x.textAlign = 'left'; x.fillText('12 s', W - 34, H - 4);
      x.strokeStyle = '#4b5a70'; res.LQR.pushes.forEach(p => { x.beginPath(); x.moveTo(sx(p.t), 0); x.lineTo(sx(p.t), 8); x.stroke(); });
      for (const k of ['PID', 'LQR']) { x.strokeStyle = COL[k]; x.lineWidth = 1.6; x.beginPath(); res[k].trace.forEach((p, i) => i ? x.lineTo(sx(p.t), sy(p.e)) : x.moveTo(sx(p.t), sy(p.e))); x.stroke(); }
    }
    function replay() {
      const c = $('#replay'), dpr = devicePixelRatio || 1, Wm = 2450, Hm = 1550;
      const w = c.clientWidth; c.style.height = (w * Hm / Wm) + 'px'; c.width = w * dpr; c.height = w * Hm / Wm * dpr;
      const x = c.getContext('2d'), s = c.width / Wm, start = performance.now(), token = {};
      replayToken = token; cancelAnimationFrame(raf);
      const step = now => {
        if (replayToken !== token || !document.body.contains(c)) return;
        const t = (now - start) / 1000 * 2;
        x.clearRect(0, 0, c.width, c.height);
        x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = 2 * dpr; x.strokeRect(0, 0, c.width, c.height);
        x.fillStyle = '#60a5fa'; x.fillRect((Wm / 2 - 150) * s, 0, 300 * s, 8 * dpr);
        for (const k of ['PID', 'LQR']) {
          const tr = res[k].trace, i = Math.max(0, Math.min(tr.length - 1, Math.floor(t / 0.01))), p = tr[i];
          x.strokeStyle = COL[k] + '66'; x.lineWidth = 1.5 * dpr; x.beginPath();
          for (let j = Math.max(0, i - 200); j <= i; j += 4) { const q = tr[j]; j === Math.max(0, i - 200) ? x.moveTo(q.x * s, (Hm - q.y) * s) : x.lineTo(q.x * s, (Hm - q.y) * s); } x.stroke();
          drawBot(x, p.x * s, (Hm - p.y) * s, p.h, 95 * s, COL[k], p.target, dpr);
          x.fillStyle = COL[k]; x.font = `600 ${12 * dpr}px ui-monospace, monospace`; x.textAlign = 'left';
          x.fillText(`${k} ${p.e >= 0 ? '+' : ''}${p.e.toFixed(1)}°`, 10 * dpr, (k === 'LQR' ? 22 : 40) * dpr);
        }
        if (t < 12) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    $('#run').onclick = run;
    $('#mode').onchange = run;
    $('#tune').onclick = async () => {
      const b = $('#tune'); b.disabled = true; b.textContent = 'Tuning…'; await new Promise(r => setTimeout(r, 30));
      const r = O.autoTuneOmni(o, $('#mode').value === 'lock'); Object.assign(o.lqrQ, r.lqrQ); Object.assign(o.pid, r.pid);
      lqr = O.lqrForOmni(o); save();
      $$('[data-g]').forEach(i => { const [a, k] = i.dataset.g.split('.'); i.value = +o[a][k].toPrecision(4); }); showK();
      b.disabled = false; b.textContent = '⚙ Auto-tune'; toast('Both controllers tuned for your robot'); run();
    };
    run();
  }

  // ================= JOYSTICK → DEGREE =================
  function stickState() { return { x: 0, y: 0, src: 'touch' }; }
  function makeStick(canvas, st, label = '') {
    const draw = () => {
      const c = canvas, dpr = devicePixelRatio || 1, w = c.clientWidth; c.width = w * dpr; c.height = w * dpr;
      const x = c.getContext('2d'), R = c.width / 2;
      x.clearRect(0, 0, c.width, c.height);
      x.fillStyle = '#0a0e14'; x.beginPath(); x.arc(R, R, R - 2, 0, 7); x.fill();
      x.strokeStyle = '#2f3c52'; x.lineWidth = 2 * dpr; x.stroke();
      x.beginPath(); x.arc(R, R, (R - 2) * o.deadzone / 100, 0, 7); x.stroke();
      [0, 90, 180, 270].forEach(a => { x.fillStyle = '#4b5a70'; x.font = `${11 * dpr}px ui-monospace,monospace`; x.textAlign = 'center'; x.fillText(a + '°', R + Math.sin(rad(a)) * (R - 14 * dpr), R - Math.cos(rad(a)) * (R - 14 * dpr) + 4 * dpr); });
      const kx = R + st.x / 100 * (R - 22 * dpr), ky = R - st.y / 100 * (R - 22 * dpr);
      x.strokeStyle = '#ffb020'; x.beginPath(); x.moveTo(R, R); x.lineTo(kx, ky); x.stroke();
      x.fillStyle = '#ffb020'; x.beginPath(); x.arc(kx, ky, 18 * dpr, 0, 7); x.fill();
      if (label) { x.fillStyle = '#8b98ab'; x.fillText(label, R, c.height - 6 * dpr); }
    };
    let active = false;
    const set = e => { const r = canvas.getBoundingClientRect(), R = r.width / 2; let dx = (e.clientX - r.left - R) / (R - 22), dy = -(e.clientY - r.top - R) / (R - 22); const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } st.x = dx * 100; st.y = dy * 100; st.src = 'touch'; };
    on(canvas, 'pointerdown', e => { active = true; canvas.setPointerCapture(e.pointerId); set(e); e.preventDefault(); });
    on(canvas, 'pointermove', e => { if (active) set(e); });
    on(canvas, 'pointerup', () => { active = false; st.x = 0; st.y = 0; });
    canvas.style.touchAction = 'none';
    return draw;
  }
  function readInputs(st, keys) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads[0];
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.08) { st.x = ax * 100; st.y = -ay * 100; st.src = 'gamepad'; }
      else if (st.src === 'gamepad') { st.x = 0; st.y = 0; }
    }
    if (keys) {
      const kx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      const ky = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      if (kx || ky) { const m = Math.hypot(kx, ky); st.x = kx / m * 100; st.y = ky / m * 100; st.src = 'keys'; }
      else if (st.src === 'keys') { st.x = 0; st.y = 0; }
    }
    return gp;
  }
  function joy2deg(st) {
    const mag = Math.min(100, Math.hypot(st.x, st.y));
    if (mag < o.deadzone) return { dir: 0, speed: 0, mag };
    return { dir: ((Math.atan2(st.x, st.y) * 180 / Math.PI) + 360) % 360, speed: Math.min(1, (mag - o.deadzone) / (100 - o.deadzone)), mag };
  }

  function joyPane() {
    const st = stickState(); let heading = 0;
    $('#pane').innerHTML = `<div class="grid g2" style="align-content:start">
      <div class="card"><h3>Joystick <span class="tag" id="src">touch / mouse</span></h3>
        <canvas id="stick" style="width:100%;max-width:340px;display:block;margin:0 auto"></canvas>
        <p class="small muted">Drag the stick. A connected USB/Bluetooth gamepad also works (left stick), and so do the WASD / arrow keys.</p></div>
      <div class="grid" style="align-content:start">
        <div class="card"><h3>Reading</h3><div class="kv" id="jr"></div>
          <label class="f">Robot heading now (for field-relative): <span id="hv">0°</span></label><input type="range" id="hd" min="-180" max="180" value="0" style="width:100%"></div>
        <div class="card"><h3>Wheel power</h3><div id="wb"></div><canvas id="jbot" style="width:100%;height:180px;display:block;margin-top:8px"></canvas></div>
      </div>
      <div class="card" style="grid-column:1/-1"><h3>Pybricks: joystick → degree <button class="btn sm" id="cpj" style="margin-left:auto">Copy</button></h3><pre class="code" id="jcode"></pre></div>
    </div>`;
    const jc = `from umath import atan2, degrees

DEADZONE = ${o.deadzone}  # percent

def joystick_to_degree(x, y):
    """x, y from -100 to 100 (right, up). Returns (degrees, speed 0..1).
    0 = forward, 90 = right, 180 = back, 270 = left."""
    mag = (x * x + y * y) ** 0.5
    if mag < DEADZONE:
        return 0, 0
    deg = degrees(atan2(x, y)) % 360
    speed = min(1, (mag - DEADZONE) / (100 - DEADZONE))
    return deg, speed

# field-relative: robot direction = joystick degree - heading
# robot_dir = (deg - hub.imu.heading()) % 360
`;
    $('#jcode').textContent = jc; $('#cpj').onclick = () => copy(jc);
    const draw = makeStick($('#stick'), st);
    $('#hd').oninput = () => { heading = +$('#hd').value; $('#hv').textContent = heading + '°'; };
    const keys = new Set();
    on(window, 'keydown', e => keys.add(e.key.toLowerCase())); on(window, 'keyup', e => keys.delete(e.key.toLowerCase()));
    const loop = () => {
      const gp = readInputs(st, keys);
      $('#src').textContent = st.src === 'gamepad' ? 'gamepad: ' + (gp?.id || '').slice(0, 24) : st.src;
      draw();
      const j = joy2deg(st);
      const rel = o.fieldRelative ? ((j.dir - heading) % 360 + 360) % 360 : j.dir;
      const P = O.omniPlant(o);
      const duties = O.wheelDuties(o.config, rel, j.speed, 0, o.rotPriority);
      $('#jr').innerHTML = [['x, y', `${st.x.toFixed(0)}, ${st.y.toFixed(0)}`], ['Stick angle', j.speed ? j.dir.toFixed(1) + '°' : '—'], ['Stick distance', j.mag.toFixed(0) + '%'],
        ['Speed after deadzone', (j.speed * 100).toFixed(0) + '%'], ['Robot-relative angle', j.speed ? rel.toFixed(1) + '°' : '—'],
        ['Ground speed', (j.speed * P.wheelSpeed * O.maxSpeedAt(o.config, rel) / 1000).toFixed(2) + ' m/s']].map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
      const C = O.CONFIGS[o.config];
      $('#wb').innerHTML = duties.map((d, i) => `<div class="bar" style="display:grid;grid-template-columns:56px 1fr 56px;gap:8px;align-items:center;margin:6px 0;font:13px var(--mono)">
        <span>${C.labels[i]} ${o.ports[i]}</span><div style="height:10px;background:var(--bg);border-radius:9px;position:relative"><div style="position:absolute;top:0;bottom:0;left:${50 + Math.min(0, d) * 50}%;width:${Math.abs(d) * 50}%;background:${d >= 0 ? 'var(--accent2)' : 'var(--pid)'};border-radius:9px"></div><div style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:#4b5a70"></div></div><span style="text-align:right">${(d * 100).toFixed(0)}%</span></div>`).join('');
      // robot drawing with motion arrow
      const c = $('#jbot'), dpr = devicePixelRatio || 1; c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
      const x = c.getContext('2d'), cx = c.width / 2, cy = c.height / 2;
      drawBot(x, cx, cy, heading, 55 * dpr, '#ffb020', null, dpr, o.config, duties);
      if (j.speed) { const fa = rad(j.dir); x.strokeStyle = '#2dd4bf'; x.lineWidth = 4 * dpr; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.sin(fa) * 80 * dpr * j.speed, cy - Math.cos(fa) * 80 * dpr * j.speed); x.stroke(); }
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  // ================= SOCCER MATCH =================
  function matchPane() {
    $('#pane').innerHTML = `<div class="grid" style="align-content:start">
      <div class="card" style="padding:12px"><div class="row toolbar" style="margin:0">
        <span class="mono" id="score" style="font-size:20px;font-weight:700">0 : 0</span><span class="mono muted" id="clock">0:00</span><span class="spacer"></span>
        <select class="in" id="ctrlSel" style="width:auto;padding:5px 8px"><option>LQR</option><option>PID</option></select>
        <select class="in" id="lvl" style="width:auto;padding:5px 8px"><option value="off">No opponents</option><option value="easy">Easy bots</option><option value="medium">Medium bots</option><option value="hard">Hard bots</option></select>
        <label class="small row"><input type="checkbox" id="lock" ${S.autoLock ? 'checked' : ''}> Goal lock when ball held</label>
        <button class="btn sm" id="reset">Reset</button><button class="btn sm" id="setBtn">Field…</button></div>
        <div id="setBox" class="hide grid" style="grid-template-columns:repeat(6,1fr);gap:6px;margin-top:8px">
          ${[['L', 'Length mm'], ['W', 'Width mm'], ['goal', 'Goal mm'], ['retW', 'Retriever W'], ['retD', 'Retriever D'], ['reach', 'Dribbler reach']].map(([k, l]) => `<div><label class="f">${l}</label><input class="in mono" data-s="${k}" value="${S[k]}"></div>`).join('')}</div></div>
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 220px;gap:12px" id="mgrid">
        <canvas id="pitch" style="width:100%;display:block;border-radius:12px;background:#14532d;touch-action:none"></canvas>
        <div class="grid" style="align-content:start;gap:10px">
          <canvas id="mstick" style="width:100%;display:block"></canvas>
          <button class="btn primary" id="kick" style="justify-content:center;height:56px;font-size:18px">⚽ KICK</button>
          <div class="kv small" id="tele"></div>
          <p class="small muted" style="margin:0">Keys: WASD/arrows to move, Space to kick. A gamepad works too (left stick, A to kick). Without the ball the robot faces forward; with it, it locks on the goal.</p>
        </div>
      </div></div>`;
    const narrow = () => { $('#mgrid').style.gridTemplateColumns = innerWidth < 760 ? '1fr' : 'minmax(0,1fr) 220px'; };
    narrow(); on(window, 'resize', narrow);
    $('#ctrlSel').value = S.ctrl; $('#lvl').value = S.level;
    $('#ctrlSel').onchange = () => { S.ctrl = $('#ctrlSel').value; save(); ctrl = mkCtrl(); };
    $('#lvl').onchange = () => { S.level = $('#lvl').value; save(); resetMatch(); };
    $('#lock').onchange = e => { S.autoLock = e.target.checked; save(); };
    $('#setBtn').onclick = () => $('#setBox').classList.toggle('hide');
    $$('[data-s]').forEach(i => i.onchange = () => { S[i.dataset.s] = Math.max(1, +i.value); save(); resetMatch(); });

    const st = stickState(), drawStick = makeStick($('#mstick'), st);
    const keys = new Set(); let kickReq = false;
    on(window, 'keydown', e => { const k = e.key.toLowerCase(); if (k === ' ') { kickReq = true; e.preventDefault(); } if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault(); keys.add(k); });
    on(window, 'keyup', e => keys.delete(e.key.toLowerCase()));
    $('#kick').onclick = () => { kickReq = true; };
    const P = O.omniPlant(o), BR = 37, RB = Math.max(80, o.radius + 30);
    const mkCtrl = () => S.ctrl === 'LQR' ? O.holdLQR(O.lqrForOmni(o), P) : O.holdPID(o.pid);
    let ctrl = mkCtrl();
    let me, ball, bots, score, held, tGame, R, lastGp = false, queue, bias;
    function resetMatch(keepScore) {
      R = rng(Date.now() % 1e6);
      me = { x: S.W / 2, y: S.L * 0.2, h: 0, w: 0, u: 0 }; queue = [0]; bias = 0;
      ball = { x: S.W * (0.25 + R() * 0.5), y: S.L * (0.35 + R() * 0.3), vx: 0, vy: 0 };
      const n = S.level === 'off' ? 0 : 2;
      bots = Array.from({ length: n }, (_, i) => ({ x: S.W * (0.3 + 0.4 * i), y: S.L * 0.8, a: 180, v: 0 }));
      if (!keepScore) { score = [0, 0]; tGame = 0; }
      held = false; ctrl = mkCtrl();
    }
    resetMatch();
    $('#reset').onclick = () => resetMatch();

    const pitch = $('#pitch');
    function size() {
      const w = pitch.clientWidth, maxH = innerHeight * 0.72; let h = w * S.L / S.W;
      if (h > maxH) { h = maxH; pitch.style.width = (h * S.W / S.L) + 'px'; } else pitch.style.width = '100%';
      pitch.style.height = h + 'px'; const dpr = devicePixelRatio || 1; pitch.width = pitch.clientWidth * dpr; pitch.height = h * dpr;
    }
    size(); on(window, 'resize', size);
    const lvl = { easy: { v: 250, turn: 160, react: 0.5 }, medium: { v: 380, turn: 240, react: 0.8 }, hard: { v: 520, turn: 360, react: 1 } };

    let last = performance.now(), acc = 0;
    function physics(dt) {
      tGame += dt;
      readInputs(st, keys);
      const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
      const a = !!gp?.buttons?.[0]?.pressed; if (a && !lastGp) kickReq = true; lastGp = a;
      // heading target: face forward, or goal lock when holding ball
      const goal = { x: S.W / 2, y: S.L + 40 };
      const target = held && S.autoLock ? Math.atan2(goal.x - me.x, goal.y - me.y) * 180 / Math.PI : 0;
      const m = { heading: me.h + bias + R.gauss() * P.gyroNoise, rate: me.w, moving: true };
      queue.push(Math.max(-1, Math.min(1, ctrl.step(m, target, dt)))); me.u = queue.shift();
      const j = joy2deg(st);
      const rel = o.fieldRelative ? j.dir - me.h : j.dir;
      const duties = O.wheelDuties(o.config, rel, j.speed, me.u, o.rotPriority);
      const k = O.forwardKin(o.config, duties.map((d, i) => d * (1 + ((i * 37) % 7 - 3) * 0.01)));
      me.w += (k.rot * P.maxRate - me.w) * Math.min(1, dt / P.tau);
      me.h = O.wrap(me.h + me.w * dt);
      const fx = Math.sin(rad(me.h)) * k.vx + Math.cos(rad(me.h)) * k.vy, fy = Math.cos(rad(me.h)) * k.vx - Math.sin(rad(me.h)) * k.vy;
      me.x += fx * P.wheelSpeed * dt; me.y += fy * P.wheelSpeed * dt;
      me.x = Math.max(RB, Math.min(S.W - RB, me.x)); me.y = Math.max(RB, Math.min(S.L - RB, me.y));
      // opponents (2-wheel drive): get behind the ball, push it toward our goal (y = 0)
      const L = lvl[S.level];
      for (const b of bots) {
        const gx = S.W / 2, gy = -40; const dx = gx - ball.x, dy = gy - ball.y, dl = Math.hypot(dx, dy) || 1;
        let tx = ball.x - dx / dl * 160, ty = ball.y - dy / dl * 160;
        const behind = Math.hypot(b.x - tx, b.y - ty) < 120 || ((b.y > ball.y) && Math.abs(b.x - ball.x) < 120);
        if (behind) { tx = ball.x + dx / dl * 200; ty = ball.y + dy / dl * 200; }
        if (L.react < 1) { tx += Math.sin(tGame * 1.7 + b.x) * (1 - L.react) * 250; }
        const want = Math.atan2(tx - b.x, ty - b.y) * 180 / Math.PI, err = O.wrap(want - b.a);
        b.a = O.wrap(b.a + Math.max(-L.turn * dt, Math.min(L.turn * dt, err)));
        const v = L.v * Math.max(0, Math.cos(rad(err)));
        b.x += Math.sin(rad(b.a)) * v * dt; b.y += Math.cos(rad(b.a)) * v * dt;
        b.x = Math.max(90, Math.min(S.W - 90, b.x)); b.y = Math.max(90, Math.min(S.L - 90, b.y));
      }
      // robot-robot collisions: bumps also twist our robot (that is what heading hold fights)
      const bodies = [{ o: me, r: RB, me: true }, ...bots.map(b => ({ o: b, r: 90 }))];
      for (let i = 0; i < bodies.length; i++) for (let jx = i + 1; jx < bodies.length; jx++) {
        const A = bodies[i], B = bodies[jx], dx = B.o.x - A.o.x, dy = B.o.y - A.o.y, d = Math.hypot(dx, dy), min = A.r + B.r;
        if (d < min && d > 0) {
          const push = (min - d) / 2, nx = dx / d, ny = dy / d;
          A.o.x -= nx * push; A.o.y -= ny * push; B.o.x += nx * push; B.o.y += ny * push;
          if (A.me) { me.w += (R() - 0.5) * 300; if (held && R() < 0.02) { held = false; ball.vx = -nx * 300; ball.vy = -ny * 300; } }
        }
      }
      // dribbler / ball
      const fwd = { x: Math.sin(rad(me.h)), y: Math.cos(rad(me.h)) }, right = { x: Math.cos(rad(me.h)), y: -Math.sin(rad(me.h)) };
      if (held) {
        const d = RB + BR - S.reach + 5; ball.x = me.x + fwd.x * d; ball.y = me.y + fwd.y * d; ball.vx = fx * P.wheelSpeed; ball.vy = fy * P.wheelSpeed;
        if (kickReq) { held = false; ball.vx += fwd.x * 2200; ball.vy += fwd.y * 2200; ball.x += fwd.x * 15; ball.y += fwd.y * 15; }
      } else {
        const rx = ball.x - me.x, ry = ball.y - me.y, df = rx * fwd.x + ry * fwd.y, dr = rx * right.x + ry * right.y;
        const inFunnel = df > RB - 5 && df < RB + BR + S.retD && Math.abs(dr) < S.retW / 2 - BR * 0.3;
        const relV = Math.hypot(ball.vx - fx * P.wheelSpeed, ball.vy - fy * P.wheelSpeed);
        if (inFunnel && relV < 900) held = true;
        else if (Math.hypot(rx, ry) < RB + BR) { const d = Math.hypot(rx, ry) || 1; ball.x = me.x + rx / d * (RB + BR); ball.y = me.y + ry / d * (RB + BR); ball.vx += rx / d * 250; ball.vy += ry / d * 250; }
      }
      kickReq = false;
      for (const b of bots) {
        const rx = ball.x - b.x, ry = ball.y - b.y, d = Math.hypot(rx, ry);
        if (d < 90 + BR) {
          if (held) { if (R() < 0.04 * (lvl[S.level].react)) { held = false; } else continue; }
          ball.x = b.x + rx / d * (90 + BR); ball.y = b.y + ry / d * (90 + BR);
          const sp = 200 + lvl[S.level].v * 0.9; ball.vx = rx / d * sp + Math.sin(rad(b.a)) * sp * 0.6; ball.vy = ry / d * sp + Math.cos(rad(b.a)) * sp * 0.6;
        }
      }
      if (!held) {
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        const sp = Math.hypot(ball.vx, ball.vy), dec = Math.max(0, sp - 350 * dt);
        if (sp > 0) { ball.vx *= dec / sp; ball.vy *= dec / sp; }
        const inGoalX = Math.abs(ball.x - S.W / 2) < S.goal / 2 - BR;
        if (ball.y > S.L - BR && inGoalX) { score[0]++; toast('GOAL! ⚽'); return resetMatch(true); }
        if (ball.y < BR && inGoalX) { score[1]++; toast('Opponents scored'); return resetMatch(true); }
        if (ball.x < BR) { ball.x = BR; ball.vx = Math.abs(ball.vx) * 0.6; } if (ball.x > S.W - BR) { ball.x = S.W - BR; ball.vx = -Math.abs(ball.vx) * 0.6; }
        if (ball.y < BR) { ball.y = BR; ball.vy = Math.abs(ball.vy) * 0.6; } if (ball.y > S.L - BR) { ball.y = S.L - BR; ball.vy = -Math.abs(ball.vy) * 0.6; }
      }
      me.target = target; me.duties = duties;
      bias += R.gauss() * 0.0002;
    }
    function drawPitch() {
      const c = pitch, x = c.getContext('2d'), s = c.width / S.W, dpr = devicePixelRatio || 1, Y = y => (S.L - y) * s;
      x.clearRect(0, 0, c.width, c.height); x.fillStyle = '#166534'; x.fillRect(0, 0, c.width, c.height);
      x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 2 * dpr; x.strokeRect(dpr, dpr, c.width - 2 * dpr, c.height - 2 * dpr);
      x.beginPath(); x.moveTo(0, c.height / 2); x.lineTo(c.width, c.height / 2); x.stroke(); x.beginPath(); x.arc(c.width / 2, c.height / 2, 300 * s, 0, 7); x.stroke();
      x.fillStyle = '#60a5fa'; x.fillRect((S.W - S.goal) / 2 * s, 0, S.goal * s, 10 * dpr);
      x.fillStyle = '#facc15'; x.fillRect((S.W - S.goal) / 2 * s, c.height - 10 * dpr, S.goal * s, 10 * dpr);
      for (const b of bots) {
        x.save(); x.translate(b.x * s, Y(b.y)); x.rotate(rad(b.a)); x.fillStyle = '#1e3a8a'; x.strokeStyle = '#93c5fd'; x.lineWidth = 2 * dpr;
        x.beginPath(); x.arc(0, 0, 90 * s, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#93c5fd'; x.fillRect(-8 * dpr, -90 * s, 16 * dpr, 16 * dpr); x.restore();
      }
      drawBot(x, me.x * s, Y(me.y), me.h, RB * s, COL[S.ctrl], me.target, dpr, o.config, me.duties, { retW: S.retW * s, retD: S.retD * s, held });
      x.fillStyle = '#f97316'; x.strokeStyle = '#fff'; x.lineWidth = 1.5 * dpr; x.beginPath(); x.arc(ball.x * s, Y(ball.y), BR * s, 0, 7); x.fill(); x.stroke();
    }
    const loop = now => {
      let dt = Math.min(0.05, (now - last) / 1000); last = now; acc += dt;
      while (acc > 0.01) { physics(0.01); acc -= 0.01; }
      drawPitch(); drawStick();
      $('#score').textContent = `${score[0]} : ${score[1]}`;
      $('#clock').textContent = `${Math.floor(tGame / 60)}:${String(Math.floor(tGame % 60)).padStart(2, '0')}`;
      const e = O.wrap(me.h - (me.target || 0));
      $('#tele').innerHTML = [['Controller', S.ctrl], ['Heading', me.h.toFixed(1) + '°'], ['Target', (me.target || 0).toFixed(1) + '°' + (held && S.autoLock ? ' (goal)' : '')],
        ['Error', `<span style="color:${Math.abs(e) < 2 ? 'var(--good)' : Math.abs(e) < 6 ? 'var(--accent)' : 'var(--bad)'}">${e.toFixed(1)}°</span>`], ['Ball', held ? 'in dribbler' : 'free'], ['Stick', st.src]]
        .map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  show();
}

// top-down omni robot; heading clockwise, 0 = up
function drawBot(x, cx, cy, h, r, color, target, dpr, cfg = 'x4', duties = null, extra = null) {
  x.save(); x.translate(cx, cy);
  if (target != null) { x.save(); x.rotate(rad(target)); x.setLineDash([5 * dpr, 4 * dpr]); x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = 1.5 * dpr; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -r * 2.2); x.stroke(); x.restore(); }
  x.rotate(rad(h));
  if (extra) { x.fillStyle = extra.held ? 'rgba(45,212,191,.45)' : 'rgba(255,255,255,.18)'; x.fillRect(-extra.retW / 2, -r - extra.retD, extra.retW, extra.retD); }
  x.fillStyle = '#111827'; x.strokeStyle = color; x.lineWidth = 3 * dpr; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill(); x.stroke();
  O.CONFIGS[cfg].wheels.forEach((p, i) => {
    x.save(); x.rotate(rad(p)); x.translate(0, -r * 0.82);
    const d = duties?.[i] ?? 0; x.fillStyle = d > 0.02 ? '#2dd4bf' : d < -0.02 ? '#f472b6' : '#4b5a70';
    x.fillRect(-r * 0.28, -r * 0.1, r * 0.56, r * 0.2); x.restore();
  });
  x.fillStyle = color; x.beginPath(); x.moveTo(0, -r * 1.05); x.lineTo(-r * 0.25, -r * 0.6); x.lineTo(r * 0.25, -r * 0.6); x.fill();
  x.restore();
}
