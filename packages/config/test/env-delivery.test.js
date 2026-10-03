/**
 * Unit tests for @omega.js/config's delivery renderer — the ONE place that
 * says HOW a declared env key reaches its consumer (#627).
 *
 * Three deliveries: 'env' (the composed .env the backend artifact ships with),
 * 'ci' (the generated workflow injects it into the runner env for the build
 * step) and 'bake' (the build writes it into the shipped artifact — and the
 * workflow injects it too, so bake IMPLIES ci). Every list here derives from
 * the schema alone: no framework keeps a hand-written secrets list.
 *
 * The fixture schema pins the renderer's RULES; the real-schema block pins the
 * inventory those rules produce per target.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const {
  workflowSecretKeys, renderSecretsBlock, bakeKeys, publishSecretKeys,
  envFileKeys, renderEnvFileKeys, artifactEnvValues,
  WORKFLOW_OWNED_KEYS, DELIVERY_MODES, deliveredKeys,
} = require('../src/index.js');

// A miniature schema: one entry per rule the renderer applies.
const FIXTURE = [
  { name: 'BACKEND_ONLY',    owner: 't', targets: ['backend'],          group: 'backend-services', secret: true,  required: false, delivery: { backend: 'env' },              description: 'Read from the composed dist/.env.' },
  { name: 'BACKEND_RUNNER',  owner: 't', targets: ['backend'],          group: 'license',          secret: true,  required: false, delivery: { backend: 'ci' },               description: 'The deploy process reads it on the runner; the artifact never does.' },
  { name: 'GH_TOKEN',        owner: 't', targets: ['web'],              group: 'github',           secret: true,  required: false, delivery: { web: 'ci' },                   description: 'The workflow template declares this one itself.' },
  { name: 'WEB_CI',          owner: 't', targets: ['web'],              group: 'captcha',          secret: false, required: false, delivery: { web: 'ci' },                   description: 'Injected into the web build step.' },
  { name: 'MACHINE_PATH',    owner: 't', targets: ['web'],              group: 'fontawesome',      secret: false, required: false, delivery: { web: 'ci' }, machineLocal: true, description: 'A developer-machine path — never published.' },
  { name: 'STREAM_SECRET_WEB', owner: 't', targets: ['web'],            group: 'machine',          secret: true,  required: false, delivery: { web: 'ci' }, deliverAs: 'STREAM_SECRET', description: 'Delivered under its runtime name.' },
  { name: 'BAKED',           owner: 't', targets: ['extension'],        group: 'machine',          secret: true,  required: false, delivery: { extension: 'bake' }, publicAtRest: true, description: 'Written into the shipped artifact.' },
  { match: /^DYNAMIC_.+$/,   owner: 't', targets: ['backend'],          group: 'backend-services', secret: true,  required: false, delivery: { backend: 'env' },              description: 'A pattern family — no fixed name to render.' },
];

// The same bake, undeclared: a real credential one edit away from the artifact.
const UNSAFE_BAKE = [
  { name: 'API_SECRET', owner: 't', targets: ['extension'], group: 'machine', secret: true, required: false, delivery: { extension: 'bake' }, description: 'A credential nobody declared public-at-rest.' },
];

// ─── The composed half: match families and custom keys (#835, #876) ───

// What a brand's production cascade actually holds: the OAuth family the schema
// knows only as a PATTERN, a key of the consumer's own the schema does not know
// at all, a machine-local path, and a key whose only delivery is local.
const COMPOSED = {
  CONNECTIONS_GITHUB_CLIENT_ID: 'x',
  CONNECTIONS_GITHUB_CLIENT_SECRET: 'x',
  ACME_WEBHOOK_KEY: 'x',
  OMEGA_FONTAWESOME_ROOT: 'x',
  OPENAI_API_KEY: 'x',
};

module.exports = defineCases({
  type: 'group',
  description: 'env-delivery',
  tests: [
    {
      name: 'DELIVERY_MODES: the three ways a key travels',
      run: (ctx) => {
        ctx.expect(DELIVERY_MODES).toEqual(['env', 'ci', 'bake']);
      },
    },

    {
      name: 'workflowSecretKeys(): ci and bake, sorted, machine-local dropped',
      run: (ctx) => {
        // BACKEND_ONLY is 'env' (it never reaches a runner); MACHINE_PATH is a
        // developer-machine value (#454); STREAM_SECRET_WEB rides its deliverAs name
        ctx.expect(workflowSecretKeys('web', { schema: FIXTURE })).toEqual([
          'GH_TOKEN',
          'STREAM_SECRET',
          'WEB_CI',
        ]);

        // bake IMPLIES ci — the workflow injects what the build bakes
        ctx.expect(workflowSecretKeys('extension', { schema: FIXTURE })).toEqual(['BAKED']);

        // A target no entry names gets nothing
        ctx.expect(workflowSecretKeys('desktop', { schema: FIXTURE })).toEqual([]);
      },
    },

    {
      name: 'renderSecretsBlock(): sorted `KEY: ${{ secrets.KEY }}` lines at the token indent',
      run: (ctx) => {
        const block = renderSecretsBlock('web', { schema: FIXTURE });

        ctx.expect(block).toBe([
          'STREAM_SECRET: ${{ secrets.STREAM_SECRET }}',
          'WEB_CI: ${{ secrets.WEB_CI }}',
        ].join('\n  '));

        // The template's own env: block already declares these — a repeated YAML
        // mapping key is invalid, so the generated block never restates them
        ctx.expect(!block.includes('GH_TOKEN'), 'a workflow-owned key never renders').toBeTruthy();
        ctx.expect(WORKFLOW_OWNED_KEYS).toEqual(['GH_TOKEN', 'CLOUDFLARE_TOKEN', 'NODE_VERSION', 'NODE_ENV']);
      },
    },

    {
      name: 'renderSecretsBlock(): the indent is the caller\'s, and an empty block is still valid YAML',
      run: (ctx) => {
        const indented = renderSecretsBlock('web', { schema: FIXTURE, indent: '      ' });
        ctx.expect(indented).toBe([
          'STREAM_SECRET: ${{ secrets.STREAM_SECRET }}',
          'WEB_CI: ${{ secrets.WEB_CI }}',
        ].join('\n      '));

        const empty = renderSecretsBlock('desktop', { schema: FIXTURE });
        ctx.expect(empty, 'nothing to inject renders one self-explaining comment line').toMatch(/^# /);
        ctx.expect(empty.includes('\u2014'), 'the line lands in a committed workflow, so it carries no em dash').toBe(false);
      },
    },

    {
      name: 'bakeKeys(): only what the build writes into the artifact',
      run: (ctx) => {
        ctx.expect(bakeKeys('extension', { schema: FIXTURE })).toEqual(['BAKED']);
        ctx.expect(bakeKeys('web', { schema: FIXTURE }), 'a ci key is not a bake').toEqual([]);
      },
    },

    {
      name: 'a secret bake without publicAtRest THROWS — a credential never reaches an artifact',
      run: (ctx) => {
        const message = /API_SECRET.*publicAtRest/s;

        ctx.expect(() => bakeKeys('extension', { schema: UNSAFE_BAKE })).toThrow(message);
        // bake implies ci, so the workflow lanes walk the same entry and refuse too
        ctx.expect(() => workflowSecretKeys('extension', { schema: UNSAFE_BAKE })).toThrow(message);
        ctx.expect(() => renderSecretsBlock('extension', { schema: UNSAFE_BAKE })).toThrow(message);
        ctx.expect(() => publishSecretKeys('extension', { schema: UNSAFE_BAKE })).toThrow(message);

        // Another target's lists never walk it — the refusal is per target
        ctx.expect(workflowSecretKeys('web', { schema: UNSAFE_BAKE })).toEqual([]);
      },
    },

    {
      name: 'publishSecretKeys(): what push-secrets sends — the workflow set, workflow-owned keys included',
      run: (ctx) => {
        const published = publishSecretKeys('web', { schema: FIXTURE });

        ctx.expect(published).toEqual(workflowSecretKeys('web', { schema: FIXTURE }));
        ctx.expect(published.includes('GH_TOKEN'), 'the repo secret must EXIST even though the block never restates it').toBeTruthy();
        ctx.expect(!published.includes('MACHINE_PATH'), 'a machine-local value never leaves the machine (#454)').toBeTruthy();
      },
    },

    // ─── The real inventory (#627) ───

    {
      name: 'web: the build-step keys, and nothing the backend alone reads',
      run: (ctx) => {
        ctx.expect(workflowSecretKeys('web')).toEqual([
          'CLOUDFLARE_TOKEN',
          'GH_TOKEN',
          'GOOGLE_ANALYTICS_SECRET',
          'OMEGA_LICENSE_KEY',
        ]);

        const block = renderSecretsBlock('web');
        // The reCAPTCHA SITE key is config now (#893): a public key the page renders
        // is not a secret, so no CI line delivers it and the build reads it from
        // captcha.providers.recaptcha.siteKey
        ctx.expect(!block.includes('RECAPTCHA_SITE_KEY'), 'a public site key rides the config, never the secrets block').toBeTruthy();
        ctx.expect(block.includes('OMEGA_LICENSE_KEY: ${{ secrets.OMEGA_LICENSE_KEY }}')).toBeTruthy();
        // #819: the AI key is `env` on every target it names now, which is the
        // laptop's composed .env. Translation runs locally and CI reads the
        // committed cache (#905), so no runner is ever handed the key.
        ctx.expect(!block.includes('OPENAI_API_KEY'), 'an `env` delivery renders no workflow line').toBeTruthy();
        // The brand's GOOGLE_ANALYTICS_SECRET_WEB reaches CI under its delivered name
        ctx.expect(block.includes('GOOGLE_ANALYTICS_SECRET: ${{ secrets.GOOGLE_ANALYTICS_SECRET }}')).toBeTruthy();
        ctx.expect(!block.includes('GOOGLE_ANALYTICS_SECRET_WEB'), 'the brand-level name never reaches a runner').toBeTruthy();
        ctx.expect(!block.includes('GH_TOKEN'), 'the template declares it itself').toBeTruthy();
        for (const backendOnly of ['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'SENDGRID_API_KEY']) {
          ctx.expect(!block.includes(backendOnly), `${backendOnly} is a backend runtime key — a static site build never sees it`).toBeTruthy();
        }
        ctx.expect(!block.includes('OMEGA_FONTAWESOME_ROOT'), 'the machine-local Pro path never publishes (#454)').toBeTruthy();

        ctx.expect(bakeKeys('web'), 'the web build bakes nothing — the client blob reads the runner env').toEqual([]);
      },
    },

    {
      name: 'a workflow-owned key is PUBLISHED and never re-rendered — the #715 duplicate mapping (#728)',
      run: (ctx) => {
        // CLOUDFLARE_TOKEN is both halves at once: the publish lane pushes the repo
        // secret so the purge step's `if: env.CLOUDFLARE_TOKEN != ''` can be true,
        // and the template's own env: block already declares it. A generated line
        // for it would repeat a YAML mapping key and GitHub would refuse the file.
        ctx.expect(publishSecretKeys('web').includes('CLOUDFLARE_TOKEN'), 'the purge gate needs the repo secret to exist').toBeTruthy();

        const block = renderSecretsBlock('web');
        for (const key of WORKFLOW_OWNED_KEYS) {
          ctx.expect(!block.includes(`${key}:`), `${key} is the template's own — a second mapping key invalidates the workflow`).toBeTruthy();
        }
      },
    },

    // #872: the backend deploy runs on a RUNNER now, and a runner has no `.env`.
    // So the workflow carries every key delivered to backend and WRITES the target
    // .env from them, which makes the `env` deliveries part of its set.
    {
      name: 'backend: the runner carries the env deliveries too, because the workflow writes the .env (#872)',
      run: (ctx) => {
        const keys = workflowSecretKeys('backend', { schema: FIXTURE });

        ctx.expect(keys, 'an `env` key rides the runner so the workflow can write it, beside the runner-only `ci` keys').toEqual(['BACKEND_ONLY', 'BACKEND_RUNNER']);
        ctx.expect(bakeKeys('backend', { schema: FIXTURE }), 'nothing bakes into a functions upload').toEqual([]);

        // The other three targets are untouched: their artifacts carry no .env, so
        // an `env` delivery there would be a key nothing reads.
        ctx.expect(workflowSecretKeys('web', { schema: FIXTURE })).toEqual(['GH_TOKEN', 'STREAM_SECRET', 'WEB_CI']);
        ctx.expect(workflowSecretKeys('extension', { schema: FIXTURE })).toEqual(['BAKED']);
      },
    },

    {
      name: 'renderEnvFileKeys(): the KEY LIST the backend workflow writes its .env from, as JSON (#872)',
      run: (ctx) => {
        // The workflow's writer is a node one-liner that reads these names out of the
        // runner env and writes the file through serializeEnv, the same serializer
        // every other .env writeback rides: the shell never sees a value, so a value
        // carrying a quote, a backslash or a newline cannot corrupt the file.
        ctx.expect(renderEnvFileKeys('backend', { schema: FIXTURE })).toBe('["BACKEND_ONLY"]');
        ctx.expect(JSON.parse(renderEnvFileKeys('backend', { schema: FIXTURE }))).toEqual(envFileKeys('backend', { schema: FIXTURE }));

        // The key set is the SCHEMA's `env` deliveries. A `ci` key rides the runner
        // env (the deploy credential, the license key the deploy checks with) and is
        // never a line in the .env the artifact ships with.
        ctx.expect(envFileKeys('backend', { schema: FIXTURE })).toEqual(['BACKEND_ONLY']);
        ctx.expect(envFileKeys('web', { schema: FIXTURE }), 'no other target ships a .env').toEqual([]);

        // A target that delivers nothing still renders valid JSON, so the one-liner
        // parses and writes an empty file rather than dying on a bare token.
        ctx.expect(renderEnvFileKeys('desktop', { schema: FIXTURE })).toBe('[]');
      },
    },

    {
      name: 'artifactEnvValues(): the composed values minus every runner-only key (#872)',
      run: (ctx) => {
        // The composer (env.js) resolves a value for everything the schema delivers
        // to a target, because the secrets publisher needs `ci` values to publish.
        // The ARTIFACT's own .env is the narrower set: what the deployed code reads.
        const composed = { BACKEND_ONLY: 'kept', BACKEND_RUNNER: 'runner-only', DYNAMIC_THING: 'pattern-family' };

        ctx.expect(artifactEnvValues('backend', composed, { schema: FIXTURE })).toEqual({
          BACKEND_ONLY: 'kept',
          DYNAMIC_THING: 'pattern-family',
        });

        ctx.expect(composed.BACKEND_RUNNER, 'it filters, it never mutates the composed map').toEqual('runner-only');
        ctx.expect(artifactEnvValues('web', composed, { schema: FIXTURE }), 'a target with no `ci` claim on these keys keeps them all').toEqual(composed);
      },
    },

    {
      name: 'backend: the real inventory the workflow injects and writes (#872)',
      run: (ctx) => {
        const keys = workflowSecretKeys('backend');

        ctx.expect(keys.includes('OMEGA_ADMIN_KEY'), 'the runtime keys ride the runner so the .env can be written').toBeTruthy();
        ctx.expect(keys.includes('STRIPE_SECRET_KEY')).toBeTruthy();
        ctx.expect(keys.includes('OMEGA_SERVICE_ACCOUNT_JSON'), 'the deploy credential the runner authenticates with').toBeTruthy();
        ctx.expect(bakeKeys('backend')).toEqual([]);

        // The .env the workflow writes carries the RUNTIME half only
        const envKeys = envFileKeys('backend');
        ctx.expect(envKeys.includes('OMEGA_ADMIN_KEY')).toBeTruthy();
        ctx.expect(!envKeys.includes('OMEGA_SERVICE_ACCOUNT_JSON'), 'the service account is a FILE, not a runtime env line').toBeTruthy();
        ctx.expect(JSON.parse(renderEnvFileKeys('backend')).includes('OMEGA_ADMIN_KEY')).toBeTruthy();
      },
    },

    {
      name: 'desktop: the signing + publishing set the build workflow injects today',
      run: (ctx) => {
        const keys = workflowSecretKeys('desktop');

        // The static `${{ secrets.* }}` list in packages/desktop's build.yml, plus
        // the GA secret its webpack bake needs (the workflow never injected it)
        ctx.expect(keys).toEqual([
          'APPLE_API_ISSUER',
          'APPLE_API_KEY',
          'APPLE_API_KEY_ID',
          'APPLE_TEAM_ID',
          'AZURE_CLIENT_ID',
          'AZURE_CLIENT_SECRET',
          'AZURE_TENANT_ID',
          'AZURE_TRUSTED_SIGNING_ENDPOINT',
          'CSC_KEY_PASSWORD',
          'CSC_LINK',
          'DIGICERT_API_KEY',
          'DIGICERT_KEYPAIR_ALIAS',
          'GH_TOKEN',
          'GOOGLE_ANALYTICS_SECRET',
          'OMEGA_LICENSE_KEY',
          'SIGNTOOL_PATH',
          'SNAPCRAFT_STORE_CREDENTIALS',
          'SSLCOM_CREDENTIAL_ID',
          'SSLCOM_PASSWORD',
          'SSLCOM_USERNAME',
          'WIN_CSC_KEY_PASSWORD',
          'WIN_EV_TOKEN_PATH',
        ]);

        ctx.expect(bakeKeys('desktop'), 'a packaged app ships no .env').toEqual(['GOOGLE_ANALYTICS_SECRET']);
      },
    },

    {
      name: 'extension: the three stores plus the baked Measurement Protocol secret',
      run: (ctx) => {
        // The store CREDENTIALS ride the runner env; the three listing IDS do not
        // (#893). An item id is public by design (it is in the listing URL), so it
        // lives in config at targets.<name>.listings.<browser>.id and reaches a
        // dispatched run the way every other config value does: on the snapshot.
        ctx.expect(workflowSecretKeys('extension')).toEqual([
          'CHROME_CLIENT_ID',
          'CHROME_CLIENT_SECRET',
          'CHROME_REFRESH_TOKEN',
          'EDGE_API_KEY',
          'EDGE_CLIENT_ID',
          'FIREFOX_API_KEY',
          'FIREFOX_API_SECRET',
          'GH_TOKEN',
          'GOOGLE_ANALYTICS_SECRET',
          'OMEGA_LICENSE_KEY',
        ]);

        const block = renderSecretsBlock('extension');
        for (const id of ['CHROME_EXTENSION_ID', 'FIREFOX_EXTENSION_ID', 'EDGE_PRODUCT_ID']) {
          ctx.expect(!block.includes(id), `${id} is a config value now, never a repo secret`).toBeTruthy();
        }

        // The extension is a declared GH_TOKEN consumer (#883): its publish uploads
        // the built zips to `<brand.id>-releases`, a repo the run does not own, so
        // the extension's OWN push-secrets step has to deliver the brand token
        // instead of the lane depending on a sibling target having pushed it first.
        ctx.expect(publishSecretKeys('extension').includes('GH_TOKEN'), 'the extension pushes the brand token as its own repo secret').toBeTruthy();

        ctx.expect(bakeKeys('extension'), 'build.json carries it into the packaged zip').toEqual(['GOOGLE_ANALYTICS_SECRET']);
      },
    },

    {
      name: 'the license key rides the runner env and NEVER an artifact (#320)',
      run: (ctx) => {
        // The check runs where the build runs, so the three CI-built targets get it
        // injected — but a baked license key is a license key anyone who unpacks the
        // app can copy, so it appears in no bake list anywhere.
        for (const target of ['web', 'backend', 'desktop', 'extension']) {
          ctx.expect(!bakeKeys(target).includes('OMEGA_LICENSE_KEY'), `${target} must never bake the license key`).toBeTruthy();
        }

        // All FOUR now: the backend's deploy runs on a runner too (#872), and the
        // check runs inside `omega deploy --direct` there, so a keyless verdict would
        // be stamped into every CI-deployed backend without this delivery.
        for (const target of ['web', 'backend', 'desktop', 'extension']) {
          ctx.expect(workflowSecretKeys(target).includes('OMEGA_LICENSE_KEY'), `${target} deploys on a runner, so the check needs it there`).toBeTruthy();
          ctx.expect(publishSecretKeys(target).includes('OMEGA_LICENSE_KEY'), `${target}'s repo secret must exist for the workflow to read`).toBeTruthy();
        }

        // `ci`, never `env`: the runner env carries it for the verdict, and neither
        // .env-writing lane of the backend ever sees it, so the key can never land in
        // the .env the functions artifact ships with.
        ctx.expect(!envFileKeys('backend').includes('OMEGA_LICENSE_KEY'), 'the workflow writes no line for it').toBeTruthy();
        ctx.expect(artifactEnvValues('backend', { OMEGA_LICENSE_KEY: 'omg_live_key', OMEGA_ADMIN_KEY: 'admin' }), 'and the stage strips it out of the composed values').toEqual({ OMEGA_ADMIN_KEY: 'admin' });
      },
    },

    {
      name: 'backend: the composed set adds the CONNECTIONS family and the consumer\'s own key (#835, #876)',
      run: (ctx) => {
        const keys = workflowSecretKeys('backend', { values: COMPOSED });

        ctx.expect(keys.includes('CONNECTIONS_GITHUB_CLIENT_ID'), 'a match-family member travels under its own name').toBeTruthy();
        ctx.expect(keys.includes('CONNECTIONS_GITHUB_CLIENT_SECRET')).toBeTruthy();
        ctx.expect(keys.includes('ACME_WEBHOOK_KEY'), 'a key the schema does not know is the consumer\'s own and still reaches CI').toBeTruthy();
        ctx.expect(!keys.includes('OMEGA_FONTAWESOME_ROOT'), 'a machine-local value never leaves the machine (#454)').toBeTruthy();

        const block = renderSecretsBlock('backend', { indent: '  ', values: COMPOSED });
        ctx.expect(block.includes('CONNECTIONS_GITHUB_CLIENT_ID: ${{ secrets.CONNECTIONS_GITHUB_CLIENT_ID }}')).toBeTruthy();
        ctx.expect(block.includes('CONNECTIONS_GITHUB_CLIENT_SECRET: ${{ secrets.CONNECTIONS_GITHUB_CLIENT_SECRET }}')).toBeTruthy();
        ctx.expect(block.includes('ACME_WEBHOOK_KEY: ${{ secrets.ACME_WEBHOOK_KEY }}')).toBeTruthy();
        ctx.expect(!block.includes('OMEGA_FONTAWESOME_ROOT')).toBeTruthy();

        // The two halves read ONE set: what the workflow injects is what its .env
        // writer names, so a deployed backend can never miss a key CI was handed.
        const envKeys = envFileKeys('backend', { values: COMPOSED });
        ctx.expect(envKeys.includes('CONNECTIONS_GITHUB_CLIENT_ID')).toBeTruthy();
        ctx.expect(envKeys.includes('CONNECTIONS_GITHUB_CLIENT_SECRET')).toBeTruthy();
        ctx.expect(envKeys.includes('ACME_WEBHOOK_KEY'), 'backend delivers a custom key in its FILE mode').toBeTruthy();
        ctx.expect(!envKeys.includes('OMEGA_FONTAWESOME_ROOT')).toBeTruthy();
        ctx.expect(JSON.parse(renderEnvFileKeys('backend', { values: COMPOSED }))).toEqual(envKeys);
      },
    },

    {
      name: 'web: a custom key rides the runner env; a local-only and another target\'s family do not',
      run: (ctx) => {
        const keys = workflowSecretKeys('web', { values: COMPOSED });

        ctx.expect(keys.includes('ACME_WEBHOOK_KEY'), 'every target carries the consumer\'s own key').toBeTruthy();
        ctx.expect(!keys.includes('OPENAI_API_KEY'), 'an `env` delivery on web is the laptop\'s composed .env, never a runner (#819)').toBeTruthy();
        ctx.expect(!keys.includes('CONNECTIONS_GITHUB_CLIENT_ID'), 'the OAuth family is delivered to backend only').toBeTruthy();
        ctx.expect(!keys.includes('OMEGA_FONTAWESOME_ROOT')).toBeTruthy();

        const block = renderSecretsBlock('web', { values: COMPOSED });
        ctx.expect(block.includes('ACME_WEBHOOK_KEY: ${{ secrets.ACME_WEBHOOK_KEY }}')).toBeTruthy();
        for (const absent of ['OPENAI_API_KEY', 'CONNECTIONS_GITHUB_CLIENT_ID', 'CONNECTIONS_GITHUB_CLIENT_SECRET', 'OMEGA_FONTAWESOME_ROOT']) {
          ctx.expect(!block.includes(absent), `${absent} is not delivered to web`).toBeTruthy();
        }

        // A site build and a packaged app ship no .env, so a custom key there is a
        // runner value and no writer names it. (web's `env` deliveries are the
        // LAPTOP's composed .env, #819: nothing renders them anywhere.)
        ctx.expect(!envFileKeys('web', { values: COMPOSED }).includes('ACME_WEBHOOK_KEY'), 'no file mode on web, so no file line').toBeTruthy();
        ctx.expect(envFileKeys('desktop', { values: COMPOSED })).toEqual([]);
      },
    },

    {
      name: 'the composed half never widens the schema half: no values, no additions',
      run: (ctx) => {
        ctx.expect(workflowSecretKeys('backend', { values: {} })).toEqual(workflowSecretKeys('backend'));
        ctx.expect(renderSecretsBlock('desktop', { indent: '  ', values: {} })).toEqual(renderSecretsBlock('desktop', { indent: '  ' }));
        ctx.expect(publishSecretKeys('web', { values: COMPOSED })).toEqual(workflowSecretKeys('web', { values: COMPOSED }));

        // A workflow declares these itself, so a consumer key of the same name is
        // never a second mapping line and never a repo secret of its own.
        const owned = workflowSecretKeys('web', { values: { NODE_ENV: 'x', GITHUB_TOKEN: 'x', ACME_WEBHOOK_KEY: 'x' } });
        ctx.expect(!owned.includes('NODE_ENV'), 'a workflow-owned name is the template\'s, whoever typed it').toBeTruthy();
        ctx.expect(!owned.includes('GITHUB_TOKEN'), 'GitHub refuses a GITHUB_-prefixed secret: publishing one would fail the precheck').toBeTruthy();
        ctx.expect(owned.includes('ACME_WEBHOOK_KEY')).toBeTruthy();
      },
    },

    {
      name: 'a composed custom key GitHub could never hold as a secret fails by name (C2)',
      run: (ctx) => {
        // dotenv reads `[\w.-]+` as a key, so a `.env` can carry a name GitHub's
        // secret API refuses. Naming it here beats a gh call failing three layers on.
        for (const key of ['ACME.WEBHOOK', 'ACME-KEY']) {
          ctx.expect(() => workflowSecretKeys('web', { values: { [key]: 'x' } }), `${key} was composed into the delivered set`).toThrow((e) => e.message.includes(key) && /\[A-Za-z_\]\[A-Za-z0-9_\]\*/.test(e.message));
        }
      },
    },

    {
      name: 'deliveredKeys(): the ONE primitive both halves read, fixture schema',
      run: (ctx) => {
        const values = { DYNAMIC_THING: 'x', CUSTOM_THING: 'x', MACHINE_PATH: 'x' };

        // backend: `env` is its file mode, so a custom key lands in both halves
        ctx.expect(deliveredKeys('backend', ['env', 'ci', 'bake'], { schema: FIXTURE, values })).toEqual([
          'BACKEND_ONLY', 'BACKEND_RUNNER', 'CUSTOM_THING', 'DYNAMIC_THING',
        ]);
        ctx.expect(deliveredKeys('backend', ['env'], { schema: FIXTURE, values })).toEqual([
          'BACKEND_ONLY', 'CUSTOM_THING', 'DYNAMIC_THING',
        ]);

        // web: no file mode, so the custom key is a runner value only
        ctx.expect(deliveredKeys('web', ['ci', 'bake'], { schema: FIXTURE, values })).toEqual([
          'CUSTOM_THING', 'GH_TOKEN', 'STREAM_SECRET', 'WEB_CI',
        ]);
        ctx.expect(deliveredKeys('web', ['env'], { schema: FIXTURE, values })).toEqual([]);

        // A family member the schema delivers elsewhere stays there
        ctx.expect(deliveredKeys('web', ['ci', 'bake'], { schema: FIXTURE, values: { DYNAMIC_THING: 'x' } })).toEqual([
          'GH_TOKEN', 'STREAM_SECRET', 'WEB_CI',
        ]);
      },
    },
  ],
});
