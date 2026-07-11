/**
 * Test: helpers/schema-zod.js — zod route schemas with powertools parity
 * Differential proof: every declarative-node behavior (coerce-never-reject, clamp/
 * truncate, undefined-only required, unknown-key strip) resolves IDENTICALLY through
 * Settings.resolve() whether the schema is a declarative node object (powertools
 * engine) or a fields.* zod schema (zod engine).
 *
 * Run: npx omega test helpers/schema-zod
 *
 * Also pins the two DELIBERATE divergences (see schema-zod.js header):
 * - no pollution of non-empty object defaults with types/min/max keys
 * - defaults are cloned, never shared by reference with the schema
 * And proves the converted test/schema route module against its frozen declarative
 * twin (the pre-conversion schema, preserved here as the reference).
 */
const powertools = require('node-powertools');
const Settings = require('../../src/manager/helpers/settings.js');
const { z, fields: f, isZodSchema } = require('../../src/manager/helpers/schema-zod.js');
const zodTestSchemaModule = require('../../src/manager/schemas/test/schema/post.js');

// Mock assistant/manager — Settings.resolve only touches these surfaces when the
// schema is passed directly (no file loading)
const makeAssistant = () => ({
  log() {},
  warn() {},
  errorify: (msg, opts) => Object.assign(new Error(msg), { code: (opts || {}).code }),
  request: { method: 'POST', user: { auth: { uid: 'u1', email: 'u1@test.com' } } },
});
const Manager = { cwd: '/tmp' };

const resolve = (schema, input, opts) => new Settings(Manager).resolve(makeAssistant(), schema, input, opts || {});
const J = (x) => JSON.stringify(x);

// ─── The differential battery ───
// [label, declarativeNode, zodField, input] — `undefined` input means "key absent".
// Every powertools quirk is represented: negative clamp-to-0 (min defaults to 0),
// unparseable string → 1, prefix parseFloat, comma-split arrays, multi-type
// replace-with-default, max: 0 treated as unset, null-passes-as-object.
const BATTERY = [
  ['negative-clamps-to-0',   { types: ['number'], default: 5 },                     f.number({ default: 5 }),                     -10],
  ['negative-min-allows',    { types: ['number'], default: 5, min: -20 },           f.number({ default: 5, min: -20 }),           -10],
  ['unparseable-string-1',   { types: ['number'], default: 5 },                     f.number({ default: 5 }),                     'abc'],
  ['prefix-parsefloat',      { types: ['number'], default: 5 },                     f.number({ default: 5 }),                     '42abc'],
  ['null-number-0',          { types: ['number'], default: 5 },                     f.number({ default: 5 }),                     null],
  ['string-coerce-number',   { types: ['number'], default: 5 },                     f.number({ default: 5 }),                     '42'],
  ['array-comma-split',      { types: ['array'], default: [] },                     f.array({ default: [] }),                     'a, b,,c'],
  ['array-from-number',      { types: ['array'], default: [] },                     f.array({ default: [] }),                     42],
  ['boolean-str-false',      { types: ['boolean'], default: true },                 f.boolean({ default: true }),                 'false'],
  ['boolean-str-zero',       { types: ['boolean'], default: true },                 f.boolean({ default: true }),                 '0'],
  ['boolean-truthy-string',  { types: ['boolean'], default: false },                f.boolean({ default: false }),                'no'],
  ['string-from-object',     { types: ['string'], default: 'd' },                   f.string({ default: 'd' }),                   { a: 1 }],
  ['string-from-null',       { types: ['string'], default: 'd' },                   f.string({ default: 'd' }),                   null],
  ['string-from-boolean',    { types: ['string'], default: 'd' },                   f.string({ default: 'd' }),                   true],
  ['multi-mismatch-default', { types: ['string', 'number'], default: 'd' },         f.multi(['string', 'number'], { default: 'd' }), { a: 1 }],
  ['multi-valid-kept',       { types: ['string', 'number'], default: 'd' },         f.multi(['string', 'number'], { default: 'd' }), 3],
  ['string-max-truncates',   { types: ['string'], default: '', max: 5 },            f.string({ default: '', max: 5 }),            'abcdefgh'],
  ['max-zero-is-unset',      { types: ['string'], default: '', max: 0 },            f.string({ default: '', max: 0 }),            'abcdef'],
  ['array-max-truncates',    { types: ['array'], default: [], max: 2 },             f.array({ default: [], max: 2 }),             [1, 2, 3, 4]],
  ['number-clamp-low',       { types: ['number'], default: 50, min: 10, max: 100 }, f.number({ default: 50, min: 10, max: 100 }), 5],
  ['number-clamp-high',      { types: ['number'], default: 50, min: 10, max: 100 }, f.number({ default: 50, min: 10, max: 100 }), 200],
  ['default-applied',        { types: ['string'], default: 'dd' },                  f.string({ default: 'dd' }),                  undefined],
  ['function-default-runs',  { types: ['string'], default: () => 'gen' },           f.string({ default: () => 'gen' }),           undefined],
  ['value-forces-input',     { types: ['string'], default: 'd', value: 'forced' },  f.field({ types: ['string'], default: 'd', value: 'forced' }), 'user'],
  ['object-null-passes',     { types: ['object'], default: {} },                    f.passthrough({ default: {} }),               null],
  ['object-passthrough',     { types: ['object'], default: {} },                    f.passthrough({ default: {} }),               { deep: { x: 1 } }],
  ['object-array-passes',    { types: ['object'], default: {} },                    f.passthrough({ default: {} }),               [1, 2]],
  ['object-string-mismatch', { types: ['object'], default: {} },                    f.passthrough({ default: {} }),               'x'],
  ['any-keeps-anything',     { types: ['any'], default: null },                     f.any({ default: null }),                     { complex: [1] }],
  ['clean-regex',            { types: ['string'], default: '', clean: /[^a-z]/g },  f.string({ default: '', clean: /[^a-z]/g }),  'a1b2c!'],
  ['clean-function',         { types: ['string'], default: '', clean: (v) => v.toUpperCase() }, f.string({ default: '', clean: (v) => v.toUpperCase() }), 'abc'],
];

// ─── Frozen declarative twin of schemas/test/schema/post.js ───
// This is the schema EXACTLY as it was before the zod conversion — the powertools
// reference the converted module must keep matching. If test/schema/post.js gains a
// field, add it here too. (functionDefault is time-based → excluded from diffs.)
const frozenTestSchema = ({ user }) => {
  const planId = user?.subscription?.product?.id || 'basic';
  const isPremium = planId !== 'basic';

  const schema = {
    stringField: { types: ['string'], default: 'default-string' },
    numberField: { types: ['number'], default: 42 },
    booleanField: { types: ['boolean'], default: false },
    arrayField: { types: ['array'], default: ['a', 'b', 'c'] },
    objectField: { types: ['object'], default: { key: 'value' } },
    requiredField: { types: ['string'], default: undefined, required: true },
    conditionalRequired: { types: ['string'], default: undefined, required: () => isPremium },
    functionDefault: { types: ['string'], default: () => `generated-${Date.now()}` },
    userBasedDefault: { types: ['string'], default: user?.auth?.uid || 'anonymous' },
    forcedValue: { types: ['string'], default: 'ignored', value: 'always-this-value' },
    minNumber: { types: ['number'], default: 5, min: 1 },
    maxNumber: { types: ['number'], default: 50, max: 100 },
    clampedNumber: { types: ['number'], default: 50, min: 10, max: 100 },
    maxLengthString: { types: ['string'], default: '', max: 10 },
    maxLengthArray: { types: ['array'], default: [], max: 3 },
    planBasedLimit: { types: ['number'], default: 10, min: 1, max: isPremium ? 1000 : 100 },
    multiType: { types: ['string', 'number'], default: 'default' },
    anyType: { types: ['any'], default: null },
    cleanedString: { types: ['string'], default: '', clean: /[^a-zA-Z0-9]/g },
    cleanedFunction: { types: ['string'], default: '', clean: (value) => value.toLowerCase().trim() },
    nested: {
      level1: { types: ['string'], default: 'nested-default' },
    },
  };

  if (isPremium) {
    schema.premiumOnlyField = { types: ['string'], default: 'premium-feature' };
  }

  return schema;
};

const basicUser = { auth: { uid: 'basic-uid' }, subscription: { product: { id: 'basic' } } };
const premiumUser = { auth: { uid: 'premium-uid' }, subscription: { product: { id: 'pro' } } };

// Normalize for twin diffs: JSON round-trip, drop the time-based field, and strip
// the powertools pollution keys from object/array defaults (the documented
// divergence — powertools injects types/min/max/value/default into non-empty
// object defaults when they're used; the zod engine returns them clean)
const normalizeTwin = (settings) => {
  const out = JSON.parse(J(settings));
  delete out.functionDefault;

  if (out.objectField && typeof out.objectField === 'object' && !Array.isArray(out.objectField)) {
    ['types', 'min', 'max', 'value', 'default'].forEach((key) => delete out.objectField[key]);
  }

  return out;
};

module.exports = {
  description: 'Schema-zod powertools parity',
  type: 'group',

  tests: [
    {
      name: 'differential-battery',
      async run({ assert }) {
        for (const [label, node, zodField, input] of BATTERY) {
          const data = typeof input === 'undefined' ? {} : { v: input };
          const declarative = resolve({ v: node }, data);
          const viaZod = resolve(f.object({ v: zodField }), data);

          assert.equal(J(viaZod), J(declarative), `Battery case "${label}" must resolve identically`);
        }
      },
    },

    {
      name: 'required-throws-400-identical-message',
      async run({ assert }) {
        const decl = { r: { types: ['string'], default: undefined, required: true } };
        const zod = f.object({ r: f.string({ default: undefined, required: true }) });

        let declError, zodError;
        try { resolve(decl, {}); } catch (e) { declError = e; }
        try { resolve(zod, {}); } catch (e) { zodError = e; }

        assert.ok(declError && zodError, 'Both engines must throw on missing required key');
        assert.equal(zodError.code, 400, 'Zod engine must throw 400');
        assert.equal(zodError.message, declError.message, 'Error messages must match');
        assert.equal(zodError.message, 'Required key {r} is missing in settings', 'Exact powertools message');
      },
    },

    {
      name: 'required-fires-only-on-undefined',
      async run({ assert }) {
        const zod = f.object({ r: f.string({ default: undefined, required: true }) });

        // '', null, 0, false all PASS required (undefined-only rule)
        assert.equal(resolve(zod, { r: '' }).r, '', 'Empty string passes required');
        assert.equal(resolve(zod, { r: null }).r, '', 'null passes required (then coerces)');
      },
    },

    {
      name: 'required-nested-path-and-checkRequired-off',
      async run({ assert }) {
        const zod = f.object({ n: f.object({ l1: f.string({ default: undefined, required: true }) }) });

        let error;
        try { resolve(zod, {}); } catch (e) { error = e; }
        assert.equal(error && error.message, 'Required key {n.l1} is missing in settings', 'Nested dot-path in message');

        const suppressed = resolve(f.object({ r: f.string({ default: 'd', required: true }) }), {}, { checkRequired: false });
        assert.equal(suppressed.r, 'd', 'checkRequired: false suppresses the check');
      },
    },

    {
      name: 'required-function-receives-resolve-args',
      async run({ assert }) {
        // Same contract as declarative required(assistant, settings, options)
        const zod = f.object({
          other: f.string({ default: '' }),
          dependent: f.string({ default: undefined, required: (assistant, settings) => settings.other === 'trigger' }),
        });

        assert.ok(resolve(zod, { other: 'calm' }), 'Not required when condition false');

        let error;
        try { resolve(zod, { other: 'trigger' }); } catch (e) { error = e; }
        assert.equal(error && error.code, 400, 'Function-required fires from settings condition');
      },
    },

    {
      name: 'unknown-keys-stripped-and-structure',
      async run({ assert }) {
        const zod = f.object({ k: f.string({ default: '' }), n: f.object({ l1: f.string({ default: 'nd' }) }) });

        const out = resolve(zod, { k: 'v', evil: 'x', n: { l1: 'set', alsoEvil: 1 } });
        assert.equal(J(out), J({ k: 'v', n: { l1: 'set' } }), 'Unknown keys stripped at every level');

        const defaults = resolve(zod, {});
        assert.equal(J(defaults), J({ k: '', n: { l1: 'nd' } }), 'Absent nested group resolves leaf defaults');

        const badParent = resolve(zod, { n: 'garbage' });
        assert.equal(J(badParent.n), J({ l1: 'nd' }), 'Invalid parent resolves leaf defaults (powertools leaf-walk behavior)');
      },
    },

    {
      name: 'divergence-no-default-pollution',
      async run({ assert }) {
        // Deliberate fix pinned: powertools mutates non-empty object defaults with
        // types/min/max keys and returns them by reference; the zod engine clones clean
        const node = { o: { types: ['object'], default: { key: 'value' } } };
        const zod = f.object({ o: f.passthrough({ default: { key: 'value' } }) });

        const polluted = resolve(node, {});
        const clean = resolve(zod, {});

        assert.ok('types' in polluted.o && 'min' in polluted.o, 'Powertools pollution exists (why this divergence is a fix)');
        assert.equal(J(clean.o), J({ key: 'value' }), 'Zod engine returns the default clean');

        // And clones: two resolves must not share the default object
        const first = resolve(zod, {});
        first.o.mutated = true;
        assert.ok(!('mutated' in resolve(zod, {}).o), 'Defaults are cloned per resolve, never shared');
      },
    },

    {
      name: 'frozen-twin-test-schema-basic-user',
      async run({ assert }) {
        const fixtures = [
          { requiredField: 'provided' },
          {
            requiredField: 'provided', stringField: 'custom', numberField: '77', booleanField: 'false',
            arrayField: 'x,y', objectField: { custom: 1 }, minNumber: -5, maxNumber: 500,
            clampedNumber: 200, maxLengthString: 'way-too-long-for-limit', maxLengthArray: [1, 2, 3, 4, 5],
            planBasedLimit: 500, multiType: 123, anyType: { deep: [1] },
            cleanedString: 'a@b!1', cleanedFunction: '  UP  ', nested: { level1: 'set' },
            forcedValue: 'try-to-override', premiumOnlyField: 'sneak',
          },
        ];

        for (const fixture of fixtures) {
          const declarative = resolve(frozenTestSchema({ user: basicUser }), fixture);
          const viaZod = resolve(zodTestSchemaModule({ user: basicUser }), fixture);

          assert.equal(J(normalizeTwin(viaZod)), J(normalizeTwin(declarative)), `test/schema twin parity (basic): ${J(fixture).slice(0, 60)}`);
          assert.match(viaZod.functionDefault, /^generated-\d+$/, 'Function default generated');
        }
      },
    },

    {
      name: 'frozen-twin-test-schema-premium-user',
      async run({ assert }) {
        const fixture = { requiredField: 'provided', conditionalRequired: 'yes', planBasedLimit: 500, premiumOnlyField: 'mine' };

        const declarative = resolve(frozenTestSchema({ user: premiumUser }), fixture);
        const viaZod = resolve(zodTestSchemaModule({ user: premiumUser }), fixture);

        assert.equal(J(normalizeTwin(viaZod)), J(normalizeTwin(declarative)), 'test/schema twin parity (premium)');
        assert.equal(viaZod.planBasedLimit, 500, 'Premium max 1000 allows 500');
        assert.equal(viaZod.premiumOnlyField, 'mine', 'Premium-only field available');

        // conditionalRequired enforced for premium in BOTH engines
        let declError, zodError;
        try { resolve(frozenTestSchema({ user: premiumUser }), { requiredField: 'x' }); } catch (e) { declError = e; }
        try { resolve(zodTestSchemaModule({ user: premiumUser }), { requiredField: 'x' }); } catch (e) { zodError = e; }
        assert.ok(declError && zodError, 'Both engines enforce conditional required for premium');
        assert.equal(zodError.message, declError.message, 'Identical conditional-required message');
      },
    },

    {
      name: 'user-signup-consent-shape-pin',
      async run({ assert }) {
        // Pins the resolved consent contract buildConsentRecord() consumes — captured from
        // the pre-conversion declarative engine. Omitted consent resolves to
        // granted: false / text: '' (force-coerced), NOT absent; the route's
        // never-downgrade logic depends on reading exactly this shape.
        const signupSchema = require('../../src/manager/schemas/user/signup/post.js');
        const user = { auth: { uid: 'u1' } };

        const empty = resolve(signupSchema({ user }), {});
        assert.equal(
          J(empty),
          J({ uid: 'u1', attribution: {}, context: {}, consent: { legal: { granted: false, text: '' }, marketing: { granted: false, text: '' } } }),
          'Empty signup resolves the pinned consent structure'
        );

        const partial = resolve(signupSchema({ user }), { consent: { legal: { granted: 1 } }, attribution: { src: 'x' }, evil: 'strip' });
        assert.equal(
          J(partial),
          J({ uid: 'u1', attribution: { src: 'x' }, context: {}, consent: { legal: { granted: true, text: '' }, marketing: { granted: false, text: '' } } }),
          'Partial consent coerces granted, defaults the rest, strips unknowns'
        );
      },
    },

    {
      name: 'enum-option-accepted-not-enforced',
      async run({ assert }) {
        // enum was always decorative in the declarative engine (user/oauth2 declares it,
        // nothing validates) — the builders accept + store it without enforcing;
        // enforcement is a post-parity tightening decision
        const zod = f.object({ action: f.string({ default: 'authorize', enum: ['authorize', 'status'] }) });

        assert.equal(resolve(zod, { action: 'not-in-enum' }).action, 'not-in-enum', 'Out-of-enum value passes (decorative parity)');
      },
    },

    {
      name: 'raw-zod-native-semantics',
      async run({ assert }) {
        // Raw zod (no builders) opts into zod-native validation: rejects with 400
        const raw = z.object({ n: z.number() });

        assert.equal(resolve(raw, { n: 5 }).n, 5, 'Valid raw-zod input resolves');

        let error;
        try { resolve(raw, { n: 'not-a-number' }); } catch (e) { error = e; }
        assert.equal(error && error.code, 400, 'Raw zod rejects invalid input with 400');
        assert.match(error.message, /\{n\}/, 'Error names the failing path');
      },
    },

    {
      name: 'detection-and-builder-guards',
      async run({ assert }) {
        assert.ok(isZodSchema(z.object({})), 'Detects zod object');
        assert.ok(isZodSchema(f.object({ a: f.string({ default: '' }) })), 'Detects fields.object pipe');
        assert.ok(!isZodSchema({ a: { types: ['string'], default: '' } }), 'Declarative node is not zod');
        assert.ok(!isZodSchema(null) && !isZodSchema('x'), 'Primitives are not zod');

        let error;
        try { f.string({ defualt: 'typo' }); } catch (e) { error = e; }
        assert.match(error && error.message, /unknown option/, 'Builder rejects typo\'d options');
      },
    },
  ],
};
