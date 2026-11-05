// CodeClue hint engine — progressive, never-solve-it-for-you clues.
// Static rule scan (no execution): each finding carries a 3-level clue chain:
//   1 Nudge   — points at the right idea
//   2 Concept — explains the idea precisely
//   3 Example — shows the SHAPE (never the mission's full answer)

'use strict';

/* ---------- small scanners (string-aware, comments skipped) ---------- */

function balanceScan(code, pairs) {
  const openers = {};
  const closers = {};
  for (const [o, c] of pairs) {
    openers[o] = c;
    closers[c] = o;
  }
  const stack = [];
  let inS = null; // ' string quote char
  let escNext = false; // the previous char was a backslash inside a string
  let inLine = false;
  let inBlock = false;
  let prev = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (inLine) {
      if (c === '\n') inLine = false;
      prev = c;
      continue;
    }
    if (inBlock) {
      if (prev === '*' && c === '/') inBlock = false;
      prev = c;
      continue;
    }
    if (inS) {
      if (escNext) { escNext = false; prev = c; continue; }
      if (c === '\\') { escNext = true; prev = c; continue; }
      if (c === inS) inS = null;
      prev = c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c; prev = c; continue; }
    if (c === '/' && code[i + 1] === '/') { inLine = true; prev = c; continue; }
    if (c === '/' && code[i + 1] === '*') { inBlock = true; prev = c; i++; continue; }
    if (c === '#' && pairs.some((p) => p[0] === '') === false && langIsHash(code, i, prev)) {
      // python-style comment
      inLine = true;
      prev = c;
      continue;
    }
    if (openers[c]) stack.push({ c, line: countLines(code, i) });
    else if (closers[c]) {
      const top = stack.pop();
      if (!top || openers[top.c] !== c) {
        return { ok: false, line: countLines(code, i), stray: c };
      }
    }
    prev = c;
  }
  return { ok: stack.length === 0, line: stack.length ? stack[stack.length - 1].line : null, unclosed: stack.length ? stack[stack.length - 1].c : null };
}

function langIsHash(code, i) {
  // '#' starts a comment only in Python-ish code (very rough file-level heuristic)
  return code.includes('def ') || code.includes('import ') || code.includes('#') === true;
}

function countLines(code, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < code.length; i++) if (code[i] === '\n') n++;
  return n;
}

function balanceParens(code, pairs) {
  return balanceScan(code, pairs);
}

/* ---------- JS rules ---------- */

function findFunctions(code, lang) {
  const fns = [];
  const re = lang === 'js'
    ? /function\s+([A-Za-z_$][\w$]*)\s*\(/g
    : /def\s+([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) fns.push({ name: m[1], idx: m.index });
  return fns;
}

const JS_RULES = [
  {
    id: 'js-infinite-while',
    severity: 'error',
    detect(code) {
      const m = /while\s*\(\s*(true|1)\s*\)/.exec(code);
      if (!m || /\bbreak\b/.test(code)) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: "You wrote a loop condition that's always true, and this program never breaks out of it. What should eventually make the loop stop?" },
      { label: 'Concept', text: 'while (true) is fine IF something inside the loop can end it: a break statement when a goal is reached, or changing the variable the condition checks. Every loop needs an exit — a value that changes each pass.' },
      { label: 'Example', text: 'Structure to imitate (with your own stopping goal):', snippet: 'while (true) {\n  // ...work...\n  if (/* stopping goal reached */) {\n    break;\n  }\n}' },
    ],
  },
  {
    id: 'js-assign-in-if',
    severity: 'error',
    detect(code) {
      const m = /\b(if|while)\s*\(\s*[A-Za-z_$][\w$]*\s*=\s*[^=]/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: 'Look very closely at the condition — you may be changing a variable where you meant to compare two values.' },
      { label: 'Concept', text: '= puts a value INTO a variable. === asks "are these equal?". Inside if (...) you almost always want a question, not an assignment. One stray = silently turns the condition into a truthy value and the branch always runs.' },
      { label: 'Example', text: 'Comparison uses two (or three) equal signs:*', snippet: 'if (guess === answer) {\n  // ran when the values are equal\n}' },
    ],
  },
  {
    id: 'js-off-by-one',
    severity: 'error',
    detect(code) {
      const m = /(?:<=|>=)\s*[A-Za-z_$][\w$]*\.(?:length|size)/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: "You compare something with <= a collection's length. In JS that visits one index too far — remember the first index." },
      { label: 'Concept', text: 'Array indexes start at 0, so the LAST valid index is length - 1. Use < length (or <= length - 1) when looping over indexes.' },
      { label: 'Example', text: 'The safe classic shape:', snippet: 'for (let i = 0; i < arr.length; i++) {\n  // arr[i] is always a real element here\n}' },
    ],
  },
  {
    id: 'js-no-base-case',
    severity: 'warn',
    detect(code) {
      for (const fn of findFunctions(code, 'js')) {
        const calls = new RegExp(`\\b${fn.name}\\s*\\(`, 'g');
        // crude body slice: from fn to next top-level "function " or EOF
        let bodyEnd = code.length;
        for (const other of findFunctions(code, 'js')) {
          if (other.idx > fn.idx) { bodyEnd = other.idx; break; }
        }
        const body = code.slice(fn.idx, bodyEnd);
        const selfCall = new RegExp(`\\b${fn.name}\\s*\\(`, 'g');
        selfCall.lastIndex = body.indexOf(fn.name) + 1;
        if (body.slice(body.indexOf(')') + 1).match(selfCall)) {
          const hasGuard = /\breturn\b/.test(body) && /\bif\b/.test(body);
          if (!hasGuard) {
            return { line: countLines(code, fn.idx), fn: fn.name };
          }
        }
      }
      return null;
    },
    clues: [
      { label: 'Nudge', text: (f) => `The function ${f.fn} calls itself — that's recursion! Does it have a way to stop calling itself?` },
      { label: 'Concept', text: 'Every recursive function needs a base case: the simplest input where it answers directly WITHOUT calling itself. Each recursive call should move the input toward that base case, or the calls never end.' },
      { label: 'Example', text: 'The two-ingredient recipe (base case first, recursive step second):', snippet: 'function countdown(n) {\n  if (n <= 0) {\n    return;              // base case: stop here\n  }\n  console.log(n);\n  return countdown(n - 1); // step closer to base\n}' },
    ],
  },
  {
    id: 'js-var',
    severity: 'tip',
    detect(code) {
      const m = /\bvar\s+[A-Za-z_$]/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: 'You used var. Modern JavaScript has two better keywords for making variables.' },
      { label: 'Concept', text: 'let makes a variable that can be reassigned; const makes one that can\'t. They behave more predictably than var (block-scoped instead of function-scoped), which is why nearly all modern code uses them.' },
      { label: 'Example', text: 'Choose like this:', snippet: 'let tries = 0;        // will change\nconst name = "Ada";    // will not' },
    ],
  },
];

/* ---------- Python rules ---------- */

const PY_RULES = [
  {
    id: 'py-print-no-paren',
    severity: 'error',
    detect(code) {
      const m = /^\s*print\s+[^(=\s]/m.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: "On that print line something's missing that Python 3 requires around everything you print." },
      { label: 'Concept', text: 'In Python 3, print is a function, and functions are called with parentheses — even when printing a bare variable.' },
      { label: 'Example', text: 'Always wrap the thing being printed:', snippet: 'x = 42\nprint(x)\nprint("score:", x)' },
    ],
  },
  {
    id: 'py-missing-colon',
    severity: 'error',
    detect(code) {
      const lines = code.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const t = raw.trim();
        if (!t || t.startsWith('#')) continue;
        const body = t.split('#')[0].trim(); // strip trailing comments
        if (!body || /(\\|,|\(|\[)\s*$/.test(body)) continue; // continuation
        if (!/^(def|if|elif|else|for|while|try|except|finally|with|class)\b/.test(body)) continue;
        if (/^\w+\s*=/.test(body)) continue; // an assignment, not a real header
        // e.g. "if x: print(x)" — a valid one-liner whose colon is mid-line.
        if (/:/.test(body)) continue;
        return { line: i + 1 };
      }
      return null;
    },
    clues: [
      { label: 'Nudge', text: "That block-opening line is missing the character every def/if/for/while/... header ends with." },
      { label: 'Concept', text: 'In Python, a colon : ends the header line and says "the indented body below belongs to this statement". It is required, not decorative.' },
      { label: 'Example', text: 'Header + indented body:', snippet: 'if score > 10:\n    print("You win!")' },
    ],
  },
  {
    id: 'py-tab-space-mix',
    severity: 'error',
    detect(code) {
      const lines = code.split('\n');
      const usesTab = lines.some((l) => /^\t/.test(l));
      const usesSpaces = lines.some((l) => /^ {2,}/.test(l));
      return usesTab && usesSpaces ? { line: null } : null;
    },
    clues: [
      { label: 'Nudge', text: 'Your file mixes two different indentation styles, and Python refuses to guess which is real.' },
      { label: 'Concept', text: 'In Python indentation IS structure. Pick one style everywhere — 4 spaces is the standard (editors auto-insert it) — and never mix tabs with spaces.' },
      { label: 'Example', text: 'One style, consistently:', snippet: 'if ok:\n    start()      # 4 spaces\n    log("go")    # 4 spaces again' },
    ],
  },
  {
    id: 'py-mutable-default',
    severity: 'warn',
    detect(code) {
      const m = /def\s+\w+\s*\([^)]*=\s*(\[\]|\{\})/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: 'A function here uses a "default list/dict" that will behave surprisingly across calls.' },
      { label: 'Concept', text: "Default argument values are created ONCE, when the function is defined — not at each call. A default [] is therefore one shared list that remembers everything appended to it." },
      { label: 'Example', text: 'The safe pattern:', snippet: 'def add_item(item, items=None):\n    if items is None:\n        items = []\n    items.append(item)\n    return items' },
    ],
  },
  {
    id: 'py-range-len-tip',
    severity: 'tip',
    detect(code) {
      const m = /for\s+\w+\s+in\s+range\(\s*len\(/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: "There's a more direct way to loop over that collection than indexing through range(len(...))." },
      { label: 'Concept', text: 'Python loops over items directly. If you also need the position, enumerate gives index and item together — usually clearer than range(len(x)).' },
      { label: 'Example', text: 'Both common shapes:', snippet: 'for item in things:\n    print(item)\n\nfor i, item in enumerate(things):\n    print(i, item)' },
    ],
  },
  {
    id: 'py-str-num-compare',
    severity: 'error',
    detect(code) {
      const m = /(input\(\)\s*[<>]=?\s*\d|\d\s*[<>]=?\s*input\(\))/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: "You're comparing something that came from input() with a number — but they're different kinds of values." },
      { label: 'Concept', text: 'input() always returns a STRING like "5", never the number 5. Convert with int("5") (or float) before comparing or doing math.' },
      { label: 'Example', text: 'Convert first, then compare:', snippet: 'guess = int(input("Guess: "))\nif guess < 10:\n    print("higher!")' },
    ],
  },
  {
    id: 'py-assign-in-if',
    severity: 'error',
    detect(code) {
      const m = /\b(?:if|while)\s+([A-Za-z_]\w*)\s*=(?!=)/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: 'That condition looks like it changes a variable instead of asking a question — Python will refuse to even run this file.' },
      { label: 'Concept', text: 'In Python, = assigns and == asks "are these equal?". Inside if(...) or while(...) you want the question form; a single = there is a SyntaxError by design.' },
      { label: 'Example', text: 'The comparison form:', snippet: 'if guess == target:\n    print("correct!")' },
    ],
  },
  {
    id: 'py-while-true-nobreak',
    severity: 'error',
    detect(code) {
      const m = /while\s+True\s*:/.exec(code);
      if (!m || /\bbreak\b/.test(code)) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: 'This loop repeats forever — what condition should let it finally stop?' },
      { label: 'Concept', text: 'while True runs until it meets a break. Give the loop a stopping goal and check for it inside the body.' },
      { label: 'Example', text: 'Exit ramp inside the loop:', snippet: 'while True:\n    cmd = input("> ")\n    if cmd == "stop":\n        break\n    print("doing:" + cmd)' },
    ],
  },
];

/* ---------- generic rules ---------- */

const GENERIC_RULES = [
  {
    id: 'gen-unbalanced',
    severity: 'error',
    pairs: null, // filled per language
    detect(code, lang, pairs) {
      const res = balanceParens(code, pairs);
      if (res.ok) return null;
      return res.stray === undefined
        ? { line: res.line, unclosed: res.unclosed }
        : { line: res.line, stray: res.stray };
    },
    clues: [
      { label: 'Nudge', text: 'Somewhere a bracket opens without its partner. Count your opening and closing symbols on the flagged line — and one above it for good measure.' },
      { label: 'Concept', text: 'Brackets come in pairs: ( ), [ ], { }. Editors pair up: when you open one, the matching one appears; when you delete, delete both at once. Readable indentation also makes mismatches visible: each nested level shifts right by the same amount.' },
      { label: 'Example', text: 'Balanced nesting looks like this:', snippet: 'if (ready) {\n  show(menu);\n}\n' },
    ],
  },
  {
    id: 'gen-todo',
    severity: 'tip',
    detect(code) {
      const m = /\/\/\s*(TODO|FIXME)|#\s*(TODO|FIXME)/.exec(code);
      if (!m) return null;
      return { line: countLines(code, m.index) };
    },
    clues: [
      { label: 'Nudge', text: 'A TODO is still waiting on that line — small steps finished one by one beat a blank program.' },
      { label: 'Concept', text: 'Treat every TODO as the smallest runnable next step. Write one line, run, see it work, repeat. Running tiny slices is how real programmers stay unstuck.' },
      { label: 'Example', text: 'Starter for the discipline:', snippet: '// TODO: print the first item, run it, THEN add the loop' },
    ],
  },
];

/* ---------------------------------------------------------- entry point */

const LANGS = {
  js: {
    rules: JS_RULES,
    pairsFor: [ ['(', ')'], ['[', ']'], ['{', '}'] ],
  },
  python: {
    rules: PY_RULES,
    pairsFor: [ ['(', ')'], ['[', ']'] ],
  },
  other: {
    rules: GENERIC_RULES,
    pairsFor: [ ['(', ')'], ['[', ']'], ['{', '}'] ],
  },
};

/**
 * Analyze source text for a language ('js' | 'python' | other).
 * Returns findings: {id, severity, line, extra, title, clues}
 */
function analyze(code, lang) {
  const set = LANGS[lang] || LANGS.other;
  const findings = [];
  if (!code.trim()) return findings;
  for (const rule of [...set.rules, ...LANGS.other.rules.filter((r) => !set.rules.includes(r))]) {
    let hit = null;
    try {
      hit = rule.detect(code, lang, rule.pairs || set.pairsFor);
    } catch {
      hit = null;
    }
    if (!hit) continue;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      line: hit.line ?? null,
      extra: hit,
      title: TITLES[rule.id] || rule.id,
      clues: rule.clues,
    });
  }
  const order = { error: 0, warn: 1, tip: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return findings;
}

const TITLES = {
  'js-infinite-while': 'Loop may never stop',
  'js-assign-in-if': 'Assignment inside a condition?',
  'js-off-by-one': 'Possible off-by-one compare',
  'js-no-base-case': 'Recursion with no visible exit',
  'js-var': 'Prefer let / const over var',
  'py-print-no-paren': 'print() needs parentheses',
  'py-missing-colon': 'Block header missing its colon',
  'py-tab-space-mix': 'Tabs and spaces are mixed',
  'py-mutable-default': 'Mutable default argument',
  'py-range-len-tip': 'range(len(...)) can usually be simpler',
  'py-str-num-compare': 'Comparing text with a number',
  'py-assign-in-if': 'Assignment inside a condition?',
  'py-while-true-nobreak': 'while True with no exit',
  'gen-unbalanced': 'Unbalanced brackets',
  'gen-todo': 'TODO still open',
};
