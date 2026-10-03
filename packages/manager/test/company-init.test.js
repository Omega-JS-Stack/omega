/**
 * `omega company init`: the one command that creates a company's shared tree
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)). Real files in
 * temp dirs, no mocks: it refuses a brand that is not the company, it
 * scaffolds `company/` INSIDE the company brand with the shape the ONE
 * resolver reads (config layer, `.env`, gitignore, signing tree, templates),
 * a rerun is a byte-level no-op, and a brand naming the company really does
 * inherit through the REAL loader.
 *
 * Every fixture points OMEGA_HOME at its own temp home: a test must never
 * read or write the developer's real machine registry.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');
const jetpack = require('fs-jetpack');
const { loadConfig, recordBrand } = require('@omega.js/config');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677). Tests that need their own
// home still override it per test.
require('@omega.js/devkit/test/temp-home');

const { runCompanyInit } = require('../src/company-init.js');
const { loadBrand } = require('../src/lib/brand.js');
const { DEFAULTS } = require('../src/config.js');

const companyCommand = require('../src/commands/company.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpdir(prefix = 'omega-company-init-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run fn with console.log/error captured; returns the joined lines. */
function captureOutput(fn) {
  const lines = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    return { result: fn(), text: lines.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** Every file in a tree → relative path → { contents, mtimeMs }. */
function snapshot(root) {
  const snap = new Map();
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    snap.set(path.relative(root, file), {
      contents: fs.readFileSync(file, 'utf8'),
      mtimeMs: fs.statSync(file).mtimeMs,
    });
  }
  return snap;
}

/** Point the machine registry at this test's own home. */
function useHome(t, dir) {
  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(dir, 'home');
  t.after(() => {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });
}

/** A brand monorepo; `company` is the authored key, when it has one. */
function stageBrand(parentDir, dirName, company) {
  const root = path.join(parentDir, dirName);
  jetpack.write(path.join(root, 'package.json'), JSON.stringify({ name: dirName, private: true, workspaces: ['targets/*'] }, null, 2));
  jetpack.write(
    path.join(root, 'config', 'omega.json5'),
    `{\n  brand: { id: '${dirName}', name: '${dirName} brand', url: 'https://${dirName}.com' },\n`
    + `${company ? `  company: { id: '${company}' },\n` : ''}`
    + '  targets: { web: { type: \'web\' } },\n}\n',
  );
  return root;
}

module.exports = defineCases({
  type: 'group',
  description: 'company-init',
  tests: [
    // ─── init ────────────────────────────────────────────────────────────────────

    {
      name: 'company init: one command scaffolds the tree inside the company brand',
      run: (ctx) => {
        const dir = tmpdir();
        useHome(ctx, dir);
        const root = stageBrand(dir, 'fixture-co', 'self');

        const { result } = captureOutput(() => runCompanyInit(root));

        ctx.expect(result.brandRoot).toBe(root);
        ctx.expect(result.companyDir).toBe(path.join(root, 'company'));
        ctx.expect(result.created.sort()).toEqual([
          '.env',
          '.gitignore',
          'README.md',
          path.join('config', 'omega.json5'),
        ].sort());
        ctx.expect(result.kept).toEqual([]);
        // The committed files carry no em dash. The .env is gitignored and its group
        // headers are the env schema's, so only its own header is pinned below.
        for (const relative of result.created.filter((file) => file !== '.env')) {
          ctx.expect(fs.readFileSync(path.join(root, 'company', relative), 'utf8').includes('\u2014'), `${relative} carries no em dash`).toBe(false);
        }

        // The config LAYER: brand-agnostic placeholders only, no brand, no targets,
        // nothing about the parent brand the tree sits inside
        const config = JSON5.parse(fs.readFileSync(path.join(root, 'company', 'config', 'omega.json5'), 'utf8'));
        ctx.expect(config).toEqual({});

        // The .env carries placeholders only: the same canonical shape a brand .env
        // has, and not one key set
        const env = fs.readFileSync(path.join(root, 'company', '.env'), 'utf8');
        ctx.expect(env, 'the canonical groups render as commented placeholders').toMatch(/^# APPLE_API_ISSUER=""$/m);
        ctx.expect(env.split('\n\n')[0].includes('\u2014'), 'the .env header carries no em dash').toBe(false);
        ctx.expect(env.split('\n').filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).length, 'not one key is set').toBe(0);

        // The unshareable half can never be committed, whatever the root file says
        const entries = fs.readFileSync(path.join(root, 'company', '.gitignore'), 'utf8')
          .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
        ctx.expect(entries).toEqual(['.env', '.env.*', '.omega/']);
        ctx.expect(fs.readFileSync(path.join(root, 'company', '.gitignore'), 'utf8'), 'the marked file the workspace service heals').toBe(require('../src/lib/gitignore.js').renderCompanyGitignore());

        // The signing tree and the shared templates have an obvious home from minute one
        for (const relative of ['.omega/certificates/apple/certificates', '.omega/certificates/apple/csr', 'assets/templates']) {
          ctx.expect(jetpack.exists(path.join(root, 'company', relative)), `${relative} is scaffolded`).toBe('dir');
        }

        ctx.expect(fs.readFileSync(path.join(root, 'company', 'README.md'), 'utf8')).toMatch(/company layer/i);
      },
    },

    {
      name: 'company init: refuses a brand that is not the company',
      run: (ctx) => {
        const dir = tmpdir();
        useHome(ctx, dir);

        const standalone = stageBrand(dir, 'plain-brand');
        ctx.expect(() => captureOutput(() => runCompanyInit(standalone))).toThrow(/Set company: \{ id: "self" \} in config\/omega\.json5 first/);
        ctx.expect(jetpack.exists(path.join(standalone, 'company')), 'nothing was written').toBe(false);

        const child = stageBrand(dir, 'child-brand', 'fixture-co');
        ctx.expect(() => captureOutput(() => runCompanyInit(child))).toThrow(/Set company: \{ id: "self" \}/);

        ctx.expect(() => captureOutput(() => runCompanyInit(tmpdir('omega-company-bare-')))).toThrow(/No brand found at or above/);
      },
    },

    {
      name: 'company init: a rerun fills gaps only, not one byte rewritten',
      run: (ctx) => {
        const dir = tmpdir();
        useHome(ctx, dir);
        const root = stageBrand(dir, 'fixture-co', 'self');
        captureOutput(() => runCompanyInit(root));

        // The operator's own edits (and their own files) must survive a rerun
        const layerPath = path.join(root, 'company', 'config', 'omega.json5');
        fs.writeFileSync(layerPath, '{ monitoring: { providers: { sentry: { org: "fixture-co" } } } }\n');
        jetpack.write(path.join(root, 'company', '.omega', 'certificates', 'apple', 'AuthKey_ABC123.p8'), 'not-a-real-key');
        const before = snapshot(root);

        const { result } = captureOutput(() => runCompanyInit(root));

        ctx.expect(result.created, 'nothing was created the second time').toEqual([]);
        ctx.expect(result.kept.length, 'every scaffolded file was kept').toBe(4);
        ctx.expect(result.dirs, 'the tree already existed').toEqual([]);
        ctx.expect(snapshot(root), 'a rerun is a byte-level (and mtime-level) no-op').toEqual(before);
      },
    },

    {
      name: 'company init: a missing piece is refilled without touching the rest',
      run: (ctx) => {
        const dir = tmpdir();
        useHome(ctx, dir);
        const root = stageBrand(dir, 'fixture-co', 'self');
        captureOutput(() => runCompanyInit(root));

        jetpack.remove(path.join(root, 'company', '.env'));
        jetpack.remove(path.join(root, 'company', '.omega'));
        const before = snapshot(root);

        const { result } = captureOutput(() => runCompanyInit(root));

        ctx.expect(result.created).toEqual(['.env']);
        ctx.expect(result.dirs).toEqual(['.omega/certificates/apple/certificates', '.omega/certificates/apple/csr']);
        for (const [file, state] of before) {
          ctx.expect(snapshot(root).get(file), `${file} was left alone`).toEqual(state);
        }
      },
    },

    {
      name: 'company init: what it scaffolds is what a brand of the company inherits',
      run: (ctx) => {
        const dir = tmpdir();
        useHome(ctx, dir);
        const companyBrand = stageBrand(dir, 'fixture-co', 'self');
        captureOutput(() => runCompanyInit(companyBrand));

        // The operator fills the layer the command just created
        fs.writeFileSync(
          path.join(companyBrand, 'company', 'config', 'omega.json5'),
          '{ monitoring: { providers: { sentry: { org: "fixture-co" } } } }\n',
        );
        fs.writeFileSync(path.join(companyBrand, 'company', '.env'), 'SENDGRID_API_KEY="company"\n');

        // The registry line the company brand's own run writes
        recordBrand({ id: 'fixture-co', root: companyBrand, name: 'fixture-co brand', url: 'https://fixture-co.com' });

        const child = stageBrand(dir, 'child-brand', 'fixture-co');

        const viaManager = loadBrand(child).config;
        const direct = loadConfig(child, undefined, { defaults: DEFAULTS }).config;

        ctx.expect(viaManager.monitoring.providers.sentry.org, 'the company layer fills the gap').toBe('fixture-co');
        ctx.expect(viaManager.brand.name, 'the brand still wins over the company default').toBe('child-brand brand');
        ctx.expect(direct.company.name, "the child's company section carries the parent's facts").toBe('fixture-co brand');
      },
    },

    // ─── The verb ────────────────────────────────────────────────────────────────

    {
      name: 'company: the CLI verb runs init in the cwd and names its surface otherwise',
      run: async (ctx) => {
        const dir = tmpdir();
        useHome(ctx, dir);
        const root = stageBrand(dir, 'fixture-co', 'self');
        const priorExitCode = process.exitCode;
        const cwd = process.cwd();

        process.chdir(root);
        ctx.after(() => process.chdir(cwd));

        await captureOutput(() => companyCommand({ _: ['company', 'init'] })).result;
        ctx.expect(jetpack.exists(path.join(root, 'company', 'config', 'omega.json5')), '`omega company init` scaffolds the brand it runs in').toBe('file');

        const bogus = captureOutput(() => companyCommand({ _: ['company', 'adopt'] }));
        await bogus.result;
        ctx.expect(bogus.text).toMatch(/Unknown company command/);
        ctx.expect(bogus.text).toMatch(/init/);
        ctx.expect(process.exitCode, 'an unknown subcommand fails loudly').toBe(1);

        process.exitCode = priorExitCode;
      },
    },
  ],
});
