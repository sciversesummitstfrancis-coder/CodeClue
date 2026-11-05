// CodeClue intro — animated splash + personalized onboarding.
// Loaded after app.js. app.js calls CodeClueIntro.start() once Monaco is ready.
// Classic script, so it shares the global lexical scope with app.js.

'use strict';

const PROFILE_KEY = 'codeclue:profile:v1';
const SETTINGS_KEY = 'codeclue:settings:v1';

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', file: 'main.js', tag: 'Runs in-app', tone: '#f0db4f', badge: 'JS' },
  { id: 'python', label: 'Python', file: 'main.py', tag: 'Runs in-app', tone: '#4b8bbe', badge: 'Py' },
  { id: 'java', label: 'Java', file: 'Main.java', tag: 'JDK toolchain', tone: '#e76f00', badge: 'Jv' },
  { id: 'c', label: 'C', file: 'main.c', tag: 'gcc toolchain', tone: '#9aa7b8', badge: 'C' },
  { id: 'cpp', label: 'C++', file: 'main.cpp', tag: 'g++ toolchain', tone: '#5b8af5', badge: 'C++' },
  { id: 'rust', label: 'Rust', file: 'main.rs', tag: 'rustc toolchain', tone: '#dea584', badge: 'Rs' },
];

const STARTERS = {
  javascript: `// Your JavaScript playground\n// Run with Ctrl+Enter. AI Check reviews mistakes.\n\nconsole.log("Hello, world!");\n`,
  python: `# Your Python playground\n# Run with Ctrl+Enter. AI Check reviews mistakes.\n\nprint("Hello, world!")\n`,
  java: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n    }\n}\n`,
  c: `#include <stdio.h>\n\nint main(void) {\n    printf("Hello, world!\\n");\n    return 0;\n}\n`,
  cpp: `#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!\\n";\n    return 0;\n}\n`,
  rust: `fn main() {\n    println!("Hello, world!");\n}\n`,
};

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

const intro = {
  profile: readJSON(PROFILE_KEY, null),
  selected: { name: '', goal: 'learn', lang: 'javascript' },
  step: 0,
  splashDone: false,
  started: false,
};

/* ------------------------------- profile ------------------------------- */

function saveProfile(p) {
  intro.profile = p;
  writeJSON(PROFILE_KEY, p);
  updateProfileChip();
}

function updateProfileChip() {
  const name = intro.profile?.name?.trim() || '';
  const av = document.getElementById('pcAvatar');
  const nm = document.getElementById('pcName');
  if (av) av.textContent = name ? name[0].toUpperCase() : '?';
  if (nm) nm.textContent = name || 'Set up';
}

function profileLanguage() {
  return intro.profile?.lang || 'javascript';
}

function languageHasLessons(lang) {
  return EXERCISES.some((m) => m.lang === lang);
}

function openStarter(lang) {
  const meta = LANGUAGES.find((l) => l.id === lang) || LANGUAGES[0];
  const code = STARTERS[meta.id] || STARTERS.javascript;
  openTab({ name: meta.file, content: code });
  appendConsole('sys', `Starter file ${meta.file} opened. Run with Ctrl+Enter — AI Check reviews mistakes.`);
}

// Called once by app.js after Monaco/UI is ready.
function applyProfile(profile, opts = {}) {
  const p = profile || intro.profile || { name: 'friend', goal: 'learn', lang: 'javascript' };
  intro.profile = p;
  // The profile drives the whole layout (course vs build), so keep it saved.
  if (opts.persist !== false) saveProfile(p);
  if (typeof state !== 'undefined') {
    state.profile = p;
    state.lessonFilter = languageHasLessons(p.lang) ? p.lang : 'all';
  }
  updateProfileChip();
  renderLessons();
  // Build-only students never see the course — hide it everywhere.
  window.CodeClueApp?.applyGoalLayout?.();
  if (opts.open === false) return;
  openCourse(p);
}

// Open the lesson (or starter file) that matches the student's goal.
function openCourse(p = intro.profile) {
  const profile = p || { name: 'friend', goal: 'learn', lang: 'javascript' };
  const goal = profile.goal === 'build' ? 'build' : 'learn';
  const lang = profile.lang || 'javascript';

  if (goal === 'learn' && languageHasLessons(lang)) {
    // If the student already has a project open, don't spam another tab with
    // a lesson — lessons live in the Lessons tab until they ask for one.
    const hasProjectWork = typeof state !== 'undefined' && (state.project || state.tabs.some((t) => !t.mission));
    if (hasProjectWork) {
      appendConsole('sys', 'Working in your project. Lessons are in the Lessons tab whenever you want one.');
      return;
    }
    const first = EXERCISES.find((m) => m.lang === lang && !state.lessonDone.has(m.id))
      || EXERCISES.find((m) => m.lang === lang)
      || EXERCISES[0];
    openMission(first, { silent: true });
    appendConsole('sys', `Welcome${profile.name ? ', ' + profile.name : ''}. Starting ${first.langLabel}: ${first.title}.`);
    return;
  }

  // Build mode — no course. If the student already has a project or a file
  // open, leave their work alone instead of dropping a stray starter tab.
  const hasWork = typeof state !== 'undefined' && (state.project || state.tabs.some((t) => !t.mission));
  if (hasWork) return;

  openStarter(lang);
  const label = (LANGUAGES.find((l) => l.id === lang) || LANGUAGES[0]).label;
  appendConsole('sys', `Welcome${profile.name ? ', ' + profile.name : ''}. ${label} playground ready — write, Run, then AI Check.`);
}

/* ------------------------------- intro page ------------------------------
   The welcome screen: what CodeClue is, in one screen, before the
   project launcher. Distinct from the splash (loading) and the
   launcher (picking a project).                                     */

const introPage = { open: false, firstRun: false };

function renderWelcomeLangs() {
  const host = document.getElementById('wcLangs');
  if (!host) return;
  host.innerHTML = '';
  for (const l of LANGUAGES) {
    const available = toolFor(l.id);
    const chip = document.createElement('span');
    chip.className = 'wc-lang ' + (available ? 'ok' : 'warn');
    chip.innerHTML =
      `<span class="wc-badge" style="--tone:${l.tone}">${l.badge}</span>` +
      `<span>${l.label}</span>` +
      `<span class="wc-dot" title="${available ? 'Ready on this machine' : 'Toolchain not detected — you can still write code'}"></span>`;
    host.appendChild(chip);
  }
}

function showWelcome(opts = {}) {
  const el = document.getElementById('welcome');
  if (!el) return false;
  introPage.open = true;
  introPage.firstRun = !!opts.firstRun;
  renderWelcomeLangs();
  const start = document.getElementById('wcStart');
  if (start) {
    start.innerHTML = introPage.firstRun
      ? 'Set up your tutor <span aria-hidden="true">→</span>'
      : 'Back to the workspace <span aria-hidden="true">→</span>';
  }
  const skip = document.getElementById('wcSkip');
  if (skip) skip.hidden = !introPage.firstRun;
  el.classList.remove('wc-hidden');
  el.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('wcStart')?.focus(), 220);
  return true;
}

function hideWelcome() {
  const el = document.getElementById('welcome');
  if (!el) return;
  introPage.open = false;
  el.classList.add('wc-hidden');
  el.setAttribute('aria-hidden', 'true');
}

// Leaving the intro page: first run continues into onboarding, otherwise
// it just puts the student back where they were.
function leaveWelcome() {
  if (introPage.firstRun) {
    hideWelcome();
    showOnboarding();
    return;
  }
  hideWelcome();
}

// Skipping everything: the same default profile the onboarding "Skip" uses.
function skipWelcome() {
  hideWelcome();
  intro.selected = { name: 'friend', goal: 'learn', lang: 'javascript' };
  finishOnboarding();
}

function wireWelcome() {
  document.getElementById('wcStart')?.addEventListener('click', leaveWelcome);
  document.getElementById('wcSkip')?.addEventListener('click', skipWelcome);
  document.getElementById('wcClose')?.addEventListener('click', () => {
    if (introPage.firstRun) skipWelcome();
    else hideWelcome();
  });
  // The CodeClue mark in the top bar is a way back to the intro page.
  document.getElementById('brandMark')?.addEventListener('click', () => {
    if (introPage.open) { hideWelcome(); return; }
    showWelcome({ firstRun: false });
  });
  // "What is CodeClue?" on the launcher.
  document.getElementById('plAbout')?.addEventListener('click', () => showWelcome({ firstRun: false }));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && introPage.open && !introPage.firstRun) hideWelcome();
  });
}

/* -------------------------------- splash -------------------------------- */
const splash = {
  raf: 0,
  startedAt: 0,
  animating: false,
  ready: false,
  skipped: false,
};

// Runs the splash animation. Called as soon as this script parses, so the
// student sees motion while Monaco and the toolchains finish loading.
function animateSplash() {
  if (splash.animating) return;
  splash.animating = true;
  splash.startedAt = performance.now();
  splash.skipped = false;
  splash.ready = false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  typeTagline(reduce);
  runSplashBar();
  if (!reduce) startParticles();
}

function startSplash(onDone) {
  const el = document.getElementById('splash');
  if (!el) { onDone(); return; }

  // If a profile already exists, prepare the app behind the splash.
  if (intro.profile) applyProfile(intro.profile);

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  splash.ready = true;
  animateSplash();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    splash.skipped = true;
    cancelAnimationFrame(splash.raf);
    const bar = document.getElementById('splashBar');
    if (bar) bar.style.width = '100%';
    const status = document.getElementById('splashStatus');
    if (status) status.textContent = 'Ready.';
    el.classList.add('splash-out');
    setTimeout(() => {
      el.setAttribute('aria-hidden', 'true');
      el.style.display = 'none';
      onDone();
    }, 520);
  };

  // The animation may already have been running for a while; do not restart it.
  const minMs = reduce ? 700 : Math.max(700, 2700 - (performance.now() - splash.startedAt));
  const timer = setTimeout(finish, minMs);
  const skip = () => { clearTimeout(timer); finish(); };

  document.getElementById('splashSkip')?.addEventListener('click', skip, { once: true });
  const keyHandler = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { skip(); }
  };
  window.addEventListener('keydown', keyHandler);
  el.addEventListener('click', (e) => { if (e.target === el) skip(); });
  // clean the one-shot key listener when done
  const origFinish = finish;
  // eslint-disable-next-line no-func-assign
  onDone = ((fn) => () => { window.removeEventListener('keydown', keyHandler); fn(); })(onDone);
}

function typeTagline(reduce) {
  const el = document.getElementById('splashType');
  if (!el) return;
  const text = 'Learn the idea. See the clue. Build it yourself.';
  if (reduce) { el.textContent = text; return; }
  el.textContent = '';
  let i = 0;
  const tick = () => {
    if (splash.skipped) return;
    el.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(tick, 38);
  };
  setTimeout(tick, 520);
}

function runSplashBar() {
  const bar = document.getElementById('splashBar');
  const status = document.getElementById('splashStatus');
  if (!bar) return;
  const lines = [
    'Waking up the tutor…',
    'Loading Monaco…',
    'Sharpening the clue engine…',
    'Checking your toolchains…',
    'Ready.',
  ];
  let p = 0;
  const tick = () => {
    if (splash.skipped) return;
    // Hold just short of full until Monaco + toolchains are actually ready, so
    // the bar never sits frozen at 100% while the editor is still loading.
    if (p >= 90 && !splash.ready) {
      p = Math.min(97, p + 0.5);
      bar.style.width = p + '%';
      if (status) status.textContent = 'Almost ready…';
      setTimeout(tick, 320);
      return;
    }
    p = Math.min(100, p + 7 + Math.random() * 9);
    bar.style.width = p + '%';
    if (status) status.textContent = lines[Math.min(lines.length - 1, Math.floor(p / 22))];
    if (p < 100) setTimeout(tick, 140);
  };
  setTimeout(tick, 380);
}

function startParticles() {
  const canvas = document.getElementById('splashCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = 0, h = 0;
  const parts = [];
  const glyphs = ['{', '}', '<', '>', '/', ';', '=', '(', ')', '[', ']', '+', '*'];

  function resize() {
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  const count = Math.min(70, Math.round((w * h) / 22000));
  for (let i = 0; i < count; i++) {
    parts.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22, vy: -0.12 - Math.random() * 0.35,
      size: 9 + Math.random() * 13,
      a: 0.05 + Math.random() * 0.16,
      g: glyphs[(Math.random() * glyphs.length) | 0],
      spin: (Math.random() - 0.5) * 0.01,
    });
  }

  let t0 = performance.now();
  function frame(now) {
    if (splash.skipped) return;
    const dt = Math.min(48, now - t0); t0 = now;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < -30) { p.y = h + 20; p.x = Math.random() * w; }
      if (p.x < -30) p.x = w + 20; if (p.x > w + 30) p.x = -20;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = p.a;
      ctx.fillStyle = '#8fb4ff';
      ctx.font = `${p.size}px "JetBrains Mono", monospace`;
      ctx.fillText(p.g, 0, 0);
      ctx.restore();
    }
    // subtle connecting lines
    ctx.globalAlpha = 1;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 110) {
          ctx.strokeStyle = `rgba(91,138,245,${0.05 * (1 - d / 110)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    splash.raf = requestAnimationFrame(frame);
  }
  splash.raf = requestAnimationFrame(frame);
  window.addEventListener('resize', resize, { passive: true });
}

/* ------------------------------- onboarding ------------------------------ */

function showOnboarding(prefill) {
  const el = document.getElementById('onboarding');
  if (!el) return;
  intro.selected = {
    name: prefill?.name || '',
    goal: prefill?.goal || 'learn',
    lang: prefill?.lang || 'javascript',
  };
  intro.step = 0;
  const nameInput = document.getElementById('obName');
  if (nameInput) nameInput.value = intro.selected.name;
  updateNameNext();
  renderGoals();
  renderLangs();
  goStep(0);
  el.classList.remove('ob-hidden');
  el.setAttribute('aria-hidden', 'false');
  setTimeout(() => nameInput?.focus(), 380);
}

function hideOnboarding() {
  const el = document.getElementById('onboarding');
  if (!el) return;
  el.classList.add('ob-hidden');
  el.setAttribute('aria-hidden', 'true');
}

function goStep(n) {
  intro.step = n;
  document.querySelectorAll('.ob-step').forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === n));
  document.querySelectorAll('#obDots span').forEach((d, i) => d.classList.toggle('on', i <= n));
  const body = document.querySelector('.ob-body');
  if (body) body.scrollTop = 0;
}

function updateNameNext() {
  const input = document.getElementById('obName');
  const btn = document.getElementById('obNameNext');
  const err = document.getElementById('obNameError');
  const val = input?.value.trim() || '';
  if (btn) btn.disabled = val.length === 0;
  if (err) err.textContent = '';
}

function renderGoals() {
  document.querySelectorAll('.ob-goal').forEach((b) => {
    b.classList.toggle('selected', b.dataset.goal === intro.selected.goal);
  });
  const next = document.getElementById('obGoalNext');
  if (next) next.disabled = !intro.selected.goal;
}

function toolFor(lang) {
  const tools = (typeof state !== 'undefined' && state.tools) || {};
  if (lang === 'javascript') return true;
  if (lang === 'python') return true;
  if (lang === 'java') return !!(tools.javac && tools.java);
  if (lang === 'c') return !!tools.gcc;
  if (lang === 'cpp') return !!(tools['g++'] || tools.gcc);
  if (lang === 'rust') return !!tools.rustc;
  return false;
}

function renderLangs() {
  const host = document.getElementById('obLangs');
  if (!host) return;
  host.innerHTML = '';
  LANGUAGES.forEach((l) => {
    const available = toolFor(l.id);
    const card = document.createElement('button');
    card.className = 'ob-lang' + (intro.selected.lang === l.id ? ' selected' : '') + (available ? '' : ' unavailable');
    card.dataset.lang = l.id;
    card.innerHTML =
      `<span class="ol-badge" style="--tone:${l.tone}">${l.badge}</span>` +
      `<span class="ol-body">` +
        `<span class="ol-name">${l.label}</span>` +
        `<span class="ol-tag">${l.tag}</span>` +
      `</span>` +
      `<span class="ol-dot ${available ? 'ok' : 'warn'}" title="${available ? 'Ready on this machine' : 'Toolchain not detected — you can still write code'}"></span>`;
    card.addEventListener('click', () => {
      intro.selected.lang = l.id;
      renderLangs();
      const next = document.getElementById('obLangNext');
      if (next) next.disabled = false;
    });
    host.appendChild(card);
  });
  const next = document.getElementById('obLangNext');
  if (next) next.disabled = !intro.selected.lang;
}

function finishOnboarding() {
  const name = (document.getElementById('obName')?.value || intro.selected.name || 'friend').trim() || 'friend';
  const isFirstRun = !intro.profile;
  const profile = {
    name,
    goal: intro.selected.goal || 'learn',
    lang: intro.selected.lang || 'javascript',
    createdAt: intro.profile?.createdAt || Date.now(),
  };
  saveProfile(profile);
  hideOnboarding();
  document.body.classList.add('cc-welcomed');
  // Hand over to the project launcher: create/open a project, or keep learning.
  applyProfile(profile, { open: false });
  if (isFirstRun) {
    window.CodeClueApp?.showLauncher?.({ firstRun: true });
  } else if (profile.goal === 'learn') {
    // Editing the profile later: pick the course back up where it left off.
    openCourse(profile);
  } else {
    // Build mode — keep whatever they were working on; only fill a blank editor.
    openCourse(profile);
  }
}

function wireOnboarding() {
  const nameInput = document.getElementById('obName');
  nameInput?.addEventListener('input', updateNameNext);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!document.getElementById('obNameNext')?.disabled) goStep(1);
    }
  });
  document.getElementById('obNameNext')?.addEventListener('click', () => {
    const name = nameInput?.value.trim() || '';
    if (!name) {
      const err = document.getElementById('obNameError');
      if (err) err.textContent = 'Pick a name first — even a nickname works.';
      nameInput?.focus();
      return;
    }
    intro.selected.name = name;
    goStep(1);
  });

  document.querySelectorAll('.ob-goal').forEach((b) => {
    b.addEventListener('click', () => {
      intro.selected.goal = b.dataset.goal;
      renderGoals();
    });
  });
  document.getElementById('obGoalNext')?.addEventListener('click', () => goStep(2));
  document.getElementById('obLangNext')?.addEventListener('click', () => {
    const name = (nameInput?.value || intro.selected.name || 'friend').trim() || 'friend';
    const ready = document.getElementById('obReadyName');
    if (ready) ready.textContent = name;
    const txt = document.getElementById('obReadyText');
    const langMeta = LANGUAGES.find((l) => l.id === intro.selected.lang) || LANGUAGES[0];
    if (txt) {
      txt.textContent = intro.selected.goal === 'learn' && languageHasLessons(intro.selected.lang)
        ? `Your first ${langMeta.label} lesson is ready. You can switch language or goal any time from your profile.`
        : `A ${langMeta.label} starter file is ready. Write code, press Run, then let AI Check review it.`;
    }
    goStep(3);
  });

  document.querySelectorAll('[data-ob-back]').forEach((b) => {
    b.addEventListener('click', () => goStep(Math.max(0, intro.step - 1)));
  });
  document.getElementById('obStart')?.addEventListener('click', finishOnboarding);
  document.getElementById('obClose')?.addEventListener('click', () => {
    if (intro.profile) { hideOnboarding(); applyProfile(intro.profile); return; }
    intro.selected = { name: 'friend', goal: 'learn', lang: 'javascript' };
    finishOnboarding();
  });

  // Open the profile editor from the topbar chip.
  document.getElementById('profileBtn')?.addEventListener('click', () => {
    showOnboarding(intro.profile || undefined);
  });
}

/* --------------------------------- boot --------------------------------- */

function start() {
  if (intro.started) return;
  intro.started = true;
  updateProfileChip();
  wireOnboarding();
  wireWelcome();
  startSplash(() => {
    if (intro.profile) {
      document.body.classList.add('cc-welcomed');
      // BlueJ-style empty state: with no project open, the launcher asks the
      // student to create or open one before they start working.
      const hasProject = typeof state !== 'undefined' && !!state.project;
      if (!hasProject) window.CodeClueApp?.showLauncher?.();
    } else {
      // First run: the intro page explains the idea before setup starts.
      showWelcome({ firstRun: true });
    }
  });
}

// app.js calls this when toolchain detection finishes, so the availability
// dots in onboarding reflect what is really installed on this machine.
function refreshToolDots() {
  const el = document.getElementById('onboarding');
  if (el && !el.classList.contains('ob-hidden')) renderLangs();
  if (introPage.open) renderWelcomeLangs();
}

// Start the splash animation right away — app.js calls start() once Monaco is
// ready, so the student sees motion instead of a frozen logo while it loads.
animateSplash();

window.CodeClueIntro = {
  start,
  applyProfile,
  openCourse,
  openStarter,
  showOnboarding,
  showWelcome,
  hideWelcome,
  refreshTools: refreshToolDots,
  getProfile: () => intro.profile,
  languages: LANGUAGES,
  starters: STARTERS,
};
