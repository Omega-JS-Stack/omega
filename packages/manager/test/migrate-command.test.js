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
const test = require('node:test');
const assert = require('node:assert/strict');
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

// ─── The sweep ───────────────────────────────────────────────────────────────

test('migrate --execute: every retired key is deleted from the authored config, one line each', async () => {
  const brand = stageBrand();
  const { text, code } = await runMigrate(brand, { execute: true });

  const parsed = JSON5.parse(readConfig(brand));
  assert.equal(parsed.targets.web.download, undefined);
  assert.equal(parsed.targets.web.extension, undefined);
  assert.equal(parsed.targets.web.redirects, undefined);
  assert.equal(parsed.slapform, undefined);
  assert.equal(code, undefined, 'a successful migrate exits clean');

  // One line per removed key, each naming what replaced it
  for (const [key, replacement] of [
    ['targets.web.download', 'targets.desktop.releases'],
    ['targets.web.extension', 'targets.extension.listings'],
    ['targets.web.redirects', 'edge.providers.cloudflare.rules.redirect'],
    ['slapform', 'forms.providers.slapform'],
  ]) {
    const line = text.split('\n').find((entry) => entry.includes(key));
    assert.ok(line, `no line for ${key}`);
    assert.ok(line.includes(replacement), `the ${key} line does not name its replacement: ${line}`);
  }
});

test('migrate --execute: everything the retired keys sat beside survives, byte for byte', async () => {
  const brand = stageBrand();
  await runMigrate(brand, { execute: true });
  const written = readConfig(brand);

  assert.ok(written.includes('// Fixture Brand — brand-level omega.json5'));
  assert.ok(written.includes("id: 'fixture-brand',"));
  assert.ok(written.includes('imagemin: {}, // keep me'));
  assert.ok(written.includes("backend: { type: 'backend' }, // enabled, defaults"));
  // The removed keys took their own documentation with them
  assert.ok(!written.includes('The download page map'));
  assert.ok(!written.includes('Contact form provider'));
  assert.ok(!written.includes('store listings'));
  assert.ok(!written.includes('the QR short code'));
  // And the config still loads
  assert.equal(JSON5.parse(written).brand.name, 'Fixture Brand');
});

test('migrate --execute: idempotent: the second run removes nothing and rewrites nothing', async () => {
  const brand = stageBrand();
  await runMigrate(brand, { execute: true });
  const afterFirst = readConfig(brand);

  const { text, code } = await runMigrate(brand, { execute: true });
  assert.equal(readConfig(brand), afterFirst, 'the rerun rewrote the file');
  assert.equal(code, undefined);
  assert.match(text, /no retired keys/i);
});

test('migrate: a bare run reports the same plan, writes nothing, and exits 1 while a key is due', async () => {
  const brand = stageBrand();
  const { text, code } = await runMigrate(brand);

  assert.equal(readConfig(brand), CONVERTED, 'a report wrote to the config');
  assert.equal(code, 1, 'a due step is a loud exit, never a quiet green');
  assert.ok(text.includes('targets.web.download'));
  assert.ok(text.includes('slapform'));
});

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

test('migrate --execute: `translation.exclude` is CONVERTED to an include list, then removed', async () => {
  const brand = stageBrand(CARRIES_EXCLUDE);
  const { text, code } = await runMigrate(brand, { execute: true });

  const parsed = JSON5.parse(readConfig(brand));
  assert.equal(code, undefined);
  assert.deepEqual(parsed.translation.include, ['**', '!docs', '!changelog'], 'each excluded route became a negation');
  assert.equal(parsed.translation.exclude, undefined, 'the retired key is gone');
  assert.deepEqual(parsed.translation.languages, ['es'], 'the rest of the block is untouched');

  // The line says both halves of the move
  const line = text.split('\n').find((entry) => entry.includes('translation.exclude'));
  assert.ok(line, `no line for translation.exclude: ${text}`);
  assert.ok(line.includes('translation.include'), `the line does not name its replacement: ${line}`);
});

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

test('migrate --execute: a conversion never overwrites an authored value, it refuses the row', async () => {
  const brand = stageBrand(CARRIES_BOTH);
  const { text, code } = await runMigrate(brand, { execute: true });

  const parsed = JSON5.parse(readConfig(brand));
  assert.deepEqual(parsed.translation.include, ['**', '!secret/**'], 'the authored include list was overwritten');
  assert.deepEqual(parsed.translation.exclude, ['docs'], 'the old key went away with the conflict unresolved');
  assert.equal(code, 1, 'a refused row must exit nonzero');

  assert.ok(text.includes('translation.include'), `the refusal does not name the path: ${text}`);
  assert.ok(text.includes('delete one of the two by hand'), `the refusal does not say what to do: ${text}`);
});

test('migrate --execute: a conversion preserves the comments around it', async () => {
  const brand = stageBrand(CARRIES_EXCLUDE);
  await runMigrate(brand, { execute: true });
  const written = readConfig(brand);

  assert.ok(written.includes('// Fixture Brand'));
  assert.ok(written.includes('// AI translation, the marketing surface only.'));
  assert.ok(written.includes("web: { type: 'web' }, // keep me"));
});

test('migrate: a bare run prints both halves of a conversion and writes nothing', async () => {
  const brand = stageBrand(CARRIES_EXCLUDE);
  const { text } = await runMigrate(brand);

  assert.equal(readConfig(brand), CARRIES_EXCLUDE, 'a report wrote to the config');
  assert.ok(text.includes('translation.include'), `the plan names the write: ${text}`);
  assert.ok(text.includes('translation.exclude'), 'and the removal');
});

test('migrate --execute: a converted brand rerun is idempotent', async () => {
  const brand = stageBrand(CARRIES_EXCLUDE);
  await runMigrate(brand, { execute: true });
  const afterFirst = readConfig(brand);

  const { text } = await runMigrate(brand, { execute: true });
  assert.equal(readConfig(brand), afterFirst, 'the rerun rewrote the file');
  assert.match(text, /no retired keys/i);
});

test('migrate: a clean brand says so, touches nothing, and exits clean', async () => {
  const clean = `{\n  brand: { id: 'b', name: 'B', url: 'https://b.test' },\n  targets: { web: { type: 'web' } },\n}\n`;
  const brand = stageBrand(clean);
  const { text, code } = await runMigrate(brand);

  assert.equal(readConfig(brand), clean);
  assert.match(text, /no retired keys/i);
  assert.equal(code, undefined);
});

test('migrate: a config the loader refuses fails the run in a config load block, even with nothing due', async () => {
  // A secret-shaped key under a declared block: no retired row and no undeclared path
  const secret = `{\n  brand: { id: 'b', name: 'B', url: 'https://b.test' },\n  connections: { google: { clientSecret: 'x' } },\n  targets: { web: { type: 'web' } },\n}\n`;
  const brand = stageBrand(secret);

  const refused = await runMigrate(brand);
  assert.match(block(refused.text, 'config/omega.json5'), /no retired keys/i, refused.text);
  assert.match(block(refused.text, 'config load'), /error\s+.*Secret-shaped keys in .*connections\.google\.clientSecret/, refused.text);
  assert.equal(refused.code, 1, 'a config the build refuses never reports clean');

  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), secret.replace("  connections: { google: { clientSecret: 'x' } },\n", ''));
  const clean = await runMigrate(brand);
  assert.match(block(clean.text, 'config load'), /✓/, clean.text);
  assert.equal(clean.code, undefined, clean.text);
});

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

test('migrate: a retired config key AND retired env keys are reported by name, never a value, exit 1', async () => {
  const brand = stageBrand();
  fs.writeFileSync(path.join(brand, '.env'), CARRIES_ENV);

  const { text, code } = await runMigrate(brand);

  assert.equal(code, 1, 'steps are due');
  assert.equal(readEnv(brand), CARRIES_ENV, 'a report wrote to the .env');
  assert.match(block(text, 'config/omega.json5'), /due\s+remove slapform → forms\.providers\.slapform/);

  const env = block(text, '.env');
  assert.match(env, /due\s+rename OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/, text);
  assert.match(env, /due\s+move EDGE_PRODUCT_ID → targets\.<name>\.listings\.edge\.id in config\/omega\.json5 by hand/, text);
  assert.match(env, /due\s+delete OMEGA_TEST_USER_UID by hand: retired outright/, text);
  assert.doesNotMatch(env, /GH_TOKEN/, 'a live key is never mentioned');
  for (const value of ENV_VALUES) assert.ok(!text.includes(value), `the report printed an env value: ${value}`);
});

test('migrate --execute: a renamed env key is rewritten in place, value byte-identical, and a rerun is clean', async () => {
  const brand = stageBrand();
  const source = `# Brand secrets\nGH_TOKEN="${ENV_VALUES[0]}"\n\n# Connections\nOAUTH2_GOOGLE_CLIENT_ID="${ENV_VALUES[1]}"\nOAUTH2_GOOGLE_CLIENT_SECRET=${ENV_VALUES[2]} # keep me\n`;
  fs.writeFileSync(path.join(brand, '.env'), source);

  const first = await runMigrate(brand, { execute: true });

  assert.equal(first.code, undefined, first.text);
  assert.equal(
    readEnv(brand),
    source.replace('OAUTH2_GOOGLE_CLIENT_ID=', 'CONNECTIONS_GOOGLE_CLIENT_ID=').replace('OAUTH2_GOOGLE_CLIENT_SECRET=', 'CONNECTIONS_GOOGLE_CLIENT_SECRET='),
    'only the two names changed, every other byte kept',
  );
  assert.match(block(first.text, '.env'), /changed\s+renamed OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID in place, value untouched/);
  assert.equal(JSON5.parse(readConfig(brand)).slapform, undefined, 'the config converted in the same run');
  for (const value of ENV_VALUES) assert.ok(!first.text.includes(value), `the report printed an env value: ${value}`);

  const second = await runMigrate(brand);
  assert.equal(second.code, undefined, second.text);
  assert.match(block(second.text, '.env'), /no retired env keys/);
});

test('migrate --execute: an env rename never lands on a name the file already carries, and an overlay is its own block', async () => {
  const brand = stageBrand();
  const overlay = `OAUTH2_GOOGLE_CLIENT_ID="${ENV_VALUES[1]}"\nCONNECTIONS_GOOGLE_CLIENT_ID="${ENV_VALUES[3]}"\n`;
  fs.writeFileSync(path.join(brand, '.env'), `GH_TOKEN="${ENV_VALUES[0]}"\n`);
  fs.writeFileSync(path.join(brand, '.env.production'), overlay);

  const { text, code } = await runMigrate(brand, { execute: true });

  assert.equal(code, 1, 'a refused rename fails the run');
  assert.equal(readEnv(brand, '.env.production'), overlay, 'the refused file is untouched');
  assert.match(block(text, '.env.production'), /error\s+refused OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/);
  assert.match(block(text, '.env'), /no retired env keys/);
  for (const value of ENV_VALUES) assert.ok(!text.includes(value), `the report printed an env value: ${value}`);
});

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

test('migrate: the live brand\'s leftover keys each report, and --execute leaves a config that loads clean', async () => {
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
    assert.match(config, line, report.text);
  }
  assert.equal(report.code, 1);

  await runMigrate(brand, { execute: true });
  const { loadConfig } = require('@omega.js/config');
  assert.deepEqual(loadConfig(brand).errors, [], 'the converted brand passes the strict schema');
});

test('migrate: outside a brand monorepo it refuses loudly instead of guessing', async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-migrate-bare-')));
  const { text, code } = await runMigrate(scratch);

  assert.equal(code, 1);
  assert.match(text, /brand monorepo/i);
});

// ─── The target walk and the register line ─────────────────────────────────

test('migrate: a bare run reports the config and every target, writes NOTHING, and exits 1', async () => {
  const brand = stageLegacyBrand();
  const before = snapshot(brand);

  const { text, code } = await runMigrate(brand);

  assert.deepEqual(snapshot(brand), before, 'a report wrote to the brand');
  assert.equal(code, 1, 'steps are due');
  assert.match(block(text, 'config/omega.json5'), /due\s+remove slapform → forms\.providers\.slapform/);
  assert.match(block(text, 'web'), /due\s+convert src\/_config\.yml into the brand root config\/omega\.json5/);
  assert.match(block(text, 'web'), /due\s+remove Gemfile/);
  assert.match(block(text, 'extension'), /due\s+move hooks\/build:pre\.js to hooks\/build\/pre\.js/);
});

test('migrate --execute: converts the config and every target in one run, then a rerun reports nothing', async () => {
  const brand = stageLegacyBrand();

  const first = await runMigrate(brand, { execute: true });

  assert.equal(first.code, undefined, `a clean conversion exits 0:\n${first.text}`);
  assert.equal(JSON5.parse(readConfig(brand)).slapform, undefined, 'the retired key is gone');
  assert.match(block(first.text, 'web'), /changed\s+converted src\/_config\.yml into the brand root config\/omega\.json5/, 'the web target converted');
  assert.ok(!fs.existsSync(path.join(brand, 'targets', 'web', 'config', 'omega.json5')), 'into the brand root, never a config of its own');
  assert.ok(!fs.existsSync(path.join(brand, 'targets', 'web', 'Gemfile')), 'and its legacy files went');
  assert.ok(fs.existsSync(path.join(brand, 'targets', 'extension', 'hooks', 'build', 'pre.js')), 'the extension hook moved');
  assert.match(block(first.text, 'extension'), /changed\s+moved hooks\/build:pre\.js to hooks\/build\/pre\.js/);

  const second = await runMigrate(brand, { execute: true });
  assert.equal(second.code, undefined, second.text);
  assert.doesNotMatch(second.text, /^\s+(due|changed|error)\s/m, `the rerun has nothing to report:\n${second.text}`);

  const report = await runMigrate(brand);
  assert.equal(report.code, undefined, `a converted brand reports clean:\n${report.text}`);
});

test('migrate --target=web: narrows the walk to that target, the config pass still first', async () => {
  const brand = stageLegacyBrand();

  const { text } = await runMigrate(brand, { target: 'web' });

  assert.ok(block(text, 'config/omega.json5') !== null, 'the brand config is always converted first');
  assert.ok(block(text, 'web') !== null, 'the picked target runs');
  assert.equal(block(text, 'extension'), null, 'an unpicked target never runs');
  assert.equal(block(text, 'api'), null);
});

test('migrate: the report ends with ONE line naming the breaking-changes register', async () => {
  const brand = stageLegacyBrand();

  const { text } = await runMigrate(brand);
  const last = text.trimEnd().split('\n').pop();

  const register = path.join(fs.realpathSync(path.join(__dirname, '..')), 'docs', 'shared', 'breaking-changes.md');
  assert.ok(last.includes(register), `the last line names the installed manager's register: ${last}`);
});

test('migrate: a custom target steps aside with its line', async () => {
  const brand = stageLegacyBrand();

  const { text } = await runMigrate(brand);

  assert.match(block(text, 'api'), /skip\s+a custom target has no framework migration/);
});

test('migrate --execute: a leg that throws is that target\'s error line, and the walk goes on', async () => {
  const brand = stageLegacyBrand();
  // Unparseable YAML: the web leg throws while it reads the legacy config
  fs.writeFileSync(path.join(brand, 'targets', 'web', 'src', '_config.yml'), 'title: [unclosed\n  url: : :\n');

  const { text, code } = await runMigrate(brand, { execute: true });

  assert.equal(code, 1, 'a failed leg is a failed run');
  assert.match(block(text, 'web'), /error\s+@omega\.js\/web migrate failed: /, text);
  assert.match(block(text, 'extension'), /changed\s+moved hooks\/build:pre\.js to hooks\/build\/pre\.js/, 'the later target still ran');
  assert.match(text.trimEnd().split('\n').pop(), /docs\/shared\/breaking-changes\.md/, 'and the report still ends on the register line');
});

test('migrate: a retired key is reported once, by the config pass, never again as a web error', async () => {
  const brand = stageLegacyBrand();
  // An already-converted web target: no legacy configs left, nothing to rewrite
  const web = path.join(brand, 'targets', 'web');
  fs.rmSync(path.join(web, 'src', '_config.yml'));
  fs.rmSync(path.join(web, 'Gemfile'));
  write(path.join(web, 'src', 'pages', 'index.html'), '<h1>Home</h1>\n');

  const { text, code } = await runMigrate(brand, { target: 'web' });

  assert.equal(code, 1, 'the retired key is due');
  assert.equal((text.match(/^\s+due\s/gm) || []).length, 1, text);
  assert.doesNotMatch(block(text, 'web'), /^\s+error\s/m, text);
  assert.match(block(text, 'config load'), /error\s+brand: config\.slapform\.endpoint is not a key the schema declares/, 'the loader refuses it until it converts');
});

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

test('migrate --execute: the web leg merges into the brand root, so every target resolves one brand id', async () => {
  const { brand, site } = stageSiteBrand();

  const report = await runMigrate(brand, { target: 'site' });
  assert.match(block(report.text, 'site'), /due\s+keep brand\.id = "realbrand" in the brand root config\/omega\.json5 over "sample"/, report.text);
  assert.match(block(report.text, 'site'), /due\s+add targets\.site\.client to the brand root config\/omega\.json5/, report.text);

  const { text, code } = await runMigrate(brand, { execute: true, target: 'site' });

  assert.equal(code, undefined, `a clean conversion exits 0:\n${text}`);
  assert.ok(!fs.existsSync(path.join(site, 'config', 'omega.json5')), 'no target-level config');
  const web = loadConfig(site, 'web');
  assert.deepEqual(web.errors, [], 'the site target loads clean');
  assert.equal(web.config.brand.id, 'realbrand');
  assert.equal(loadConfig(path.join(brand, 'targets', 'api'), 'backend').config.brand.id, 'realbrand', 'the same id the backend resolves');
  assert.equal(web.config.client.auth.enabled, true, 'the web-only sections reach the site target');
  assert.deepEqual(Object.keys(web.config.targets).sort(), ['api', 'site'], 'no phantom web target');
});

test('migrate --execute: a root the web leg merged into is judged again, one line per finding, never twice', async () => {
  const { brand } = stageSiteBrand();
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), SITE_BRAND.replace("  targets:", "  bogus: { flavor: 'house' },\n  targets:"));

  const { text, code } = await runMigrate(brand, { execute: true, target: 'site' });

  assert.equal(code, 1, 'a key the schema refuses still fails the run');
  assert.ok(JSON5.parse(readConfig(brand)).targets.site.client, 'the leg merged into the root');
  assert.equal((block(text, 'config/omega.json5').match(/config\.bogus\.flavor is not a key/g) || []).length, 1, text);
});

test('migrate --execute: a hand-written target-level config survives byte for byte and overrides for its target alone', async () => {
  const { brand, site } = stageSiteBrand();
  const ownFile = path.join(site, 'config', 'omega.json5');
  const own = "{\n  // Overrides the brand layer for this app only\n  brand: { url: 'https://site-only.test' },\n  socials: { twitter: 'site-handle' },\n}\n";
  write(ownFile, own);

  const { text, code } = await runMigrate(brand, { execute: true, target: 'site' });

  assert.equal(code, undefined, text);
  assert.equal(fs.readFileSync(ownFile, 'utf8'), own, 'the override layer is never touched');
  assert.equal(JSON5.parse(readConfig(brand)).socials.github, 'sample', 'the conversion still lands in the root');
  const web = loadConfig(site, 'web').config;
  const backend = loadConfig(path.join(brand, 'targets', 'api'), 'backend').config;
  assert.equal(web.socials.twitter, 'site-handle', 'it still overrides for site');
  assert.equal(web.brand.url, 'https://site-only.test');
  assert.equal(backend.socials.twitter, undefined, 'the backend never sees the site override');
  assert.equal(backend.brand.url, 'https://realbrand.test');
});

// A key no row knows is still a key the strict load refuses: the config pass
// lists it by hand in both modes, and it fails the run until it is gone.
const CARRIES_UNKNOWN = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  slapform: { endpoint: 'https://slapform.test/f/abc' },
  bogus: { flavor: 'house' },
  targets: { web: { type: 'web', whatever: true }, api: { type: 'custom', port: 8080 } },
}
`;

test('migrate: an undeclared key no row covers is a by-hand line in both modes, and fails the run until removed', async () => {
  const brand = stageBrand(CARRIES_UNKNOWN);
  const byHand = [/due\s+config\.bogus\.flavor is not a key the schema declares; remove it by hand/, /due\s+config\.targets\.web\.whatever is not a key the schema declares; remove it by hand/];

  const report = await runMigrate(brand);
  const planned = block(report.text, 'config/omega.json5');
  for (const line of byHand) assert.match(planned, line, report.text);
  assert.doesNotMatch(planned, /config\.slapform/, 'a key its row covers is that row\'s line only');
  assert.doesNotMatch(planned, /port/, 'a custom target\'s keys are its own');
  assert.equal(report.code, 1);

  const converted = await runMigrate(brand, { execute: true });
  const residue = block(converted.text, 'config/omega.json5');
  assert.match(residue, /changed\s+removed slapform/, 'the row still converts');
  for (const line of byHand) assert.match(residue, line, converted.text);
  assert.equal(JSON5.parse(readConfig(brand)).bogus.flavor, 'house', 'a by-hand key is never deleted for you');
  assert.equal(converted.code, 1, 'the residue still fails the brand\'s load, so it fails the run');
});

test('migrate --target=nope: refuses before anything is written', async () => {
  const brand = stageLegacyBrand();
  const before = snapshot(brand);

  await assert.rejects(runMigrate(brand, { target: 'nope', execute: true }), (error) => {
    assert.equal(error.refusal, true);
    assert.match(error.message, /Unknown --target token "nope"/);
    return true;
  });
  assert.deepEqual(snapshot(brand), before, 'a refused run wrote to the brand');
});

test('migrate --execute: a target whose framework has no migrate entry exits 1', async () => {
  const brand = stageLegacyBrand();
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), LEGACY_BRAND.replace("api: { type: 'custom' }", "api: { type: 'custom' }, desktop: { type: 'desktop' }"));
  write(path.join(brand, 'targets', 'desktop', 'package.json'), { name: 'desktop', private: true, dependencies: { '@omega.js/desktop': '*' } });
  write(path.join(brand, 'node_modules', '@omega.js', 'desktop', 'package.json'), { name: '@omega.js/desktop', exports: { './cli': './cli.js' } });

  const { text, code } = await runMigrate(brand, { execute: true });

  assert.match(block(text, 'desktop'), /error\s+@omega\.js\/desktop exposes no migrate entry \(update it\)/, text);
  assert.equal(code, 1);
});

test('migrate: a framework whose migrate entry has no migrateTarget is one clear error line', async () => {
  const brand = stageLegacyBrand();
  // An older framework: the subpath exists, the one export every leg answers with does not
  write(path.join(brand, 'node_modules', '@omega.js', 'extension', 'migrate.js'), 'module.exports = { runMigration() {} };\n');

  const { text, code } = await runMigrate(brand, { execute: true });

  assert.match(block(text, 'extension'), /error\s+@omega\.js\/extension exposes a migrate entry without migrateTarget \(update it\)/, text);
  assert.doesNotMatch(text, /is not a function/);
  assert.equal(code, 1);
});

test('migrate --execute: by-hand steps left due never fail the run', async () => {
  const brand = stageLegacyBrand();
  write(path.join(brand, 'targets', 'web', 'src', '_layouts', 'post.html'), '{% post_url 2020-01-01-x %}\n');

  const { text, code } = await runMigrate(brand, { execute: true });

  assert.match(block(text, 'web'), /due\s+src\/_layouts\/post\.html:1: Jekyll-only tag/, text);
  assert.equal(code, undefined, 'only a refusal fails an --execute run');
});
