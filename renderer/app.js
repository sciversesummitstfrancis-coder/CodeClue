// CodeClue renderer orchestrator — the app's brain.
// Tabs ↔ Monaco models, Missions, the Clue Coach, Output console, Code Pad.

'use strict';

const MONACO_BASE = '../node_modules/monaco-editor/min/vs/';
// Absolute forms (blob workers cannot resolve relative paths).
const MONACO_BASE_ABS = new URL(MONACO_BASE, window.location.href).href;
const MONACO_MIN_ABS = MONACO_BASE_ABS.replace(/vs\/?$/, '');
window.MonacoEnvironment = {
  getWorkerUrl: () => URL.createObjectURL(new Blob([
    `self.MonacoEnvironment={baseUrl:'${MONACO_MIN_ABS}'};importScripts('${MONACO_MIN_ABS}vs/base/worker/workerMain.js');`,
  ], { type: 'text/javascript' })),
};
// Configure AMD loader to know where 'vs' is
if (typeof require !== 'undefined' && require.config) {
  require.config({ baseUrl: MONACO_MIN_ABS + 'vs' });
}

let editor = null;

const state = {
  tools: {},
  tabs: [],          // {name, path, mission, model, langRun, dirty, _disposable}
  activeIdx: -1,
  workspace: null,
  tree: [],
  openDirs: new Set(),
  running: false,
  runner: 'auto',
  missionSteps: new Map(),   // missionId  -> clues revealed
  findingSteps: new Map(),   // findingKey -> clues revealed
  lessonSteps: new Map(),    // missionId  -> 0 idea | 1 example | 2 task
  lessonDone: new Set(),     // missionId  -> completed
  profile: null,             // { name, goal, lang }
  lessonFilter: 'all',       // language filter in the Lessons list
  panelHeight: null,         // px, null = CSS default
  panelExpanded: false,
  aiMonitor: true,
  aiModel: '',
  lastRun: null,
  lastCheck: null,     // { missionId, msg } from the last failed mission check
  project: null,       // { name, path, language } — the open project, if any
  projects: [],        // known projects in the workspace
  launcherOpen: false,
  sideTab: 'missions', // 'missions' (Lessons) | 'files'
  coachTab: 'coach',   // 'coach' (Clue Coach) | 'ai' (AI Tutor) — the right rail
  coachCollapsed: false, // rail locked away so the editor takes the space
};

/* --------------------------- progress storage --------------------------- */

const PROGRESS_KEY = 'codeclue:progress:v1';

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    if (Array.isArray(raw.done)) raw.done.forEach((id) => state.lessonDone.add(id));
    if (raw.steps && typeof raw.steps === 'object') {
      Object.entries(raw.steps).forEach(([id, n]) => state.lessonSteps.set(id, Number(n) || 0));
    }
  } catch { /* ignore corrupt progress */ }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      done: [...state.lessonDone],
      steps: Object.fromEntries(state.lessonSteps),
    }));
  } catch { /* storage may be unavailable */ }
}

function lessonStep(id) { return state.lessonSteps.get(id) ?? 0; }
function setLessonStep(id, n) {
  state.lessonSteps.set(id, n);
  saveProgress();
  renderCoach();
}
function markLessonDone(id) {
  if (state.lessonDone.has(id)) return;
  state.lessonDone.add(id);
  saveProgress();
  renderLessons();
}

/* ---------------------------- settings storage --------------------------- */

const CC_SETTINGS_KEY = 'codeclue:settings:v1';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(CC_SETTINGS_KEY) || '{}');
    if (Number.isFinite(s.panelHeight)) state.panelHeight = Math.round(s.panelHeight);
    if (typeof s.panelExpanded === 'boolean') state.panelExpanded = s.panelExpanded;
    if (typeof s.aiMonitor === 'boolean') state.aiMonitor = s.aiMonitor;
    if (typeof s.aiModel === 'string') state.aiModel = s.aiModel;
    if (typeof s.lessonFilter === 'string') state.lessonFilter = s.lessonFilter;
    if (s.project && typeof s.project.path === 'string') {
      state.project = { name: s.project.name || 'Project', path: s.project.path, language: s.project.language || 'javascript' };
    }
    if (s.sideTab === 'missions' || s.sideTab === 'files') state.sideTab = s.sideTab;
    if (s.coachTab === 'coach' || s.coachTab === 'ai') state.coachTab = s.coachTab;
    if (typeof s.coachCollapsed === 'boolean') state.coachCollapsed = s.coachCollapsed;
  } catch { /* ignore corrupt settings */ }
}

function saveSettings() {
  try {
    localStorage.setItem(CC_SETTINGS_KEY, JSON.stringify({
      panelHeight: state.panelHeight,
      panelExpanded: state.panelExpanded,
      aiMonitor: state.aiMonitor,
      aiModel: state.aiModel,
      lessonFilter: state.lessonFilter,
      project: state.project,
      sideTab: state.sideTab,
      coachTab: state.coachTab,
      coachCollapsed: state.coachCollapsed,
    }));
  } catch { /* storage may be unavailable */ }
}

const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', jsx: 'javascript',
  py: 'python',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  java: 'java',
  rs: 'rust',
};

function langOfName(name) {
  const m = /\.([^.]+)$/.exec(String(name || ''));
  return m ? (EXT_LANG[m[1].toLowerCase()] || null) : null;
}

const MONACO_LANG = { javascript: 'javascript', python: 'python', c: 'cpp', cpp: 'cpp', java: 'java', rust: 'rust' };
const RUN_LANG_NAME = { javascript: 'JavaScript', python: 'Python', c: 'C', cpp: 'C++', java: 'Java', rust: 'Rust' };
const ENGINE_LANG = { javascript: 'js', python: 'python' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------- icons ------------------------------- */

const SVG = {
  chevron: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>`,
  file: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3 3V14.5H4z"/><path d="M9 1.5v3h3"/></svg>`,
  lockOpen: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/><rect x="4" y="7" width="8" height="6" rx="1"/></svg>`,
  check: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5"/></svg>`,
  close: `×`,
};


/* --------------------------- console utils --------------------------- */

let outConsole = null;
let padOutEl = null;
const MAX_CONSOLE_LINES = 800;

function ensureConsole() {
  outConsole = document.createElement('div');
  outConsole.className = 'console';
  document.getElementById('outputPane').appendChild(outConsole);
  padOutEl = document.getElementById('padOut');
}

function appendConsole(kind, text) {
  if (!outConsole) ensureConsole();
  const line = document.createElement('div');
  line.className = kind;
  line.textContent = text;
  outConsole.appendChild(line);
  while (outConsole.children.length > MAX_CONSOLE_LINES) outConsole.firstChild.remove();
  outConsole.scrollTop = outConsole.scrollHeight;
}

function clearConsole() {
  if (outConsole) outConsole.innerHTML = '';
  if (padOutEl) padOutEl.innerHTML = '';
}

/* ------------------------------- boot ------------------------------- */

const WELCOME_TEXT = `//  CodeClue — BlueJ × VS Code, for students
//
//  WHAT'S HERE
//    ▸ Lessons (left) — tiny exercises, each walks you through
//      idea → worked example → your turn
//    ▸ Clue Coach (right) — reads your code while you type and offers
//      nudges → concepts → shapes, never the full answer
//    ▸ AI Check (top bar) — Qwen reviews your code and names the
//      actual mistakes. Turn on Monitor to review automatically.
//    ▸ Code Pad (bottom) — poke at code interactively, like BlueJ
//    ▸ Run with Ctrl+Enter, save with Ctrl+S
//
//  LANGUAGES
//    JavaScript + Python run in an in-app sandbox.
//    C / C++ / Java / Rust compile+run with the toolchains detected
//    on this machine (see the status bar, bottom right).
//
//  Your profile chip (top right) reopens setup: name, goal, language.
`;

require.config({ paths: { vs: MONACO_BASE_ABS } });

/* IPC bridge fallback — lets the UI render in a plain browser (design preview)
   and degrades gracefully instead of crashing if the bridge ever loads late. */
const api = window.codeclue || {
  detectTools: async () => ({}),
  runLocal: async () => ({ exitCode: 1, stdout: '', stderr: 'External runner unavailable outside the desktop app.', timedOut: false }),
  getWorkspace: async () => null,
  chooseWorkspace: async () => null,
  readTree: async () => [],
  readFile: async () => ({ error: 'Files require the desktop app.' }),
  writeFile: async () => ({ error: 'Saving requires the desktop app.' }),
  saveAs: async () => null,
  win: {
    toggleFullscreen: async () => false,
    isFullscreen: async () => false,
  },
  ai: {
    status: async () => ({ ok: false, error: 'AI requires the desktop app (Ollama IPC).' }),
    chat: async () => { throw new Error('AI requires the desktop app.'); },
  },
};

require(['vs/editor/editor.main'], () => {
  monaco.editor.defineTheme('codeclue', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
      { token: 'string', foreground: '9ecff7' },
      { token: 'keyword', foreground: 'bb9af7' },
      { token: 'number', foreground: 'ff9e64' },
      { token: 'type', foreground: '2ac3de' },
    ],
    colors: {
      'editor.background': '#0d1116',
      'editor.foreground': '#d7dee8',
      'editor.lineHighlightBackground': '#161c24',
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#39414d',
      'editorLineNumber.activeForeground': '#8b98a8',
      'editorCursor.foreground': '#5b8af5',
      'editorIndentGuide.background1': '#1b212a',
      'editorIndentGuide.activeBackground1': '#2c3542',
      'editor.selectionBackground': '#243355aa',
      'editor.inactiveSelectionBackground': '#1b2742aa',
      'editorGutter.background': '#0d1116',
      'editorWidget.background': '#151a21',
      'editorWidget.border': '#2a323d',
      'editorSuggestWidget.background': '#151a21',
      'editorSuggestWidget.border': '#2a323d',
      'editorHoverWidget.background': '#151a21',
      'editorHoverWidget.border': '#2a323d',
      'editorBracketMatch.background': '#5b8af52e',
      'editorBracketMatch.border': '#5b8af5',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff26',
      'scrollbarSlider.activeBackground': '#ffffff33',
    },
  });

  editor = monaco.editor.create(document.getElementById('editorHost'), {
    model: monaco.editor.createModel(WELCOME_TEXT, 'javascript', monaco.Uri.parse('cc:///welcome')),
    theme: 'codeclue',
    fontSize: 14.5,
    fontFamily: '"JetBrains Mono","Cascadia Code",Consolas,monospace',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    renderLineHighlight: 'all',
    padding: { top: 12 },
    automaticLayout: true,
    tabSize: 2,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true },
  });

  // Force initial layout in case container size is not yet computed
  setTimeout(() => editor.layout(), 0);

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runActive);
  editor.onDidChangeCursorPosition((e) => {
    document.getElementById('statusPos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  loadProgress();
  loadSettings();
  initUi();
  refreshTools();
  // Validate the remembered project, then load its files (or the workspace).
  refreshProjects().then(restoreProject);
  startApp();
});

// Splash → onboarding (first run) or straight into the workspace (returning).
function startApp() {
  if (window.CodeClueIntro?.start) {
    window.CodeClueIntro.start();
    return;
  }
  // Fallback for the plain-browser design preview.
  openMission(EXERCISES[0], { silent: true });
}

/* ------------------------------ tabs ------------------------------ */

function activeTab() { return state.tabs[state.activeIdx] || null; }

// Monaco models are keyed by URI, so the URI must be unique per file and must
// never start with extra slashes (absolute paths would break Uri.parse).
function modelUriFor(pathOrName, mission) {
  if (mission) return monaco.Uri.parse('cc:///missions/' + mission.id);
  const safe = String(pathOrName || 'untitled').replace(/[^\w.\-]/g, '_').replace(/^_+/, '');
  return monaco.Uri.parse('cc:///' + (safe || 'untitled'));
}

function openTab({ name, path = null, mission = null, content, monoLang = null, root = null }) {
  const idx = state.tabs.findIndex((t) =>
    mission ? t.mission?.id === mission.id : (path ? t.path === path : t.name === name)
  );
  if (idx !== -1) { switchTab(idx); return state.tabs[idx]; }

  const langRun = mission ? mission.lang : (langOfName(name) || 'javascript');
  const uri = modelUriFor(path || name, mission);
  const model = monaco.editor.createModel(content, monoLang || MONACO_LANG[langRun] || 'plaintext', uri);
  const tab = { name, path, mission, model, langRun, dirty: false, root };
  tab._disposable = model.onDidChangeContent(() => {
    if (!tab.dirty) { tab.dirty = true; renderTabs(); }
    scheduleHints();
  });
  state.tabs.push(tab);
  switchTab(state.tabs.length - 1);
  return tab;
}

function switchTab(idx) {
  state.activeIdx = idx;
  const tab = activeTab();
  if (!tab) return;
  try {
    editor.setModel(tab.model);
    editor.focus();
  } catch (e) {
    console.error('Tab switch error:', e.message);
  }
  renderTabs();
  updateLangStatus();
  renderCoach();
  renderLessons();
  scheduleHints();
  // Ensure editor paints after tab switch
  setTimeout(() => editor.layout(), 0);
}

function closeTab(idx) {
  const tab = state.tabs[idx];
  if (!tab) return;
  tab._disposable?.dispose();
  tab.model.dispose();
  state.tabs.splice(idx, 1);
  if (state.activeIdx >= state.tabs.length) state.activeIdx = state.tabs.length - 1;
  const next = activeTab();
  if (next) {
    editor.setModel(next.model);
    updateLangStatus();
    renderCoach();
    scheduleHints();
  } else {
    const hint = isBuildMode()
      ? '// All tabs closed. Open a file from the Files tab to begin.\n'
      : '// All tabs closed. Open a Mission or a file to begin.\n';
    editor.setModel(monaco.editor.createModel(hint, 'javascript'));
    state.activeIdx = -1;
  }
  renderTabs();
}

function renderTabs() {
  const bar = document.getElementById('tabsBar');
  bar.innerHTML = '';
  state.tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === state.activeIdx ? ' active' : '') + (t.dirty ? ' dirty' : '');
    el.innerHTML =
      `<span class="t-dot"></span><span class="t-name">${escapeHtml(t.name)}</span>` +
      `<span class="t-close" title="Close" role="button" aria-label="Close tab">${SVG.close}</span>`;
    el.querySelector('.t-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(i); });
    el.addEventListener('click', () => switchTab(i));
    bar.appendChild(el);
  });
}

function defaultFileName(langRun) {
  return { javascript: 'main.js', python: 'main.py', c: 'main.c', cpp: 'main.cpp', java: 'Main.java', rust: 'main.rs' }[langRun] || 'program.txt';
}

/* ------------------------------ saving ------------------------------ */

async function saveActive() {
  const tab = activeTab();
  if (!tab) { appendConsole('sys', 'Nothing to save — open a file first.'); return; }
  const value = tab.model.getValue();
  if (tab.path) {
    const r = await api.writeFile(tab.path, value, tab.root || null);
    if (r.error) { appendConsole('err', 'Save failed: ' + r.error); return; }
    tab.dirty = false; renderTabs(); renderTree();
    appendConsole('sys', `Saved ${tab.path}`);
  } else {
    const saved = await api.saveAs(tab.mission ? defaultFileName(tab.langRun) : tab.name, value, tab.root || null);
    if (saved) {
      tab.path = saved;
      tab.name = saved.split(/[\\/]/).pop();
      tab.dirty = false;
      renderTabs(); renderTree();
      appendConsole('sys', `Saved ${saved}`);
    }
  }
}

/* ------------------------------ missions ------------------------------ */

function openMission(m, opts = {}) {
  // Build-only students have no course — the Clue Coach stays, the lessons do not.
  if (isBuildMode()) {
    appendConsole('sys', 'Lessons are not part of build mode. Open a file from the Files tab instead.');
    return;
  }
  openTab({ name: `missions/${m.id}`, mission: m, content: m.starter });
  if (!opts.silent) appendConsole('sys', `Mission opened: ${m.title} (${m.langLabel}). Write it, then Ctrl+Enter to run.`);
}

function renderLessons() {
  const pane = document.getElementById('missionsPane');
  pane.innerHTML = '';

  // Build-only students have no course at all — the pane stays empty.
  if (isBuildMode()) return;

  const langs = ['all', ...new Set(EXERCISES.map((m) => m.lang))];
  if (!langs.includes(state.lessonFilter)) state.lessonFilter = 'all';
  const visible = state.lessonFilter === 'all'
    ? EXERCISES
    : EXERCISES.filter((m) => m.lang === state.lessonFilter);

  const doneCount = EXERCISES.filter((m) => state.lessonDone.has(m.id)).length;
  const pct = Math.round((doneCount / EXERCISES.length) * 100);

  const head = document.createElement('div');
  head.className = 'lesson-progress';
  head.innerHTML =
    `<div class="lp-row"><span>Your course</span><span class="lp-count">${doneCount} / ${EXERCISES.length}</span></div>` +
    `<div class="lp-bar"><span style="width:${pct}%"></span></div>`;
  pane.appendChild(head);

  const filter = document.createElement('div');
  filter.className = 'lesson-filter';
  langs.forEach((lang) => {
    const chip = document.createElement('button');
    chip.className = 'lf-chip' + (state.lessonFilter === lang ? ' active' : '');
    chip.textContent = lang === 'all' ? 'All' : (RUN_LANG_NAME[lang] || lang);
    chip.title = lang === 'all' ? 'Show every lesson' : `Show ${RUN_LANG_NAME[lang] || lang} lessons`;
    chip.addEventListener('click', () => {
      state.lessonFilter = lang;
      saveSettings();
      renderLessons();
    });
    filter.appendChild(chip);
  });
  pane.appendChild(filter);

  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'no-mission';
    empty.textContent = 'No lessons in this language yet. Pick All, or open a starter file from your profile.';
    pane.appendChild(empty);
    return;
  }

  visible.forEach((m) => {
    const lesson = LESSONS[m.id];
    const active = activeTab()?.mission?.id === m.id;
    const done = state.lessonDone.has(m.id);
    const card = document.createElement('div');
    card.className = 'lesson-card' + (active ? ' active' : '') + (done ? ' done' : '');
    card.innerHTML =
      `<div class="lc-num">${done ? SVG.check : (lesson ? lesson.n : '·')}</div>` +
      `<div class="lc-body">` +
        `<div class="lc-lang">${m.langLabel}</div>` +
        `<div class="lc-title">${escapeHtml(m.title)}</div>` +
        `<div class="lc-blurb">${escapeHtml(m.blurb)}</div>` +
      `</div>` +
      `<div class="lc-state">${done ? 'Done' : (active ? 'Open' : '')}</div>`;
    card.addEventListener('click', () => openMission(m));
    pane.appendChild(card);
  });
}

/* ----------------------------- clue coach ----------------------------- */

const CLUE_LEVELS = ['nudge', 'concept', 'shape'];

function renderCoach() {
  renderCoachMission();
  analyzeAndRender();
}

function renderCoachMission() {
  const box = document.getElementById('missionBox');
  const m = activeTab()?.mission;
  if (!m) {
    box.innerHTML = isBuildMode()
      ? `<div class="no-mission">No lesson here — you are in <b>build mode</b>. Open a file and the coach will still watch your code for mistakes.</div>`
      : `<div class="no-mission">No lesson open. Pick one from the <b>Lessons</b> tab — each walks you from the idea to a working program.</div>`;
    return;
  }

  const lesson = LESSONS[m.id];
  if (!lesson) {
    // Fallback: a mission without lesson content still shows its clue chain.
    box.innerHTML = `<div class="mission-block"><div class="mb-lang">${m.langLabel}</div><div class="mb-title">${escapeHtml(m.title)}</div><div class="mb-blurb">${escapeHtml(m.blurb)}</div></div>`;
    return;
  }

  const done = state.lessonDone.has(m.id);
  const step = done ? 3 : lessonStep(m.id);

  let html = `<div class="lesson-block">` +
    `<div class="lb-head">` +
      `<span class="lb-kicker">Lesson ${lesson.n} · ${m.langLabel}</span>` +
      `<div class="lb-title">${escapeHtml(m.title)}</div>` +
      `<div class="lb-dots">` +
        [0, 1, 2].map((i) => `<span class="lb-dot${step > i || done ? ' filled' : ''}${step === i && !done ? ' current' : ''}"></span>`).join('') +
      `</div>` +
    `</div>`;

  if (done) {
    html += `<div class="lb-step lb-success">` +
      `<div class="lb-success-mark">${SVG.check}</div>` +
      `<div class="lb-success-title">Lesson complete</div>` +
      `<div class="lb-text">Your program passed the checkpoint. The idea is now yours — move on when you are ready.</div>` +
      `<div class="lb-actions">` +
        `<button class="clue-btn primary" data-lesson-next="${m.id}">Next lesson →</button>` +
        `<button class="clue-btn" data-lesson-review="${m.id}">Review this lesson</button>` +
      `</div>` +
    `</div>`;
  } else if (step === 0) {
    html += `<div class="lb-step">` +
      `<div class="lb-label">The idea</div>` +
      `<div class="lb-text">${escapeHtml(lesson.idea)}</div>` +
      (lesson.analogy ? `<div class="lb-analogy"><span>Analogy</span>${escapeHtml(lesson.analogy)}</div>` : '') +
      `<div class="lb-actions"><button class="clue-btn primary" data-lesson-step="1" data-lesson-id="${m.id}">Got it — show me an example →</button></div>` +
    `</div>`;
  } else if (step === 1) {
    html += `<div class="lb-step">` +
      `<div class="lb-label">Worked example</div>` +
      `<div class="lb-text">Read it, then run it. You are not meant to write this yourself yet.</div>` +
      `<pre class="lb-code">${escapeHtml(lesson.example)}</pre>` +
      `<div class="lb-walk">` +
        lesson.walkthrough.map((w) =>
          `<div class="lb-walk-row"><code>${escapeHtml(w.code)}</code><span>${escapeHtml(w.text)}</span></div>`
        ).join('') +
      `</div>` +
      (lesson.expected ? `<div class="lb-expect"><span>Expected output</span><pre>${escapeHtml(lesson.expected)}</pre></div>` : '') +
      `<div class="lb-actions">` +
        `<button class="clue-btn primary" data-lesson-example="${m.id}">▶ Run this example</button>` +
        `<button class="clue-btn" data-lesson-step="2" data-lesson-id="${m.id}">I'm ready — give me the task →</button>` +
      `</div>` +
    `</div>`;
  } else {
    const revealed = state.missionSteps.get(m.id) || 0;
    let clues = '';
    for (let i = 0; i < Math.min(revealed, m.hints.length); i++) clues += clueHtml(m.hints[i]);
    html += `<div class="lb-step">` +
      `<div class="lb-label">Your turn</div>` +
      `<div class="lb-text">${escapeHtml(lesson.task)}</div>` +
      (lesson.checkpoint ? `<div class="lb-checkpoint"><span>Checkpoint</span>${escapeHtml(lesson.checkpoint)}</div>` : '') +
      `<div class="lb-actions">` +
        `<button class="clue-btn primary" data-lesson-run="1">Run my code to check</button>` +
        `<button class="clue-btn" data-lesson-step="1" data-lesson-id="${m.id}">← Back to the example</button>` +
      `</div>` +
      `<div class="mb-status" id="missionStatus"></div>` +
      `<div class="lb-hints">` +
        (revealed ? `<div class="mb-clues">${clues}</div>` : '') +
        (revealed < m.hints.length
          ? `<button class="clue-btn" data-reveal-mission="${m.id}" data-level="${revealed}">${SVG.lockOpen} Reveal ${CLUE_LEVELS[revealed]} clue</button>`
          : `<span class="no-mission">All clues revealed.</span>`) +
      `</div>` +
    `</div>`;
  }

  html += `</div>`;
  box.innerHTML = html;

  box.querySelectorAll('[data-lesson-step]').forEach((b) => {
    b.addEventListener('click', () => {
      setLessonStep(b.getAttribute('data-lesson-id'), Number(b.getAttribute('data-lesson-step')));
    });
  });
  box.querySelectorAll('[data-lesson-example]').forEach((b) => {
    b.addEventListener('click', () => runLessonExample(b.getAttribute('data-lesson-example')));
  });
  box.querySelectorAll('[data-lesson-run]').forEach((b) => {
    b.addEventListener('click', () => runActive());
  });
  box.querySelectorAll('[data-lesson-next]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-lesson-next');
      const pool = state.lessonFilter === 'all'
        ? EXERCISES
        : EXERCISES.filter((x) => x.lang === state.lessonFilter);
      const local = pool.findIndex((x) => x.id === id);
      const next = local !== -1 ? pool[local + 1] : EXERCISES[EXERCISES.findIndex((x) => x.id === id) + 1];
      if (next) openMission(next);
      else appendConsole('sys', 'That was the last lesson in this course. Pick any lesson to review it.');
    });
  });
  box.querySelectorAll('[data-lesson-review]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-lesson-review');
      state.lessonDone.delete(id);
      state.lessonSteps.set(id, 0);
      saveProgress();
      renderLessons();
      renderCoach();
    });
  });
  box.querySelectorAll('[data-reveal-mission]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-reveal-mission');
      state.missionSteps.set(id, Number(b.getAttribute('data-level')) + 1);
      renderCoachMission();
    });
  });
}

// Run a lesson's worked example in place — output goes to the console, but the
// mission tab (and its lesson panel) stays exactly where the student left it.
async function runLessonExample(id) {
  if (state.running) return;
  const m = EXERCISES.find((x) => x.id === id);
  const lesson = m && LESSONS[id];
  if (!m || !lesson) return;

  appendConsole('sys', `— example: ${m.title} (${m.langLabel}) —`);
  state.running = true;
  document.getElementById('runBtn').disabled = true;
  switchPanel('output');
  try {
    await runCode({
      code: lesson.example,
      lang: m.lang,
      strategy: document.getElementById('runnerSel').value,
      fileName: defaultFileName(m.lang),
      timeoutMs: 10000,
      onLine: (k, t) => appendConsole(k, t),
      tools: state.tools,
    });
  } finally {
    state.running = false;
    document.getElementById('runBtn').disabled = false;
  }
}

function clueHtml(clue) {
  return `<div class="clue"><span class="cl-label">${clue.label}</span>${clue.text}${clue.snippet ? `<pre>${escapeHtml(clue.snippet)}</pre>` : ''}</div>`;
}

/* findings (live hints) */

let analysisTimer = null;

function scheduleHints() {
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    analyzeAndRender();
    maybeAutoReview('idle');
  }, 700);
}

function analyzeAndRender() {
  const host = document.getElementById('findings');
  const tab = activeTab();
  if (!tab) { host.innerHTML = ''; return; }
  const code = tab.model.getValue();
  if (!code.trim()) {
    host.innerHTML = '<div class="finding empty">Start typing — the coach reads your program as you write.</div>';
    return;
  }
  const lang = ENGINE_LANG[tab.langRun] || 'other';
  const findings = analyze(code, lang);
  if (!findings.length) {
    host.innerHTML = isBuildMode()
      ? '<div class="finding empty">✓ Nothing the coach recognizes as a trap so far. Keep going, then Run (Ctrl+Enter) to check your program.</div>'
      : '<div class="finding empty">✓ Nothing the coach recognizes as a trap so far. Keep going, then Run (Ctrl+Enter) to check the mission.</div>';
    return;
  }
  host.innerHTML = '';
  findings.forEach((f) => {
    const key = `${f.id}:${f.line ?? 0}`;
    const revealed = state.findingSteps.get(key) || 0;
    const card = document.createElement('div');
    card.className = 'finding';
    let html =
      `<div class="f-head"><span class="f-badge ${f.severity}">${f.severity}</span><span class="f-title">${escapeHtml(f.title)}</span>` +
      (f.line ? `<span class="f-line">line ${f.line}</span>` : '') + `</div><div class="f-clues">`;
    for (let i = 0; i < revealed && i < f.clues.length; i++) {
      const c = f.clues[i];
      const text = typeof c.text === 'function' ? c.text(f.extra?.fn) : c.text;
      html += `<div class="clue"><span class="cl-label">${c.label}</span>${text}${c.snippet ? `<pre>${escapeHtml(c.snippet)}</pre>` : ''}</div>`;
    }
    html += '</div>';
    if (revealed < f.clues.length) html += `<button class="clue-btn" data-key="${key}" data-level="${revealed}">${SVG.lockOpen} Show next clue</button>`;
    card.innerHTML = html;
    host.appendChild(card);
  });
  host.querySelectorAll('[data-key]').forEach((b) => {
    b.addEventListener('click', () => {
      state.findingSteps.set(b.getAttribute('data-key'), Number(b.getAttribute('data-level')) + 1);
      analyzeAndRender();
    });
  });
}

/* ------------------------------ run flow ------------------------------ */

async function runActive() {
  if (state.running) return;
  const tab = activeTab();
  if (!tab) { appendConsole('sys', 'Open a mission or file first.'); return; }
  const code = tab.model.getValue();
  if (!code.trim()) { appendConsole('err', 'The editor is empty — write something first.'); return; }
  const lang = tab.langRun;
  appendConsole('sys', `— run ${tab.name} (${RUN_LANG_NAME[lang] || lang}) —`);

  // Toolchain detection runs in parallel with boot; never report a missing
  // compiler just because detection has not finished yet.
  if (state.toolsReady && !Object.keys(state.tools || {}).length) {
    try { await state.toolsReady; } catch { /* detection failed; run will explain */ }
  }

  state.running = true;
  document.getElementById('runBtn').disabled = true;
  switchPanel('output');

  try {
    const res = await runCode({
      code, lang,
      strategy: document.getElementById('runnerSel').value,
      fileName: tab.path ? tab.name : defaultFileName(lang),
      timeoutMs: 10000,
      onLine: (k, t) => appendConsole(k, t),
      tools: state.tools,
    });
    state.lastRun = { ...res, code, name: tab.name, at: Date.now() };
    if (tab.mission) {
      validateMission(tab.mission, state.lastRun);
    } else if (runFailed(res)) {
      maybeAutoReview('failedRun');
    }
  } finally {
    state.running = false;
    document.getElementById('runBtn').disabled = false;
  }
}

function runFailed(res) {
  if (!res) return false;
  if (res.error) return true;
  if (Number.isFinite(res.exitCode) && res.exitCode !== 0) return true;
  return (res.stderr || []).some((line) => String(line).trim());
}

function validateMission(m, res) {
  let verdict;
  try {
    verdict = m.validate({ stdout: res.stdout || [], stderr: res.stderr || [], code: res.code ?? '', error: res.error });
  } catch (e) {
    verdict = { ok: false, msg: 'Validator crashed (report this mission): ' + e.message };
  }
  if (verdict.ok) {
    state.lastCheck = null;
    appendConsole('sys', verdict.msg);
    markLessonDone(m.id);
    renderCoach(); // show the success state in the lesson panel
    clearAIFindings('Checkpoint passed. Qwen has nothing to flag right now.');
  } else {
    state.lastCheck = { missionId: m.id, msg: verdict.msg, at: Date.now() };
    appendConsole('warn', verdict.msg);
    const el = document.getElementById('missionStatus');
    if (el) {
      el.textContent = verdict.msg;
      el.className = 'mb-status err';
    }
    maybeAutoReview('failedCheck');
  }
}

/* ------------------------------ projects ------------------------------ */
// BlueJ-style project layer: a project is a folder of source files. Before
// anything is open, the launcher asks the student to create or open one.

const PROJECT_EXT = { java: 'java', python: 'py', javascript: 'js', c: 'c', cpp: 'cpp', rust: 'rs' };

const CLASS_TEMPLATES = {
  java: (n) => `public class ${n} {\n    public ${n}() {\n    }\n}\n`,
  python: (n) => `class ${n}:\n    def __init__(self):\n        pass\n`,
  javascript: (n) => `class ${n} {\n  constructor() {\n  }\n}\n`,
  c: (n) => `/* ${n} */\n#include <stdio.h>\n\nint main(void) {\n    printf("${n}\\n");\n    return 0;\n}\n`,
  cpp: (n) => `// ${n}\n#include <iostream>\n\nint main() {\n    std::cout << "${n}\\n";\n    return 0;\n}\n`,
  rust: (n) => `fn main() {\n    println!("${n}");\n}\n`,
};

const PROJECT_LANG_LABEL = {
  java: 'Java', python: 'Python', javascript: 'JavaScript',
  c: 'C', cpp: 'C++', rust: 'Rust',
};

function projectRoot() { return state.project?.path || null; }

function nextLesson() {
  const p = state.profile;
  const lang = p?.lang || 'javascript';
  if (p?.goal !== 'learn') return null;
  return EXERCISES.find((m) => m.lang === lang && !state.lessonDone.has(m.id))
    || EXERCISES.find((m) => m.lang === lang)
    || null;
}

async function refreshProjects() {
  try {
    const res = await api.listProjects();
    state.projects = res?.projects || [];
    if (res?.workspace) state.workspace = res.workspace;
    // Drop a project that no longer exists on disk.
    if (state.project && !state.projects.some((p) => p.path === state.project.path)) {
      state.project = null;
      saveSettings();
    }
  } catch {
    state.projects = [];
  }
  renderProjectCards();
  renderMenuProjects();
  updateProjectChip();
}

function updateProjectChip() {
  const btn = document.getElementById('projectBtn');
  const label = document.getElementById('projectName');
  if (label) label.textContent = state.project?.name || 'No project';
  if (btn) btn.classList.toggle('on', !!state.project);
}

function renderProjectCards() {
  const host = document.getElementById('plProjects');
  if (!host) return;
  host.innerHTML = '';
  if (!state.projects.length) {
    const note = document.createElement('div');
    note.className = 'pl-empty-note';
    note.textContent = 'No projects yet. Create one to keep your classes together.';
    host.appendChild(note);
    return;
  }
  for (const p of state.projects) {
    const card = document.createElement('button');
    card.className = 'pl-card';
    card.type = 'button';
    const when = p.modified ? new Date(p.modified).toLocaleDateString() : '';
    card.innerHTML =
      `<span class="pl-card-icon" aria-hidden="true">
         <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
           <path d="M2 5.5h4l1.5 2h6.5V13H2z"/><path d="M2 5.5V3h4"/>
         </svg>
       </span>` +
      `<span class="pl-card-body">
         <span class="pl-card-name">${escapeHtml(p.name)}</span>
         <span class="pl-card-meta">${escapeHtml(PROJECT_LANG_LABEL[p.language] || p.language || '—')} · ${p.files || 0} file${p.files === 1 ? '' : 's'}${when ? ' · ' + when : ''}</span>
       </span>`;
    card.addEventListener('click', () => openProject(p));
    host.appendChild(card);
  }
}

function renderMenuProjects() {
  const host = document.getElementById('menuProjects');
  if (!host) return;
  host.innerHTML = '';
  if (!state.projects.length) {
    const note = document.createElement('div');
    note.className = 'pl-empty-note';
    note.style.padding = '4px 8px';
    note.textContent = 'No projects yet';
    host.appendChild(note);
    return;
  }
  for (const p of state.projects.slice(0, 8)) {
    const item = document.createElement('button');
    item.className = 'menu-project';
    item.type = 'button';
    item.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="mp-lang">${escapeHtml(PROJECT_LANG_LABEL[p.language] || '')}</span>`;
    item.addEventListener('click', () => { closeProjectMenu(); openProject(p); });
    host.appendChild(item);
  }
}

// The launcher CTA depends on the goal: build-only students get a starter
// file, learners get their next lesson.
function launcherCta() {
  const next = nextLesson();
  if (isBuildMode() || !next) {
    return { label: 'Open a starter file', course: false };
  }
  return { label: `Continue your course — ${next.title}`, course: true };
}

function updateLauncherCopy(firstRun = false) {
  const cta = launcherCta();
  const label = document.getElementById('plContinueLabel');
  if (label) label.textContent = cta.label;
  const lead = document.getElementById('plLead');
  if (lead) {
    lead.textContent = firstRun
      ? (cta.course
        ? 'Pick a project to keep your classes together, or jump straight into your next lesson.'
        : 'Pick a project to keep your classes together, or jump straight into a starter file.')
      : (cta.course
        ? 'Projects keep your classes together. You can also keep working on a lesson without one.'
        : 'Projects keep your classes together. You can also keep working without one.');
  }
}

function showLauncher(opts = {}) {
  state.launcherOpen = true;
  const el = document.getElementById('projectLauncher');
  if (!el) return;
  el.classList.remove('pl-hidden');
  el.setAttribute('aria-hidden', 'false');
  const p = state.profile;
  const who = p?.name ? `, ${p.name}` : '';
  document.getElementById('plTitle').textContent = opts.firstRun
    ? `Welcome${who} — create or open a project`
    : 'Create or open a project to start coding';
  updateLauncherCopy(!!opts.firstRun);
  const ws = document.getElementById('plWorkspace');
  refreshProjects().then(() => {
    if (ws) ws.textContent = state.workspace || '';
  });
}

function hideLauncher() {
  state.launcherOpen = false;
  const el = document.getElementById('projectLauncher');
  if (!el) return;
  el.classList.add('pl-hidden');
  el.setAttribute('aria-hidden', 'true');
}

function closeProjectTabs() {
  // Project files are scoped to a project root; never carry them into another.
  for (let i = state.tabs.length - 1; i >= 0; i--) {
    if (state.tabs[i].root) closeTab(i);
  }
}

async function openProject(p) {
  if (!p?.path) return;
  closeProjectTabs();
  state.project = { name: p.name || 'Project', path: p.path, language: p.language || 'javascript' };
  saveSettings();
  updateProjectChip();
  hideLauncher();
  await loadWorkspace();
  await refreshProjects();
  appendConsole('sys', `Project open: ${state.project.name} — ${state.project.path}`);
  const first = firstSourceFile(state.tree);
  if (first) {
    await openTreeFile(first.path);
    return;
  }
  // Empty project: drop in a starter file so there is something to run.
  const ext = PROJECT_EXT[state.project.language] || 'js';
  // Java requires a public class to live in a file named after the class.
  const file = state.project.language === 'java' ? 'Main.java' : `main.${ext}`;
  const starter = CLASS_TEMPLATES[state.project.language]
    ? CLASS_TEMPLATES[state.project.language]('Main')
    : '';
  const w = await api.writeFile(file, starter, state.project.path);
  if (!w.error) {
    await loadWorkspace();
    await openTreeFile(file);
  }
}

function firstSourceFile(nodes) {
  for (const n of nodes || []) {
    if (n.type === 'file') {
      if (langOfName(n.name)) return n;
    } else {
      const found = firstSourceFile(n.children || []);
      if (found) return found;
    }
  }
  return null;
}

// Bring back the project (and its first file) after a restart.
async function restoreProject() {
  await loadWorkspace();
  if (!state.project) return;
  const first = firstSourceFile(state.tree);
  if (first) await openTreeFile(first.path);
}

async function closeProject() {
  closeProjectTabs();
  state.project = null;
  saveSettings();
  updateProjectChip();
  await loadWorkspace();
  appendConsole('sys', 'Project closed. The workspace is showing again.');
  showLauncher();
}

function continueCourse() {
  const p = state.profile;
  if (isBuildMode()) {
    // No course in build mode — drop the student into a starter file.
    window.CodeClueIntro?.openStarter?.(p?.lang || 'javascript');
    hideLauncher();
    return;
  }
  if (p && window.CodeClueIntro?.openCourse) window.CodeClueIntro.openCourse(p);
  hideLauncher();
}

/* -------------------------------- modal -------------------------------- */

let modalSubmit = null;

function showModal({ title, body, okText = 'Create', onSubmit }) {
  const m = document.getElementById('modal');
  if (!m) return;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalOk').textContent = okText;
  modalSubmit = onSubmit;
  m.classList.remove('modal-hidden');
  m.setAttribute('aria-hidden', 'false');
  setTimeout(() => m.querySelector('input')?.focus(), 40);
}

function closeModal() {
  const m = document.getElementById('modal');
  if (!m) return;
  m.classList.add('modal-hidden');
  m.setAttribute('aria-hidden', 'true');
  modalSubmit = null;
}

function langPickerHtml(selected) {
  const langs = ['java', 'python', 'javascript', 'c', 'cpp', 'rust'];
  return `<div class="modal-langs">${langs.map((id) =>
    `<button type="button" class="modal-lang${id === selected ? ' selected' : ''}" data-lang="${id}">${PROJECT_LANG_LABEL[id]}</button>`
  ).join('')}</div>`;
}

function wireLangPicker(host, onPick) {
  host?.querySelectorAll('.modal-lang').forEach((b) => {
    b.addEventListener('click', () => {
      host.querySelectorAll('.modal-lang').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      onPick(b.dataset.lang);
    });
  });
}

function createProjectFlow() {
  const preferred = state.profile?.lang || 'javascript';
  let lang = PROJECT_EXT[preferred] ? preferred : 'javascript';
  showModal({
    title: 'New project',
    okText: 'Create project',
    body:
      `<label class="modal-field"><span>Project name</span>
         <input name="name" maxlength="40" placeholder="e.g. Calculator" autocomplete="off" spellcheck="false" />
       </label>
       <div class="modal-field"><span>Main language</span>${langPickerHtml(lang)}</div>
       <p class="modal-hint">A folder is created in your workspace with a starter file inside.</p>
       <div class="modal-error" id="modalError"></div>`,
    onSubmit: async (form) => {
      const name = (form.get('name') || '').trim();
      const err = document.getElementById('modalError');
      if (!name) { if (err) err.textContent = 'Give the project a name first.'; return; }
      const res = await api.createProject({ name, language: lang });
      if (!res || res.error) { if (err) err.textContent = res?.error || 'Could not create the project.'; return; }
      closeModal();
      await openProject(res);
    },
  });
  wireLangPicker(document.getElementById('modalBody'), (id) => { lang = id; });
}

async function openProjectFlow() {
  const res = await api.pickProjectDir();
  if (!res) return;
  await openProject(res);
}

function newClassFlow() {
  const where = state.project ? state.project.name : 'your workspace';
  let lang = state.project?.language || state.profile?.lang || 'javascript';
  if (!PROJECT_EXT[lang]) lang = 'javascript';
  showModal({
    title: 'New class',
    okText: 'Create class',
    body:
      `<label class="modal-field"><span>Class name</span>
         <input name="name" maxlength="40" placeholder="e.g. Robot" autocomplete="off" spellcheck="false" />
       </label>
       <div class="modal-field"><span>Language</span>${langPickerHtml(lang)}</div>
       <p class="modal-hint">Creates the file inside <b>${escapeHtml(where)}</b>.</p>
       <div class="modal-error" id="modalError"></div>`,
    onSubmit: async (form) => {
      const raw = (form.get('name') || '').trim();
      const err = document.getElementById('modalError');
      const clean = raw.replace(/[^\w$]/g, '');
      if (!clean) { if (err) err.textContent = 'Use letters and numbers, e.g. Robot.'; return; }
      const file = `${clean}.${PROJECT_EXT[lang] || 'js'}`;
      const content = (CLASS_TEMPLATES[lang] || CLASS_TEMPLATES.javascript)(clean);
      const root = projectRoot();
      const w = await api.writeFile(file, content, root);
      if (!w || w.error) { if (err) err.textContent = w?.error || 'Could not create the file.'; return; }
      closeModal();
      await loadWorkspace();
      openTab({ name: file, path: w.path || file, content, root });
      appendConsole('sys', `Created ${file} in ${where}.`);
    },
  });
  wireLangPicker(document.getElementById('modalBody'), (id) => { lang = id; });
}

/* ------------------------------ files tree ------------------------------ */

async function loadWorkspace() {
  state.workspace = await api.getWorkspace();
  state.tree = await api.readTree(projectRoot());
  renderTree();
}

function renderTree() {
  const el = document.getElementById('tree');
  el.innerHTML = '';
  if (!state.tree.length) {
    el.innerHTML = state.project
      ? '<div class="no-mission">This project is empty. Use “New Class…” to add a file.</div>'
      : '<div class="no-mission">Workspace is empty. Open a project to get started.</div>';
  }
  renderTreeLevel(state.tree, el, 0);
  const ws = document.getElementById('wsName');
  if (ws) {
    // The bar is narrow — show the short name there, keep the full path
    // in the tooltip and the status bar.
    ws.textContent = state.project ? state.project.name : (state.workspace || '');
    ws.title = state.project ? `${state.project.name} — ${state.project.path}` : (state.workspace || '');
  }
  const status = document.getElementById('statusWs');
  if (status) status.textContent = state.project ? state.project.path : (state.workspace || '');
}

function renderTreeLevel(nodes, parent, depth) {
  for (const n of nodes) {
    const row = document.createElement('div');
    const open = n.type === 'dir' && state.openDirs.has(n.path);
    row.className = 'tree-item ' + n.type + (open ? ' open' : '');
    row.style.paddingLeft = 6 + depth * 13 + 'px';
    row.innerHTML =
      `<span class="tree-icon">${n.type === 'dir' ? SVG.chevron : SVG.file}</span>` +
      `<span>${escapeHtml(n.name)}</span>`;
    if (n.type === 'dir') {
      row.addEventListener('click', () => {
        if (state.openDirs.has(n.path)) state.openDirs.delete(n.path); else state.openDirs.add(n.path);
        renderTree();
      });
    } else {
      row.addEventListener('click', () => openTreeFile(n.path));
    }
    parent.appendChild(row);
    if (n.type === 'dir' && state.openDirs.has(n.path)) renderTreeLevel(n.children || [], parent, depth + 1);
  }
}

async function openTreeFile(path) {
  const root = projectRoot();
  const r = await api.readFile(path, root);
  if (r.error) { appendConsole('err', r.error); return; }
  openTab({
    name: path.split(/[\\/]/).pop(),
    path: r.path || path,
    content: r.content ?? '',
    root,
  });
}

/* ------------------------------- status bar ------------------------------- */

function updateLangStatus() {
  const tab = activeTab();
  const lang = tab ? (RUN_LANG_NAME[tab.langRun] || tab.langRun) : '—';
  document.getElementById('statusLang').textContent = lang;
}

function refreshTools() {
  state.toolsReady = api.detectTools().then((tools) => {
    state.tools = tools;
    window.CodeClueIntro?.refreshTools?.();
    const bar = document.getElementById('statusTools');
    if (!bar) return tools;
    bar.innerHTML = '';
    const chips = [
      ['node', 'node'], ['python3', 'python3'], ['gcc', 'gcc'], ['g++', 'g++'],
      ['javac', 'javac'], ['java', 'java'], ['rustc', 'rustc'],
    ];
    for (const [key, label] of chips) {
      const span = document.createElement('span');
      const have = !!tools[key];
      span.className = 'tool-chip ' + (have ? 'have' : 'missing');
      span.textContent = (have ? '✓ ' : '· ') + label;
      if (have && tools[key]) span.title = tools[key];
      bar.appendChild(span);
    }
    return tools;
  });
}

/* ------------------------------- code pad ------------------------------- */

let padFrame = null;   // persistent JS session, BlueJ-code-pad style
let padJob = null;

function ensurePadFrame() {
  if (padFrame) return Promise.resolve(padFrame);
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.display = 'none';
    document.getElementById('hiddenFrames').appendChild(frame);
    frame.srcdoc = SANDBOX_HTML;
    const listener = (ev) => {
      if (!frame.contentWindow || ev.source !== frame.contentWindow) return;
      const m = ev.data || {};
      if (m.type === 'ready') {
        padFrame = frame;
        resolve(frame);
        return;
      }
      if (padJob) {
        if (m.type === 'log') padOutLine(m.text);
        else if (m.type === 'err') padOutLine('(err) ' + m.text);
        else if (m.type === 'done') {
          const j = padJob;
          padJob = null;
          clearTimeout(j.timer);
          j.resolve();
        }
      }
    };
    window.addEventListener('message', listener);
  });
}

function padOutLine(t) {
  const line = document.createElement('div');
  line.className = 'out';
  line.textContent = t;
  padOutEl.appendChild(line);
  padOutEl.scrollTop = padOutEl.scrollHeight;
}

async function runPad() {
  const input = document.getElementById('padInput');
  const code = input.value.trim();
  if (!code || !padOutEl) return;
  input.value = '';
  const echo = document.createElement('div');
  echo.className = 'pad-echo';
  echo.textContent = code;
  padOutEl.appendChild(echo);

  const lang = activeTab()?.langRun || 'javascript';
  try {
    if (lang === 'javascript') {
      const frame = await ensurePadFrame();
      const done = new Promise((res) => (padJob = { resolve: res, timer: padJobTimer(res) }));
      frame.contentWindow.postMessage({ __cc: 'run', code }, '*');
      await done;
    } else if (lang === 'python') {
      const onLine = (kind, t) => {
        if (kind === 'out') padOutLine(t);
        else if (t) padOutLine('(err) ' + t);
      };
      const res = await runPython(code, 5000, onLine);
      if (res.error && !res.error.includes('too long')) padOutLine('(err) ' + res.error);
    } else {
      padOutLine(`(Code Pad understands JavaScript and Python for now — ${RUN_LANG_NAME[lang] || lang} runs from the editor with Run.)`);
    }
  } catch (e) {
    padOutLine('(error) ' + e.message);
  }
}

function padJobTimer(resolve) {
  return setTimeout(() => {
    if (padJob) {
      padOutLine('(Code Pad: stopped after 5s — possible infinite loop)');
      padJob = null;
      resolve();
    }
  }, 5000);
}

/* --------------------------------- ai assistant --------------------------------- */

let aiConnected = false;
let aiModels = [];
const aiChat = document.getElementById('aiChat');
const aiInput = document.getElementById('aiInput');
const aiStatus = document.getElementById('aiStatus');
const aiSend = document.getElementById('aiSend');

function pickBestModel(list) {
  // Prefer the 3B coder: on CPU it reviews in ~20-65s and actually reads the
  // run output, while the 1.5B model often misses off-by-one bugs.
  const rank = ['qwen2.5-coder:3b', 'qwen2.5-coder:1.5b', 'qwen2.5-coder:0.5b'];
  return rank.find((r) => list.includes(r)) || list[0] || '';
}

async function refreshAIStatus() {
  if (!aiStatus) return;
  try {
    const st = await api.ai.status();
    aiConnected = st.ok;
    aiModels = (st.qwenModels && st.qwenModels.length) ? st.qwenModels : (st.models || []);
    const sel = document.getElementById('aiModelSel');
    if (sel) {
      sel.innerHTML = '';
      const list = aiModels.length ? aiModels : [st.defaultModel || 'qwen2.5-coder:0.5b'];
      list.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.replace(/^.*\//, '');
        sel.appendChild(opt);
      });
      const preferred = (state.aiModel && list.includes(state.aiModel)) ? state.aiModel : pickBestModel(list);
      if (preferred) sel.value = preferred;
      state.aiModel = sel.value || preferred;
      sel.disabled = !aiConnected;
    }
    aiStatus.innerHTML = `<span class="dot"></span> ${st.ok
      ? 'Connected — ' + (state.aiModel || (st.hasQwen ? 'qwen2.5-coder' : 'model missing'))
      : 'Ollama not reachable'}`;
    aiStatus.className = 'ai-status ' + (st.ok ? 'connected' : 'disconnected');
    aiSend.disabled = !aiConnected;
    const mon = document.getElementById('aiMonitor');
    if (mon) mon.checked = state.aiMonitor;
  } catch {
    aiConnected = false;
    aiStatus.innerHTML = `<span class="dot"></span> AI unavailable`;
    aiStatus.className = 'ai-status disconnected';
    aiSend.disabled = true;
  }
  console.log('[CodeClue AI] status:', aiConnected ? 'connected' : 'disconnected');
}

function renderAIMessage(text, who, meta) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ' + who;
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  if (meta) {
    const m = document.createElement('div');
    m.className = 'ai-meta';
    m.textContent = meta;
    wrap.appendChild(m);
  }
  aiChat.appendChild(wrap);
  aiChat.scrollTop = aiChat.scrollHeight;
  return wrap;
}

function renderAIThinking() {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg bot ai-thinking';
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  bubble.innerHTML = '<span class="think-dot"></span><span class="think-dot"></span><span class="think-dot"></span> <span class="think-text">Qwen is reading your code…</span>';
  wrap.appendChild(bubble);
  aiChat.appendChild(wrap);
  aiChat.scrollTop = aiChat.scrollHeight;
  return wrap;
}

function aiEmptyState() {
  if (aiChat.querySelector('.ai-empty')) return;
  const empty = document.createElement('div');
  empty.className = 'ai-empty';
  empty.textContent = 'Ask the tutor for a hint, an explanation, or a fix — it reads your open file for context.';
  aiChat.appendChild(empty);
}

function clearAIEmpty() {
  const e = aiChat.querySelector('.ai-empty');
  if (e) e.remove();
}

function currentCodeContext() {
  const tab = activeTab();
  if (!tab) return '';
  const lang = RUN_LANG_NAME[tab.langRun] || tab.langRun;
  return `The student is working in ${lang} (file: ${tab.name}). Their current code is:\n\`\`\`${tab.langRun}\n${tab.model.getValue()}\n\`\`\``;
}

let aiHistory = [];   // rolling {role, content} list so the tutor remembers the chat

async function sendAIMessage(text) {
  if (!text.trim() || !aiConnected) return;
  clearAIEmpty();
  renderAIMessage(text, 'user');
  aiInput.value = '';
  aiSend.disabled = true;

  let fullText = text;
  const tab = activeTab();
  if (tab && tab.model.getValue().trim()) {
    fullText = `${currentCodeContext()}\n\nStudent question: ${text}`;
  }

  try {
    // Send the recent conversation, not just this message — otherwise the
    // tutor forgets everything it said one turn ago.
    const outgoing = [...aiHistory, { role: 'user', content: fullText }].slice(-12);
    const res = await api.ai.chat({
      messages: outgoing,
      model: state.aiModel || undefined,
    });
    aiHistory = [...outgoing, { role: 'assistant', content: res.content }].slice(-12);
    renderAIMessage(res.content, 'bot', res.model);
  } catch (e) {
    renderAIMessage('(AI error) ' + e.message, 'bot');
  } finally {
    aiSend.disabled = !aiConnected;
    aiInput.focus();
  }
}

/* ------------------------------ Qwen review ------------------------------ */

let aiReviewing = false;
let lastAutoReviewAt = 0;
let lastReviewedCode = '';

function currentAIContext() {
  const tab = activeTab();
  if (!tab) return null;
  const code = tab.model.getValue();
  // Only attach run/checkpoint evidence if it belongs to the code on screen;
  // otherwise the tutor would review stale output after an edit.
  const lastRun = state.lastRun && state.lastRun.code === code ? state.lastRun : null;
  const check = lastRun && state.lastCheck && tab.mission && state.lastCheck.missionId === tab.mission.id
    ? state.lastCheck
    : null;
  return {
    code,
    lang: tab.langRun,
    langName: RUN_LANG_NAME[tab.langRun] || tab.langRun,
    fileName: tab.name,
    mission: tab.mission || null,
    lastRun,
    lastCheck: check,
  };
}

function reviewReasonLabel(reason) {
  return {
    manual: 'Review my code and name my mistakes.',
    failedRun: 'My run failed. What went wrong?',
    failedCheck: 'The checkpoint failed. Where is my mistake?',
    idle: 'Review my code while I work.',
  }[reason] || 'Review my code.';
}

function numberedCode(code) {
  return code.split('\n')
    .map((line, i) => `${String(i + 1).padStart(3, ' ')} | ${line}`)
    .join('\n');
}

function buildReviewPrompt(ctx, reason) {
  const m = ctx.mission;
  const goal = m
    ? `Exercise: ${m.title} — ${m.blurb}`
    : 'Exercise: none. This is free coding.';
  let run = 'Last run: not run yet.';
  if (ctx.lastRun && (!ctx.lastRun.name || ctx.lastRun.name === ctx.fileName)) {
    const r = ctx.lastRun;
    const out = (r.stdout || []).join('\n').slice(0, 1200);
    const err = (r.stderr || []).join('\n').slice(0, 1200);
    run = `Last run — exit ${r.exitCode ?? 'n/a'}${r.error ? `, error: ${r.error}` : ''}` +
      (out ? `\nstdout:\n${out}` : '') +
      (err ? `\nstderr:\n${err}` : '');
  }
  const check = ctx.lastCheck?.msg
    ? `Checkpoint result (authoritative — the code is NOT correct):\n${ctx.lastCheck.msg}\n`
    : '';
  return `${goal}\nLanguage: ${ctx.langName} (file ${ctx.fileName})\nWhy: ${reviewReasonLabel(reason)}\n\n${run}\n${check}\n` +
    `Student code with real line numbers (quote only these numbers):\n\`\`\`${ctx.lang}\n${numberedCode(ctx.code)}\n\`\`\``;
}

function renderAIFindings(ctx, text, meta = {}) {
  const host = document.getElementById('aiFindings');
  if (!host) return;
  host.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'finding ai-review';
  const when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const head = document.createElement('div');
  head.className = 'f-head';
  head.innerHTML =
    `<span class="f-badge tip">AI</span>` +
    `<span class="f-title">${meta.silent ? 'Watching' : 'Qwen review'} · ${escapeHtml(ctx.fileName)}</span>` +
    `<span class="f-line">${when}</span>`;
  card.appendChild(head);
  const body = document.createElement('div');
  body.className = 'ai-review-body';
  body.textContent = String(text || '').trim() || 'No review text returned.';
  card.appendChild(body);
  host.appendChild(card);
}

function clearAIFindings(msg) {
  const host = document.getElementById('aiFindings');
  if (!host) return;
  host.innerHTML = `<div class="finding empty">${escapeHtml(msg || 'Run AI Check to have Qwen point out mistakes.')}</div>`;
}

async function reviewCode({ reason = 'manual', silent = false, pane = 'ai' } = {}) {
  const btn = document.getElementById('aiCheckBtn');
  // Bring the rail back first, so pressing AI Check always shows something
  // — even if a review is already running.
  if (!silent) revealCoach(pane);

  if (!aiConnected) {
    if (!silent) {
      clearAIEmpty();
      renderAIMessage('Ollama is not reachable. Start it with `ollama serve`, then press AI Check again.', 'bot');
    }
    return;
  }
  const ctx = currentAIContext();
  if (!ctx || !ctx.code.trim()) {
    if (!silent) {
      clearAIEmpty();
      renderAIMessage('Open a file with some code first — then I can review it.', 'bot');
    }
    return;
  }
  if (aiReviewing) return;

  aiReviewing = true;
  lastReviewedCode = ctx.code;
  lastAutoReviewAt = Date.now();
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }

  if (!silent) {
    // The chat transcript lives in the AI Tutor pane; a review started from
    // the Clue Coach only fills the findings card there.
    if (pane === 'ai') {
      clearAIEmpty();
      renderAIMessage(reviewReasonLabel(reason), 'user');
    }
  }
  // The "thinking" bubble belongs to the chat — only show it there.
  const thinking = (!silent && pane === 'ai') ? renderAIThinking() : null;
  const host = document.getElementById('aiFindings');
  if (host) host.innerHTML = '<div class="finding empty">Qwen is reading your code…</div>';

  try {
    const res = await api.ai.chat({
      mode: 'review',
      model: state.aiModel || undefined,
      messages: [{ role: 'user', content: buildReviewPrompt(ctx, reason) }],
    });
    thinking?.remove();
    if (!silent && pane === 'ai') renderAIMessage(res.content, 'bot', res.model);
    renderAIFindings(ctx, res.content, { silent });
    if (silent) appendConsole('sys', 'Qwen reviewed your code — see the Qwen review panel on the right.');
  } catch (e) {
    thinking?.remove();
    if (!silent && pane === 'ai') renderAIMessage('(AI error) ' + e.message, 'bot');
    clearAIFindings('AI review failed: ' + e.message);
  } finally {
    aiReviewing = false;
    if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
  }
}

function maybeAutoReview(reason) {
  if (!state.aiMonitor || !aiConnected || aiReviewing) return;
  const ctx = currentAIContext();
  if (!ctx || ctx.code.trim().length < 20) return;
  if (reason === 'idle') {
    if (!activeTab()?.dirty) return;
    if (ctx.code === lastReviewedCode) return;
    if (Date.now() - lastAutoReviewAt < 45000) return;
  }
  reviewCode({ reason, silent: reason === 'idle' });
}

function wireAI() {
  if (!aiChat || !aiInput || !aiSend) return;

  aiSend.addEventListener('click', () => sendAIMessage(aiInput.value));
  aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAIMessage(aiInput.value);
    }
  });

  document.getElementById('aiCheckBtn')?.addEventListener('click', () => reviewCode({ reason: 'manual', pane: 'ai' }));
  document.getElementById('coachReviewBtn')?.addEventListener('click', () => reviewCode({ reason: 'manual', pane: 'coach' }));

  const monitor = document.getElementById('aiMonitor');
  if (monitor) {
    monitor.checked = state.aiMonitor;
    monitor.addEventListener('change', () => {
      state.aiMonitor = monitor.checked;
      saveSettings();
      appendConsole('sys', state.aiMonitor
        ? 'AI Monitor on — Qwen reviews after failed runs and while you write.'
        : 'AI Monitor off — use AI Check when you want a review.');
    });
  }

  const modelSel = document.getElementById('aiModelSel');
  if (modelSel) {
    modelSel.addEventListener('change', () => {
      state.aiModel = modelSel.value;
      saveSettings();
      if (aiStatus) aiStatus.innerHTML = `<span class="dot"></span> Connected — ${state.aiModel}`;
    });
  }

  document.querySelectorAll('.ai-quick').forEach((b) => {
    b.addEventListener('click', () => {
      const kind = b.getAttribute('data-quick');
      if (kind === 'review') { reviewCode({ reason: 'manual' }); return; }
      const tab = activeTab();
      const code = tab ? tab.model.getValue().trim() : '';
      let prompt = '';
      switch (kind) {
        case 'hint':
          prompt = code ? `I'm stuck on this ${tab.langRun} code. Give me a progressive hint (nudge first, then concept, then a small skeleton — not the full answer):\n\n\`\`\`${tab.langRun}\n${code}\n\`\`\`` : 'Give me a hint for my current mission.';
          break;
        case 'explain':
          prompt = code ? `Explain what this ${tab.langRun} code does, line by line, in simple terms:\n\n\`\`\`${tab.langRun}\n${code}\n\`\`\`` : 'Explain the current mission.';
          break;
      }
      aiInput.value = prompt;
      aiInput.focus();
    });
  });
}

/* --------------------------------- panels --------------------------------- */

function switchPanel(which) {
  document.querySelectorAll('.panel-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.ptab === which));
  document.getElementById('outputPane').classList.toggle('active', which === 'output');
  document.getElementById('padPane').classList.toggle('active', which === 'pad');
}

/* ------------------------------- right rail ------------------------------- */
// The rail lives on the right of the editor: "Clue Coach" for hints and
// lesson state, "AI Tutor" for the Qwen conversation. It can be locked away
// (collapsed) so the editor gets the whole width.

function switchCoachTab(which) {
  const tab = which === 'ai' ? 'ai' : 'coach';
  state.coachTab = tab;
  document.querySelectorAll('.coach-tabs button[data-ctab]').forEach((b) => b.classList.toggle('active', b.dataset.ctab === tab));
  document.getElementById('coachPane').classList.toggle('active', tab === 'coach');
  document.getElementById('aiCoachPane').classList.toggle('active', tab === 'ai');
  document.getElementById('coach').classList.toggle('ai-open', tab === 'ai');
  if (tab === 'ai') { refreshAIStatus(); aiEmptyState(); }
  saveSettings();
  setTimeout(() => editor?.layout(), 60);
}

// Lock the rail away (editor gets the space) or bring it back.
function setCoachCollapsed(collapsed) {
  state.coachCollapsed = !!collapsed;
  document.getElementById('coach').classList.toggle('collapsed', state.coachCollapsed);
  const restore = document.getElementById('coachRestore');
  if (restore) restore.hidden = !state.coachCollapsed;
  saveSettings();
  setTimeout(() => editor?.layout(), 60);
}

function toggleCoach() {
  setCoachCollapsed(!state.coachCollapsed);
  appendConsole('sys', state.coachCollapsed
    ? 'AI panel locked away — the editor now uses the full width. Use the “AI” handle to bring it back.'
    : 'AI panel restored on the right.');
}

// Bring the rail back and show the requested tab (used by AI Check etc.).
function revealCoach(tab = 'ai') {
  if (state.coachCollapsed) setCoachCollapsed(false);
  if (state.coachTab !== tab) switchCoachTab(tab);
}

function switchSide(which) {
  // The course is not part of build mode — the Lessons tab is not reachable.
  if (which === 'missions' && isBuildMode()) which = 'files';
  state.sideTab = which;
  document.querySelectorAll('.side-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === which));
  document.getElementById('missionsPane').classList.toggle('active', which === 'missions');
  document.getElementById('filesPane').classList.toggle('active', which === 'files');
  saveSettings();
}

/* ------------------------------- goal layout ------------------------------ */
// "Build only" students never see the course: no Lessons tab, no lesson
// progress, no lesson mission in the coach. They get files and the AI.

function isBuildMode() {
  return state.profile?.goal === 'build';
}

function applyGoalLayout() {
  const build = isBuildMode();
  document.body.classList.toggle('cc-build-only', build);

  const lessonsBtn = document.querySelector('.side-tabs button[data-tab="missions"]');
  if (lessonsBtn) lessonsBtn.hidden = build;

  // A build-only student has no lessons to pick — start them on Files.
  if (build && state.sideTab === 'missions') switchSide('files');

  // Lesson tabs are course content — close them if the goal changed to build.
  if (build) {
    for (let i = state.tabs.length - 1; i >= 0; i--) {
      if (state.tabs[i].mission) closeTab(i);
    }
  }

  // Launcher CTA: the course does not exist in build mode.
  updateLauncherCopy(false);

  renderCoach();
}

/* --------------------------------- wiring --------------------------------- */

function initUi() {
  ensureConsole();

  document.getElementById('runBtn').addEventListener('click', runActive);
  document.getElementById('clearBtn').addEventListener('click', clearConsole);

  // Fullscreen: real OS fullscreen, F11 also works via the main process.
  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', async () => {
      try {
        const isFs = await api.win.toggleFullscreen();
        fsBtn.classList.toggle('on', !!isFs);
        fsBtn.setAttribute('aria-pressed', String(!!isFs));
      } catch (e) {
        appendConsole('warn', 'Fullscreen unavailable: ' + e.message);
      }
    });
    api.win.isFullscreen?.().then((v) => fsBtn.classList.toggle('on', !!v)).catch(() => {});
  }
  document.getElementById('runnerSel').addEventListener('change', (e) => {
    state.runner = e.target.value;
    appendConsole('sys', state.runner === 'auto'
      ? 'Runner: Auto — JS/Python inside the app sandbox; C/C++/Java/Rust through your real toolchains'
      : 'Runner: everything through local toolchains');
  });
  document.getElementById('pickWs').addEventListener('click', async () => {
    const ws = await api.chooseWorkspace();
    if (ws) {
      await refreshProjects();
      await loadWorkspace();
      updateProjectChip();
    }
  });
  document.getElementById('newClassBtn')?.addEventListener('click', newClassFlow);

  // Project menu (BlueJ style): new/open project, new class, close project.
  const projectBtn = document.getElementById('projectBtn');
  const projectMenu = document.getElementById('projectMenu');
  const toggleProjectMenu = (force) => {
    if (!projectMenu) return;
    const open = force == null ? projectMenu.hasAttribute('hidden') : force;
    projectMenu.toggleAttribute('hidden', !open);
    projectBtn?.setAttribute('aria-expanded', String(open));
  };
  projectBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProjectMenu();
    if (!projectMenu?.hasAttribute('hidden')) refreshProjects();
  });
  projectMenu?.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => toggleProjectMenu(false));
  projectMenu?.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      toggleProjectMenu(false);
      switch (item.dataset.pm) {
        case 'new-project': createProjectFlow(); break;
        case 'open-project': openProjectFlow(); break;
        case 'new-class': newClassFlow(); break;
        case 'launcher': showLauncher(); break;
        case 'close-project': closeProject(); break;
      }
    });
  });

  // Launcher buttons.
  document.getElementById('plNewProject')?.addEventListener('click', createProjectFlow);
  document.getElementById('plOpenProject')?.addEventListener('click', openProjectFlow);
  document.getElementById('plContinue')?.addEventListener('click', continueCourse);
  document.getElementById('plQuick')?.addEventListener('click', () => {
    hideLauncher();
    appendConsole('sys', 'Quick start — no project. Pick “New Class…” any time to add a file.');
  });
  document.getElementById('plClose')?.addEventListener('click', hideLauncher);

  // Modal plumbing.
  document.getElementById('modalForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    modalSubmit?.(new FormData(e.target));
  });
  document.getElementById('modalCancel')?.addEventListener('click', closeModal);
  document.getElementById('modalBackdrop')?.addEventListener('click', closeModal);

  document.querySelectorAll('.side-tabs button').forEach((b) => b.addEventListener('click', () => switchSide(b.dataset.tab)));
  document.querySelectorAll('.panel-tabs button').forEach((b) => b.addEventListener('click', () => switchPanel(b.dataset.ptab)));

  // Right rail: Clue Coach | AI Tutor, plus the lock/collapse control.
  document.querySelectorAll('.coach-tabs button[data-ctab]').forEach((b) => {
    b.addEventListener('click', () => switchCoachTab(b.dataset.ctab));
  });
  document.getElementById('coachToggle')?.addEventListener('click', toggleCoach);
  document.getElementById('coachRestore')?.addEventListener('click', () => {
    setCoachCollapsed(false);
    appendConsole('sys', 'AI panel restored on the right.');
  });

  document.getElementById('padInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runPad();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveActive(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runActive(); }
    // Ctrl+Alt+A — lock/unlock the AI rail so the editor can grow.
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); toggleCoach(); return; }
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal');
      if (modal && !modal.classList.contains('modal-hidden')) { closeModal(); return; }
      toggleProjectMenu(false);
    }
  });

  initPanelResize();
  renderLessons();
  wireAI();
  refreshAIStatus();

  // Restore the rail + sidebar state the student left the app in.
  switchCoachTab(state.coachTab || 'coach');
  if (state.coachCollapsed) setCoachCollapsed(true);
  if (state.sideTab === 'files') switchSide('files');
  // dev/E2E hook — not part of the student surface
  window.__ccDebug = {
    setCode(text) {
      const tab = activeTab();
      if (tab) { tab.model.setValue(text); return 'SET_OK'; }
      const model = monaco.editor.createModel(text, 'javascript', monaco.Uri.parse('cc:///debug'));
      const t = openTab({ name: 'debug.js', content: text, monoLang: 'javascript' });
      return 'CREATED_TAB';
    },
    getCode() {
      const tab = activeTab();
      return tab ? tab.model.getValue() : null;
    },
    review: (reason = 'manual') => reviewCode({ reason }),
    getProfile: () => state.profile,
    getPanelHeight: () => document.getElementById('bottomPanel')?.getBoundingClientRect().height,
  };
}

/* ------------------------- output panel resize ------------------------- */

function applyPanelHeight() {
  const panel = document.getElementById('bottomPanel');
  if (!panel) return;
  panel.classList.toggle('expanded', !!state.panelExpanded);
  panel.style.height = (!state.panelExpanded && state.panelHeight) ? state.panelHeight + 'px' : '';
  setTimeout(() => editor?.layout(), 60);
}

function initPanelResize() {
  const panel = document.getElementById('bottomPanel');
  const grip = document.getElementById('panelGrip');
  const expandBtn = document.getElementById('panelExpand');
  if (!panel) return;

  applyPanelHeight();

  if (grip) {
    let dragging = false;
    let startY = 0;
    let startH = 0;

    const pointY = (e) => (e.touches ? e.touches[0].clientY : e.clientY);
    const onMove = (e) => {
      if (!dragging) return;
      const dy = startY - pointY(e);
      const max = Math.max(220, window.innerHeight - 200);
      const h = Math.max(96, Math.min(max, startH + dy));
      state.panelHeight = Math.round(h);
      state.panelExpanded = false;
      panel.classList.remove('expanded');
      panel.style.height = h + 'px';
      editor?.layout();
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing-panel');
      saveSettings();
      editor?.layout();
    };
    const onDown = (e) => {
      dragging = true;
      startY = pointY(e);
      startH = panel.getBoundingClientRect().height;
      document.body.classList.add('resizing-panel');
      if (e.cancelable) e.preventDefault();
    };

    grip.addEventListener('mousedown', onDown);
    grip.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    grip.addEventListener('dblclick', () => {
      state.panelHeight = null;
      state.panelExpanded = false;
      panel.classList.remove('expanded');
      panel.style.height = '';
      saveSettings();
      editor?.layout();
    });
  }

  const toggleExpand = () => {
    state.panelExpanded = !state.panelExpanded;
    applyPanelHeight();
    saveSettings();
    const btn = document.getElementById('panelExpand');
    if (btn) btn.classList.toggle('on', state.panelExpanded);
  };
  expandBtn?.addEventListener('click', toggleExpand);
  if (expandBtn) expandBtn.classList.toggle('on', state.panelExpanded);

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault();
      toggleExpand();
    }
  });
}

/* --------------------------- public app surface --------------------------- */
// intro.js (onboarding/splash) talks to the project layer through this.
window.CodeClueApp = {
  showLauncher,
  hideLauncher,
  openProject,
  closeProject,
  createProjectFlow,
  openProjectFlow,
  newClassFlow,
  continueCourse,
  refreshProjects,
  applyGoalLayout,
  switchCoachTab,
  toggleCoach,
  setCoachCollapsed,
  revealCoach,
  getProject: () => state.project,
  getProjects: () => state.projects,
};
