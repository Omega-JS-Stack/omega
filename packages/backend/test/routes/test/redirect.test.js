/**
 * Test: GET /test/redirect
 * The route reflects `settings.url` into ctx.redirect(), so it may only ever
 * take a RELATIVE path — an absolute one would make it an open redirect at
 * whatever URL the backend is served from (#238).
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Redirect route (relative paths only)',
  type: 'group',
  tests: [
    {
      name: 'relative-path-redirects',
      auth: 'none',
      async run({ http, expect }) {
        // /omega/health is a GET route on this same backend, so following
        // the redirect lands on its payload — proof the redirect really fired.
        const response = await http.as('none').get('omega/test/redirect', {
          url: '/omega/health',
        });

        expect(response, 'A relative path should still redirect').toBeSuccess();
        expect(response, 'The redirect landed on the health route').toHaveProperty('data.status', 'healthy');
      },
    },

    {
      name: 'absolute-url-refused',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/test/redirect', {
          url: 'https://evil.example.com',
        });

        expect(response, 'An absolute URL must be refused, not followed').toBeError(400);
      },
    },

    {
      name: 'protocol-relative-url-refused',
      auth: 'none',
      async run({ http, expect }) {
        // `//host` and `/\host` are absolute to a browser even though they
        // start with a slash.
        for (const url of ['//evil.example.com', '/\\evil.example.com']) {
          const response = await http.as('none').get('omega/test/redirect', { url });

          expect(response, `${url} must be refused, not followed`).toBeError(400);
        }
      },
    },

    {
      name: 'scheme-refused',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').get('omega/test/redirect', {
          url: 'javascript:alert(1)',
        });

        expect(response, 'A scheme of any kind must be refused').toBeError(400);
      },
    },
  ],
});
