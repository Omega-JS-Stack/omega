// Tests for src/lib/config-flow.js — the config-landing interactive flows
// (omega-manager's schema-prompter engine reshaped onto the comment-
// preserving writeback).
//
// Interactive paths drive REAL inquirer prompts through the fake-TTY
// harness; the browser opener is stubbed via devkit's setBrowserOpener seam
// (workspace symlinks resolve to one module instance, so the seam set here
// is the one config-flow sees). Writebacks are asserted at the byte level
// against a hand-commented fixture omega.json5.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { setPromptStreams } = require('@omega.js/devkit/prompt');
const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { makeStreams } = require('@omega.js/devkit/test/prompt-streams');
const JSON5 = require('json5');
const { stripVTControlCharacters } = require('node:util');
const { resolveConfigValue, sortChoicesForBrand, isAuthored } = require('../src/lib/config-flow.js');
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

const afterEachHook = () => {
  setPromptStreams(null);
  setBrowserOpener(null);
};

/** Run fn with console.log captured; returns the joined lines, colors stripped. */
async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return stripVTControlCharacters(lines.join('\n'));
}

const CHATSY_HEADLESS_LINE = '→ Set inbound.chat.providers.chatsy.agentId in config/omega.json5, or run manage in a terminal to answer';
const CHATSY_DRY_RUN_LINE = '→ Set inbound.chat.providers.chatsy.agentId in config/omega.json5, or run manage without --dry-run to answer';

// ─── spec.present: what counts as already answered ──────────────────────────

const REGISTRARS = ['namecheap', 'squarespace'];

function registrarSpec() {
  return {
    path: 'domain.providers',
    label: 'Domain registrar',
    choices: async () => REGISTRARS,
    getName: (name) => name,
    getValue: (name) => name,
    present: (value) => Object.keys(value).length > 0,
  };
}

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

module.exports = defineCases({
  type: 'group',
  description: 'config-flow',
  tests: [
    // ─── sortChoicesForBrand (pure) ──────────────────────────────────────────────

    {
      name: 'config-flow: sortChoicesForBrand puts create-new first, default second, brand matches before the rest',
      run: (ctx) => {
        ctx.after(afterEachHook);
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

        ctx.expect(choices.map((c) => c.name)).toEqual(['+ Create new account', 'Alpha', 'Fixture Brand Site', 'Zeta Corp']);
        ctx.expect(choices[0].value).toBe('__CREATE_NEW__');
        ctx.expect(defaultValue).toBe('3'); // select()'s cursor lands on the default item
      },
    },

    {
      name: 'config-flow: without an explicit default the cursor lands on the best real item, never create-new',
      run: (ctx) => {
        ctx.after(afterEachHook);
        const items = [{ name: 'Zeta Corp', id: '1' }, { name: 'Fixture Brand Site', id: '2' }];
        const { choices, defaultValue } = sortChoicesForBrand(items, BRAND, {
          getName: (item) => item.name,
          getValue: (item) => item.id,
          createNewLabel: 'account',
        });

        ctx.expect(choices[0].value).toBe('__CREATE_NEW__'); // still listed first
        ctx.expect(defaultValue).toBe('2'); // cursor on the brand match
      },
    },

    // ─── Gates: existing value / non-TTY / dry-run ───────────────────────────────

    {
      name: 'config-flow: an existing config value is returned untouched, no prompts',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        setPromptStreams(makeStreams({ tty: false })); // any prompt would throw
        const context = makeContext();
        context.brandConfig.inbound.chat.providers.chatsy.agentId = 'already-set';

        const value = await resolveConfigValue(context, {
          path: 'inbound.chat.providers.chatsy.agentId',
          label: 'Chatsy chat agent',
          entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
        });

        ctx.expect(value).toBe('already-set');
        ctx.expect(readConfigSource(context.brandRoot)).toBe(CONFIG_SOURCE); // byte-identical
      },
    },

    {
      name: 'config-flow: non-interactive returns null, writes nothing, and prints the headless line',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        setPromptStreams(makeStreams({ tty: false }));
        const context = makeContext();
        let value;

        const printed = await captureLogAsync(async () => {
          value = await resolveConfigValue(context, {
            path: 'inbound.chat.providers.chatsy.agentId',
            label: 'Chatsy chat agent',
            entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
          });
        });

        ctx.expect(value).toBe(null);
        ctx.expect(readConfigSource(context.brandRoot)).toBe(CONFIG_SOURCE);
        ctx.expect(printed.includes(CHATSY_HEADLESS_LINE), `headless line missing from: ${printed}`).toBeTruthy();
      },
    },

    {
      name: 'config-flow: dry-run returns null without prompting, even with a TTY, and names the rerun without --dry-run',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt();
        try {
          const context = makeContext({ options: { dryRun: true } });
          let value;
          const printed = await captureLogAsync(async () => {
            value = await resolveConfigValue(context, {
              path: 'inbound.chat.providers.chatsy.agentId',
              label: 'Chatsy chat agent',
              entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
            });
          });
          ctx.expect(value).toBe(null);
          ctx.expect(readConfigSource(context.brandRoot)).toBe(CONFIG_SOURCE);
          ctx.expect(printed.includes(CHATSY_DRY_RUN_LINE), `dry-run line missing from: ${printed}`).toBeTruthy();
          ctx.expect(!printed.includes('run manage in a terminal'), printed).toBeTruthy();
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: present() says an empty pick is unanswered, so a terminal run prompts',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt();
        try {
          const config = JSON5.parse(CONFIG_SOURCE);
          config.domain = { providers: {} };
          const context = makeContext({ config });

          const run = resolveConfigValue(context, registrarSpec());
          await tty.answer('Set up now?', `${DOWN}\r`); // Skip for now: the gate opening is the proof
          ctx.expect(await run).toBe(null);
          ctx.expect(readConfigSource(context.brandRoot)).toBe(CONFIG_SOURCE);
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: present() accepts a real pick, returned untouched with no prompt',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt(); // interactive: a gate here would hang
        try {
          const config = JSON5.parse(CONFIG_SOURCE);
          config.domain = { providers: { namecheap: {} } };
          const context = makeContext({ config });

          const value = await resolveConfigValue(context, registrarSpec());

          ctx.expect(value).toEqual({ namecheap: {} });
          ctx.expect(readConfigSource(context.brandRoot)).toBe(CONFIG_SOURCE);
        } finally {
          tty.close();
        }
      },
    },

    // ─── isAuthored: the brand's own file, never the merged view ─────────────────

    {
      name: 'config-flow: isAuthored is true when the brand file holds the path, false-valued included',
      run: (ctx) => {
        ctx.after(afterEachHook);
        const brandRoot = makeBrandRoot(`{
  brand: { id: 'fixture-brand' },
  cloud: { shared: false }, // answered once
}
`);
        const context = { brandId: BRAND.id, brandRoot, brandConfig: { cloud: { shared: false } }, options: {} };

        ctx.expect(isAuthored(context, 'cloud.shared')).toBe(true);
      },
    },

    {
      name: 'config-flow: isAuthored is false when only the merged config holds the path',
      run: (ctx) => {
        ctx.after(afterEachHook);
        const brandRoot = makeBrandRoot(`{
  brand: { id: 'fixture-brand' },
  cloud: { supportEmail: 'help@fixture-brand.test' },
}
`);
        // The merged view carries the schema default the file never wrote
        const context = { brandId: BRAND.id, brandRoot, brandConfig: { cloud: { shared: false } }, options: {} };

        ctx.expect(isAuthored(context, 'cloud.shared')).toBe(false);
        ctx.expect(isAuthored(context, 'domain.providers')).toBe(false); // no section at all
      },
    },

    // ─── Entry mode (paste-back) ─────────────────────────────────────────────────

    {
      name: 'config-flow: entry flow opens the dashboard, lands the pasted id in file + memory',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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

          ctx.expect(value).toBe('agent_123'); // trimmed
          ctx.expect(opened).toEqual(['https://chatsy.ai']);
          ctx.expect(context.brandConfig.inbound.chat.providers.chatsy.agentId).toBe('agent_123');
          const written = readConfigSource(context.brandRoot);
          ctx.expect(written.includes('agentId: "agent_123"')).toBeTruthy();
          ctx.expect(written.includes('// agent id lands here')).toBeTruthy(); // comment survived
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: Skip answer returns null and writes nothing',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt();
        try {
          const context = makeContext();
          const run = resolveConfigValue(context, {
            path: 'inbound.chat.providers.chatsy.agentId',
            label: 'Chatsy chat agent',
            entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
          });
          await tty.answer('Set up now?', `${DOWN}\r`); // Skip for now
          ctx.expect(await run).toBe(null);
          ctx.expect(readConfigSource(context.brandRoot)).toBe(CONFIG_SOURCE);
        } finally {
          tty.close();
        }
      },
    },

    // ─── Tri-state standard (#33): false = opted out ─────────────────────────────

    {
      name: 'config-flow: `false` at the path = opted out — null with no prompting, even on a TTY',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt();
        try {
          const context = makeContext();
          context.brandConfig.inbound.chat.providers.chatsy.agentId = false;

          const value = await resolveConfigValue(context, {
            path: 'inbound.chat.providers.chatsy.agentId',
            label: 'Chatsy chat agent',
            entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
          });

          ctx.expect(value).toBe(null);
          ctx.expect(readConfigSource(context.brandRoot)).toBe(CONFIG_SOURCE); // untouched
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: `false` on an ancestor section = opted out for every path under it',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt();
        try {
          const context = makeContext();
          context.brandConfig.inbound.chat.providers.chatsy = false; // the section-level Disable landing shape

          const value = await resolveConfigValue(context, {
            path: 'inbound.chat.providers.chatsy.agentId',
            label: 'Chatsy chat agent',
            entry: { url: 'https://chatsy.ai', message: 'Chatsy agent ID:' },
          });

          ctx.expect(value).toBe(null);
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: Disable without an explicit disablePath writes `<path>: false`, honored on the next call',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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
          ctx.expect(await run).toBe(null);

          ctx.expect(context.brandConfig.inbound.chat.providers.chatsy.agentId).toBe(false);
          ctx.expect(readConfigSource(context.brandRoot).includes('agentId: false')).toBeTruthy();

          // Round-trip: the landed false short-circuits silently (a prompt would hang here)
          ctx.expect(await resolveConfigValue(context, spec)).toBe(null);
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: inline opt-out choice lands `false` and returns null',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt();
        try {
          const context = makeContext();
          const run = resolveConfigValue(context, accountSpec({
            optOut: { label: 'No analytics — don\'t ask again' },
          }));
          await tty.answer('Set up now?', '\r');
          // Choices: Fixture Brand (222), Other Org (111), No analytics — cursor on the brand match
          await tty.answer('Select Google Analytics account:', `${DOWN}${DOWN}\r`);
          ctx.expect(await run).toBe(null);

          ctx.expect(context.brandConfig.analytics.providers.google.accountId).toBe(false);
          ctx.expect(readConfigSource(context.brandRoot).includes('accountId: false')).toBeTruthy();
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: Disable answer writes `<section>: false` and returns null',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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
          ctx.expect(await run).toBe(null);

          ctx.expect(context.brandConfig.inbound.chat.providers.chatsy).toBe(false);
          const written = readConfigSource(context.brandRoot);
          ctx.expect(written.includes('inbound: { chat: { providers: { chatsy: false } } }, // agent id lands here')).toBeTruthy(); // value replaced, comment kept
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: selection lands the picked value (brand match sorted to the top)',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const tty = openTtyPrompt();
        try {
          const context = makeContext();
          const run = resolveConfigValue(context, accountSpec());
          await tty.answer('Set up now?', '\r');
          // Brand match "Fixture Brand (222)" sorts first — ENTER picks it
          await tty.answer('Select Google Analytics account:', '\r');
          const value = await run;

          ctx.expect(value).toBe('222');
          ctx.expect(context.brandConfig.analytics.providers.google.accountId).toBe('222');
          const written = readConfigSource(context.brandRoot);
          ctx.expect(written.includes('accountId: "222"')).toBeTruthy(); // whole branch inserted as a block
          ctx.expect(JSON5.parse(written).analytics.providers.google.accountId).toBe('222');
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: create-new via API handler lands the created value',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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

          ctx.expect(value).toBe('created-999');
          ctx.expect(handlerCalls).toBe(1);
          ctx.expect(readConfigSource(context.brandRoot).includes('accountId: "created-999"')).toBeTruthy();
        } finally {
          tty.close();
        }
      },
    },

    {
      name: 'config-flow: create-new via browser refreshes the list and lands the new pick',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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

          ctx.expect(value).toBe('222');
          ctx.expect(listCalls).toBe(2);
          ctx.expect(opened).toEqual(['https://example.com/create']);
          ctx.expect(readConfigSource(context.brandRoot).includes('accountId: "222"')).toBeTruthy();
        } finally {
          tty.close();
        }
      },
    },
  ],
});
