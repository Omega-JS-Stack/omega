/**
 * The .env layer stays OPEN: a key outside omega, or a retired one, is a line
 * running code never reads, and loading it never throws. `omega migrate` is
 * the only code that knows an old env name.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadEnvChain } = require('../src/index.js');

module.exports = defineCases({
  type: 'group',
  description: 'env-open',
  tests: [
    {
      name: 'loadEnvChain: a retired env key loads like any other line, never a throw',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-open-'));
        const keys = ['ENVOPEN_KEEP', 'EDGE_PRODUCT_ID', 'OAUTH2_GOOGLE_CLIENT_ID'];
        ctx.after(() => {
          fs.rmSync(root, { recursive: true, force: true });
          keys.forEach((key) => delete process.env[key]);
        });

        const envPath = path.join(root, '.env');
        fs.writeFileSync(envPath, 'ENVOPEN_KEEP="kept"\nEDGE_PRODUCT_ID="11111111-2222-3333-4444-555555555555"\nOAUTH2_GOOGLE_CLIENT_ID="old-name"\n');

        ctx.expect(loadEnvChain([envPath])).toEqual([envPath]);
        ctx.expect(process.env.ENVOPEN_KEEP, 'the layer loaded whole').toBe('kept');
      },
    },
  ],
});
