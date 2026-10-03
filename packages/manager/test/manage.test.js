/**
 * Brand loading + end-to-end manage tests over staged fixture brand
 * monorepos: target-dir→target mapping, root resolution from any depth, the full
 * workspace → update → testing loop, idempotent rerun, and hard failure on
 * an unloadable brand config (secret-shaped keys).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { recordBrand } = require('@omega.js/config');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('@omega.js/devkit/test/temp-home');

const { resolveBrandRoot, loadBrand, discoverTargets } = require('../src/lib/brand.js');
const { runManage } = require('../src/manage.js');
const { CONSENT_REQUIRED } = require('../src/lib/google-auth.js');
const { SERVICE_ORDER, BOOT_SERVICES } = require('../src/config.js');
const { createMachine } = require('./lib/fake-claude.js');
const { toolProbe } = require('./lib/tool-probe.js');

// The workspace op reaches for `claude`. File-wide that is a fake machine that
// already has the plugin, so no walk below spawns the real one or touches ~/.claude.
const MANAGER_VERSION = require('../package.json').version;
let restoreClaude;

// Fixture brands must never reach a real Cloudflare/Namecheap/Google account
// via shell-exported credentials — those services must skip in every e2e run
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.NAMECHEAP_USERNAME;
delete process.env.NAMECHEAP_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.TIKTOK_ACCESS_TOKEN;
delete process.env.SENDGRID_API_KEY;
delete process.env.OMEGA_WEBHOOK_KEY;
delete process.env.BEEHIIV_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.CHARGEBEE_API_KEY;
delete process.env.SLAPFORM_SERVICE_ACCOUNT;
delete process.env.CHATSY_SERVICE_ACCOUNT;
delete process.env.REPLYIFY_SERVICE_ACCOUNT;
delete process.env.SERVER_SERVICE_ACCOUNT;
delete process.env.APPLE_API_ISSUER;
delete process.env.APPLE_API_KEY_ID;
delete process.env.APPLE_TEAM_ID;
delete process.env.CSC_KEY_PASSWORD;
delete process.env.APPLE_KEYCHAIN_PASSWORD;
delete process.env.ACCOUNT_PASSWORD_SEED;

// ─── Fixture staging ─────────────────────────────────────────────────────────

const BRAND_CONFIG = `{
  brand: {
    id: 'fixture-brand',
    name: 'Fixture Brand',
    url: 'https://fixture-brand.test',
  },
  targets: {
    web: { type: 'web' },
  },
}`;

// A website target with NO deps (install skips — no network in tests) whose
// build writes dist/index.html, mirroring a real web target's output.
const WEBSITE_PKG = JSON.stringify({
  name: 'fixture-website',
  private: true,
  scripts: { build: 'node build.js' },
}, null, 2);

const WEBSITE_BUILD = `const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), '<!doctype html><title>fixture</title>');
`;

function stageBrand({ config = BRAND_CONFIG, targets = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-brand-'));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2));

  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config);

  if (targets) {
    const web = path.join(root, 'targets', 'web');
    fs.mkdirSync(web, { recursive: true });
    fs.writeFileSync(path.join(web, 'package.json'), WEBSITE_PKG);
    fs.writeFileSync(path.join(web, 'build.js'), WEBSITE_BUILD);
  }

  return root;
}

// ─── One vocabulary (#443) ───────────────────────────────────────────────────

/** A pre-#443 brand: its surfaces still under apps/, the glob still apps/*. */
function stageLegacyBrand() {
  const root = stageBrand();

  fs.renameSync(path.join(root, 'targets'), path.join(root, 'apps'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['apps/*'],
  }, null, 2));

  return root;
}

// ─── End-to-end manage ───────────────────────────────────────────────────────

// Testing's live checks read fetch/retryDelayMs from runManage options — a
// canned 200 keeps the full loop network-free (the fixture URL never resolves)
const FAKE_FETCH_200 = { fetch: async () => ({ status: 200, json: async () => ({}) }), retryDelayMs: 0 };

// ─── Lanes (#228) ────────────────────────────────────────────────────────────

/** captureLog for an async run (the walk + its printed walkthrough/summary). */
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

module.exports = defineCases({
  type: 'group',
  description: 'manage',
  setup: () => {
    restoreClaude = createMachine({
      marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
      installed: { 'omega@omega': MANAGER_VERSION },
      published: MANAGER_VERSION,
    }).activate();
  },
  cleanup: () => restoreClaude(),
  tests: [
    // ─── Brand root resolution ───────────────────────────────────────────────────

    {
      name: 'resolveBrandRoot: from the root, from inside a target, from a nested dir',
      run: (ctx) => {
        const root = stageBrand();
        const nested = path.join(root, 'targets', 'web', 'src', 'deep');
        fs.mkdirSync(nested, { recursive: true });

        ctx.expect(resolveBrandRoot(root)).toBe(root);
        ctx.expect(resolveBrandRoot(path.join(root, 'targets', 'web'))).toBe(root);
        ctx.expect(resolveBrandRoot(nested)).toBe(root);
      },
    },

    {
      name: 'resolveBrandRoot: a target\'s own config dir never masquerades as the brand root',
      run: (ctx) => {
        const root = stageBrand();
        // Give the target its own config/omega.json5 — resolution from inside it must
        // still climb to the BRAND root
        const targetConfig = path.join(root, 'targets', 'web', 'config');
        fs.mkdirSync(targetConfig, { recursive: true });
        fs.writeFileSync(path.join(targetConfig, 'omega.json5'), `{ targets: { web: { type: 'web' } } }`);

        ctx.expect(resolveBrandRoot(path.join(root, 'targets', 'web'))).toBe(root);
      },
    },

    {
      name: 'resolveBrandRoot: a brand nested in a parent workspace\'s targets/ dir still resolves (sandbox-brand case)',
      run: (ctx) => {
        // {outer}/targets/my-brand/{config,targets/web}: no config above my-brand,
        // so my-brand is the brand root even though it sits under a targets/ dir
        const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-outer-'));
        const brandRoot = path.join(outer, 'targets', 'my-brand');
        fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
        fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), BRAND_CONFIG);
        const web = path.join(brandRoot, 'targets', 'web');
        fs.mkdirSync(web, { recursive: true });

        ctx.expect(resolveBrandRoot(brandRoot)).toBe(brandRoot);
        ctx.expect(resolveBrandRoot(web)).toBe(brandRoot);
      },
    },

    {
      name: 'resolveBrandRoot: null outside any brand',
      run: (ctx) => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-empty-'));
        ctx.expect(resolveBrandRoot(empty)).toBe(null);
      },
    },

    // ─── Target dir → target mapping ─────────────────────────────────────────────

    {
      name: 'discoverTargets: the brand\'s own declaration types the dir, whatever the dir is named (#886)',
      run: (ctx) => {
        const root = stageBrand({
          config: `{
      brand: { id: 'fixture-brand', name: 'Fixture', url: 'https://fixture-brand.test' },
      targets: { web: { type: 'web' }, docs: { type: 'web' } },
    }`,
        });
        fs.mkdirSync(path.join(root, 'targets', 'docs'), { recursive: true });

        const byName = Object.fromEntries(discoverTargets(root).map((entry) => [entry.name, entry.target]));
        ctx.expect(byName.web).toBe('web');
        ctx.expect(byName.docs, 'a second web-typed target needs no naming convention').toBe('web');
      },
    },

    {
      name: 'loadBrand: a dir the brand never declares maps via its own config, and nothing else is unmapped',
      run: (ctx) => {
        const root = stageBrand();

        // targets/api declares targets.backend in its target-root config/omega.json5
        // (ONE authored location for every target since the src/dist pillar —
        // functions/config is staged output now) and the brand file never names it
        const apiConfig = path.join(root, 'targets', 'api', 'config');
        fs.mkdirSync(apiConfig, { recursive: true });
        fs.writeFileSync(path.join(apiConfig, 'omega.json5'), `{ targets: { backend: { type: 'backend' } } }`);

        const brand = loadBrand(root);
        ctx.expect(brand.id).toBe('fixture-brand');
        ctx.expect(brand.enabledTargets).toEqual(['web']);

        const byName = Object.fromEntries(brand.targets.map((entry) => [entry.name, entry.target]));
        ctx.expect(byName.web).toBe('web');
        ctx.expect(byName.api).toBe('backend');
      },
    },

    {
      name: 'loadBrand: config load failure lands in configError, never throws',
      run: (ctx) => {
        const root = stageBrand({
          config: `{ brand: { id: 'x', name: 'X' }, connections: { clientSecret: 'oops' }, targets: { web: { type: 'web' } } }`,
        });

        const brand = loadBrand(root);
        ctx.expect(brand.configError).toMatch(/Secret-shaped keys/);
        ctx.expect(brand.enabledTargets).toEqual([]);
      },
    },

    {
      name: 'loadBrand: templates { domain } from brand.url',
      run: (ctx) => {
        const root = stageBrand({
          config: `{
      brand: { id: 'fixture-brand', name: 'Fixture', url: 'https://fixture-brand.test', contact: { email: 'support@{ domain }' } },
      targets: { web: { type: 'web' } },
    }`,
        });

        const brand = loadBrand(root);
        ctx.expect(brand.config.brand.contact.email).toBe('support@fixture-brand.test');
      },
    },

    {
      name: 'discoverTargets: a brand still on apps/ fails LOUD with the migration pointer, never a zero-target walk',
      run: (ctx) => {
        const root = stageLegacyBrand();

        ctx.expect(() => discoverTargets(root)).toThrow(/still carries apps\/ instead of targets\/ \(#443\)/);
        ctx.expect(() => loadBrand(root)).toThrow(/--migration=targets-rename --execute/);
      },
    },

    {
      name: 'runManage: --migration=targets-rename runs the rename ALONE — the one brand discovery refuses to walk',
      run: async (ctx) => {
        const root = stageLegacyBrand();

        const audit = await runManage(root, { migration: 'targets-rename' });
        ctx.expect(audit.hasErrors).toBe(false);
        ctx.expect(audit.results.migrations.output.targetsRename.audit).toBe(true);
        ctx.expect(fs.existsSync(path.join(root, 'apps', 'web')), 'the default run moved nothing').toBeTruthy();

        const report = await runManage(root, { migration: 'targets-rename', execute: true });
        ctx.expect(report.hasErrors).toBe(false);
        ctx.expect(!fs.existsSync(path.join(root, 'apps')), 'apps/ is gone').toBeTruthy();
        ctx.expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces).toEqual(['targets/*']);

        // …and the brand the migration fixed now loads like any other
        ctx.expect(loadBrand(root).targets.map((entry) => entry.name)).toEqual(['web']);
      },
    },

    // #586 — the manage walk judges every key on the RESOLVED cascade (it mints a
    // missing one into the brand .env), so a value that lives only in an
    // environment overlay has to be visible to it. Without the overlay in the
    // chain, `.env.production` would read as absent and the mint lane would write
    // a second value over the top of it.
    //
    // The overlay it reads is PINNED to production: manage reconciles real
    // infrastructure with production credentials, so the shell's incidental
    // environment never decides which key the walk judges.
    {
      name: 'runManage: the env chain reads the brand .env.production overlay, whatever the shell says',
      run: async (ctx) => {
        const root = stageBrand();
        const saved = { ENVIRONMENT: process.env.ENVIRONMENT, OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT };

        fs.writeFileSync(path.join(root, '.env'), 'FIXTURE_OVERLAY_KEY="from-the-base"\n');
        fs.writeFileSync(path.join(root, '.env.development'), 'FIXTURE_OVERLAY_KEY="from-the-development-overlay"\n');
        fs.writeFileSync(path.join(root, '.env.production'), 'FIXTURE_OVERLAY_KEY="from-the-production-overlay"\n');

        try {
          delete process.env.FIXTURE_OVERLAY_KEY;
          delete process.env.OMEGA_ENVIRONMENT;
          process.env.ENVIRONMENT = 'development';

          await runManage(root, { ...FAKE_FETCH_200 });

          ctx.expect(process.env.FIXTURE_OVERLAY_KEY, 'the manage lane pins production — a development shell never swaps the overlay').toBe('from-the-production-overlay');
        } finally {
          delete process.env.FIXTURE_OVERLAY_KEY;
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'runManage: full loop — workspace, update (build), testing all pass; run output + gitignore written',
      run: async (ctx) => {
        const root = stageBrand();

        const report = await runManage(root, { ...FAKE_FETCH_200 });

        ctx.expect(report.hasErrors).toBe(false);
        ctx.expect(report.results.workspace.status).toBe('success');
        // No repo block configured (its presence is the switch, #883) → clean skip
        ctx.expect(report.results.repo.status).toBe('skipped');
        ctx.expect(report.results.repo.reason).toMatch(/repo\.owner/);
        // No CLOUDFLARE_TOKEN in the environment → clean skip
        ctx.expect(report.results.edge.status).toBe('skipped');
        ctx.expect(report.results.edge.reason).toMatch(/CLOUDFLARE_TOKEN/);
        // No domain.providers registrar configured → clean skip
        ctx.expect(report.results.domain.status).toBe('skipped');
        ctx.expect(report.results.domain.reason).toMatch(/domain\.providers/);
        // No project id means "not yet chosen", so cloud still asks for its Google
        // client keys; none in the environment → clean skip naming them
        ctx.expect(report.results.cloud.status).toBe('skipped');
        ctx.expect(report.results.cloud.reason).toMatch(/GOOGLE_CLIENT_ID/);
        // No reCAPTCHA secret in the environment → clean skip (the site key is
        // config now, #893, so the env skip names the secret half alone)
        ctx.expect(report.results.captcha.status).toBe('skipped');
        ctx.expect(report.results.captcha.reason).toMatch(/RECAPTCHA_SECRET_KEY/);
        // No analytics providers configured → clean skip
        ctx.expect(report.results.analytics.status).toBe('skipped');
        ctx.expect(report.results.analytics.reason).toMatch(/no analytics providers/);
        // No Google credentials in the environment → clean skip
        ctx.expect(report.results.search.status).toBe('skipped');
        ctx.expect(report.results.search.reason).toMatch(/GOOGLE_CLIENT_ID/);
        // No advertising provider authored → clean skip (wave-5 F10: through the
        // REAL pipeline — proves the DEFAULTS merge doesn't resurrect the entry)
        ctx.expect(report.results.advertising.status).toBe('skipped');
        ctx.expect(report.results.advertising.reason).toMatch(/no advertising\.providers\.adsense/);
        // No monitor CHOSEN → clean skip. The role-level switch is a schema default
        // (#478) so `monitoring.enabled` is always present; the pick still is not —
        // a default under `providers.sentry` would opt every brand in.
        ctx.expect(report.results.monitoring.status).toBe('skipped');
        ctx.expect(report.results.monitoring.reason).toMatch(/no monitoring\.providers entry/);
        // No SendGrid API key in the environment → clean skip
        ctx.expect(report.results.campaigns.status).toBe('skipped');
        ctx.expect(report.results.campaigns.reason).toMatch(/SENDGRID_API_KEY/);
        // No Beehiiv API key in the environment → clean skip
        ctx.expect(report.results.newsletter.status).toBe('skipped');
        ctx.expect(report.results.newsletter.reason).toMatch(/BEEHIIV_API_KEY/);
        // Fixture has no priced products → clean skip before any provider check
        ctx.expect(report.results.payment.status).toBe('skipped');
        ctx.expect(report.results.payment.reason).toMatch(/no paid products/);
        // No forms.providers.slapform.formId configured → clean skip
        ctx.expect(report.results.forms.status).toBe('skipped');
        ctx.expect(report.results.forms.reason).toMatch(/forms\.providers\.slapform\.formId/);
        // No inbound.chat.providers.chatsy.agentId configured → clean skip
        ctx.expect(report.results.chat.status).toBe('skipped');
        ctx.expect(report.results.chat.reason).toMatch(/inbound\.chat\.providers\.chatsy\.agentId/);
        // Web-only fixture → the email agent has no backend to answer for
        ctx.expect(report.results.email.status).toBe('skipped');
        ctx.expect(report.results.email.reason).toMatch(/no backend target/);
        // No company-server service account → clean skip
        ctx.expect(report.results.server.status).toBe('skipped');
        ctx.expect(report.results.server.reason).toMatch(/SERVER_SERVICE_ACCOUNT/);
        // Fixture has no logo sources → clean skip with guidance
        ctx.expect(report.results.assets.status).toBe('skipped');
        ctx.expect(report.results.assets.reason).toMatch(/brandmark\.svg/);
        // Web-only fixture → no desktop/mobile target to sign for
        ctx.expect(report.results.certificates.status).toBe('skipped');
        ctx.expect(report.results.certificates.reason).toMatch(/no desktop or mobile target/);
        // No OpenAI key in the environment and no TTY to paste it → clean skip
        // naming it alone: the Anthropic key is asked only with a backend target
        ctx.expect(report.results.ai.status).toBe('skipped');
        ctx.expect(report.results.ai.reason).toMatch(/OPENAI_API_KEY/);
        ctx.expect(report.results.ai.reason).not.toMatch(/ANTHROPIC_API_KEY/);
        // No parasite SEO content configured → clean skip with sidecar guidance
        ctx.expect(report.results.seo.status).toBe('skipped');
        ctx.expect(report.results.seo.reason).toMatch(/no SEO content configured/);
        ctx.expect(report.results.update.status).toBe('success');
        // Web-only fixture → no backend whose Firebase Auth accounts to manage
        ctx.expect(report.results.account.status).toBe('skipped');
        ctx.expect(report.results.account.reason).toMatch(/no backend target/);
        // Data migrations never run without the explicit --migration flag
        ctx.expect(report.results.migrations.status).toBe('skipped');
        ctx.expect(report.results.migrations.reason).toMatch(/--migration flag not set/);
        ctx.expect(report.results.testing.status).toBe('success');

        // The build actually produced the site
        ctx.expect(fs.existsSync(path.join(root, 'targets', 'web', 'dist', 'index.html'))).toBeTruthy();

        // Install was resolution-gated and skipped (fixture has no deps) — no stray
        // node_modules materialized
        const rootSteps = report.results.update.output.results.root.steps;
        ctx.expect(rootSteps[0].phase).toBe('install');
        ctx.expect(rootSteps[0].skipped).toBe(true);
        ctx.expect(!fs.existsSync(path.join(root, 'node_modules'))).toBeTruthy();

        // Transient run output landed in .omega/runs/
        const runsDir = path.join(root, '.omega', 'runs');
        ctx.expect(fs.readdirSync(runsDir).length).toBe(1);
        const run = JSON.parse(fs.readFileSync(path.join(runsDir, fs.readdirSync(runsDir)[0]), 'utf8'));
        ctx.expect(run.brandId).toBe('fixture-brand');
        ctx.expect(run.services.map((s) => s.service)).toEqual(['workspace', 'repo', 'edge', 'domain', 'cloud', 'captcha', 'analytics', 'search', 'advertising', 'monitoring', 'campaigns', 'newsletter', 'payment', 'forms', 'chat', 'email', 'server', 'directory', 'assets', 'certificates', 'publishing', 'ai', 'disperse', 'seo', 'update', 'account', 'migrations', 'bookmark', 'testing']);

        // .omega/ got gitignored
        const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        ctx.expect(gitignore.includes('.omega/')).toBeTruthy();
      },
    },

    {
      name: 'runManage: rerun is idempotent — same statuses, single gitignore entry',
      run: async (ctx) => {
        const root = stageBrand();

        await runManage(root, { ...FAKE_FETCH_200 });
        const second = await runManage(root, { ...FAKE_FETCH_200 });

        ctx.expect(second.hasErrors).toBe(false);
        ctx.expect(second.results.workspace.status).toBe('success');
        ctx.expect(second.results.testing.status).toBe('success');

        const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        const entries = gitignore.split('\n').filter((line) => line.trim() === '.omega/');
        ctx.expect(entries.length).toBe(1);
      },
    },

    {
      name: 'runManage: a service that ran carries its wall time, in the report and the run record',
      run: async (ctx) => {
        const root = stageBrand();

        const report = await runManage(root, { service: 'workspace' });

        ctx.expect(typeof report.results.workspace.durationMs).toBe('number');
        ctx.expect(report.results.workspace.durationMs >= 0).toBeTruthy();

        const runsDir = path.join(root, '.omega', 'runs');
        const run = JSON.parse(fs.readFileSync(path.join(runsDir, fs.readdirSync(runsDir)[0]), 'utf8'));
        ctx.expect(typeof run.services[0].durationMs).toBe('number');
      },
    },

    {
      name: 'runManage: a service run() that hits a consent gate warns — the walk continues, the report stays clean (#228)',
      run: async (ctx) => {
        const root = stageBrand();

        // A dead Google grant surfaces as the coded throw from inside the service,
        // past preflight (which only knows what the token store RECORDS).
        const servicePath = require.resolve('../src/services/repo/index.js');
        const original = require.cache[servicePath];
        require.cache[servicePath] = {
          id: servicePath,
          filename: servicePath,
          path: path.dirname(servicePath),
          loaded: true,
          exports: {
            run: async () => {
              const error = new Error('Google consent required (scopes: webmasters) — run the service once interactively to grant it');
              error.code = CONSENT_REQUIRED;
              throw error;
            },
          },
        };

        let report;
        try {
          report = await runManage(root, { ...FAKE_FETCH_200 });
        } finally {
          if (original) {
            require.cache[servicePath] = original;
          } else {
            delete require.cache[servicePath];
          }
        }

        ctx.expect(report.results.repo.status, 'a pending human gate is not a failure').toBe('warned');
        ctx.expect(report.results.repo.output.auth.needsInteractive).toMatch(/Google consent required/);
        ctx.expect(report.results.testing.status, 'the walk ran on to the last service').toBe('success');
        ctx.expect(report.hasErrors, 'so the dev boot reading this report still starts the stack').toBe(false);
      },
    },

    {
      name: 'config: the boot lane is the local slice — file work only, and every entry is a real service',
      run: (ctx) => {
        ctx.expect([...BOOT_SERVICES], 'network/rebuild services stay out — a dev boot waits on this list').toEqual(['workspace', 'assets', 'disperse']);
        for (const service of BOOT_SERVICES) {
          ctx.expect(SERVICE_ORDER.includes(service), `${service} is not in SERVICE_ORDER — a rename orphaned the lane list`).toBeTruthy();
        }
      },
    },

    {
      name: 'runManage: lane boot walks exactly the boot services, in SERVICE_ORDER order (#228)',
      run: async (ctx) => {
        const root = stageBrand();

        const report = await runManage(root, { lane: 'boot' });

        ctx.expect(Object.keys(report.results), 'the slow lane (cloud, campaigns, update, account…) never runs at boot').toEqual(['workspace', 'assets', 'disperse']);
        ctx.expect(report.hasErrors).toBe(false);
      },
    },

    {
      name: 'runManage: an unknown lane throws instead of silently walking everything',
      run: async (ctx) => {
        const root = stageBrand();

        await ctx.expect((() => runManage(root, { lane: 'quick' }))()).rejects.toThrow(/Unknown lane/);
      },
    },

    {
      name: 'runManage: --service still wins over a lane (the more specific ask)',
      run: async (ctx) => {
        const root = stageBrand();

        const report = await runManage(root, { service: 'workspace', lane: 'boot' });

        ctx.expect(Object.keys(report.results)).toEqual(['workspace']);
      },
    },

    {
      name: 'runManage: on a boot lane, preflight still names what MANAGE owes — without walking or failing it (#228)',
      run: async (ctx) => {
        const root = stageBrand();

        let report;
        const log = await captureLogAsync(async () => {
          report = await runManage(root, { lane: 'boot' });
        });

        // The full setup's gaps are still reported…
        ctx.expect(log).toMatch(/⚑ Preflight/);
        ctx.expect(log).toMatch(/edge — missing CLOUDFLARE_TOKEN/);
        // …but a manage-lane finding never becomes a result of THIS run
        ctx.expect(report.results.edge, 'an unwalked service records nothing').toBe(undefined);
        ctx.expect(report.hasErrors, 'and never fails the boot').toBe(false);
      },
    },

    {
      name: 'runManage: unloadable brand config fails the workspace service and stops the run',
      run: async (ctx) => {
        const root = stageBrand({
          config: `{ brand: { id: 'x', name: 'X' }, connections: { clientSecret: 'oops' }, targets: { web: { type: 'web' } } }`,
        });

        const report = await runManage(root, {});

        ctx.expect(report.hasErrors).toBe(true);
        ctx.expect(report.results.workspace.status).toBe('error');
        ctx.expect(report.results.workspace.error).toMatch(/Secret-shaped keys/);
        // stopOnError: update/testing never ran
        ctx.expect(report.results.update).toBe(undefined);
        ctx.expect(report.results.testing).toBe(undefined);
      },
    },

    {
      name: 'runManage: a target with no type walks to the workspace report instead of throwing',
      run: async (ctx) => {
        const root = stageBrand({
          config: `{ brand: { id: 'fixture-brand', name: 'Fixture' }, targets: { web: {} } }`,
        });

        const report = await runManage(root, { execFn: toolProbe() });

        ctx.expect(report.results.workspace.status).toBe('error');
        ctx.expect(report.results.workspace.error).toMatch(/targets\.web must declare a type/);
      },
    },

    {
      name: 'runManage: enabled target with no dir is a structure error naming the dir to create',
      run: async (ctx) => {
        const root = stageBrand({
          config: `{
      brand: { id: 'fixture-brand', name: 'Fixture', url: 'https://fixture-brand.test' },
      targets: { web: { type: 'web' }, backend: { type: 'backend' } },
    }`,
        });

        const report = await runManage(root, { execFn: toolProbe() }); // every machine tool probe passes

        ctx.expect(report.hasErrors).toBe(true);
        ctx.expect(report.results.workspace.error).toMatch(/create targets\/backend\//);
      },
    },

    {
      name: '#1032 case 8: a backend missing the Firebase CLI gets the line once, and the walk goes on',
      run: async (ctx) => {
        const { missingMachineTools, machineToolLine } = require('@omega.js/devkit/machine-tools');
        // The probe seam (options.execFn): only the Firebase CLI's probe fails
        const execFn = toolProbe('firebase');
        const line = machineToolLine(missingMachineTools([{ name: 'backend', type: 'backend' }], { platform: process.platform, execFn })[0]);
        const root = stageBrand({
          config: `{
      brand: { id: 'fixture-brand', name: 'Fixture', url: 'https://fixture-brand.test' },
      targets: { web: { type: 'web' }, backend: { type: 'backend' } },
    }`,
        });
        fs.mkdirSync(path.join(root, 'targets', 'backend'));
        fs.writeFileSync(path.join(root, 'targets', 'backend', 'package.json'), JSON.stringify({ name: 'fixture-backend', private: true }));

        let report;
        const lines = [];
        const methods = ['log', 'warn', 'error'];
        const originals = methods.map((method) => console[method]);
        methods.forEach((method) => { console[method] = (...args) => lines.push(args.join(' ')); });
        try {
          report = await runManage(root, { ...FAKE_FETCH_200, execFn });
        } finally {
          methods.forEach((method, i) => { console[method] = originals[i]; });
        }
        const output = lines.join('\n');

        ctx.expect(output.split(line).length - 1, `the line prints once: ${output}`).toBe(1);
        ctx.expect(Object.keys(report.results).pop(), 'the walk ran on to the last service').toBe(SERVICE_ORDER.at(-1));
      },
    },

    // #677: membership is a fact of the brand, so the header states it on EVERY
    // run: the id and where the company is, or that there is none.
    {
      name: 'runManage: the header always states the company: none, here, or not on this machine',
      run: async (ctx) => {
        const lines = [];
        const log = console.log;
        console.log = (...args) => lines.push(args.join(' '));
        const companyLine = () => lines.filter((line) => line.includes('Company:')).pop();

        try {
          const standalone = stageBrand();
          await runManage(standalone, { service: 'workspace' });
          ctx.expect(companyLine()).toMatch(/Company:\s+none$/);

          const orphan = stageBrand({
            config: `{ brand: { id: 'fixture-brand' }, company: { id: 'nowhere-co' }, targets: { web: { type: 'web' } } }`,
          });
          await runManage(orphan, { service: 'workspace' });
          ctx.expect(companyLine()).toMatch(/Company:\s+nowhere-co \(not on this machine\)$/);

          const parent = stageBrand();
          recordBrand({ id: 'fixture-co', root: parent, name: 'Fixture Co', url: 'https://fixture-co.test' });
          const child = stageBrand({
            config: `{ brand: { id: 'fixture-brand' }, company: { id: 'fixture-co' }, targets: { web: { type: 'web' } } }`,
          });
          await runManage(child, { service: 'workspace' });
          ctx.expect(companyLine()).toMatch(new RegExp(`Company:\\s+fixture-co \\(${parent.replace(/\//g, '\\/')}\\)$`));
        } finally {
          console.log = log;
        }
      },
    },

    {
      name: 'runManage: disabled brand is skipped whole',
      run: async (ctx) => {
        const root = stageBrand({
          config: `{ enabled: false, brand: { id: 'fixture-brand', name: 'Fixture' }, targets: { web: { type: 'web' } } }`,
        });

        const report = await runManage(root, {});
        ctx.expect(report.skipped).toBe(true);
        ctx.expect(report.hasErrors).toBe(false);
      },
    },

    {
      name: 'runManage: --service runs exactly one service; unknown service throws',
      run: async (ctx) => {
        const root = stageBrand();

        const report = await runManage(root, { service: 'workspace' });
        ctx.expect(Object.keys(report.results)).toEqual(['workspace']);

        await ctx.expect((() => runManage(root, { service: 'nope' }))()).rejects.toThrow(/Unknown service/);
      },
    },

    {
      name: 'runManage: dry-run reports what update would do without building',
      run: async (ctx) => {
        const root = stageBrand();

        const report = await runManage(root, { dryRun: true });

        ctx.expect(report.results.update.status).toBe('success');
        const webSteps = report.results.update.output.results.web.steps;
        ctx.expect(webSteps[0].skipped).toBe(true);
        ctx.expect(!fs.existsSync(path.join(root, 'targets', 'web', 'dist'))).toBeTruthy();
        // testing then honestly reports the missing build output
        ctx.expect(report.results.testing.status).toBe('error');
      },
    },
  ],
});
