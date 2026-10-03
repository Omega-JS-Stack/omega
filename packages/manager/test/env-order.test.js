// Tests for src/lib/env-order.js: the brand and company .env run through the
// ONE marker engine. The template is the Default section (header, canonical
// groups, `# KEY=""` placeholders), Custom is its bare marker, and every writer
// (the scaffold stubs, writeEnvValue, the workspace env-order op) converges
// through it without losing a value.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

const { envKeysForTarget } = require('@omega.js/config');
const { DEFAULT_MARKER, CUSTOM_MARKER } = require('@omega.js/devkit/merge-line-files');

const { renderEnvTemplate, convergeEnv } = require('../src/lib/env-order.js');
const { writeEnvValue } = require('../src/lib/env-secret.js');
const { buildScaffoldPlan } = require('../src/lib/scaffold.js');
const { buildCompanyScaffoldPlan } = require('../src/lib/company-scaffold.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-order-'));
}

/** The values the loader sees: dotenv's parse, empty values dropped. */
function effective(content) {
  return Object.fromEntries(Object.entries(dotenv.parse(content)).filter(([, value]) => value !== ''));
}

/** [Default section, Custom section] of a marked file. */
function sections(expect, content) {
  const at = content.indexOf(CUSTOM_MARKER);
  expect(at, 'the file carries the Custom marker').not.toBe(-1);
  return [content.slice(0, at), content.slice(at + CUSTOM_MARKER.length + 1)];
}

// ─── The first converge of an unmarked file ──────────────────────────────────

const EM_DASH = String.fromCharCode(0x2014);

// Fake values throughout; the shape is an organic pre-marker brand .env
const UNMARKED = [
  `# My Brand ${EM_DASH} brand secrets (gitignored; loaded before every omega-manager run).`,
  '# Uncomment and fill what this brand uses. Services without their credentials',
  '# skip cleanly, so add these as the brand adopts each service.',
  '',
  '# Keep this file out of screenshots.',
  '',
  '# ── Email marketing (sendgrid + beehiiv services) ──',
  'SENDGRID_API_KEY="sg-1"',
  '',
  'CLOUDFLARE_TOKEN=cf-raw-1',
  '# hand note: rotated last spring',
  'GH_TOKEN="gh-2"',
  "GOOGLE_CLIENT_ID='single-quoted'",
  'SENTRY_AUTH_TOKEN=',
  '# STRIPE_SECRET_KEY=',
  'OMEGA_ADMIN_KEY="admin-fake"',
  '',
  '# A standalone note between groups',
  '# spanning two lines',
  '',
  '# OLD_STRIPE_KEY=sk_live_old',
  '',
  '# ── Auto-generated and persisted on the first real run ──',
  '# The GA4 Measurement Protocol secrets are per target (the analytics service resolves',
  '# one per stream; disperse composes each target its own GOOGLE_ANALYTICS_SECRET), and the',
  '# VAPID private key is the half the Firebase console only ever shows you once.',
  '# ACCOUNT_PASSWORD_SEED=',
  '',
  '# one per stream; disperse composes each target its own GOOGLE_ANALYTICS_SECRET), and the',
  '',
  '# ── Other keys (not in the canonical groups) ──',
  '# my own note on my own key',
  'MY_CUSTOM_THING="custom"',
  'OAUTH2_GOOGLE_CLIENT_ID="legacy-oauth"',
  'STALE_EMPTY=',
  '',
  '# trailing note',
  '',
].join('\n');

// ─── The workspace env-order op ──────────────────────────────────────────────

const envOrderOp = require('../src/services/workspace/ensure/env-order.js');

module.exports = defineCases({
  type: 'group',
  description: 'env-order',
  tests: [
    // ─── The template ────────────────────────────────────────────────────────────

    {
      name: 'env-order: the template is Default (header, groups, placeholders) then a bare Custom marker',
      run: (ctx) => {
        const content = renderEnvTemplate({ OMEGA_ADMIN_KEY: 'abc123' });
        const lines = content.split('\n');

        ctx.expect(lines[0]).toBe(DEFAULT_MARKER);
        ctx.expect(content.endsWith(`\n\n${CUSTOM_MARKER}\n`), 'nothing under the Custom marker').toBeTruthy();

        // Groups in schema order, a set value rendered quoted, absent keys as placeholders
        const order = ['OMEGA_LICENSE_KEY', 'OMEGA_ADMIN_KEY', 'GH_TOKEN', 'CLOUDFLARE_TOKEN', 'SENDGRID_API_KEY', 'ACCOUNT_PASSWORD_SEED']
          .map((key) => lines.findIndex((line) => line.replace(/^# /, '').startsWith(`${key}=`)));
        ctx.expect([...order].sort((a, b) => a - b)).toEqual(order);
        ctx.expect(content).toMatch(/^OMEGA_ADMIN_KEY="abc123"$/m);
        ctx.expect(content).toMatch(/^# OMEGA_WEBHOOK_KEY=""$/m);
        ctx.expect(content).toMatch(/^# ── Cloudflare /m);
        ctx.expect(content).not.toMatch(/Other keys/);
      },
    },

    {
      name: 'env-order: every key the backend composer knows has a template placeholder (#502)',
      run: (ctx) => {
        const content = renderEnvTemplate();

        const missing = envKeysForTarget('backend').filter((key) => !new RegExp(`^(# )?${key}=`, 'm').test(content));
        ctx.expect(missing, `backend composition keys with no template line: ${missing.join(', ')}`).toEqual([]);
      },
    },

    {
      name: 'env-order: an unmarked file converges with every value kept, known keys in Default, the rest in Custom',
      run: (ctx) => {
        const { content, changed, skipped } = convergeEnv(UNMARKED);

        ctx.expect(skipped).toBe(undefined);
        ctx.expect(changed).toBe(true);
        ctx.expect(effective(content)).toEqual({
          SENDGRID_API_KEY: 'sg-1',
          CLOUDFLARE_TOKEN: 'cf-raw-1',
          GH_TOKEN: 'gh-2',
          GOOGLE_CLIENT_ID: 'single-quoted',
          OMEGA_ADMIN_KEY: 'admin-fake',
          MY_CUSTOM_THING: 'custom',
          OAUTH2_GOOGLE_CLIENT_ID: 'legacy-oauth',
        });

        const [defaults, custom] = sections(ctx.expect, content);
        ctx.expect(content.split('\n')[0]).toBe(DEFAULT_MARKER);
        for (const line of ['SENDGRID_API_KEY="sg-1"', 'CLOUDFLARE_TOKEN="cf-raw-1"', 'GH_TOKEN="gh-2"', 'GOOGLE_CLIENT_ID="single-quoted"', 'OMEGA_ADMIN_KEY="admin-fake"']) {
          ctx.expect(defaults.split('\n').includes(line), `${line} sits in Default`).toBeTruthy();
        }
        // Every consumer comment and every key the template does not know land under
        // Custom in file order, paragraphs kept; the framework's old header, group
        // headers and group notes (stale wordings included) stay behind
        ctx.expect(custom).toBe([
          '# Keep this file out of screenshots.',
          '',
          '# A standalone note between groups',
          '# spanning two lines',
          '',
          '# OLD_STRIPE_KEY=sk_live_old',
          '',
          '# my own note on my own key',
          'MY_CUSTOM_THING="custom"',
          'OAUTH2_GOOGLE_CLIENT_ID="legacy-oauth"',
          '',
          '# trailing note',
          '',
        ].join('\n'));

        // Default is the template's: stale group text regenerated, an empty known key back to its placeholder
        ctx.expect(content).not.toMatch(/sendgrid \+ beehiiv services|Other keys|brand secrets|disperse composes/);
        ctx.expect(defaults).toMatch(/^# SENTRY_AUTH_TOKEN=""$/m);
        ctx.expect(defaults, 'a bare placeholder converges to the quoted one').toMatch(/^# STRIPE_SECRET_KEY=""$/m);
        // A hand comment over a known key and an empty unknown key hold no value, so both drop
        ctx.expect(content).not.toMatch(/hand note|STALE_EMPTY/);
      },
    },

    {
      name: 'env-order: every header the company stub ever generated stays out of Custom on the first converge',
      run: (ctx) => {
        for (const header of [
          [`# Acme Co ${EM_DASH} COMPANY secrets (gitignored; loaded UNDER every managed brand's own .env).`, '# Precedence: shell env > brand .env > this file. Put here only what every brand', `# shares ${EM_DASH} anything brand-specific belongs in that brand's .env, never here.`],
          ['# Acme Co: COMPANY secrets (gitignored; loaded UNDER every brand of this company).', '# Precedence: shell env > brand .env > this file. Put here only what every brand', "# shares. Anything brand-specific belongs in that brand's .env, never here."],
          [`# Acme ${EM_DASH} brand secrets (gitignored; loaded before every omega run).`],
        ]) {
          const { content } = convergeEnv(`${header.join('\n')}\n\n# ours\nCOMPANY_OWN="c"\n`);
          ctx.expect(sections(ctx.expect, content)[1], header[0]).toBe('# ours\nCOMPANY_OWN="c"\n');
        }
      },
    },

    {
      name: 'env-order: a converged file re-runs byte-identical',
      run: (ctx) => {
        const first = convergeEnv(UNMARKED).content;
        const second = convergeEnv(first);
        ctx.expect(second.changed).toBe(false);
        ctx.expect(second.content).toBe(first);
      },
    },

    {
      name: 'env-order: the Custom section of a marked file is kept verbatim',
      run: (ctx) => {
        const custom = '# my block\nMINE="x"\n\nALSO_MINE=raw-kept\n';
        const marked = `${renderEnvTemplate()}${custom}`;

        const result = convergeEnv(marked);
        ctx.expect(sections(ctx.expect, result.content)[1]).toBe(custom.replace('raw-kept', '"raw-kept"'));
        ctx.expect(convergeEnv(result.content).changed).toBe(false);
      },
    },

    {
      name: 'env-order: a multi-line value converges whole, its value kept',
      run: (ctx) => {
        const multiLine = 'PRIVATE_KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\nGH_TOKEN="gh"\n';
        const result = convergeEnv(multiLine);
        ctx.expect(result.skipped).toBe(undefined);
        ctx.expect(effective(result.content)).toEqual(effective(multiLine));
        ctx.expect(convergeEnv(result.content).changed).toBe(false);
      },
    },

    {
      name: 'env-order: a value ending in a backslash before its quote leaves the next line its own unit',
      run: (ctx) => {
        for (const [content, neighbour] of [['MINE="x\\"\nOMEGA_ADMIN_KEY=raw\nOTHER="c"\n', 'OMEGA_ADMIN_KEY'], ['GH_TOKEN="x\\"\nOPENAI_API_KEY="y"\nMINE="1"\n', 'OPENAI_API_KEY']]) {
          const read = dotenv.parse(content);
          const result = convergeEnv(content);
          ctx.expect(result.skipped).toBe(undefined);
          ctx.expect(dotenv.parse(result.content)).toEqual(read);
          ctx.expect(result.content, 'the neighbour is quoted on its own line').toMatch(new RegExp(`^${neighbour}="${read[neighbour]}"$`, 'm'));
          ctx.expect(result.content.match(new RegExp(`^#?\\s*${neighbour}=`, 'gm')).length, 'no placeholder beside the set line').toBe(1);
        }
      },
    },

    {
      name: 'env-order: a converge that would change a value declines untouched (a dotenv colon line)',
      run: (ctx) => {
        const exotic = 'GH_TOKEN: colon-form\nSENDGRID_API_KEY="sg"\n';
        const result = convergeEnv(exotic);
        ctx.expect(result.skipped).toMatch(/would change an effective value/);
        ctx.expect(result.changed).toBe(false);
        ctx.expect(result.content).toBe(exotic);
      },
    },

    // ─── The scaffold stubs ──────────────────────────────────────────────────────

    {
      name: 'env-order: the brand and company stubs are the template, already converged',
      run: (ctx) => {
        const brandEnv = buildScaffoldPlan({
          id: 'acme', name: 'Acme', url: 'https://acme.dev', email: 'hi@acme.dev',
          accountAdmins: [], targets: [{ name: 'web', type: 'web' }],
        }).find((file) => file.path === '.env').contents;
        const companyEnv = buildCompanyScaffoldPlan('Acme Co').find((file) => file.path === '.env').contents;

        for (const stub of [brandEnv, companyEnv]) {
          ctx.expect(stub.split('\n')[0]).toBe(DEFAULT_MARKER);
          ctx.expect(sections(ctx.expect, stub)[1]).toBe('');
          ctx.expect(convergeEnv(stub).changed).toBe(false);
        }
        // The brand stub's minted keys sit in Default; the company stub sets nothing
        ctx.expect(sections(ctx.expect, brandEnv)[0]).toMatch(/^OMEGA_ADMIN_KEY="[A-Za-z0-9_-]{43}"$/m);
        ctx.expect(effective(companyEnv)).toEqual({});
      },
    },

    // ─── writeEnvValue ───────────────────────────────────────────────────────────

    {
      name: 'env-order: writeEnvValue lands a known key in Default with its value, Custom untouched',
      run: (ctx) => {
        const root = tmpdir();
        try {
          const envPath = path.join(root, '.env');
          fs.writeFileSync(envPath, `${renderEnvTemplate()}MINE="keep-me"\n`);

          writeEnvValue(root, 'OMEGA_WEBHOOK_KEY', 'minted-fake');
          const env = fs.readFileSync(envPath, 'utf8');
          const [defaults, custom] = sections(ctx.expect, env);
          ctx.expect(defaults).toMatch(/^OMEGA_WEBHOOK_KEY="minted-fake"$/m);
          ctx.expect(env).not.toMatch(/^# OMEGA_WEBHOOK_KEY=/m);
          ctx.expect(custom).toBe('MINE="keep-me"\n');

          // A second write replaces the value in place
          writeEnvValue(root, 'OMEGA_WEBHOOK_KEY', 'rotated-fake');
          ctx.expect(fs.readFileSync(envPath, 'utf8')).toBe(env.replace('minted-fake', 'rotated-fake'));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'env-order: writeEnvValue marks a fresh file and puts an unknown key under Custom',
      run: (ctx) => {
        const root = tmpdir();
        try {
          writeEnvValue(root, 'FIXTURE_SECRET', 'fresh-fake');
          const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
          ctx.expect(env.split('\n')[0]).toBe(DEFAULT_MARKER);
          ctx.expect(sections(ctx.expect, env)[1]).toBe('FIXTURE_SECRET="fresh-fake"\n');
          ctx.expect(convergeEnv(env).changed).toBe(false);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // context.companyRoot is the company TREE the walk resolved (#677): a dir
    // with a `.env` like any other layer root, which is all this op needs.
    {
      name: 'workspace env-order op: converges brand AND company .env files onto the markers',
      run: async (ctx) => {
        const brandRoot = tmpdir();
        const companyRoot = tmpdir();
        try {
          fs.writeFileSync(path.join(brandRoot, '.env'), 'SENDGRID_API_KEY="sg"\nBRAND_OWN="b"\n');
          fs.writeFileSync(path.join(companyRoot, '.env'), 'CSC_KEY_PASSWORD="pw"\nCOMPANY_OWN="c"\n');

          const result = await envOrderOp({ brandRoot, companyRoot, options: {} });
          ctx.expect(result.output.envOrder).toEqual({ brand: 'converged', company: 'converged' });

          const brandEnv = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
          ctx.expect(sections(ctx.expect, brandEnv)[0]).toMatch(/^SENDGRID_API_KEY="sg"$/m);
          ctx.expect(sections(ctx.expect, brandEnv)[1]).toBe('BRAND_OWN="b"\n');

          const companyEnv = fs.readFileSync(path.join(companyRoot, '.env'), 'utf8');
          ctx.expect(sections(ctx.expect, companyEnv)[0]).toMatch(/^CSC_KEY_PASSWORD="pw"$/m);
          ctx.expect(sections(ctx.expect, companyEnv)[1]).toBe('COMPANY_OWN="c"\n');

          const rerun = await envOrderOp({ brandRoot, companyRoot, options: {} });
          ctx.expect(rerun.output.envOrder).toEqual({ brand: 'current', company: 'current' });
          ctx.expect(fs.readFileSync(path.join(brandRoot, '.env'), 'utf8')).toBe(brandEnv);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
          fs.rmSync(companyRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'workspace env-order op: dry run plans and writes nothing; missing and declined files noted',
      run: async (ctx) => {
        const brandRoot = tmpdir();
        try {
          const before = 'SENDGRID_API_KEY="sg"\nGH_TOKEN="gh"\n';
          const envPath = path.join(brandRoot, '.env');
          fs.writeFileSync(envPath, before);

          const result = await envOrderOp({ brandRoot, options: { dryRun: true } });
          ctx.expect(result.output.envOrder).toEqual({ brand: 'planned' });
          ctx.expect(fs.readFileSync(envPath, 'utf8')).toBe(before);

          const exotic = 'GH_TOKEN: colon-form\n';
          fs.writeFileSync(envPath, exotic);
          const declined = await envOrderOp({ brandRoot, options: {} });
          ctx.expect(declined.output.envOrder).toEqual({ brand: 'skipped' });
          ctx.expect(fs.readFileSync(envPath, 'utf8')).toBe(exotic);

          fs.rmSync(envPath);
          const missing = await envOrderOp({ brandRoot, options: {} });
          ctx.expect(missing.output.envOrder).toEqual({ brand: 'missing' });
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
  ],
});
