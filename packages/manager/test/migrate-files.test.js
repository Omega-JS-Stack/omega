/**
 * Brand-root `omega migrate` over EVERY authored file the loader reads: the
 * brand's omega.json5 and its environment overlays, each target's own omega
 * files, and every `.env` the cascade reads (the brand root's and each
 * target's), one report block per file. Nothing outside the brand is touched.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const { write, stageBrand, runMigrate, block } = require('./lib/migrate-harness.js');
const { renameEnvKey } = require('../src/migrate/env-pass.js');

const BASE = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' } },
}
`;

// A web target whose framework leg has nothing to do, so the config and .env
// blocks are the whole story
function stageWithWebTarget() {
  const brand = stageBrand(BASE);
  write(path.join(brand, 'targets', 'web', 'package.json'), { name: 'web', private: true, dependencies: { '@omega.js/web': '*' } });
  const framework = path.join(brand, 'node_modules', '@omega.js', 'web');
  write(path.join(framework, 'package.json'), { name: '@omega.js/web', exports: { './migrate': './migrate.js' } });
  write(path.join(framework, 'migrate.js'), 'module.exports = { migrateTarget: () => ({ due: [], changed: [], errors: [] }) };\n');
  return brand;
}

module.exports = defineCases({
  type: 'group',
  description: 'migrate-files',
  tests: [
    {
      name: 'migrate: an overlay and a target\'s own file are judged like the base, one block each',
      run: async (ctx) => {
        const brand = stageWithWebTarget();
        const overlay = path.join(brand, 'config', 'omega.production.json5');
        const local = path.join(brand, 'targets', 'web', 'config', 'omega.json5');
        write(overlay, "{\n  // production only\n  translation: { exclude: ['docs'] },\n}\n");
        write(local, "{\n  meta: { index: false },\n  bogus: { flavor: 'house' },\n}\n");

        const report = await runMigrate(brand);
        ctx.expect(block(report.text, 'config/omega.production.json5'), report.text).toMatch(/due\s+move translation\.exclude → translation\.include/);
        const target = block(report.text, 'targets/web/config/omega.json5');
        ctx.expect(target, report.text).toMatch(/due\s+config\.bogus\.flavor is not a key the schema declares; remove it by hand/);
        ctx.expect(target, 'a target\'s own file is judged as that target\'s layer').not.toMatch(/meta\.index/);
        ctx.expect(block(report.text, 'config/omega.json5')).toMatch(/no retired keys/);
        ctx.expect(report.code).toBe(1);

        const converted = await runMigrate(brand, { execute: true });
        ctx.expect(JSON5.parse(fs.readFileSync(overlay, 'utf8')).translation, 'the overlay converted in place').toEqual({ include: ['**', '!docs'] });
        ctx.expect(fs.readFileSync(overlay, 'utf8').includes('// production only'), 'its comments survive').toBeTruthy();
        ctx.expect(block(converted.text, 'targets/web/config/omega.json5'), 'the by-hand residue is still owed').toMatch(/due\s+config\.bogus\.flavor/);
        ctx.expect(converted.code).toBe(1);
      },
    },

    {
      name: 'migrate: config/seo.json5 is read too, and an item\'s org moves to owner in that file',
      run: async (ctx) => {
        const brand = stageBrand(BASE);
        const sidecar = path.join(brand, 'config', 'seo.json5');
        write(sidecar, "{\n  // parasite repos\n  github: {\n    content: [\n      { name: 'fixture-tool', org: 'Acme-Org' },\n    ],\n  },\n}\n");

        const report = await runMigrate(brand);
        ctx.expect(block(report.text, 'config/seo.json5'), report.text).toMatch(/due\s+move (seo\.)?github\.content\[0\]\.org → (seo\.)?github\.content\[0\]\.owner = "Acme-Org"/);
        ctx.expect(report.code).toBe(1);

        const converted = await runMigrate(brand, { execute: true });
        const written = fs.readFileSync(sidecar, 'utf8');
        ctx.expect(JSON5.parse(written), converted.text).toEqual({ github: { content: [{ name: 'fixture-tool', owner: 'Acme-Org' }] } });
        ctx.expect(written.includes('// parasite repos'), 'its comments survive').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(brand, 'config', 'omega.json5'), 'utf8'), 'the brand config is untouched').toBe(BASE);
      },
    },

    {
      name: 'migrate: a retired path at a list position reports once, as its row, never again as a strict line',
      run: async (ctx) => {
        const brand = stageBrand(BASE);
        write(path.join(brand, 'config', 'seo.json5'), "{\n  github: { content: [{ name: 'fixture-tool', org: 'Acme-Org' }] },\n}\n");

        const report = await runMigrate(brand);
        const sidecar = block(report.text, 'config/seo.json5');
        ctx.expect(sidecar, report.text).toMatch(/due\s+move (seo\.)?github\.content\[0\]\.org → /);
        ctx.expect(sidecar.match(/content\[0\]\.org/g).length, report.text).toBe(1);
        ctx.expect(sidecar, report.text).not.toMatch(/is not a key the schema declares/);
      },
    },

    {
      name: 'migrate: a sidecar author.token of env:NAME moves to author.tokenEnv, the name alone, comments kept',
      run: async (ctx) => {
        const brand = stageBrand(BASE);
        const sidecar = path.join(brand, 'config', 'seo.json5');
        write(sidecar, "{\n  // parasite repos\n  github: {\n    content: [\n      { name: 'fixture-tool', author: { token: 'env:GH_SOCK' } },\n    ],\n  },\n}\n");

        const report = await runMigrate(brand);
        ctx.expect(block(report.text, 'config/seo.json5').includes('move seo.github.content[0].author.token → seo.github.content[0].author.tokenEnv = "GH_SOCK"'), report.text).toBeTruthy();

        const converted = await runMigrate(brand, { execute: true });
        const written = fs.readFileSync(sidecar, 'utf8');
        ctx.expect(JSON5.parse(written), converted.text).toEqual({ github: { content: [{ name: 'fixture-tool', author: { tokenEnv: 'GH_SOCK' } }] } });
        ctx.expect(written.includes('// parasite repos'), 'its comments survive').toBeTruthy();
      },
    },

    {
      name: 'migrate: a literal sidecar author.token is refused, never converted, and the key stays',
      run: async (ctx) => {
        const brand = stageBrand(BASE);
        const sidecar = path.join(brand, 'config', 'seo.json5');
        const source = "{\n  github: {\n    content: [\n      { name: 'fixture-tool', author: { token: 'ghp_literal' } },\n    ],\n  },\n}\n";
        write(sidecar, source);
        const line = 'refused seo.github.content[0].author.token: a token never lives in config; put it in .env as a variable and write author.tokenEnv: "<NAME>"';

        const report = await runMigrate(brand);
        ctx.expect(block(report.text, 'config/seo.json5').includes(line), report.text).toBeTruthy();
        ctx.expect(report.code).toBe(1);

        const executed = await runMigrate(brand, { execute: true });
        ctx.expect(block(executed.text, 'config/seo.json5').includes(line), executed.text).toBeTruthy();
        ctx.expect(fs.readFileSync(sidecar, 'utf8'), 'the key stays').toBe(source);
        ctx.expect(executed.code).toBe(1);
      },
    },

    {
      name: 'migrate: each target\'s .env is its own block, and a .env outside the brand is never read or written',
      run: async (ctx) => {
        const brand = stageWithWebTarget();
        const targetEnv = path.join(brand, 'targets', 'web', '.env');
        const outside = path.join(brand, '..', '.env');
        const stray = path.join(brand, 'tools', '.env');
        const retired = 'OAUTH2_GOOGLE_CLIENT_ID="value-marker-target"\n';
        write(targetEnv, retired);
        write(outside, 'OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-outside"\n');
        write(stray, 'OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-stray"\n');

        const report = await runMigrate(brand);
        ctx.expect(block(report.text, 'targets/web/.env'), report.text).toMatch(/due\s+rename OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/);
        ctx.expect(report.text, 'no file outside the brand root and its targets is read').not.toMatch(/OAUTH2_GOOGLE_CLIENT_SECRET/);
        ctx.expect(report.text, 'a value never reaches the report').not.toMatch(/value-marker/);

        await runMigrate(brand, { execute: true });
        ctx.expect(fs.readFileSync(targetEnv, 'utf8')).toBe(retired.replace('OAUTH2_GOOGLE_CLIENT_ID=', 'CONNECTIONS_GOOGLE_CLIENT_ID='));
        ctx.expect(fs.readFileSync(outside, 'utf8'), 'outside the brand: never written').toBe('OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-outside"\n');
        ctx.expect(fs.readFileSync(stray, 'utf8'), 'a folder no target owns: never written').toBe('OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-stray"\n');
      },
    },

    {
      name: 'migrate --execute: the `KEY: value` spelling dotenv also reads is renamed too',
      run: async (ctx) => {
        const brand = stageBrand(BASE);
        const env = path.join(brand, '.env');
        write(env, 'OAUTH2_GOOGLE_CLIENT_ID: value-marker-colon\nexport OAUTH2_GOOGLE_CLIENT_SECRET=value-marker-export\n');

        const { text, code } = await runMigrate(brand, { execute: true });

        ctx.expect(fs.readFileSync(env, 'utf8')).toBe('CONNECTIONS_GOOGLE_CLIENT_ID: value-marker-colon\nexport CONNECTIONS_GOOGLE_CLIENT_SECRET=value-marker-export\n');
        ctx.expect(block(text, '.env')).toMatch(/changed\s+renamed OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID in place/);
        ctx.expect(code, text).toBe(undefined);
      },
    },

    // The pass refuses whenever the rename changed nothing, so "renamed in place"
    // is never printed over an untouched file: the helper's no-op is that signal.
    {
      name: 'renameEnvKey leaves a file with no assignment of the key byte-identical',
      run: (ctx) => {
        const source = '# OAUTH2_GOOGLE_CLIENT_ID=commented out\nGH_TOKEN="x"\nNOTE="OAUTH2_GOOGLE_CLIENT_ID=inside a value"\n';

        ctx.expect(renameEnvKey(source, 'OAUTH2_GOOGLE_CLIENT_ID', 'CONNECTIONS_GOOGLE_CLIENT_ID')).toBe(source);
      },
    },
  ],
});
