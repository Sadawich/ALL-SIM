// FLL SIM — robot turning physics + three controllers (LQR, PID, Pybricks-style gyro)
// Units: degrees, seconds, duty in [-1, 1].

// ---------- seeded random ----------
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  next.gauss = () => {
    const u = Math.max(next(), 1e-9), v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return next;
}

// ---------- robot parameters ----------
// Derived from the builder (mass, yaw inertia, wheel size, axle track) or from calibration.
export function plantFromRobot(robot = {}) {
  const wheelD = robot.wheelDiameter ?? 56;       // mm
  const track = robot.axleTrack ?? 112;           // mm
  const motorMax = robot.motorMaxSpeed ?? 1000;    // deg/s at the wheel (SPIKE large motor ≈ 1000)
  const mass = robot.mass ?? 0.75;                 // kg
  const inertia = robot.inertia ?? 0.0028;         // kg·m² about vertical axis
  const wheelSpeed = motorMax / 360 * Math.PI * wheelD;  // mm/s
  const maxRate = (2 * wheelSpeed / track) * 180 / Math.PI; // deg/s yaw at full duty
  const p = {
    maxRate,
    tau: 0.035 + 14 * inertia,                     // s, motor + body time constant
    uStatic: Math.min(0.2, 0.035 + 0.05 * mass),   // duty needed to break static friction
    uKinetic: Math.min(0.15, 0.02 + 0.03 * mass),  // duty lost to rolling/kinetic friction
    gyroNoise: 0.02,                               // deg, per sample
    gyroDrift: 0.02,                               // deg/s random-walk scale
    delay: 1,                                      // control cycles of actuation delay
  };
  if (robot.calibration) Object.assign(p, robot.calibration);
  return p;
}

// ---------- tiny matrix helpers (dense, small) ----------
const mm = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const madd = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));
const msub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));
const mscale = (A, s) => A.map(r => r.map(v => v * s));
const tr = A => A[0].map((_, j) => A.map(r => r[j]));
const eye = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));

// Zero-order-hold discretisation via Van Loan + Taylor series
function c2d(A, B, dt) {
  const n = A.length, m = B[0].length, N = n + m;
  const M = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) =>
    i < n ? (j < n ? A[i][j] * dt : B[i][j - n] * dt) : 0));
  let E = eye(N), term = eye(N);
  for (let k = 1; k < 25; k++) { term = mscale(mm(term, M), 1 / k); E = madd(E, term); }
  return {
    Ad: E.slice(0, n).map(r => r.slice(0, n)),
    Bd: E.slice(0, n).map(r => r.slice(n)),
  };
}

// Discrete LQR, single input. State x = [e (deg), ω (deg/s), ∫e (deg·s)]
export function designLQR(plant, { qAngle = 1 / 9, qRate = 1 / 300 ** 2, qInt = 1 / 25, r = 1, dt = 0.01 } = {}) {
  const a = 1 / plant.tau, b = plant.maxRate / plant.tau;
  const A = [[0, 1, 0], [0, -a, 0], [1, 0, 0]];
  const B = [[0], [b], [0]];
  const d = c2d(A, B, dt);
  // augment with one cycle of actuation delay: state [e, ω, ∫e, u_prev]
  const Ad = [[...d.Ad[0], d.Bd[0][0]], [...d.Ad[1], d.Bd[1][0]], [...d.Ad[2], d.Bd[2][0]], [0, 0, 0, 0]];
  const Bd = [[0], [0], [0], [1]];
  const Q = [[qAngle, 0, 0, 0], [0, qRate, 0, 0], [0, 0, qInt, 0], [0, 0, 0, 0]];
  let P = Q;
  for (let i = 0; i < 6000; i++) {
    const BtP = mm(tr(Bd), P);
    const s = r + mm(BtP, Bd)[0][0];
    const K = mscale(mm(BtP, Ad), 1 / s);
    const Pn = madd(Q, msub(mm(mm(tr(Ad), P), Ad), mm(mm(tr(Ad), mm(P, Bd)), K)));
    const diff = Math.max(...Pn.flat().map((v, k) => Math.abs(v - P.flat()[k])));
    P = Pn;
    if (diff < 1e-10 * Math.max(1, Math.abs(P[0][0]))) break;
  }
  const BtP = mm(tr(Bd), P);
  const s = r + mm(BtP, Bd)[0][0];
  const K = mm(BtP, Ad)[0].map(v => v / s);
  return { k1: K[0], k2: K[1], k3: K[2], k4: K[3], dt };
}

// ---------- controllers ----------
// Each controller: { name, reset(target), step(meas, dt) -> duty, done(meas) }
// LQR tracking a motion profile: feedforward from the plant model + optimal state feedback.
export function makeLQR(gains, plant) {
  const turnRate = gains.turnRate ?? plant.maxRate * 0.75;
  const accel = gains.accel ?? 2500;
  let integ = 0, last = 0, start = 0, t = 0, dir = 1, target = 0, prof;
  return {
    name: 'LQR', tol: 0.15,
    reset(tg, h0 = 0) { target = tg; start = h0; t = 0; integ = 0; last = 0; dir = Math.sign(tg - h0) || 1; prof = makeProfile(Math.abs(tg - h0), turnRate, accel); },
    step({ heading, rate }, dt) {
      t += dt;
      const [p, v, a] = prof(t);
      const r = start + dir * p, vr = dir * v, ar = dir * a;
      const e = heading - r, ew = rate - vr;
      if (Math.abs(heading - target) < 4) integ = Math.max(-2, Math.min(2, integ + e * dt));
      const ff = (vr + plant.tau * ar) / plant.maxRate;
      let u = ff - (gains.k1 * e + gains.k2 * ew + gains.k3 * integ + (gains.k4 ?? 0) * (last - ff));
      if (Math.abs(heading - target) > 0.03 || Math.abs(vr) > 0) u += Math.sign(u) * plant.uKinetic * (gains.ffScale ?? 1);
      last = Math.max(-1, Math.min(1, u));
      return u;
    },
  };
}

export function makePID(g) {
  let integ = 0, prevE = null, target = 0;
  return {
    name: 'PID', tol: g.tol ?? 1,
    reset(t) { target = t; integ = 0; prevE = null; },
    step({ heading }, dt) {
      const e = target - heading;
      integ = Math.max(-200, Math.min(200, integ + e * dt));
      const d = prevE === null ? 0 : (e - prevE) / dt;
      prevE = e;
      return g.kp * e + g.ki * integ + g.kd * d;
    },
  };
}

// Approximation of Pybricks DriveBase.turn() with use_gyro(True):
// trapezoidal speed profile, tracking controller, then Stop.HOLD on the target.
// Trapezoidal motion profile (shared by Gyro and LQR tracking)
function makeProfile(dist, rateMax, accel) {
  const ta = rateMax / accel, dAcc = 0.5 * accel * ta * ta;
  if (2 * dAcc >= dist) {
    const tp = Math.sqrt(dist / accel);
    return t => {
      if (t < tp) return [0.5 * accel * t * t, accel * t, accel];
      if (t < 2 * tp) { const s = t - tp; return [dist / 2 + accel * tp * s - 0.5 * accel * s * s, accel * (2 * tp - t), -accel]; }
      return [dist, 0, 0];
    };
  }
  const tc = (dist - 2 * dAcc) / rateMax;
  return t => {
    if (t < ta) return [0.5 * accel * t * t, accel * t, accel];
    if (t < ta + tc) return [dAcc + rateMax * (t - ta), rateMax, 0];
    if (t < 2 * ta + tc) { const s = t - ta - tc; return [dAcc + rateMax * tc + rateMax * s - 0.5 * accel * s * s, rateMax - accel * s, -accel]; }
    return [dist, 0, 0];
  };
}

// Approximation of Pybricks DriveBase.turn() with use_gyro(True):
// trapezoidal speed profile, PID tracking, then Stop.HOLD on the target.
export function makeGyro(g = {}, plant) {
  const turnRate = g.turnRate ?? Math.min(300, plant.maxRate * 0.6);
  const accel = g.accel ?? 900;
  const kp = g.kp ?? 0.03, kd = g.kd ?? 0.002, ki = g.ki ?? 0.03;
  let start = 0, t = 0, dir = 1, integ = 0, prof;
  return {
    name: 'Gyro', tol: 1,
    reset(tg, h0 = 0) { start = h0; t = 0; integ = 0; dir = Math.sign(tg - h0) || 1; prof = makeProfile(Math.abs(tg - h0), turnRate, accel); },
    step({ heading, rate }, dt) {
      t += dt;
      const [p, v] = prof(t);
      const r = start + dir * p, vr = dir * v;
      integ = Math.max(-60, Math.min(60, integ + (r - heading) * dt));
      return vr / plant.maxRate + kp * (r - heading) + kd * (vr - rate) + ki * integ;
    },
  };
}

// ---------- simulation of one turn ----------
// state carries over between turns (true heading, gyro bias)
export function simulateTurn(ctrl, plant, state, target, opt = {}) {
  const R = state.rand;
  const dtSim = 0.002, dtCtl = 0.01, maxT = opt.timeout ?? 2.5;
  const settleTime = opt.settleTime ?? 0.25;
  const asym = 1 + (R() - 0.5) * 0.01;            // left/right motor mismatch
  const batt = state.battery;
  const queue = Array(plant.delay).fill(0);
  let t = 0, tc = 0, u = 0, settled = 0, stuck = false;
  const trace = [];
  const meas = () => ({
    heading: state.heading + state.bias + R.gauss() * plant.gyroNoise,
    rate: state.omega + R.gauss() * 0.3,
  });
  ctrl.reset(target, state.heading + state.bias);
  while (t < maxT) {
    if (t >= tc - 1e-9) {
      const m = meas();
      let cmd = Math.max(-1, Math.min(1, ctrl.step(m, dtCtl)));
      queue.push(cmd); u = queue.shift();
      tc += dtCtl;
      if (trace.length < 2000) trace.push({ t, h: state.heading, u });
      const e = Math.abs(m.heading - target);
      if (e < (opt.tol ?? ctrl.tol ?? 0.15) && Math.abs(state.omega) < 2) settled += dtCtl; else settled = 0;
      if (settled >= settleTime) break;
    }
    // plant: first-order rate response with friction
    let ueff = u * batt * asym;
    if (Math.abs(state.omega) < 0.5) {
      if (Math.abs(ueff) < plant.uStatic) { ueff = 0; state.omega = 0; stuck = true; }
      else { ueff -= Math.sign(ueff) * plant.uKinetic; stuck = false; }
    } else {
      ueff -= Math.sign(state.omega) * plant.uKinetic;
      stuck = false;
    }
    const wTarget = ueff * plant.maxRate;
    if (!(stuck && ueff === 0)) state.omega += (wTarget - state.omega) * (dtSim / plant.tau);
    state.heading += state.omega * dtSim;
    state.bias += R.gauss() * plant.gyroDrift * Math.sqrt(dtSim) * 0.05;
    t += dtSim;
  }
  // brake: motors short, robot stops quickly; residual coast
  const coast = state.omega * 0.012;
  state.heading += coast; state.omega = 0;
  trace.push({ t, h: state.heading, u: 0 });
  return { error: state.heading - target, time: t, trace };
}

export const TURN_TEST = [90, -90, 180, 45, -135, 90];

// Run the 6-turn test. Targets accumulate like a real run (absolute headings).
export function runTurnTest(ctrlFactory, plant, seed = 7, turns = TURN_TEST) {
  const R = rng(seed);
  const state = { heading: 0, omega: 0, bias: 0, rand: R, battery: 0.97 + R() * 0.04 };
  const ctrl = ctrlFactory();
  let target = 0;
  const results = [];
  for (const a of turns) {
    target += a;
    const before = state.heading;
    const r = simulateTurn(ctrl, plant, state, target);
    // per-turn error relative to the requested relative turn
    const turned = state.heading - before;
    results.push({ turn: a, error: r.error, relErr: turned - a, time: r.time, trace: r.trace });
  }
  const mean = results.reduce((s, r) => s + Math.abs(r.error), 0) / results.length;
  const meanTime = results.reduce((s, r) => s + r.time, 0) / results.length;
  return { results, mean, meanTime };
}

// ---------- auto-tuning ----------
export function autoTuneLQR(plant) {
  // pick Q weights by small search for best error/time tradeoff
  let best = null;
  for (const qa of [1 / 25, 1 / 9, 1, 4]) for (const qi of [1 / 25, 1, 4]) {
    const g = designLQR(plant, { qAngle: qa, qInt: qi, qRate: 1 / 300 ** 2 });
    if (![g.k1, g.k2, g.k3].every(Number.isFinite)) continue;
    let cost = 0;
    for (const seed of [3, 11]) {
      const r = runTurnTest(() => makeLQR(g, plant), plant, seed);
      cost += r.mean + 0.05 * r.meanTime;
    }
    if (!best || cost < best.cost) best = { cost, g: { ...g, qa, qi } };
  }
  return best.g;
}

export function autoTunePID(plant, start = { kp: 0.02, ki: 0.01, kd: 0.001, tol: 0.3 }) {
  const cost = g => {
    let c = 0;
    for (const seed of [3, 11]) { const r = runTurnTest(() => makePID(g), plant, seed); c += r.mean + 0.05 * r.meanTime; }
    return c;
  };
  let g = { ...start }, c = cost(g);
  const steps = { kp: 0.01, ki: 0.02, kd: 0.0008 };
  for (let it = 0; it < 18; it++) {
    let improved = false;
    for (const k of ['kp', 'ki', 'kd']) for (const s of [1, -1]) {
      const t = { ...g, [k]: Math.max(0, g[k] + s * steps[k]) };
      const ct = cost(t);
      if (ct < c) { g = t; c = ct; improved = true; }
    }
    if (!improved) for (const k in steps) steps[k] /= 2;
  }
  return g;
}

// Parse the line printed by the calibration script on the real hub
// e.g. "CAL us=0.072 rate=492.1 tau=0.081"
export function parseCalibration(text) {
  const m = /CAL\s+us=([\d.]+)\s+rate=([\d.]+)\s+tau=([\d.]+)/.exec(text || '');
  if (!m) return null;
  const us = +m[1], rate = +m[2], tau = +m[3];
  if (!(us > 0 && us < 0.5 && rate > 30 && rate < 3000 && tau > 0.005 && tau < 1)) return null;
  // rate was measured at 60% duty
  const maxRate = rate / (0.6 - us * 0.6);
  return { uStatic: us, uKinetic: us * 0.6, maxRate, tau };
}
