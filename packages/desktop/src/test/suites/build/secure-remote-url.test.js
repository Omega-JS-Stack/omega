// Build-layer unit tests for utils/secure-remote-url.js — the transport gate
// shared by lib/remote-scripts.js and lib/remote-config.js.

const { isSecureRemoteUrl } = require('../../../utils/secure-remote-url.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'secure-remote-url (build)',
  tests: [
    {
      name: 'https URLs pass',
      run: (ctx) => {
        ctx.expect(isSecureRemoteUrl('https://brand.example/data/scripts/main.js')).toBe(true);
      },
    },
    {
      name: 'http URLs fail on non-loopback hosts',
      run: (ctx) => {
        ctx.expect(isSecureRemoteUrl('http://brand.example/data/scripts/main.js')).toBe(false);
      },
    },
    {
      name: 'http loopback allowed for dev (localhost, 127.0.0.1, ::1)',
      run: (ctx) => {
        ctx.expect(isSecureRemoteUrl('http://localhost:4000/main.js')).toBe(true);
        ctx.expect(isSecureRemoteUrl('http://127.0.0.1/main.js')).toBe(true);
        ctx.expect(isSecureRemoteUrl('http://[::1]:4000/main.js')).toBe(true);
      },
    },
    {
      name: 'non-http(s) schemes and unparseable URLs fail closed',
      run: (ctx) => {
        ctx.expect(isSecureRemoteUrl('file:///etc/hosts')).toBe(false);
        ctx.expect(isSecureRemoteUrl('ftp://brand.example/x')).toBe(false);
        ctx.expect(isSecureRemoteUrl('not a url')).toBe(false);
        ctx.expect(isSecureRemoteUrl('')).toBe(false);
      },
    },
  ],
});
