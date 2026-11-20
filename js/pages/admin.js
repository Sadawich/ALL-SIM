import { $, $$, esc, toast, reroute, download } from '../app.js';
import { sha256 } from '../store.js';


export async function render(el, ctx) {
  if (ctx.session.kind !== 'admin') {
    el.innerHTML = `<form class="card" id="f" style="max-width:420px;margin:40px auto"><h2>Admin</h2>
      <label class="f">Admin key</label><input class="in mono" name="key" type="password" autocomplete="current-password" required>
      <div class="err" id="err"></div><button class="btn primary">Unlock</button></form>`;
    $('#f').onsubmit = async e => {
      e.preventDefault();
      try { await ctx.store.adminLogin(new FormData(e.target).get('key').trim()); await reroute(); } catch (err) { $('#err').textContent = err.message; }
    };
    return;
  }
  const S = ctx.store;
  let site = await S.getSite();
  let teams = [], programs = [];
  const load = async () => {
    try { teams = await S.listTeams(); } catch (e) { teams = []; toast(e.message); }
    try { programs = await S.listAllPrograms(); } catch (e) { programs = []; }
  };
  await load();

  el.innerHTML = `
  <div class="row" style="margin-bottom:14px"><h2 style="margin:0">Admin</h2><span class="tag ${S.mode === 'cloud' ? 'ok' : 'warn'}">${S.mode} mode</span><span class="spacer"></span><button class="btn" id="out">Log out</button></div>
  ${S.mode === 'local' ? `<div class="note" style="margin-bottom:14px">Local mode: you only see teams and programs saved <b>in this browser</b>, and the lock only applies here.
    Connect Supabase (README, 10 minutes, free) so teams from every device show up here and the lock applies to everyone.</div>` : ''}
  <div class="grid g2">
    <div class="card"><h3>Site lock</h3>
      <p class="small muted" style="margin-top:0">When locked, only approved teams (and you) can open the simulator pages. Home and registration stay open.</p>
      <div class="row"><span id="lockState"></span><span class="spacer"></span><button class="btn" id="lockBtn"></button></div></div>
    <div class="card"><h3>Overview</h3><div class="kv" id="ov"></div></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Teams <span class="row" style="margin-left:auto"><button class="btn sm" id="approveAll">Approve all pending</button><button class="btn sm" id="csv">Export CSV</button></span></h3>
    <div style="overflow:auto"><table class="t" id="teams"></table></div></div>
  <div class="card" style="margin-top:16px"><h3>Saved programs (all teams)</h3>
    <select class="in" id="progSel"></select><pre class="code" id="progCode" style="margin-top:10px">Pick a program.</pre></div>
  <div class="card" style="margin-top:16px"><h3>Competitions & fields</h3>
    <p class="small muted" style="margin-top:0">${ctx.comps.length} competition(s). Add a field map (PNG/JPG), set its real size, start zones and scoring spots, and attach the rules.</p>
    <div class="row"><a class="btn primary" href="#/comps">Manage competitions →</a><a class="btn" href="#/rules">Rules reader →</a></div></div>
  <div class="card" style="margin-top:16px"><h3>Change admin key</h3>
    <p class="small muted" style="margin-top:0">Type a new key and get its hash. Put the hash in <span class="mono">js/config.js</span> (<span class="mono">adminKeyHash</span>) on GitHub.${S.mode === 'cloud' ? ' In cloud mode, also set the same key as the admin user’s password in Supabase.' : ''}</p>
    <div class="row"><input class="in mono" id="nk" placeholder="new admin key (12+ characters)" style="flex:1;min-width:220px"><button class="btn" id="hk">Make hash</button></div>
    <pre class="code" id="hash" style="margin-top:10px">—</pre></div>`;

  $('#out').onclick = async () => { await S.logout(); await reroute(); };

  function lockUI() {
    $('#lockState').innerHTML = site.locked ? '<span class="tag bad">🔒 Locked</span>' : '<span class="tag ok">🔓 Open to everyone</span>';
    $('#lockBtn').textContent = site.locked ? 'Unlock site' : 'Lock site';
  }
  lockUI();
  $('#lockBtn').onclick = async () => { try { site = await S.setSite({ locked: !site.locked }); ctx.site = site; ctx.pickComp(); lockUI(); toast(site.locked ? 'Site locked' : 'Site unlocked'); } catch (e) { toast(e.message); } };

  function teamsUI() {
    const by = s => teams.filter(t => t.status === s).length;
    $('#ov').innerHTML = [['Teams', teams.length], ['Approved', by('approved')], ['Pending', by('pending')], ['Blocked', by('blocked')], ['Programs', programs.length]]
      .map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    $('#teams').innerHTML = `<tr><th>Team</th><th>Captain</th><th>Email</th><th>Registered</th><th>Status</th><th></th></tr>` +
      (teams.map(t => `<tr><td><b>${esc(t.team_name)}</b></td><td>${esc(t.captain)}</td><td class="mono small">${esc(t.email)}</td>
        <td class="small muted">${new Date(t.created_at).toLocaleDateString()}</td>
        <td><span class="tag ${t.status === 'approved' ? 'ok' : t.status === 'pending' ? 'warn' : 'bad'}">${t.status}</span></td>
        <td><div class="row" style="justify-content:flex-end">
          ${t.status !== 'approved' ? `<button class="btn sm teal" data-a="approved" data-id="${t.id}">Approve</button>` : ''}
          ${t.status !== 'blocked' ? `<button class="btn sm" data-a="blocked" data-id="${t.id}">Block</button>` : ''}
          <button class="btn sm danger" data-a="remove" data-id="${t.id}">Remove</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No teams yet.</td></tr>');
    $$('#teams [data-a]').forEach(b => b.onclick = async () => {
      const t = teams.find(t => t.id === b.dataset.id);
      try {
        if (b.dataset.a === 'remove') { if (!confirm(`Remove ${t.team_name} and all their programs?`)) return; await S.removeTeam(t.id); }
        else await S.setTeamStatus(t.id, b.dataset.a);
        await load(); teamsUI(); progUI();
      } catch (e) { toast(e.message); }
    });
  }
  $('#approveAll').onclick = async () => { for (const t of teams.filter(t => t.status === 'pending')) await S.setTeamStatus(t.id, 'approved'); await load(); teamsUI(); };
  $('#csv').onclick = () => download('teams.csv', 'team,captain,email,status,registered\n' + teams.map(t => [t.team_name, t.captain, t.email, t.status, t.created_at].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  teamsUI();

  function progUI() {
    $('#progSel').innerHTML = '<option value="">— choose —</option>' + programs.map(p => `<option value="${p.id}">${esc(p.team_name)} · ${esc(p.name)} (${new Date(p.updated_at).toLocaleString()})</option>`).join('');
    $('#progSel').onchange = () => { const p = programs.find(p => p.id === $('#progSel').value); $('#progCode').textContent = p ? p.code : 'Pick a program.'; };
  }
  progUI();

  $('#hk').onclick = async () => {
    const k = $('#nk').value.trim();
    if (k.length < 12) return toast('Use at least 12 characters');
    $('#hash').textContent = `adminKeyHash: '${await sha256('fllsim:' + k)}',`;
  };
}
