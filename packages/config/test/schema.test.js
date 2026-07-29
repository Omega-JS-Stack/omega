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
    ['brand', 'cloud', 'analytics', 'advertising', 'payment', 'monitoring', 'oauth2', 'theme', 'translation'],
  );
});

test('advertising schema: role-keyed providers with the inhouse source (ads spec)', () => {
  const { SHARED_SCHEMA } = require('../src/schema.js');
  const paths = SHARED_SCHEMA.map((entry) => entry.path);

  assert.ok(paths.includes('advertising.providers.google-adsense.client'));
  assert.ok(paths.includes('advertising.providers.inhouse.source'));
  assert.ok(paths.includes('company.url'));
  for (const slot of ['display-slot', 'in-article-slot', 'in-feed-slot', 'multiplex-slot']) {
    assert.ok(paths.includes(`advertising.providers.google-adsense.${slot}`), `missing ${slot}`);
  }
});
