/**
 * Brand-root `omega migrate` (#612) — the retired-key sweep over an
 * already-converted omega.json5. The UJM→omega converter drops the retired
 * keys on its way through; a brand ALREADY on omega.json5 only got the
 * validator's error and had to edit by hand. Editing an authored omega.json5
 * is the manager's lane, so the rule lives here.
 *
 * What these tests hold it to:
 *   - every key `@omega.js/config`'s retired-keys table names is deleted from
 *     the AUTHORED file, comments and formatting around it preserved;
 *   - one line per removed key, naming the replacement;
 *   - idempotent: a second run removes nothing and leaves the file byte-identical;
 *   - --dry-run reports the same plan and writes nothing.
 *
 * Real files on disk, run through the real command — nothing is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

const migrateCommand = require('../src/commands/migrate.js');

// A converted brand still carrying both #610 page maps and a #23 rekey.
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
      // The download page map — one card per platform.
      download: {
        mac: 'https://cdn.fixture-brand.test/mac.dmg',
      },

      extension: { chrome: 'https://chrome.test/abc' }, // store listings

      redirects: [], // keep me
    },
    backend: {}, // enabled, defaults
  },
}
`;

function stageBrand(source = CONVERTED) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-migrate-')));
  const brand = path.join(scratch, 'brand');
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'fixture-brand', private: true }));
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), source);
  return brand;
}

/** Run the command from `brand` with console.log captured. */
async function runMigrate(brand, options = {}) {
  const cwd0 = process.cwd();
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  process.chdir(brand);

  try {
    await migrateCommand({ _: ['migrate'], ...options });
    return { text: lines.join('\n'), code: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

const readConfig = (brand) => fs.readFileSync(path.join(brand, 'config', 'omega.json5'), 'utf8');

// ─── The sweep ───────────────────────────────────────────────────────────────

test('migrate: every retired key is deleted from the authored config, one line each', async () => {
  const brand = stageBrand();
  const { text, code } = await runMigrate(brand);

  const parsed = JSON5.parse(readConfig(brand));
  assert.equal(parsed.targets.web.download, undefined);
  assert.equal(parsed.targets.web.extension, undefined);
  assert.equal(parsed.slapform, undefined);
  assert.equal(code, undefined, 'a successful migrate exits clean');

  // One line per removed key, each naming what replaced it
  for (const [key, replacement] of [
    ['targets.web.download', 'targets.desktop.releases'],
    ['targets.web.extension', 'targets.extension.listings'],
    ['slapform', 'forms.providers.slapform'],
  ]) {
    const line = text.split('\n').find((entry) => entry.includes(key));
    assert.ok(line, `no line for ${key}`);
    assert.ok(line.includes(replacement), `the ${key} line does not name its replacement: ${line}`);
  }
});

test('migrate: everything the retired keys sat beside survives, byte for byte', async () => {
  const brand = stageBrand();
  await runMigrate(brand);
  const written = readConfig(brand);

  assert.ok(written.includes('// Fixture Brand — brand-level omega.json5'));
  assert.ok(written.includes("id: 'fixture-brand',"));
  assert.ok(written.includes('redirects: [], // keep me'));
  assert.ok(written.includes('backend: {}, // enabled, defaults'));
  // The removed keys took their own documentation with them
  assert.ok(!written.includes('The download page map'));
  assert.ok(!written.includes('Contact form provider'));
  assert.ok(!written.includes('store listings'));
  // And the config still loads
  assert.equal(JSON5.parse(written).brand.name, 'Fixture Brand');
});

test('migrate: idempotent — the second run removes nothing and rewrites nothing', async () => {
  const brand = stageBrand();
  await runMigrate(brand);
  const afterFirst = readConfig(brand);

  const { text, code } = await runMigrate(brand);
  assert.equal(readConfig(brand), afterFirst, 'the rerun rewrote the file');
  assert.equal(code, undefined);
  assert.match(text, /no retired keys/i);
});

test('migrate --dry-run: reports the same plan and writes nothing', async () => {
  const brand = stageBrand();
  const { text } = await runMigrate(brand, { 'dry-run': true, dryRun: true });

  assert.equal(readConfig(brand), CONVERTED, 'a dry run wrote to the config');
  assert.ok(text.includes('targets.web.download'));
  assert.ok(text.includes('slapform'));
});

test('migrate: a clean brand says so and touches nothing', async () => {
  const clean = `{\n  brand: { id: 'b', name: 'B', url: 'https://b.test' },\n  targets: { web: {} },\n}\n`;
  const brand = stageBrand(clean);
  const { text, code } = await runMigrate(brand);

  assert.equal(readConfig(brand), clean);
  assert.match(text, /no retired keys/i);
  assert.equal(code, undefined);
});

test('migrate: outside a brand monorepo it refuses loudly instead of guessing', async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-migrate-bare-')));
  const { text, code } = await runMigrate(scratch);

  assert.equal(code, 1);
  assert.match(text, /brand monorepo/i);
});
