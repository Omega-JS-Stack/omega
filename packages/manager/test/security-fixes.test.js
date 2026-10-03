// Tests for the wave-2 security fix-batch (cp259): env-secret writeback
// (MGR-5), webhook-URL redaction (MGR-1), and token-store file modes (MGR-8).

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeEnvValue } = require('../src/lib/env-secret.js');
const { envLine } = require('@omega.js/config');
const dotenv = require('dotenv');
const { redactWebhookUrl, buildWebhookUrl } = require('../src/services/payment/lib/payment-utils.js');
const { GoogleOAuth2Client } = require('../src/lib/google-auth.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-secfix-'));
}

module.exports = defineCases({
  type: 'group',
  description: 'security-fixes',
  tests: [
    {
      name: 'envLine writes quotes and backslashes raw, a newline as the two characters \\n',
      run: (ctx) => {
        ctx.expect(envLine('K', 'plain')).toBe('K="plain"');
        ctx.expect(envLine('K', 'a"b')).toBe('K="a"b"');
        ctx.expect(envLine('K', 'a\\b')).toBe('K="a\\b"');
        ctx.expect(envLine('K', 'a\nb')).toBe('K="a\\nb"');
      },
    },

    {
      name: 'writeEnvValue appends through envLine, and dotenv reads the value back as given',
      run: (ctx) => {
        const root = tmpDir();
        writeEnvValue(root, 'OMEGA_TEST_SECRET', 'pa"ss\\\nword');

        const content = fs.readFileSync(path.join(root, '.env'), 'utf8');
        ctx.expect(content.includes('OMEGA_TEST_SECRET="pa"ss\\\\nword"'), `unexpected: ${content}`).toBeTruthy();
        ctx.expect(dotenv.parse(content).OMEGA_TEST_SECRET).toBe('pa"ss\\\nword');
      },
    },

    {
      name: 'writeEnvValue refuses a value that would run into the next line, naming the key only',
      run: (ctx) => {
        const root = tmpDir();
        // A trailing backslash escapes the closing quote, so dotenv reads on to the
        // next quote in the file when only a comment follows it.
        fs.writeFileSync(path.join(root, '.env'), 'OMEGA_TEST_SECRET="old"\n# a note ending in a quote"\n');

        ctx.expect(() => writeEnvValue(root, 'OMEGA_TEST_SECRET', 'ends-secret\\')).toThrow((error) => {
          ctx.expect(error.message).toMatch(/OMEGA_TEST_SECRET/);
          ctx.expect(!error.message.includes('ends-secret'), 'the value never reaches the message').toBeTruthy();
          return true;
        });
        ctx.expect(fs.readFileSync(path.join(root, '.env'), 'utf8').includes('ends-secret'), 'nothing is written').toBe(false);
      },
    },

    {
      name: 'writeEnvValue replace path does not expand $-patterns in the secret',
      run: (ctx) => {
        const root = tmpDir();
        writeEnvValue(root, 'OMEGA_TEST_SECRET', 'first-value');
        // $& and $1 are String.replace expansion patterns — a replacer function
        // must deliver them verbatim
        writeEnvValue(root, 'OMEGA_TEST_SECRET', 'weird$&pass$1word');

        const content = fs.readFileSync(path.join(root, '.env'), 'utf8');
        ctx.expect(content.includes('OMEGA_TEST_SECRET="weird$&pass$1word"'), `unexpected: ${content}`).toBeTruthy();
        ctx.expect(!content.includes('first-value'), 'old value should be replaced').toBeTruthy();
      },
    },

    {
      name: 'writeEnvValue replaces every assignment of the key, the export and indented forms included',
      run: (ctx) => {
        for (const later of ['export MY_SECRET="b"', '  MY_SECRET="b"']) {
          const root = tmpDir();
          fs.writeFileSync(path.join(root, '.env'), `MY_SECRET="a"\n${later}\n`);
          writeEnvValue(root, 'MY_SECRET', 'new');

          const content = fs.readFileSync(path.join(root, '.env'), 'utf8');
          ctx.expect(content.match(/^\s*(?:export\s+)?MY_SECRET\s*=/gm).length, later).toBe(1);
          ctx.expect(dotenv.parse(content).MY_SECRET).toBe('new');
        }
      },
    },

    {
      name: 'writeEnvValue replaces a multi-line quoted value whole',
      run: (ctx) => {
        const root = tmpDir();
        // A marked file: its Custom section is kept verbatim, so nothing but the
        // writer can drop a continuation line
        writeEnvValue(root, 'OTHER', 'x');
        fs.appendFileSync(path.join(root, '.env'), 'MY_SECRET="first\nsecond"\n');
        writeEnvValue(root, 'MY_SECRET', 'new');

        const content = fs.readFileSync(path.join(root, '.env'), 'utf8');
        ctx.expect(content.includes('second'), `a continuation line survived: ${content}`).toBe(false);
        ctx.expect(dotenv.parse(content)).toEqual({ MY_SECRET: 'new', OTHER: 'x' });
      },
    },

    {
      name: 'redactWebhookUrl masks the key param and keeps the rest',
      run: (ctx) => {
        const brandConfig = { brand: { url: 'https://example.com' } };
        process.env.OMEGA_WEBHOOK_KEY = 'super-secret-key';
        const url = buildWebhookUrl(brandConfig, 'stripe');
        const redacted = redactWebhookUrl(url);

        ctx.expect(url.includes('key=super-secret-key')).toBeTruthy();
        ctx.expect(!redacted.includes('super-secret-key'), redacted).toBeTruthy();
        ctx.expect(redacted.includes('key=***'), redacted).toBeTruthy();
        ctx.expect(redacted.includes('provider=stripe'), redacted).toBeTruthy();
      },
    },

    {
      name: 'saveTokens writes the token store 0600 in a 0700 dir',
      skip: process.platform === 'win32',
      run: (ctx) => {
        const root = tmpDir();
        const storePath = path.join(root, 'auth', 'google-tokens.json');
        const client = new GoogleOAuth2Client({ tokenStorePath: storePath, scopes: ['a'] });

        client.saveTokens({ refresh_token: 'fake', access_token: 'fake' });

        const fileMode = fs.statSync(storePath).mode & 0o777;
        const dirMode = fs.statSync(path.dirname(storePath)).mode & 0o777;
        ctx.expect(fileMode).toBe(0o600);
        ctx.expect(dirMode).toBe(0o700);

        // Pre-existing loose file AND directory both get tightened on the next save
        fs.chmodSync(storePath, 0o644);
        fs.chmodSync(path.dirname(storePath), 0o755);
        client.saveTokens({ access_token: 'fake2' });
        ctx.expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
        ctx.expect(fs.statSync(path.dirname(storePath)).mode & 0o777).toBe(0o700);
      },
    },
  ],
});
