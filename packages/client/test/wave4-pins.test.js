/**
 * Wave-4 source pins (F1/F3/F4/F5/F9) — the findings whose behavior needs a
 * booted Firebase/Sentry SDK to exercise. These pin the fixed source shapes
 * so the defects cannot silently revert; the behavioral coverage lives in
 * the cross-stack e2e once those SDK paths run for real.
 */
const { describe, it } = require('node:test');
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers.js');

const MODULES = path.join(__dirname, '..', 'src', 'modules');
const read = (name) => fs.readFileSync(path.join(MODULES, name), 'utf8');

describe('Wave-4 source pins', () => {

  it('sentry beforeSend never derefs config.page and reads the auth storage paths auth actually writes (F1/F4)', () => {
    const source = read('sentry.js');
    assert(!source.includes('config.page.startTime'), 'the config.page.startTime deref is gone — nothing ever writes config.page');
    assert(source.includes("get('auth.user.email'"), 'user email comes from the auth storage key');
    assert(source.includes("get('auth.user.uid'"), 'uid comes from the auth storage key');
    assert(!source.includes("get('user.auth."), 'legacy user.auth.* paths are gone');
  });

  it('auth.listen guards on the same condition initialize() boots Firebase with (F3)', () => {
    const source = read('auth.js');
    assert(source.includes('_resolveFirebaseConfig()?.apiKey'), 'listen() must not proceed when Firebase cannot boot');
  });

  it('firestore onSnapshot closures are cancellation-safe in both implementations (F5)', () => {
    const source = read('firestore.js');
    const cancelledDecls = source.match(/let cancelled = false;/g) || [];
    assert.strictEqual(cancelledDecls.length, 2, 'doc AND query onSnapshot carry the cancellation flag');
    assert(!source.includes('let unsubscribe = function () {};'), 'the undetachable placeholder-noop pattern is gone');
  });

  it('account-fetch failures reach Sentry from the catch that actually sees them (F9)', () => {
    const source = read('auth.js');
    const catchBlock = source.slice(source.indexOf('Get account data error'));
    assert(catchBlock.slice(0, 400).includes('captureException'), 'capture lives in _getAccountData\'s own catch');
  });
});
