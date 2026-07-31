// Tests for src/lib/config-flow.js — the config-landing interactive flows
// (omega-manager's schema-prompter engine reshaped onto the comment-
// preserving writeback).
//
// Interactive paths drive REAL inquirer prompts through the fake-TTY
// harness; the browser opener is stubbed via devkit's setBrowserOpener seam
// (workspace symlinks resolve to one module instance, so the seam set here
// is the one config-flow sees). Writebacks are asserted at the byte level
// against a hand-commented fixture omega.json5.

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { setPromptStreams } = require('@omega.js/devkit/prompt');
const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { makeStreams } = require('@omega.js/devkit/test/prompt-streams');
const JSON5 = require('json5');
const { resolveConfigValue, sortChoicesForBrand, setAtPath } = require('../src/lib/config-flow.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const DOWN = '\x1B[B';
const UP = '\x1B[A';

const BRAND = { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' };

const CONFIG_SOURCE = `{
  // Fixture Brand — config-flow writeback target
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  inbound: { chat: { providers: { chatsy: { enabled: true } } } }, // agent id lands here
}
`;

function makeContext({ config, options = {} } = {}) {
  const brandConfig = config || JSON5.parse(CONFIG_SOURCE);
  const brandRoot = makeBrandRoot(CONFIG_SOURCE);
  return { brandId: BRAND.id, brandRoot, brandConfig, options };
}

afterEach(() => {
  setPromptStreams(null);
  setBrowserOpener(null);
});

// ─── setAtPath / sortChoicesForBrand (pure) ──────────────────────────────────

test('config-flow: setAtPath creates intermediate objects and sets leaves', () => {
  const obj = { a: { b: 1 } };
  setAtPath(obj, 'a.c.d', 'x');
  setAtPath(obj, 'a.b', 2);
  assert.deepEqual(obj, { a: { b: 2, c: { d: 'x' } } });
});

test('config-flow: sortChoicesForBrand puts create-new first, default second, brand matches before the rest', () => {
  const items = [
    { name: 'Zeta Corp', id: '1' },
    { name: 'Fixture Brand Site', id: '2' },
    { name: 'Alpha', id: '3' },
  ];
  const { choices, defaultValue } = sortChoicesForBrand(items, BRAND, {
    getName: (item) => item.name,
    getValue: (item) => item.id,
    defaultValue: '3',
    createNewLabel: 'account',
  });

  assert.deepEqual(choices.map((c) => c.name), ['+ Create new account', 'Alpha', 'Fixture Brand Site', 'Zeta Corp']);
  assert.equal(choices[0].value, '__CREATE_NEW__');
  assert.equal(defaultValue, '3'); // select()'s cursor lands on the default item
});

test('config-flow: without an explicit default the cursor lands on the best real item, never create-new', () => {
  const items = [{ name: 'Zeta Corp', id: '1' }, { name: 'Fixture Brand Site', id: '2' }];
  const { choices, defaultValue } = sortChoicesForBrand(items, BRAND, {
    getName: (item) => item.name,
    getValue: (item) => item.id,
    createNewLabel: 'account',
  });

  assert.equal(choices[0].value, '__CREATE_NEW__'); // still listed first
  assert.equal(defaultValue, '2'); // cursor on the brand match
});

// ─── Gates: existing value / non-TTY / dry-run ───────────────────────────────

test('config-flow: an existing config value is returned untouched, no prompts', async () => {
  setPromptStreams(makeStreams({ tty: false })); // any prompt would throw
  const context = makeContext();
  context.brandConfig.inbound.chat.providers.chatsy.agentId = 'already-set';

  const value = await resolveConfigValue(context, {
    path: 'inbound.chat.providers.chatsy.agentId',
    label: 'Chatsy chat agent',
    entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
  });

  assert.equal(value, 'already-set');
  assert.equal(readConfigSource(context.brandRoot), CONFIG_SOURCE); // byte-identical
});

test('config-flow: non-interactive returns null and writes nothing', async () => {
  setPromptStreams(makeStreams({ tty: false }));
  const context = makeContext();

  const value = await resolveConfigValue(context, {
    path: 'inbound.chat.providers.chatsy.agentId',
    label: 'Chatsy chat agent',
    entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
  });

  assert.equal(value, null);
  assert.equal(readConfigSource(context.brandRoot), CONFIG_SOURCE);
});

test('config-flow: dry-run returns null without prompting, even with a TTY', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext({ options: { dryRun: true } });
    const value = await resolveConfigValue(context, {
      path: 'inbound.chat.providers.chatsy.agentId',
      label: 'Chatsy chat agent',
      entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
    });
    assert.equal(value, null);
    assert.equal(readConfigSource(context.brandRoot), CONFIG_SOURCE);
  } finally {
    tty.close();
  }
});

// ─── Entry mode (paste-back) ─────────────────────────────────────────────────

test('config-flow: entry flow opens the dashboard, lands the pasted id in file + memory', async () => {
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const context = makeContext();
    const run = resolveConfigValue(context, {
      path: 'inbound.chat.providers.chatsy.agentId',
      label: 'Chatsy chat agent',
      instructions: ['1. Create an account', '2. Create a chat agent'],
      entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
      disablePath: 'inbound.chat.providers.chatsy',
    });
    await tty.answer('Set up now?', '\r'); // Yes
    await tty.answer('Chatsy agent ID:', '  agent_123  \r');
    const value = await run;

    assert.equal(value, 'agent_123'); // trimmed
    assert.deepEqual(opened, ['https://chatsy.ai']);
    assert.equal(context.brandConfig.inbound.chat.providers.chatsy.agentId, 'agent_123');
    const written = readConfigSource(context.brandRoot);
    assert.ok(written.includes('agentId: "agent_123"'));
    assert.ok(written.includes('// agent id lands here')); // comment survived
  } finally {
    tty.close();
  }
});

test('config-flow: Skip answer returns null and writes nothing', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    const run = resolveConfigValue(context, {
      path: 'inbound.chat.providers.chatsy.agentId',
      label: 'Chatsy chat agent',
      entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
    });
    await tty.answer('Set up now?', `${DOWN}\r`); // Skip for now
    assert.equal(await run, null);
    assert.equal(readConfigSource(context.brandRoot), CONFIG_SOURCE);
  } finally {
    tty.close();
  }
});

// ─── Tri-state standard (#33): false = opted out ─────────────────────────────

test('config-flow: `false` at the path = opted out — null with no prompting, even on a TTY', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    context.brandConfig.inbound.chat.providers.chatsy.agentId = false;

    const value = await resolveConfigValue(context, {
      path: 'inbound.chat.providers.chatsy.agentId',
      label: 'Chatsy chat agent',
      entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
    });

    assert.equal(value, null);
    assert.equal(readConfigSource(context.brandRoot), CONFIG_SOURCE); // untouched
  } finally {
    tty.close();
  }
});

test('config-flow: `false` on an ancestor section = opted out for every path under it', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    context.brandConfig.inbound.chat.providers.chatsy = false; // the section-level Disable landing shape

    const value = await resolveConfigValue(context, {
      path: 'inbound.chat.providers.chatsy.agentId',
      label: 'Chatsy chat agent',
      entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
    });

    assert.equal(value, null);
  } finally {
    tty.close();
  }
});

test('config-flow: Disable without an explicit disablePath writes `<path>: false`, honored on the next call', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    const spec = {
      path: 'inbound.chat.providers.chatsy.agentId',
      label: 'Chatsy chat agent',
      entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
    };

    const run = resolveConfigValue(context, spec);
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`); // Disable (stop prompting)
    assert.equal(await run, null);

    assert.equal(context.brandConfig.inbound.chat.providers.chatsy.agentId, false);
    assert.ok(readConfigSource(context.brandRoot).includes('agentId: false'));

    // Round-trip: the landed false short-circuits silently (a prompt would hang here)
    assert.equal(await resolveConfigValue(context, spec), null);
  } finally {
    tty.close();
  }
});

test('config-flow: inline opt-out choice lands `false` and returns null', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    const run = resolveConfigValue(context, accountSpec({
      optOut: { label: 'No analytics — don\'t ask again' },
    }));
    await tty.answer('Set up now?', '\r');
    // Choices: Fixture Brand (222), Other Org (111), No analytics — cursor on the brand match
    await tty.answer('Select Google Analytics account:', `${DOWN}${DOWN}\r`);
    assert.equal(await run, null);

    assert.equal(context.brandConfig.analytics.providers.google.accountId, false);
    assert.ok(readConfigSource(context.brandRoot).includes('accountId: false'));
  } finally {
    tty.close();
  }
});

test('config-flow: Disable answer writes `<section>: false` and returns null', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    const run = resolveConfigValue(context, {
      path: 'inbound.chat.providers.chatsy.agentId',
      label: 'Chatsy chat agent',
      entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
      disablePath: 'inbound.chat.providers.chatsy',
    });
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`); // Disable (stop prompting)
    assert.equal(await run, null);

    assert.equal(context.brandConfig.inbound.chat.providers.chatsy, false);
    const written = readConfigSource(context.brandRoot);
    assert.ok(written.includes('inbound: { chat: { providers: { chatsy: false } } }, // agent id lands here')); // value replaced, comment kept
  } finally {
    tty.close();
  }
});

// ─── Selection mode ──────────────────────────────────────────────────────────

const ACCOUNTS = [
  { displayName: 'Other Org', name: 'accounts/111' },
  { displayName: 'Fixture Brand', name: 'accounts/222' },
];

function accountSpec(overrides = {}) {
  return {
    path: 'analytics.providers.google.accountId',
    label: 'Google Analytics account',
    choices: async () => ACCOUNTS,
    getName: (account) => `${account.displayName} (${account.name.replace('accounts/', '')})`,
    getValue: (account) => account.name.replace('accounts/', ''),
    ...overrides,
  };
}

test('config-flow: selection lands the picked value (brand match sorted to the top)', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    const run = resolveConfigValue(context, accountSpec());
    await tty.answer('Set up now?', '\r');
    // Brand match "Fixture Brand (222)" sorts first — ENTER picks it
    await tty.answer('Select Google Analytics account:', '\r');
    const value = await run;

    assert.equal(value, '222');
    assert.equal(context.brandConfig.analytics.providers.google.accountId, '222');
    const written = readConfigSource(context.brandRoot);
    assert.ok(written.includes('accountId: "222"')); // whole branch inserted as a block
    assert.equal(JSON5.parse(written).analytics.providers.google.accountId, '222');
  } finally {
    tty.close();
  }
});

test('config-flow: create-new via API handler lands the created value', async () => {
  const tty = openTtyPrompt();
  try {
    const context = makeContext();
    let handlerCalls = 0;
    const run = resolveConfigValue(context, accountSpec({
      createNew: {
        label: 'account',
        handler: async () => { handlerCalls++; return 'created-999'; },
      },
    }));
    await tty.answer('Set up now?', '\r');
    // Cursor starts on the brand match — UP wraps to "+ Create new account"
    await tty.answer('Select Google Analytics account:', `${UP}\r`);
    const value = await run;

    assert.equal(value, 'created-999');
    assert.equal(handlerCalls, 1);
    assert.ok(readConfigSource(context.brandRoot).includes('accountId: "created-999"'));
  } finally {
    tty.close();
  }
});

test('config-flow: create-new via browser refreshes the list and lands the new pick', async () => {
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const context = makeContext();
    let listCalls = 0;
    const run = resolveConfigValue(context, accountSpec({
      choices: async () => {
        listCalls++;
        return listCalls === 1 ? [ACCOUNTS[0]] : ACCOUNTS; // the new account appears on refresh
      },
      createNew: { label: 'account', url: 'https://example.com/create', refreshChoices: true },
    }));
    await tty.answer('Set up now?', '\r');
    // Cursor starts on the only real item — UP wraps to "+ Create new account"
    await tty.answer('Select Google Analytics account:', `${UP}\r`);
    await tty.answer('Press ENTER when done...', '\r');
    // Refreshed list: brand match "Fixture Brand (222)" sorts first
    await tty.answer('Select the new account:', '\r');
    const value = await run;

    assert.equal(value, '222');
    assert.equal(listCalls, 2);
    assert.deepEqual(opened, ['https://example.com/create']);
    assert.ok(readConfigSource(context.brandRoot).includes('accountId: "222"'));
  } finally {
    tty.close();
  }
});
