/**
 * device-id tests — the ONE derivation every surface's client_id starts from
 * ([#396](https://github.com/Omega-JS-Stack/omega/issues/396)): the stored value
 * wins, the host's seed strategy is next, and a UUID is the floor.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

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

test('persistence is REQUIRED — a host without one is a programmer error', () => {
  assert.throws(() => core.deriveDeviceId(), /requires get and set/);
  assert.throws(() => core.deriveDeviceId({ get: () => null }), /requires get and set/);
  assert.throws(() => core.deriveDeviceId({ set: () => {} }), /requires get and set/);
});

test('the stored id wins — a second call re-reads it and never re-derives', () => {
  const { store, get, set } = memoryStore('11111111-2222-4333-8444-555555555555');
  let seeds = 0;
  const seed = () => {
    seeds++;
    return 'aa:bb:cc:dd:ee:ff';
  };

  assert.strictEqual(core.deriveDeviceId({ get, set, seed }), '11111111-2222-4333-8444-555555555555');
  assert.strictEqual(core.deriveDeviceId({ get, set, seed }), '11111111-2222-4333-8444-555555555555');
  assert.strictEqual(seeds, 0, 'a stored id never asks the seed strategy');
  assert.strictEqual(store.writes, 0, 'a stored id is never rewritten');
});

test('the seed strategy is next — its value is what persists (desktop MAC)', () => {
  const { store, get, set } = memoryStore();

  const first = core.deriveDeviceId({ get, set, seed: () => 'aa:bb:cc:dd:ee:ff' });

  assert.strictEqual(first, 'aa:bb:cc:dd:ee:ff', 'the seed strategy owns the first derivation');
  assert.strictEqual(store.value, 'aa:bb:cc:dd:ee:ff', 'and it is persisted for the next boot');
  assert.strictEqual(store.writes, 1);

  // Round-trip: the same store, a seed that would answer differently now
  const second = core.deriveDeviceId({ get, set, seed: () => '00:11:22:33:44:55' });

  assert.strictEqual(second, 'aa:bb:cc:dd:ee:ff', 'the persisted id outlives a changed seed');
});

test('no seed and an empty seed both fall to a generated UUID (web/client)', () => {
  const withoutSeed = memoryStore();
  const generated = core.deriveDeviceId({ get: withoutSeed.get, set: withoutSeed.set });

  assert.match(generated, UUID_V4, 'the generated path is a real UUID, never a random string');
  assert.strictEqual(withoutSeed.store.value, generated, 'persisted, so the second call returns it');
  assert.strictEqual(core.deriveDeviceId({ get: withoutSeed.get, set: withoutSeed.set }), generated);

  // A seed that finds nothing (no non-internal MAC) is the same as no seed
  const emptySeed = memoryStore();
  const fallback = core.deriveDeviceId({ get: emptySeed.get, set: emptySeed.set, seed: () => null });

  assert.match(fallback, UUID_V4);
  assert.notStrictEqual(fallback, generated, 'each install generates its own');
});

test('the derived id is what client_id is hashed from', () => {
  const { get, set } = memoryStore();

  const deviceId = core.deriveDeviceId({ get, set, seed: () => 'aa:bb:cc:dd:ee:ff' });
  const namespace = core.deriveNamespace('proj-x');

  // uuidv5('aa:bb:cc:dd:ee:ff', uuidv5('proj-x', uuidv5.URL)) — hard-coded so a
  // change in either derivation is caught here rather than agreeing with itself.
  assert.strictEqual(core.deriveClientId(deviceId, namespace), '82818a95-efc5-581c-8e9f-a137330db9e0');
});
