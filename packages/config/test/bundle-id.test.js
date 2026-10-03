/**
 * bundle-id.js: the ONE reverse-DNS bundle-identifier policy
 * ([#909](https://github.com/Omega-JS-Stack/omega/issues/909)). It lived in the
 * manager, where only the certificates service could reach it, while the
 * desktop build derived its own `app.appId` from the brand URL host: one app,
 * signed under one id and registered under another. The policy is config's
 * now, so both readers compose the same identifier.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { deriveBundleIdPrefix, composeBundleId } = require('../src/index.js');

module.exports = defineCases({
  type: 'group',
  description: 'bundle-id',
  tests: [
    {
      name: 'bundle-id: reverse-DNS derivation plus dash-to-dot composition',
      run: (ctx) => {
        ctx.expect(deriveBundleIdPrefix('https://itwcreativeworks.com')).toBe('com.itwcreativeworks');
        ctx.expect(deriveBundleIdPrefix('https://www.acme.io/some/path')).toBe('io.acme');
        ctx.expect(deriveBundleIdPrefix('https://playground.omegajs.dev')).toBe('dev.omegajs.playground');
        ctx.expect(deriveBundleIdPrefix('not a url')).toBe(null);

        ctx.expect(composeBundleId('com.itwcreativeworks', 'omega-playground')).toBe('com.itwcreativeworks.omega.playground');
        ctx.expect(composeBundleId('com.fixture', 'fixture-brand')).toBe('com.fixture.fixture.brand');
        // The id the desktop build composes for a company brand (#909): the prefix
        // plus the brand id, every dash its own segment.
        ctx.expect(composeBundleId('com.itwcreativeworks', 'my-app')).toBe('com.itwcreativeworks.my.app');
      },
    },
  ],
});
