import { $, esc, toast, reroute } from '../app.js';

export async function render(el, ctx) {
  const s = ctx.session;
  if (s.kind === 'team') {
    const t = s.team;
    el.innerHTML = `<div class="card" style="max-width:560px;margin:20px auto">
      <h2>${esc(t.team_name)}</h2>
      <div class="kv"><span>Captain</span><span>${esc(t.captain || '—')}</span><span>Email</span><span>${esc(t.email)}</span>
      <span>Status</span><span>${t.status === 'approved' ? '<span class="tag ok">approved</span>' : '<span class="tag warn">waiting for approval</span>'}</span></div>
      ${t.status !== 'approved' ? `<p class="note" style="margin-top:12px">The site admin needs to approve your team. ${ctx.site.locked ? 'Until then the simulator is locked for you.' : 'You can already use everything; your work is saved in this browser.'}</p>` : ''}
      <div class="row" style="margin-top:14px"><a class="btn primary" href="#/sim">Open the turn lab</a><button class="btn" id="out">Log out</button></div></div>`;
    $('#out').onclick = async () => { await ctx.store.logout(); await reroute(); };
    return;
  }
  if (s.kind === 'admin') {
    el.innerHTML = `<div class="card" style="max-width:560px;margin:20px auto"><h2>You're logged in as admin</h2>
      <div class="row"><a class="btn primary" href="#/admin">Admin panel</a><button class="btn" id="out">Log out</button></div></div>`;
    $('#out').onclick = async () => { await ctx.store.logout(); await reroute(); };
    return;
  }
  el.innerHTML = `
  <div class="grid g2" style="max-width:900px;margin:10px auto">
    <form class="card" id="reg"><h2>Register your team</h2>
      <label class="f">Team name</label><input class="in" name="team" required maxlength="60">
      <label class="f">Captain / coach</label><input class="in" name="captain" maxlength="60">
      <label class="f">Email</label><input class="in" name="email" type="email" required>
      <label class="f">Password</label><input class="in" name="password" type="password" minlength="6" required>
      <div class="err" id="regErr"></div>
      <button class="btn primary" style="margin-top:6px">Register team →</button>
      <p class="small muted">New teams wait for the admin to approve them.</p>
    </form>
    <form class="card" id="log"><h2>Log in</h2>
      <label class="f">Email</label><input class="in" name="email" type="email" required>
      <label class="f">Password</label><input class="in" name="password" type="password" required>
      <div class="err" id="logErr"></div>
      <button class="btn teal" style="margin-top:6px">Log in</button>
      ${ctx.store.mode === 'local' ? '<p class="note" style="margin-top:14px">This site runs in <b>local mode</b>: accounts live in this browser only.</p>' : ''}
    </form>
  </div>`;
  $('#reg').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await ctx.store.register(f); toast('Team registered'); await reroute(); } catch (err) { $('#regErr').textContent = err.message; }
  };
  $('#log').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await ctx.store.login(f.email, f.password); await reroute(); } catch (err) { $('#logErr').textContent = err.message; }
  };
}
