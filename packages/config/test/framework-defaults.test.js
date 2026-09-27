/**
 * Every framework's own default config (the file a framework layers under a
 * brand, or scaffolds into one) loads STRICTLY with zero errors, through each
 * target it declares: a consumer never inherits a legacy shape from us.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

const { loadConfig, TARGETS } = require('../src/index.js');

const PACKAGES = path.join(__dirname, '..', '..');
const DEFAULT_CONFIGS = [
  'backend/templates',
  'desktop/src/defaults',
  'extension/src/defaults',
  'web/scaffold',
];

test('each framework default config loads with zero errors, whole-file and per declared target', (t) => {
  // A load records its brand in the machine registry: keep that off the real one
  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-config-home-'));
  t.after(() => {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });

  for (const relative of DEFAULT_CONFIGS) {
    const dir = path.join(PACKAGES, relative);
    const raw = JSON5.parse(fs.readFileSync(path.join(dir, 'config', 'omega.json5'), 'utf8'));
    const types = new Set(Object.values(raw.targets || {}).map((entry) => entry && entry.type).filter((type) => TARGETS.includes(type)));

    for (const target of [undefined, ...types]) {
      const { errors } = loadConfig(dir, target);
      assert.deepStrictEqual(errors, [], `${relative} (${target || 'whole file'}): ${errors.join(' | ')}`);
    }
  }
});
