/**
 * paths.js — the packaged content locations the engine and build entry
 * points default to, and the @omega.js/client entry resolution the esbuild
 * alias points at. Every path must exist IN the package (a published tarball
 * ships them under `files`), and the client resolution must fail with the
 * reinstall instruction rather than a bare MODULE_NOT_FOUND.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { PATHS, resolveClientEntry } = require('../src/paths.js');

const PKG = path.resolve(__dirname, '..');

module.exports = defineCases({
  type: 'group',
  description: 'paths',
  tests: [
    {
      name: 'PATHS points at the packaged dirs, all of which exist',
      run: (ctx) => {
        ctx.expect(PATHS).toEqual({
          themes: path.join(PKG, 'themes'),
          core: path.join(PKG, 'core'),
          defaults: path.join(PKG, 'defaults'),
          scaffold: path.join(PKG, 'scaffold'),
          runtime: path.join(PKG, 'runtime'),
          translations: path.join(PKG, 'translations'),
        });

        for (const [name, dir] of Object.entries(PATHS)) {
          ctx.expect(fs.existsSync(dir), `${name} dir ships in the package`).toBeTruthy();
          ctx.expect(fs.statSync(dir).isDirectory(), `${name} is a directory`).toBeTruthy();
        }
      },
    },

    {
      name: 'every packaged dir is declared in package.json files — a tarball must carry them',
      run: (ctx) => {
        const files = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).files;

        for (const name of Object.keys(PATHS)) {
          ctx.expect(files.includes(`${name}/`), `${name}/ is published`).toBeTruthy();
        }
      },
    },

    {
      name: 'resolveClientEntry resolves the @omega.js/client entry module',
      run: (ctx) => {
        const entry = resolveClientEntry();

        ctx.expect(path.isAbsolute(entry)).toBe(true);
        ctx.expect(fs.existsSync(entry)).toBe(true);
        ctx.expect(entry).toBe(require.resolve('@omega.js/client'));
      },
    },

    {
      name: 'an unresolvable client tells the consumer to reinstall, not MODULE_NOT_FOUND',
      run: (ctx) => {
        // Prove the catch branch against the REAL resolver: the module runs from a
        // temp dir outside any node_modules tree, so @omega.js/client genuinely
        // cannot resolve — the missing-install condition, not a stubbed one.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-paths-'));
        ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
        fs.copyFileSync(path.join(PKG, 'src', 'paths.js'), path.join(dir, 'paths.js'));

        const result = spawnSync(process.execPath, [
          '-e',
          `require(${JSON.stringify(path.join(dir, 'paths.js'))}).resolveClientEntry()`,
        ], { cwd: dir, encoding: 'utf8' });

        ctx.expect(result.status).toBe(1);
        ctx.expect(result.stderr).toMatch(/reinstall @omega\.js\/web \(npm install\) and retry/);
        ctx.expect(result.stderr).not.toMatch(/MODULE_NOT_FOUND/);
      },
    },
  ],
});
