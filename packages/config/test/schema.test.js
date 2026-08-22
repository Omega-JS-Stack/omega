/**
 * Unit tests for @omega.js/config's schema module — the declared shared
 * sections and the schema paths other packages read.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SHARED_SECTIONS } = require('../src/index.js');

test('SHARED_SECTIONS enumerates the disperse-owned sections', () => {
  assert.deepStrictEqual(
    SHARED_SECTIONS,
    ['brand', 'cloud', 'repo', 'edge', 'captcha', 'search', 'forms', 'inbound', 'analytics', 'advertising', 'payment', 'monitoring', 'oauth2', 'theme', 'translation'],
  );
});

test('SHARED_SECTIONS carries the #23 role homes — disperse enumerates them like any other shared section', () => {
  for (const section of ['repo', 'edge', 'captcha', 'search', 'forms', 'inbound']) {
    assert.ok(SHARED_SECTIONS.includes(section), `${section} is a shared section and must be enumerated`);
  }
});

test('advertising schema: role-keyed providers with the inhouse source (ads spec)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  assert.ok(paths.includes('advertising.providers.adsense.client'));
  assert.ok(paths.includes('advertising.providers.inhouse.source'));
  assert.ok(paths.includes('company.url'));
  for (const slot of ['displaySlot', 'inArticleSlot', 'inFeedSlot', 'multiplexSlot']) {
    assert.ok(paths.includes(`advertising.providers.adsense.${slot}`), `missing ${slot}`);
  }

  // The vendor prefix and the kebab spellings are gone for good (#23/#35)
  assert.ok(!paths.some((path) => path.includes('google-adsense')), 'no vendor-prefixed provider id survives');
  assert.ok(!paths.some((path) => /^advertising\..*-/.test(path)), 'no kebab-case key survives under advertising');
});

test('monitoring declares every knob the monitoring package resolves (#380)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  // Undeclared keys pass validation silently, so a typo (scrubemail) would
  // vanish instead of failing — every documented knob is declared here. The
  // knobs hang off the PROVIDER since #425; only `enabled` is role-level.
  assert.ok(paths.includes('monitoring.enabled'), 'missing monitoring.enabled');
  for (const key of ['org', 'dsn', 'environment', 'sampleRate', 'tracesSampleRate', 'scrubEmail', 'attachScreenshot', 'bundlePatterns']) {
    assert.ok(paths.includes(`monitoring.providers.sentry.${key}`), `missing monitoring.providers.sentry.${key}`);
  }
});

test('the de-branded role sections are declared (#23)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  const declared = [
    'forms.providers.slapform.formId',
    'inbound.chat.providers.chatsy.agentId',
    'inbound.chat.providers.chatsy.settings',
    'inbound.email.providers.replyify.agentId',
    'edge.providers.cloudflare',
    'edge.providers.cloudflare.zone',
    'captcha.providers.recaptcha.siteKey',
    'search.providers.searchConsole.submitSitemap',
    'repo.providers.github.org',
    // the gcp/firebase fold — one cloud home, projectId only under cloud.config
    'cloud.organizationId',
    'cloud.billingAccount',
    'cloud.shared',
    'cloud.supportEmail',
    'cloud.apiSubdomain',
  ];
  for (const path of declared) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }

  assert.ok(!paths.includes('cloud.projectId'), 'projectId has ONE home: cloud.config.projectId');
  // Every config key is camelCase — no hyphen survives anywhere in the schema
  assert.ok(!paths.some((path) => path.includes('-')), 'no hyphenated config key survives');
});

test('targets.web.redirects is declared — the path-redirect map (#442)', () => {
  const { TARGET_SCHEMAS } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const rule = TARGET_SCHEMAS.web.find((entry) => entry.path === 'redirects');

  assert.ok(rule, 'missing redirects');
  assert.equal(rule.type, 'array');
  assert.match(rule.description, /:id|captured/, 'the description names the one captured segment');

  // The target chain overlays targets.web at the top level, which is the shape
  // the walker validates against.
  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(
    validateConfig({ ...base, redirects: [{ from: '/c/:id', to: '/code?id=:id', type: 301 }] }, { target: 'web' }).errors, [],
    'the entry shape passes',
  );
  assert.equal(
    validateConfig({ ...base, redirects: { '/c/:id': '/code?id=:id' } }, { target: 'web' }).errors.length, 1,
    'a map is not a redirects list — entries are ORDERED, first match wins',
  );
});

test('socials is declared — the block @omega.js/web generates shortlink pages from (#429)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const { validateConfig } = require('../src/validate.js');
  const rule = SHARED_SCHEMA.find((entry) => entry.path === 'socials');

  // Undeclared keys pass validation silently, and this block now drives real
  // output (a redirect page per entry) — it has to be a declared object.
  assert.ok(rule, 'missing socials');
  assert.equal(rule.type, 'object');
  assert.match(rule.description, /redirect/, 'the description names the shortlink lane');

  const base = { brand: { id: 'mini', name: 'MiniCo' } };
  assert.deepEqual(validateConfig({ ...base, socials: { twitter: 'somiibo' } }).errors, [], 'the string form is a handle');
  assert.deepEqual(
    validateConfig({ ...base, socials: { spotify: { handle: 'x', redirect: 'https://open.spotify.com/artist/x' } } }).errors, [],
    'the object form carries the handle plus its own redirect target',
  );
  assert.equal(validateConfig({ ...base, socials: ['twitter'] }).errors.length, 1, 'a list is not a socials block');
});
