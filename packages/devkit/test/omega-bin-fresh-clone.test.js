/**
 * The fresh brand-template clone, end to end
 * ([#908](https://github.com/Omega-JS-Stack/omega/issues/908)).
 *
 * The report: clone `Omega-JS-Stack/brand-template` (a README and nothing
 * else), `npm i --save-dev @omega.js/manager`, run the template's own
 * `npx omega onboard`, and the BACKEND's CLI answered `Unknown command`. The
 * manager depends on @omega.js/backend, so npm's hoist put the backend's file
 * behind `node_modules/.bin/omega`, and the dispatcher's contextless lane ran
 * the host it found there instead of the installed manager.
 *
 * Real files, real process: the bin file npm would link, the manager package as
 * it really ships, and the clone's own cwd. Both packages run from their built
 * dist/ here (that is what a published install carries), so a monorepo checkout
 * needs its `npm run prepare` before this case is meaningful.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGES = path.join(__dirname, '..', '..');
const BACKEND_BIN = path.join(PACKAGES, 'backend', 'bin', 'omega');
const MANAGER_PKG = path.join(PACKAGES, 'manager');

/**
 * A brand-template clone with @omega.js/manager installed and the BACKEND's bin
 * file behind node_modules/.bin/omega, exactly as npm's hoist left it.
 * @returns {string} The clone directory.
 */
function stageFreshClone() {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fresh-clone-'));
  fs.mkdirSync(path.join(clone, '.git'), { recursive: true }); // bound the dispatcher's walk
  fs.writeFileSync(
    path.join(clone, 'package.json'),
    JSON.stringify({ name: 'notifly-omega', private: true, devDependencies: { '@omega.js/manager': '*' } })
  );

  fs.mkdirSync(path.join(clone, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(MANAGER_PKG, path.join(clone, 'node_modules', '@omega.js', 'manager'), 'dir');
  fs.mkdirSync(path.join(clone, 'node_modules', '.bin'), { recursive: true });
  fs.symlinkSync(BACKEND_BIN, path.join(clone, 'node_modules', '.bin', 'omega'));

  return clone;
}

module.exports = defineCases({
  type: 'group',
  description: 'omega-bin-fresh-clone',
  tests: [
    {
      name: 'bin: `omega onboard` in a fresh clone reaches the MANAGER, even when the backend won the bin link (#908)',
      run: (ctx) => {
        const clone = stageFreshClone();

        // --help keeps the run print-only: the wizard itself prompts and writes.
        const out = spawnSync(process.execPath, [path.join(clone, 'node_modules', '.bin', 'omega'), 'onboard', '--help'], {
          cwd: clone,
          encoding: 'utf8',
          // The local-dist freshness heal can rebuild and re-exec; a monorepo-dev
          // convenience, not part of this contract.
          env: Object.assign({}, process.env, { OMEGA_SKIP_FRESHNESS: '1' }),
        });

        ctx.expect(out.status, `the clone's omega bin exited ${out.status}\n${out.stderr}`).toBe(0);
        ctx.expect(out.stderr, 'the backend CLI must never see a manager verb').not.toMatch(/Unknown command/);
        ctx.expect(out.stdout).not.toMatch(/Unknown command/);
        ctx.expect(out.stdout, 'the manager\'s own help answered').toMatch(/brand orchestration/);
        ctx.expect(out.stdout, 'the verb the template README tells a stranger to run').toMatch(/omega onboard/);
        ctx.expect(out.stderr).toMatch(/no target context found from [\s\S]*running @omega\.js\/manager/);

        fs.rmSync(clone, { recursive: true, force: true });
      },
    },
  ],
});
