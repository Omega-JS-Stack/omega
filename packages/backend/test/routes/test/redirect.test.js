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
      async run({ http, assert }) {
        // /omega/health is a GET route on this same backend, so following
        // the redirect lands on its payload — proof the redirect really fired.
        const response = await http.as('none').get('backend-manager/test/redirect', {
          url: '/omega/health',
        });

        assert.isSuccess(response, 'A relative path should still redirect');
        assert.propertyEquals(response, 'data.status', 'healthy', 'The redirect landed on the health route');
      },
    },

    {
      name: 'absolute-url-refused',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').get('backend-manager/test/redirect', {
          url: 'https://evil.example.com',
        });

        assert.isError(response, 400, 'An absolute URL must be refused, not followed');
      },
    },

    {
      name: 'protocol-relative-url-refused',
      auth: 'none',
      async run({ http, assert }) {
        // `//host` and `/\host` are absolute to a browser even though they
        // start with a slash.
        for (const url of ['//evil.example.com', '/\\evil.example.com']) {
          const response = await http.as('none').get('backend-manager/test/redirect', { url });

          assert.isError(response, 400, `${url} must be refused, not followed`);
        }
      },
    },

    {
      name: 'scheme-refused',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').get('backend-manager/test/redirect', {
          url: 'javascript:alert(1)',
        });

        assert.isError(response, 400, 'A scheme of any kind must be refused');
      },
    },
  ],
});
