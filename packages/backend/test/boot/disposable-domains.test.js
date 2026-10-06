/**
 * Test: the disposable-domain seed/cache contract (libraries/email/disposable-domains.js)
 *
 * Issue #68 — a refresh must never dirty the git tree. Real seams throughout:
 * the only thing stubbed is the network fetch; the cache and seed are the real
 * files on disk, and git itself is asked whether anything moved.
 *
 * Lives in the boot/ layer (framework self-test only) because it asks git about
 * the framework checkout — a consumer's installed copy has no repo to ask.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const jetpack = require('fs-jetpack');

const dataset = require('../../dist/omega/libraries/email/disposable-domains.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const PACKAGE_DIR = path.resolve(__dirname, '../..');

// Upstream's format: one lowercase domain per line.
const STUBBED_LIST = 'zzz-stub-refresh.example\nAAA-Stub-Refresh.example\n\nzzz-stub-refresh.example\n';

// `git status` scoped to this package — other packages may be dirty for reasons
// that are not ours.
function gitStatus() {
  return execFileSync('git', ['status', '--porcelain', '--', PACKAGE_DIR], { cwd: PACKAGE_DIR, encoding: 'utf8' });
}

// Swap the cache aside for the duration of fn, restoring exactly what was there.
async function withCacheStashed(fn) {
  const existing = jetpack.read(dataset.CACHE_PATH);
  jetpack.remove(dataset.CACHE_PATH);
  try {
    return await fn();
  } finally {
    if (existing === undefined) {
      jetpack.remove(dataset.CACHE_PATH);
    } else {
      jetpack.write(dataset.CACHE_PATH, existing);
    }
  }
}

module.exports = defineCases({
  description: 'Disposable-domain dataset (seed + gitignored refresh cache)',
  type: 'group',

  tests: [
    {
      name: 'refresh-writes-the-cache-and-dirties-nothing-under-git',
      timeout: 15000,

      async run({ expect }) {
        const seedBefore = jetpack.read(dataset.SEED_PATH);
        const seedMtimeBefore = jetpack.inspect(dataset.SEED_PATH, { times: true }).modifyTime.getTime();
        const statusBefore = gitStatus();

        const originalFetch = global.fetch;
        let fetchedUrl = null;
        let seedAfter = null;
        let seedMtimeAfter = null;
        let statusAfter = null;

        try {
          await withCacheStashed(async () => {
            global.fetch = async (url) => {
              fetchedUrl = url;
              return { ok: true, text: async () => STUBBED_LIST };
            };

            const result = await dataset.refresh();

            seedAfter = jetpack.read(dataset.SEED_PATH);
            seedMtimeAfter = jetpack.inspect(dataset.SEED_PATH, { times: true }).modifyTime.getTime();
            statusAfter = gitStatus();

            expect(fetchedUrl, 'refresh fetches the upstream list').toBe(dataset.SOURCE_URL);
            expect(result.path, 'refresh reports the cache path').toBe(dataset.CACHE_PATH);
            expect(jetpack.read(dataset.CACHE_PATH, 'json'), 'the cache holds the deduped, lowercased, sorted list').toEqual(['aaa-stub-refresh.example', 'zzz-stub-refresh.example']);
          });
        } finally {
          global.fetch = originalFetch;
          // If the thing under test DID write the seed, put the committed bytes
          // back before failing — a regression here must not leave the tracked
          // file holding the stub list.
          if (jetpack.read(dataset.SEED_PATH) !== seedBefore) {
            jetpack.write(dataset.SEED_PATH, seedBefore);
          }
        }

        expect(seedAfter, 'the committed seed is byte-identical after a refresh').toBe(seedBefore);
        expect(seedMtimeAfter, 'the committed seed was not even opened for writing').toBe(seedMtimeBefore);
        expect(statusAfter, 'a refresh leaves git status unchanged').toBe(statusBefore);
      },
    },

    {
      name: 'cache-path-is-gitignored',
      timeout: 10000,

      async run({ expect }) {
        // check-ignore exits 1 when the path is NOT ignored — the whole contract
        // rests on this, so ask git rather than trusting the .gitignore text.
        const ignored = execFileSync('git', ['check-ignore', '--', dataset.CACHE_PATH], { cwd: PACKAGE_DIR, encoding: 'utf8' });

        expect(ignored.trim().length > 0, 'git reports the refresh cache path as ignored').toBeTruthy();
      },
    },

    {
      name: 'lookups-serve-the-seed-when-no-cache-exists',
      timeout: 15000,

      async run({ expect }) {
        await withCacheStashed(async () => {
          const seed = jetpack.read(dataset.SEED_PATH, 'json');

          expect(dataset.load(), 'load() falls back to the committed seed').toEqual(seed);

          // The real lookup path, re-required with no cache on disk.
          delete require.cache[require.resolve('../../dist/omega/libraries/email/validation.js')];
          const { isDisposable } = require('../../dist/omega/libraries/email/validation.js');

          expect(isDisposable(`user@${seed[0]}`), 'a seed domain is still blocked with no cache present').toBe(true);
          expect(isDisposable('user@gmail.com'), 'a real provider is not blocked').toBe(false);
        });

        delete require.cache[require.resolve('../../dist/omega/libraries/email/validation.js')];
      },
    },

    {
      name: 'a-present-cache-wins-over-the-seed',
      timeout: 15000,

      async run({ expect }) {
        await withCacheStashed(async () => {
          jetpack.write(dataset.CACHE_PATH, `${JSON.stringify(['zzz-cache-wins.example'], null, 2)}\n`);

          expect(dataset.load(), 'load() prefers a usable cache').toEqual(['zzz-cache-wins.example']);

          // An unparseable cache is an expected external condition — never a throw.
          jetpack.write(dataset.CACHE_PATH, '{ not json');

          expect(dataset.load(), 'a corrupt cache falls back to the seed').toEqual(jetpack.read(dataset.SEED_PATH, 'json'));
        });
      },
    },
  ],
});
