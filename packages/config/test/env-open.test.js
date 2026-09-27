/**
 * The .env layer stays OPEN: a key outside omega, or a retired one, is a line
 * running code never reads, and loading it never throws. `omega migrate` is
 * the only code that knows an old env name.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadEnvChain } = require('../src/index.js');

test('loadEnvChain: a retired env key loads like any other line, never a throw', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-open-'));
  const keys = ['ENVOPEN_KEEP', 'EDGE_PRODUCT_ID', 'OAUTH2_GOOGLE_CLIENT_ID'];
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    keys.forEach((key) => delete process.env[key]);
  });

  const envPath = path.join(root, '.env');
  fs.writeFileSync(envPath, 'ENVOPEN_KEEP="kept"\nEDGE_PRODUCT_ID="11111111-2222-3333-4444-555555555555"\nOAUTH2_GOOGLE_CLIENT_ID="old-name"\n');

  assert.deepStrictEqual(loadEnvChain([envPath]), [envPath]);
  assert.strictEqual(process.env.ENVOPEN_KEEP, 'kept', 'the layer loaded whole');
});
