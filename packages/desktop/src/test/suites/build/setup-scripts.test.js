// Build-layer tests for ensure-target's package.json write (#590, twin of #572).
//
// `jetpack.write(path, object)` serializes with no trailing newline, and the
// write used to happen unconditionally — so every build re-stripped the newline
// npm itself writes, and the consumer's lint hook or editor put it back, forever.
// It matters more since #675: this write now runs on EVERY verb.
//
// setupScripts defaults to the cwd project, so each test stages a temp project,
// chdirs into it, and requires the module fresh.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const SRC        = path.join(__dirname, '..', '..', '..');
const SETUP_PATH = path.join(SRC, 'commands', 'lib', 'ensure-target.js');

const CONSUMER_PKG = {
  name: 'staged-app',
  version: '3.1.4',
  scripts: { start: 'echo consumer' },
  devDependencies: { '@omega.js/desktop': '^0.1.0' },
};

// Stage a temp consumer project holding `pkg`, written the way npm writes it.
function stageProject(pkg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-setup-scripts-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  return tmp;
}

// Run `fn(setup)` with cwd pinned to `dir` and the command module loaded fresh.
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
    return await fn(require(SETUP_PATH));
  } finally {
    process.chdir(oldCwd);
    flush();
  }
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'ensure-target — the consumer package.json write',
  tests: [
    {
      name: 'the written package.json ends with exactly one trailing newline (#590)',
      run: async (ctx) => {
        const tmp = stageProject(CONSUMER_PKG);
        const pkgPath = path.join(tmp, 'package.json');

        try {
          await inProject(tmp, async (setup) => {
            setup.setupScripts();

            const contents = fs.readFileSync(pkgPath, 'utf8');
            ctx.expect(contents.endsWith('}\n')).toBe(true);
            ctx.expect(contents.endsWith('}\n\n')).toBe(false);

            // The framework's project scripts landed, npm's own 2-space shape kept
            const written = JSON.parse(contents);
            ctx.expect(written.scripts.build).toBe('npx omega build');
            ctx.expect(written.private).toBe(true);
            ctx.expect(written.main).toBe('dist/main.bundle.js');
            ctx.expect(contents).toContain('\n  "name": "staged-app"');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'an unchanged package.json is not rewritten (#590)',
      run: async (ctx) => {
        const tmp = stageProject(CONSUMER_PKG);
        const pkgPath = path.join(tmp, 'package.json');

        try {
          await inProject(tmp, async (setup) => {
            setup.setupScripts();
            const afterFirst = fs.readFileSync(pkgPath, 'utf8');

            // Backdate the file: a second setup that writes shows up as a new mtime
            const past = new Date(Date.now() - 60000);
            fs.utimesSync(pkgPath, past, past);

            setup.setupScripts();

            ctx.expect(Math.round(fs.statSync(pkgPath).mtimeMs)).toBe(Math.round(past.getTime()));
            ctx.expect(fs.readFileSync(pkgPath, 'utf8')).toBe(afterFirst);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a package.json that DID change is written (#590)',
      run: async (ctx) => {
        const tmp = stageProject(CONSUMER_PKG);
        const pkgPath = path.join(tmp, 'package.json');

        try {
          await inProject(tmp, async (setup) => {
            setup.setupScripts();

            // A consumer edit setup has to heal — the skip is content-based, not a latch
            const drifted = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            drifted.scripts.build = 'echo hand-edited';
            fs.writeFileSync(pkgPath, `${JSON.stringify(drifted, null, 2)}\n`);

            setup.setupScripts();

            const healed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            ctx.expect(healed.scripts.build).toBe('npx omega build');
            ctx.expect(fs.readFileSync(pkgPath, 'utf8').endsWith('}\n')).toBe(true);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
