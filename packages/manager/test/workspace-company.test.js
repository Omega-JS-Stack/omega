/**
 * The workspace service's company operation (#677): the ONE key that joins a
 * brand to its company is asked on the manage walk when the brand's file
 * carries none, in the same words the onboard wizard uses, and the answer
 * lands as the top-level `company: { id }` with the file's comments intact.
 *
 * Real files, real prompts over fake TTY streams — nothing mocked.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

const companyOp = require('../src/services/workspace/ensure/company.js');
const { validateCompanyId } = require('../src/lib/company-question.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const AUTHORED = `// Fixture Brand — the owner's own file, comments and all.
{
  brand: { id: 'fixture-brand', name: 'Fixture Brand' },
  targets: { web: { type: 'web' } },
}
`;

function stageBrand(config = AUTHORED) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-workspace-company-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config);
  return root;
}

function readConfig(root) {
  return JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
}

function opContext(root, overrides = {}) {
  return { brandRoot: root, brandConfig: readConfig(root), options: {}, ...overrides };
}

module.exports = defineCases({
  type: 'group',
  description: 'workspace-company',
  tests: [
    {
      name: 'company op: the answer lands as the top-level key, comments intact',
      run: async (ctx) => {
        const root = stageBrand();
        const tty = openTtyPrompt();
        ctx.after(() => tty.close());

        const run = companyOp(opContext(root));
        await tty.answer('Company brand id', 'itw-creative-works\r');
        const result = await run;

        ctx.expect(result.output.company).toEqual({ id: 'itw-creative-works' });
        ctx.expect(readConfig(root).company).toEqual({ id: 'itw-creative-works' });

        const file = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');
        ctx.expect(file, 'the comment-preserving editor wrote it').toMatch(/^\/\/ Fixture Brand — the owner's own file/);
      },
    },

    {
      name: 'company op: a blank answer is the standalone brand — nothing written',
      run: async (ctx) => {
        const root = stageBrand();
        const before = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');
        const tty = openTtyPrompt();
        ctx.after(() => tty.close());

        const run = companyOp(opContext(root));
        await tty.answer('Company brand id', '\r');

        ctx.expect(await run).toBe(null);
        ctx.expect(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8')).toBe(before);
      },
    },

    {
      name: 'company op: an authored key is never re-asked, and a headless run never asks at all',
      run: async (ctx) => {
        const answered = stageBrand(AUTHORED.replace('  brand:', "  company: { id: 'self' },\n  brand:"));
        ctx.expect(await companyOp(opContext(answered)), 'answered: nothing to do').toBe(null);

        // No TTY here (and none in CI): the question is pending, the walk goes on
        const unanswered = stageBrand();
        const before = fs.readFileSync(path.join(unanswered, 'config', 'omega.json5'), 'utf8');
        ctx.expect(await companyOp(opContext(unanswered))).toBe(null);
        ctx.expect(fs.readFileSync(path.join(unanswered, 'config', 'omega.json5'), 'utf8')).toBe(before);

        // A brand with no config at all is the config operation's report, not ours
        ctx.expect(await companyOp(opContext(unanswered, { brandRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bare-')) }))).toBe(null);
      },
    },

    {
      name: 'company: the one answer rule — a brand id, "self", or blank',
      run: (ctx) => {
        ctx.expect(validateCompanyId('itw-creative-works')).toBe(true);
        ctx.expect(validateCompanyId('self')).toBe(true);
        ctx.expect(validateCompanyId('  '), 'blank is the standalone brand').toBe(true);
        ctx.expect(validateCompanyId('Itw Creative Works')).toMatch(/Must be a brand id/);
        ctx.expect(validateCompanyId('9lives')).toMatch(/"self", or blank/);
      },
    },
  ],
});
