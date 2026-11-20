import { esc } from '../app.js';
import { plantFromRobot, designLQR, makeLQR, makePID, makeGyro, runTurnTest } from '../physics.js';

export async function render(el, ctx) {
  const name = esc(ctx.config.siteName);
  const plant = plantFromRobot(ctx.robot);
  const res = [
    ['LQR', 'var(--lqr)', runTurnTest(() => makeLQR(designLQR(plant), plant), plant)],
    ['Gyro', 'var(--gyro)', runTurnTest(() => makeGyro({}, plant), plant)],
    ['PID', 'var(--pid)', runTurnTest(() => makePID({ kp: 0.02, ki: 0, kd: 0.001 }), plant)],
  ].sort((a, b) => a[2].mean - b[2].mean);
  const worst = Math.max(...res.map(r => r[2].mean));
  const s = ctx.session;
  el.innerHTML = `
  <section class="hero">
    <div>
      <div class="kicker">SPIKE Prime · Pybricks · FLL and more</div>
      <h1>Exact turns.<br><em>Before the table.</em></h1>
      <p class="lead">${name} is a free lab for robot teams: compare LQR, PID and the Pybricks gyro on a model of <b>your</b> robot,
      build it from LEGO parts to get real weight and balance, plan runs on a 1:1 field for <b>${esc(ctx.comp.name)}</b> or any competition map,
      read the rules with AI and run real Pybricks Python in the browser.</p>
      <div class="row" style="margin-top:18px">
        ${s.kind === 'guest' ? '<a class="btn primary" href="#/account">Register your team →</a>' : ''}
        <a class="btn" href="#/sim">Open the turn lab</a>
        <a class="btn" href="#/field">Plan a run</a>
      </div>
    </div>
    <div class="card">
      <h3>6-turn test · your robot <span class="tag">mean error</span></h3>
      <div class="bars">
        ${res.map(([n, c, r], i) => `<div class="bar" style="--c:${c}"><span class="rank">${i + 1}</span><span>${n}</span>
          <div class="track"><div class="fill" style="width:${Math.max(4, 100 * r.mean / worst)}%"></div></div><span style="text-align:right">${r.mean.toFixed(2)}°</span></div>`).join('')}
      </div>
      <p class="small muted" style="margin-bottom:0">Turns 90°, −90°, 180°, 45°, −135°, 90° with friction, gyro noise, motor delay and battery sag modelled.
      Build your robot on the <a href="#/builder">Robot</a> tab and the numbers update.</p>
    </div>
  </section>
  <section class="grid g3">
    ${[
      ['01', 'LQR · PID · Gyro', 'Same robot, same turns, three controllers side by side, with live dials and error charts.'],
      ['02', 'Auto-tuning', 'Gains computed from your robot model. Calibrate with a 20-second script on the real hub.'],
      ['03', '3D robot builder', 'Place SPIKE parts, get mass, centre of mass, inertia, wheel load and tipping warnings.'],
      ['04', 'Ports & directions', 'Set drive motor ports and directions once; every exported program uses them.'],
      ['05', 'Any field, 1:1', 'Upload a field map, set its size, draw a route on it and get Pybricks DriveBase code instantly.'],
      ['06', 'Python in the browser', 'Real Python (Pyodide) with a Pybricks simulator. Watch your program drive the field.'],
      ['07', 'Rules reader + AI', 'Open the rules PDF, search it, and ask AI questions with page references. AI can set up the field for you.'],
      ['08', 'Many competitions', 'FLL, WRO, robot soccer, your own league: each with its own map, size, zones, scoring spots and rules.'],
    ].map(([n, t, d]) => `<div class="card feature"><div class="ic">${n}</div><b>${t}</b><span class="muted small">${d}</span></div>`).join('')}
  </section>`;
}
