/**
 * Test: Ads inventory cache (TTL behavior)
 *
 * Exercises getInventory() against the REAL emulator Firestore from the
 * runner process (the runner and the emulator workers each hold their own
 * module-level cache — the semantics are identical). Cache tests pass an
 * explicit ttl because the emulator default is 0 (always fresh for dev/tests).
 *
 * Run: npx omega test backend:routes/ads/cache
 */
const { getInventory, resetInventoryCache } = require('../../../src/manager/routes/ads/utils.js');

const TTL = 10 * 60 * 1000; // long enough to never expire mid-suite

module.exports = {
  description: 'Ads inventory cache',
  type: 'suite',
  tests: [
    {
      name: 'fresh-fetch-reads-enabled-ads-only',
      async run({ assert, firestore, Manager }) {
        await firestore.set('ads/cache-a', { id: 'cache-a', enabled: true, title: 'A', link: 'https://a.example', weight: 1 });
        await firestore.set('ads/cache-b', { id: 'cache-b', enabled: true, title: 'B', link: 'https://b.example', weight: 1 });
        await firestore.set('ads/cache-disabled', { id: 'cache-disabled', enabled: false, title: 'D', link: 'https://d.example', weight: 1 });

        resetInventoryCache();

        const ads = await getInventory(Manager, { ttl: TTL });
        const ids = ads.map((ad) => ad.id);

        assert.contains(ids, 'cache-a', 'Enabled ad a should be in the inventory');
        assert.contains(ids, 'cache-b', 'Enabled ad b should be in the inventory');
        assert.ok(!ids.includes('cache-disabled'), 'Disabled ad should be filtered from the inventory');
      },
    },

    {
      name: 'within-ttl-serves-stale-cache',
      async run({ assert, firestore, Manager }) {
        await firestore.set('ads/cache-late', { id: 'cache-late', enabled: true, title: 'Late', link: 'https://late.example', weight: 1 });

        const ads = await getInventory(Manager, { ttl: TTL });
        const ids = ads.map((ad) => ad.id);

        assert.ok(!ids.includes('cache-late'), 'A doc written after the fetch should NOT appear within the TTL (one read per interval)');
      },
    },

    {
      name: 'expired-ttl-refetches',
      async run({ assert, Manager }) {
        // ttl 0 → the cached fetch is always expired → fresh read
        const ads = await getInventory(Manager, { ttl: 0 });
        const ids = ads.map((ad) => ad.id);

        assert.contains(ids, 'cache-late', 'An expired TTL should refetch and see the new doc');
      },
    },

    {
      name: 'reset-busts-the-cache',
      async run({ assert, firestore, Manager }) {
        // Re-prime the cache, write, reset, and confirm the reset busts it
        await getInventory(Manager, { ttl: TTL });
        await firestore.set('ads/cache-reset', { id: 'cache-reset', enabled: true, title: 'Reset', link: 'https://reset.example', weight: 1 });

        const stale = await getInventory(Manager, { ttl: TTL });
        assert.ok(!stale.map((ad) => ad.id).includes('cache-reset'), 'Cache should still be stale before the reset');

        resetInventoryCache();

        const fresh = await getInventory(Manager, { ttl: TTL });
        assert.contains(fresh.map((ad) => ad.id), 'cache-reset', 'resetInventoryCache() should force a fresh read');
      },
    },
  ],
};
