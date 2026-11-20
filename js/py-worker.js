// Runs Python (Pyodide) off the main thread so a stuck program can be stopped.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let py = null, mock = null;

async function boot() {
  if (py) return py;
  importScripts(PYODIDE + 'pyodide.js');
  py = await loadPyodide({ indexURL: PYODIDE });
  mock = await (await fetch(new URL('./pybricks-mock.py', self.location.href))).text();
  py.runPython(mock);
  return py;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'boot') {
    try { await boot(); postMessage({ type: 'ready' }); } catch (e) { postMessage({ type: 'error', error: 'Could not load Python: ' + e }); }
    return;
  }
  if (data.type !== 'run') return;
  const out = [];
  try {
    await boot();
    py.setStdout({ batched: s => out.push(s) });
    py.setStderr({ batched: s => out.push(s) });
    const { x, y, a } = data.start;
    py.runPython(mock); // fresh simulator state + modules every run
    py.globals.get('_reset')(x, y, a, data.noise.turn, data.noise.straight, data.seed);
    let error = null;
    try {
      await py.runPythonAsync(data.code, { globals: py.toPy({ __name__: '__main__' }) });
    } catch (e) {
      const msg = String(e.message || e);
      if (!/SystemExit/.test(msg)) error = msg.split('\n').filter(l => !l.includes('/lib/python') && !l.includes('_pyodide')).slice(-6).join('\n');
    }
    const S = py.globals.get('_S');
    const poses = S.get('poses').toJs().map(p => [...p]);
    const log = S.get('log').toJs();
    postMessage({ type: 'done', poses, log, out, error });
  } catch (e) {
    postMessage({ type: 'done', poses: [], log: [], out, error: String(e) });
  }
};
