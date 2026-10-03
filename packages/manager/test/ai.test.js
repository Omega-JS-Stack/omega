// Tests for the ai service (#639) — the ONE key per AI provider, asked once.
// The service provisions nothing: its whole job is the setup contract's gate
// for OPENAI_API_KEY / ANTHROPIC_API_KEY, so a brand that wants AI pastes
// them mid-walk and a brand that does not answers Disable once. Both keys are
// OPTIONAL (`gates: false`) — preflight never gates a run on them.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { missingEnvKeys } = require('@omega.js/config');
const { REQUIRES, SERVICE_ORDER, OPERATIONS, serviceInputs, serviceInputSpec } = require('../src/config.js');
const { run } = require('../src/services/ai/index.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const DOWN = '\x1B[B';

function cleanup() {
  for (const name of KEYS) delete process.env[name];
}

/** Stub the real browser launch — pressEnterToOpen's seam. */
function stubBrowser() {
  const promptModule = require('@omega.js/devkit/prompt');
  const real = promptModule.openInBrowser;
  const opened = [];

  promptModule.openInBrowser = (url) => { opened.push(url); return true; };

  return { opened, restore: () => { promptModule.openInBrowser = real; } };
}

// Both keys are asked only of a brand with a backend, the one target reading both
const BACKEND_BRAND = { targets: { backend: { type: 'backend' } } };

function context(brandRoot, brandConfig = BACKEND_BRAND, options = {}) {
  return {
    brandId: 'b',
    brandRoot,
    brandConfig,
    operations: OPERATIONS.ai,
    options,
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'ai',
  tests: [
    {
      name: 'ai: the registry declares both provider keys as OPTIONAL inputs',
      run: (ctx) => {
        const declaration = REQUIRES.ai;
        const inputs = serviceInputs('ai');

        ctx.expect(declaration.label).toBe('AI providers');
        ctx.expect(declaration.disablePath).toBe('ai.enabled');
        ctx.expect(inputs.map((entry) => entry.name)).toEqual(KEYS);

        for (const entry of inputs) {
          ctx.expect(entry.prompted, `${entry.name} is collected mid-run on a TTY`).toBe(true);
          ctx.expect(entry.gates, `${entry.name} is optional — preflight never gates on it`).toBe(false);
        }

        // What each key IS and where it is minted comes from the env SCHEMA, its one
        // home (#867); the spec is where the schema's half meets the registry's
        for (const input of serviceInputSpec('ai').inputs) {
          ctx.expect(input.url, `${input.name} names the page that mints it`).toMatch(/^https:\/\//);
          ctx.expect(input.hint, `${input.name} says what to make there`).toBeTruthy();
        }

        // The ask mirrors the service's own gate: absence means ask
        const asked = (config) => missingEnvKeys({ ...config, targets: { backend: { type: 'backend' } } }, {}, { verb: 'manage' })
          .filter((row) => row.service === 'ai')
          .map((row) => row.key)
          .sort();
        ctx.expect(asked({})).toEqual([...KEYS].sort());
        ctx.expect(asked({ ai: { enabled: false } })).toEqual([]);

        ctx.expect(SERVICE_ORDER.includes('ai'), 'the walk runs it').toBeTruthy();
        ctx.expect(serviceInputSpec('ai').inputs.map((entry) => entry.name)).toEqual(KEYS);
      },
    },

    {
      name: 'ai: both keys already in the environment → nothing asked',
      run: async (ctx) => {
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
        for (const name of KEYS) process.env[name] = 'already-set';

        try {
          const result = await run(context(brandRoot));
          ctx.expect(result.status).toBe('success');
          ctx.expect(fs.existsSync(path.join(brandRoot, '.env')), 'nothing was written').toBe(false);
        } finally {
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'ai: PROVIDE → both keys land in the brand .env and export for this run',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
        fs.writeFileSync(path.join(brandRoot, '.env'), 'EXISTING_KEY="keep-me"\n');

        const tty = openTtyPrompt();
        const browser = stubBrowser();
        try {
          const running = run(context(brandRoot));
          await tty.answer('Set up now?', '\r');                       // Provide
          await tty.answer('Press Enter to open the OpenAI API key page', '\r');
          await tty.answer('Paste OPENAI_API_KEY', 'openai-fixture\r');
          await tty.answer('Press Enter to open the Anthropic API key page', '\r');
          await tty.answer('Paste ANTHROPIC_API_KEY', 'anthropic-fixture\r');
          const result = await running;

          ctx.expect(result.status).toBe('success');
          ctx.expect(process.env.OPENAI_API_KEY).toBe('openai-fixture');
          ctx.expect(process.env.ANTHROPIC_API_KEY).toBe('anthropic-fixture');

          const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
          ctx.expect(env).toMatch(/EXISTING_KEY="keep-me"/);
          ctx.expect(env).toMatch(/OPENAI_API_KEY="openai-fixture"/);
          ctx.expect(env).toMatch(/ANTHROPIC_API_KEY="anthropic-fixture"/);
          // Providing never disables anything
          ctx.expect(readConfigSource(brandRoot)).not.toMatch(/enabled/);
          ctx.expect(browser.opened).toEqual([
            'https://platform.openai.com/api-keys',
            'https://console.anthropic.com/settings/keys',
          ]);
        } finally {
          tty.close();
          browser.restore();
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'ai: DISABLE → ai.enabled: false lands in omega.json5 and nothing asks again',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n  // keep me\n  ai: {},\n}\n');
        const brandConfig = { brand: { id: 'b' }, ai: {}, ...BACKEND_BRAND };

        const tty = openTtyPrompt();
        try {
          const running = run(context(brandRoot, brandConfig));
          await tty.answer('Set up now?', `${DOWN}${DOWN}\r`);          // Disable
          const result = await running;

          ctx.expect(result.status).toBe('skipped');
          ctx.expect(result.reason).toMatch(/ai\.enabled/);
          ctx.expect(result.missingEnv).toEqual(KEYS);

          const source = readConfigSource(brandRoot);
          ctx.expect(source).toMatch(/enabled: false/);
          ctx.expect(source).toMatch(/\/\/ keep me/);
          ctx.expect(brandConfig.ai.enabled).toBe(false);
          ctx.expect(process.env.OPENAI_API_KEY).toBe(undefined);
        } finally {
          tty.close();
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'ai: a disabled brand skips before any gate opens',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n  ai: { enabled: false },\n}\n');

        const tty = openTtyPrompt();
        try {
          const result = await run(context(brandRoot, { ai: { enabled: false } }));
          ctx.expect(result.status).toBe('skipped');
          ctx.expect(result.reason).toMatch(/ai\.enabled/);
        } finally {
          tty.close();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'ai: a non-interactive run never prompts — it names the keys and moves on',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');

        try {
          const result = await run(context(brandRoot, BACKEND_BRAND, { dryRun: true }));
          ctx.expect(result.status).toBe('skipped');
          ctx.expect(result.missingEnv).toEqual(KEYS);
          ctx.expect(fs.existsSync(path.join(brandRoot, '.env'))).toBe(false);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
  ],
});
