/**
 * Test: helpers/settings.js — schema FILE loading + constants
 *
 * Run: npx omega test backend:helpers/settings
 *
 * schema-zod.test.js drives Settings.resolve() with schemas passed IN; what
 * only this file covers is the half that reads the disk and the constants
 * factory:
 *   - Method-specific schema first (post.js), index.js as the fallback, and
 *     an honest 500 when neither exists.
 *   - The masking guard: a schema file that EXISTS but throws must re-throw
 *     the real error, never fall back and hide it (the misleading-fallback
 *     bug the isMissingModule() check exists to prevent).
 *   - Settings.constant() — the timestamp trio route schemas compose with.
 *
 * Schemas are written to a real temp dir and loaded through the real require.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Settings = require('../../src/manager/helpers/settings.js');

const Manager = { cwd: '/nonexistent-cwd' };

// The ctx surface Settings.resolve touches.
function makeCtx(method) {
  return {
    log: () => {},
    report: (message, options) => Object.assign(new Error(message), options),
    getUser: () => ({ auth: { uid: 'test-uid' } }),
    request: {
      method,
      user: { auth: { uid: 'test-uid' } },
      data: {},
      headers: {},
      geolocation: {},
      client: {},
    },
  };
}

// Write a schema tree ({ 'relative/path': source }) into a fresh temp dir.
function schemaDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-settings-'));
  for (const [relative, source] of Object.entries(files)) {
    const abs = path.join(dir, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
  return dir;
}

const NAME_SCHEMA = 'module.exports = () => ({ name: { types: [\'string\'], default: \'%LABEL%\' } });';

module.exports = {
  description: 'Settings schema file loading + constant()',
  type: 'group',

  tests: [
    // ─── Schema file resolution ───

    {
      name: 'the-method-specific-schema-wins-over-index',
      async run({ assert }) {
        const dir = schemaDir({
          'thing/post.js': NAME_SCHEMA.replace('%LABEL%', 'from-post'),
          'thing/index.js': NAME_SCHEMA.replace('%LABEL%', 'from-index'),
        });

        const resolved = new Settings(Manager).resolve(makeCtx('POST'), undefined, {}, { dir, schema: 'thing' });

        assert.equal(resolved.name, 'from-post');
      },
    },

    {
      name: 'index-is-the-fallback-when-the-method-file-is-missing',
      async run({ assert }) {
        const dir = schemaDir({ 'thing/index.js': NAME_SCHEMA.replace('%LABEL%', 'from-index') });

        const resolved = new Settings(Manager).resolve(makeCtx('DELETE'), undefined, {}, { dir, schema: 'thing' });

        assert.equal(resolved.name, 'from-index');
      },
    },

    {
      name: 'a-js-suffix-on-the-schema-name-is-tolerated',
      async run({ assert }) {
        const dir = schemaDir({ 'thing/index.js': NAME_SCHEMA.replace('%LABEL%', 'from-index') });

        const resolved = new Settings(Manager).resolve(makeCtx('GET'), undefined, {}, { dir, schema: 'thing.js' });

        assert.equal(resolved.name, 'from-index');
      },
    },

    {
      name: 'neither-file-present-is-an-honest-500-naming-both-paths',
      async run({ assert }) {
        const dir = schemaDir({ 'other/index.js': NAME_SCHEMA.replace('%LABEL%', 'x') });

        let thrown;
        try {
          new Settings(Manager).resolve(makeCtx('PATCH'), undefined, {}, { dir, schema: 'thing' });
        } catch (e) {
          thrown = e;
        }

        assert.equal(thrown.code, 500);
        assert.equal(thrown.message.includes('No schema for PATCH request'), true);
        assert.equal(thrown.message.includes('thing/patch.js'), true);
        assert.equal(thrown.message.includes('thing/index.js'), true);
      },
    },

    // ─── The masking guard ───

    {
      name: 'a-throwing-method-schema-surfaces-its-own-error',
      async run({ assert }) {
        const dir = schemaDir({
          'thing/post.js': 'throw new Error("the schema itself is broken");',
          'thing/index.js': NAME_SCHEMA.replace('%LABEL%', 'from-index'),
        });

        let thrown;
        try {
          new Settings(Manager).resolve(makeCtx('POST'), undefined, {}, { dir, schema: 'thing' });
        } catch (e) {
          thrown = e;
        }

        assert.equal(thrown.message, 'the schema itself is broken', 'never masked by the index fallback');
      },
    },

    {
      // The masking guard's hard case: a schema file that EXISTS but whose
      // own require fails throws MODULE_NOT_FOUND too, and its "Require
      // stack:" names the schema file — so the guard must read the error's
      // STRUCTURE (the schema file appears in err.requireStack, meaning it
      // loaded and something inside it broke), never the message text.
      name: 'a-broken-inner-require-propagates-instead-of-falling-back',
      async run({ assert }) {
        const dir = schemaDir({
          'thing/post.js': 'require("a-package-that-does-not-exist");',
          'thing/index.js': NAME_SCHEMA.replace('%LABEL%', 'from-index'),
        });

        let thrown;
        try {
          new Settings(Manager).resolve(makeCtx('POST'), undefined, {}, { dir, schema: 'thing' });
        } catch (e) {
          thrown = e;
        }

        assert.equal(thrown.code, 'MODULE_NOT_FOUND');
        assert.equal(thrown.message.includes('a-package-that-does-not-exist'), true, 'the real failure, not the fallback');
      },
    },

    {
      // The same structural check must still allow the honest fallback when
      // the method file is genuinely absent and INDEX is the broken one.
      name: 'a-broken-index-schema-propagates-when-the-method-file-is-absent',
      async run({ assert }) {
        const dir = schemaDir({ 'thing/index.js': 'require("another-package-that-does-not-exist");' });

        let thrown;
        try {
          new Settings(Manager).resolve(makeCtx('POST'), undefined, {}, { dir, schema: 'thing' });
        } catch (e) {
          thrown = e;
        }

        assert.equal(thrown.code, 'MODULE_NOT_FOUND');
        assert.equal(thrown.message.includes('another-package-that-does-not-exist'), true);
      },
    },

    // ─── The schema argument itself ───

    {
      name: 'a-non-object-schema-is-a-400',
      async run({ assert }) {
        let thrown;
        try {
          new Settings(Manager).resolve(makeCtx('POST'), 'not-a-schema', {}, {});
        } catch (e) {
          thrown = e;
        }

        assert.equal(thrown.code, 400);
        assert.equal(thrown.message, 'Invalid schema provided');
      },
    },

    {
      name: 'the-resolved-per-field-map-is-exposed-for-the-sanitize-pass',
      async run({ assert }) {
        const settings = new Settings(Manager);

        settings.resolve(makeCtx('POST'), {
          html: { types: ['string'], sanitize: false, default: '' },
          title: { types: ['string'], default: '' },
        }, {}, {});

        assert.equal(settings.schema.html.sanitize, false);
        assert.equal(settings.schema.title.sanitize, true, 'sanitize defaults to true');
        assert.equal(settings.schema.title.available, true);
        assert.equal(settings.schema.title.required, false);
      },
    },

    {
      name: 'checkRequired-false-lets-a-missing-required-key-through',
      async run({ assert }) {
        const schema = { email: { types: ['string'], required: true } };

        let thrown;
        try {
          new Settings(Manager).resolve(makeCtx('POST'), schema, {}, {});
        } catch (e) {
          thrown = e;
        }
        assert.equal(thrown.code, 400);
        assert.equal(thrown.message, 'Required key {email} is missing in settings');

        const resolved = new Settings(Manager).resolve(makeCtx('POST'), schema, {}, { checkRequired: false });
        assert.equal(resolved.email, '');
      },
    },

    // ─── constant() ───

    {
      name: 'constant-timestamp-and-timestampUNIX-are-schema-nodes-for-one-instant',
      async run({ assert }) {
        const settings = new Settings(Manager);
        const date = '2024-01-15T12:00:00.000Z';

        const iso = settings.constant('timestamp', { date });
        const unix = settings.constant('timestampUNIX', { date });

        assert.deepEqual(iso, { types: ['string'], value: undefined, default: date });
        assert.deepEqual(unix, { types: ['number'], value: undefined, default: 1705320000 });
      },
    },

    {
      name: 'constant-timestampFULL-composes-both-under-one-date',
      async run({ assert }) {
        const full = new Settings(Manager).constant('timestampFULL', { date: '2024-01-15T12:00:00.000Z' });

        assert.equal(full.timestamp.default, '2024-01-15T12:00:00.000Z');
        assert.equal(full.timestampUNIX.default, 1705320000);
      },
    },

    {
      name: 'constant-defaults-to-now-and-an-unknown-name-yields-nothing',
      async run({ assert }) {
        const settings = new Settings(Manager);
        const before = Math.floor(Date.now() / 1000);

        const unix = settings.constant('timestampUNIX');

        assert.equal(unix.default >= before, true);
        assert.equal(settings.constant('nope'), undefined);
      },
    },

    {
      name: 'a-constant-resolves-through-the-engine-as-an-unsendable-default',
      async run({ assert }) {
        const settings = new Settings(Manager);
        const date = '2024-01-15T12:00:00.000Z';

        const resolved = settings.resolve(makeCtx('POST'), {
          created: settings.constant('timestampFULL', { date }),
        }, { created: { timestamp: 'client-supplied' } }, {});

        // The client SENT a timestamp; the constant is a plain default, so
        // the sent value wins — constants are not forced values.
        assert.equal(resolved.created.timestamp, 'client-supplied');
        assert.equal(resolved.created.timestampUNIX, 1705320000);
      },
    },
  ],
};
