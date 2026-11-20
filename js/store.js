// FLL SIM storage: LOCAL mode (localStorage) or CLOUD mode (Supabase).
import { CONFIG } from './config.js';

// A "competition" = field map + real size + start zones + scoring spots + rules.
export function defaultCompetition() {
  const W = 2362, H = 1143;
  const pts = [
    [520, 860], [820, 960], [1060, 820], [1300, 960], [1560, 860], [1840, 940],
    [640, 420], [940, 300], [1180, 520], [1420, 300], [1700, 420], [1760, 700],
  ];
  return {
    id: 'fll-bioglow', name: 'FLL BIOGLOW', width: W, height: H, grid: 100,
    missions: pts.map(([x, y], i) => ({ id: 'm' + (i + 1), num: String(i + 1).padStart(2, '0'), name: 'Mission ' + (i + 1), x, y, points: null })),
    zones: [{ name: 'Left launch', x: 0, y: 0, w: 380, h: 600 }, { name: 'Right launch', x: W - 380, y: 0, w: 380, h: 600 }],
    image: null,
    rules: { text: '', fileName: '', summary: '', matchTime: 150, robotMax: { l: 0, w: 0, h: 0 } },
  };
}
export function blankCompetition(name = 'New competition', width = 2400, height = 1200) {
  return {
    id: 'c' + Date.now().toString(36), name, width, height, grid: 100, missions: [],
    zones: [{ name: 'Start', x: 0, y: 0, w: Math.min(400, width / 4), h: Math.min(400, height / 3) }],
    image: null, rules: { text: '', fileName: '', summary: '', matchTime: 0, robotMax: { l: 0, w: 0, h: 0 } },
  };
}
// Older saves stored a single FLL field; convert to the competitions list.
export function normalizeSite(site) {
  const s = { locked: !!site?.locked, field: site?.field };
  let f = s.field;
  if (!f || !Array.isArray(f.competitions)) {
    const c = defaultCompetition();
    if (f?.missions) { c.missions = f.missions; c.image = f.image || null; if (f.season) c.name = 'FLL ' + f.season; }
    f = { competitions: [c], defaultId: c.id };
  }
  f.competitions.forEach(c => { c.zones ||= []; c.missions ||= []; c.rules ||= { text: '' }; c.grid ||= 100; });
  if (!f.competitions.some(c => c.id === f.defaultId)) f.defaultId = f.competitions[0]?.id;
  s.field = f;
  return s;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const ls = {
  get(k, d) { try { const v = localStorage.getItem('fllsim.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fllsim.' + k, JSON.stringify(v)); } catch (e) { console.warn(e); } },
  del(k) { try { localStorage.removeItem('fllsim.' + k); } catch { } },
};

// ---------------------------------------------------------------- LOCAL
class LocalStore {
  mode = 'local';
  async init() { }
  async session() {
    const s = ls.get('session', null);
    if (s?.admin) return { kind: 'admin' };
    if (s?.teamId) {
      const t = ls.get('teams', []).find(t => t.id === s.teamId);
      if (t) return { kind: 'team', team: t };
    }
    return { kind: 'guest' };
  }
  async register({ team, captain, email, password }) {
    const teams = ls.get('teams', []);
    if (teams.some(t => t.email.toLowerCase() === email.toLowerCase())) throw new Error('That email is already registered.');
    const t = { id: uid(), team_name: team, captain, email, pw: await sha256('pw:' + email.toLowerCase() + password), status: 'pending', created_at: new Date().toISOString() };
    teams.push(t); ls.set('teams', teams);
    ls.set('session', { teamId: t.id });
    return t;
  }
  async login(email, password) {
    const t = ls.get('teams', []).find(t => t.email.toLowerCase() === email.toLowerCase());
    if (!t || t.pw !== await sha256('pw:' + email.toLowerCase() + password)) throw new Error('Wrong email or password.');
    ls.set('session', { teamId: t.id });
    return t;
  }
  async adminLogin(key) {
    if (await sha256('fllsim:' + key) !== CONFIG.adminKeyHash) throw new Error('Wrong admin key.');
    ls.set('session', { admin: true });
  }
  async logout() { ls.del('session'); }
  async getSite() { return normalizeSite(ls.get('site', null)); }
  async setSite(patch) { const s = { ...(await this.getSite()), ...patch }; ls.set('site', s); return s; }
  async listTeams() { return ls.get('teams', []).map(({ pw, ...t }) => t); }
  async setTeamStatus(id, status) { ls.set('teams', ls.get('teams', []).map(t => t.id === id ? { ...t, status } : t)); }
  async removeTeam(id) { ls.set('teams', ls.get('teams', []).filter(t => t.id !== id)); ls.del('programs.' + id); ls.del('robot.' + id); }
  owner(s) { return s.kind === 'team' ? s.team.id : s.kind === 'admin' ? 'admin' : 'guest'; }
  async getPrograms() { return ls.get('programs.' + this.owner(await this.session()), []); }
  async saveProgram(p) {
    const key = 'programs.' + this.owner(await this.session());
    const list = ls.get(key, []);
    if (!p.id) p.id = uid();
    p.updated_at = new Date().toISOString();
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    ls.set(key, list); return p;
  }
  async deleteProgram(id) { const key = 'programs.' + this.owner(await this.session()); ls.set(key, ls.get(key, []).filter(p => p.id !== id)); }
  async listAllPrograms() {
    const teams = ls.get('teams', []);
    return teams.flatMap(t => ls.get('programs.' + t.id, []).map(p => ({ ...p, team_name: t.team_name })));
  }
  async getRobot() { return ls.get('robot.' + this.owner(await this.session()), null); }
  async saveRobot(r) { ls.set('robot.' + this.owner(await this.session()), r); }
}

// ---------------------------------------------------------------- CLOUD
class CloudStore {
  mode = 'cloud';
  async init() {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  }
  async user() { const { data } = await this.sb.auth.getSession(); return data.session?.user || null; }
  async session() {
    const u = await this.user();
    if (!u) return { kind: 'guest' };
    if (CONFIG.adminEmail && u.email?.toLowerCase() === CONFIG.adminEmail.toLowerCase()) return { kind: 'admin' };
    let { data: team } = await this.sb.from('teams').select('*').eq('id', u.id).maybeSingle();
    if (!team && u.user_metadata?.team_name) {
      const row = { id: u.id, team_name: u.user_metadata.team_name, captain: u.user_metadata.captain || '', email: u.email, status: 'pending' };
      const r = await this.sb.from('teams').insert(row).select().maybeSingle();
      team = r.data;
    }
    if (!team) return { kind: 'removed' };
    return { kind: 'team', team };
  }
  async register({ team, captain, email, password }) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { data: { team_name: team, captain } } });
    if (error) throw error;
    if (!data.session) throw new Error('Check your email to confirm the account, then log in.');
    return (await this.session()).team;
  }
  async login(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Wrong email or password.');
  }
  async adminLogin(key) {
    if (await sha256('fllsim:' + key) !== CONFIG.adminKeyHash) throw new Error('Wrong admin key.');
    const { error } = await this.sb.auth.signInWithPassword({ email: CONFIG.adminEmail, password: key });
    if (error) throw new Error('Admin key is right, but the Supabase admin user is not set up (see README).');
  }
  async logout() { await this.sb.auth.signOut(); }
  async getSite() {
    const { data } = await this.sb.from('site').select('*').eq('id', 1).maybeSingle();
    return normalizeSite(data);
  }
  async setSite(patch) {
    const cur = await this.getSite();
    const next = { ...cur, ...patch };
    const { error } = await this.sb.from('site').upsert({ id: 1, locked: next.locked, field: next.field });
    if (error) throw error;
    return next;
  }
  async listTeams() { const { data, error } = await this.sb.from('teams').select('*').order('created_at'); if (error) throw error; return data; }
  async setTeamStatus(id, status) { const { error } = await this.sb.from('teams').update({ status }).eq('id', id); if (error) throw error; }
  async removeTeam(id) {
    await this.sb.from('programs').delete().eq('team_id', id);
    await this.sb.from('robots').delete().eq('team_id', id);
    const { error } = await this.sb.from('teams').delete().eq('id', id); if (error) throw error;
  }
  async getPrograms() {
    const u = await this.user(); if (!u) return ls.get('programs.guest', []);
    const { data } = await this.sb.from('programs').select('*').eq('team_id', u.id).order('updated_at');
    return data || [];
  }
  async saveProgram(p) {
    const u = await this.user();
    if (!u) { const l = new LocalStore(); return l.saveProgram(p); }
    const row = { name: p.name, code: p.code, route: p.route || null, team_id: u.id, updated_at: new Date().toISOString() };
    if (p.id) row.id = p.id;
    const { data, error } = await this.sb.from('programs').upsert(row).select().single();
    if (error) throw new Error(error.message.includes('row-level') ? 'Your team must be approved before saving to the cloud.' : error.message);
    return data;
  }
  async deleteProgram(id) { await this.sb.from('programs').delete().eq('id', id); }
  async listAllPrograms() {
    const { data, error } = await this.sb.from('programs').select('*, teams(team_name)').order('updated_at', { ascending: false });
    if (error) throw error;
    return data.map(p => ({ ...p, team_name: p.teams?.team_name || '?' }));
  }
  async getRobot() {
    const u = await this.user(); if (!u) return ls.get('robot.guest', null);
    const { data } = await this.sb.from('robots').select('data').eq('team_id', u.id).maybeSingle();
    return data?.data || null;
  }
  async saveRobot(r) {
    const u = await this.user(); if (!u) return ls.set('robot.guest', r);
    await this.sb.from('robots').upsert({ team_id: u.id, data: r });
  }
}

export const store = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey ? new CloudStore() : new LocalStore();
