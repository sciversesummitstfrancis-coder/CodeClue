// CodeClue runners — three routes for student code:
//   1. runJsSandbox   : fresh sandboxed iframe per run (browser sandbox, no OS access)
//   2. runPythonWorker: Pyodide WebAssembly worker (also sandboxed, cached after first load)
//   3. runToolchain   : real compilers/interpreters on this machine, via main process

'use strict';

/* ============================= JS sandbox ============================= */

const SANDBOX_HTML = `<!doctype html>
<html><body><script>
const send = (m) => parent.postMessage(m, '*');
const fmt = (v) => {
  try {
    if (typeof v === 'string') return v;
    if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
    if (v instanceof Error) return v.stack || v.name + ': ' + v.message;
    return JSON.stringify(v, (k, val) => {
      if (typeof val === 'bigint') return String(val) + 'n';
      if (val instanceof Map) return [...val];
      if (val instanceof Set) return [...val];
      return val;
    }, 2) ?? String(v);
  } catch { return String(v); }
};
['log','info','warn','error'].forEach((k) => {
  const orig = console[k];
  console[k] = (...a) => send({ type: 'log', kind: k === 'error' ? 'err' : (k === 'warn' ? 'warn' : 'out'), text: a.map(fmt).join(' ') });
});
window.onerror = (m, s, l, c, e) => { send({ type: 'err', text: (e && e.stack) ? String(e.stack).split('\\n').slice(0,6).join('\\n') : String(m) }); return true; };
window.onunhandledrejection = (e) => { send({ type: 'err', text: (e.reason && e.reason.stack) ? String(e.reason.stack).split('\\n').slice(0,6).join('\\n') : String(e.reason) }); };
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (d.__cc !== 'run') return;
  // Execute as a fresh classic <script>: keeps top-level const/class/function
  // visible to later entries (needed by the persistent Code Pad session).
  try {
    const s = document.createElement('script');
    s.textContent = String(d.code == null ? '' : d.code);
    document.body.appendChild(s);
  } catch (e) {
    send({ type: 'err', text: String(e && e.message || e) });
  }
  send({ type: 'done' });
});
send({ type: 'ready' });
<\/script></body></html>`;

function runJsSandbox(code, timeoutMs, onLine) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.display = 'none';
    document.getElementById('hiddenFrames').appendChild(frame);
    frame.srcdoc = SANDBOX_HTML;

    let started = false;
    let finished = false;
    const stdout = [];
    const stderr = [];

    const finish = (kind) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      frame.remove();
      resolve(kind === 'timeout'
        ? { stdout, stderr, error: 'Your program ran too long (possible infinite loop) and was stopped.' }
        : { stdout, stderr, error: stderr.length ? stderr[stderr.length - 1] : null });
    };

    const timer = setTimeout(() => finish('timeout'), timeoutMs || 8000);

    function handler(ev) {
      const m = ev.data || {};
      if (m.type === 'ready') {
        started = true;
        frame.contentWindow.postMessage({ __cc: 'run', code }, '*');
        return;
      }
      if (m.type === 'log') {
        const kind = m.kind === 'err' ? 'err' : (m.kind === 'warn' ? 'warn' : 'out');
        onLine?.(kind, m.text);
        stdout.push(m.text);
      } else if (m.type === 'err') {
        onLine?.('err', m.text);
        stderr.push(m.text);
      } else if (m.type === 'done') {
        finish();
      }
    }
    window.addEventListener('message', handler);
  });
}

/* ============================ Python worker ============================ */

let pyWorker = null;
let pyJobSeq = 0;
let pyPending = new Map(); // id -> {stdout, stderr, onLine, resolve}

const PY_WORKER_SRC = `
let py = null;
let currentId = null;
self.onmessage = async (e) => {
  const { id, code } = e.data;
  currentId = id;
  if (!py) {
    try {
      importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
      py = await loadPyodide();
      py.setStdout({ batched: (s) => postMessage({ id: currentId, type: 'log', text: s }) });
      py.setStderr({ batched: (s) => postMessage({ id: currentId, type: 'err', text: s }) });
      postMessage({ id, type: 'ready' });
    } catch (err) {
      postMessage({ id, type: 'fatal', text: 'Python sandbox unavailable (the browser engine could not be downloaded).' });
      return;
    }
  }
  try {
    await py.runPythonAsync(code);
  } catch (err) {
    postMessage({ id, type: 'err', text: String(err.message || err) });
  }
  postMessage({ id, type: 'done' });
};
`;

function ensurePyWorker() {
  if (pyWorker) return pyWorker;
  const url = URL.createObjectURL(new Blob([PY_WORKER_SRC], { type: 'text/javascript' }));
  pyWorker = new Worker(url);
  pyWorker.onmessage = (ev) => {
    const { id, type, text } = ev.data || {};
    const job = pyPending.get(id);
    if (!job) return;
    if (type === 'log') { job.onLine?.('out', text); job.stdout.push(text); }
    else if (type === 'err') { job.onLine?.('err', text); job.stderr.push(text); }
    else if (type === 'fatal') { job.stderr.push(text); job.resolve({ stdout: job.stdout, stderr: [...job.stderr], error: text, fatal: true }); pyPending.delete(id); }
    else if (type === 'done') { job.resolve({ stdout: job.stdout, stderr: job.stderr, error: job.stderr.length ? job.stderr[job.stderr.length - 1] : null }); pyPending.delete(id); }
  };
  return pyWorker;
}

function runPython(code, timeoutMs, onLine, wantReadyCheck = true) {
  return new Promise((resolve) => {
    const id = ++pyJobSeq;
    const job = { stdout: [], stderr: [], onLine, resolve, readyArrived: false };
    pyPending.set(id, job);
    const w = ensurePyWorker();

    const timer = setTimeout(() => {
      if (!pyPending.has(id)) return;
      pyPending.delete(id);
      resolve({ stdout: job.stdout, stderr: job.stderr, error: 'Your program ran too long (possible infinite loop) and was stopped.' });
    }, (timeoutMs || 8000));

    const origResolve = job.resolve;
    job.resolve = (v) => { clearTimeout(timer); origResolve(v); };

    w.postMessage({ id, code });
  });
}

/* ============================ toolchain ============================= */

async function runToolchain(lang, source, fileName, timeoutMs, onLine, tools) {
  const res = await window.codeclue.runLocal({ lang, source, fileName, timeoutMs, tools });
  if (!res) return { stdout: [], stderr: ['Runner failed'], error: 'Runner failed' };
  const stdout = String(res.stdout || '').split('\n').filter((s, i, a) => !(i === a.length - 1 && s === ''));
  const stderr = String(res.stderr || '').split('\n').filter((s, i, a) => !(i === a.length - 1 && s === ''));
  stdout.forEach((l) => onLine?.('out', l));
  stderr.forEach((l) => onLine?.('err', l));
  if (res.timedOut) {
    stderr.push('Process was stopped after the time limit (possible infinite loop).');
  }
  return { stdout, stderr, error: null, exitCode: res.exitCode, stage: res.stage };
}

/* ============================ dispatch ============================= */

/**
 * Run code for the given language with a given strategy.
 * strategy: 'auto' | 'sandbox' (js in-app) | 'pyodide' | 'toolchain'
 */
async function runCode({ code, lang, strategy = 'auto', fileName, timeoutMs = 8000, onLine, tools }) {
  onLine?.('sys', `$ run (${lang})`);
  const t0 = performance.now();
  let result;
  try {
    if (lang === 'javascript') {
      result = strategy === 'toolchain' && tools?.node
        ? await runToolchain('javascript', code, fileName, timeoutMs, onLine, tools)
        : await runJsSandbox(code, timeoutMs, onLine);
    } else if (lang === 'python') {
      if (strategy === 'toolchain' && tools?.python3) {
        result = await runToolchain('python', code, fileName, timeoutMs, onLine, tools);
      } else {
        result = await runPython(code, timeoutMs, onLine);
        // Pyodide is fetched from a CDN on first use. Offline (or behind a
        // blocked CDN) the local python3 toolchain keeps Python working.
        if (result?.fatal && tools?.python3) {
          onLine?.('sys', 'Python sandbox unavailable offline — using the local python3 toolchain instead.');
          const fallback = await runToolchain('python', code, fileName, timeoutMs, onLine, tools);
          if (fallback) result = fallback;
        } else if (result?.fatal) {
          // No local Python either — show the real problem.
          onLine?.('err', result.error || 'Python is unavailable on this machine.');
        }
      }
    } else {
      if (strategy === 'auto' || strategy === 'toolchain') {
        result = await runToolchain(lang, code, fileName, timeoutMs, onLine, tools);
        if (!result && strategy !== 'toolchain') {
          result = { stdout: [], stderr: [], error: `No runner for ${lang}` };
        }
      } else {
        result = { stdout: [], stderr: [], error: `${lang} must run through the ${lang} toolchain` };
      }
    }
  } catch (e) {
    result = { stdout: [], stderr: [String(e.message || e)], error: String(e.message || e) };
  }
  const ms = Math.round(performance.now() - t0);
  onLine?.('sys', `$ done in ${ms} ms`);
  return result;
}
