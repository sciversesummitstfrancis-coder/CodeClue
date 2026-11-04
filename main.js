// CodeClue — Electron main process
// Owns: window, toolchain detection, sandboxed compile/run pipelines, chrooted workspace FS.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');

let win = null;

// ---------------------------------------------------------------- toolchains

const TOOL_PROBES = [
  ['node', ['--version']],
  ['python3', ['--version']],
  ['python', ['--version']],
  ['gcc', ['--version']],
  ['g++', ['--version']],
  ['javac', ['-version']],
  ['java', ['-version']],
  ['rustc', ['--version']],
];

async function probe(tool, args) {
  return new Promise((resolve) => {
    execFile(tool, args, { timeout: 6000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const text = ((stdout || '') + (stderr || '')).trim();
      resolve(text ? text.split('\n')[0].trim() : null);
    });
  });
}

// ------------------------------------------------------------- run pipelines
// Every language: [optional compile step] -> execute step, all inside a fresh
// temp dir with a hard timeout. Interpreter languages are ALSO runnable
// in-app (sandbox/pyodide) — this registry is the "real toolchain" route.

const PIPELINES = {
  javascript: {
    gotcha: ['node', '_file_'],
    preArgs: [],
    postArgs: ['_file_'],
    defaultName: 'main.js',
  },
  python: {
    gotcha: ['python3', '_file_'],
    preArgs: [],
    postArgs: ['_file_'],
    defaultName: 'main.py',
  },
  c: {
    preArgs: ['_file_', '-o', '_base_'],
    preTool: 'gcc',
    gotcha: ['./_base_'],
    defaultName: 'main.c',
  },
  cpp: {
    preArgs: ['_file_', '-o', '_base_'],
    preTool: 'g++',
    gotcha: ['./_base_'],
    defaultName: 'main.cpp',
  },
  java: {
    preArgs: ['_file_'],
    preTool: 'javac',
    gotcha: ['java', '-cp', '.', '_CLASS_'],
    defaultName: 'Main.java',
  },
  rust: {
    preArgs: ['_file_', '-o', '_base_'],
    preTool: 'rustc',
    gotcha: ['./_base_'],
    defaultName: 'main.rs',
  },
};

function collect(child) {
  const out = { stdout: '', stderr: '' };
  child.stdout?.on('data', (d) => (out.stdout += d.toString()));
  child.stderr?.on('data', (d) => (out.stderr += d.toString()));
  return out;
}

function runStep(tool, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let child;
    try {
      child = spawn(tool, args, { cwd, timeout: timeoutMs, windowsHide: true });
    } catch (e) {
      return resolve({ exitCode: 127, stdout: '', stderr: `Could not launch ${tool}: ${e.message}` });
    }
    const cap = collect(child);
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      resolve({
        exitCode: code ?? null,
        stdout: cap.stdout,
        stderr: cap.stderr,
        timedOut: signal === 'SIGTERM',
      });
    };
    child.on('error', (e) => {
      done = true;
      resolve({ exitCode: 127, stdout: cap.stdout, stderr: cap.stderr + `\n${e.message}`, timedOut: false });
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}

async function runPipeline(lang, source, fileName, timeoutMs, tools) {
  const p = PIPELINES[lang];
  if (!p) return { exitCode: 1, stdout: '', stderr: `No toolchain registered for "${lang}".`, timedOut: false };

  const tmp = path.join(os.tmpdir(), `codeclue-${crypto.randomUUID().slice(0, 8)}`);
  await fs.mkdir(tmp, { recursive: true });

  let base = 'program';
  let name = fileName || p.defaultName;

  // Java: class name must match the file name.
  if (lang === 'java') {
    const m = /(?:public\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(source);
    name = (m ? m[1] : 'Main') + '.java';
  }

  try {
    await fs.writeFile(path.join(tmp, name), source);
    base = name.replace(/\.[^.]+$/, '');

    // compile step
    if (p.preTool) {
      if (!tools?.[p.preTool]) {
        return { exitCode: 1, stdout: '', stderr: `${p.preTool} was not detected on this machine, so ${lang} can't compile here.`, timedOut: false };
      }
      const args = p.preArgs.map((a) => (a === '_file_' ? name : a === '_base_' ? base : a));
      const res = await runStep(p.preTool, args, tmp, Math.min(timeoutMs, 60000));
      if (res.exitCode !== 0) {
        res.stage = 'compile';
        return res;
      }
    }

    const gotcha = p.gotcha;
    if (gotcha[0] === 'java' && !tools?.java) {
      return { exitCode: 1, stdout: '', stderr: 'java was not detected on this machine.', timedOut: false };
    }

    const mapArg = (a) => {
      if (a === '_file_') return name;
      if (a === '_base_') return base;
      if (a === '_CLASS_') return base;
      if (a === './_base_') return `./${base}`;
      return a;
    };
    const args = gotcha.slice(1).map(mapArg);
    const res = await runStep(mapArg(gotcha[0]), args, tmp, timeoutMs);
    res.stage = 'run';
    return res;
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- workspace

let configPath = null;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'venv', 'env', '__pycache__', '.expo', 'out']);

async function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {}
  return cfg;
}

async function saveConfig(cfg) {
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

function ensureWorkspace(dir) {
  return path.isAbsolute(dir) ? dir : path.join(app.getPath('userData'), 'workspace');
}

function guardRel(root, rel) {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Path escapes the workspace sandbox.');
  }
  return abs;
}

async function readTree(root, dir = root, depth = 0, acc = { count: 0 }) {
  const entries = [];
  if (depth > 6 || acc.count > 1200) return entries;
  let list;
  try {
    list = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const e of list) {
    if (acc.count > 1200) break;
    const child = path.join(dir, e.name);
    const rel = path.relative(root, child);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      acc.count++;
      entries.push({ name: e.name, path: rel, type: 'dir', children: await readTree(root, child, depth + 1, acc) });
    } else if (e.isFile()) {
      acc.count++;
      let size = 0;
      try {
        size = (await fs.stat(child)).size;
      } catch {}
      entries.push({ name: e.name, path: rel, type: 'file', size });
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return entries;
}

// ------------------------------------------------------------------ window
// The renderer is served over a loopback HTTP server instead of file:// —
// Monaco's TypeScript service needs working fetch(), which browsers always
// refuse on file:// URLs. Only 127.0.0.1 can reach it.

const http = require('node:http');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
};

function createStaticServer() {
  const handler = (req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (urlPath === '/' || urlPath === '/index.html') urlPath = '/renderer/index.html';
    const filePath = path.normalize(path.join(__dirname, urlPath));
    if (!filePath.startsWith(__dirname + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(filePath)
      .then((data) => {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      })
      .catch(() => {
        console.log(`[404] ${req.method} ${req.url} -> ${filePath}`);
        res.writeHead(404).end();
      });
  };

  const listen = (port) => new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    const onError = (e) => { server.removeListener('listening', onListening); reject(e); };
    const onListening = () => { server.removeListener('error', onError); resolve(server); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });

  // A stable loopback port keeps the page origin stable, which is what makes
  // localStorage (profile, progress, settings) survive between launches.
  return (async () => {
    const cfg = await loadConfig();
    const preferred = Number.isInteger(cfg.staticPort) && cfg.staticPort > 1024 ? cfg.staticPort : 43117;
    let server;
    let usedPreferred = false;
    try {
      server = await listen(preferred);
      usedPreferred = true;
    } catch (e) {
      console.log('[server] preferred port busy, picking a free one:', e.code || e.message);
      server = await listen(0);
    }
    const actual = server.address().port;
    // Only persist a port we actually chose. If we had to fall back because the
    // preferred port was taken, keep the old value so the next launch returns to
    // the stable origin instead of silently moving (and losing) saved data.
    if (usedPreferred && actual !== cfg.staticPort) await saveConfig({ ...cfg, staticPort: actual });
    return `http://127.0.0.1:${actual}/renderer/index.html`;
  })();
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1218',
    autoHideMenuBar: true,
    title: 'CodeClue — BlueJ × VS Code for students',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Open filling the screen, not a fixed 1500×940 box.
  win.maximize();
  win.loadURL(url);

  // F11 toggles true fullscreen; Esc leaves it (Electron default).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
}

// --------------------------------------------------------------------- IPC

ipcMain.handle('win:toggleFullscreen', () => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle('win:isFullscreen', () => !!(win && win.isFullScreen()));

ipcMain.handle('tools:detect', async () => {
  const out = {};
  for (const [tool, args] of TOOL_PROBES) out[tool] = await probe(tool, args);
  return out;
});

ipcMain.handle('run:local', async (_e, payload) => {
  const { lang, source, fileName, timeoutMs = 10000, tools } = payload || {};
  if (typeof source !== 'string' || !source.length) {
    return { exitCode: 1, stdout: '', stderr: 'Nothing to run — the editor is empty.', timedOut: false };
  }
  try {
    return await runPipeline(lang, source, fileName, Math.max(1000, Math.min(timeoutMs, 120000)), tools);
  } catch (e) {
    return { exitCode: 1, stdout: '', stderr: e.message, timedOut: false };
  }
});

// ---------------------------------------------------------------- local AI (Ollama)

const OLLAMA = 'http://localhost:11434';
const AI_MODEL = 'qwen2.5-coder:0.5b';

const AI_SYSTEM = `You are CodeClue, a patient coding tutor built into a student IDE.
The student is learning to program. They may share code, errors, or a mission goal.

Rules:
- Never write the full solution. Give progressive hints: nudge → concept → small shape.
- If they paste an error, explain what it means in one sentence, then ask a guiding question.
- Keep answers short (3-6 sentences), encouraging, and jargon-light.
- When showing code, show only a skeleton with blanks, never the completed program.
- If they ask for the answer, refuse kindly and offer the next clue instead.
- Speak plainly, like a helpful lab partner. Use the student's name if they give it.`;

const AI_REVIEW_SYSTEM = `You are CodeClue's code reviewer, a strict but kind teaching assistant.
You receive a student's program, the exercise they are working on, the last run output,
and sometimes a checkpoint verdict from the exercise validator.

Review the code and answer in exactly these short sections:
1. What works — one sentence.
2. Mistakes — list the concrete bugs or risky lines. Quote the line, say why it is wrong, and what the correct idea is. If there are none, say "No mistakes found."
3. Next step — one guiding hint or question that moves them forward.

Rules:
- The run output and checkpoint verdict are ground truth. Read them carefully before judging the code.
- If the checkpoint says the output is wrong, the code is wrong: never say "No mistakes found", even if the code looks plausible.
- Compare what the code actually printed with what the exercise asks for. Count lines or values when that matters.
- Never paste a complete corrected program.
- Small skeletons with blanks are allowed in "Next step".
- Be specific about line numbers when you can.
- Maximum 120 words. Plain language. No preamble.`;

async function ollamaFetch(path, body) {
  const res = await fetch(`${OLLAMA}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

ipcMain.handle('ai:status', async () => {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { ok: false, error: `Ollama responded ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const qwenModels = models.filter((m) => /qwen2\.5-coder/i.test(m));
    const result = {
      ok: true,
      models,
      qwenModels,
      hasQwen: qwenModels.length > 0,
      defaultModel: models.includes(AI_MODEL) ? AI_MODEL : (qwenModels[0] || AI_MODEL),
    };
    console.log('[CodeClue AI] status:', result.ok ? 'connected' : 'disconnected', '-', models.join(', '));
    return result;
  } catch (e) {
    console.log('[CodeClue AI] status: disconnected -', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('ai:chat', async (_e, { messages, model = AI_MODEL, system = AI_SYSTEM, mode = 'tutor', temperature, numPredict }) => {
  const sys = mode === 'review' ? AI_REVIEW_SYSTEM : (system || AI_SYSTEM);
  const data = await ollamaFetch('/api/chat', {
    model,
    messages: [
      { role: 'system', content: sys },
      ...messages,
    ],
    stream: false,
    options: {
      num_predict: numPredict ?? (mode === 'review' ? 320 : 256),
      temperature: temperature ?? (mode === 'review' ? 0.25 : 0.6),
      top_p: 0.9,
    },
  });
  return { content: data.message?.content ?? '', model };
});

ipcMain.handle('fs:getWorkspace', async () => {
  const cfg = await loadConfig();
  const root = ensureWorkspace(cfg.workspace);
  await fs.mkdir(root, { recursive: true });
  await saveConfig({ ...cfg, workspace: root });
  return root;
});

ipcMain.handle('fs:chooseWorkspace', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose your CodeClue workspace',
  });
  if (res.canceled || !res.filePaths.length) return null;
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, workspace: res.filePaths[0] });
  return res.filePaths[0];
});

// A project root may be the workspace itself or any folder the student opened
// as a project. Nothing else is reachable from the renderer.
function resolveRoot(cfg, requested) {
  const ws = ensureWorkspace(cfg.workspace);
  if (!requested) return ws;
  const abs = path.resolve(requested);
  const known = (cfg.projects || []).map((p) => p && p.path && path.resolve(p.path)).filter(Boolean);
  if (known.includes(abs)) return abs;
  if (abs === ws || abs.startsWith(ws + path.sep)) return abs;
  return null;
}

ipcMain.handle('fs:readTree', async (_e, requestedRoot) => {
  const cfg = await loadConfig();
  const root = resolveRoot(cfg, requestedRoot);
  if (!root) return [];
  if (!fsSync.existsSync(root)) await fs.mkdir(root, { recursive: true });
  return readTree(root);
});

ipcMain.handle('fs:readFile', async (_e, rel, requestedRoot) => {
  const cfg = await loadConfig();
  const root = resolveRoot(cfg, requestedRoot);
  if (!root) return { error: 'That project is no longer available.' };
  if (path.isAbsolute(rel)) {
    // Only files inside the active project/workspace may be re-read.
    if (!rel.startsWith(root + path.sep) && !rel.startsWith(root + path.sep + path.sep)) {
      return { error: 'Only files inside this project can be opened.' };
    }
  }
  try {
    const abs = path.isAbsolute(rel) ? rel : guardRel(root, rel);
    return { content: await fs.readFile(abs, 'utf8'), root, path: abs };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:writeFile', async (_e, rel, content, requestedRoot) => {
  const cfg = await loadConfig();
  const root = resolveRoot(cfg, requestedRoot);
  if (!root) return { error: 'That project is no longer available.' };
  const target = path.isAbsolute(rel) ? rel : guardRel(root, rel);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content ?? '', 'utf8');
    return { ok: true, path: target };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:saveAs', async (_e, name, content, requestedRoot) => {
  const cfg = await loadConfig();
  const root = resolveRoot(cfg, requestedRoot) || ensureWorkspace(cfg.workspace);
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const res = await dialog.showSaveDialog(win, {
    title: 'Save program',
    defaultPath: path.join(root, safe),
  });
  if (res.canceled || !res.filePath) return null;
  try {
    await fs.mkdir(path.dirname(res.filePath), { recursive: true });
    await fs.writeFile(res.filePath, content ?? '', 'utf8');
    return res.filePath;
  } catch (e) {
    dialog.showErrorBox('Save failed', e.message);
    return null;
  }
});

// ------------------------------------------------------------------ projects
// A "project" is a folder of source files. New projects live inside the
// workspace; opened projects may live anywhere the student picked.

const PROJECT_EXT = { java: 'java', python: 'py', javascript: 'js', c: 'c', cpp: 'cpp', rust: 'rs' };
const EXT_TO_LANG = { java: 'java', py: 'python', js: 'javascript', c: 'c', cpp: 'cpp', rs: 'rust' };

const PROJECT_STARTERS = {
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n    }\n}\n',
  python: 'print("Hello, world!")\n',
  javascript: 'console.log("Hello, world!");\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, world!\\n");\n    return 0;\n}\n',
  cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!\\n";\n    return 0;\n}\n',
  rust: 'fn main() {\n    println!("Hello, world!");\n}\n',
};

function languageFromFiles(files) {
  const counts = {};
  for (const f of files) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (EXT_TO_LANG[ext]) counts[EXT_TO_LANG[ext]] = (counts[EXT_TO_LANG[ext]] || 0) + 1;
  }
  let best = null, top = 0;
  for (const [lang, n] of Object.entries(counts)) if (n > top) { best = lang; top = n; }
  return best || 'javascript';
}

async function scanProject(dir) {
  const files = [];
  const walk = async (d, depth) => {
    if (depth > 4 || files.length > 400) return;
    let list = [];
    try { list = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs, depth + 1);
      else files.push(e.name);
    }
  };
  await walk(dir, 0);
  const st = await fs.stat(dir).catch(() => null);
  return { files, modified: st?.mtimeMs || Date.now() };
}

async function projectMeta(dir, saved) {
  const { files, modified } = await scanProject(dir);
  return {
    name: saved?.name || path.basename(dir),
    path: dir,
    language: saved?.language || languageFromFiles(files),
    files: files.length,
    sample: files.slice(0, 4),
    modified,
  };
}

function rememberProject(cfg, dir, language) {
  const projects = [...(cfg.projects || []).filter((p) => path.resolve(p.path || '') !== path.resolve(dir))];
  projects.push({ name: path.basename(dir), path: dir, language, createdAt: Date.now() });
  return projects;
}

ipcMain.handle('fs:listProjects', async () => {
  const cfg = await loadConfig();
  const ws = ensureWorkspace(cfg.workspace);
  await fs.mkdir(ws, { recursive: true });
  const saved = new Map();
  for (const p of cfg.projects || []) if (p?.path) saved.set(path.resolve(p.path), p);

  const out = [];
  const entries = await fs.readdir(ws, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const abs = path.join(ws, e.name);
    out.push(await projectMeta(abs, saved.get(abs)));
  }
  for (const [abs, p] of saved) {
    if (out.some((o) => o.path === abs)) continue;
    if (!fsSync.existsSync(abs)) continue;
    out.push(await projectMeta(abs, p));
  }
  out.sort((a, b) => b.modified - a.modified);
  return { workspace: ws, projects: out };
});

ipcMain.handle('fs:createProject', async (_e, payload = {}) => {
  const cfg = await loadConfig();
  const ws = ensureWorkspace(cfg.workspace);
  await fs.mkdir(ws, { recursive: true });
  const language = PROJECT_EXT[payload.language] ? payload.language : 'javascript';
  const base = String(payload.name || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 48) || 'MyProject';
  let dir = path.join(ws, base);
  let n = 2;
  while (fsSync.existsSync(dir)) dir = path.join(ws, `${base} ${n++}`);
  await fs.mkdir(dir, { recursive: true });
  const file = `main.${PROJECT_EXT[language]}`;
  await fs.writeFile(path.join(dir, file), PROJECT_STARTERS[language] || '', 'utf8');
  await saveConfig({ ...cfg, projects: rememberProject(cfg, dir, language) });
  return { name: path.basename(dir), path: dir, language, file };
});

ipcMain.handle('fs:pickProjectDir', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Open a CodeClue project',
  });
  if (res.canceled || !res.filePaths.length) return null;
  const dir = res.filePaths[0];
  const cfg = await loadConfig();
  const meta = await projectMeta(dir, null);
  await saveConfig({ ...cfg, projects: rememberProject(cfg, dir, meta.language) });
  return meta;
});

// One window, one server. A second instance would fight over the fixed page
// port, and its fallback port would move the origin (and wipe saved progress).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    try {
      const url = await createStaticServer();
      createWindow(url);
    } catch (e) {
      dialog.showErrorBox('CodeClue could not start its local server', e.message);
      app.quit();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createStaticServer().then((url) => createWindow(url));
    }
  });
}
