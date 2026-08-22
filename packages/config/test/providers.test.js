/**
 * providers.js — the one provider shape (#425). Key presence in a role's
 * `providers` block IS the pick, so this read replaces every flat
 * `provider: 'x'` string the config used to carry. The tri-state (absent =
 * unset, `false` = disabled, object = chosen) is the contract every
 * single-provider role gates on, which is why it is pinned here.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { chosenProvider } = require('../src/index.js');

test('the present key is the chosen provider', () => {
  assert.strictEqual(chosenProvider({ namecheap: {} }), 'namecheap');
  assert.strictEqual(chosenProvider({ ghostii: { orgs: [] } }), 'ghostii');
  // An empty entry still opts in — presence is the pick, not the contents.
  assert.strictEqual(chosenProvider({ chatgpt: {} }), 'chatgpt');
});

test('no block, an empty block, or a non-object is nothing chosen', () => {
  assert.strictEqual(chosenProvider(undefined), null);
  assert.strictEqual(chosenProvider(null), null);
  assert.strictEqual(chosenProvider({}), null);
  assert.strictEqual(chosenProvider('cloudflare'), null);
  assert.strictEqual(chosenProvider([{ cloudflare: {} }]), null);
});

test('false is the deliberate off switch, and the next live entry wins', () => {
  assert.strictEqual(chosenProvider({ squarespace: false }), null);
  assert.strictEqual(chosenProvider({ squarespace: false, namecheap: {} }), 'namecheap');
});
