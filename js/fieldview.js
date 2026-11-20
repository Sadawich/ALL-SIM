// Draws any competition field at true scale (width × height in mm), with zones, scoring spots, routes and robots.

const imgCache = new Map();
function loadImg(src, cb) {
  if (!src) return null;
  if (imgCache.has(src)) return imgCache.get(src);
  const im = new Image(); im.onload = cb; im.src = src; imgCache.set(src, im); return im;
}

export class FieldView {
  constructor(canvas, opts = {}) {
    this.c = canvas; this.opts = opts;
    this.field = opts.field; this.robot = opts.robot;
    this.route = null; this.poses = []; this.trail = []; this.highlight = null;
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize); this.ro.observe(canvas);
    canvas.addEventListener('pointerdown', e => this._ptr('down', e));
    canvas.addEventListener('pointermove', e => this._ptr('move', e));
    addEventListener('pointerup', this._up = e => this._ptr('up', e));
    this.resize();
  }
  destroy() { this.ro.disconnect(); removeEventListener('pointerup', this._up); }
  get FW() { return this.field?.width || 2362; }
  get FH() { return this.field?.height || 1143; }
  resize() {
    const FIELD_W = this.FW, FIELD_H = this.FH;
    const w = this.c.clientWidth || 800, dpr = devicePixelRatio || 1;
    this.c.style.height = (w * FIELD_H / FIELD_W) + 'px';
    this.c.width = w * dpr; this.c.height = w * FIELD_H / FIELD_W * dpr;
    this.s = this.c.width / FIELD_W; this.dpr = dpr;
    this.draw();
  }
  toField(e) {
    const FIELD_W = this.FW, FIELD_H = this.FH;
    const r = this.c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * FIELD_W, y: FIELD_H - (e.clientY - r.top) / r.height * FIELD_H };
  }
  _ptr(kind, e) {
    if (kind === 'up' && !this._down) return;
    if (kind === 'down') { this._down = true; this.c.setPointerCapture?.(e.pointerId); }
    if (kind === 'up') this._down = false;
    this.opts.onPointer?.(kind, this.toField(e), e, this._down);
  }
  X(x) { return x * this.s; }
  Y(y) { return (this.FH - y) * this.s; }

  draw() {
    if (this._lastDims !== this.FW + 'x' + this.FH) { this._lastDims = this.FW + 'x' + this.FH; return this.resize(); }
    const FIELD_W = this.FW, FIELD_H = this.FH;
    const x = this.c.getContext('2d'), s = this.s, W = this.c.width, H = this.c.height, f = this.field;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
    const im = loadImg(f?.image, () => this.draw());
    if (im?.complete && im.naturalWidth) x.drawImage(im, 0, 0, W, H);
    else {
      // own stylised mat: dark green-teal with soft zones
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#12322b'); g.addColorStop(1, '#0f2433'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.globalAlpha = .18;
      [[700, 760, 260, '#2dd4bf'], [1650, 420, 300, '#60a5fa'], [1180, 900, 180, '#a3e635'], [1950, 900, 160, '#f472b6']].forEach(([cx, cy, r, c]) => {
        const rg = x.createRadialGradient(this.X(cx), this.Y(cy), 0, this.X(cx), this.Y(cy), r * s); rg.addColorStop(0, c); rg.addColorStop(1, 'transparent');
        x.fillStyle = rg; x.fillRect(0, 0, W, H);
      });
      x.globalAlpha = 1;
    }
    // grid
    const gs = f?.grid || 100;
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1;
    if (gs * s > 4) for (let gx = gs; gx < FIELD_W; gx += gs) { x.beginPath(); x.moveTo(this.X(gx), 0); x.lineTo(this.X(gx), H); x.stroke(); }
    if (gs * s > 4) for (let gy = gs; gy < FIELD_H; gy += gs) { x.beginPath(); x.moveTo(0, this.Y(gy)); x.lineTo(W, this.Y(gy)); x.stroke(); }
    // launch areas
    for (const [zi, a] of (f?.zones || []).entries()) {
      const side = a.name || 'Zone ' + (zi + 1);
      if (zi === this.highlightZone) { x.fillStyle = 'rgba(255,176,32,.25)'; x.fillRect(this.X(a.x), this.Y(a.y + a.h), a.w * s, a.h * s); }
      x.fillStyle = 'rgba(255,255,255,.06)'; x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 2 * this.dpr; x.setLineDash([8 * this.dpr, 6 * this.dpr]);
      x.fillRect(this.X(a.x), this.Y(a.y + a.h), a.w * s, a.h * s); x.strokeRect(this.X(a.x), this.Y(a.y + a.h), a.w * s, a.h * s); x.setLineDash([]);
      x.fillStyle = 'rgba(255,255,255,.6)'; const fs = Math.max(7 * this.dpr, 24 * s); x.font = `600 ${fs}px ui-monospace, monospace`; x.textAlign = 'center';
      x.fillText(side.toUpperCase().slice(0, 18), this.X(a.x + a.w / 2), this.Y(a.y + a.h) + fs * 1.5);
    }
    // missions
    for (const m of f?.missions || []) {
      const r = Math.max(9 * this.dpr, 42 * s), mx = this.X(m.x), my = this.Y(m.y);
      x.fillStyle = m.id === this.highlight ? '#ffb020' : '#f8fafc'; x.strokeStyle = '#ef4444'; x.lineWidth = Math.max(1.5, r / 8);
      x.beginPath(); x.roundRect(mx - r, my - r * .75, r * 2, r * 1.5, 6 * this.dpr); x.fill(); x.stroke();
      x.fillStyle = '#b91c1c'; x.font = `800 ${Math.round(r * 0.7)}px ui-monospace, monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(m.num, mx, my + 1); x.textBaseline = 'alphabetic';
      if (this.opts.showNames) { x.fillStyle = 'rgba(255,255,255,.85)'; const nf = Math.max(6 * this.dpr, 22 * s); x.font = `${nf}px system-ui`; x.fillText(m.name.slice(0, 24) + (m.points != null ? ` · ${m.points}` : ''), mx, my + r + nf); }
    }
    // border
    x.strokeStyle = '#e5e7eb'; x.lineWidth = 3 * this.dpr; x.strokeRect(0, 0, W, H);
    // trail
    if (this.trail.length > 1) {
      x.strokeStyle = 'rgba(45,212,191,.9)'; x.lineWidth = 3 * this.dpr; x.beginPath();
      this.trail.forEach((p, i) => i ? x.lineTo(this.X(p.x), this.Y(p.y)) : x.moveTo(this.X(p.x), this.Y(p.y))); x.stroke();
    }
    // route
    const rt = this.route;
    if (rt) {
      const pts = [rt.start, ...rt.points];
      x.strokeStyle = '#ffb020'; x.lineWidth = 3 * this.dpr; x.setLineDash([10 * this.dpr, 6 * this.dpr]);
      x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(this.X(p.x), this.Y(p.y)) : x.moveTo(this.X(p.x), this.Y(p.y))); x.stroke(); x.setLineDash([]);
      rt.points.forEach((p, i) => {
        x.fillStyle = p.rev ? '#f472b6' : '#ffb020'; x.beginPath(); x.arc(this.X(p.x), this.Y(p.y), 9 * this.dpr, 0, 7); x.fill();
        x.fillStyle = '#111'; x.font = `700 ${10 * this.dpr}px ui-monospace, monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(i + 1, this.X(p.x), this.Y(p.y) + .5); x.textBaseline = 'alphabetic';
      });
      this.drawRobot(x, rt.start, 'rgba(255,176,32,.35)');
    }
    for (const p of this.poses) this.drawRobot(x, p, p.color || 'rgba(45,212,191,.85)');
  }
  drawRobot(x, pose, color) {
    const fp = this.robot?.footprint, c = this.robot?.center || [0, 0];
    const x0 = (fp?.x0 ?? -60) - c[0], x1 = (fp?.x1 ?? 100) - c[0], y0 = (fp?.y0 ?? -70) - c[1], y1 = (fp?.y1 ?? 70) - c[1];
    x.save(); x.translate(this.X(pose.x), this.Y(pose.y)); x.rotate(-pose.a * Math.PI / 180); x.scale(this.s, -this.s);
    x.fillStyle = color; x.strokeStyle = '#fff'; x.lineWidth = 2 / this.s * this.dpr;
    x.beginPath(); x.rect(x0, y0, x1 - x0, y1 - y0); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(x1 + 30, 0); x.lineTo(x1, 18); x.lineTo(x1, -18); x.closePath(); x.fillStyle = '#fff'; x.fill();
    x.restore();
  }
}

// ---- route → Pybricks code ----
const norm = a => ((a + 540) % 360) - 180;
export function routeSteps(route) {
  const steps = []; let a = route.start.a, px = route.start.x, py = route.start.y;
  for (const p of route.points) {
    const dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy);
    if (d < 1) continue;
    let face = Math.atan2(dy, dx) * 180 / Math.PI; if (p.rev) face += 180;
    const turn = -norm(face - a); // Pybricks: positive = clockwise
    if (Math.abs(turn) > 0.5) steps.push({ kind: 'turn', v: Math.round(turn * 10) / 10 });
    steps.push({ kind: 'straight', v: Math.round(p.rev ? -d : d) });
    if (p.action?.trim()) steps.push({ kind: 'action', v: p.action.trim() });
    a = face; px = p.x; py = p.y;
  }
  return steps;
}

export function routeCode(route, robot, name = 'Program') {
  const lp = robot.leftPort || 'A', rp = robot.rightPort || 'B';
  const steps = routeSteps(route);
  return `# ${name} — generated by FLL SIM route planner
# Start: x=${Math.round(route.start.x)} mm, y=${Math.round(route.start.y)} mm, facing ${Math.round(route.start.a)}° on the field
from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Port, Direction, Stop
from pybricks.robotics import DriveBase
from pybricks.tools import wait

hub = PrimeHub()
left = Motor(Port.${lp}, Direction.${robot.leftDir || 'COUNTERCLOCKWISE'})
right = Motor(Port.${rp}, Direction.${robot.rightDir || 'CLOCKWISE'})
drive_base = DriveBase(left, right, wheel_diameter=${robot.wheelDiameter ?? 56}, axle_track=${Math.round(robot.axleTrack ?? 112)})
drive_base.use_gyro(True)
drive_base.settings(straight_speed=400, straight_acceleration=600, turn_rate=200)

${steps.map(s => s.kind === 'turn' ? `drive_base.turn(${s.v})` : s.kind === 'straight' ? `drive_base.straight(${s.v})` : s.v).join('\n') || '# add points on the field'}
`;
}
