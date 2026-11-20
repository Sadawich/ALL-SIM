import { $, $$, esc, toast, download, copy } from '../app.js';
import { FieldView } from '../fieldview.js';
import { defaultRoute } from './field.js';
import * as P from '../physics.js';

let fv, worker, raf, timer;
export function destroy() { fv?.destroy(); cancelAnimationFrame(raf); clearTimeout(timer); }

const STARTER = `from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Port, Direction, Stop
from pybricks.robotics import DriveBase
from pybricks.tools import wait

hub = PrimeHub()
left = Motor(Port.A, Direction.COUNTERCLOCKWISE)
right = Motor(Port.B)
arm = Motor(Port.D)
drive_base = DriveBase(left, right, wheel_diameter=56, axle_track=120)
drive_base.use_gyro(True)

drive_base.straight(450)
drive_base.turn(-45)
drive_base.straight(300)
arm.run_angle(500, 90)
drive_base.straight(-300)
drive_base.turn(45)
drive_base.straight(-450)
print("heading at the end:", hub.imu.heading())
`;

function getWorker() {
  if (!worker) worker = new Worker(new URL('../py-worker.js', import.meta.url));
  return worker;
}

export async function render(el, ctx) {
  const field = ctx.comp;
  let programs = await ctx.store.getPrograms();
  let prog = programs.find(p => p.id === sessionStorage.getItem('fllsim.prog')) || programs[0] || null;
  let dirty = false;

  el.innerHTML = `
  <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Python in the browser</h2><span class="spacer"></span>
    <span class="small muted" id="pyState">Python loads on first run (≈10 MB, once)</span></div>
  <div class="card" style="padding:12px;margin-bottom:14px">
    <div class="row"><div class="proglist" id="plist"></div><span class="spacer"></span>
      <button class="btn sm" id="new">+ New</button><button class="btn sm" id="ren">Rename</button><button class="btn sm danger" id="del">Delete</button></div>
  </div>
  <div class="grid g2">
    <div>
      <div class="editor"><div class="ln" id="ln"></div><textarea id="ed" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="run">▶ Run</button><button class="btn" id="stop" disabled>■ Stop</button><button class="btn teal" id="save">Save</button>
        <span class="spacer"></span><button class="btn sm" id="cp">Copy</button><button class="btn sm" id="dl">Export .py</button>
        <label class="btn sm">Import .py<input type="file" id="up" accept=".py,text/x-python,text/plain" hidden></label>
      </div>
    </div>
    <div>
      <div class="row toolbar">
        <select class="in" id="startSel" style="width:auto;padding:5px 8px">${(field.zones.length ? field.zones : [{ name: 'Start' }]).map((z, i) => `<option value="${i}">Start: ${esc(z.name)}</option>`).join('')}<option value="route">Start: saved run start</option></select>
        <select class="in" id="noiseSel" style="width:auto;padding:5px 8px"><option value="">Perfect robot</option><option value="LQR">LQR turn error</option><option value="Gyro">Gyro turn error</option><option value="PID">PID turn error</option></select>
      </div>
      <div class="fieldwrap"><canvas id="fc"></canvas></div>
      <div class="console" id="con" style="margin-top:10px">Ready. Press Run.</div>
      <p class="small muted">Simulated: DriveBase straight / turn / curve / drive + wait, motor run_* actions, hub.imu.heading(), StopWatch, print.
      Sensors return fixed values. Raw <span class="mono">dc()</span> loops run but don't move the robot. Export the file and run it with the Pybricks app on the real hub.</p>
    </div>
  </div>`;

  const ed = $('#ed'), ln = $('#ln');
  const lines = () => { ln.textContent = Array.from({ length: ed.value.split('\n').length }, (_, i) => i + 1).join('\n'); ln.scrollTop = ed.scrollTop; };
  ed.addEventListener('input', () => { dirty = true; lines(); });
  ed.addEventListener('scroll', () => { ln.scrollTop = ed.scrollTop; });
  ed.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText('    ', s, ed.selectionEnd, 'end'); dirty = true; lines(); }
    if (e.key === 'Enter') {
      const s = ed.selectionStart, lineStart = ed.value.lastIndexOf('\n', s - 1) + 1, line = ed.value.slice(lineStart, s);
      let ind = line.match(/^\s*/)[0]; if (/:\s*$/.test(line)) ind += '    ';
      e.preventDefault(); ed.setRangeText('\n' + ind, s, ed.selectionEnd, 'end'); dirty = true; lines();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  function list() {
    $('#plist').innerHTML = programs.map(p => `<button class="btn sm ${prog?.id === p.id ? 'on' : ''}" data-p="${p.id}">${esc(p.name)}${p.route ? ' 🗺' : ''}</button>`).join('') || '<span class="small muted">No saved programs yet</span>';
    $$('[data-p]').forEach(b => b.onclick = () => { if (dirty && !confirm('Discard unsaved changes?')) return; prog = programs.find(p => p.id === b.dataset.p); load(); });
  }
  function load() {
    ed.value = prog ? prog.code : STARTER; dirty = false; lines(); list();
    if (prog) sessionStorage.setItem('fllsim.prog', prog.id);
    $('#startSel').value = prog?.route ? 'route' : '0';
  }
  load();

  fv = new FieldView($('#fc'), { field, robot: ctx.robot });
  function startPose() {
    const v = $('#startSel').value;
    if (v === 'route' && prog?.route) return { ...prog.route.start };
    return defaultRoute(field, v === 'route' ? 0 : +v).start;
  }
  fv.poses = [startPose()]; fv.draw();
  $('#startSel').onchange = () => { fv.trail = []; fv.poses = [startPose()]; fv.draw(); };

  const con = $('#con');
  const log = (t, cls = '') => { con.innerHTML += (con.innerHTML ? '\n' : '') + `<span class="${cls}">${esc(t)}</span>`; con.scrollTop = 1e9; };

  function run() {
    cancelAnimationFrame(raf);
    const k = $('#noiseSel').value; let noise = { turn: 0, straight: 0 };
    if (k) {
      const plant = P.plantFromRobot(ctx.robot), gains = ctx.build.gains || {};
      const mk = { LQR: () => P.makeLQR(P.designLQR(plant, gains.lqrQ), plant), PID: () => P.makePID({ kp: 0.02, ki: 0, kd: 0.001, tol: 1, ...(gains.pid || {}) }), Gyro: () => P.makeGyro(gains.gyro || {}, plant) }[k];
      const r = P.runTurnTest(mk, plant, 21);
      noise = { turn: Math.sqrt(r.results.reduce((s, x) => s + x.error ** 2, 0) / r.results.length), straight: 0.004 };
    }
    con.textContent = '▶ Running…';
    $('#pyState').textContent = 'Loading Python…';
    $('#run').disabled = true; $('#stop').disabled = false;
    const w = getWorker();
    const st = startPose();
    timer = setTimeout(() => { stop(); log('Stopped: program took longer than 20 s to simulate (infinite loop without wait()?)', 'e'); }, 20000);
    w.onmessage = ({ data }) => {
      if (data.type !== 'done' && data.type !== 'error') return;
      clearTimeout(timer); $('#run').disabled = false; $('#stop').disabled = true; $('#pyState').textContent = 'Python ready';
      if (data.type === 'error') { log(data.error, 'e'); return; }
      con.textContent = '';
      data.out.forEach(l => log(l));
      data.log.forEach(l => log('· ' + l));
      if (data.error) log(data.error, 'e');
      const poses = data.poses.map(([x, y, a, t]) => ({ x, y, a, t }));
      const end = poses.at(-1)?.t || 0;
      log(`■ Done · simulated time ${end.toFixed(1)} s${k ? ` · ${k} turn noise σ ${noise.turn.toFixed(2)}°` : ''}`);
      const t0 = performance.now();
      const step = now => {
        const t = (now - t0) / 1000 * 1.5;
        const i = poses.findIndex(p => p.t > t), idx = i === -1 ? poses.length - 1 : Math.max(0, i - 1);
        fv.trail = poses.slice(0, idx + 1); fv.poses = [poses[idx] || st]; fv.draw();
        if (t < end) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    w.postMessage({ type: 'run', code: ed.value, start: st, noise, seed: Math.floor(Math.random() * 1e6) });
  }
  function stop() { worker?.terminate(); worker = null; clearTimeout(timer); $('#run').disabled = false; $('#stop').disabled = true; $('#pyState').textContent = 'Stopped'; }
  $('#run').onclick = run; $('#stop').onclick = () => { stop(); log('■ Stopped', 'e'); };

  async function save() {
    let name = prog?.name;
    if (!name) { name = prompt('Program name', `Program ${programs.length + 1}`); if (!name) return; }
    try {
      const saved = await ctx.store.saveProgram({ ...(prog || {}), name, code: ed.value, route: prog?.route || null });
      prog = saved; const i = programs.findIndex(p => p.id === saved.id); if (i >= 0) programs[i] = saved; else programs.push(saved);
      dirty = false; list(); toast('Saved' + (ctx.store.mode === 'local' || ctx.session.kind !== 'team' ? ' in this browser' : ''));
    } catch (e) { toast(e.message, 4000); }
  }
  $('#save').onclick = save;
  $('#new').onclick = () => { if (dirty && !confirm('Discard unsaved changes?')) return; prog = null; load(); };
  $('#ren').onclick = async () => { if (!prog) return toast('Save first'); const n = prompt('New name', prog.name); if (n) { prog.name = n; dirty = true; await save(); } };
  $('#del').onclick = async () => {
    if (!prog || !confirm(`Delete “${prog.name}”?`)) return;
    await ctx.store.deleteProgram(prog.id); programs = programs.filter(p => p.id !== prog.id); prog = programs[0] || null; load();
  };
  $('#cp').onclick = () => copy(ed.value);
  $('#dl').onclick = () => download((prog?.name || 'program').replace(/\W+/g, '_') + '.py', ed.value);
  $('#up').onchange = async e => { const f = e.target.files[0]; if (!f) return; ed.value = await f.text(); prog = null; dirty = true; lines(); list(); toast('Imported: press Save to keep it'); };
}
