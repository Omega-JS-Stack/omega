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
  // vanish instead of failing — every documented knob is declared here.
  for (const key of ['provider', 'org', 'dsn', 'environment', 'sampleRate', 'tracesSampleRate', 'scrubEmail', 'attachScreenshot', 'bundlePatterns']) {
    assert.ok(paths.includes(`monitoring.${key}`), `missing monitoring.${key}`);
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
