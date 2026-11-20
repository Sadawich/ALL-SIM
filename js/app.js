import { CONFIG } from './config.js';
import { store } from './store.js';
import { defaultBuild, computeStats } from './robot.js';

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, ms = 2400) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed: select and copy by hand'); }
}

const pages = {
  '': () => import('./pages/home.js'),
  sim: () => import('./pages/sim.js'),
  soccer: () => import('./pages/soccer.js'),
  builder: () => import('./pages/builder.js'),
  field: () => import('./pages/field.js'),
  code: () => import('./pages/code.js'),
  account: () => import('./pages/account.js'),
  admin: () => import('./pages/admin.js'),
  rules: () => import('./pages/rules.js'),
  comps: () => import('./pages/comps.js'),
};
const OPEN_WHEN_LOCKED = new Set(['', 'account', 'admin', 'comps']);

export const ctx = {
  store, config: CONFIG, session: { kind: 'guest' }, site: null, build: null, robot: null,
  async refresh() {
    this.session = await store.session();
    this.site = await store.getSite();
    this.build = (await store.getRobot()) || defaultBuild();
    this.robot = computeStats(this.build);
    this.pickComp();
    renderWho();
  },
  get comps() { return this.site.field.competitions; },
  pickComp() {
    let id = null; try { id = localStorage.getItem('fllsim.comp'); } catch { }
    this.comp = this.comps.find(c => c.id === id) || this.comps.find(c => c.id === this.site.field.defaultId) || this.comps[0];
    const sel = $('#compSel');
    sel.innerHTML = this.comps.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    sel.value = this.comp?.id;
  },
  setComp(id) { try { localStorage.setItem('fllsim.comp', id); } catch { } this.pickComp(); },
  async saveBuild(build) {
    this.build = build; this.robot = computeStats(build);
    await store.saveRobot(build);
  },
  canUse() {
    if (this.session.kind === 'team' && this.session.team.status === 'blocked') return false;
    if (!this.site?.locked) return true;
    return this.session.kind === 'admin' || (this.session.kind === 'team' && this.session.team.status === 'approved');
  },
  go(r) { location.hash = '#/' + r; },
};

function renderWho() {
  const s = ctx.session, el = $('#who');
  const mode = store.mode === 'cloud' ? '' : '<span class="tag" title="Data is saved in this browser only">local</span> ';
  if (s.kind === 'admin') el.innerHTML = mode + '<b>Admin</b>';
  else if (s.kind === 'team') el.innerHTML = mode + `<b>${esc(s.team.team_name)}</b> ${s.team.status === 'approved' ? '' : '<span class="tag warn">pending</span>'}`;
  else el.innerHTML = mode + 'Guest';
}

let current = null;
async function route() {
  const r = (location.hash.replace(/^#\/?/, '').split('?')[0]) || '';
  const key = pages[r] ? r : '';
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.r === key));
  const view = $('#view');
  if (current?.destroy) { try { current.destroy(); } catch { } }
  current = null;
  if (!ctx.canUse() && !OPEN_WHEN_LOCKED.has(key)) {
    view.innerHTML = `<div class="lock card"><div class="big">🔒</div><h2>${esc(CONFIG.siteName)} is locked</h2>
      <p class="muted">Only approved teams can use the simulator right now.</p>
      <div class="row" style="justify-content:center"><a class="btn primary" href="#/account">Register or log in</a></div></div>`;
    return;
  }
  view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const mod = await pages[key]();
    view.innerHTML = '';
    current = mod;
    await mod.render(view, ctx);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h3>Something went wrong</h3><pre class="code">${esc(e.stack || e)}</pre></div>`;
  }
}

async function start() {
  document.title = CONFIG.siteName + ' — turn & route lab';
  $('#brandName').textContent = CONFIG.siteName; $('#footName').textContent = CONFIG.siteName;
  await store.init();
  await ctx.refresh();
  addEventListener('hashchange', route);
  $('#compSel').onchange = e => { ctx.setComp(e.target.value); sessionStorage.removeItem('fllsim.route'); route(); };
  route();
}
export async function reroute() { await ctx.refresh(); route(); }
start();
