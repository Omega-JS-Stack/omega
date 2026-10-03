// Tests for src/lib/preflight.js: the gate run before any service. The keys a
// service is missing come from @omega.js/config's one function (names only,
// values NEVER printed); the scopes come from the REQUIRES registry, checked
// against the token store's granted-scopes record. Plus the run/skip/strict
// verdicts, the walkthrough content, and the runManage wiring.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { setPromptStreams } = require('@omega.js/devkit/prompt');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('@omega.js/devkit/test/temp-home');

const { resolveCompany } = require('@omega.js/config');

const { REQUIRES, SERVICE_ORDER } = require('../src/config.js');
const { runPreflight, readTokenStore } = require('../src/lib/preflight.js');
const { runManage } = require('../src/manage.js');
const { googleTokenStorePath } = require('../src/lib/google-auth.js');
const { createMachine } = require('./lib/fake-claude.js');

// The workspace op reaches for `claude`. File-wide that is a fake machine that
// already has the plugin, so no walk below spawns the real one or touches ~/.claude.
const MANAGER_VERSION = require('../package.json').version;
let restoreClaude;

// Preflight checks must be deterministic regardless of the shell's exports
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.NAMECHEAP_USERNAME;
delete process.env.NAMECHEAP_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.SENDGRID_API_KEY;
delete process.env.BEEHIIV_API_KEY;
delete process.env.SENTRY_AUTH_TOKEN;
delete process.env.APPLE_API_ISSUER;
delete process.env.APPLE_API_KEY_ID;
delete process.env.APPLE_TEAM_ID;

const SECRET_VALUE = 'super-secret-preflight-value-never-printed';

// The Google OAuth client is a cloud key, asked only once the project is a real one
const REAL_PROJECT = { cloud: { provider: 'firebase', config: { projectId: 'preflight-live' } } };

function withStreams(isTTY, fn) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = isTTY;
  output.isTTY = isTTY;
  setPromptStreams({ input, output });
  try {
    return fn();
  } finally {
    setPromptStreams(null);
  }
}

/** Capture every console.log line emitted while fn runs. */
function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

/** captureLog for an async run (the manage walk + its printed summary). */
async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

function stageTokenStore(tokens) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-'));
  if (tokens) {
    const storePath = googleTokenStorePath(root);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(tokens));
  }
  return root;
}

// ─── what each service is found missing ─────────────────────────────────────
//
// Real services on real configs: what a service needs and when lives in the
// env schema, and preflight asks the one function for the verb `manage`.

/**
 * One preflight run, its printed lines captured.
 * @param {string[]} services - The services to check.
 * @param {object} brandConfig - The brand config.
 * @param {object} [run] - { isTTY, brandRoot, company, options }.
 * @returns {{ findings: object[], gates: object, log: string }}
 */
function preflight(services, brandConfig, { isTTY = false, brandRoot = stageTokenStore(null), company, options = {} } = {}) {
  let result;
  const log = captureLog(() => {
    result = withStreams(isTTY, () => runPreflight({ services, brandConfig, brandRoot, company, options }));
  });
  return { ...result, log };
}

// A brand of a company, both real on disk: the parent carries the
// shared `company/` tree, whose `.env` is the tier every sub-brand inherits,
// and the machine registry is how the child's `company: { id }` resolves.
function stageCompanyBrand({ envFile = true } = {}) {
  const parentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-company-'));
  fs.mkdirSync(path.join(parentRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(parentRoot, 'config', 'omega.json5'),
    JSON.stringify({ brand: { id: 'parent-brand', name: 'Parent', url: 'https://parent.test' } }),
  );
  fs.mkdirSync(path.join(parentRoot, 'company', 'config'), { recursive: true });
  fs.writeFileSync(path.join(parentRoot, 'company', 'config', 'omega.json5'), JSON.stringify({}));
  if (envFile) fs.writeFileSync(path.join(parentRoot, 'company', '.env'), 'SHARED="value"\n');
  fs.writeFileSync(
    path.join(process.env.OMEGA_HOME, 'brands.json'),
    JSON.stringify({ 'parent-brand': { root: parentRoot, name: 'Parent', url: 'https://parent.test' } }),
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-child-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'config', 'omega.json5'),
    JSON.stringify({ brand: { id: 'child-brand', name: 'Child', url: 'https://child.test' }, company: { id: 'parent-brand' } }),
  );

  return { root, companyEnv: path.join(parentRoot, 'company', '.env') };
}

// ─── runManage wiring ───────────────────────────────────────────────────────

function stageBrand({ projectId } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-brand-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'preflight-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2));
  fs.mkdirSync(path.join(root, 'config'));
  const cloud = projectId ? `\n  cloud: { provider: 'firebase', config: { projectId: '${projectId}' } },` : '';
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: {
    id: 'preflight-brand',
    name: 'Preflight Brand',
    url: 'https://preflight-brand.test',
  },${cloud}
  targets: {
    web: { type: 'web' },
  },
}`);
  // A no-dep web target whose build writes dist/index.html: the update
  // service must pass so the loop provably continues PAST preflight skips
  fs.mkdirSync(path.join(root, 'targets', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'web', 'package.json'), JSON.stringify({
    name: 'preflight-web',
    private: true,
    scripts: { build: 'node build.js' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'targets', 'web', 'build.js'), `const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), '<!doctype html><title>preflight</title>');
`);
  return root;
}

module.exports = defineCases({
  type: 'group',
  description: 'preflight',
  setup: () => {
    restoreClaude = createMachine({
      marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
      installed: { 'omega@omega': MANAGER_VERSION },
      published: MANAGER_VERSION,
    }).activate();
  },
  cleanup: () => restoreClaude(),
  tests: [
    {
      name: 'preflight: edge turned off, no finding',
      run: (ctx) => {
        const { findings, gates } = preflight(['edge'], { edge: { providers: { cloudflare: { enabled: false } } } });
        ctx.expect(findings.length).toBe(0);
        ctx.expect(gates.edge).toBe(undefined);
      },
    },

    // The advertising gate is the client id alone. The `enabled` key it
    // used to read beside it is deleted, so a config still carrying it must not
    // silence the preflight ask for the account the service still manages.
    {
      name: 'preflight: the advertising ask is client presence, not a second switch (#527)',
      run: (ctx) => {
        const withClient = preflight(['advertising'], { ...REAL_PROJECT, advertising: { providers: { adsense: { client: 'ca-pub-1', enabled: false } } } });
        ctx.expect(withClient.gates.advertising, 'a configured client id asks for its credentials').toBeTruthy();
        ctx.expect([...withClient.gates.advertising.missingEnv].sort()).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

        const noClient = preflight(['advertising'], { ...REAL_PROJECT, advertising: { providers: { adsense: {} } } });
        ctx.expect(noClient.gates.advertising, 'no client id, nothing to ask for').toBe(undefined);
      },
    },

    {
      name: 'preflight: missing env, a finding naming the exact vars',
      run: (ctx) => {
        const { gates } = preflight(['edge'], {});
        ctx.expect(gates.edge.missingEnv).toEqual(['CLOUDFLARE_TOKEN']);
        ctx.expect(gates.edge.needsInteractive, 'a missing secret is no consent gap').toBe(undefined);
      },
    },

    {
      name: 'preflight: env present, no finding',
      run: (ctx) => {
        process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
        try {
          const { findings, gates } = preflight(['edge'], {});
          ctx.expect(findings.length).toBe(0);
          ctx.expect(gates).toEqual({});
        } finally {
          delete process.env.CLOUDFLARE_TOKEN;
        }
      },
    },

    {
      name: 'preflight: namecheap creds only for namecheap brands',
      run: (ctx) => {
        const squarespace = preflight(['domain'], { domain: { providers: { squarespace: {} } } });
        ctx.expect(squarespace.gates.domain.missingEnv).toEqual(['CLOUDFLARE_TOKEN']);

        const namecheap = preflight(['domain'], { domain: { providers: { namecheap: {} } } });
        ctx.expect([...namecheap.gates.domain.missingEnv].sort()).toEqual(['CLOUDFLARE_TOKEN', 'NAMECHEAP_API_KEY', 'NAMECHEAP_USERNAME']);

        // No provider chosen: the service skips itself and preflight stays quiet
        ctx.expect(preflight(['domain'], {}).gates.domain).toBe(undefined);
      },
    },

    {
      name: 'preflight: scopes, no token store is a consent gap with no missing env',
      run: (ctx) => {
        process.env.GOOGLE_CLIENT_ID = 'id';
        process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
        try {
          const { gates } = preflight(['search'], REAL_PROJECT);
          ctx.expect(gates.search.needsInteractive).toMatch(/Google consent/);
          ctx.expect(gates.search.missingEnv).toEqual([]);
        } finally {
          delete process.env.GOOGLE_CLIENT_ID;
          delete process.env.GOOGLE_CLIENT_SECRET;
        }
      },
    },

    {
      name: 'preflight: scopes, a store missing a required scope names it, a sufficient one is clean',
      run: (ctx) => {
        process.env.GOOGLE_CLIENT_ID = 'id';
        process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
        try {
          const partial = stageTokenStore({ access_token: 'tok', scopes: ['https://www.googleapis.com/auth/webmasters'], account_email: 'ops@example.test' });
          const narrow = preflight(['search'], REAL_PROJECT, { brandRoot: partial });
          ctx.expect(narrow.gates.search.needsInteractive).toMatch(/siteverification/);

          const full = stageTokenStore({
            access_token: 'tok',
            scopes: ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/siteverification'],
            account_email: 'ops@example.test',
          });
          ctx.expect(preflight(['search'], REAL_PROJECT, { brandRoot: full }).gates).toEqual({});
        } finally {
          delete process.env.GOOGLE_CLIENT_ID;
          delete process.env.GOOGLE_CLIENT_SECRET;
        }
      },
    },

    {
      name: 'preflight: readTokenStore, a real store round-trips and a pre-tracking store grants nothing',
      run: (ctx) => {
        const root = stageTokenStore({ access_token: 'tok', scopes: ['a', 'b'], account_email: 'me@example.test' });
        const store = readTokenStore(root);
        ctx.expect(store.exists).toBe(true);
        ctx.expect(store.scopes).toEqual(['a', 'b']);
        ctx.expect(store.accountEmail).toBe('me@example.test');

        const legacyRoot = stageTokenStore({ access_token: 'tok' }); // no scopes array
        ctx.expect(readTokenStore(legacyRoot).scopes).toEqual([]);

        ctx.expect(readTokenStore(stageTokenStore(null)).exists).toBe(false);
      },
    },

    // ─── runPreflight: verdicts ─────────────────────────────────────────────────

    {
      name: 'preflight verdicts: non-interactive missing env, skip with missingEnv',
      run: (ctx) => {
        const { gates, log } = preflight(['edge'], {});

        ctx.expect(log).toMatch(/Preflight/);
        ctx.expect(gates.edge.action).toBe('skip');
        ctx.expect(gates.edge.reason).toMatch(/CLOUDFLARE_TOKEN/);
        ctx.expect(gates.edge.reason).toMatch(/^preflight: /);
        ctx.expect(gates.edge.missingEnv).toEqual(['CLOUDFLARE_TOKEN']);
      },
    },

    {
      name: 'preflight verdicts: interactive and a pasted key, run (the paste flow fixes it mid-run)',
      run: (ctx) => {
        ctx.expect(preflight(['edge'], {}, { isTTY: true }).gates.edge.action).toBe('run');
      },
    },

    {
      name: 'preflight verdicts: interactive but a key nobody pastes, still skip (no flow collects it)',
      run: (ctx) => {
        // The Google OAuth client is set up by hand in the Cloud console, never pasted mid-run
        ctx.expect(preflight(['search'], REAL_PROJECT, { isTTY: true }).gates.search.action).toBe('skip');
      },
    },

    {
      name: 'preflight verdicts: --strict is an error, even interactive',
      run: (ctx) => {
        ctx.expect(preflight(['edge'], {}, { isTTY: true, options: { strict: true } }).gates.edge.action).toBe('error');
      },
    },

    {
      name: 'preflight verdicts: a consent/scope gap carries the ⚑ pending marker; a missing-secret gap does not (#228)',
      run: (ctx) => {
        process.env.GOOGLE_CLIENT_ID = 'id';
        process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
        try {
          const { gates } = preflight(['search', 'edge'], REAL_PROJECT);

          ctx.expect(gates.search.needsInteractive, 'the summary ⚑ section reads this field; without it the skip is a nameless count').toMatch(/Google consent/);
          ctx.expect(gates.edge.needsInteractive, 'a missing secret already rides the 🔑 section; double-listing is noise').toBe(undefined);

          // A store that exists but lacks the scope is the same pending human step
          const narrowStore = stageTokenStore({ access_token: 'a', refresh_token: 'r', scopes: ['https://www.googleapis.com/auth/firebase'] });
          const narrow = preflight(['search'], REAL_PROJECT, { brandRoot: narrowStore });
          ctx.expect(narrow.gates.search.needsInteractive, 'and it names the scopes to re-consent').toMatch(/webmasters/);
        } finally {
          delete process.env.GOOGLE_CLIENT_ID;
          delete process.env.GOOGLE_CLIENT_SECRET;
        }
      },
    },

    {
      name: 'preflight verdicts: nothing missing, no gates and nothing printed',
      run: (ctx) => {
        process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
        try {
          const { findings, gates, log } = preflight(['edge'], {});
          ctx.expect(findings.length).toBe(0);
          ctx.expect(gates).toEqual({});
          ctx.expect(log).toBe('');
        } finally {
          delete process.env.CLOUDFLARE_TOKEN;
        }
      },
    },

    // ─── Walkthrough content (cp236 tone) ───────────────────────────────────────

    {
      name: 'preflight walkthrough: what/which/why/fix/rerun',
      run: (ctx) => {
        const { log } = preflight(['edge'], {});

        ctx.expect(log).toMatch(/Preflight/);                                            // the consolidated header
        ctx.expect(log).toMatch(/edge/);                                                 // which service
        ctx.expect(log).toMatch(/reconciles the zone, DNS records/);                     // why it matters
        ctx.expect(log).toMatch(/CLOUDFLARE_TOKEN=<value>/);                             // the exact .env line
        ctx.expect(log).toMatch(/https:\/\/dash\.cloudflare\.com\/profile\/api-tokens/); // where the value comes from
        ctx.expect(log).toMatch(/Create a token with Zone edit/);                        // the hint
        ctx.expect(log).toMatch(/npm run manage -- --service=edge/);                     // the rerun verb
      },
    },

    {
      name: 'preflight walkthrough: a present var is not nagged, and env VALUES never appear',
      run: (ctx) => {
        process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
        try {
          const { log } = preflight(['domain'], { domain: { providers: { namecheap: {} } } });

          ctx.expect(log).toMatch(/NAMECHEAP_API_KEY=<value>/);
          ctx.expect(!log.includes('CLOUDFLARE_TOKEN=<value>'), 'present vars are not nagged').toBeTruthy();
          ctx.expect(!log.includes(SECRET_VALUE), 'values NEVER print').toBeTruthy();
        } finally {
          delete process.env.CLOUDFLARE_TOKEN;
        }
      },
    },

    {
      name: 'preflight walkthrough: a company brand is sent to the COMPANY .env (#910)',
      run: (ctx) => {
        const { root, companyEnv } = stageCompanyBrand();
        const company = resolveCompany(root);
        ctx.expect(company.id, 'the fixture resolves a company').toBe('parent-brand');

        const { gates, log } = preflight(['edge'], {}, { brandRoot: root, company });

        // One shape for every service the walkthrough prints: the key belongs in
        // the company file each sub-brand inherits, and the brand file is the
        // override, not the home.
        ctx.expect(log).toMatch(/CLOUDFLARE_TOKEN=<value>/);
        ctx.expect(log.includes(companyEnv), `the fix line names the company .env: ${log}`).toBeTruthy();
        ctx.expect(log).toMatch(/brand \.env overrides it/);
        ctx.expect(gates.edge.reason.includes(companyEnv), `the skip reason says it too: ${gates.edge.reason}`).toBeTruthy();
      },
    },

    {
      name: 'preflight walkthrough: the company .env is named even before it exists (#910)',
      run: (ctx) => {
        // The file a first-time company brand has yet to create is still the file
        // the key belongs in, so the line names the path rather than falling back.
        const { root, companyEnv } = stageCompanyBrand({ envFile: false });

        const { log } = preflight(['edge'], {}, { brandRoot: root, company: resolveCompany(root) });

        ctx.expect(log.includes(companyEnv), `the fix line names the file to create: ${log}`).toBeTruthy();
      },
    },

    {
      name: 'preflight walkthrough: a standalone brand keeps the brand .env line (#910)',
      run: (ctx) => {
        const root = stageTokenStore(null);

        const { log } = preflight(['edge'], {}, { brandRoot: root, company: resolveCompany(root) });

        ctx.expect(log).toMatch(/to the brand \.env/);
        ctx.expect(!log.includes('company'), `no company, no company line: ${log}`).toBeTruthy();
      },
    },

    {
      name: 'preflight walkthrough: scope gap names the acting identity + both remedies (cp236 model)',
      run: (ctx) => {
        process.env.GOOGLE_CLIENT_ID = 'id';
        process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
        try {
          const root = stageTokenStore({ access_token: 'tok', scopes: ['https://www.googleapis.com/auth/webmasters'], account_email: 'ops@example.test' });

          const { log } = preflight(['search'], REAL_PROJECT, { brandRoot: root });

          ctx.expect(log).toMatch(/search/);
          ctx.expect(log).toMatch(/scope:siteverification/);           // what's missing, short form
          ctx.expect(log).toMatch(/ops@example\.test/);                // acting identity (cp236)
          ctx.expect(log).toMatch(/google-tokens\.json/);              // the token store path
          ctx.expect(log).toMatch(/re-consent/);                       // remedy 1
          ctx.expect(log).toMatch(/delete the token store/);           // remedy 2 (cp236 alternative)
          ctx.expect(!log.includes(SECRET_VALUE)).toBeTruthy();
        } finally {
          delete process.env.GOOGLE_CLIENT_ID;
          delete process.env.GOOGLE_CLIENT_SECRET;
        }
      },
    },

    // ─── Registry sanity ────────────────────────────────────────────────────────

    {
      name: 'preflight registry: every REQUIRES key is a real service, and its scopes are Google scopes',
      run: (ctx) => {
        for (const [serviceName, declaration] of Object.entries(REQUIRES)) {
          ctx.expect(SERVICE_ORDER.includes(serviceName), `${serviceName} is not in SERVICE_ORDER`).toBeTruthy();
          for (const scope of declaration.scopes || []) {
            ctx.expect(scope, `${serviceName} scope ${scope}`).toMatch(/^https:\/\/www\.googleapis\.com\/auth\//);
          }
        }
      },
    },

    {
      name: 'runManage: preflight-failing service skips with the walkthrough reason and missingEnv',
      run: async (ctx) => {
        const root = stageBrand();
        const report = await withStreams(false, () => runManage(root, { service: 'edge' }));

        ctx.expect(report.hasErrors).toBe(false);
        ctx.expect(report.results.edge.status).toBe('skipped');
        ctx.expect(report.results.edge.reason).toMatch(/^preflight: /);
        ctx.expect(report.results.edge.reason).toMatch(/CLOUDFLARE_TOKEN/);
        ctx.expect(report.results.edge.missingEnv).toEqual(['CLOUDFLARE_TOKEN']);
      },
    },

    {
      name: 'runManage: --strict turns the preflight failure into a hard error',
      run: async (ctx) => {
        const root = stageBrand();
        const report = await withStreams(false, () => runManage(root, { service: 'edge', strict: true }));

        ctx.expect(report.hasErrors).toBe(true);
        ctx.expect(report.results.edge.status).toBe('error');
        ctx.expect(report.results.edge.error).toMatch(/^preflight: /);
        ctx.expect(report.results.edge.error).toMatch(/CLOUDFLARE_TOKEN/);
      },
    },

    {
      name: 'runManage: a consent-gated preflight skip is NAMED in the ⚑ pending list, with its rerun hint (#228)',
      run: async (ctx) => {
        const root = stageBrand({ projectId: 'preflight-live' });

        const log = await captureLogAsync(() => withStreams(false, () => runManage(root, { service: 'search' })));

        ctx.expect(log, 'a consent gap belongs in the pending aggregate, not only in the walkthrough scroll-back').toMatch(/⚑ Skipped — needs an interactive run/);
        ctx.expect(log, 'the ⚑ line names the service').toMatch(/search\/preflight/);
        ctx.expect(log).toMatch(/npm run manage -- --service=search/);
      },
    },

    {
      name: 'runManage: the cycle continues past preflight skips (absorb, never crash)',
      run: async (ctx) => {
        const root = stageBrand();
        const report = await withStreams(false, () => runManage(root, {}));

        // edge (and friends) skipped by preflight…
        ctx.expect(report.results.edge.status).toBe('skipped');
        ctx.expect(report.results.edge.reason).toMatch(/^preflight: /);
        // …while later services still ran — the loop never stopped
        ctx.expect(report.results.testing, 'testing service should still have run').toBeTruthy();
        ctx.expect(report.results.workspace, 'workspace service should still have run').toBeTruthy();
      },
    },
  ],
});
