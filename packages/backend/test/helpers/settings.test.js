/**
 * Test: helpers/schema.js (the ONE schema adapter) and services/settings.js
 * (the request service that loads a route's schema and runs it)
 *
 * Run: npx omega test backend:helpers/settings
 *
 * - The reference schema (schemas/test/schema/post.js) resolved against
 *   hard-coded output: a full input, a defaults-only input, an empty input.
 * - The vocabulary: coerce-never-reject, bounds, `of`, nested `fields`,
 *   `enum`/`pattern` on sent values, the `min` length refusal, forced
 *   `value`, `path` ids, and the malformed-declaration throws (the
 *   `required` + `default` footgun by name).
 * - The service: method file first, index.js fallback, the masking guard,
 *   the raw-parts context, and one case per split kind (plan, query, path,
 *   method, header).
 *
 * Schema files are written to a real temp dir and loaded through the real require.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Settings = require('../../dist/omega/services/settings.js');
const { validate, pathParams } = require('../../dist/omega/helpers/schema.js');
const { User } = require('../../dist/omega/helpers/account.js');
const referenceSchema = require('../../dist/omega/schemas/test/schema/post.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const basicUser = new User({ auth: { uid: 'basic-uid' } });
const premiumUser = new User({ auth: { uid: 'premium-uid' }, subscription: { product: { id: 'pro' }, status: 'active' } });

// The ctx surface Settings.resolve touches
function makeCtx(request, user) {
  return {
    omega: { cwd: '/nonexistent-cwd' },
    user: user || basicUser,
    log: () => {},
    report: (message, options) => Object.assign(new Error(message), options),
    request: { method: 'POST', body: {}, query: {}, path: '', headers: {}, geolocation: {}, data: {}, ...request },
  };
}

// Write a schema tree ({ 'relative/path': source }) into a fresh temp dir
function schemaDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-settings-'));
  for (const [relative, source] of Object.entries(files)) {
    const abs = path.join(dir, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
  return dir;
}

// The thrown error of fn, or undefined
function thrownBy(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
}

// Validate a one-field declaration and return the field's value (or the refusal)
function one(field, input) {
  const { data, error } = validate({ v: field }, typeof input === 'undefined' ? {} : { v: input });

  return error ? `refused: ${error}` : data.v;
}

const NAME_SCHEMA = 'module.exports = () => ({ name: { type: \'string\', default: \'%LABEL%\' } });';

const FULL_INPUT = {
  requiredField: 'provided', stringField: 'custom', numberField: '77', booleanField: 'false',
  arrayField: 'x,y', objectField: { custom: 1 }, minNumber: -5, maxNumber: 500,
  clampedNumber: 200, maxLengthString: 'way-too-long-for-limit', maxLengthArray: [1, 2, 3, 4, 5],
  tags: 'alpha,beta-long,c,d', planBasedLimit: 500, multiType: 123, anyType: { deep: [1] },
  mode: 'full', zip: '12345', cleanedString: 'a@b!1', cleanedFunction: '  UP  ',
  nested: { level1: 'set', evil: 1 }, forcedValue: 'try-to-override', premiumOnlyField: 'sneak', evil: 'strip',
};

const DEFAULTS = {
  stringField: 'default-string', numberField: 42, booleanField: false, arrayField: ['a', 'b', 'c'],
  objectField: { key: 'value' }, requiredField: 'x', conditionalRequired: '', userBasedDefault: 'basic-uid',
  forcedValue: 'always-this-value', minNumber: 5, maxNumber: 50, clampedNumber: 50, maxLengthString: '',
  maxLengthArray: [], tags: [], planBasedLimit: 10, multiType: 'default', anyType: null, mode: 'quick', zip: '',
  cleanedString: '', cleanedFunction: '', nested: { level1: 'nested-default' },
};

module.exports = defineCases({
  description: 'The schema adapter and the Settings service',
  type: 'group',

  tests: [
    // ─── The reference case ───

    {
      name: 'reference-schema-full-input',
      async run({ assert }) {
        const { data } = validate(referenceSchema({ user: basicUser }), FULL_INPUT);

        assert.match(data.functionDefault, /^generated-\d+$/);
        delete data.functionDefault;

        assert.deepEqual(data, {
          stringField: 'custom', numberField: 77, booleanField: false, arrayField: ['x', 'y'],
          objectField: { custom: 1 }, requiredField: 'provided', conditionalRequired: '', userBasedDefault: 'basic-uid',
          forcedValue: 'always-this-value', minNumber: 1, maxNumber: 100, clampedNumber: 100, maxLengthString: 'way-too-lo',
          maxLengthArray: [1, 2, 3], tags: ['alpha', 'beta-', 'c'], planBasedLimit: 100, multiType: 123, anyType: { deep: [1] },
          mode: 'full', zip: '12345', cleanedString: 'ab1', cleanedFunction: 'up', nested: { level1: 'set' },
        });
      },
    },

    {
      name: 'reference-schema-empty-and-defaults-only-input',
      async run({ assert }) {
        const empty = validate(referenceSchema({ user: basicUser }), {});
        assert.deepEqual(empty, { error: 'Required key {requiredField} is missing in settings' });

        const { data } = validate(referenceSchema({ user: basicUser }), { requiredField: 'x' });
        delete data.functionDefault;
        assert.deepEqual(data, DEFAULTS);

        // Object defaults are clones: a request never mutates the declaration's
        const declaration = referenceSchema({ user: basicUser });
        validate(declaration, { requiredField: 'x' }).data.objectField.mutated = true;
        assert.deepEqual(validate(declaration, { requiredField: 'x' }).data.objectField, { key: 'value' });
      },
    },

    // ─── The vocabulary ───

    {
      name: 'defaults-coerce-and-never-reject',
      async run({ assert }) {
        assert.equal(one({ type: 'number', default: 5 }, '42'), 42);
        assert.equal(one({ type: 'number', default: 5 }, 'abc'), 1, 'an unparseable number coerces, never refuses');
        assert.equal(one({ type: 'number' }), 0);
        assert.equal(one({ type: 'string', default: null }), '', 'a single type coerces its default too');
        assert.equal(one({ type: 'string', default: 'd' }, true), 'true');
        assert.equal(one({ type: 'boolean', default: true }, 'false'), false);
        assert.deepEqual(one({ type: 'array', default: [] }, 'a, b,,c'), ['a', 'b', 'c']);
        assert.equal(one({ type: 'object', default: {} }, 'x'), undefined, 'a non-object is dropped');
        assert.deepEqual(one({ type: 'object', default: {} }, [1, 2]), [1, 2], 'an array is an object (typeof)');
        assert.equal(one({ type: 'object', default: null }), null);
        assert.deepEqual(one({ type: 'any', default: null }, { complex: [1] }), { complex: [1] });
        assert.equal(one({ type: 'number', default: 7 }, NaN), 7, 'a non-finite number takes the default');
        assert.equal(one({ type: 'number', default: 7 }, 'Infinity'), 7);
        assert.equal(one({ type: 'string', default: () => 'computed' }), 'computed', 'a function default runs');
      },
    },

    {
      name: 'a-type-list-keeps-a-match-and-otherwise-takes-the-default',
      async run({ assert }) {
        const field = { type: ['string', 'number'], default: 'fallback' };

        assert.equal(one(field, 'kept'), 'kept');
        assert.equal(one(field, 7), 7);
        assert.equal(one(field, true), 'fallback', 'no coercion across a list');
        assert.equal(one(field, NaN), 'fallback');
        assert.equal(one({ type: ['string', 'number'] }), undefined);
      },
    },

    {
      name: 'bounds-clamp-numbers-and-truncate-strings-and-arrays',
      async run({ assert }) {
        assert.equal(one({ type: 'number', default: 50, min: 10, max: 100 }, 5), 10);
        assert.equal(one({ type: 'number', default: 50, min: 10, max: 100 }, 200), 100);
        assert.equal(one({ type: 'number', default: 5 }, -10), -10, 'no declared min, no floor');
        assert.equal(one({ type: 'number', default: 5, max: 0 }, 3), 0, 'a declared 0 is a real bound');
        assert.equal(one({ type: 'string', default: '', max: 3 }, 'abcdef'), 'abc');
        assert.deepEqual(one({ type: 'array', default: [], max: 2 }, [1, 2, 3]), [1, 2]);
      },
    },

    {
      name: 'min-refuses-short-strings-and-arrays-sent-or-defaulted',
      async run({ assert }) {
        assert.equal(one({ type: 'string', default: '', min: 1 }), 'refused: Invalid settings {v}: must be at least 1 character');
        assert.equal(one({ type: 'string', default: '', min: 2 }, 'a'), 'refused: Invalid settings {v}: must be at least 2 characters');
        assert.equal(one({ type: 'array', default: [], min: 2 }, ['solo']), 'refused: Invalid settings {v}: must have at least 2 items');
        assert.equal(one({ type: 'string', default: '', min: 1 }, 'ok'), 'ok');
      },
    },

    {
      name: 'enum-and-pattern-judge-only-sent-values',
      async run({ assert }) {
        const mode = { type: 'string', enum: ['quick', 'full'], default: 'quick' };

        assert.equal(one(mode, 'full'), 'full');
        assert.equal(one(mode), 'quick');
        assert.equal(one(mode, 'banana'), 'refused: Invalid settings {v}: must be one of [quick, full]');
        assert.equal(one({ type: 'string', enum: ['a'], default: null }), '', 'an absent field is never judged');

        const zip = { type: 'string', pattern: /^\d{5}$/g };
        assert.equal(one(zip, '12345'), '12345');
        assert.equal(one(zip, '12345'), '12345', 'a global flag keeps no state between requests');
        assert.equal(one(zip, 'abc'), 'refused: Invalid settings {v}: must match /^\\d{5}$/g');
      },
    },

    {
      name: 'required-reads-the-raw-input-and-never-pairs-with-default',
      async run({ assert }) {
        const field = { type: 'string', required: true };

        assert.equal(one(field), 'refused: Required key {v} is missing in settings');
        assert.equal(one(field, ''), 'refused: Required key {v} is missing in settings', "'' counts as missing");
        assert.equal(one(field, null), '', 'null passes, then coerces');
        assert.equal(one({ type: 'boolean', required: true }, false), false);

        // The footgun: a required field's default could never apply, so it throws by name
        const footgun = thrownBy(() => validate({ action: { type: 'string', required: true, default: 'x' } }, {}));
        assert.match(footgun.message, /Invalid schema at "action": `required` never pairs with `default`/);

        const computed = thrownBy(() => validate({ a: { type: 'string', required: () => true } }, {}));
        assert.match(computed.message, /`required` is a boolean/);
      },
    },

    {
      name: 'a-forced-value-wins-over-input-and-default',
      async run({ assert }) {
        assert.equal(one({ type: 'number', value: 0 }, 99), 0);
        assert.equal(one({ type: 'string', default: 'd', value: 'forced' }), 'forced');
        assert.equal(one({ type: 'number', max: 10, value: 42 }, 999), 42, 'value applies after bounds');
      },
    },

    {
      name: 'nested-fields-and-array-items-carry-their-own-limits',
      async run({ assert }) {
        const declaration = {
          address: { type: 'object', default: {}, fields: {
            city: { type: 'string', default: '', max: 3 },
            zip: { type: 'string', required: true },
          } },
          tags: { type: 'array', of: { type: 'string', max: 2 }, default: [], max: 2 },
          rows: { type: 'array', default: [], of: { type: 'object', fields: { n: { type: 'number', min: 1 } } } },
        };

        assert.deepEqual(validate(declaration, {
          address: { city: 'Springfield', zip: 90210, evil: 1 },
          tags: ['abc', 7, 'z'],
          rows: [{ n: -3, evil: 1 }, 'garbage'],
        }).data, {
          address: { city: 'Spr', zip: '90210' },
          tags: ['ab', '7'],
          rows: [{ n: 1 }, { n: 1 }],
        });

        assert.equal(validate(declaration, {}).error, 'Required key {address.zip} is missing in settings');
        assert.equal(validate(declaration, { address: 'garbage' }).error, 'Required key {address.zip} is missing in settings');
        assert.equal(validate({ tags: { type: 'array', of: { type: 'string', min: 2 } } }, { tags: ['ok', 'x'] }).error, 'Invalid settings {tags.1}: must be at least 2 characters');
      },
    },

    {
      name: 'path-ids-come-from-the-request-path-alone',
      async run({ assert }) {
        assert.deepEqual(pathParams('/items/abc', 'items'), ['abc']);
        assert.deepEqual(pathParams('/omega/items/abc/7', 'items'), ['abc', '7']);
        assert.deepEqual(pathParams('/abc', 'items'), ['abc'], 'a function called at its own root: every segment is an id');
        assert.deepEqual(pathParams('/omega/test/schema', 'test/schema'), []);

        const declaration = { id: { type: 'string', path: true, required: true }, page: { type: 'string', path: true } };

        assert.deepEqual(validate(declaration, { id: 'sent-in-body' }, { pathParams: ['abc', '2'] }).data, { id: 'abc', page: '2' });
        assert.equal(validate(declaration, { id: 'sent-in-body' }).error, 'Required key {id} is missing in settings', 'the caller cannot set a path id');

        const nested = thrownBy(() => validate({ o: { type: 'object', fields: { id: { type: 'string', path: true } } } }, {}));
        assert.match(nested.message, /Invalid schema at "o\.id": `path` is `true` on a top-level field/);
      },
    },

    {
      name: 'a-malformed-declaration-throws-naming-the-field',
      async run({ assert }) {
        assert.match(thrownBy(() => validate({ a: { type: 'string', defualt: 'x' } }, {})).message, /"a": unknown key\(s\) defualt/);
        assert.match(thrownBy(() => validate({ a: { type: 'text' } }, {})).message, /"a": `type` must be one of/);
        assert.match(thrownBy(() => validate({ a: { default: 1 } }, {})).message, /"a": `type` must be one of/);
        assert.match(thrownBy(() => validate({ a: { type: 'string', of: { type: 'string' } } }, {})).message, /`of` belongs to `type: 'array'`/);
        assert.match(thrownBy(() => validate({ a: { type: 'array', fields: {} } }, {})).message, /`fields` belongs to `type: 'object'`/);
        assert.match(thrownBy(() => validate({ a: 'string' }, {})).message, /"a": a field is a plain object/);
      },
    },

    // ─── The service: schema file resolution ───

    {
      name: 'the-method-file-wins-over-index-and-index-is-the-fallback',
      async run({ assert }) {
        const dir = schemaDir({
          'thing/post.js': NAME_SCHEMA.replace('%LABEL%', 'from-post'),
          'thing/index.js': NAME_SCHEMA.replace('%LABEL%', 'from-index'),
        });

        assert.equal(new Settings(makeCtx({ method: 'POST' })).resolve({ dir, schema: 'thing' }).name, 'from-post');
        assert.equal(new Settings(makeCtx({ method: 'DELETE' })).resolve({ dir, schema: 'thing' }).name, 'from-index');
        assert.equal(new Settings(makeCtx({ method: 'GET' })).resolve({ dir, schema: 'thing.js' }).name, 'from-index', 'a .js suffix is tolerated');
      },
    },

    {
      name: 'neither-file-present-is-an-honest-500-naming-both-paths',
      async run({ assert }) {
        const dir = schemaDir({ 'other/index.js': NAME_SCHEMA.replace('%LABEL%', 'x') });
        const thrown = thrownBy(() => new Settings(makeCtx({ method: 'PATCH' })).resolve({ dir, schema: 'thing' }));

        assert.equal(thrown.code, 500);
        assert.match(thrown.message, /No schema for PATCH request: expected thing\/patch\.js or thing\/index\.js/);
      },
    },

    {
      // The masking guard: a schema file that EXISTS but throws, or whose own
      // require fails (MODULE_NOT_FOUND too, and its "Require stack:" names the
      // schema file), surfaces its own error, never the index fallback
      name: 'a-broken-schema-file-surfaces-its-own-error',
      async run({ assert }) {
        const index = NAME_SCHEMA.replace('%LABEL%', 'from-index');
        const throwing = schemaDir({ 'thing/post.js': 'throw new Error("the schema itself is broken");', 'thing/index.js': index });
        const innerRequire = schemaDir({ 'thing/post.js': 'require("a-package-that-does-not-exist");', 'thing/index.js': index });
        const brokenIndex = schemaDir({ 'thing/index.js': 'require("another-package-that-does-not-exist");' });

        assert.equal(thrownBy(() => new Settings(makeCtx()).resolve({ dir: throwing, schema: 'thing' })).message, 'the schema itself is broken');

        const inner = thrownBy(() => new Settings(makeCtx()).resolve({ dir: innerRequire, schema: 'thing' }));
        assert.equal(inner.code, 'MODULE_NOT_FOUND');
        assert.match(inner.message, /a-package-that-does-not-exist/);

        const broken = thrownBy(() => new Settings(makeCtx()).resolve({ dir: brokenIndex, schema: 'thing' }));
        assert.match(broken.message, /another-package-that-does-not-exist/);
      },
    },

    {
      name: 'a-schema-that-returns-no-declaration-is-a-500-and-a-refusal-a-400',
      async run({ assert }) {
        const dir = schemaDir({
          'none/post.js': 'module.exports = () => null;',
          'strict/post.js': 'module.exports = () => ({ email: { type: \'string\', required: true } });',
        });

        const none = thrownBy(() => new Settings(makeCtx()).resolve({ dir, schema: 'none' }));
        assert.equal(none.code, 500);
        assert.equal(none.message, 'Invalid schema none: the schema function must return a plain field declaration');

        const refused = thrownBy(() => new Settings(makeCtx()).resolve({ dir, schema: 'strict' }));
        assert.equal(refused.code, 400);
        assert.equal(refused.message, 'Required key {email} is missing in settings');
      },
    },

    // ─── The service: the context and the splits ───

    {
      name: 'the-schema-receives-the-raw-parts-by-name-and-the-declaration-is-kept',
      async run({ assert }) {
        const dir = schemaDir({
          'echo/post.js': `module.exports = (context) => {
            global.__omegaSchemaContext = context;
            return { html: { type: 'string', default: '', sanitize: false }, title: { type: 'string', default: '' } };
          };`,
        });
        const request = { body: { a: 1 }, query: { q: '2' }, path: '/echo', headers: { h: 'x' }, geolocation: { country: 'US' } };
        const settings = new Settings(makeCtx(request, premiumUser));

        settings.resolve({ dir, schema: 'echo' });
        const context = global.__omegaSchemaContext;
        delete global.__omegaSchemaContext;

        assert.deepEqual(Object.keys(context).sort(), ['body', 'geolocation', 'headers', 'method', 'path', 'query', 'user']);
        assert.equal(context.user, premiumUser, 'the User instance itself');
        assert.equal(context.user.plan, 'pro', 'getters, never raw');
        assert.deepEqual([context.body, context.query, context.path, context.method, context.headers, context.geolocation], [request.body, request.query, '/echo', 'POST', request.headers, request.geolocation]);
        assert.equal(settings.declaration.html.sanitize, false, 'the sanitize pass reads the declaration');
      },
    },

    {
      name: 'split-on-plan',
      async run({ assert }) {
        const input = { requiredField: 'x', planBasedLimit: 500, premiumOnlyField: 'mine' };

        const basic = validate(referenceSchema({ user: basicUser }), input).data;
        assert.equal(basic.planBasedLimit, 100);
        assert.equal('premiumOnlyField' in basic, false);

        const premium = validate(referenceSchema({ user: premiumUser }), { ...input, conditionalRequired: 'yes' }).data;
        assert.equal(premium.planBasedLimit, 500, 'premium max 1000');
        assert.equal(premium.premiumOnlyField, 'mine');
        assert.equal(validate(referenceSchema({ user: premiumUser }), input).error, 'Required key {conditionalRequired} is missing in settings');
      },
    },

    {
      name: 'split-on-query-path-method-and-header',
      async run({ assert }) {
        const dir = schemaDir({
          'items/index.js': `module.exports = ({ query, path, method, headers }) => {
            const fields = {
              id: { type: 'string', path: true },
              tags: { type: 'array', default: [], max: 2 },
              total: { type: 'number', value: 0 },
              note: { type: 'string', default: '' },
              mode: { type: 'string', default: 'quick' },
            };
            if (query.bulk === 'true') fields.tags.max = 50;
            if (path.endsWith('/admin')) fields.total = { type: 'number', default: 0 };
            if (method === 'PUT') fields.note = { type: 'string', required: true };
            if (headers['x-mode'] === 'full') fields.mode.enum = ['full'];
            return fields;
          };`,
        });
        const run = (request) => {
          const ctx = makeCtx({ path: '/items/abc', ...request, data: { ...request.body, ...request.query } });
          try {
            return new Settings(ctx).resolve({ dir, schema: 'items' });
          } catch (e) {
            return e.message;
          }
        };
        const tags = ['a', 'b', 'c'];

        assert.deepEqual(run({ body: { tags, total: 9 } }), { id: 'abc', tags: ['a', 'b'], total: 0, note: '', mode: 'quick' });
        assert.deepEqual(run({ body: { tags }, query: { bulk: 'true' } }).tags, tags, 'query split');
        assert.equal(run({ path: '/items/admin', body: { total: 9 } }).total, 9, 'path split');
        assert.equal(run({ method: 'PUT', body: {} }), 'Required key {note} is missing in settings', 'method split');
        assert.equal(run({ headers: { 'x-mode': 'full' }, body: { mode: 'quick' } }), 'Invalid settings {mode}: must be one of [full]', 'header split');
      },
    },
  ],
});
