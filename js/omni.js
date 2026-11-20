// Omni-wheel robots (3-wheel kiwi, 4-wheel X, 4-wheel +): kinematics, heading-hold sim, LQR vs PID.
// Conventions (same as Pybricks): heading in degrees, CLOCKWISE positive, 0 = facing the opponent goal.
// Joystick/drive angle: 0 = forward, 90 = right, 180 = back, 270 = left (clockwise).
import { rng, designLQR } from './physics.js';

export const CONFIGS = {
  kiwi3: { name: '3-wheel omni (kiwi)', wheels: [60, 180, 300], labels: ['FR', 'B', 'FL'] },
  x4: { name: '4-wheel omni X', wheels: [45, 135, 225, 315], labels: ['FR', 'BR', 'BL', 'FL'] },
  plus4: { name: '4-wheel omni +', wheels: [0, 90, 180, 270], labels: ['F', 'R', 'B', 'L'] },
};
// wheel angle φ measured clockwise from forward (where the wheel sits on the robot).
// A wheel at φ rolls along the tangent; positive wheel speed pushes the robot clockwise.
const rad = d => d * Math.PI / 180;
export const wrap = a => ((a + 540) % 360) - 180;

export function defaultOmni() {
  return { config: 'x4', wheelD: 56, radius: 75, motorMax: 1000, mass: 0.9, rotPriority: true, deadzone: 8, fieldRelative: true,
    ports: ['A', 'B', 'C', 'D'], dirs: ['CLOCKWISE', 'CLOCKWISE', 'CLOCKWISE', 'CLOCKWISE'],
    pid: { kp: 0.02, ki: 0.0, kd: 0.0015 }, lqrQ: { qAngle: 1 / 4, qInt: 1 / 25 } };
}

// robot-frame translation (x forward, y right) + clockwise rotation -> wheel duty (-1..1)
export function wheelDuties(cfg, dirDeg, speed, rot, rotPriority = true) {
  const W = CONFIGS[cfg].wheels;
  const vx = Math.cos(rad(dirDeg)) * speed, vy = Math.sin(rad(dirDeg)) * speed; // forward, right
  // tangential (clockwise) unit vector at angle φ (clockwise from forward): t = (-sin φ, cos φ) in (fwd,right)
  let trans = W.map(p => -Math.sin(rad(p)) * vx + Math.cos(rad(p)) * vy);
  // speed 1 = the fastest this drive can go in that direction (some wheel at 100%)
  const tm = Math.max(...trans.map(Math.abs));
  if (tm > 1e-9 && speed > 0) trans = trans.map(t => t * speed / tm);
  const rotv = W.map(() => rot);
  let out;
  if (rotPriority) {
    const mt = Math.max(1e-9, ...trans.map(Math.abs));
    // scale translation so rotation always fits
    let k = 1;
    for (let i = 0; i < W.length; i++) {
      const room = 1 - Math.abs(rotv[i]);
      if (room <= 0) { k = 0; break; }
      if (Math.abs(trans[i]) > room) k = Math.min(k, room / Math.abs(trans[i]));
    }
    out = trans.map((t, i) => t * k + rotv[i]);
  } else out = trans.map((t, i) => t + rotv[i]);
  const m = Math.max(1, ...out.map(Math.abs));
  return out.map(v => v / m);
}

// wheel duties -> robot-frame velocity (forward, right) in fraction of wheel speed, and rotation fraction
export function forwardKin(cfg, duties) {
  const W = CONFIGS[cfg].wheels, n = W.length;
  let vx = 0, vy = 0, r = 0;
  W.forEach((p, i) => { vx += -Math.sin(rad(p)) * duties[i]; vy += Math.cos(rad(p)) * duties[i]; r += duties[i]; });
  return { vx: vx * 2 / n, vy: vy * 2 / n, rot: r / n };
}

// Max speed fraction available in a direction (no rotation)
export function maxSpeedAt(cfg, dirDeg) {
  const k = forwardKin(cfg, wheelDuties(cfg, dirDeg, 1, 0, false));
  return Math.hypot(k.vx, k.vy); // in units of wheel surface speed
}

export function omniPlant(o) {
  const wheelSpeed = o.motorMax / 360 * Math.PI * o.wheelD;      // mm/s at full duty
  const maxRate = wheelSpeed / o.radius * 180 / Math.PI;          // deg/s spin at full duty
  const inertia = o.mass * (o.radius / 1000) ** 2 * 0.6;
  return {
    wheelSpeed, maxRate,
    tau: 0.04 + 10 * inertia,
    uStatic: Math.min(0.2, 0.03 + 0.05 * o.mass),
    uKinetic: Math.min(0.15, 0.02 + 0.03 * o.mass),
    gyroNoise: 0.03, delay: 1,
  };
}

// ---- heading-hold controllers (target can move: goal lock) ----
export function holdLQR(g, plant) {
  let integ = 0, last = 0, prevT = null;
  return {
    name: 'LQR',
    step(m, target, dt) {
      const e = wrap(m.heading - target);
      const tRate = prevT === null ? 0 : wrap(target - prevT) / dt; prevT = target;
      if (Math.abs(e) < 6) integ = Math.max(-3, Math.min(3, integ + e * dt)); else integ *= 0.95;
      const ff = tRate / plant.maxRate;
      let u = ff - (g.k1 * e + g.k2 * (m.rate - tRate) + g.k3 * integ + (g.k4 ?? 0) * (last - ff));
      if (Math.abs(e) > 0.1) u += Math.sign(u) * plant.uKinetic * (m.moving ? 0.3 : 1);
      last = Math.max(-1, Math.min(1, u));
      return u;
    },
  };
}
export function holdPID(g) {
  let integ = 0, prev = null;
  return {
    name: 'PID',
    step(m, target, dt) {
      const e = wrap(target - m.heading);
      integ = Math.max(-100, Math.min(100, integ + e * dt));
      const d = prev === null ? 0 : wrap(e - prev) / dt; prev = e;
      return g.kp * e + g.ki * integ + g.kd * d;
    },
  };
}

// ---- simulate an omni robot moving + holding heading ----
// script(t) -> { dir (field deg), speed 0..1, push? } ; returns trace + metrics
export function headingTest(o, ctrl, { seed = 4, T = 12, goalLock = false } = {}) {
  const P = omniPlant(o), R = rng(seed);
  const dtSim = 0.002, dtCtl = 0.01;
  // build the joystick script & pushes (same for every controller with the same seed)
  const segs = []; for (let t = 0; t < T; t += 0.8 + R() * 0.7) segs.push({ t, dir: Math.floor(R() * 8) * 45 + (R() - .5) * 20, speed: 0.5 + R() * 0.5 });
  const pushes = []; for (let i = 0; i < 5; i++) pushes.push({ t: 1 + R() * (T - 2), dw: (R() < .5 ? -1 : 1) * (60 + R() * 140) });
  const asym = Array.from({ length: CONFIGS[o.config].wheels.length }, () => 1 + (R() - .5) * 0.08); // wheel/motor mismatch ±4%
  let x = 1225, y = 400, h = 0, w = 0, bias = 0, t = 0, tc = 0;
  const queue = Array(P.delay).fill(0); let uRot = 0;
  const trace = []; let se = 0, n = 0, maxE = 0, inBand = 0;
  let cur = segs[0], si = 0, duties = [];
  const goal = { x: 1225, y: 1550 };
  while (t < T) {
    while (si + 1 < segs.length && segs[si + 1].t <= t) cur = segs[++si];
    const target = goalLock ? Math.atan2(goal.x - x, goal.y - y) * 180 / Math.PI : 0;
    if (t >= tc - 1e-9) {
      const m = { heading: h + bias + R.gauss() * P.gyroNoise, rate: w + R.gauss() * 0.4, moving: cur.speed > 0.05 };
      const cmd = Math.max(-1, Math.min(1, ctrl.step(m, target, dtCtl)));
      queue.push(cmd); uRot = queue.shift();
      const rel = o.fieldRelative ? cur.dir - h : cur.dir;
      duties = wheelDuties(o.config, rel, cur.speed, uRot, o.rotPriority);
      tc += dtCtl;
      const e = wrap(h - target);
      se += e * e; n++; maxE = Math.max(maxE, Math.abs(e)); if (Math.abs(e) < 2) inBand++;
      trace.push({ t, e, x, y, h, target, u: uRot });
    }
    // physics: each wheel gets its own mismatch → creates yaw disturbance while translating
    const act = duties.map((d, i) => d * asym[i]);
    const k = forwardKin(o.config, act);
    let rotCmd = k.rot;
    const moving = Math.hypot(k.vx, k.vy) > 0.05;
    if (!moving && Math.abs(w) < 0.5 && Math.abs(rotCmd) < P.uStatic) { rotCmd = 0; w = 0; }
    else rotCmd -= Math.sign(rotCmd || w) * P.uKinetic * (moving ? 0.3 : 1) * Math.min(1, Math.abs(rotCmd) / 0.05 + (moving ? 0 : 1));
    w += (rotCmd * P.maxRate - w) * dtSim / P.tau;
    for (const p of pushes) if (Math.abs(p.t - t) < dtSim / 2) w += p.dw;
    h = wrap(h + w * dtSim);
    // translation (field frame): forward = +y on field when heading 0, right = +x
    const sp = P.wheelSpeed * dtSim;
    const fx = Math.sin(rad(h)) * k.vx + Math.cos(rad(h)) * k.vy;
    const fy = Math.cos(rad(h)) * k.vx - Math.sin(rad(h)) * k.vy;
    x = Math.max(120, Math.min(2330, x + fx * sp)); y = Math.max(120, Math.min(1430, y + fy * sp));
    bias += R.gauss() * 0.0005;
    t += dtSim;
  }
  return { trace, rms: Math.sqrt(se / n), max: maxE, inBand: inBand / n, pushes, segs };
}

export function lqrForOmni(o, q = o.lqrQ) {
  const P = omniPlant(o);
  return designLQR(P, { qAngle: q.qAngle, qInt: q.qInt, qRate: 1 / 300 ** 2 });
}

export function autoTuneOmni(o, goalLock) {
  const cost = r => r.rms + 0.15 * r.max;
  const evalC = mk => [3, 9].reduce((s, seed) => s + cost(headingTest(o, mk(), { seed, goalLock })), 0);
  // LQR: search Q
  let bestL = null;
  for (const qa of [1 / 25, 1 / 9, 1 / 4, 1, 4]) for (const qi of [1 / 25, 1 / 4, 1]) {
    const g = designLQR(omniPlant(o), { qAngle: qa, qInt: qi, qRate: 1 / 300 ** 2 });
    if (![g.k1, g.k2, g.k3].every(Number.isFinite)) continue;
    const c = evalC(() => holdLQR(g, omniPlant(o)));
    if (!bestL || c < bestL.c) bestL = { c, qAngle: qa, qInt: qi };
  }
  // PID: coordinate descent
  let g = { ...o.pid }, c = evalC(() => holdPID(g));
  const st = { kp: 0.01, ki: 0.02, kd: 0.0008 };
  for (let it = 0; it < 14; it++) {
    let imp = false;
    for (const k of ['kp', 'ki', 'kd']) for (const s of [1, -1]) {
      const t = { ...g, [k]: Math.max(0, g[k] + s * st[k]) }, ct = evalC(() => holdPID(t));
      if (ct < c) { g = t; c = ct; imp = true; }
    }
    if (!imp) for (const k in st) st[k] /= 2;
  }
  return { lqrQ: { qAngle: bestL.qAngle, qInt: bestL.qInt }, pid: g };
}

// ---- Pybricks export ----
export function omniCode(o, kind) {
  const C = CONFIGS[o.config], P = omniPlant(o), n = C.wheels.length;
  const g = lqrForOmni(o);
  const ports = C.wheels.map((_, i) => o.ports[i] || 'ABCDEF'[i]);
  const f = (v, d = 5) => Number(v).toFixed(d);
  return `# ${C.name} — heading hold (${kind}) — generated by FLL SIM
# Drive in any direction while the robot keeps facing forward (or locks on the goal).
from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Port, Direction, Axis
from pybricks.tools import wait, StopWatch
from umath import sin, cos, radians, atan2, degrees

hub = PrimeHub()
# Wheel order: ${C.labels.join(', ')}  (wheel angles ${C.wheels.join(', ')}° clockwise from the front)
# Each motor must spin the robot CLOCKWISE (seen from above) for positive dc(). Flip Direction if not.
motors = [${ports.map((p, i) => `Motor(Port.${p}, Direction.${o.dirs[i] || 'CLOCKWISE'})`).join(', ')}]
WHEEL_ANGLES = [${C.wheels.join(', ')}]
${kind === 'LQR' ? `K1, K2, K3, K4 = ${f(g.k1)}, ${f(g.k2)}, ${f(g.k3)}, ${f(g.k4)}
U_FRICTION = ${f(P.uKinetic, 4)}` : `KP, KI, KD = ${f(o.pid.kp)}, ${f(o.pid.ki)}, ${f(o.pid.kd)}`}
ROTATION_PRIORITY = ${o.rotPriority ? 'True' : 'False'}


def wrap(a):
    return (a + 540) % 360 - 180


class HeadingHold:
    def __init__(self):
        self.integ = 0
        self.last = 0
        self.prev = None

    def update(self, target, dt=0.01):
        heading = hub.imu.heading()
        rate = -hub.imu.angular_velocity(Axis.Z)
${kind === 'LQR' ? `        e = wrap(heading - target)
        if abs(e) < 6:
            self.integ = max(-3, min(3, self.integ + e * dt))
        else:
            self.integ *= 0.95
        u = -(K1 * e + K2 * rate + K3 * self.integ + K4 * self.last)
        if abs(e) > 0.1:
            u += U_FRICTION * 0.3 if u > 0 else -U_FRICTION * 0.3
        u = max(-1, min(1, u))
        self.last = u
        return u` : `        e = wrap(target - heading)
        self.integ = max(-100, min(100, self.integ + e * dt))
        d = 0 if self.prev is None else wrap(e - self.prev) / dt
        self.prev = e
        return max(-1, min(1, KP * e + KI * self.integ + KD * d))`}


def drive(direction, speed, rot):
    """direction: degrees (0 forward, 90 right), speed 0..1, rot -1..1 (clockwise)."""
    vx = cos(radians(direction)) * speed
    vy = sin(radians(direction)) * speed
    trans = [-sin(radians(p)) * vx + cos(radians(p)) * vy for p in WHEEL_ANGLES]
    tm = max(abs(t) for t in trans)
    if tm > 0 and speed > 0:
        trans = [t * speed / tm for t in trans]
    k = 1
    if ROTATION_PRIORITY:
        room = 1 - abs(rot)
        for t in trans:
            if abs(t) > room and abs(t) > 0:
                k = min(k, room / abs(t))
    out = [t * k + rot for t in trans]
    m = max(1, max(abs(v) for v in out))
    for mot, v in zip(motors, out):
        mot.dc(v / m * 100)


hold = HeadingHold()
hub.imu.reset_heading(0)


def joystick_to_degree(x, y, deadzone=${o.deadzone}):
    """x, y in -100..100 (right, up). Returns (direction degrees, speed 0..1)."""
    mag = (x * x + y * y) ** 0.5
    if mag < deadzone:
        return 0, 0
    return degrees(atan2(x, y)) % 360, min(1, (mag - deadzone) / (100 - deadzone))


# --- Example: drive a square while always facing forward ---
# Replace with your controller input: direction, speed = joystick_to_degree(x, y)
FIELD_RELATIVE = ${o.fieldRelative ? 'True' : 'False'}
sw = StopWatch()
for direction in [0, 90, 180, 270]:
    sw.reset()
    while sw.time() < 1500:
        rot = hold.update(0)            # target 0 = face forward (use a goal angle for goal lock)
        d = direction - hub.imu.heading() if FIELD_RELATIVE else direction
        drive(d, 0.6, rot)
        wait(10)
for m in motors:
    m.brake()
`;
}
