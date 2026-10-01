// A staged extension project for the package task's build-layer tests.
//
// The task module reads its project (package.json / config / dist) from cwd at
// REQUIRE time, so each test stages a temp project, chdirs into it, and requires
// the task fresh.
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const SRC       = path.join(__dirname, '..', '..');
const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'package.js');

// Stage a temp extension project. `files` is a relative-path → contents map
// written verbatim (dist/manifest.json, the minted icons, …).
function stageProject(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-package-task-'));

  fs.writeFileSync(path.join(tmp, 'package.json'), opts.pkg ?? `{ "name": "staged-ext", "version": "3.1.4" }`);

  if (opts.config !== undefined) {
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), opts.config);
  }

  for (const [relative, contents] of Object.entries(opts.files || {})) {
    const full = path.join(tmp, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  return tmp;
}

// Run `fn(task)` with cwd pinned to `dir` and the task module loaded fresh.
async function inProject(dir, fn) {
  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(dir);
    return await fn(require(TASK_PATH));
  } finally {
    process.chdir(oldCwd);
    flush();
  }
}

const MANIFEST = (extra) => `{ manifest_version: 3, name: 'Staged', ${extra} }`;

module.exports = { SRC, stageProject, inProject, MANIFEST };
