/**
 * copy-legacy-env tests: key selection, the idempotent copy plan written in
 * the one KEY="value" form (quoted multi-line values included), and the
 * no-value-leak guarantee.
 * Run: node --test scripts/copy-legacy-env.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const dotenv = require('dotenv');

const { KEY_GROUPS, selectKeys, planCopy, parseArgs } = require('./copy-legacy-env.js');

const SOURCE = [
  '# legacy secrets',
  'CLOUDFLARE_TOKEN=cf-secret-123',
  'SENDGRID_API_KEY="sg-secret"',
  'MULTILINE_KEY="line one',
  'line two"',
  '',
  'NAMECHEAP_API_KEY=nc-secret',
  'NAMECHEAP_USERNAME=ian',
].join('\n');

module.exports = defineCases({
  type: 'group',
  description: 'copy-legacy-env',
  tests: [
    {
      name: 'selectKeys: core by default, groups add, --only wins',
      run: (ctx) => {
        ctx.expect(selectKeys({})).toEqual(KEY_GROUPS.core);
        ctx.expect(selectKeys({ include: 'signing' }).includes('APPLE_TEAM_ID')).toBeTruthy();
        ctx.expect(selectKeys({ include: 'signing,stores' }).includes('CHROME_CLIENT_ID')).toBeTruthy();
        ctx.expect(selectKeys({ only: 'CLOUDFLARE_TOKEN, GH_TOKEN' })).toEqual(['CLOUDFLARE_TOKEN', 'GH_TOKEN']);
        ctx.expect(() => selectKeys({ include: 'payment' })).toThrow(/Unknown group/);
      },
    },

    {
      name: 'planCopy: copies missing, keeps existing, reports absent-in-source',
      run: (ctx) => {
        const dest = 'GOOGLE_CLIENT_ID=existing\nCLOUDFLARE_TOKEN=old-token\n';
        const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN', 'SENDGRID_API_KEY', 'BEEHIIV_API_KEY']);

        const byKey = Object.fromEntries(plan.actions.map((a) => [a.key, a.action]));
        ctx.expect(byKey.CLOUDFLARE_TOKEN).toBe('kept');
        ctx.expect(byKey.SENDGRID_API_KEY).toBe('copied');
        ctx.expect(byKey.BEEHIIV_API_KEY).toBe('missing');

        ctx.expect(plan.changed).toBeTruthy();
        ctx.expect(plan.content.includes('CLOUDFLARE_TOKEN=old-token')).toBeTruthy(); // untouched
        ctx.expect(plan.content.includes('SENDGRID_API_KEY="sg-secret"')).toBeTruthy();
      },
    },

    {
      name: 'planCopy: --force replaces in place, no duplicate key lines',
      run: (ctx) => {
        const dest = 'CLOUDFLARE_TOKEN=old-token\nOTHER=x\n';
        const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN'], { force: true });

        ctx.expect(plan.actions[0].action).toBe('replaced');
        ctx.expect(plan.content).toBe('CLOUDFLARE_TOKEN="cf-secret-123"\nOTHER=x\n');
        ctx.expect(plan.content.match(/CLOUDFLARE_TOKEN=/g).length).toBe(1);
      },
    },

    {
      name: 'planCopy: fully-satisfied destination is a no-op (idempotent)',
      run: (ctx) => {
        const dest = 'CLOUDFLARE_TOKEN=already\n';
        const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN']);
        ctx.expect(plan.changed).toBe(false);
        ctx.expect(plan.content).toBe(dest);
      },
    },

    {
      name: 'multi-line values copy as one line that reads back whole',
      run: (ctx) => {
        const plan = planCopy(SOURCE, '', ['MULTILINE_KEY']);
        ctx.expect(plan.content).toBe('MULTILINE_KEY="line one\\nline two"\n');
        ctx.expect(dotenv.parse(plan.content).MULTILINE_KEY).toBe('line one\nline two');
      },
    },

    {
      name: 'planCopy: an empty source value is not there to copy',
      run: (ctx) => {
        const plan = planCopy('CLOUDFLARE_TOKEN=""\n', 'CLOUDFLARE_TOKEN="real"\n', ['CLOUDFLARE_TOKEN'], { force: true });
        ctx.expect(plan.actions[0].action).toBe('missing');
        ctx.expect(plan.changed).toBe(false);
      },
    },

    {
      name: 'planCopy: --force copies $ patterns in a secret literally',
      run: (ctx) => {
        const source = 'CLOUDFLARE_TOKEN="a$$b"\nSENDGRID_API_KEY="c$&d"\n';
        const dest = 'CLOUDFLARE_TOKEN="old-token"\nSENDGRID_API_KEY="old-key"\n';
        const plan = planCopy(source, dest, ['CLOUDFLARE_TOKEN', 'SENDGRID_API_KEY'], { force: true });

        const read = dotenv.parse(plan.content);
        ctx.expect(read.CLOUDFLARE_TOKEN).toBe('a$$b');
        ctx.expect(read.SENDGRID_API_KEY).toBe('c$&d');
      },
    },

    {
      name: 'planCopy: a # KEY="" placeholder takes the value on its own line',
      run: (ctx) => {
        const dest = '# CLOUDFLARE_TOKEN=""\nOTHER="x"\n';
        const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN']);

        ctx.expect(plan.actions[0].action).toBe('copied');
        ctx.expect(plan.content).toBe('CLOUDFLARE_TOKEN="cf-secret-123"\nOTHER="x"\n');
      },
    },

    {
      name: 'planCopy: an empty destination value never claims the key',
      run: (ctx) => {
        const plan = planCopy(SOURCE, 'CLOUDFLARE_TOKEN=""\n', ['CLOUDFLARE_TOKEN']);

        ctx.expect(plan.actions[0].action).toBe('copied');
        ctx.expect(plan.content).toBe('CLOUDFLARE_TOKEN="cf-secret-123"\n');
      },
    },

    {
      name: 'planCopy: a source value envLine refuses throws naming the key',
      run: (ctx) => {
        const source = "CLOUDFLARE_TOKEN='a\\nb'\n";
        ctx.expect(() => planCopy(source, '', ['CLOUDFLARE_TOKEN'])).toThrow(/CLOUDFLARE_TOKEN/);
      },
    },

    {
      name: 'parseArgs: defaults + every flag form',
      run: (ctx) => {
        const args = parseArgs(['--brand=brands/x', '--force', '--dry-run', '--include=signing', '--source=/tmp/e']);
        ctx.expect(args.brand).toBe('brands/x');
        ctx.expect(args.force).toBe(true);
        ctx.expect(args.dryRun).toBe(true);
        ctx.expect(args.include).toBe('signing');
        ctx.expect(args.source).toBe('/tmp/e');
        ctx.expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);

        const defaults = parseArgs([]);
        ctx.expect(defaults.brand).toBe('brands/playground-omega');
        ctx.expect(defaults.source).toMatch(/omega-manager\/\.env$/);
      },
    },

    {
      name: 'action labels never include values — only key names reach stdout',
      run: (ctx) => {
        // The printing path only ever interpolates ACTION_LABELS[action] and key;
        // this guards the plan structure that feeds it: actions carry key+action
        // ONLY, no value field to leak.
        const plan = planCopy(SOURCE, '', ['CLOUDFLARE_TOKEN']);
        ctx.expect(Object.keys(plan.actions[0]).sort()).toEqual(['action', 'key']);
      },
    },
  ],
});
