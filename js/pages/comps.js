import { $, $$, esc, toast, reroute, download } from '../app.js';
import { FieldView } from '../fieldview.js';
import { defaultCompetition, blankCompetition } from '../store.js';

let fv;
export function destroy() { fv?.destroy(); }

// Load an image file, downscale, return { dataUrl, w, h }
export async function loadFieldImage(file, max = 2000) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: img.width, h: img.height };
}

export async function render(el, ctx) {
  if (ctx.session.kind !== 'admin') {
    el.innerHTML = `<div class="card lock"><h2>Admins only</h2><p class="muted">Log in with the admin key to add or edit competitions.</p><a class="btn primary" href="#/admin">Admin login</a></div>`;
    return;
  }
  const S = ctx.store;
  let site = await S.getSite();
  let data = JSON.parse(JSON.stringify(site.field));
  let editId = sessionStorage.getItem('fllsim.editComp');
  if (!data.competitions.some(c => c.id === editId)) editId = null;

  async function persist(msg = 'Saved for everyone') {
    try { site = await S.setSite({ field: data }); ctx.site = site; ctx.pickComp(); toast(msg); }
    catch (e) { toast('Not saved: ' + e.message, 5000); }
  }

  function list() {
    fv?.destroy(); fv = null;
    sessionStorage.removeItem('fllsim.editComp');
    el.innerHTML = `
    <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Competitions</h2><span class="spacer"></span><a class="btn" href="#/admin">← Admin</a></div>
    <div class="grid g3">
      ${data.competitions.map(c => `<div class="card">
        <h3>${esc(c.name)} ${c.id === data.defaultId ? '<span class="tag ok">default</span>' : ''}</h3>
        <div class="kv"><span>Field</span><span>${c.width} × ${c.height} mm</span><span>Map image</span><span>${c.image ? 'yes' : 'no'}</span>
          <span>Start zones</span><span>${c.zones.length}</span><span>Scoring spots</span><span>${c.missions.length}</span><span>Rules</span><span>${c.rules?.text ? Math.round(c.rules.text.length / 1000) + 'k chars' : '—'}</span></div>
        <div class="row" style="margin-top:12px"><button class="btn sm primary" data-edit="${c.id}">Edit</button><button class="btn sm" data-dup="${c.id}">Duplicate</button>
          ${c.id !== data.defaultId ? `<button class="btn sm" data-def="${c.id}">Make default</button><button class="btn sm danger" data-del="${c.id}">Delete</button>` : ''}</div>
      </div>`).join('')}
      <form class="card" id="newF"><h3>＋ New competition</h3>
        <label class="f">Name</label><input class="in" name="name" required placeholder="e.g. WRO RoboMission 2026">
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px"><div><label class="f">Width mm</label><input class="in mono" name="w" type="number" min="100" value="2362" required></div>
        <div><label class="f">Height mm</label><input class="in mono" name="h" type="number" min="100" value="1143" required></div></div>
        <label class="f">Field map (PNG / JPG, optional)</label><input class="in" name="img" type="file" accept="image/png,image/jpeg,image/webp">
        <label class="small row" style="margin-top:8px"><input type="checkbox" name="aspect" checked> Work out height from the image shape</label>
        <button class="btn primary" style="margin-top:10px">Create</button></form>
    </div>
    <p class="small muted">Tip: open <a href="#/rules">Rules</a> to read a rules PDF. AI can fill in the field size, match time and scoring spots for you.</p>`;
    $$('[data-edit]').forEach(b => b.onclick = () => edit(b.dataset.edit));
    $$('[data-dup]').forEach(b => b.onclick = async () => { const c = JSON.parse(JSON.stringify(data.competitions.find(c => c.id === b.dataset.dup))); c.id = 'c' + Date.now().toString(36); c.name += ' (copy)'; data.competitions.push(c); await persist('Duplicated'); list(); });
    $$('[data-def]').forEach(b => b.onclick = async () => { data.defaultId = b.dataset.def; await persist('Default changed'); list(); });
    $$('[data-del]').forEach(b => b.onclick = async () => { const c = data.competitions.find(c => c.id === b.dataset.del); if (!confirm(`Delete ${c.name}?`)) return; data.competitions = data.competitions.filter(x => x !== c); await persist('Deleted'); list(); });
    $('#newF').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const c = blankCompetition(f.get('name'), +f.get('w'), +f.get('h'));
      const file = f.get('img');
      if (file?.size) {
        const im = await loadFieldImage(file); c.image = im.dataUrl;
        if (f.get('aspect')) c.height = Math.round(c.width * im.h / im.w);
      }
      c.zones = [{ name: 'Start', x: 0, y: 0, w: Math.round(Math.min(400, c.width / 4)), h: Math.round(Math.min(400, c.height / 3)) }];
      data.competitions.push(c); await persist('Competition created'); edit(c.id);
    };
  }

  function edit(id) {
    const c = data.competitions.find(c => c.id === id); if (!c) return list();
    sessionStorage.setItem('fllsim.editComp', id);
    c.rules ||= {}; c.rules.robotMax ||= { l: 0, w: 0, h: 0 };
    let mode = 'move', drag = null, zoneStart = null, measureA = null;
    el.innerHTML = `
    <div class="row" style="margin-bottom:14px"><button class="btn" id="back">← All competitions</button><h2 style="margin:0">${esc(c.name)}</h2><span class="spacer"></span>
      <button class="btn" id="exportC">Export .json</button><label class="btn">Import .json<input type="file" id="importC" accept=".json" hidden></label><button class="btn primary" id="save">Save</button></div>
    <div class="grid g2">
      <div class="card"><h3>Field</h3>
        <label class="f">Name</label><input class="in" id="cName" value="${esc(c.name)}">
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div><label class="f">Width mm</label><input class="in mono" id="cW" type="number" value="${c.width}"></div>
          <div><label class="f">Height mm</label><input class="in mono" id="cH" type="number" value="${c.height}"></div>
          <div><label class="f">Grid mm</label><input class="in mono" id="cG" type="number" value="${c.grid}"></div></div>
        <label class="small row" style="margin-top:8px"><input type="checkbox" id="scaleAll" checked> Move zones and spots with the size change</label>
        <label class="f">Field map image (PNG / JPG)</label>
        <div class="row"><input class="in" id="cImg" type="file" accept="image/png,image/jpeg,image/webp" style="flex:1"><button class="btn sm" id="imgClear">Remove</button></div>
        <label class="small row" style="margin-top:8px"><input type="checkbox" id="imgAspect" checked> Keep width, set height from the image shape</label>
      </div>
      <div class="card"><h3>Match rules</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
          <div><label class="f">Match s</label><input class="in mono" id="rT" type="number" value="${c.rules.matchTime || 0}"></div>
          <div><label class="f">Robot L mm</label><input class="in mono" id="rL" type="number" value="${c.rules.robotMax.l || 0}"></div>
          <div><label class="f">Robot W mm</label><input class="in mono" id="rWd" type="number" value="${c.rules.robotMax.w || 0}"></div>
          <div><label class="f">Robot H mm</label><input class="in mono" id="rH" type="number" value="${c.rules.robotMax.h || 0}"></div></div>
        <label class="f">Rules summary / notes</label><textarea class="in" id="rS" rows="5">${esc(c.rules.summary || '')}</textarea>
        <p class="small muted" style="margin:6px 0 0">${c.rules.text ? `Rules PDF attached: ${esc(c.rules.fileName || 'rules')} (${Math.round(c.rules.text.length / 1000)}k chars).` : 'No rules PDF yet.'} <a href="#/rules">Open the rules reader →</a></p>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="toolbar">
        <button class="btn sm" data-m="move">✥ Drag</button><button class="btn sm" data-m="spot">＋ Scoring spot</button><button class="btn sm" data-m="zone">▭ Draw start zone</button>
        <button class="btn sm" data-m="measure">📏 Measure to set scale</button><span class="small muted" id="hint" style="align-self:center"></span></div>
      <div class="fieldwrap"><canvas id="fc"></canvas></div>
      <div class="small muted mono" id="pos" style="margin-top:6px">—</div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Start zones</h3><div style="overflow:auto"><table class="t" id="zt"></table></div></div>
      <div class="card"><h3>Scoring spots / missions</h3><div style="overflow:auto"><table class="t" id="mt"></table></div></div>
    </div>`;

    const hints = { move: 'Drag spots or zone corners.', spot: 'Tap the field to place a scoring spot.', zone: 'Drag a rectangle to make a start zone.', measure: 'Tap two points whose real distance you know (e.g. the two ends of a field wall).' };
    const setMode = m => { mode = m; measureA = null; $$('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m)); $('#hint').textContent = hints[m]; };
    $$('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m)); setMode('move');

    const clamp = p => ({ x: Math.round(Math.max(0, Math.min(c.width, p.x))), y: Math.round(Math.max(0, Math.min(c.height, p.y))) });
    fv = new FieldView($('#fc'), {
      field: c, showNames: true,
      onPointer(kind, raw, e, down) {
        const pt = clamp(raw);
        if (kind === 'move') $('#pos').textContent = `x ${pt.x} mm · y ${pt.y} mm`;
        if (kind === 'down') {
          if (mode === 'spot') { const n = c.missions.length + 1; c.missions.push({ id: 'm' + Date.now(), num: String(n).padStart(2, '0'), name: 'Spot ' + n, x: pt.x, y: pt.y, points: null }); fv.draw(); tables(); return; }
          if (mode === 'zone') { zoneStart = pt; c.zones.push({ name: 'Zone ' + (c.zones.length + 1), x: pt.x, y: pt.y, w: 1, h: 1 }); return; }
          if (mode === 'measure') {
            if (!measureA) { measureA = pt; $('#hint').textContent = 'Now tap the second point.'; return; }
            const cur = Math.hypot(pt.x - measureA.x, pt.y - measureA.y); measureA = null;
            const real = parseFloat(prompt(`That distance is ${cur.toFixed(0)} mm on the current scale. What is it really, in mm?`, cur.toFixed(0)));
            if (real > 0 && cur > 1) rescale(real / cur);
            setMode('move'); return;
          }
          // move: spots first, then zone corners/bodies
          let best = null, bd = Math.max(c.width, c.height) * 0.03;
          for (const m of c.missions) { const d = Math.hypot(m.x - pt.x, m.y - pt.y); if (d < bd) { bd = d; best = { m }; } }
          if (!best) c.zones.forEach((z, i) => {
            const d = Math.hypot(z.x + z.w - pt.x, z.y + z.h - pt.y);
            if (d < bd) { bd = d; best = { z, corner: true, i }; }
            else if (!best && pt.x > z.x && pt.x < z.x + z.w && pt.y > z.y && pt.y < z.y + z.h) best = { z, off: [pt.x - z.x, pt.y - z.y], i };
          });
          drag = best; fv.highlight = best?.m?.id; fv.highlightZone = best?.i; fv.draw();
        }
        if (kind === 'move' && down) {
          if (mode === 'zone' && zoneStart) { const z = c.zones.at(-1); z.x = Math.min(zoneStart.x, pt.x); z.y = Math.min(zoneStart.y, pt.y); z.w = Math.abs(pt.x - zoneStart.x); z.h = Math.abs(pt.y - zoneStart.y); fv.draw(); }
          else if (drag?.m) { drag.m.x = pt.x; drag.m.y = pt.y; fv.draw(); }
          else if (drag?.corner) { drag.z.w = Math.max(20, pt.x - drag.z.x); drag.z.h = Math.max(20, pt.y - drag.z.y); fv.draw(); }
          else if (drag?.z) { drag.z.x = Math.max(0, Math.min(c.width - drag.z.w, pt.x - drag.off[0])); drag.z.y = Math.max(0, Math.min(c.height - drag.z.h, pt.y - drag.off[1])); fv.draw(); }
        }
        if (kind === 'up') {
          if (mode === 'zone' && zoneStart) { const z = c.zones.at(-1); if (z.w < 30 || z.h < 30) c.zones.pop(); zoneStart = null; setMode('move'); }
          drag = null; fv.highlightZone = null; tables();
        }
      },
    });

    function rescale(k) {
      c.width = Math.round(c.width * k); c.height = Math.round(c.height * k);
      for (const m of c.missions) { m.x = Math.round(m.x * k); m.y = Math.round(m.y * k); }
      for (const z of c.zones) for (const key of ['x', 'y', 'w', 'h']) z[key] = Math.round(z[key] * k);
      $('#cW').value = c.width; $('#cH').value = c.height; fv.draw(); tables();
      toast(`Field is now ${c.width} × ${c.height} mm`);
    }
    function setSize(w, h) {
      if (!(w > 50 && h > 50)) return;
      const kx = w / c.width, ky = h / c.height;
      if ($('#scaleAll').checked) {
        for (const m of c.missions) { m.x = Math.round(m.x * kx); m.y = Math.round(m.y * ky); }
        for (const z of c.zones) { z.x = Math.round(z.x * kx); z.w = Math.round(z.w * kx); z.y = Math.round(z.y * ky); z.h = Math.round(z.h * ky); }
      }
      c.width = Math.round(w); c.height = Math.round(h); $('#cW').value = c.width; $('#cH').value = c.height; fv.draw(); tables();
    }
    $('#cW').onchange = () => setSize(+$('#cW').value, c.height);
    $('#cH').onchange = () => setSize(c.width, +$('#cH').value);
    $('#cG').onchange = () => { c.grid = Math.max(10, +$('#cG').value || 100); fv.draw(); };
    $('#cName').onchange = () => { c.name = $('#cName').value.trim() || c.name; };
    $('#cImg').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const im = await loadFieldImage(f); c.image = im.dataUrl;
      if ($('#imgAspect').checked) setSize(c.width, c.width * im.h / im.w);
      fv.draw(); toast(`Map loaded (${im.w}×${im.h}px). Check the size, or use 📏 Measure.`, 4000);
    };
    $('#imgClear').onclick = () => { c.image = null; fv.draw(); };
    const num = (id, fn) => $(id).onchange = () => fn(+$(id).value || 0);
    num('#rT', v => c.rules.matchTime = v); num('#rL', v => c.rules.robotMax.l = v); num('#rWd', v => c.rules.robotMax.w = v); num('#rH', v => c.rules.robotMax.h = v);
    $('#rS').onchange = () => { c.rules.summary = $('#rS').value; };

    function tables() {
      $('#zt').innerHTML = '<tr><th>Name</th><th>x</th><th>y</th><th>w</th><th>h</th><th></th></tr>' + c.zones.map((z, i) => `<tr>
        <td><input class="in" data-z="${i}" data-k="name" value="${esc(z.name)}"></td>
        ${['x', 'y', 'w', 'h'].map(k => `<td><input class="in mono" style="width:76px" data-z="${i}" data-k="${k}" value="${z[k]}"></td>`).join('')}
        <td><button class="btn sm danger" data-zrm="${i}">✕</button></td></tr>`).join('');
      $('#mt').innerHTML = '<tr><th>No.</th><th>Name</th><th>x</th><th>y</th><th>Pts</th><th></th></tr>' + c.missions.map((m, i) => `<tr>
        <td><input class="in mono" style="width:56px" data-mi="${i}" data-k="num" value="${esc(m.num)}"></td>
        <td><input class="in" data-mi="${i}" data-k="name" value="${esc(m.name)}"></td>
        <td><input class="in mono" style="width:76px" data-mi="${i}" data-k="x" value="${m.x}"></td>
        <td><input class="in mono" style="width:76px" data-mi="${i}" data-k="y" value="${m.y}"></td>
        <td><input class="in mono" style="width:60px" data-mi="${i}" data-k="points" value="${m.points ?? ''}"></td>
        <td><button class="btn sm danger" data-mrm="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted small">None yet: use ＋ Scoring spot, or let AI read the rules.</td></tr>';
      $$('#zt input').forEach(inp => inp.onchange = () => { const z = c.zones[+inp.dataset.z]; z[inp.dataset.k] = inp.dataset.k === 'name' ? inp.value : +inp.value; fv.draw(); });
      $$('#mt input').forEach(inp => inp.onchange = () => { const m = c.missions[+inp.dataset.mi], k = inp.dataset.k; m[k] = k === 'x' || k === 'y' ? +inp.value : k === 'points' ? (inp.value === '' ? null : +inp.value) : inp.value; fv.draw(); });
      $$('[data-zrm]').forEach(b => b.onclick = () => { c.zones.splice(+b.dataset.zrm, 1); fv.draw(); tables(); });
      $$('[data-mrm]').forEach(b => b.onclick = () => { c.missions.splice(+b.dataset.mrm, 1); fv.draw(); tables(); });
    }
    tables();

    $('#back').onclick = list;
    $('#save').onclick = () => persist();
    $('#exportC').onclick = () => download(c.name.replace(/\W+/g, '_') + '.fllsim.json', JSON.stringify(c, null, 1), 'application/json');
    $('#importC').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const imp = JSON.parse(await f.text());
        if (!(imp.width > 0 && imp.height > 0)) throw new Error('not a competition file');
        Object.assign(c, imp, { id: c.id }); edit(c.id); toast('Imported: press Save');
      } catch (err) { toast('Import failed: ' + err.message); }
    };
  }

  editId ? edit(editId) : list();
}
