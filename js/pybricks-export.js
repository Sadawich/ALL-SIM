// Generates real Pybricks code for the SPIKE Prime hub.
// Pybricks heading(): clockwise positive. angular_velocity(Axis.Z): counter-clockwise positive,
// so heading rate = -angular_velocity(Axis.Z).

const f = (x, d = 5) => Number(x).toFixed(d);

function header(robot) {
  const lp = robot.leftPort || 'A', rp = robot.rightPort || 'B';
  const ld = robot.leftDir || 'COUNTERCLOCKWISE', rd = robot.rightDir || 'CLOCKWISE';
  return `from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Port, Direction, Axis, Stop
from pybricks.robotics import DriveBase
from pybricks.tools import wait, StopWatch

hub = PrimeHub()
left = Motor(Port.${lp}, Direction.${ld})
right = Motor(Port.${rp}, Direction.${rd})
drive_base = DriveBase(left, right, wheel_diameter=${robot.wheelDiameter ?? 56}, axle_track=${Math.round(robot.axleTrack ?? 112)})
`;
}

export function exportTurnCode(kind, gains, plant, robot) {
  const h = header(robot);
  if (kind === 'LQR') {
    const rate = Math.round(plant.maxRate * 0.75);
    return `${h}
# ---- FLL SIM: LQR turn (auto-generated) ----
K1, K2, K3, K4 = ${f(gains.k1)}, ${f(gains.k2)}, ${f(gains.k3)}, ${f(gains.k4 ?? 0)}
MAX_RATE = ${f(plant.maxRate, 1)}   # deg/s at 100% duty
TAU = ${f(plant.tau, 4)}            # s
U_FRICTION = ${f(plant.uKinetic, 4)} # duty lost to friction
TURN_RATE, ACCEL = ${rate}, 2500


def profile(t, dist):
    ta = TURN_RATE / ACCEL
    d_acc = 0.5 * ACCEL * ta * ta
    if 2 * d_acc >= dist:
        tp = (dist / ACCEL) ** 0.5
        if t < tp:
            return 0.5 * ACCEL * t * t, ACCEL * t, ACCEL
        if t < 2 * tp:
            s = t - tp
            return dist / 2 + ACCEL * tp * s - 0.5 * ACCEL * s * s, ACCEL * (2 * tp - t), -ACCEL
        return dist, 0, 0
    tc = (dist - 2 * d_acc) / TURN_RATE
    if t < ta:
        return 0.5 * ACCEL * t * t, ACCEL * t, ACCEL
    if t < ta + tc:
        return d_acc + TURN_RATE * (t - ta), TURN_RATE, 0
    if t < 2 * ta + tc:
        s = t - ta - tc
        return d_acc + TURN_RATE * tc + TURN_RATE * s - 0.5 * ACCEL * s * s, TURN_RATE - ACCEL * s, -ACCEL
    return dist, 0, 0


def lqr_turn_to(target, timeout=2500):
    """Turn to an absolute heading (degrees, clockwise positive)."""
    start = hub.imu.heading()
    dist = abs(target - start)
    sign = 1 if target >= start else -1
    integ, last, settled = 0, 0, 0
    sw = StopWatch()
    while sw.time() < timeout:
        t = sw.time() / 1000
        p, v, a = profile(t, dist)
        ref, vref, aref = start + sign * p, sign * v, sign * a
        heading = hub.imu.heading()
        rate = -hub.imu.angular_velocity(Axis.Z)
        e, ew = heading - ref, rate - vref
        if abs(heading - target) < 4:
            integ = max(-2, min(2, integ + e * 0.01))
        ff = (vref + TAU * aref) / MAX_RATE
        u = ff - (K1 * e + K2 * ew + K3 * integ + K4 * (last - ff))
        if abs(heading - target) > 0.03 or vref != 0:
            u += U_FRICTION if u > 0 else -U_FRICTION
        u = max(-1, min(1, u))
        last = u
        left.dc(u * 100)
        right.dc(-u * 100)
        if abs(heading - target) < 0.15 and abs(rate) < 2:
            settled += 10
            if settled >= 250:
                break
        else:
            settled = 0
        wait(10)
    left.brake()
    right.brake()


def lqr_turn(angle):
    """Turn by a relative angle, like drive_base.turn(angle)."""
    lqr_turn_to(hub.imu.heading() + angle)


# Example: the 6-turn test from the simulator
hub.imu.reset_heading(0)
for a in [90, -90, 180, 45, -135, 90]:
    lqr_turn(a)
    wait(300)
    print("heading", hub.imu.heading())
`;
  }
  if (kind === 'PID') {
    return `${h}
# ---- FLL SIM: PID turn (auto-generated) ----
KP, KI, KD = ${f(gains.kp)}, ${f(gains.ki)}, ${f(gains.kd)}
TOLERANCE = ${f(gains.tol ?? 1, 2)}  # degrees


def pid_turn_to(target, timeout=2500):
    integ, prev = 0, None
    settled = 0
    sw = StopWatch()
    while sw.time() < timeout:
        e = target - hub.imu.heading()
        integ = max(-200, min(200, integ + e * 0.01))
        d = 0 if prev is None else (e - prev) / 0.01
        prev = e
        u = max(-1, min(1, KP * e + KI * integ + KD * d))
        left.dc(u * 100)
        right.dc(-u * 100)
        if abs(e) < TOLERANCE:
            settled += 10
            if settled >= 250:
                break
        else:
            settled = 0
        wait(10)
    left.brake()
    right.brake()


def pid_turn(angle):
    pid_turn_to(hub.imu.heading() + angle)


hub.imu.reset_heading(0)
for a in [90, -90, 180, 45, -135, 90]:
    pid_turn(a)
    wait(300)
    print("heading", hub.imu.heading())
`;
  }
  return `${h}
# ---- FLL SIM: built-in Pybricks gyro turn ----
drive_base.use_gyro(True)
drive_base.settings(turn_rate=${Math.round(Math.min(300, plant.maxRate * 0.6))})

hub.imu.reset_heading(0)
for a in [90, -90, 180, 45, -135, 90]:
    drive_base.turn(a)
    wait(300)
    print("heading", hub.imu.heading())
`;
}

// Calibration script: run on the real robot, paste the printed CAL line into FLL SIM.
export function calibrationScript(robot) {
  return `${header(robot)}
# ---- FLL SIM calibration ----
# Put the robot on the mat with room to spin. It will turn in place a few times.
hub.imu.reset_heading(0)
wait(500)

def rate():
    return -hub.imu.angular_velocity(Axis.Z)

# 1) smallest duty that starts the robot turning (static friction)
us = 0
for d in range(2, 40):
    left.dc(d)
    right.dc(-d)
    wait(150)
    if abs(rate()) > 8:
        us = d / 100
        break
left.brake(); right.brake()
wait(800)

# 2) step response at 60% duty: steady rate and time constant
sw = StopWatch()
left.dc(60); right.dc(-60)
samples = []
while sw.time() < 700:
    samples.append((sw.time(), rate()))
    wait(5)
left.brake(); right.brake()
steady = sum(r for t, r in samples[-30:]) / 30
tau = 0
for t, r in samples:
    if r >= 0.632 * steady:
        tau = t / 1000
        break

print("CAL us={:.3f} rate={:.1f} tau={:.3f}".format(us, steady, tau))
`;
}
