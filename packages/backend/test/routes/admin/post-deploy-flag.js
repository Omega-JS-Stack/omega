/**
 * Test: admin/post schemas carry the D13 deploy flag
 *
 * Regression: the schemas didn't declare `deploy`, and unknown keys are
 * stripped at validation (middleware's includeNonSchemaSettings defaults
 * false) — so `deploy: false` could NEVER reach dispatch-deploy and the
 * documented opt-out was dead on arrival. These resolve the REAL schema
 * modules through Settings.resolve (same direct-schema seam as
 * test/helpers/schema-zod.js) and pin the contract: absent → true,
 * explicit false → false.
 *
 * Run: npx omega test backend:routes/admin/post-deploy-flag
 */
const Settings = require('../../../src/manager/helpers/settings.js');
const createSchema = require('../../../src/manager/schemas/admin/post/post.js');
const editSchema = require('../../../src/manager/schemas/admin/post/put.js');

// Settings.resolve only touches these surfaces when the schema is passed
// directly (no file loading) — the seam test/helpers/schema-zod.js documents
const makeAssistant = () => ({
  log() {},
  warn() {},
  report: (msg, opts) => Object.assign(new Error(msg), { code: (opts || {}).code }),
  request: { method: 'POST', user: { auth: { uid: 'u1', email: 'u1@test.com' } } },
});
const Manager = { cwd: '/tmp' };

const resolve = (schema, input) => new Settings(Manager).resolve(makeAssistant(), schema, input, {});

const CREATE_INPUT = {
  title: 'Post',
  url: 'post',
  description: 'A post',
  headerImageURL: 'https://example.com/image.jpg',
  body: 'Body',
};

const EDIT_INPUT = {
  url: 'https://example.com/blog/post',
  body: 'Body',
};

module.exports = {
  description: 'admin/post schemas: D13 deploy flag survives validation',
  type: 'group',

  tests: [
    {
      name: 'create: deploy defaults true when absent',
      async run({ assert }) {
        const settings = resolve(createSchema(), { ...CREATE_INPUT });
        assert.equal(settings.deploy, true, `deploy should default true, got ${settings.deploy}`);
      },
    },

    {
      name: 'create: deploy false survives to the route',
      async run({ assert }) {
        const settings = resolve(createSchema(), { ...CREATE_INPUT, deploy: false });
        assert.equal(settings.deploy, false, `deploy: false should survive validation, got ${settings.deploy}`);
      },
    },

    {
      name: 'edit: deploy defaults true when absent',
      async run({ assert }) {
        const settings = resolve(editSchema(), { ...EDIT_INPUT });
        assert.equal(settings.deploy, true, `deploy should default true, got ${settings.deploy}`);
      },
    },

    {
      name: 'edit: deploy false survives to the route',
      async run({ assert }) {
        const settings = resolve(editSchema(), { ...EDIT_INPUT, deploy: false });
        assert.equal(settings.deploy, false, `deploy: false should survive validation, got ${settings.deploy}`);
      },
    },
  ],
};
