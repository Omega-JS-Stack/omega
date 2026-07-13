/**
 * @omega.js/devkit/translate — engine protocol (batching, control sentinel,
 * validation retries, whitespace), providers (resolution, chatgpt parsing),
 * committed per-string cache (roundtrip, prune, corruption), language SSOT,
 * and the translation-settings reader.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  translateStrings,
  preserveWhitespace,
  CONTROL,
  BATCH_SIZE,
  resolveProvider,
  DEFAULT_MODELS,
  hashKey,
  loadCache,
  saveCache,
  LANGUAGE_NAMES,
  isRTL,
  languageName,
  assertKnownLanguages,
  resolveTranslationSettings,
} = require('../src/translate/index.js');

/**
 * A well-behaved fake provider: translates by suffixing '·XX', echoes the
 * control sentinel, and records every call.
 */
function fakeSend(calls = []) {
  return async ({ system, user }) => {
    calls.push({ system, user });
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    const out = payload.map((s) => (s === CONTROL ? s : `${s.trim()}·XX`));
    return { text: JSON.stringify(out), usage: { input: 10, output: 20 } };
  };
}

// ── engine ─────────────────────────────────────────────────────────────────

test('translateStrings: aligned result, whitespace preserved, usage aggregated', async () => {
  const calls = [];
  const { result, usage } = await translateStrings({
    strings: ['Hello world', ' padded ', 'Third'],
    language: 'es',
    languageName: 'Spanish',
    brand: 'MiniCo',
    send: fakeSend(calls),
  });

  assert.deepStrictEqual(result, ['Hello world·XX', ' padded·XX ', 'Third·XX']);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].system.includes('MiniCo'), 'brand lands in the system prompt');
  assert.ok(calls[0].user.includes('Spanish'), 'language name lands in the user message');
  assert.deepStrictEqual(usage, { input: 10, output: 20 });
});

test('translateStrings: batches of 25 with the sentinel appended to each', async () => {
  const calls = [];
  const strings = Array.from({ length: BATCH_SIZE * 2 + 3 }, (_, i) => `s${i}`);
  const { result } = await translateStrings({ strings, language: 'fr', languageName: 'French', send: fakeSend(calls) });

  assert.strictEqual(result.length, strings.length);
  assert.strictEqual(calls.length, 3);
  for (const call of calls) {
    const payload = JSON.parse(call.user.slice(call.user.indexOf('\n\n') + 2));
    assert.strictEqual(payload[payload.length - 1], CONTROL, 'every batch carries the sentinel last');
  }
});

test('translateStrings: length mismatch retries, then succeeds', async () => {
  let attempts = 0;
  const send = async ({ user }) => {
    attempts++;
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    if (attempts === 1) {
      return { text: JSON.stringify(payload.slice(1)), usage: {} }; // short by one
    }
    return { text: JSON.stringify(payload), usage: {} };
  };

  const { result } = await translateStrings({ strings: ['a', 'b'], language: 'es', languageName: 'Spanish', send });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(attempts, 2);
});

test('translateStrings: altered control sentinel exhausts retries and throws', async () => {
  let attempts = 0;
  const send = async ({ user }) => {
    attempts++;
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    return { text: JSON.stringify(payload.map(() => 'CORRUPTED')), usage: {} };
  };

  await assert.rejects(
    translateStrings({ strings: ['a'], language: 'es', languageName: 'Spanish', send }),
    /control sentinel/
  );
  assert.strictEqual(attempts, 3, 'initial + 2 retries');
});

test('translateStrings: markdown fences around the JSON are stripped', async () => {
  const send = async ({ user }) => {
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    return { text: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``, usage: {} };
  };

  const { result } = await translateStrings({ strings: ['x'], language: 'es', languageName: 'Spanish', send });
  assert.deepStrictEqual(result, ['x']);
});

test('translateStrings: empty input short-circuits without calling the provider', async () => {
  const { result } = await translateStrings({
    strings: [],
    language: 'es',
    languageName: 'Spanish',
    send: async () => { throw new Error('must not be called'); },
  });
  assert.deepStrictEqual(result, []);
});

test('preserveWhitespace keeps the original edges', () => {
  assert.strictEqual(preserveWhitespace('  hi ', 'hola'), '  hola ');
  assert.strictEqual(preserveWhitespace('hi', ' hola '), 'hola');
});

// ── providers ──────────────────────────────────────────────────────────────

test('resolveProvider: defaults, overrides, unknown name', () => {
  const claude = resolveProvider({});
  assert.strictEqual(claude.name, 'claude');
  assert.strictEqual(claude.model, DEFAULT_MODELS.claude);

  const custom = resolveProvider({ provider: 'chatgpt', model: 'gpt-x' });
  assert.strictEqual(custom.model, 'gpt-x');

  assert.throws(() => resolveProvider({ provider: 'gemini' }), /Unknown translation provider/);
});

test('chatgpt provider: requires OPENAI_API_KEY, parses the Responses shape', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    await assert.rejects(resolveProvider({ provider: 'chatgpt' }).send({ system: 's', user: 'u' }), /OPENAI_API_KEY/);

    process.env.OPENAI_API_KEY = 'test-key';
    const provider = resolveProvider({
      provider: 'chatgpt',
      fetchFn: async (url, init) => {
        assert.ok(url.includes('api.openai.com'));
        assert.strictEqual(JSON.parse(init.body).model, DEFAULT_MODELS.chatgpt);
        return {
          ok: true,
          json: async () => ({
            output: [
              { type: 'reasoning' },
              { type: 'message', content: [{ type: 'output_text', text: '["hola"]' }] },
            ],
            usage: { input_tokens: 5, output_tokens: 7 },
          }),
        };
      },
    });

    const { text, usage } = await provider.send({ system: 's', user: 'u' });
    assert.strictEqual(text, '["hola"]');
    assert.deepStrictEqual(usage, { input: 5, output: 7 });
  } finally {
    if (saved === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = saved;
    }
  }
});

// ── cache ──────────────────────────────────────────────────────────────────

test('cache: roundtrip, prune to current sources, corruption tolerance, empty removal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-tcache-'));

  const map = { [hashKey('Hello')]: 'Hola', [hashKey('Old')]: 'Viejo' };
  saveCache(root, 'es', 'pages/home', map, ['Hello']);

  const loaded = loadCache(root, 'es', 'pages/home');
  assert.deepStrictEqual(loaded, { [hashKey('Hello')]: 'Hola' }, 'stale entry pruned');

  // Corrupt file → {}
  fs.writeFileSync(path.join(root, 'es', 'pages', 'home.json'), 'not json');
  assert.deepStrictEqual(loadCache(root, 'es', 'pages/home'), {});

  // Empty map removes the file
  saveCache(root, 'es', 'pages/home', {}, []);
  assert.ok(!fs.existsSync(path.join(root, 'es', 'pages', 'home.json')));

  fs.rmSync(root, { recursive: true, force: true });
});

// ── languages + settings ───────────────────────────────────────────────────

test('language SSOT: names, RTL, unknown-code rejection', () => {
  assert.strictEqual(languageName('es'), 'Spanish');
  assert.strictEqual(languageName('xx'), 'xx');
  assert.ok(isRTL('ar') && !isRTL('es'));
  assert.ok(Object.keys(LANGUAGE_NAMES).length >= 30);
  assert.throws(() => assertKnownLanguages(['es', 'klingon']), /klingon/);
});

test('resolveTranslationSettings: defaults + gating', () => {
  const off = resolveTranslationSettings({});
  assert.strictEqual(off.enabled, false);
  assert.strictEqual(off.provider, 'claude');
  assert.strictEqual(off.default, 'en');

  const on = resolveTranslationSettings({ translation: { languages: ['es'], provider: 'chatgpt', model: 'm', exclude: ['blog'] } });
  assert.strictEqual(on.enabled, true);
  assert.deepStrictEqual(on.languages, ['es']);
  assert.strictEqual(on.provider, 'chatgpt');
  assert.strictEqual(on.model, 'm');
  assert.deepStrictEqual(on.exclude, ['blog']);

  const disabled = resolveTranslationSettings({ translation: { enabled: false, languages: ['es'] } });
  assert.strictEqual(disabled.enabled, false);

  assert.throws(() => resolveTranslationSettings({ translation: { languages: ['nope'] } }), /nope/);
});

test('claude provider surfaces SDK error results immediately — a failed call never hangs the build', async () => {
  const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk');
  require.cache[sdkPath] = {
    id: sdkPath,
    filename: sdkPath,
    loaded: true,
    exports: {
      query: () => (async function* () {
        yield { type: 'result', subtype: 'error_during_execution', result: 'Session limit reached · resets 6pm' };
      })(),
    },
  };

  try {
    await assert.rejects(
      resolveProvider({ provider: 'claude' }).send({ system: 's', user: 'u' }),
      /failed \(error_during_execution\).*Session limit/s
    );
  } finally {
    delete require.cache[sdkPath];
  }
});

test('claude provider times out a stalled SDK call instead of hanging', async () => {
  const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk');
  require.cache[sdkPath] = {
    id: sdkPath,
    filename: sdkPath,
    loaded: true,
    exports: {
      // A call that never yields and never returns — the cp119 28-minute stall
      query: () => (async function* () { await new Promise(() => {}); })(),
    },
  };

  process.env.OMEGA_TRANSLATE_TIMEOUT_MS = '80';
  try {
    await assert.rejects(
      resolveProvider({ provider: 'claude' }).send({ system: 's', user: 'u' }),
      /exceeded .*stalled SDK call/
    );
  } finally {
    delete process.env.OMEGA_TRANSLATE_TIMEOUT_MS;
    delete require.cache[sdkPath];
  }
});

test('claude provider hides ANTHROPIC_API_KEY from the SDK — subscription-only auth by contract', async () => {
  // Inject a fake SDK before sendClaude's lazy require runs
  const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk');
  const seen = {};
  require.cache[sdkPath] = {
    id: sdkPath,
    filename: sdkPath,
    loaded: true,
    exports: {
      query: ({ options }) => {
        seen.env = options.env;
        return (async function* () {
          yield { type: 'result', usage: { input_tokens: 1, output_tokens: 1 } };
        })();
      },
    },
  };

  process.env.ANTHROPIC_API_KEY = 'sk-would-bill-api-credits';
  try {
    await resolveProvider({ provider: 'claude' }).send({ system: 's', user: 'u' });
    assert.ok(seen.env, 'the provider passes an explicit env to the SDK');
    assert.equal(seen.env.ANTHROPIC_API_KEY, undefined, 'the API key never reaches the SDK');
    assert.ok(Object.keys(seen.env).length > 0, 'the rest of the environment passes through');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete require.cache[sdkPath];
  }
});
