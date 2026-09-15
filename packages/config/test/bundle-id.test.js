/**
 * bundle-id.js: the ONE reverse-DNS bundle-identifier policy
 * ([#909](https://github.com/Omega-JS-Stack/omega/issues/909)). It lived in the
 * manager, where only the certificates service could reach it, while the
 * desktop build derived its own `app.appId` from the brand URL host: one app,
 * signed under one id and registered under another. The policy is config's
 * now, so both readers compose the same identifier.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { deriveBundleIdPrefix, composeBundleId } = require('../src/index.js');

test('bundle-id: reverse-DNS derivation plus dash-to-dot composition', () => {
  assert.equal(deriveBundleIdPrefix('https://itwcreativeworks.com'), 'com.itwcreativeworks');
  assert.equal(deriveBundleIdPrefix('https://www.acme.io/some/path'), 'io.acme');
  assert.equal(deriveBundleIdPrefix('https://playground.omegajs.dev'), 'dev.omegajs.playground');
  assert.equal(deriveBundleIdPrefix('not a url'), null);

  assert.equal(composeBundleId('com.itwcreativeworks', 'omega-playground'), 'com.itwcreativeworks.omega.playground');
  assert.equal(composeBundleId('com.fixture', 'fixture-brand'), 'com.fixture.fixture.brand');
  // The id the desktop build composes for a company brand (#909): the prefix
  // plus the brand id, every dash its own segment.
  assert.equal(composeBundleId('com.itwcreativeworks', 'my-app'), 'com.itwcreativeworks.my.app');
});
