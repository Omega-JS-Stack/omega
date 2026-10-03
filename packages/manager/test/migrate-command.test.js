/**
 * Brand-root `omega migrate`: the retired-key pass over the AUTHORED
 * omega.json5, then every target's own migration in the verb table's order,
 * report by default and `--execute` to convert, ending on the one line naming
 * the breaking-changes register. Held to: comments and formatting survive a
 * removal, a report writes nothing and exits 1 while a step is due, a rerun is
 * byte-identical, `--target=` narrows the walk, a custom target steps aside.
 *
 * Real files on disk, run through the real command. The brand's framework
 * packages are stubs whose `migrate` entry IS the framework's real library.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');
const { loadConfig } = require('@omega.js/config');

const { write, stageBrand: stageSource, runMigrate, block } = require('./lib/migrate-harness.js');

// A converted brand still carrying both #610 page maps, the #466 redirect map
// and a #23 rekey.
const CONVERTED = `// Fixture Brand — brand-level omega.json5
{
  brand: {
    id: 'fixture-brand',
    name: 'Fixture Brand',
    url: 'https://fixture-brand.test',
  },

  // Contact form provider — carried over from the UJM config.
  slapform: {
    endpoint: 'https://slapform.test/f/abc',
  },

  targets: {
    web: {
      type: 'web',

      // The download page map — one card per platform.
      download: {
        mac: 'https://cdn.fixture-brand.test/mac.dmg',
      },

      extension: { chrome: 'https://chrome.test/abc' }, // store listings

      // Path redirects — the QR short code.
      redirects: [{ from: '/c/:id', to: '/code?id=:id' }],

      imagemin: {}, // keep me
    },
    backend: { type: 'backend' }, // enabled, defaults
  },
}
`;

const PACKAGES = path.join(__dirname, '..', '..');

const stageBrand = (source = CONVERTED) => stageSource(source);

/**
 * Install a stub of a framework at the brand root whose `./migrate` entry is
 * that framework's real migrate library.
 */
function installFramework(brand, name, library) {
  const dir = path.join(brand, 'node_modules', '@omega.js', name);
  write(path.join(dir, 'package.json'), { name: `@omega.js/${name}`, exports: { './migrate': './migrate.js' } });
  write(path.join(dir, 'migrate.js'), `module.exports = require(${JSON.stringify(path.join(PACKAGES, library))});\n`);
}

// A brand carrying one retired config key, a legacy UJM web target, a
// flat-hooks extension target and a custom target.
const LEGACY_BRAND = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },

  // Contact form provider, carried over from the UJM config.
  slapform: { endpoint: 'https://slapform.test/f/abc' },

  targets: { web: { type: 'web' }, extension: { type: 'extension' }, api: { type: 'custom' } },
}
`;

function stageLegacyBrand() {
  const brand = stageBrand(LEGACY_BRAND);
  fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'fixture-brand', private: true, workspaces: ['targets/*'] }));

  const web = path.join(brand, 'targets', 'web');
  write(path.join(web, 'package.json'), { name: 'web', private: true, dependencies: { '@omega.js/web': '*' } });
  write(path.join(web, 'src', '_config.yml'), 'title: Fixture Brand\nurl: https://fixture-brand.test\n');
  write(path.join(web, 'src', 'pages', 'index.html'), '<h1>{{ page.resolved.meta.title }}</h1>\n');
  write(path.join(web, 'Gemfile'), "source 'https://rubygems.org'\n");

  const extension = path.join(brand, 'targets', 'extension');
  write(path.join(extension, 'package.json'), { name: 'extension', private: true, devDependencies: { '@omega.js/extension': '^1.5.0' } });
  write(path.join(extension, 'hooks', 'build:pre.js'), 'module.exports = async () => {};\n');

  write(path.join(brand, 'targets', 'api', 'package.json'), { name: 'api', private: true });

  installFramework(brand, 'web', 'web/src/migrate/index.js');
  installFramework(brand, 'extension', 'extension/src/commands/lib/migrate.js');
  return brand;
}

/** Every file under the brand's config and targets, as path → bytes. */
function snapshot(brand) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(brand, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(path.join(brand, 'config'));
  walk(path.join(brand, 'targets'));
  return files;
}

const readConfig = (brand) => fs.readFileSync(path.join(brand, 'config', 'omega.json5'), 'utf8');

// ─── Conversion (#858) ───────────────────────────────────────────────────────

// A retired row may carry a `convert`: the setting MOVES instead of merely
// vanishing. `translation.exclude` is the first one: the route list says what
// to TRANSLATE now, so each excluded route becomes a negation on top of the
// framework default, written before the old key is deleted, in the same run.
const CARRIES_EXCLUDE = `// Fixture Brand
{
  brand: {
    id: 'fixture-brand',
    name: 'Fixture Brand',
    url: 'https://fixture-brand.test',
  },

  // AI translation, the marketing surface only.
  translation: {
    languages: ['es'],
    exclude: ['docs', '/changelog/'],
  },

  targets: {
    web: { type: 'web' }, // keep me
  },
}
`;

// A brand that STARTED the migration by hand carries both keys: the converted
// old list would silently replace the include list it wrote (B2).
const CARRIES_BOTH = `// Fixture Brand
{
  brand: {
    id: 'fixture-brand',
    name: 'Fixture Brand',
    url: 'https://fixture-brand.test',
  },

  translation: {
    languages: ['es'],
    exclude: ['docs'],
    include: ['**', '!secret/**'],
  },

  targets: {
    web: { type: 'web' }, // keep me
  },
}
`;

// ─── The .env pass: retired env NAMES, never a value ─────────────────────────

const readEnv = (brand, name = '.env') => fs.readFileSync(path.join(brand, name), 'utf8');

// Every value is a marker no report may ever print
const ENV_VALUES = ['gh-value-marker-1', 'oauth-value-marker-2', 'edge-value-marker-3', 'uid-value-marker-4'];
const CARRIES_ENV = `# Brand secrets
GH_TOKEN="${ENV_VALUES[0]}"
OAUTH2_GOOGLE_CLIENT_ID="${ENV_VALUES[1]}"
EDGE_PRODUCT_ID="${ENV_VALUES[2]}"
OMEGA_TEST_USER_UID="${ENV_VALUES[3]}"
`;

// ─── The live brand's leftovers, over a fixture of the same KEYS ─────────────

// The five keys the real brand still carried beside its three retired ones:
// every one has a row, so the report is complete. Values are placeholders.
const LIVE_LEFTOVERS = `{
  parent: 'self',
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test', company: 'Fixture Holdings' },
  advertising: { providers: { adsense: { client: 'ca-pub-0000000000000000' } } },
  translation: { languages: ['es'], exclude: ['docs'] },
  adsense: { accountId: 'pub-0000000000000000' },
  download: {
    mac: { universal: 'https://fixture-brand.test/mac' },
    windows: { universal: 'https://fixture-brand.test/win' },
    linux: { debian: 'https://fixture-brand.test/deb', snap: 'https://fixture-brand.test/snap' },
  },
  targets: { web: { type: 'web' } },
}
`;

// A legacy brand whose UJM web target is NOT named `web`, under a root that
// already states the real brand id: the web leg's conversion merges into the
// root config, which wins, and the target keeps no config of its own.
const SITE_BRAND = `{
  // The real brand: every target resolves this id
  brand: { id: 'realbrand', name: 'Real Brand', url: 'https://realbrand.test' },
  targets: { site: { type: 'web' }, api: { type: 'backend' } },
}
`;

function stageSiteBrand() {
  const brand = stageBrand(SITE_BRAND);
  const site = path.join(brand, 'targets', 'site');
  write(path.join(site, 'package.json'), { name: 'site', private: true, dependencies: { '@omega.js/web': '*' } });
  write(path.join(site, 'src', '_config.yml'), [
    'url: https://sample.test',
    'brand: { id: sample, name: Sample }',
    'socials: { github: sample }',
    'web_manager: { auth: { enabled: true } }',
    '',
  ].join('\n'));
  write(path.join(site, 'src', 'pages', 'index.html'), '<h1>Home</h1>\n');
  write(path.join(brand, 'targets', 'api', 'package.json'), { name: 'api', private: true });
  installFramework(brand, 'web', 'web/src/migrate/index.js');
  return { brand, site };
}

// A key no row knows is still a key the strict load refuses: the config pass
// lists it by hand in both modes, and it fails the run until it is gone.
const CARRIES_UNKNOWN = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  slapform: { endpoint: 'https://slapform.test/f/abc' },
  bogus: { flavor: 'house' },
  targets: { web: { type: 'web', whatever: true }, api: { type: 'custom', port: 8080 } },
}
`;

module.exports = defineCases({
  type: 'group',
  description: 'migrate-command',
  tests: [
    // ─── The sweep ───────────────────────────────────────────────────────────────

    {
      name: 'migrate --execute: every retired key is deleted from the authored config, one line each',
      run: async (ctx) => {
        const brand = stageBrand();
        const { text, code } = await runMigrate(brand, { execute: true });

        const parsed = JSON5.parse(readConfig(brand));
        ctx.expect(parsed.targets.web.download).toBe(undefined);
        ctx.expect(parsed.targets.web.extension).toBe(undefined);
        ctx.expect(parsed.targets.web.redirects).toBe(undefined);
        ctx.expect(parsed.slapform).toBe(undefined);
        ctx.expect(code, 'a successful migrate exits clean').toBe(undefined);

        // One line per removed key, each naming what replaced it
        for (const [key, replacement] of [
          ['targets.web.download', 'targets.desktop.releases'],
          ['targets.web.extension', 'targets.extension.listings'],
          ['targets.web.redirects', 'edge.providers.cloudflare.rules.redirect'],
          ['slapform', 'forms.providers.slapform'],
        ]) {
          const line = text.split('\n').find((entry) => entry.includes(key));
          ctx.expect(line, `no line for ${key}`).toBeTruthy();
          ctx.expect(line.includes(replacement), `the ${key} line does not name its replacement: ${line}`).toBeTruthy();
        }
      },
    },

    {
      name: 'migrate --execute: everything the retired keys sat beside survives, byte for byte',
      run: async (ctx) => {
        const brand = stageBrand();
        await runMigrate(brand, { execute: true });
        const written = readConfig(brand);

        ctx.expect(written.includes('// Fixture Brand — brand-level omega.json5')).toBeTruthy();
        ctx.expect(written.includes("id: 'fixture-brand',")).toBeTruthy();
        ctx.expect(written.includes('imagemin: {}, // keep me')).toBeTruthy();
        ctx.expect(written.includes("backend: { type: 'backend' }, // enabled, defaults")).toBeTruthy();
        // The removed keys took their own documentation with them
        ctx.expect(!written.includes('The download page map')).toBeTruthy();
        ctx.expect(!written.includes('Contact form provider')).toBeTruthy();
        ctx.expect(!written.includes('store listings')).toBeTruthy();
        ctx.expect(!written.includes('the QR short code')).toBeTruthy();
        // And the config still loads
        ctx.expect(JSON5.parse(written).brand.name).toBe('Fixture Brand');
      },
    },

    {
      name: 'migrate --execute: idempotent: the second run removes nothing and rewrites nothing',
      run: async (ctx) => {
        const brand = stageBrand();
        await runMigrate(brand, { execute: true });
        const afterFirst = readConfig(brand);

        const { text, code } = await runMigrate(brand, { execute: true });
        ctx.expect(readConfig(brand), 'the rerun rewrote the file').toBe(afterFirst);
        ctx.expect(code).toBe(undefined);
        ctx.expect(text).toMatch(/no retired keys/i);
      },
    },

    {
      name: 'migrate: a bare run reports the same plan, writes nothing, and exits 1 while a key is due',
      run: async (ctx) => {
        const brand = stageBrand();
        const { text, code } = await runMigrate(brand);

        ctx.expect(readConfig(brand), 'a report wrote to the config').toBe(CONVERTED);
        ctx.expect(code, 'a due step is a loud exit, never a quiet green').toBe(1);
        ctx.expect(text.includes('targets.web.download')).toBeTruthy();
        ctx.expect(text.includes('slapform')).toBeTruthy();
      },
    },

    {
      name: 'migrate --execute: `translation.exclude` is CONVERTED to an include list, then removed',
      run: async (ctx) => {
        const brand = stageBrand(CARRIES_EXCLUDE);
        const { text, code } = await runMigrate(brand, { execute: true });

        const parsed = JSON5.parse(readConfig(brand));
        ctx.expect(code).toBe(undefined);
        ctx.expect(parsed.translation.include, 'each excluded route became a negation').toEqual(['**', '!docs', '!changelog']);
        ctx.expect(parsed.translation.exclude, 'the retired key is gone').toBe(undefined);
        ctx.expect(parsed.translation.languages, 'the rest of the block is untouched').toEqual(['es']);

        // The line says both halves of the move
        const line = text.split('\n').find((entry) => entry.includes('translation.exclude'));
        ctx.expect(line, `no line for translation.exclude: ${text}`).toBeTruthy();
        ctx.expect(line.includes('translation.include'), `the line does not name its replacement: ${line}`).toBeTruthy();
      },
    },

    {
      name: 'migrate --execute: a conversion never overwrites an authored value, it refuses the row',
      run: async (ctx) => {
        const brand = stageBrand(CARRIES_BOTH);
        const { text, code } = await runMigrate(brand, { execute: true });

        const parsed = JSON5.parse(readConfig(brand));
        ctx.expect(parsed.translation.include, 'the authored include list was overwritten').toEqual(['**', '!secret/**']);
        ctx.expect(parsed.translation.exclude, 'the old key went away with the conflict unresolved').toEqual(['docs']);
        ctx.expect(code, 'a refused row must exit nonzero').toBe(1);

        ctx.expect(text.includes('translation.include'), `the refusal does not name the path: ${text}`).toBeTruthy();
        ctx.expect(text.includes('delete one of the two by hand'), `the refusal does not say what to do: ${text}`).toBeTruthy();
      },
    },

    {
      name: 'migrate --execute: a conversion preserves the comments around it',
      run: async (ctx) => {
        const brand = stageBrand(CARRIES_EXCLUDE);
        await runMigrate(brand, { execute: true });
        const written = readConfig(brand);

        ctx.expect(written.includes('// Fixture Brand')).toBeTruthy();
        ctx.expect(written.includes('// AI translation, the marketing surface only.')).toBeTruthy();
        ctx.expect(written.includes("web: { type: 'web' }, // keep me")).toBeTruthy();
      },
    },

    {
      name: 'migrate: a bare run prints both halves of a conversion and writes nothing',
      run: async (ctx) => {
        const brand = stageBrand(CARRIES_EXCLUDE);
        const { text } = await runMigrate(brand);

        ctx.expect(readConfig(brand), 'a report wrote to the config').toBe(CARRIES_EXCLUDE);
        ctx.expect(text.includes('translation.include'), `the plan names the write: ${text}`).toBeTruthy();
        ctx.expect(text.includes('translation.exclude'), 'and the removal').toBeTruthy();
      },
    },

    {
      name: 'migrate --execute: a converted brand rerun is idempotent',
      run: async (ctx) => {
        const brand = stageBrand(CARRIES_EXCLUDE);
        await runMigrate(brand, { execute: true });
        const afterFirst = readConfig(brand);

        const { text } = await runMigrate(brand, { execute: true });
        ctx.expect(readConfig(brand), 'the rerun rewrote the file').toBe(afterFirst);
        ctx.expect(text).toMatch(/no retired keys/i);
      },
    },

    {
      name: 'migrate: a clean brand says so, touches nothing, and exits clean',
      run: async (ctx) => {
        const clean = `{\n  brand: { id: 'b', name: 'B', url: 'https://b.test' },\n  targets: { web: { type: 'web' } },\n}\n`;
        const brand = stageBrand(clean);
        const { text, code } = await runMigrate(brand);

        ctx.expect(readConfig(brand)).toBe(clean);
        ctx.expect(text).toMatch(/no retired keys/i);
        ctx.expect(code).toBe(undefined);
      },
    },

    {
      name: 'migrate: a config the loader refuses fails the run in a config load block, even with nothing due',
      run: async (ctx) => {
        // A secret-shaped key under a declared block: no retired row and no undeclared path
        const secret = `{\n  brand: { id: 'b', name: 'B', url: 'https://b.test' },\n  connections: { google: { clientSecret: 'x' } },\n  targets: { web: { type: 'web' } },\n}\n`;
        const brand = stageBrand(secret);

        const refused = await runMigrate(brand);
        ctx.expect(block(refused.text, 'config/omega.json5'), refused.text).toMatch(/no retired keys/i);
        ctx.expect(block(refused.text, 'config load'), refused.text).toMatch(/error\s+.*Secret-shaped keys in .*connections\.google\.clientSecret/);
        ctx.expect(refused.code, 'a config the build refuses never reports clean').toBe(1);

        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), secret.replace("  connections: { google: { clientSecret: 'x' } },\n", ''));
        const clean = await runMigrate(brand);
        ctx.expect(block(clean.text, 'config load'), clean.text).toMatch(/✓/);
        ctx.expect(clean.code, clean.text).toBe(undefined);
      },
    },

    {
      name: 'migrate: a retired config key AND retired env keys are reported by name, never a value, exit 1',
      run: async (ctx) => {
        const brand = stageBrand();
        fs.writeFileSync(path.join(brand, '.env'), CARRIES_ENV);

        const { text, code } = await runMigrate(brand);

        ctx.expect(code, 'steps are due').toBe(1);
        ctx.expect(readEnv(brand), 'a report wrote to the .env').toBe(CARRIES_ENV);
        ctx.expect(block(text, 'config/omega.json5')).toMatch(/due\s+remove slapform → forms\.providers\.slapform/);

        const env = block(text, '.env');
        ctx.expect(env, text).toMatch(/due\s+rename OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/);
        ctx.expect(env, text).toMatch(/due\s+move EDGE_PRODUCT_ID → targets\.<name>\.listings\.edge\.id in config\/omega\.json5 by hand/);
        ctx.expect(env, text).toMatch(/due\s+delete OMEGA_TEST_USER_UID by hand: retired outright/);
        ctx.expect(env, 'a live key is never mentioned').not.toMatch(/GH_TOKEN/);
        for (const value of ENV_VALUES) ctx.expect(!text.includes(value), `the report printed an env value: ${value}`).toBeTruthy();
      },
    },

    {
      name: 'migrate --execute: a renamed env key is rewritten in place, value byte-identical, and a rerun is clean',
      run: async (ctx) => {
        const brand = stageBrand();
        const source = `# Brand secrets\nGH_TOKEN="${ENV_VALUES[0]}"\n\n# Connections\nOAUTH2_GOOGLE_CLIENT_ID="${ENV_VALUES[1]}"\nOAUTH2_GOOGLE_CLIENT_SECRET=${ENV_VALUES[2]} # keep me\n`;
        fs.writeFileSync(path.join(brand, '.env'), source);

        const first = await runMigrate(brand, { execute: true });

        ctx.expect(first.code, first.text).toBe(undefined);
        ctx.expect(readEnv(brand), 'only the two names changed, every other byte kept').toBe(source.replace('OAUTH2_GOOGLE_CLIENT_ID=', 'CONNECTIONS_GOOGLE_CLIENT_ID=').replace('OAUTH2_GOOGLE_CLIENT_SECRET=', 'CONNECTIONS_GOOGLE_CLIENT_SECRET='));
        ctx.expect(block(first.text, '.env')).toMatch(/changed\s+renamed OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID in place, value untouched/);
        ctx.expect(JSON5.parse(readConfig(brand)).slapform, 'the config converted in the same run').toBe(undefined);
        for (const value of ENV_VALUES) ctx.expect(!first.text.includes(value), `the report printed an env value: ${value}`).toBeTruthy();

        const second = await runMigrate(brand);
        ctx.expect(second.code, second.text).toBe(undefined);
        ctx.expect(block(second.text, '.env')).toMatch(/no retired env keys/);
      },
    },

    {
      name: 'migrate --execute: an env rename never lands on a name the file already carries, and an overlay is its own block',
      run: async (ctx) => {
        const brand = stageBrand();
        const overlay = `OAUTH2_GOOGLE_CLIENT_ID="${ENV_VALUES[1]}"\nCONNECTIONS_GOOGLE_CLIENT_ID="${ENV_VALUES[3]}"\n`;
        fs.writeFileSync(path.join(brand, '.env'), `GH_TOKEN="${ENV_VALUES[0]}"\n`);
        fs.writeFileSync(path.join(brand, '.env.production'), overlay);

        const { text, code } = await runMigrate(brand, { execute: true });

        ctx.expect(code, 'a refused rename fails the run').toBe(1);
        ctx.expect(readEnv(brand, '.env.production'), 'the refused file is untouched').toBe(overlay);
        ctx.expect(block(text, '.env.production')).toMatch(/error\s+refused OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/);
        ctx.expect(block(text, '.env')).toMatch(/no retired env keys/);
        for (const value of ENV_VALUES) ctx.expect(!text.includes(value), `the report printed an env value: ${value}`).toBeTruthy();
      },
    },

    {
      name: 'migrate: the live brand\'s leftover keys each report, and --execute leaves a config that loads clean',
      run: async (ctx) => {
        const brand = stageBrand(LIVE_LEFTOVERS);

        const report = await runMigrate(brand);
        const config = block(report.text, 'config/omega.json5');
        for (const line of [
          /due\s+remove parent → company\.webhooks/,
          /due\s+remove brand\.company → company\.name/,
          /due\s+move translation\.exclude → translation\.include/,
          /due\s+remove adsense → advertising\.providers\.adsense\.client/,
          /due\s+remove download → targets\.desktop\.releases/,
        ]) {
          ctx.expect(config, report.text).toMatch(line);
        }
        ctx.expect(report.code).toBe(1);

        await runMigrate(brand, { execute: true });
        const { loadConfig } = require('@omega.js/config');
        ctx.expect(loadConfig(brand).errors, 'the converted brand passes the strict schema').toEqual([]);
      },
    },

    {
      name: 'migrate: outside a brand monorepo it refuses loudly instead of guessing',
      run: async (ctx) => {
        const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-migrate-bare-')));
        const { text, code } = await runMigrate(scratch);

        ctx.expect(code).toBe(1);
        ctx.expect(text).toMatch(/brand monorepo/i);
      },
    },

    // ─── The target walk and the register line ─────────────────────────────────

    {
      name: 'migrate: a bare run reports the config and every target, writes NOTHING, and exits 1',
      run: async (ctx) => {
        const brand = stageLegacyBrand();
        const before = snapshot(brand);

        const { text, code } = await runMigrate(brand);

        ctx.expect(snapshot(brand), 'a report wrote to the brand').toEqual(before);
        ctx.expect(code, 'steps are due').toBe(1);
        ctx.expect(block(text, 'config/omega.json5')).toMatch(/due\s+remove slapform → forms\.providers\.slapform/);
        ctx.expect(block(text, 'web')).toMatch(/due\s+convert src\/_config\.yml into the brand root config\/omega\.json5/);
        ctx.expect(block(text, 'web')).toMatch(/due\s+remove Gemfile/);
        ctx.expect(block(text, 'extension')).toMatch(/due\s+move hooks\/build:pre\.js to hooks\/build\/pre\.js/);
      },
    },

    {
      name: 'migrate --execute: converts the config and every target in one run, then a rerun reports nothing',
      run: async (ctx) => {
        const brand = stageLegacyBrand();

        const first = await runMigrate(brand, { execute: true });

        ctx.expect(first.code, `a clean conversion exits 0:\n${first.text}`).toBe(undefined);
        ctx.expect(JSON5.parse(readConfig(brand)).slapform, 'the retired key is gone').toBe(undefined);
        ctx.expect(block(first.text, 'web'), 'the web target converted').toMatch(/changed\s+converted src\/_config\.yml into the brand root config\/omega\.json5/);
        ctx.expect(!fs.existsSync(path.join(brand, 'targets', 'web', 'config', 'omega.json5')), 'into the brand root, never a config of its own').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(brand, 'targets', 'web', 'Gemfile')), 'and its legacy files went').toBeTruthy();
        ctx.expect(fs.existsSync(path.join(brand, 'targets', 'extension', 'hooks', 'build', 'pre.js')), 'the extension hook moved').toBeTruthy();
        ctx.expect(block(first.text, 'extension')).toMatch(/changed\s+moved hooks\/build:pre\.js to hooks\/build\/pre\.js/);

        const second = await runMigrate(brand, { execute: true });
        ctx.expect(second.code, second.text).toBe(undefined);
        ctx.expect(second.text, `the rerun has nothing to report:\n${second.text}`).not.toMatch(/^\s+(due|changed|error)\s/m);

        const report = await runMigrate(brand);
        ctx.expect(report.code, `a converted brand reports clean:\n${report.text}`).toBe(undefined);
      },
    },

    {
      name: 'migrate --target=web: narrows the walk to that target, the config pass still first',
      run: async (ctx) => {
        const brand = stageLegacyBrand();

        const { text } = await runMigrate(brand, { target: 'web' });

        ctx.expect(block(text, 'config/omega.json5') !== null, 'the brand config is always converted first').toBeTruthy();
        ctx.expect(block(text, 'web') !== null, 'the picked target runs').toBeTruthy();
        ctx.expect(block(text, 'extension'), 'an unpicked target never runs').toBe(null);
        ctx.expect(block(text, 'api')).toBe(null);
      },
    },

    {
      name: 'migrate: the report ends with ONE line naming the breaking-changes register',
      run: async (ctx) => {
        const brand = stageLegacyBrand();

        const { text } = await runMigrate(brand);
        const last = text.trimEnd().split('\n').pop();

        const register = path.join(fs.realpathSync(path.join(__dirname, '..')), 'docs', 'shared', 'breaking-changes.md');
        ctx.expect(last.includes(register), `the last line names the installed manager's register: ${last}`).toBeTruthy();
      },
    },

    {
      name: 'migrate: a custom target steps aside with its line',
      run: async (ctx) => {
        const brand = stageLegacyBrand();

        const { text } = await runMigrate(brand);

        ctx.expect(block(text, 'api')).toMatch(/skip\s+a custom target has no framework migration/);
      },
    },

    {
      name: 'migrate --execute: a leg that throws is that target\'s error line, and the walk goes on',
      run: async (ctx) => {
        const brand = stageLegacyBrand();
        // Unparseable YAML: the web leg throws while it reads the legacy config
        fs.writeFileSync(path.join(brand, 'targets', 'web', 'src', '_config.yml'), 'title: [unclosed\n  url: : :\n');

        const { text, code } = await runMigrate(brand, { execute: true });

        ctx.expect(code, 'a failed leg is a failed run').toBe(1);
        ctx.expect(block(text, 'web'), text).toMatch(/error\s+@omega\.js\/web migrate failed: /);
        ctx.expect(block(text, 'extension'), 'the later target still ran').toMatch(/changed\s+moved hooks\/build:pre\.js to hooks\/build\/pre\.js/);
        ctx.expect(text.trimEnd().split('\n').pop(), 'and the report still ends on the register line').toMatch(/docs\/shared\/breaking-changes\.md/);
      },
    },

    {
      name: 'migrate: a retired key is reported once, by the config pass, never again as a web error',
      run: async (ctx) => {
        const brand = stageLegacyBrand();
        // An already-converted web target: no legacy configs left, nothing to rewrite
        const web = path.join(brand, 'targets', 'web');
        fs.rmSync(path.join(web, 'src', '_config.yml'));
        fs.rmSync(path.join(web, 'Gemfile'));
        write(path.join(web, 'src', 'pages', 'index.html'), '<h1>Home</h1>\n');

        const { text, code } = await runMigrate(brand, { target: 'web' });

        ctx.expect(code, 'the retired key is due').toBe(1);
        ctx.expect((text.match(/^\s+due\s/gm) || []).length, text).toBe(1);
        ctx.expect(block(text, 'web'), text).not.toMatch(/^\s+error\s/m);
        ctx.expect(block(text, 'config load'), 'the loader refuses it until it converts').toMatch(/error\s+brand: config\.slapform\.endpoint is not a key the schema declares/);
      },
    },

    {
      name: 'migrate --execute: the web leg merges into the brand root, so every target resolves one brand id',
      run: async (ctx) => {
        const { brand, site } = stageSiteBrand();

        const report = await runMigrate(brand, { target: 'site' });
        ctx.expect(block(report.text, 'site'), report.text).toMatch(/due\s+keep brand\.id = "realbrand" in the brand root config\/omega\.json5 over "sample"/);
        ctx.expect(block(report.text, 'site'), report.text).toMatch(/due\s+add targets\.site\.client to the brand root config\/omega\.json5/);

        const { text, code } = await runMigrate(brand, { execute: true, target: 'site' });

        ctx.expect(code, `a clean conversion exits 0:\n${text}`).toBe(undefined);
        ctx.expect(!fs.existsSync(path.join(site, 'config', 'omega.json5')), 'no target-level config').toBeTruthy();
        const web = loadConfig(site, 'web');
        ctx.expect(web.errors, 'the site target loads clean').toEqual([]);
        ctx.expect(web.config.brand.id).toBe('realbrand');
        ctx.expect(loadConfig(path.join(brand, 'targets', 'api'), 'backend').config.brand.id, 'the same id the backend resolves').toBe('realbrand');
        ctx.expect(web.config.client.auth.enabled, 'the web-only sections reach the site target').toBe(true);
        ctx.expect(Object.keys(web.config.targets).sort(), 'no phantom web target').toEqual(['api', 'site']);
      },
    },

    {
      name: 'migrate --execute: a root the web leg merged into is judged again, one line per finding, never twice',
      run: async (ctx) => {
        const { brand } = stageSiteBrand();
        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), SITE_BRAND.replace("  targets:", "  bogus: { flavor: 'house' },\n  targets:"));

        const { text, code } = await runMigrate(brand, { execute: true, target: 'site' });

        ctx.expect(code, 'a key the schema refuses still fails the run').toBe(1);
        ctx.expect(JSON5.parse(readConfig(brand)).targets.site.client, 'the leg merged into the root').toBeTruthy();
        ctx.expect((block(text, 'config/omega.json5').match(/config\.bogus\.flavor is not a key/g) || []).length, text).toBe(1);
      },
    },

    {
      name: 'migrate --execute: a hand-written target-level config survives byte for byte and overrides for its target alone',
      run: async (ctx) => {
        const { brand, site } = stageSiteBrand();
        const ownFile = path.join(site, 'config', 'omega.json5');
        const own = "{\n  // Overrides the brand layer for this app only\n  brand: { url: 'https://site-only.test' },\n  socials: { twitter: 'site-handle' },\n}\n";
        write(ownFile, own);

        const { text, code } = await runMigrate(brand, { execute: true, target: 'site' });

        ctx.expect(code, text).toBe(undefined);
        ctx.expect(fs.readFileSync(ownFile, 'utf8'), 'the override layer is never touched').toBe(own);
        ctx.expect(JSON5.parse(readConfig(brand)).socials.github, 'the conversion still lands in the root').toBe('sample');
        const web = loadConfig(site, 'web').config;
        const backend = loadConfig(path.join(brand, 'targets', 'api'), 'backend').config;
        ctx.expect(web.socials.twitter, 'it still overrides for site').toBe('site-handle');
        ctx.expect(web.brand.url).toBe('https://site-only.test');
        ctx.expect(backend.socials.twitter, 'the backend never sees the site override').toBe(undefined);
        ctx.expect(backend.brand.url).toBe('https://realbrand.test');
      },
    },

    {
      name: 'migrate: an undeclared key no row covers is a by-hand line in both modes, and fails the run until removed',
      run: async (ctx) => {
        const brand = stageBrand(CARRIES_UNKNOWN);
        const byHand = [/due\s+config\.bogus\.flavor is not a key the schema declares; remove it by hand/, /due\s+config\.targets\.web\.whatever is not a key the schema declares; remove it by hand/];

        const report = await runMigrate(brand);
        const planned = block(report.text, 'config/omega.json5');
        for (const line of byHand) ctx.expect(planned, report.text).toMatch(line);
        ctx.expect(planned, 'a key its row covers is that row\'s line only').not.toMatch(/config\.slapform/);
        ctx.expect(planned, 'a custom target\'s keys are its own').not.toMatch(/port/);
        ctx.expect(report.code).toBe(1);

        const converted = await runMigrate(brand, { execute: true });
        const residue = block(converted.text, 'config/omega.json5');
        ctx.expect(residue, 'the row still converts').toMatch(/changed\s+removed slapform/);
        for (const line of byHand) ctx.expect(residue, converted.text).toMatch(line);
        ctx.expect(JSON5.parse(readConfig(brand)).bogus.flavor, 'a by-hand key is never deleted for you').toBe('house');
        ctx.expect(converted.code, 'the residue still fails the brand\'s load, so it fails the run').toBe(1);
      },
    },

    {
      name: 'migrate --target=nope: refuses before anything is written',
      run: async (ctx) => {
        const brand = stageLegacyBrand();
        const before = snapshot(brand);

        await ctx.expect(runMigrate(brand, { target: 'nope', execute: true })).rejects.toThrow((error) => {
          ctx.expect(error.refusal).toBe(true);
          ctx.expect(error.message).toMatch(/Unknown --target token "nope"/);
          return true;
        });
        ctx.expect(snapshot(brand), 'a refused run wrote to the brand').toEqual(before);
      },
    },

    {
      name: 'migrate --execute: a target whose framework has no migrate entry exits 1',
      run: async (ctx) => {
        const brand = stageLegacyBrand();
        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), LEGACY_BRAND.replace("api: { type: 'custom' }", "api: { type: 'custom' }, desktop: { type: 'desktop' }"));
        write(path.join(brand, 'targets', 'desktop', 'package.json'), { name: 'desktop', private: true, dependencies: { '@omega.js/desktop': '*' } });
        write(path.join(brand, 'node_modules', '@omega.js', 'desktop', 'package.json'), { name: '@omega.js/desktop', exports: { './cli': './cli.js' } });

        const { text, code } = await runMigrate(brand, { execute: true });

        ctx.expect(block(text, 'desktop'), text).toMatch(/error\s+@omega\.js\/desktop exposes no migrate entry \(update it\)/);
        ctx.expect(code).toBe(1);
      },
    },

    {
      name: 'migrate: a framework whose migrate entry has no migrateTarget is one clear error line',
      run: async (ctx) => {
        const brand = stageLegacyBrand();
        // An older framework: the subpath exists, the one export every leg answers with does not
        write(path.join(brand, 'node_modules', '@omega.js', 'extension', 'migrate.js'), 'module.exports = { runMigration() {} };\n');

        const { text, code } = await runMigrate(brand, { execute: true });

        ctx.expect(block(text, 'extension'), text).toMatch(/error\s+@omega\.js\/extension exposes a migrate entry without migrateTarget \(update it\)/);
        ctx.expect(text).not.toMatch(/is not a function/);
        ctx.expect(code).toBe(1);
      },
    },

    {
      name: 'migrate --execute: by-hand steps left due never fail the run',
      run: async (ctx) => {
        const brand = stageLegacyBrand();
        write(path.join(brand, 'targets', 'web', 'src', '_layouts', 'post.html'), '{% post_url 2020-01-01-x %}\n');

        const { text, code } = await runMigrate(brand, { execute: true });

        ctx.expect(block(text, 'web'), text).toMatch(/due\s+src\/_layouts\/post\.html:1: Jekyll-only tag/);
        ctx.expect(code, 'only a refusal fails an --execute run').toBe(undefined);
      },
    },
  ],
});
