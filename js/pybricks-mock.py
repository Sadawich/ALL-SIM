# Pybricks simulator for FLL SIM (runs inside Pyodide).
# Implements the parts of the Pybricks API that FLL robots use. Motion is
# recorded as poses so the browser can animate it on the field.
import sys, types, math, random

_S = {"x": 0.0, "y": 0.0, "a": 0.0, "t": 0.0, "poses": [], "noise_turn": 0.0, "noise_straight": 0.0,
      "heading0": 0.0, "log": [], "steps": 0}
MAX_STEPS = 200000


def _reset(x, y, a, noise_turn=0.0, noise_straight=0.0, seed=1):
    _S.update(x=float(x), y=float(y), a=float(a), t=0.0, poses=[(x, y, a, 0.0)],
              noise_turn=noise_turn, noise_straight=noise_straight, heading0=float(a), log=[], steps=0)
    random.seed(seed)


def _push():
    _S["steps"] += 1
    if _S["steps"] > MAX_STEPS:
        raise RuntimeError("Program ran too long in the simulator (infinite loop?)")
    _S["poses"].append((_S["x"], _S["y"], _S["a"], _S["t"]))


def _advance(dist, turn_ccw, speed, rate):
    """move dist mm and rotate turn_ccw deg at the same time"""
    dur = max(abs(dist) / max(speed, 1), abs(turn_ccw) / max(rate, 1), 0.001)
    n = max(1, int(dur / 0.04))
    for _ in range(n):
        _S["a"] += turn_ccw / n
        r = math.radians(_S["a"])
        _S["x"] += math.cos(r) * dist / n
        _S["y"] += math.sin(r) * dist / n
        _S["t"] += dur / n
        _push()


class _Enum:
    def __init__(self, name, *values):
        for v in values:
            setattr(self, v, f"{name}.{v}")


Port = _Enum("Port", "A", "B", "C", "D", "E", "F")
Direction = _Enum("Direction", "CLOCKWISE", "COUNTERCLOCKWISE")
Stop = _Enum("Stop", "COAST", "BRAKE", "HOLD", "NONE", "COAST_SMART")
Button = _Enum("Button", "LEFT", "RIGHT", "CENTER", "BLUETOOTH", "UP", "DOWN")
Side = _Enum("Side", "TOP", "BOTTOM", "FRONT", "BACK", "LEFT", "RIGHT")
Axis = _Enum("Axis", "X", "Y", "Z")
Icon = _Enum("Icon", "HAPPY", "SAD", "HEART", "UP", "DOWN", "LEFT", "RIGHT", "CIRCLE", "SQUARE", "TRIANGLE", "PAUSE", "EMPTY", "FULL")


class _Color:
    def __init__(self, n, h=0, s=0, v=0):
        self.name, self.h, self.s, self.v = n, h, s, v

    def __repr__(self):
        return "Color." + self.name


class Color:
    pass


for _n, _h in [("RED", 0), ("ORANGE", 30), ("YELLOW", 60), ("GREEN", 120), ("CYAN", 180), ("BLUE", 240), ("VIOLET", 270), ("MAGENTA", 300)]:
    setattr(Color, _n, _Color(_n, _h, 100, 100))
Color.WHITE = _Color("WHITE", 0, 0, 100)
Color.BLACK = _Color("BLACK", 0, 0, 10)
Color.GRAY = _Color("GRAY", 0, 0, 50)
Color.NONE = _Color("NONE", 0, 0, 0)


def wait(ms):
    if ms > 0:
        _S["t"] += ms / 1000
        _push()


class StopWatch:
    def __init__(self):
        self._t0 = _S["t"]
        self._p = None

    def time(self):
        _S["t"] += 0.001  # reading the clock costs time so loops always advance
        _S["steps"] += 1
        if _S["steps"] > MAX_STEPS:
            raise RuntimeError("Program ran too long in the simulator (infinite loop?)")
        return int(((self._p if self._p is not None else _S["t"]) - self._t0) * 1000)

    def reset(self):
        self._t0 = _S["t"]

    def pause(self):
        self._p = _S["t"]

    def resume(self):
        self._t0 += _S["t"] - (self._p or _S["t"])
        self._p = None


class _IMU:
    def heading(self):
        return round(-(_S["a"] - _S["heading0"]), 2)

    def reset_heading(self, angle=0):
        _S["heading0"] = _S["a"] + angle

    def angular_velocity(self, axis=None):
        return 0 if axis is not None else (0, 0, 0)

    def acceleration(self, axis=None):
        return 0 if axis is not None else (0, 0, 9810)

    def tilt(self):
        return (0, 0)

    def ready(self):
        return True

    def stationary(self):
        return True

    def up(self):
        return Side.TOP


class _Light:
    def on(self, *a, **k): pass
    def off(self): pass
    def blink(self, *a, **k): pass
    def animate(self, *a, **k): pass


class _Display:
    def text(self, t, *a, **k): print("[display]", t)
    def number(self, n): print("[display]", n)
    def char(self, c): print("[display]", c)
    def icon(self, *a): pass
    def image(self, *a): pass
    def off(self): pass
    def pixel(self, *a, **k): pass
    def orientation(self, *a): pass
    def animate(self, *a, **k): pass


class _Speaker:
    def beep(self, frequency=500, duration=100): wait(duration)
    def play_notes(self, notes, tempo=120): wait(len(notes) * 60000 / tempo / 4)
    def volume(self, *a): pass


class _Buttons:
    def pressed(self): return set()


class _System:
    def set_stop_button(self, *a): pass
    def name(self): return "FLL SIM"
    def shutdown(self): raise SystemExit


class _Battery:
    def voltage(self): return 8100
    def current(self): return 150


class PrimeHub:
    def __init__(self, *a, **k):
        self.imu, self.light, self.display, self.speaker = _IMU(), _Light(), _Display(), _Speaker()
        self.buttons, self.system, self.battery = _Buttons(), _System(), _Battery()


InventorHub = PrimeHub
EssentialHub = PrimeHub


class Motor:
    def __init__(self, port, positive_direction=Direction.CLOCKWISE, gears=None, reset_angle=True, profile=None):
        self.port, self._angle, self._speed = port, 0.0, 0.0
        self.control = types.SimpleNamespace(limits=lambda *a: (1000, 2000, 100), pid=lambda *a: (0, 0, 0, 0, 0), target_tolerances=lambda *a: (10, 5))

    def angle(self): return int(self._angle)
    def reset_angle(self, angle=0): self._angle = angle
    def speed(self, *a): return self._speed
    def stalled(self): return False
    def done(self): return True
    def load(self): return 0

    def run(self, speed): self._speed = speed
    def stop(self): self._speed = 0
    def brake(self): self._speed = 0
    def hold(self): self._speed = 0
    def dc(self, duty): self._speed = duty * 10

    def run_time(self, speed, time, then=Stop.HOLD, wait=True):
        self._angle += speed * time / 1000
        _S["log"].append(f"motor {self.port}: run_time({speed}, {time})")
        if wait: globals()["wait"](time)

    def run_angle(self, speed, rotation_angle, then=Stop.HOLD, wait=True):
        self._angle += rotation_angle
        _S["log"].append(f"motor {self.port}: run_angle({speed}, {rotation_angle})")
        if wait: globals()["wait"](abs(rotation_angle / max(abs(speed), 1)) * 1000)

    def run_target(self, speed, target_angle, then=Stop.HOLD, wait=True):
        d = target_angle - self._angle
        self._angle = target_angle
        _S["log"].append(f"motor {self.port}: run_target({speed}, {target_angle})")
        if wait: globals()["wait"](abs(d / max(abs(speed), 1)) * 1000)

    def run_until_stalled(self, speed, then=Stop.COAST, duty_limit=None):
        _S["log"].append(f"motor {self.port}: run_until_stalled({speed})")
        wait(800)
        return int(self._angle)

    def track_target(self, target_angle): self._angle = target_angle


class DCMotor(Motor):
    pass


class _Sensor:
    def __init__(self, port, *a, **k): self.port = port
    def lights(self): return types.SimpleNamespace(on=lambda *a: None, off=lambda: None)


class ColorSensor(_Sensor):
    def color(self, surface=True): return Color.WHITE
    def reflection(self): return 50
    def ambient(self): return 10
    def hsv(self, surface=True): return Color.WHITE
    def detectable_colors(self, *a): pass

    @property
    def lights(self):
        return types.SimpleNamespace(on=lambda *a: None, off=lambda: None)


class UltrasonicSensor(_Sensor):
    def distance(self): return 2000
    def presence(self): return False

    @property
    def lights(self):
        return types.SimpleNamespace(on=lambda *a: None, off=lambda: None)


class ForceSensor(_Sensor):
    def force(self): return 0
    def distance(self): return 0
    def pressed(self, force=3): return False
    def touched(self): return False


class DriveBase:
    def __init__(self, left_motor, right_motor, wheel_diameter=56, axle_track=112):
        self.left, self.right = left_motor, right_motor
        self.wd, self.at = wheel_diameter, axle_track
        self._ss, self._tr = 400, 200
        self._dist, self._ang0 = 0.0, _S["a"]
        self._drive = (0, 0)

    def settings(self, straight_speed=None, straight_acceleration=None, turn_rate=None, turn_acceleration=None):
        if straight_speed: self._ss = abs(straight_speed)
        if turn_rate: self._tr = abs(turn_rate)
        return (self._ss, 600, self._tr, 900)

    def use_gyro(self, use_gyro): pass

    def straight(self, distance, then=Stop.BRAKE, wait=True):
        d = distance * (1 + random.gauss(0, _S["noise_straight"]) if _S["noise_straight"] else 1)
        _advance(d, 0, self._ss, self._tr)
        self._dist += distance

    def turn(self, angle, then=Stop.BRAKE, wait=True):
        err = random.gauss(0, _S["noise_turn"]) if _S["noise_turn"] else 0
        _advance(0, -(angle + err), self._ss, self._tr)

    def curve(self, radius, angle, then=Stop.BRAKE, wait=True):
        arc = math.radians(abs(angle)) * abs(radius)
        sign = 1 if radius >= 0 else -1
        _advance(arc * (1 if angle >= 0 else -1), -angle * sign, self._ss, self._tr)

    def arc(self, radius, angle=None, distance=None, then=Stop.BRAKE, wait=True):
        if angle is not None:
            self.curve(radius, angle, then, wait)
        elif distance is not None:
            self.curve(radius, math.degrees(distance / max(abs(radius), 1)), then, wait)

    def drive(self, speed, turn_rate):
        self._drive = (speed, turn_rate)
        _S["drive"] = (speed, turn_rate)

    def stop(self):
        _S["drive"] = (0, 0)

    def brake(self):
        self.stop()

    def distance(self): return int(self._dist)
    def angle(self): return int(-(_S["a"] - self._ang0))
    def state(self): return (int(self._dist), 0, self.angle(), 0)
    def reset(self, distance=0, angle=0): self._dist = distance; self._ang0 = _S["a"] + angle
    def done(self): return True
    def stalled(self): return False


_S["drive"] = (0, 0)
_wait_plain = wait


def wait(ms):  # noqa: F811  (drive() continues while waiting)
    sp, tr = _S.get("drive", (0, 0))
    if (sp or tr) and ms > 0:
        _advance(sp * ms / 1000, -tr * ms / 1000, max(abs(sp), 1), max(abs(tr), 1))
    else:
        _wait_plain(ms)


def _module(name, **items):
    m = types.ModuleType(name)
    for k, v in items.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


_module("pybricks")
_module("pybricks.hubs", PrimeHub=PrimeHub, InventorHub=InventorHub, EssentialHub=EssentialHub)
_module("pybricks.pupdevices", Motor=Motor, DCMotor=DCMotor, ColorSensor=ColorSensor, UltrasonicSensor=UltrasonicSensor, ForceSensor=ForceSensor)
_module("pybricks.parameters", Port=Port, Direction=Direction, Stop=Stop, Color=Color, Button=Button, Side=Side, Axis=Axis, Icon=Icon)
_module("pybricks.robotics", DriveBase=DriveBase, GyroDriveBase=DriveBase)
_module("pybricks.tools", wait=wait, StopWatch=StopWatch, multitask=None, run_task=None,
        hub_menu=lambda *a: a[0] if a else None, Matrix=None, vector=None)
