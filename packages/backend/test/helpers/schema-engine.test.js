/**
 * Test: helpers/schema-engine.js — the shared field pipeline, direct
 *
 * Run: npx omega test backend:helpers/schema-engine
 *
 * schema-zod.test.js proves the ENGINE PARITY story (declarative vs zod vs
 * the powertools oracle) through Settings.resolve(). This file tests the
 * engine's own exported units at the layer they live at: leaf detection, the
 * schema walk, one field's resolution pipeline, and the enum door — none of
 * which the parity suite calls directly.
 */
const {
  FIELD_OPTIONS,
  isFieldNode,
  iterateSchema,
  resolveSchema,
  resolveFieldValue,
  enforceEnums,
} = require('../../src/manager/helpers/schema-engine.js');

// The one ctx surface enforceEnums touches.
const ctx = { report: (message, options) => Object.assign(new Error(message), options) };

// Collect the (path, node) pairs the walk visits, in order.
function walk(schema) {
  const seen = [];
  iterateSchema(schema, (path, node) => seen.push([path, node]));
  return seen;
}

module.exports = {
  description: 'schema-engine leaf detection, walk, field pipeline, enums',
  type: 'group',

  tests: [
    // ─── isFieldNode ───

    {
      name: 'any-field-option-marks-a-leaf',
      async run({ assert }) {
        for (const key of FIELD_OPTIONS) {
          assert.equal(isFieldNode({ [key]: undefined }), true, `${key} marks a leaf`);
        }
        // `available` is legacy-declarative-only but still a leaf marker.
        assert.equal(isFieldNode({ available: false }), true);
      },
    },

    {
      name: 'plain-groups-and-non-objects-are-not-leaves',
      async run({ assert }) {
        assert.equal(isFieldNode({ nested: { types: ['string'] } }), false);
        assert.equal(isFieldNode({}), false);
        assert.equal(isFieldNode([]), false);
        assert.equal(isFieldNode(['types']), false);
        assert.equal(isFieldNode(null), false);
        assert.equal(isFieldNode(undefined), false);
        assert.equal(isFieldNode('types'), false);
      },
    },

    // ─── iterateSchema ───

    {
      name: 'the-walk-visits-leaves-in-schema-key-order-with-dot-paths',
      async run({ assert }) {
        const seen = walk({
          name: { types: ['string'] },
          profile: {
            age: { types: ['number'] },
            address: { city: { types: ['string'] } },
          },
          active: { types: ['boolean'] },
        });

        assert.deepEqual(seen.map(([path]) => path), [
          'name',
          'profile.age',
          'profile.address.city',
          'active',
        ]);
        assert.deepEqual(seen[0][1], { types: ['string'] }, 'the node itself is handed over');
      },
    },

    {
      name: 'empty-objects-arrays-and-scalars-contribute-no-paths',
      async run({ assert }) {
        assert.deepEqual(walk({ nothing: {}, list: [1, 2], scalar: 'x', real: { types: ['string'] } })
          .map(([path]) => path), ['real']);
        assert.deepEqual(walk({}), []);
        assert.deepEqual(walk(null), []);
      },
    },

    {
      name: 'a-field-node-at-the-root-walks-as-the-empty-path',
      async run({ assert }) {
        assert.deepEqual(walk({ types: ['string'] }).map(([path]) => path), ['']);
        // ...and resolveSchema drops it — there is no key to set it onto.
        assert.deepEqual(resolveSchema({}, { types: ['string'] }), {});
      },
    },

    // ─── resolveFieldValue: the shared pipeline, one leaf at a time ───

    {
      name: 'absent-input-takes-the-default-present-input-wins',
      async run({ assert }) {
        assert.equal(resolveFieldValue(undefined, { types: ['string'], default: 'fallback' }), 'fallback');
        assert.equal(resolveFieldValue('sent', { types: ['string'], default: 'fallback' }), 'sent');
        // null is a SENT value, not an absence.
        assert.equal(resolveFieldValue(null, { types: ['any'], default: 'fallback' }), null);
      },
    },

    {
      name: 'single-typed-fields-coerce-multi-typed-fall-back-to-the-default',
      async run({ assert }) {
        assert.equal(resolveFieldValue('42', { types: ['number'] }), 42);
        assert.equal(resolveFieldValue(42, { types: ['string'] }), '42');
        assert.equal(resolveFieldValue('true', { types: ['boolean'] }), true);

        const multi = { types: ['string', 'number'], default: 'fallback' };
        assert.equal(resolveFieldValue('kept', multi), 'kept');
        assert.equal(resolveFieldValue(7, multi), 7);
        assert.equal(resolveFieldValue(true, multi), 'fallback', 'no coercion when multi-typed');
      },
    },

    {
      name: 'any-accepts-everything-untouched',
      async run({ assert }) {
        assert.equal(resolveFieldValue(true, { types: ['any'] }), true);
        assert.deepEqual(resolveFieldValue({ a: 1 }, { types: ['any'] }), { a: 1 });
        assert.equal(resolveFieldValue('x', {}), 'x', 'no types means any');
      },
    },

    {
      name: 'min-and-max-enforce-only-when-declared',
      async run({ assert }) {
        // Numbers clamp both ways.
        assert.equal(resolveFieldValue(5, { types: ['number'], min: 10 }), 10);
        assert.equal(resolveFieldValue(50, { types: ['number'], max: 20 }), 20);
        // A declared 0 is a REAL bound (the powertools `min || 0` bug, fixed).
        assert.equal(resolveFieldValue(-5, { types: ['number'], min: 0 }), 0);
        assert.equal(resolveFieldValue(5, { types: ['number'], max: 0 }), 0);
        // No min declared → negatives pass straight through.
        assert.equal(resolveFieldValue(-5, { types: ['number'] }), -5);
      },
    },

    {
      name: 'strings-and-arrays-truncate-to-max-and-ignore-min',
      async run({ assert }) {
        assert.equal(resolveFieldValue('abcdefgh', { types: ['string'], max: 3 }), 'abc');
        assert.equal(resolveFieldValue('ab', { types: ['string'], min: 5 }), 'ab', 'min never pads');
        assert.deepEqual(resolveFieldValue([1, 2, 3, 4], { types: ['array'], max: 2 }), [1, 2]);
      },
    },

    {
      name: 'a-forced-value-overrides-everything-including-the-input',
      async run({ assert }) {
        assert.equal(resolveFieldValue('sent', { types: ['string'], value: 'forced' }), 'forced');
        assert.equal(resolveFieldValue(999, { types: ['number'], max: 10, value: 42 }), 42, 'value applies AFTER bounds');
      },
    },

    {
      name: 'function-defaults-and-values-execute-except-for-any-and-function-types',
      async run({ assert }) {
        assert.equal(resolveFieldValue(undefined, { types: ['string'], default: () => 'computed' }), 'computed');
        assert.equal(resolveFieldValue('x', { types: ['string'], value: () => 'computed' }), 'computed');

        // For 'any'/'function' the function IS the value.
        const fn = () => 'never-called';
        assert.equal(resolveFieldValue(undefined, { types: ['any'], default: fn }), fn);
        assert.equal(resolveFieldValue(undefined, { types: ['function'], default: fn }), fn);
      },
    },

    {
      name: 'object-defaults-are-cloned-so-a-request-cannot-mutate-schema-state',
      async run({ assert }) {
        const node = { types: ['object'], default: { nested: { count: 0 } } };

        const first = resolveFieldValue(undefined, node);
        first.nested.count = 99;
        const second = resolveFieldValue(undefined, node);

        assert.equal(second.nested.count, 0);
        assert.equal(first === node.default, false, 'never returned by reference');
      },
    },

    {
      name: 'clean-runs-last-as-a-regex-or-a-function',
      async run({ assert }) {
        assert.equal(resolveFieldValue('a1b2c3', { types: ['string'], clean: /[0-9]/g }), 'abc');
        assert.equal(resolveFieldValue('  padded  ', { types: ['string'], clean: (v) => v.trim() }), 'padded');
        // clean sees the FULLY resolved value (post-truncation).
        assert.equal(resolveFieldValue('a1b2c3', { types: ['string'], max: 4, clean: /[0-9]/g }), 'ab');
      },
    },

    // ─── resolveSchema: unknown keys strip, nesting rebuilds ───

    {
      name: 'unknown-keys-strip-at-every-level',
      async run({ assert }) {
        const resolved = resolveSchema(
          { name: 'ok', sneaky: 'dropped', profile: { age: 30, admin: true } },
          { name: { types: ['string'] }, profile: { age: { types: ['number'] } } },
        );

        assert.deepEqual(resolved, { name: 'ok', profile: { age: 30 } });
      },
    },

    {
      name: 'resolveSchema-mutates-neither-settings-nor-schema',
      async run({ assert }) {
        const settings = { name: 'ok' };
        const schema = { name: { types: ['string'] }, missing: { types: ['string'], default: 'd' } };

        resolveSchema(settings, schema);

        assert.deepEqual(settings, { name: 'ok' });
        assert.deepEqual(schema, { name: { types: ['string'] }, missing: { types: ['string'], default: 'd' } });
      },
    },

    // ─── enforceEnums ───

    {
      name: 'a-sent-value-outside-the-list-rejects-with-400',
      async run({ assert }) {
        const paths = [{ path: 'action', allowed: ['authorize', 'status'] }];

        let thrown;
        try {
          enforceEnums(ctx, { action: 'delete' }, { action: 'delete' }, paths);
        } catch (e) {
          thrown = e;
        }

        assert.equal(thrown instanceof Error, true);
        assert.equal(thrown.code, 400);
        assert.equal(thrown.message, 'Invalid settings {action}: must be one of [authorize, status]');
      },
    },

    {
      name: 'sent-and-allowed-passes-absent-passes-too',
      async run({ assert }) {
        const paths = [{ path: 'action', allowed: ['authorize', 'status'] }];

        enforceEnums(ctx, { action: 'status' }, { action: 'status' }, paths);
        // Absent from the RAW input — a schema default is presumed valid.
        enforceEnums(ctx, {}, { action: 'not-in-the-list' }, paths);
        enforceEnums(ctx, {}, {}, []);
      },
    },

    {
      name: 'the-check-runs-on-the-resolved-post-coercion-value',
      async run({ assert }) {
        const paths = [{ path: 'level', allowed: [1, 2] }];

        // Sent as '1', coerced to 1 by the number field — the enum sees 1.
        enforceEnums(ctx, { level: '1' }, { level: 1 }, paths);

        let thrown;
        try {
          enforceEnums(ctx, { level: '1' }, { level: '1' }, paths);
        } catch (e) {
          thrown = e;
        }
        assert.equal(thrown.code, 400, 'an uncoerced string is not the allowed number');
      },
    },

    {
      name: 'nested-enum-paths-are-read-by-dot-path',
      async run({ assert }) {
        const paths = [{ path: 'options.mode', allowed: ['a', 'b'] }];

        enforceEnums(ctx, { options: { mode: 'a' } }, { options: { mode: 'a' } }, paths);

        let thrown;
        try {
          enforceEnums(ctx, { options: { mode: 'z' } }, { options: { mode: 'z' } }, paths);
        } catch (e) {
          thrown = e;
        }
        assert.equal(thrown.message.includes('{options.mode}'), true);
      },
    },
  ],
};
