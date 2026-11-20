import { $, $$, esc, toast, download, copy } from '../app.js';
import * as P from '../physics.js';
import { exportTurnCode, calibrationScript } from '../pybricks-export.js';

const COLORS = { LQR: '#ffb020', PID: '#f472b6', Gyro: '#60a5fa' };
let raf = 0;
export function destroy() { cancelAnimationFrame(raf); }

export async function render(el, ctx) {
  const build = ctx.build;
  build.gains ||= {};
  const g = {
    lqrQ: { qAngle: 1 / 9, qInt: 1 / 25, ...(build.gains.lqrQ || {}) },
    pid: { kp: 0.02, ki: 0, kd: 0.001, tol: 1, ...(build.gains.pid || {}) },
    gyro: { kp: 0.03, ki: 0.03, kd: 0.002, ...(build.gains.gyro || {}) },
  };
  let plant = P.plantFromRobot(ctx.robot);
  let lqr = P.designLQR(plant, g.lqrQ);
  let results = null;

  el.innerHTML = `
  <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Turn lab</h2><span class="spacer"></span>
    <button class="btn primary" id="run">▶ Run 6-turn test</button><button class="btn" id="tune">⚙ Auto-tune</button></div>
  <div class="grid side">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Your robot <span class="tag ${ctx.robot.calibration ? 'ok' : ''}" id="calTag">${ctx.robot.calibration ? 'calibrated' : 'from builder'}</span></h3>
        <div class="kv" id="robotKv"></div>
        <p class="small muted" style="margin:10px 0 0">Change parts on the <a href="#/builder">Robot</a> tab.</p></div>
      <div class="card"><h3>Calibrate to the real robot</h3>
        <p class="small muted" style="margin-top:0">1) Run this script on your hub. 2) Paste the line it prints (starts with <span class="mono">CAL</span>).</p>
        <div class="row"><button class="btn sm" id="calCopy">Copy script</button><button class="btn sm" id="calDl">Download .py</button></div>
        <input class="in mono" id="calIn" placeholder="CAL us=0.072 rate=280.1 tau=0.081" style="margin-top:10px">
        <div class="row" style="margin-top:8px"><button class="btn sm teal" id="calApply">Apply</button><button class="btn sm" id="calClear">Reset to model</button></div>
        <div class="err" id="calErr"></div></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="grid g3" id="cols"></div>
      <div class="card"><h3>Accuracy over 6 turns <span class="tag">mean error</span></h3><div class="bars" id="bars"><p class="muted small">Press “Run 6-turn test”.</p></div></div>
      <div class="card"><h3>Heading error during each turn <select class="in" id="turnSel" style="width:auto;margin-left:auto;padding:4px 8px"></select></h3>
        <canvas class="chart" id="chart"></canvas>
        <p class="small muted" style="margin:8px 0 0">Error = actual heading − target. Dashed lines: ±0.5°.</p></div>
    </div>
  </div>`;

  const ctrls = [
    { key: 'LQR', make: () => P.makeLQR(lqr, plant), params: [['qAngle', 'Q angle', 1 / 9], ['qInt', 'Q integral', 1 / 25]] },
    { key: 'PID', make: () => P.makePID(g.pid), params: [['kp', 'Kp', 0.02], ['ki', 'Ki', 0], ['kd', 'Kd', 0.001], ['tol', 'stop within °', 1]] },
    { key: 'Gyro', make: () => P.makeGyro(g.gyro, plant), params: [['kp', 'Kp', 0.03], ['ki', 'Ki', 0.03], ['kd', 'Kd', 0.002]] },
  ];
  const gainObj = k => k === 'LQR' ? g.lqrQ : k === 'PID' ? g.pid : g.gyro;

  function robotKv() {
    const r = ctx.robot;
    $('#robotKv').innerHTML = [
      ['Mass', (r.mass * 1000).toFixed(0) + ' g'], ['Yaw inertia', (r.inertia * 1e4).toFixed(1) + ' kg·cm²'],
      ['Wheel / track', `${r.wheelDiameter} / ${r.axleTrack.toFixed(0)} mm`], ['Max yaw rate', plant.maxRate.toFixed(0) + ' °/s'],
      ['Time constant', (plant.tau * 1000).toFixed(0) + ' ms'], ['Static friction', (plant.uStatic * 100).toFixed(1) + '% duty'],
    ].map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
  }
  robotKv();

  $('#cols').innerHTML = ctrls.map(c => `
    <div class="card ctrl-col" style="--c:${COLORS[c.key]}">
      <h3 style="color:${COLORS[c.key]}">${c.key}<span class="tag" id="err-${c.key}">—</span></h3>
      <canvas class="dial" id="dial-${c.key}" width="300" height="300"></canvas>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
        ${c.params.map(([k, label]) => `<div><label class="f">${label}</label><input class="in mono" data-c="${c.key}" data-k="${k}" type="number" step="any" value="${+gainObj(c.key)[k].toPrecision(4)}"></div>`).join('')}
      </div>
      ${c.key === 'LQR' ? `<div class="small muted mono" id="lqrK" style="margin-top:8px"></div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn sm" data-exp="${c.key}">Copy Pybricks code</button><button class="btn sm" data-dl="${c.key}">.py</button></div>
    </div>`).join('');

  const showK = () => { $('#lqrK').textContent = `K = [${lqr.k1.toFixed(3)}, ${lqr.k2.toFixed(4)}, ${lqr.k3.toFixed(3)}, ${lqr.k4.toFixed(3)}]`; };
  showK();

  $$('input[data-c]').forEach(inp => inp.addEventListener('change', () => {
    const o = gainObj(inp.dataset.c); o[inp.dataset.k] = +inp.value;
    if (inp.dataset.c === 'LQR') { lqr = P.designLQR(plant, g.lqrQ); showK(); }
    persist();
  }));
  function persist() { build.gains = JSON.parse(JSON.stringify(g)); ctx.saveBuild(build); }
  function codeFor(k) { return exportTurnCode(k, k === 'LQR' ? lqr : k === 'PID' ? g.pid : g.gyro, plant, ctx.robot); }
  $$('[data-exp]').forEach(b => b.onclick = () => copy(codeFor(b.dataset.exp)));
  $$('[data-dl]').forEach(b => b.onclick = () => download(`${b.dataset.dl.toLowerCase()}_turn.py`, codeFor(b.dataset.dl)));

  // dials
  function drawDial(key, heading, target, err) {
    const c = $('#dial-' + key); if (!c) return;
    const x = c.getContext('2d'), W = c.width, cx = W / 2, R = W * 0.42;
    x.clearRect(0, 0, W, W);
    x.strokeStyle = '#253042'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cx, R, 0, 7); x.stroke();
    for (let a = 0; a < 360; a += 15) {
      const r = (a - 90) * Math.PI / 180, l = a % 90 ? 6 : 14;
      x.beginPath(); x.moveTo(cx + Math.cos(r) * R, cx + Math.sin(r) * R); x.lineTo(cx + Math.cos(r) * (R - l), cx + Math.sin(r) * (R - l)); x.stroke();
    }
    const tr = (target - 90) * Math.PI / 180;
    x.setLineDash([6, 6]); x.strokeStyle = '#8b98ab'; x.beginPath(); x.moveTo(cx, cx); x.lineTo(cx + Math.cos(tr) * R, cx + Math.sin(tr) * R); x.stroke(); x.setLineDash([]);
    // robot (top view), heading clockwise from up
    x.save(); x.translate(cx, cx); x.rotate(heading * Math.PI / 180);
    x.fillStyle = '#1b2433'; x.strokeStyle = COLORS[key]; x.lineWidth = 3;
    x.beginPath(); x.roundRect(-38, -46, 76, 92, 10); x.fill(); x.stroke();
    x.fillStyle = '#0a0e14'; x.fillRect(-48, -4, 12, 30); x.fillRect(36, -4, 12, 30);
    x.fillStyle = COLORS[key]; x.beginPath(); x.moveTo(0, -60); x.lineTo(-10, -44); x.lineTo(10, -44); x.fill();
    x.restore();
    x.fillStyle = '#e7ecf3'; x.font = '600 22px ui-monospace, monospace'; x.textAlign = 'center';
    x.fillText((((heading % 360) + 360) % 360).toFixed(1) + '°', cx, W - 8);
    if (err != null) { x.fillStyle = Math.abs(err) < 0.5 ? '#34d399' : Math.abs(err) < 1.5 ? '#ffb020' : '#f87171'; x.font = '600 16px ui-monospace, monospace'; x.fillText((err >= 0 ? '+' : '') + err.toFixed(2) + '°', cx, 26); }
  }
  ctrls.forEach(c => drawDial(c.key, 0, 0, null));

  function bars() {
    const list = Object.entries(results).sort((a, b) => a[1].mean - b[1].mean);
    const worst = Math.max(...list.map(([, r]) => r.mean));
    $('#bars').innerHTML = list.map(([k, r], i) => `<div class="bar" style="--c:${COLORS[k]}"><span class="rank">${i + 1}</span><span>${k}</span>
      <div class="track"><div class="fill" style="width:${Math.max(3, 100 * r.mean / worst)}%"></div></div><span style="text-align:right">${r.mean.toFixed(2)}°</span></div>`).join('') +
      `<p class="small muted" style="margin:6px 0 0">Average time per turn: ${list.map(([k, r]) => `${k} ${r.meanTime.toFixed(2)} s`).join(' · ')}</p>`;
    for (const [k, r] of list) $('#err-' + k).textContent = r.mean.toFixed(2) + '°';
  }

  function chart(turnIdx) {
    const c = $('#chart'), dpr = devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    const W = c.clientWidth, H = c.clientHeight, pad = 50;
    x.clearRect(0, 0, W, H);
    if (!results) return;
    let tMax = 0, eMax = 1;
    const series = Object.entries(results).map(([k, r]) => {
      const turn = r.results[turnIdx];
      const target = P.TURN_TEST.slice(0, turnIdx + 1).reduce((a, b) => a + b, 0);
      const pts = turn.trace.map(p => [p.t, p.h - target]);
      tMax = Math.max(tMax, turn.time);
      return [k, pts];
    });
    for (const [, pts] of series) for (const [t, e] of pts) if (t > 0.25) eMax = Math.max(eMax, Math.min(15, Math.abs(e)));
    const sx = t => pad + (W - pad - 8) * t / tMax, sy = e => H / 2 - (H / 2 - 12) * Math.max(-1, Math.min(1, e / eMax));
    x.strokeStyle = '#253042'; x.lineWidth = 1; x.beginPath(); x.moveTo(pad, H / 2); x.lineTo(W, H / 2); x.stroke();
    x.setLineDash([4, 4]); [0.5, -0.5].forEach(v => { x.beginPath(); x.moveTo(pad, sy(v)); x.lineTo(W, sy(v)); x.stroke(); }); x.setLineDash([]);
    x.fillStyle = '#8b98ab'; x.font = '11px ui-monospace, monospace'; x.textAlign = 'right';
    x.fillText('+' + eMax.toFixed(1) + '°', pad - 4, 16); x.fillText('−' + eMax.toFixed(1) + '°', pad - 4, H - 6); x.fillText('0', pad - 4, H / 2 + 4);
    x.textAlign = 'left'; x.fillText(tMax.toFixed(2) + ' s', W - 50, H - 6);
    for (const [k, pts] of series) {
      x.strokeStyle = COLORS[k]; x.lineWidth = 2; x.beginPath();
      pts.forEach(([t, e], i) => i ? x.lineTo(sx(t), sy(e)) : x.moveTo(sx(t), sy(e))); x.stroke();
    }
  }
  $('#turnSel').innerHTML = P.TURN_TEST.map((a, i) => `<option value="${i}">Turn ${i + 1}: ${a > 0 ? '+' : ''}${a}°</option>`).join('');
  $('#turnSel').onchange = () => chart(+$('#turnSel').value);

  function run() {
    cancelAnimationFrame(raf);
    results = {};
    for (const c of ctrls) results[c.key] = P.runTurnTest(c.make, plant);
    bars(); chart(+$('#turnSel').value);
    // animate all three on one timeline (2× speed)
    const timelines = Object.fromEntries(Object.entries(results).map(([k, r]) => {
      let t0 = 0, target = 0; const pts = [];
      r.results.forEach((turn, i) => {
        target += P.TURN_TEST[i];
        turn.trace.forEach(p => pts.push([t0 + p.t, p.h, target, null]));
        pts.push([t0 + turn.time + 0.3, turn.trace.at(-1).h, target, turn.error]);
        t0 += turn.time + 0.35;
      });
      return [k, pts];
    }));
    const start = performance.now();
    const step = now => {
      const t = (now - start) / 1000 * 2; let alive = false;
      for (const [k, pts] of Object.entries(timelines)) {
        let i = pts.findIndex(p => p[0] > t); if (i === -1) i = pts.length; else alive = true;
        const p = pts[Math.max(0, i - 1)];
        const lastErr = [...pts.slice(0, i)].reverse().find(q => q[3] != null);
        drawDial(k, p[1], p[2], lastErr ? lastErr[3] : null);
      }
      if (alive) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  $('#run').onclick = run;

  $('#tune').onclick = async () => {
    const b = $('#tune'); b.disabled = true; b.textContent = 'Tuning…';
    await new Promise(r => setTimeout(r, 30));
    const al = P.autoTuneLQR(plant);
    g.lqrQ.qAngle = al.qa; g.lqrQ.qInt = al.qi; lqr = P.designLQR(plant, g.lqrQ);
    Object.assign(g.pid, P.autoTunePID(plant));
    // gyro: small grid on hold gains
    let best = null;
    for (const kp of [0.02, 0.03, 0.05]) for (const ki of [0.02, 0.05, 0.1]) {
      const r = P.runTurnTest(() => P.makeGyro({ ...g.gyro, kp, ki }, plant), plant, 3);
      if (!best || r.mean < best.m) best = { m: r.mean, kp, ki };
    }
    g.gyro.kp = best.kp; g.gyro.ki = best.ki;
    $$('input[data-c]').forEach(inp => inp.value = +gainObj(inp.dataset.c)[inp.dataset.k].toPrecision(4));
    showK(); persist();
    b.disabled = false; b.textContent = '⚙ Auto-tune';
    toast('Tuned for your robot'); run();
  };

  // calibration
  $('#calCopy').onclick = () => copy(calibrationScript(ctx.robot));
  $('#calDl').onclick = () => download('fllsim_calibrate.py', calibrationScript(ctx.robot));
  $('#calApply').onclick = async () => {
    const cal = P.parseCalibration($('#calIn').value);
    if (!cal) { $('#calErr').textContent = 'Paste the whole line, like: CAL us=0.072 rate=280.1 tau=0.081'; return; }
    $('#calErr').textContent = '';
    build.calibration = cal; await ctx.saveBuild(build);
    plant = P.plantFromRobot(ctx.robot); lqr = P.designLQR(plant, g.lqrQ); showK(); robotKv();
    $('#calTag').textContent = 'calibrated'; $('#calTag').className = 'tag ok';
    toast('Calibration applied'); run();
  };
  $('#calClear').onclick = async () => {
    delete build.calibration; await ctx.saveBuild(build);
    plant = P.plantFromRobot(ctx.robot); lqr = P.designLQR(plant, g.lqrQ); showK(); robotKv();
    $('#calTag').textContent = 'from builder'; $('#calTag').className = 'tag';
  };
  run();
}
