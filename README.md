# ◆ CodeClue

**A student-first desktop IDE: VS Code-grade editing with BlueJ pedagogy.**
BlueJ × VS Code, for students.

![status: v0.1.0 MVP][m]

## The idea

One window that gives students *real professional tooling* and a *real tutor*:

| BlueJ heritage                     | VS Code heritage                          |
| ---------------------------------- | ----------------------------------------- |
| **Missions** — guided exercises    | **Monaco editor** — the actual VS Code editor |
| **Clue Coach** — progressive hints (nudge → concept → shape), never the answer | Dark theme, tabs, workspace file tree |
| **Code Pad** — interactively evaluate expressions, BlueJ-style | Run button + live output console (Ctrl+Enter) |
| Checks your *program's output*, not its text | Status bar with detected toolchains |

## Languages

- **JavaScript** — runs inside a sandboxed iframe in-app (zero setup).
- **Python** — runs inside a WebAssembly (Pyodide) worker in-app (one-time internet fetch).
- **C / C++ / Java / Rust** — compiled and run with the real toolchains already
  installed on the machine. The status bar shows exactly what was detected.
- Anything missing is reported honestly ("javac was not detected…"), never silently.

## Run it

```bash
cd CodeClue
npm install
npm start
```

## How it fits together

```
CodeClue/
├── main.js        Electron main: window + toolchain detection + sandboxed
│                  compile/run pipelines + chrooted workspace FS (IPC only)
├── preload.js     The ONLY bridge renderer ↔ OS (contextBridge, narrow API)
└── renderer/
    ├── index.html    Layout shell
    ├── styles.css    Theme (dark, tutor-friendly)
    ├── app.js        Tabs ↔ Monaco models, missions, coach, console, pad
    ├── hint-engine.js Static rule scan → findings with 3-level clue chains
    ├── runners.js     JS sandbox / Pyodide worker / toolchain dispatch
    └── exercises.js   Built-in missions (language-agnostic validators)
```

**Design rules baked into the code**

- The renderer never touches Node directly; every capability is an explicit IPC endpoint
  (`detect-tools`, `run:local`, chroot-guarded workspace file ops).
- Student processes always run in a fresh temp dir with a hard timeout;
  JIT-generated files are cleaned up in `finally`.
- Hint engine is *static* — it observes code, it never executes it.
- Mission validators check program *output*, never the source text
  (so a correct program in any style passes).
- Clues are shaped as Nudge → Concept → Shape: the last one is a skeleton with
  the interesting part left blank, not a copy-paste answer.

## Roadmap (in rough order of value)

1. `input()` / stdin support in the sandbox (pre-fed input per mission).
2. Object Bench: BlueJ-style panel where you construct a class and call its
   methods interactively (Code Pad already prototypes this).
3. Per-mission tests à la JUnit, shown as a checklist.
4. Electron-builder packaging for Windows/macOS/Linux installers.
5. Hardening pass: CSP, sandboxed `frame.saveAs`-style API, signed releases.
6. More languages via the same `PIPELINES` registry in `main.js` (Go, Kotlin…).
7. Hint engine: real parsers (acorn for JS, ast for Python) to replace regex heuristics.

## Known limitations (v0.1)

- Python engine downloads once from the Pyodide CDN (then it's cached).
- Monaco's TypeScript service needs the loopback HTTP server the app starts
  automatically — that's exactly why the preview of the renderer is not `file://`.
- The static hint engine is heuristic (regex + balanced-bracket scanning),
  deliberately conservative: it only flags high-confidence patterns.
- Skill level of clues is fixed; adaptivity to the student is future work.
