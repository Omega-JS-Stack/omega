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
const Settings = require('../../../dist/manager/helpers/settings.js');
const createSchema = require('../../../dist/manager/schemas/admin/post/post.js');
const editSchema = require('../../../dist/manager/schemas/admin/post/put.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

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

module.exports = defineCases({
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

    // The dispatch used to hand devkit's PATH-taking helper a bare target name
    // and a fake brand root ('.'), and relied on `path.basename` of a bare
    // string to come back out. The backend holds a NAME, so it asks the
    // name-taking form of the same rule.
    {
      name: 'dispatch: the composed workflow is <target>-build.yml, named by devkit',
      async run({ assert }) {
        const dispatchDeploy = require('../../../dist/manager/routes/admin/post/dispatch-deploy.js');

        const requests = [];
        const savedFetch = globalThis.fetch;
        const savedToken = process.env.GH_TOKEN;
        globalThis.fetch = async (url) => {
          requests.push(url);
          return { status: 204, text: async () => '' };
        };
        process.env.GH_TOKEN = 'fixture-dispatch-token';

        const said = [];
        const ctx = { log: (line) => said.push(line), warn: (line) => said.push(line) };
        // The dispatch asks for the DEPLOY branch now (#919), never the repo's
        // default one, through the publish lib's one branch-exists read: the
        // ref and its refusal are pinned in
        // routes/admin/deploy-branch-publish.test.js.
        const octokit = { rest: { git: { getRef: async ({ ref }) => ({ data: { ref: `refs/${ref}`, object: { sha: 'head-deploy' } } }) } } };

        try {
          const settings = await dispatchDeploy(ctx, octokit, {
            deploy: true,
            target: 'admin',
            githubUser: 'acme',
            githubRepo: 'acme-omega',
          });

          assert.equal(settings.deployDispatched, true, `the dispatch should have been sent: ${said.join(' | ')}`);
          assert.equal(requests.length, 1, 'exactly one dispatch');
          assert.ok(
            requests[0].endsWith('/repos/acme/acme-omega/actions/workflows/admin-build.yml/dispatches'),
            `the second web target dispatches its OWN workflow, got ${requests[0]}`,
          );
        } finally {
          globalThis.fetch = savedFetch;
          if (savedToken === undefined) delete process.env.GH_TOKEN;
          else process.env.GH_TOKEN = savedToken;
        }
      },
    },
  ],
});
