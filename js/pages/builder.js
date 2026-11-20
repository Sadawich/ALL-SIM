import * as THREE from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { $, $$, esc, toast } from '../app.js';
import { CATALOG, computeStats, defaultBuild, dimsOf } from '../robot.js';
import { plantFromRobot } from '../physics.js';

let renderer, raf, ro, keyHandler;
export function destroy() { cancelAnimationFrame(raf); ro?.disconnect(); renderer?.dispose(); renderer = null; if (keyHandler) removeEventListener('keydown', keyHandler); }

export async function render(el, ctx) {
  let build = JSON.parse(JSON.stringify(ctx.build));
  let selId = null;
  const groups = [...new Set(Object.values(CATALOG).map(c => c.group))];
  const ports = ['A', 'B', 'C', 'D', 'E', 'F'];

  el.innerHTML = `
  <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Robot builder</h2><span class="spacer"></span>
    <button class="btn" id="reset">Start from default</button><button class="btn" id="clear">Clear</button><button class="btn primary" id="save">Save robot</button></div>
  <div class="grid side">
    <div class="card"><h3>Parts <span class="tag">tap to add</span></h3>
      <div class="parts">${groups.map(gr => `<div class="small muted" style="margin-top:6px">${gr}</div>` +
        Object.entries(CATALOG).filter(([, c]) => c.group === gr).map(([k, c]) =>
          `<div class="part" data-add="${k}"><span class="sw" style="background:${c.color}"></span>${c.name}<span class="m">${c.mass} g</span></div>`).join('')).join('')}</div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="viewport" id="vp">
        <div class="selinfo" id="selinfo">Tap a part to select it · drag to orbit</div>
        <div class="pad" id="pad">
          <button data-mv="x,8" title="forward">▲</button><button data-mv="y,8" title="left">◀</button><button data-mv="y,-8" title="right">▶</button><button data-mv="x,-8" title="back">▼</button>
          <button data-mv="z,8" title="up">⤒</button><button data-mv="z,-8" title="down">⤓</button><button data-rot title="rotate 90°">⟳</button><button data-del title="delete" style="color:var(--bad)">✕</button>
        </div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Weight & balance</h3><div class="kv" id="stats"></div><div id="warn" style="margin-top:10px"></div></div>
        <div class="card"><h3>Ports & motor directions</h3>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
            <div><label class="f">Left drive port</label><select class="in" id="lp">${ports.map(p => `<option>${p}</option>`).join('')}</select></div>
            <div><label class="f">Right drive port</label><select class="in" id="rp">${ports.map(p => `<option>${p}</option>`).join('')}</select></div>
            <div><label class="f">Left direction</label><select class="in" id="ld"><option>COUNTERCLOCKWISE</option><option>CLOCKWISE</option></select></div>
            <div><label class="f">Right direction</label><select class="in" id="rd"><option>CLOCKWISE</option><option>COUNTERCLOCKWISE</option></select></div>
            <div style="grid-column:1/3"><label class="f">Motor top speed (°/s at wheel)</label><input class="in mono" id="ms" type="number" value="${build.motorMaxSpeed}"></div>
          </div>
          <p class="small muted" style="margin:10px 0 0">Real effects modelled: friction grows with mass, turning gets slower with inertia, off-centre weight makes the robot pull.</p>
        </div>
      </div>
      <div class="card" id="selCard"><h3>Selected part</h3><div id="selBody" class="small muted">Nothing selected.</div></div>
    </div>
  </div>`;

  // ---------- three.js scene (z up) ----------
  const vp = $('#vp');
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  vp.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a0e14');
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  camera.up.set(0, 0, 1); camera.position.set(-260, 220, 220);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(10, 0, 30); controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#202020', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(-200, 150, 400); scene.add(sun);
  const grid = new THREE.GridHelper(400, 50, '#2f3c52', '#1a2230'); grid.rotation.x = Math.PI / 2; scene.add(grid);
  const comMarker = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshBasicMaterial({ color: '#2dd4bf' }));
  const comLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#2dd4bf', dashSize: 4, gapSize: 3 }));
  scene.add(comMarker, comLine);
  const partGroup = new THREE.Group(); scene.add(partGroup);

  function meshFor(p) {
    const c = CATALOG[p.type], [l, w, h] = dimsOf(p);
    let geo;
    if (c.wheel) { geo = new THREE.CylinderGeometry(c.wheel / 2, c.wheel / 2, c.dims[1], 28); if (p.rot % 2) geo.rotateZ(Math.PI / 2); }
    else if (c.caster) geo = new THREE.SphereGeometry(8, 16, 12);
    else geo = new THREE.BoxGeometry(l, w, h);
    const sel = p.id === selId;
    const mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: .6, metalness: .05, emissive: sel ? '#ffb020' : '#000', emissiveIntensity: sel ? .35 : 0 });
    const m = new THREE.Mesh(geo, mat); m.position.set(p.x, p.y, p.z); m.userData.id = p.id;
    if (p.type === 'hub') { // screen
      const s = new THREE.Mesh(new THREE.BoxGeometry(l * .5, w * .5, 1), new THREE.MeshStandardMaterial({ color: '#111827' }));
      s.position.z = h / 2 + .5; m.add(s);
    }
    if (c.wheel && p.drive) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#ffb020' })); m.add(e);
    }
    return m;
  }
  function rebuild() {
    partGroup.clear();
    for (const p of build.parts) if (CATALOG[p.type]) partGroup.add(meshFor(p));
    const s = computeStats(build);
    comMarker.position.set(...s.com);
    comLine.geometry.setFromPoints([new THREE.Vector3(...s.com), new THREE.Vector3(s.com[0], s.com[1], 0)]); comLine.computeLineDistances();
    statsUI(s); selUI();
  }
  function statsUI(s) {
    const plant = plantFromRobot(s);
    $('#stats').innerHTML = [
      ['Total mass', (s.mass * 1000).toFixed(0) + ' g'], ['Centre of mass', s.com.map(v => v.toFixed(0)).join(', ') + ' mm'],
      ['Yaw inertia', (s.inertia * 1e4).toFixed(1) + ' kg·cm²'], ['Wheel Ø / axle track', `${s.wheelDiameter} / ${s.axleTrack.toFixed(0)} mm`],
      ['Weight on drive wheels', (s.driveLoad * 100).toFixed(0) + '%'], ['Max yaw rate', plant.maxRate.toFixed(0) + ' °/s'],
      ['Turn time constant', (plant.tau * 1000).toFixed(0) + ' ms'], ['Parts', build.parts.length],
    ].map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    $('#warn').innerHTML = s.warnings.length ? s.warnings.map(w => `<div class="tag warn" style="display:block;margin:4px 0;border-radius:8px;padding:5px 9px">⚠ ${esc(w)}</div>`).join('') : '<span class="tag ok">Balanced ✓</span>';
  }
  function selUI() {
    const p = build.parts.find(p => p.id === selId);
    $('#selinfo').textContent = p ? `${CATALOG[p.type].name} · x ${p.x} y ${p.y} z ${p.z}` : 'Tap a part to select it · drag to orbit';
    if (!p) { $('#selBody').innerHTML = 'Nothing selected. Tap a part in the 3D view.'; return; }
    const c = CATALOG[p.type];
    $('#selBody').innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:8px">
        ${['x', 'y', 'z'].map(k => `<div><label class="f">${k} mm</label><input class="in mono" data-pk="${k}" type="number" step="8" value="${p[k]}"></div>`).join('')}
        <div><label class="f">mass g</label><input class="in mono" data-pk="mass" type="number" step="1" value="${p.mass ?? c.mass}"></div>
      </div>
      ${c.wheel ? `<label class="row small" style="margin-top:10px"><input type="checkbox" id="drv" ${p.drive ? 'checked' : ''}> Drive wheel</label>` : ''}
      <p class="small muted" style="margin:8px 0 0">Mass override is per part (weigh yours with a kitchen scale).</p>`;
    $$('[data-pk]', $('#selBody')).forEach(inp => inp.onchange = () => {
      p[inp.dataset.pk] = +inp.value;
      rebuild();
    });
    const d = $('#drv'); if (d) d.onchange = () => { p.drive = d.checked; rebuild(); };
  }

  // picking
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(partGroup.children, true)[0];
    let o = hit?.object; while (o && o.userData.id == null) o = o.parent;
    selId = o ? o.userData.id : null; rebuild();
  });

  $$('[data-add]').forEach(d => d.onclick = () => {
    const type = d.dataset.add, c = CATALOG[type];
    const top = build.parts.reduce((m, p) => Math.max(m, p.z + dimsOf(p)[2] / 2), 0);
    const p = { id: build.nextId++, type, x: 0, y: 0, z: c.wheel ? c.wheel / 2 : Math.round(top + c.dims[2] / 2), rot: 0 };
    build.parts.push(p); selId = p.id; rebuild();
  });
  $$('[data-mv]').forEach(b => b.onclick = () => {
    const p = build.parts.find(p => p.id === selId); if (!p) return toast('Select a part first');
    const [k, v] = b.dataset.mv.split(','); p[k] += +v; rebuild();
  });
  $('[data-rot]').onclick = () => { const p = build.parts.find(p => p.id === selId); if (p) { p.rot = (p.rot + 1) % 4; rebuild(); } };
  $('[data-del]').onclick = () => { build.parts = build.parts.filter(p => p.id !== selId); selId = null; rebuild(); };
  addEventListener('keydown', onKey);
  function onKey(e) {
    if (!document.body.contains(vp) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const p = build.parts.find(p => p.id === selId); if (!p) return;
    const map = { ArrowUp: ['x', 8], ArrowDown: ['x', -8], ArrowLeft: ['y', 8], ArrowRight: ['y', -8], PageUp: ['z', 8], PageDown: ['z', -8] };
    if (map[e.key]) { p[map[e.key][0]] += map[e.key][1]; e.preventDefault(); rebuild(); }
    if (e.key === 'r') { p.rot = (p.rot + 1) % 4; rebuild(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { build.parts = build.parts.filter(q => q.id !== selId); selId = null; rebuild(); }
  }

  // ports
  const bind = (id, key) => { const s = $('#' + id); s.value = build[key]; s.onchange = () => { build[key] = id === 'ms' ? +s.value : s.value; rebuild(); }; };
  bind('lp', 'leftPort'); bind('rp', 'rightPort'); bind('ld', 'leftDir'); bind('rd', 'rightDir'); bind('ms', 'motorMaxSpeed');

  $('#save').onclick = async () => { await ctx.saveBuild(build); toast('Robot saved: the turn lab and field now use it'); };
  $('#reset').onclick = () => { const g = build.gains, cal = build.calibration; build = defaultBuild(); build.gains = g; if (cal) build.calibration = cal; selId = null; rebuild(); };
  $('#clear').onclick = () => { build.parts = []; selId = null; rebuild(); };

  function resize() {
    const w = vp.clientWidth, h = vp.clientHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  ro = new ResizeObserver(resize); ro.observe(vp); resize();
  const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();
  rebuild();
  keyHandler = onKey;
}
