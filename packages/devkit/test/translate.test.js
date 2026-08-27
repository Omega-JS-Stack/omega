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
  CONCURRENCY,
  resolveProvider,
  DEFAULT_MODELS,
  hashKey,
  loadCache,
  saveCache,
  LANGUAGE_NAMES,
  LANGUAGE_LOCALES,
  isRTL,
  languageName,
  ogLocale,
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

test('#604: batches fly CONCURRENCY-wide at once and land back in order', async () => {
  // Sequential batching made one language a long serial wait: every 25-string
  // batch paid the model's full latency before the next one was asked.
  const strings = Array.from({ length: BATCH_SIZE * (CONCURRENCY * 2) }, (_, i) => `s${i}`);
  let inFlight = 0;
  let peak = 0;

  const send = async ({ user }) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight--;
    return { text: JSON.stringify(payload.map((s) => (s === CONTROL ? s : `${s}·XX`))), usage: { input: 1, output: 1 } };
  };

  const { result, usage } = await translateStrings({ strings, language: 'es', languageName: 'Spanish', send });

  assert.strictEqual(peak, CONCURRENCY, `${CONCURRENCY} batches were in flight at once, not ${peak}`);
  assert.deepStrictEqual(result, strings.map((s) => `${s}·XX`), 'completion order never reorders the result');
  assert.strictEqual(usage.input, CONCURRENCY * 2, 'every batch is still counted');
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

test('#523: a batch the provider keeps collapsing is re-asked in halves, not lost', async () => {
  // The playground's /blog/ship-the-docs-with-the-diff: 26 out, 25 back, on
  // every attempt, in BOTH languages, across two runs — a model that merges a
  // pair of adjacent twins is deterministic, so retrying the same batch can
  // only fail the same way and the page shipped untranslated. Splitting the
  // batch separates the pair and every string comes back.
  const payloadSizes = [];
  const send = async ({ user }) => {
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    payloadSizes.push(payload.length);
    // The collapse, reproduced: adjacent NEAR-identical strings come back as
    // one. Exact twins no longer reach a batch (#529 dedupes them), but the
    // near-twins a headline and its meta description are still adjacent.
    const out = payload.filter((text, i) => i === 0 || text.slice(0, 20) !== payload[i - 1].slice(0, 20));
    return { text: JSON.stringify(out), usage: { input: 1, output: 2 } };
  };

  const TWINS = ['Ship the docs with the diff', 'Ship the docs with the diff — a follow-up'];
  const strings = Array.from({ length: BATCH_SIZE }, (_, i) => (i === 10 || i === 11 ? TWINS[i - 10] : `s${i}`));
  const { result, usage } = await translateStrings({ strings, language: 'es', languageName: 'Spanish', send });

  assert.deepStrictEqual(result, strings, 'every string comes back, in its own position');
  assert.strictEqual(payloadSizes[0], BATCH_SIZE + 1, 'the full batch was asked first');
  assert.ok(payloadSizes.length > 3, `the collapsing batch was split, not just retried: ${payloadSizes.join(', ')}`);
  assert.ok(usage.input > 0 && usage.output > 0, 'every call the split made is counted');
});

test('#523: a single string the provider will not return whole still fails loudly', async () => {
  // Splitting bottoms out: one string plus the sentinel is unambiguous, so a
  // provider that still collapses it is broken — the page-language pair is
  // skipped whole, never shipped half-translated.
  const send = async ({ user }) => {
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    return { text: JSON.stringify(payload.slice(1)), usage: {} };
  };

  await assert.rejects(
    translateStrings({ strings: ['a', 'b'], language: 'es', languageName: 'Spanish', send }),
    /length mismatch/
  );
});

test('#529: a repeated string is translated once and fanned back to every occurrence', async () => {
  // A page sends its title and description once per meta tag — <title>,
  // og:title, twitter:title — so the failing #523 page shipped each of them
  // three times, adjacently, in one batch. Every duplicate was AI spend, and
  // adjacent twins are what the model merges.
  const calls = [];
  const strings = [
    'Ship the docs with the diff',
    'A post about shipping docs',
    'Ship the docs with the diff',
    'A post about shipping docs',
    'Ship the docs with the diff',
    'A post about shipping docs',
    'Read more',
  ];

  const { result } = await translateStrings({ strings, language: 'es', languageName: 'Spanish', send: fakeSend(calls) });

  assert.deepStrictEqual(result, strings.map((s) => `${s}·XX`), 'every occurrence lands translated, in its own position');
  assert.strictEqual(calls.length, 1);

  const payload = JSON.parse(calls[0].user.slice(calls[0].user.indexOf('\n\n') + 2));
  assert.deepStrictEqual(
    payload,
    ['Ship the docs with the diff', 'A post about shipping docs', 'Read more', CONTROL],
    'each unique string is sent exactly once',
  );
});

test('#529: dedupe is what fills a batch, so uniques past the batch size still split', async () => {
  // The dedupe happens BEFORE batching: 60 strings that are 30 unique ride two
  // batches, not three.
  const calls = [];
  const unique = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => `s${i}`);
  const strings = [...unique, ...unique];

  const { result } = await translateStrings({ strings, language: 'es', languageName: 'Spanish', send: fakeSend(calls) });

  assert.strictEqual(result.length, strings.length, 'every occurrence comes back');
  assert.deepStrictEqual(result.slice(0, unique.length), result.slice(unique.length), 'both halves got the same translations');
  assert.strictEqual(calls.length, 2, `${unique.length} uniques is two batches, not ${Math.ceil(strings.length / BATCH_SIZE)}`);
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

test('ogLocale: Open Graph language_TERRITORY form for every supported code', () => {
  assert.strictEqual(ogLocale('en'), 'en_US');
  assert.strictEqual(ogLocale('es'), 'es_ES');
  assert.strictEqual(ogLocale('ar'), 'ar_AR');
  assert.strictEqual(ogLocale('no'), 'nb_NO', 'Norwegian carries the bokmal territory');

  // Every target language is mapped, and every locale is language_TERRITORY
  for (const code of Object.keys(LANGUAGE_NAMES)) {
    assert.match(ogLocale(code), /^[a-z]{2}_[A-Z]{2}$/, `${code} has a locale`);
  }
  assert.strictEqual(Object.keys(LANGUAGE_LOCALES).length, Object.keys(LANGUAGE_NAMES).length + 1, 'the map is the language set plus en');

  // Unmapped source language falls back to the bare code
  assert.strictEqual(ogLocale('xx'), 'xx');
});

test('resolveTranslationSettings: defaults + gating', () => {
  const off = resolveTranslationSettings({});
  assert.strictEqual(off.enabled, false);
  assert.strictEqual(off.provider, 'claude');
  assert.strictEqual(off.default, 'en');

  // The engine is a KEY under translation.providers (#425) — presence picks it
  const on = resolveTranslationSettings({ translation: { languages: ['es'], providers: { chatgpt: {} }, model: 'm', exclude: ['blog'] } });
  assert.strictEqual(on.enabled, true);
  assert.deepStrictEqual(on.languages, ['es']);
  assert.strictEqual(on.provider, 'chatgpt');
  assert.strictEqual(on.model, 'm');
  assert.deepStrictEqual(on.exclude, ['blog']);

  // An empty providers block is no pick at all, so the claude default stands
  const empty = resolveTranslationSettings({ translation: { languages: ['es'], providers: {} } });
  assert.strictEqual(empty.provider, 'claude');

  const disabled = resolveTranslationSettings({ translation: { enabled: false, languages: ['es'] } });
  assert.strictEqual(disabled.enabled, false);

  assert.throws(() => resolveTranslationSettings({ translation: { languages: ['nope'] } }), /nope/);
});

test('claude provider fails loud when the Agent SDK is not installed', async () => {
  // #37: web no longer ships the SDK as a runtime dependency, so a target that
  // enabled translation without installing it must hit a named, actionable
  // error (never a silent skip). The resolution is stubbed, not uninstalled.
  const Module = require('node:module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@anthropic-ai/claude-agent-sdk') {
      const error = new Error(`Cannot find module '${request}'`);
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return original.call(this, request, ...rest);
  };

  try {
    await assert.rejects(
      resolveProvider({ provider: 'claude' }).send({ system: 's', user: 'u' }),
      (e) => {
        assert.match(e.message, /@anthropic-ai\/claude-agent-sdk/, 'the error names the package');
        assert.match(e.message, /npm install @anthropic-ai\/claude-agent-sdk/, 'the error carries the install command');
        assert.match(e.message, /opt-in and the SDK is heavy/, 'the error says why it is not bundled');
        return true;
      }
    );
  } finally {
    Module._resolveFilename = original;
  }
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
