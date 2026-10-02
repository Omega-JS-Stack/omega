/**
 * Unit tests for @omega.js/config's named env rules: the small set every
 * `requiredWhen` and `askedWhen` in the env schema is written with. A rule is
 * a function of the brand's config that answers true or false; each one here
 * meets a config that makes it hold and one that does not.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { holds, onUnlessOff, chosen, hasTarget, realProject, all, any } = require('../src/env-when.js');

test('holds(path): a value at the path holds, an absent or empty one does not', () => {
  const rule = holds('captcha.providers.recaptcha.siteKey');

  assert.equal(rule({ captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } }), true);
  assert.equal(rule({}), false);
  assert.equal(rule({ captcha: { providers: { recaptcha: {} } } }), false);
  assert.equal(rule({ captcha: { providers: { recaptcha: { siteKey: '' } } } }), false, 'an empty string is not a value');
  assert.equal(rule({ captcha: { providers: { recaptcha: { siteKey: null } } } }), false);
});

test('holds(path): an object at the path holds, even an empty one, and false does not', () => {
  const rule = holds('platforms.linux.formats.snap');

  assert.equal(rule({ platforms: { linux: { formats: { snap: { channels: ['stable'] } } } } }), true);
  assert.equal(rule({ platforms: { linux: { formats: { snap: {} } } } }), true, 'an empty settings block is still a declared format');
  assert.equal(rule({ platforms: { linux: { formats: { snap: false } } } }), false, 'the format dropped');
});

test('onUnlessOff(path): absent means on, and only a literal false turns it off', () => {
  const rule = onUnlessOff('captcha.providers.recaptcha.enabled');

  assert.equal(rule({}), true, 'a config that says nothing has the feature on');
  assert.equal(rule({ captcha: { providers: { recaptcha: { enabled: true } } } }), true);
  assert.equal(rule({ captcha: { providers: { recaptcha: { enabled: false } } } }), false);
});

test('chosen(path, name): holds only when the path names that provider', () => {
  const rule = chosen('platforms.windows.signing.cloud.provider', 'azure');
  const provider = (name) => ({ platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: name } } } } });

  assert.equal(rule(provider('azure')), true);
  assert.equal(rule(provider('sslcom')), false, 'another provider owes nothing of this one');
  assert.equal(rule({}), false);
});

test('hasTarget(...types): holds when the brand has a target of one of those types', () => {
  const backend = hasTarget('backend');

  assert.equal(backend({ targets: { web: { type: 'web' }, backend: { type: 'backend' } } }), true);
  assert.equal(backend({ targets: { web: { type: 'web' } } }), false);
  assert.equal(backend({}), false, 'no targets, no backend');
  // The type decides, never the target's name
  assert.equal(backend({ targets: { api: { type: 'backend' } } }), true);
  assert.equal(hasTarget('web')({ targets: { site: { type: 'web' } } }), true);

  const signing = hasTarget('desktop', 'mobile');
  assert.equal(signing({ targets: { desktop: { type: 'desktop' } } }), true);
  assert.equal(signing({ targets: { mobile: { type: 'mobile' } } }), true);
  assert.equal(signing({ targets: { web: { type: 'web' }, extension: { type: 'extension' } } }), false);
});

test('realProject(): only a demo-* id fails it, and an id not yet chosen still holds', () => {
  const rule = realProject();
  const project = (projectId) => ({ cloud: { provider: 'firebase', config: { projectId } } });

  assert.equal(rule(project('acme-live')), true);
  assert.equal(rule(project('demo-acme')), false, 'a demo-* project is local only');
  // The cloud service's selection flow is how a brand gets a project, so it still runs
  assert.equal(rule({}), true, 'no project id yet is not a demo project');
  assert.equal(rule(project('')), true, 'an empty id is one not yet chosen');
});

test('all(...rules): holds only when every rule holds', () => {
  const rule = all(holds('captcha.providers.recaptcha.siteKey'), hasTarget('backend'));
  const siteKey = { captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } };

  assert.equal(rule({ ...siteKey, targets: { backend: { type: 'backend' } } }), true);
  assert.equal(rule({ ...siteKey, targets: { web: { type: 'web' } } }), false);
  assert.equal(rule({ targets: { backend: { type: 'backend' } } }), false);
});

test('any(...rules): holds when one rule holds', () => {
  const rule = any(hasTarget('desktop'), realProject());

  assert.equal(rule({ targets: { desktop: { type: 'desktop' } } }), true);
  assert.equal(rule({ cloud: { config: { projectId: 'acme-live' } }, targets: { web: { type: 'web' } } }), true);
  assert.equal(rule({ cloud: { config: { projectId: 'demo-acme' } }, targets: { web: { type: 'web' } } }), false);
  assert.equal(rule({ cloud: { config: { projectId: 'demo-acme' } }, targets: { desktop: { type: 'desktop' } } }), true);
});
