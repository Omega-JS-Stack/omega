/**
 * The onboard test seams on a machine whose git sits beside its gh (ubuntu's
 * /usr/bin, Homebrew's bin): taking gh off PATH keeps git reachable, and a git
 * the seam cannot spawn names the spawn error, never `undefined`.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { git } = require('./onboard-seams.js');
const { activate } = require('./fake-gh.js');

/** The machine's real git, found on PATH before any case narrows it. */
const REAL_GIT = process.env.PATH.split(path.delimiter)
  .map((dir) => path.join(dir, 'git'))
  .find((file) => fs.existsSync(file));

/** A temp dir for one case, removed after it. */
function tempDir(ctx, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Narrow PATH to `entries` for one case, handing the original back after it. */
function usePath(ctx, entries) {
  const previous = process.env.PATH;
  ctx.after(() => { process.env.PATH = previous; });
  process.env.PATH = entries.join(path.delimiter);
}

module.exports = defineCases({
  type: 'group',
  description: 'fake-gh',
  tests: [
    {
      name: 'withoutGh: on a PATH whose only git sits beside gh, gh is not found and git --version still runs',
      run: (ctx) => {
        ctx.expect(REAL_GIT, 'this machine has a git on PATH').toBeTruthy();
        const shared = tempDir(ctx, 'omega-fake-gh-shared-');
        fs.writeFileSync(path.join(shared, 'gh'), '#!/bin/sh\necho "gh version 0.0.0 (shared)"\n', { mode: 0o755 });
        fs.symlinkSync(REAL_GIT, path.join(shared, 'git'));
        usePath(ctx, [shared]);
        const { withoutGh } = activate();

        ctx.after(withoutGh());

        const gh = childProcess.spawnSync('gh', ['--version'], { encoding: 'utf8' });
        ctx.expect(gh.error && gh.error.code, 'gh is off PATH').toBe('ENOENT');
        const version = childProcess.spawnSync('git', ['--version'], { encoding: 'utf8' });
        ctx.expect(version.error, 'git still spawns').toBeUndefined();
        ctx.expect(version.status, version.stderr).toBe(0);
        ctx.expect(version.stdout).toMatch(/^git version /);
      },
    },

    {
      name: 'the seam\'s git: a spawn that cannot start names ENOENT, never undefined',
      run: (ctx) => {
        const dir = tempDir(ctx, 'omega-seam-git-');
        usePath(ctx, [tempDir(ctx, 'omega-no-git-')]);

        let message = null;
        try {
          git(dir, 'init', '-q');
        } catch (error) {
          message = error.message;
        }

        ctx.expect(message, 'the seam throws').toMatch(/^git init -q failed: /);
        ctx.expect(message).toMatch(/ENOENT/);
        ctx.expect(message.includes('undefined'), message).toBe(false);
      },
    },
  ],
});
