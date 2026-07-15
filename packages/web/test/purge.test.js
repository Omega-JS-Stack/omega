/**
 * cp140 — Cloudflare cache purge (the UJM cloudflare-purge successor,
 * de-ITW'd): direct API with the brand's own token, zone from config
 * `cloudflare.zone` or looked up by the brand URL's apex, clean skips
 * without a token, dry-run plans without purging. All over an injected
 * fetch recorder — no live Cloudflare in the suite.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { purgeZoneCache, apexOf } = require('../src/purge.js');

/** Recording fetcher: scripted responses in call order. */
function recorder(responses) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return responses[calls.length - 1];
  };
  return { calls, fetcher };
}

test('apexOf: derives the zone apex from a site url', () => {
  assert.strictEqual(apexOf('https://playground.omegajs.dev'), 'omegajs.dev');
  assert.strictEqual(apexOf('https://www.somiibo.com/path'), 'somiibo.com');
  assert.strictEqual(apexOf('somiibo.com'), 'somiibo.com');
  assert.strictEqual(apexOf('localhost'), null);
  assert.strictEqual(apexOf(''), null);
});

test('purge: explicit cloudflare.zone purges directly — one POST, bearer token, purge_everything', async () => {
  const { calls, fetcher } = recorder([{ success: true }]);
  const result = await purgeZoneCache({
    config: { cloudflare: { zone: 'zone-123' }, brand: { url: 'https://x.dev' } },
    token: 'tok-1',
    fetcher,
  });

  assert.deepStrictEqual(result, { status: 'purged', zone: 'zone-123', zoneName: null });
  assert.strictEqual(calls.length, 1, 'no lookup when the zone is configured');
  assert.strictEqual(calls[0].url, 'https://api.cloudflare.com/client/v4/zones/zone-123/purge_cache');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer tok-1');
  assert.deepStrictEqual(calls[0].options.body, { purge_everything: true });
});

test('purge: no configured zone → looked up by the brand apex, then purged', async () => {
  const { calls, fetcher } = recorder([
    { result: [{ id: 'zone-abc', name: 'omegajs.dev' }] },
    { success: true },
  ]);
  const result = await purgeZoneCache({
    config: { brand: { url: 'https://playground.omegajs.dev' } },
    token: 'tok-2',
    fetcher,
  });

  assert.deepStrictEqual(result, { status: 'purged', zone: 'zone-abc', zoneName: 'omegajs.dev' });
  assert.strictEqual(calls[0].url, 'https://api.cloudflare.com/client/v4/zones?name=omegajs.dev');
  assert.strictEqual(calls[1].url, 'https://api.cloudflare.com/client/v4/zones/zone-abc/purge_cache');
});

test('purge: skips cleanly — no token, invisible zone, underivable apex; zero writes', async () => {
  const none = await purgeZoneCache({ config: { brand: { url: 'https://x.dev' } }, token: '', fetcher: () => { throw new Error('must not fetch'); } });
  assert.strictEqual(none.status, 'skipped');
  assert.match(none.reason, /CLOUDFLARE_TOKEN/);

  const { calls, fetcher } = recorder([{ result: [] }]);
  const invisible = await purgeZoneCache({ config: { brand: { url: 'https://ghost.example.com' } }, token: 't', fetcher });
  assert.strictEqual(invisible.status, 'skipped');
  assert.match(invisible.reason, /no Cloudflare zone named example.com/);
  assert.strictEqual(calls.length, 1, 'lookup only, never a purge');

  const noApex = await purgeZoneCache({ config: { brand: {} }, token: 't', fetcher: () => { throw new Error('must not fetch'); } });
  assert.strictEqual(noApex.status, 'skipped');
});

test('purge: dry run resolves the zone and plans, sends no purge', async () => {
  const { calls, fetcher } = recorder([{ result: [{ id: 'zone-dry', name: 'omegajs.dev' }] }]);
  const result = await purgeZoneCache({
    config: { brand: { url: 'https://playground.omegajs.dev' } },
    token: 't',
    dryRun: true,
    fetcher,
  });

  assert.deepStrictEqual(result, { status: 'planned', zone: 'zone-dry', zoneName: 'omegajs.dev' });
  assert.strictEqual(calls.length, 1, 'lookup only');
});

test('purge: a Cloudflare error surfaces with the API detail', async () => {
  const { fetcher } = recorder([{ success: false, errors: [{ code: 9109, message: 'Invalid access token' }] }]);
  await assert.rejects(
    purgeZoneCache({ config: { cloudflare: { zone: 'z' } }, token: 'bad', fetcher }),
    /Invalid access token/
  );
});
