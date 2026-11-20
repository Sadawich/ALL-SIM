// Robot parts catalog + mass/balance calculation.
// Coordinates in mm: x forward, y left, z up. Masses in grams (approximate, weigh yours to be exact).
export const CATALOG = {
  hub:      { name: 'SPIKE Prime Hub',        dims: [88, 56, 32], mass: 150, color: '#e5e7eb', group: 'Electronics' },
  lmotor:   { name: 'Large Motor',            dims: [56, 32, 24], mass: 61,  color: '#f3f4f6', group: 'Electronics' },
  mmotor:   { name: 'Medium Motor',           dims: [48, 24, 24], mass: 42,  color: '#f3f4f6', group: 'Electronics' },
  color:    { name: 'Color Sensor',           dims: [24, 24, 32], mass: 16,  color: '#1f2937', group: 'Electronics' },
  distance: { name: 'Distance Sensor',        dims: [24, 56, 24], mass: 20,  color: '#1f2937', group: 'Electronics' },
  force:    { name: 'Force Sensor',           dims: [48, 24, 24], mass: 22,  color: '#1f2937', group: 'Electronics' },
  wheel56:  { name: 'Wheel Ø56',              dims: [56, 14, 56], mass: 16,  color: '#374151', group: 'Wheels', wheel: 56 },
  wheel62:  { name: 'Wheel Ø62.4',            dims: [62.4, 20, 62.4], mass: 22, color: '#374151', group: 'Wheels', wheel: 62.4 },
  wheel88:  { name: 'Wheel Ø88',              dims: [88, 22, 88], mass: 35,  color: '#374151', group: 'Wheels', wheel: 88 },
  caster:   { name: 'Ball caster',            dims: [24, 24, 16], mass: 9,   color: '#9ca3af', group: 'Wheels', caster: true },
  beam15:   { name: 'Beam 15',                dims: [120, 8, 8],  mass: 3.6, color: '#38bdf8', group: 'Structure' },
  beam9:    { name: 'Beam 9',                 dims: [72, 8, 8],   mass: 2.1, color: '#38bdf8', group: 'Structure' },
  frame711: { name: 'Frame 7×11',             dims: [88, 56, 8],  mass: 8.5, color: '#facc15', group: 'Structure' },
  frame57:  { name: 'Frame 5×7',              dims: [56, 40, 8],  mass: 6,   color: '#facc15', group: 'Structure' },
  plate:    { name: 'Plate 8×16',             dims: [128, 64, 3.2], mass: 12, color: '#a3a3a3', group: 'Structure' },
  arm:      { name: 'Attachment arm',         dims: [96, 24, 24], mass: 14,  color: '#fb923c', group: 'Attachments' },
  fork:     { name: 'Forklift / gate',        dims: [40, 80, 64], mass: 24,  color: '#fb923c', group: 'Attachments' },
  ballast:  { name: 'Ballast weight',         dims: [24, 24, 24], mass: 50,  color: '#78716c', group: 'Attachments' },
};

export function defaultBuild() {
  return {
    parts: [
      { id: 1, type: 'frame711', x: 8, y: 0, z: 20, rot: 0 },
      { id: 2, type: 'hub', x: 8, y: 0, z: 40, rot: 0 },
      { id: 3, type: 'lmotor', x: -16, y: 36, z: 16, rot: 0, port: 'A', role: 'left' },
      { id: 4, type: 'lmotor', x: -16, y: -36, z: 16, rot: 0, port: 'B', role: 'right' },
      { id: 5, type: 'wheel56', x: -24, y: 60, z: 28, rot: 0, drive: true },
      { id: 6, type: 'wheel56', x: -24, y: -60, z: 28, rot: 0, drive: true },
      { id: 7, type: 'caster', x: 72, y: 0, z: 8, rot: 0 },
      { id: 8, type: 'color', x: 64, y: 24, z: 20, rot: 0, port: 'C' },
      { id: 9, type: 'mmotor', x: 40, y: -20, z: 64, rot: 0, port: 'D' },
      { id: 10, type: 'arm', x: 80, y: -20, z: 64, rot: 0 },
      { id: 11, type: 'beam15', x: 8, y: 32, z: 4, rot: 0 },
      { id: 12, type: 'beam15', x: 8, y: -32, z: 4, rot: 0 },
    ],
    leftPort: 'A', rightPort: 'B', leftDir: 'COUNTERCLOCKWISE', rightDir: 'CLOCKWISE',
    motorMaxSpeed: 1000,
    nextId: 13,
  };
}

export const massOf = p => p.mass ?? CATALOG[p.type].mass;
const dimsOf = p => {
  const c = CATALOG[p.type]; let [l, w, h] = c.dims;
  if (p.rot % 2) [l, w] = [w, l];
  return [l, w, h];
};
export { dimsOf };

export function computeStats(build) {
  const parts = build.parts.filter(p => CATALOG[p.type]);
  let M = 0, cx = 0, cy = 0, cz = 0;
  for (const p of parts) { const m = massOf(p); M += m; cx += m * p.x; cy += m * p.y; cz += m * p.z; }
  if (!M) return { mass: 0, inertia: 0.001, com: [0, 0, 0], wheelDiameter: 56, axleTrack: 112, driveLoad: 1, warnings: ['Add some parts'] };
  cx /= M; cy /= M; cz /= M;
  const wheels = parts.filter(p => CATALOG[p.type].wheel);
  const drive = wheels.filter(w => w.drive).length >= 2 ? wheels.filter(w => w.drive) : wheels;
  let wheelDiameter = 56, axleTrack = 112, wx = cx, wy = 0;
  const warnings = [];
  if (drive.length >= 2) {
    const L = drive.reduce((a, b) => (b.y > a.y ? b : a)), R = drive.reduce((a, b) => (b.y < a.y ? b : a));
    wheelDiameter = CATALOG[L.type].wheel;
    if (CATALOG[R.type].wheel !== wheelDiameter) warnings.push('Left and right drive wheels are different sizes');
    axleTrack = Math.abs(L.y - R.y);
    wx = (L.x + R.x) / 2; wy = (L.y + R.y) / 2;
    if (Math.abs(L.x - R.x) > 4) warnings.push('Drive wheels are not on the same axle line');
  } else warnings.push('Needs two drive wheels');
  // yaw inertia about the point between the drive wheels
  let I = 0;
  for (const p of parts) {
    const m = massOf(p) / 1000, [l, w] = dimsOf(p);
    const dx = (p.x - wx) / 1000, dy = (p.y - wy) / 1000;
    I += m * (dx * dx + dy * dy) + m * ((l / 1000) ** 2 + (w / 1000) ** 2) / 12;
  }
  // share of weight on drive wheels (rest on caster/skid)
  const casters = parts.filter(p => CATALOG[p.type].caster);
  let driveLoad = 1;
  if (casters.length) {
    const xc = casters.reduce((s, c) => s + c.x, 0) / casters.length;
    driveLoad = (xc - cx) / (xc - wx);
    if (driveLoad > 1.02) warnings.push('Centre of mass is behind the wheels: robot can tip backwards');
    if (driveLoad < 0.45) warnings.push('Less than 45% of weight on drive wheels: expect wheel slip');
    driveLoad = Math.max(0, Math.min(1, driveLoad));
  } else if (Math.abs(cx - wx) > 10) warnings.push('No caster: robot will rest on its frame');
  if (cz > axleTrack * 0.6) warnings.push('High centre of mass: may tip in fast turns');
  if (Math.abs(cy - wy) > 8) warnings.push('Weight is off-centre left/right: robot will pull to one side');
  return {
    mass: M / 1000, inertia: I, com: [cx, cy, cz], wheelDiameter, axleTrack, driveLoad, warnings,
    leftPort: build.leftPort, rightPort: build.rightPort, leftDir: build.leftDir, rightDir: build.rightDir,
    motorMaxSpeed: build.motorMaxSpeed, calibration: build.calibration || null,
    footprint: footprint(parts), center: [wx, wy],
  };
}

function footprint(parts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of parts) { const [l, w] = dimsOf(p); x0 = Math.min(x0, p.x - l / 2); x1 = Math.max(x1, p.x + l / 2); y0 = Math.min(y0, p.y - w / 2); y1 = Math.max(y1, p.y + w / 2); }
  return { x0, x1, y0, y1 };
}
