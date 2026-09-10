// Build-layer tests for ensure-target's package.json write (#572).
//
// `jetpack.write(path, object)` serializes with no trailing newline, and the write
// rewrote the consumer's package.json unconditionally — so every `npm run build`
// re-stripped the newline npm itself writes, and the
// consumer's lint hook or editor put it back, forever.
//
// setupScripts defaults to the cwd project, so each test stages a
// temp project, chdirs into it, and requires the command fresh — the same model
// as package-task.test.js's inProject().

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SRC        = path.join(__dirname, '..', '..', '..');
const SETUP_PATH = path.join(SRC, 'commands', 'lib', 'ensure-target.js');

const CONSUMER_PKG = {
  name: 'staged-ext',
  version: '3.1.4',
  scripts: { start: 'echo consumer' },
  devDependencies: { '@omega.js/extension': '^0.1.0' },
};

// Stage a temp consumer project holding `pkg`, written the way npm writes it.
function stageProject(pkg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-setup-scripts-'));
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

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'ensure-target — the consumer package.json write',
  tests: [
    {
      name: 'the written package.json ends with exactly one trailing newline (#572)',
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
            ctx.expect(written.scripts.build).toBe('omega build');
            ctx.expect(written.private).toBe(true);
            ctx.expect(contents).toContain('\n  "name": "staged-ext"');
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'an unchanged package.json is not rewritten (#572)',
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
      name: 'a package.json that DID change is written (#572)',
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
            ctx.expect(healed.scripts.build).toBe('omega build');
            ctx.expect(fs.readFileSync(pkgPath, 'utf8').endsWith('}\n')).toBe(true);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a target still carrying the `npx omega` spelling heals to the bare verb (#748)',
      run: async (ctx) => {
        // Package scripts spell the verb bare, web's form — the `npx` prefix
        // is redundant inside a script (npm puts node_modules/.bin on the
        // path) and stays canonical only for docs and the terminal. Every
        // framework-owned key is rewritten on the next verb's ensure pass.
        const tmp = stageProject({
          ...CONSUMER_PKG,
          scripts: { ...CONSUMER_PKG.scripts, test: 'npx omega test', lint: 'npx eslint .' },
        });
        const pkgPath = path.join(tmp, 'package.json');

        try {
          await inProject(tmp, async (setup) => {
            setup.setupScripts();

            const healed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            ctx.expect(healed.scripts.test).toBe('omega test');
            ctx.expect(healed.scripts.build.includes('npx omega')).toBe(false);
            ctx.expect(healed.scripts.lint).toBe('npx eslint .');

            // Converged: the second pass writes nothing at all
            const afterFirst = fs.readFileSync(pkgPath, 'utf8');
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
  ],
});
