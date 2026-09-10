// sanitize-signing-env tests — empty-string signing placeholders read as
// unset (app-builder-lib would otherwise path.resolve('') to the project root
// and fail with "<projectRoot> not a file").

const sanitizeSigningEnv = require('../../../utils/sanitize-signing-env.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'sanitize-signing-env',
  tests: [
    {
      name: 'deletes empty-string signing keys and reports them',
      run: (ctx) => {
        const env = { CSC_LINK: '', CSC_KEY_PASSWORD: '', PATH: '/usr/bin' };
        const removed = sanitizeSigningEnv(env);

        ctx.expect(removed.sort()).toEqual(['CSC_KEY_PASSWORD', 'CSC_LINK']);
        ctx.expect('CSC_LINK' in env).toBe(false);
        ctx.expect('CSC_KEY_PASSWORD' in env).toBe(false);
        ctx.expect(env.PATH).toBe('/usr/bin');
      },
    },
    {
      name: 'whitespace-only values count as empty',
      run: (ctx) => {
        const env = { WIN_CSC_LINK: '   ', APPLE_API_KEY: '\t' };
        const removed = sanitizeSigningEnv(env);

        ctx.expect(removed.sort()).toEqual(['APPLE_API_KEY', 'WIN_CSC_LINK']);
        ctx.expect('WIN_CSC_LINK' in env).toBe(false);
      },
    },
    {
      name: 'the Windows signing keys are covered; the retired runner-logon keys are not',
      run: (ctx) => {
        // The self-hosted signer reads all of these; an empty placeholder on any
        // of them used to survive into signtool's arguments as an empty string.
        const env = {
          WIN_EV_TOKEN_PATH:    '',
          WIN_CSC_KEY_PASSWORD: '  ',
          WIN_TIMESTAMP_URL:    '',
          SIGNTOOL_PATH:        '',
        };
        const removed = sanitizeSigningEnv(env);

        ctx.expect(removed.sort()).toEqual([
          'SIGNTOOL_PATH',
          'WIN_CSC_KEY_PASSWORD',
          'WIN_EV_TOKEN_PATH',
          'WIN_TIMESTAMP_URL',
        ]);
        ctx.expect(Object.keys(env).length).toBe(0);

        // The runner logon keys are retired ([#337]) — the runner has no service
        // and no task to hand an account to, so nothing reads them.
        ctx.expect(sanitizeSigningEnv.SIGNING_ENV_KEYS).not.toContain('WIN_RUNNER_LOGON_ACCOUNT');
        ctx.expect(sanitizeSigningEnv.SIGNING_ENV_KEYS).not.toContain('WIN_RUNNER_LOGON_PASSWORD');
      },
    },
    {
      name: 'real values are NEVER touched',
      run: (ctx) => {
        const env = {
          CSC_LINK: 'config/certs/developer-id-application.p12',
          CSC_KEY_PASSWORD: 'hunter2',
          APPLE_TEAM_ID: 'ABCDE12345',
        };
        const removed = sanitizeSigningEnv(env);

        ctx.expect(removed).toEqual([]);
        ctx.expect(env.CSC_LINK).toBe('config/certs/developer-id-application.p12');
        ctx.expect(env.CSC_KEY_PASSWORD).toBe('hunter2');
        ctx.expect(env.APPLE_TEAM_ID).toBe('ABCDE12345');
      },
    },
    {
      name: 'unset keys stay unset (no accidental creation)',
      run: (ctx) => {
        const env = {};
        const removed = sanitizeSigningEnv(env);

        ctx.expect(removed).toEqual([]);
        ctx.expect(Object.keys(env).length).toBe(0);
      },
    },
    {
      name: 'non-string values (paranoia) are left alone',
      run: (ctx) => {
        const env = { CSC_LINK: undefined };
        sanitizeSigningEnv(env);
        // The key exists with undefined — typeof undefined !== 'string', untouched.
        ctx.expect('CSC_LINK' in env).toBe(true);
      },
    },
  ],
});
