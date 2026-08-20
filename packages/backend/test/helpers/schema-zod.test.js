/**
 * Test: helpers/schema-zod.js + helpers/schema-engine.js — schema resolution parity
 * Differential proof: every declarative-node behavior (coerce-never-reject, clamp/
 * truncate, required on undefined/'', unknown-key strip) resolves IDENTICALLY through
 * Settings.resolve() whether the schema is a declarative node object (in-house
 * schema-engine) or a fields.* zod schema (zod engine) — both share the same field
 * pipeline.
 *
 * Run: npx omega test helpers/schema-zod
 *
 * The declarative engine replaced powertools.defaults() (cp79); where semantics are
 * shared, this suite still anchors directly against powertools.defaults() as the
 * oracle, and pins the deliberate divergences (fixed bugs):
 * - no pollution of non-empty object defaults with types/min/max keys
 * - defaults are cloned, never shared by reference with the schema
 * - '' counts as missing for required (tightening approved post-parity)
 * And proves the converted test/schema route module against its frozen declarative
 * twin (the pre-conversion schema, preserved here as the reference).
 */
const powertools = require('node-powertools');
const Settings = require('../../src/manager/helpers/settings.js');
const { z, fields: f, isZodSchema } = require('../../src/manager/helpers/schema-zod.js');
const { resolveSchema } = require('../../src/manager/helpers/schema-engine.js');
const zodTestSchemaModule = require('../../src/manager/schemas/test/schema/post.js');

// Mock ctx/manager — Settings.resolve only touches these surfaces when the
// schema is passed directly (no file loading)
const makeAssistant = () => ({
  log() {},
  warn() {},
  report: (msg, opts) => Object.assign(new Error(msg), { code: (opts || {}).code }),
  request: { method: 'POST', user: { auth: { uid: 'u1', email: 'u1@test.com' } } },
});
const Manager = { cwd: '/tmp' };

const resolve = (schema, input, opts) => new Settings(Manager).resolve(makeAssistant(), schema, input, opts || {});
const J = (x) => JSON.stringify(x);

// ─── The differential battery ───
// [label, declarativeNode, zodField, input] — `undefined` input means "key absent".
// Coercion quirks are preserved (unparseable string → 1, prefix parseFloat,
// comma-split arrays, multi-type replace-with-default, null-passes-as-object);
// min/max enforce ONLY when declared since cp84 (no implicit 0 floor; declared 0
// is a real bound) — the literal pins live in min-max-enforce-only-when-declared.
const BATTERY = [
  ['negative-passes-no-min', { types: ['number'], default: 5 },                     f.number({ default: 5 }),                     -10],
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
  ['max-zero-enforces',      { types: ['string'], default: '', max: 0 },            f.string({ default: '', max: 0 }),            'abcdef'],
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

// Normalize for twin diffs: JSON round-trip + drop the time-based field. (No
// pollution-stripping needed anymore — since cp79 BOTH engines return object
// defaults clean, so twin comparisons are strict.)
const normalizeTwin = (settings) => {
  const out = JSON.parse(J(settings));
  delete out.functionDefault;

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
      name: 'required-fires-on-undefined-and-empty-string',
      async run({ assert }) {
        // cp79 tightening: '' counts as missing (it used to pass) — identically in
        // both engines. null, 0, false still pass.
        const decl = { r: { types: ['string'], default: undefined, required: true } };
        const zod = f.object({ r: f.string({ default: undefined, required: true }) });

        let declError, zodError;
        try { resolve(decl, { r: '' }); } catch (e) { declError = e; }
        try { resolve(zod, { r: '' }); } catch (e) { zodError = e; }

        assert.ok(declError && zodError, 'Both engines reject empty string on required');
        assert.equal(zodError.message, declError.message, 'Identical message');
        assert.equal(zodError.message, 'Required key {r} is missing in settings', 'Exact message');
        assert.equal(zodError.code, 400, 'Rejects with 400');

        // null/0/false still pass required
        assert.equal(resolve(zod, { r: null }).r, '', 'null passes required (then coerces)');
        assert.equal(resolve(f.object({ n: f.number({ default: 9, required: true }) }), { n: 0 }).n, 0, '0 passes required');
        assert.equal(resolve(f.object({ b: f.boolean({ default: true, required: true }) }), { b: false }).b, false, 'false passes required');
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
        // Same contract as declarative required(ctx, settings, options)
        const zod = f.object({
          other: f.string({ default: '' }),
          dependent: f.string({ default: undefined, required: (ctx, settings) => settings.other === 'trigger' }),
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
        // The bug the in-house engine replaced powertools.defaults() for: powertools
        // mutates non-empty object defaults with types/min/max keys and returns them
        // by reference. Pinned here directly against powertools; BOTH our engines
        // return clean clones.
        const polluted = powertools.defaults({}, { o: { types: ['object'], default: { key: 'value' } } });
        assert.ok('types' in polluted.o && 'min' in polluted.o, 'powertools.defaults() pollutes (why it was replaced)');

        const node = { o: { types: ['object'], default: { key: 'value' } } };
        const zod = f.object({ o: f.passthrough({ default: { key: 'value' } }) });

        assert.equal(J(resolve(node, {}).o), J({ key: 'value' }), 'Declarative engine returns the default clean');
        assert.equal(J(resolve(zod, {}).o), J({ key: 'value' }), 'Zod engine returns the default clean');

        // And clones: two resolves must not share the default object — both engines
        const firstDecl = resolve(node, {});
        firstDecl.o.mutated = true;
        assert.ok(!('mutated' in resolve(node, {}).o), 'Declarative defaults are cloned per resolve');

        const firstZod = resolve(zod, {});
        firstZod.o.mutated = true;
        assert.ok(!('mutated' in resolve(zod, {}).o), 'Zod defaults are cloned per resolve');
      },
    },

    {
      name: 'declarative-engine-powertools-oracle-pins',
      async run({ assert }) {
        // resolveSchema() is the drop-in powertools.defaults() replacement (also used
        // directly by user/settings/validate). Pin the edge semantics probed live
        // against powertools before the swap:

        // Empty-object schema nodes contribute NOTHING (dynamic-schema `options: {}` pattern)
        assert.equal(J(resolveSchema({ options: { a: 1 }, junk: 2 }, { options: {} })), J({}), 'Empty node strips its subtree');
        assert.equal(J(resolveSchema({ a: 1 }, {})), J({}), 'Empty schema resolves to {}');

        // Non-mutating: fresh output object, input untouched
        const input = { x: '1', junk: 9 };
        const out = resolveSchema(input, { x: { types: ['number'], default: 0 } });
        assert.equal(J(out), J({ x: 1 }), 'Coerces and strips like powertools');
        assert.equal(J(input), J({ x: '1', junk: 9 }), 'Input settings not mutated');

        // Group semantics — direct differential against powertools.defaults()
        // (fresh schema literal per call: powertools MUTATES the schema it's given)
        const makeSchema = () => ({ g: { a: { types: ['string'], default: 'dx' } } });
        assert.equal(
          J(resolveSchema({ g: { a: '1', zz: 9 } }, makeSchema())),
          J(powertools.defaults({ g: { a: '1', zz: 9 } }, makeSchema())),
          'Unknown key inside group stripped — matches powertools'
        );
        assert.equal(
          J(resolveSchema({}, makeSchema())),
          J(powertools.defaults({}, makeSchema())),
          'Absent group resolves leaf defaults — matches powertools'
        );

        // No-default leaf nodes terminate the walk soundly (powertools only terminated
        // because its pollution added `default` to the node first)
        assert.equal(
          J(resolveSchema({}, { flag: { types: ['boolean'], required: false } })),
          J({ flag: false }),
          'No-default node resolves its type zero without pollution\'s help'
        );
      },
    },

    {
      name: 'min-max-enforce-only-when-declared',
      async run({ assert }) {
        // cp84 tightening (Ian: "min should not be enforced if not provided. Same
        // as max.") — literal pins, both engines:
        const noMin = { n: { types: ['number'], default: 5 } };
        const zodNoMin = f.object({ n: f.number({ default: 5 }) });

        assert.equal(resolve(noMin, { n: -10 }).n, -10, 'Declarative: undeclared min lets negatives through');
        assert.equal(resolve(zodNoMin, { n: -10 }).n, -10, 'Zod: undeclared min lets negatives through');

        // Declared bounds still clamp — including 0 as a REAL bound
        assert.equal(resolve(f.object({ n: f.number({ default: 5, min: 0 }) }), { n: -10 }).n, 0, 'min: 0 clamps negatives');
        assert.equal(resolve(f.object({ n: f.number({ default: 5, max: 0 }) }), { n: 3 }).n, 0, 'max: 0 clamps numbers');
        assert.equal(resolve(f.object({ s: f.string({ default: '', max: 0 }) }), { s: 'abc' }).s, '', 'max: 0 truncates strings (was silently unset before cp84)');

        // No max → unbounded
        assert.equal(resolve(zodNoMin, { n: 9999999 }).n, 9999999, 'Undeclared max never clamps');
      },
    },

    {
      name: 'settings-schema-exposed-for-sanitize-pass',
      async run({ assert }) {
        // cp79 fix: Settings.resolve exposes self.schema (per-field sanitize flags) so
        // the middleware sanitize pass can honor sanitize: false — both engines,
        // same nested shape. (Previously middleware read a FRESH instance's schema,
        // which was always undefined.)
        const decl = new Settings(Manager);
        decl.resolve(makeAssistant(), {
          html: { types: ['string'], default: '', sanitize: false },
          plain: { types: ['string'], default: '' },
          g: { x: { types: ['string'], default: '', sanitize: false } },
        }, {});

        assert.equal(decl.schema.html.sanitize, false, 'Declarative: sanitize: false exposed');
        assert.equal(decl.schema.plain.sanitize, true, 'Declarative: default sanitize true');
        assert.equal(decl.schema.g.x.sanitize, false, 'Declarative: nested flag exposed');

        const viaZod = new Settings(Manager);
        viaZod.resolve(makeAssistant(), f.object({
          html: f.string({ default: '', sanitize: false }),
          plain: f.string({ default: '' }),
          g: f.object({ x: f.string({ default: '', sanitize: false }) }),
        }), {});

        assert.equal(viaZod.schema.html.sanitize, false, 'Zod: sanitize: false exposed');
        assert.equal(viaZod.schema.plain.sanitize, true, 'Zod: default sanitize true');
        assert.equal(viaZod.schema.g.x.sanitize, false, 'Zod: nested flag exposed');

        // Raw zod has no registry → empty map (every field sanitizes)
        const raw = new Settings(Manager);
        raw.resolve(makeAssistant(), z.object({}), {});
        assert.equal(J(raw.schema), J({}), 'Raw zod exposes an empty map');
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
          J({ uid: 'u1', attribution: {}, trackingConsent: null, context: {}, consent: { legal: { granted: false, text: '' }, marketing: { granted: false, text: '' } } }),
          'Empty signup resolves the pinned consent structure'
        );

        const partial = resolve(signupSchema({ user }), { consent: { legal: { granted: 1 } }, attribution: { src: 'x' }, evil: 'strip' });
        assert.equal(
          J(partial),
          J({ uid: 'u1', attribution: { src: 'x' }, trackingConsent: null, context: {}, consent: { legal: { granted: true, text: '' }, marketing: { granted: false, text: '' } } }),
          'Partial consent coerces granted, defaults the rest, strips unknowns'
        );
      },
    },

    {
      name: 'enum-enforced-post-resolution',
      async run({ assert }) {
        // cp80 tightening (Ian-approved): enum REJECTS out-of-list values — both
        // engines, checked post-coercion, only for values the caller actually sent
        // (absent fields pass: enum does not imply required).
        const decl = { action: { types: ['string'], default: 'authorize', enum: ['authorize', 'status'] } };
        const zod = f.object({ action: f.string({ default: 'authorize', enum: ['authorize', 'status'] }) });

        // In-list values and absent-takes-default pass
        assert.equal(resolve(zod, { action: 'status' }).action, 'status', 'In-enum value passes');
        assert.equal(resolve(zod, {}).action, 'authorize', 'Absent field takes the default (no enum check)');
        assert.equal(resolve(decl, {}).action, 'authorize', 'Declarative absent-takes-default passes too');

        // Out-of-enum rejects identically in both engines
        let declError, zodError;
        try { resolve(decl, { action: 'banana' }); } catch (e) { declError = e; }
        try { resolve(zod, { action: 'banana' }); } catch (e) { zodError = e; }

        assert.ok(declError && zodError, 'Both engines reject out-of-enum values');
        assert.equal(zodError.code, 400, 'Rejects with 400');
        assert.equal(zodError.message, declError.message, 'Identical message');
        assert.equal(zodError.message, 'Invalid settings {action}: must be one of [authorize, status]', 'Exact message');

        // Post-coercion: number 5 coerces to '5', which is not in the list
        let coerced;
        try { resolve(zod, { action: 5 }); } catch (e) { coerced = e; }
        assert.equal(coerced && coerced.code, 400, 'Coerced-but-out-of-enum value rejects');

        // No default + field absent → no check (enum ≠ required)
        const optional = f.object({ mode: f.string({ default: undefined, enum: ['a', 'b'] }) });
        assert.ok(resolve(optional, {}), 'Absent optional enum field resolves without throwing');
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
