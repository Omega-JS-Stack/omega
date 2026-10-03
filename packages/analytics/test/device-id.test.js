/**
 * device-id tests — the ONE derivation every surface's client_id starts from
 * ([#396](https://github.com/Omega-JS-Stack/omega/issues/396)): the stored value
 * wins, the host's seed strategy is next, and a UUID is the floor.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const core = require('../src/core.js');

// RFC 4122 v4, spelled out rather than borrowed from the implementation.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A host's persistence pair, counting its calls so "no re-derive" is provable.
function memoryStore(initial = null) {
  const store = { value: initial, reads: 0, writes: 0 };

  return {
    store,
    get: () => {
      store.reads++;
      return store.value;
    },
    set: (value) => {
      store.writes++;
      store.value = value;
    },
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'device-id',
  tests: [
    {
      name: 'persistence is REQUIRED — a host without one is a programmer error',
      run: (ctx) => {
        ctx.expect(() => core.deriveDeviceId()).toThrow(/requires get and set/);
        ctx.expect(() => core.deriveDeviceId({ get: () => null })).toThrow(/requires get and set/);
        ctx.expect(() => core.deriveDeviceId({ set: () => {} })).toThrow(/requires get and set/);
      },
    },

    {
      name: 'the stored id wins — a second call re-reads it and never re-derives',
      run: (ctx) => {
        const { store, get, set } = memoryStore('11111111-2222-4333-8444-555555555555');
        let seeds = 0;
        const seed = () => {
          seeds++;
          return 'aa:bb:cc:dd:ee:ff';
        };

        ctx.expect(core.deriveDeviceId({ get, set, seed })).toBe('11111111-2222-4333-8444-555555555555');
        ctx.expect(core.deriveDeviceId({ get, set, seed })).toBe('11111111-2222-4333-8444-555555555555');
        ctx.expect(seeds, 'a stored id never asks the seed strategy').toBe(0);
        ctx.expect(store.writes, 'a stored id is never rewritten').toBe(0);
      },
    },

    {
      name: 'the seed strategy is next — its value is what persists (desktop MAC)',
      run: (ctx) => {
        const { store, get, set } = memoryStore();

        const first = core.deriveDeviceId({ get, set, seed: () => 'aa:bb:cc:dd:ee:ff' });

        ctx.expect(first, 'the seed strategy owns the first derivation').toBe('aa:bb:cc:dd:ee:ff');
        ctx.expect(store.value, 'and it is persisted for the next boot').toBe('aa:bb:cc:dd:ee:ff');
        ctx.expect(store.writes).toBe(1);

        // Round-trip: the same store, a seed that would answer differently now
        const second = core.deriveDeviceId({ get, set, seed: () => '00:11:22:33:44:55' });

        ctx.expect(second, 'the persisted id outlives a changed seed').toBe('aa:bb:cc:dd:ee:ff');
      },
    },

    {
      name: 'no seed and an empty seed both fall to a generated UUID (web/client)',
      run: (ctx) => {
        const withoutSeed = memoryStore();
        const generated = core.deriveDeviceId({ get: withoutSeed.get, set: withoutSeed.set });

        ctx.expect(generated, 'the generated path is a real UUID, never a random string').toMatch(UUID_V4);
        ctx.expect(withoutSeed.store.value, 'persisted, so the second call returns it').toBe(generated);
        ctx.expect(core.deriveDeviceId({ get: withoutSeed.get, set: withoutSeed.set })).toBe(generated);

        // A seed that finds nothing (no non-internal MAC) is the same as no seed
        const emptySeed = memoryStore();
        const fallback = core.deriveDeviceId({ get: emptySeed.get, set: emptySeed.set, seed: () => null });

        ctx.expect(fallback).toMatch(UUID_V4);
        ctx.expect(fallback, 'each install generates its own').not.toBe(generated);
      },
    },

    {
      name: 'the derived id is what client_id is hashed from',
      run: (ctx) => {
        const { get, set } = memoryStore();

        const deviceId = core.deriveDeviceId({ get, set, seed: () => 'aa:bb:cc:dd:ee:ff' });
        const namespace = core.deriveNamespace('proj-x');

        // uuidv5('aa:bb:cc:dd:ee:ff', uuidv5('proj-x', uuidv5.URL)) — hard-coded so a
        // change in either derivation is caught here rather than agreeing with itself.
        ctx.expect(core.deriveClientId(deviceId, namespace)).toBe('82818a95-efc5-581c-8e9f-a137330db9e0');
      },
    },
  ],
});
