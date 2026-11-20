import { $, $$, esc, toast } from '../app.js';
import { aiSettings, saveAiSettings, askClaude, ruleBlocks, parseJSON, SETUP_SYSTEM, QA_SYSTEM } from '../ai.js';

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}
// Keep the PDF open while switching tabs in this session
const session = { pdf: null, doc: null, name: '', pages: [], compId: null };
let renderTask = null;
let onResize = null;
export function destroy() { renderTask?.cancel?.(); if (onResize) removeEventListener('resize', onResize); }

// --- simple number finder ---
function findNumbers(pages) {
  const out = { dims: [], times: [], robot: [] };
  const toMM = (v, u) => { v = parseFloat(String(v).replace(',', '.')); u = (u || 'mm').toLowerCase(); return Math.round(u.startsWith('c') ? v * 10 : u === 'm' ? v * 1000 : /^(in|inch|")/.test(u) ? v * 25.4 : /^(ft|feet|')/.test(u) ? v * 304.8 : v); };
  const U = '(mm|cm|m|in|inch(?:es)?|ft|feet|"|\')?';
  const reDim = new RegExp(`(\\d{1,4}(?:[.,]\\d+)?)\\s*${U}\\s*[x×X]\\s*(\\d{1,4}(?:[.,]\\d+)?)\\s*${U}(?:\\s*[x×X]\\s*(\\d{1,4}(?:[.,]\\d+)?)\\s*${U})?`, 'g');
  pages.forEach((t, i) => {
    for (const m of t.matchAll(reDim)) {
      const u = m[4] || m[2] || m[6]; if (!u) continue;
      const a = toMM(m[1], u), b = toMM(m[3], u), c = m[5] ? toMM(m[5], u) : null;
      const ctx = t.slice(Math.max(0, m.index - 70), m.index).toLowerCase();
      const item = { a, b, c, raw: m[0].trim(), page: i + 1, ctx: t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 20).replace(/\s+/g, ' ') };
      if (c || /robot|size|dimension|fit|inspection/.test(ctx)) out.robot.push(item);
      if (!c && a >= 500 && b >= 300) out.dims.push(item);
    }
    for (const m of t.matchAll(/(\d+)\s*(?:min(?:ute)?s?)\s*(?:and\s*)?(?:(\d+)\s*(?:sec(?:ond)?s?))?|(\d{2,3})\s*(?:sec(?:ond)?s?|s)\b/gi)) {
      const s = m[3] ? +m[3] : +m[1] * 60 + (+m[2] || 0);
      const ctx = t.slice(Math.max(0, m.index - 60), m.index + 40).toLowerCase();
      if (s >= 30 && s <= 600 && /match|round|game|run|period/.test(ctx)) out.times.push({ s, raw: m[0], page: i + 1, ctx: ctx.replace(/\s+/g, ' ') });
    }
  });
  const uniq = (l, k) => [...new Map(l.map(x => [k(x), x])).values()].slice(0, 8);
  return { dims: uniq(out.dims, x => x.a + 'x' + x.b), times: uniq(out.times, x => x.s), robot: uniq(out.robot, x => x.raw) };
}

export async function render(el, ctx) {
  const comp = ctx.comp, isAdmin = ctx.session.kind === 'admin';
  if (session.compId !== comp.id) { session.pdf = null; session.doc = null; session.pages = []; session.name = ''; session.compId = comp.id; }
  if (!session.pages.length && comp.rules?.text) { session.pages = comp.rules.text.split('\f'); session.name = comp.rules.fileName || 'Rules'; }
  let page = 1, zoom = 1;
  const ai = aiSettings();

  el.innerHTML = `
  <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Rules · ${esc(comp.name)}</h2><span class="spacer"></span>
    <label class="btn primary">📄 Open rules PDF<input type="file" id="pdfIn" accept="application/pdf" hidden></label>
    ${isAdmin ? '<button class="btn" id="attach">Attach to competition</button>' : ''}</div>
  <div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px" id="rulesGrid">
    <div class="card" style="padding:12px">
      <div class="row toolbar">
        <button class="btn sm" id="prev">◀</button><span class="mono small" id="pageNo">—</span><button class="btn sm" id="next">▶</button>
        <button class="btn sm" id="zOut">−</button><button class="btn sm" id="zIn">＋</button>
        <span class="spacer"></span><span class="small muted" id="docName"></span>
      </div>
      <div id="viewer" style="overflow:auto;max-height:78vh;background:#0a0e14;border-radius:10px;border:1px solid var(--line)"></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Search</h3>
        <input class="in" id="q" placeholder="e.g. robot size, time, penalty, home">
        <div id="hits" class="small" style="max-height:220px;overflow:auto;margin-top:8px"></div></div>
      <div class="card"><h3>Numbers found in the rules <span class="tag">auto</span></h3><div id="nums" class="small"></div></div>
      <div class="card"><h3>Ask AI about the rules</h3>
        <div class="row"><input class="in" id="ask" placeholder="Can the robot leave the start zone before the beep?" style="flex:1"><button class="btn teal" id="askBtn">Ask</button></div>
        <div id="ans" class="small" style="white-space:pre-wrap;margin-top:10px;max-height:320px;overflow:auto"></div>
        ${isAdmin ? `<hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
          <button class="btn primary" id="setupBtn">✨ Build field setup from rules${comp.image ? ' + map' : ''}</button>
          <p class="small muted" style="margin:6px 0 0">Reads the rules${comp.image ? ' and looks at the field map' : ''} to fill in field size, match time, robot size limit, start zones and scoring spots. You check it before saving.</p>
          <div id="setupOut"></div>` : ''}
        <details style="margin-top:14px"${ai.key ? '' : ' open'}><summary class="small muted" style="cursor:pointer">AI settings <span id="keyTag">${ai.key ? '<span class="tag ok">key set</span>' : '<span class="tag warn">no key</span>'}</span></summary>
          <label class="f">Anthropic API key (saved only in this browser)</label><input class="in mono" id="aiKey" type="password" value="${esc(ai.key)}" placeholder="sk-ant-…">
          <label class="f">Model</label><input class="in mono" id="aiModel" value="${esc(ai.model)}">
          <div class="row" style="margin-top:8px"><button class="btn sm" id="aiSave">Save</button><button class="btn sm danger" id="aiForget">Forget key</button></div>
          <p class="small muted">Get a key at console.anthropic.com. Questions are sent straight from this browser to Anthropic and billed to that key. PDF search and the number finder work without a key.</p>
        </details></div>
    </div>
  </div>`;
  const narrow = () => { $('#rulesGrid').style.gridTemplateColumns = innerWidth < 900 ? '1fr' : 'minmax(0,1.3fr) minmax(0,1fr)'; };
  narrow(); onResize = narrow; addEventListener('resize', narrow);

  async function showPage() {
    const v = $('#viewer'); const n = session.pages.length;
    $('#pageNo').textContent = n ? `${page} / ${n}` : '—';
    $('#docName').textContent = session.name || '';
    if (!n) { v.innerHTML = `<p class="muted" style="padding:30px;text-align:center">Open the rules PDF for ${esc(comp.name)}.<br><span class="small">${isAdmin ? 'Then press “Attach to competition” so every team can read it.' : 'Ask the admin to attach it so it opens here automatically.'}</span></p>`; return; }
    if (session.doc) {
      renderTask?.cancel?.();
      const p = await session.doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const scale = (v.clientWidth - 4) / base.width * zoom, dpr = devicePixelRatio || 1;
      const vp = p.getViewport({ scale: scale * dpr });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = (vp.width / dpr) + 'px'; c.style.display = 'block';
      v.innerHTML = ''; v.appendChild(c);
      renderTask = p.render({ canvasContext: c.getContext('2d'), viewport: vp });
      try { await renderTask.promise; } catch { }
    } else {
      v.innerHTML = `<pre style="white-space:pre-wrap;padding:14px;margin:0;font:13px/1.55 system-ui;color:#dbe5f1">${esc(session.pages[page - 1])}</pre>`;
    }
  }
  function go(p) { page = Math.max(1, Math.min(session.pages.length || 1, p)); showPage(); }
  $('#prev').onclick = () => go(page - 1); $('#next').onclick = () => go(page + 1);
  $('#zIn').onclick = () => { zoom = Math.min(3, zoom * 1.25); showPage(); }; $('#zOut').onclick = () => { zoom = Math.max(0.5, zoom / 1.25); showPage(); };

  function numbersUI() {
    if (!session.pages.length) { $('#nums').innerHTML = '<span class="muted">Open a PDF first.</span>'; return; }
    const f = findNumbers(session.pages);
    const chip = (label, attrs, title) => `<button class="btn sm" ${attrs} title="${esc(title)}" style="margin:2px">${esc(label)}</button>`;
    $('#nums').innerHTML = `
      <div class="muted" style="margin:4px 0">Field-size candidates</div>${f.dims.map(d => chip(`${d.a} × ${d.b} mm · p.${d.page}`, `data-dim="${d.a},${d.b}" data-pg="${d.page}"`, d.ctx)).join('') || '<span class="muted">none</span>'}
      <div class="muted" style="margin:8px 0 4px">Match-time candidates</div>${f.times.map(t => chip(`${t.s} s · p.${t.page}`, `data-time="${t.s}" data-pg="${t.page}"`, t.ctx)).join('') || '<span class="muted">none</span>'}
      <div class="muted" style="margin:8px 0 4px">Robot-size candidates</div>${f.robot.map(d => chip(`${d.a} × ${d.b}${d.c ? ' × ' + d.c : ''} mm · p.${d.page}`, `data-robot="${d.a},${d.b},${d.c || 0}" data-pg="${d.page}"`, d.ctx)).join('') || '<span class="muted">none</span>'}
      ${isAdmin ? '<label class="row" style="margin-top:10px"><input type="checkbox" id="useMode"> Tapping a value saves it to this competition</label>' : ''}
      <p class="muted" style="margin:6px 0 0">Tap a value to jump to its page.</p>`;
    $$('#nums [data-pg]').forEach(b => {
      b.onclick = async () => {
        if (!(isAdmin && $('#useMode')?.checked)) return go(+b.dataset.pg);
        const c = ctx.site.field.competitions.find(c => c.id === comp.id);
        if (b.dataset.dim) { const [w, h] = b.dataset.dim.split(',').map(Number); if (!confirm(`Set field size to ${Math.max(w, h)} × ${Math.min(w, h)} mm?`)) return; c.width = Math.max(w, h); c.height = Math.min(w, h); }
        if (b.dataset.time) { if (!confirm(`Set match time to ${b.dataset.time} s?`)) return; c.rules.matchTime = +b.dataset.time; }
        if (b.dataset.robot) { const [l, w, h] = b.dataset.robot.split(',').map(Number); if (!confirm(`Set robot limit to ${l} × ${w} × ${h} mm?`)) return; c.rules.robotMax = { l, w, h }; }
        await saveComps('Competition updated');
      };
    });
  }
  async function saveComps(msg) {
    try { ctx.site = await ctx.store.setSite({ field: ctx.site.field }); ctx.pickComp(); toast(msg); } catch (e) { toast('Not saved: ' + e.message, 5000); }
  }

  // search
  $('#q').oninput = () => {
    const q = $('#q').value.trim().toLowerCase(); const out = [];
    if (q.length >= 2) session.pages.forEach((t, i) => {
      const low = t.toLowerCase(); let idx = low.indexOf(q), n = 0;
      while (idx >= 0 && n < 3) { out.push({ p: i + 1, s: t.slice(Math.max(0, idx - 60), idx + q.length + 60).replace(/\s+/g, ' '), at: idx - Math.max(0, idx - 60) }); idx = low.indexOf(q, idx + q.length); n++; }
    });
    $('#hits').innerHTML = out.slice(0, 60).map(h => {
      const pre = esc(h.s.slice(0, h.at)), hit = esc(h.s.slice(h.at, h.at + q.length)), post = esc(h.s.slice(h.at + q.length));
      return `<div class="wp" style="grid-template-columns:44px 1fr;cursor:pointer" data-go="${h.p}"><span class="n">p.${h.p}</span><span>…${pre}<mark>${hit}</mark>${post}…</span></div>`;
    }).join('') || (q.length >= 2 ? '<span class="muted">No matches.</span>' : '');
    $$('#hits [data-go]').forEach(d => d.onclick = () => go(+d.dataset.go));
  };

  // open PDF
  $('#pdfIn').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    $('#viewer').innerHTML = '<p class="muted" style="padding:30px;text-align:center">Reading PDF…</p>';
    try {
      const lib = await loadPdfJs();
      const buf = await file.arrayBuffer();
      session.pdf = buf.slice(0);
      session.doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      session.name = file.name; session.pages = [];
      const N = Math.min(session.doc.numPages, 400);
      for (let i = 1; i <= N; i++) {
        const tc = await (await session.doc.getPage(i)).getTextContent();
        session.pages.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim());
        if (i % 10 === 0) $('#viewer').innerHTML = `<p class="muted" style="padding:30px;text-align:center">Reading page ${i} / ${N}…</p>`;
      }
      const chars = session.pages.join('').length;
      page = 1; showPage(); numbersUI();
      toast(chars < 200 ? 'This PDF has almost no text (scanned?). AI can still read it.' : `Loaded ${N} pages`, 3500);
    } catch (err) { console.error(err); $('#viewer').innerHTML = `<p class="err" style="padding:20px">Could not read this PDF: ${esc(err.message)}</p>`; }
  };

  if (isAdmin) $('#attach').onclick = async () => {
    if (!session.pages.length) return toast('Open a PDF first');
    const c = ctx.site.field.competitions.find(c => c.id === comp.id);
    c.rules = { ...(c.rules || {}), text: session.pages.join('\f'), fileName: session.name };
    await saveComps('Rules attached: every team can read and search them now');
  };

  // AI
  $('#aiSave').onclick = () => { saveAiSettings({ key: $('#aiKey').value.trim(), model: $('#aiModel').value.trim() || 'claude-sonnet-5-5' }); toast('AI settings saved in this browser'); $('#keyTag').innerHTML = $('#aiKey').value.trim() ? '<span class="tag ok">key set</span>' : '<span class="tag warn">no key</span>'; };
  $('#aiForget').onclick = () => { saveAiSettings({ key: '', model: $('#aiModel').value.trim() }); $('#aiKey').value = ''; toast('Key removed'); };
  const source = () => ({ pdf: session.pdf, text: session.pages.join('\f'), name: session.name });

  $('#askBtn').onclick = async () => {
    const q = $('#ask').value.trim(); if (!q) return;
    if (!session.pages.length) return toast('Open a PDF first');
    $('#ans').innerHTML = '<span class="muted">Thinking…</span>';
    try {
      const a = await askClaude({ system: QA_SYSTEM, content: [...ruleBlocks(source()), { type: 'text', text: q }], maxTokens: 1200 });
      $('#ans').innerHTML = esc(a).replace(/\(p(?:age)?\.?\s*(\d+)\)/g, (m, p) => `<a href="javascript:void 0" data-go="${p}">${m}</a>`);
      $$('#ans [data-go]').forEach(d => d.onclick = () => go(+d.dataset.go));
    } catch (err) { $('#ans').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  };
  $('#ask').onkeydown = e => { if (e.key === 'Enter') $('#askBtn').click(); };

  if (isAdmin) $('#setupBtn').onclick = async () => {
    if (!session.pages.length && !comp.image) return toast('Open a PDF (or add a field map) first');
    const out = $('#setupOut'); out.innerHTML = '<p class="muted small">Reading the rules… this can take 30–60 s.</p>';
    try {
      const content = [];
      if (session.pages.length) content.push(...ruleBlocks(source()));
      if (comp.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: comp.image.split(',')[1] } }, { type: 'text', text: 'Above is the field map image. Use it for the *_frac positions.' });
      content.push({ type: 'text', text: `Current field size in the simulator: ${comp.width} × ${comp.height} mm. Build the setup JSON.` });
      const j = parseJSON(await askClaude({ system: SETUP_SYSTEM, content, maxTokens: 4000 }));
      const W = j.field_width_mm || comp.width, H = j.field_height_mm || comp.height;
      const rows = (j.scoring || []).map((s, i) => `<tr><td>${String(i + 1).padStart(2, '0')}</td><td>${esc(s.name)}</td><td class="mono">${s.points ?? '—'}</td><td class="mono">${s.x_frac != null ? Math.round(s.x_frac * W) + ', ' + Math.round(s.y_frac * H) : 'place by hand'}</td><td class="mono">${s.page ? 'p.' + s.page : ''}</td></tr>`).join('');
      out.innerHTML = `<div class="note" style="margin-top:10px">
        <div class="kv"><span>Name</span><span>${esc(j.name || comp.name)}</span><span>Field</span><span>${W} × ${H} mm</span><span>Match time</span><span>${j.match_time_s ?? '—'} s</span>
        <span>Robot limit</span><span>${['l', 'w', 'h'].map(k => j.robot_max_mm?.[k] ?? '—').join(' × ')} mm</span><span>Start zones</span><span>${(j.start_zones || []).length}</span></div>
        <div style="overflow:auto;max-height:240px;margin-top:8px"><table class="t"><tr><th>#</th><th>Scoring</th><th>Pts</th><th>Spot (mm)</th><th></th></tr>${rows}</table></div>
        <pre class="small" style="white-space:pre-wrap;margin:8px 0">${esc(j.summary || '')}</pre>
        <label class="small row"><input type="checkbox" id="keepSpots"> Keep my existing scoring spots (only update numbers)</label>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="applySetup">Apply to ${esc(comp.name)}</button><span class="small muted">AI can be wrong: check against the PDF.</span></div></div>`;
      $('#applySetup').onclick = async () => {
        const c = ctx.site.field.competitions.find(c => c.id === comp.id);
        const kx = W / c.width, ky = H / c.height;
        c.width = Math.round(W); c.height = Math.round(H);
        if (j.name && confirm(`Rename to “${j.name}”?`)) c.name = j.name;
        c.rules = { ...(c.rules || {}), matchTime: j.match_time_s ?? c.rules?.matchTime ?? 0, robotMax: { l: j.robot_max_mm?.l || 0, w: j.robot_max_mm?.w || 0, h: j.robot_max_mm?.h || 0 }, summary: j.summary || c.rules?.summary || '' };
        if (session.pages.length) { c.rules.text = session.pages.join('\f'); c.rules.fileName = session.name; }
        if ((j.start_zones || []).length) c.zones = j.start_zones.map(z => ({ name: z.name, x: Math.round(z.x_frac * W), y: Math.round(z.y_frac * H), w: Math.round(z.w_frac * W), h: Math.round(z.h_frac * H) }));
        else c.zones.forEach(z => { z.x = Math.round(z.x * kx); z.w = Math.round(z.w * kx); z.y = Math.round(z.y * ky); z.h = Math.round(z.h * ky); });
        if (!$('#keepSpots').checked && (j.scoring || []).length) {
          const cols = Math.ceil(Math.sqrt(j.scoring.length));
          c.missions = j.scoring.map((s, i) => ({ id: 'm' + i + Date.now(), num: String(i + 1).padStart(2, '0'), name: s.name, points: s.points ?? null,
            x: Math.round(s.x_frac != null ? s.x_frac * W : W * (0.2 + 0.6 * (i % cols) / Math.max(1, cols - 1))),
            y: Math.round(s.y_frac != null ? s.y_frac * H : H * (0.8 - 0.6 * Math.floor(i / cols) / Math.max(1, cols - 1))) }));
        }
        await saveComps('Setup applied. Fine-tune it in Competitions.');
        sessionStorage.setItem('fllsim.editComp', c.id); ctx.go('comps');
      };
    } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  };

  showPage(); numbersUI();
}
