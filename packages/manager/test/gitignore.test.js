// Tests for src/lib/gitignore.js and the workspace `gitignore` op: the brand
// root and company root .gitignore speak the one marker engine, a Default
// section the framework rewrites on every manage and a Custom section kept
// verbatim. Real files in a temp dir, no mocks.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ensureGitignore, renderBrandGitignore, renderCompanyGitignore } = require('../src/lib/gitignore.js');
const gitignoreOp = require('../src/services/workspace/ensure/gitignore.js');

const DEFAULT = '# ========== Default Values ==========';
const CUSTOM = '# ========== Custom Values ==========';
const EM_DASH = String.fromCharCode(0x2014);
const PRIVATE_SETTINGS = '.claude/settings.local.json';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gitignore-'));
}

function readGitignore(root) {
  return fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
}

// The Default half's entries (comments and blanks dropped) and the Custom half.
function halves(contents) {
  const [head, custom] = contents.split(`${CUSTOM}\n`);
  const entries = head.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return { entries, custom };
}

// A brand born before the markers: the scaffold's old file plus the appender's
// blocks, em-dash headers and all.
const UNMARKED_BRAND = [
  '# Dependencies',
  'node_modules/',
  '',
  `# OMEGA manager state (derived data ${EM_DASH} never committed)`,
  '.omega/',
  '',
  '# Secrets',
  '.env',
  '',
  `# Run logs (truncated on every launch ${EM_DASH} never committed)`,
  'logs/',
  '',
  `# Secrets ${EM_DASH} the environment overlays beside .env`,
  '.env.*',
  '',
].join('\n');

module.exports = defineCases({
  type: 'group',
  description: 'gitignore',
  tests: [
    // ─── The templates ───────────────────────────────────────────────────────────

    {
      name: 'gitignore: the brand template is the marked file: every framework entry under Default, Custom empty',
      run: (ctx) => {
        const contents = renderBrandGitignore();
        ctx.expect(contents.split('\n')[0]).toBe(DEFAULT);
        ctx.expect(contents.endsWith(`\n\n${CUSTOM}\n`), 'the Custom section is only its marker line').toBeTruthy();
        const { entries, custom } = halves(contents);
        ctx.expect(entries.filter((entry) => entry !== PRIVATE_SETTINGS)).toEqual(['node_modules/', 'dist/', '.omega/', 'logs/', 'test/e2e/.logs/', '.env', '.env.*', '.DS_Store']);
        ctx.expect(custom).toBe('');
        ctx.expect(contents.includes(EM_DASH), 'no em dash').toBe(false);
      },
    },

    {
      name: 'case 7: a scaffolded brand\'s .gitignore lists .claude/settings.local.json, and git ignores the file',
      run: (ctx) => {
        const { entries } = halves(renderBrandGitignore());
        ctx.expect(entries.filter((entry) => entry === PRIVATE_SETTINGS).length, 'listed once, in the Default section').toBe(1);

        // The private file names a path on one machine: git must never pick it up
        const root = tmpdir();
        spawnSync('git', ['init', '-q', root]);
        fs.writeFileSync(path.join(root, '.gitignore'), renderBrandGitignore());
        fs.mkdirSync(path.join(root, '.claude'));
        fs.writeFileSync(path.join(root, PRIVATE_SETTINGS), '{}\n');
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}\n');

        ctx.expect(spawnSync('git', ['-C', root, 'check-ignore', '-q', PRIVATE_SETTINGS]).status, 'the private file is ignored').toBe(0);
        ctx.expect(spawnSync('git', ['-C', root, 'check-ignore', '-q', '.claude/settings.json']).status, 'the committed file is not').toBe(1);
      },
    },

    {
      name: 'case 7: a brand scaffolded before the private file heals the entry into its Default section',
      run: (ctx) => {
        const root = tmpdir();
        const before = `${DEFAULT}\nnode_modules/\ndist/\n.omega/\nlogs/\ntest/e2e/.logs/\n.env\n.env.*\n.DS_Store\n\n${CUSTOM}\nmine/\n`;
        fs.writeFileSync(path.join(root, '.gitignore'), before);

        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('healed');
        const { entries, custom } = halves(readGitignore(root));
        ctx.expect(entries.includes(PRIVATE_SETTINGS)).toBeTruthy();
        ctx.expect(custom).toBe('mine/\n');
      },
    },

    {
      name: 'gitignore: the company template is the marked file with the unshareable half',
      run: (ctx) => {
        const contents = renderCompanyGitignore();
        ctx.expect(contents.split('\n')[0]).toBe(DEFAULT);
        ctx.expect(halves(contents)).toEqual({ entries: ['.env', '.env.*', '.omega/'], custom: '' });
      },
    },

    // ─── ensureGitignore ─────────────────────────────────────────────────────────

    {
      name: 'gitignore: a missing file is created from the template, then present',
      run: (ctx) => {
        const root = tmpdir();
        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('created');
        ctx.expect(readGitignore(root)).toBe(renderBrandGitignore());
        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('present');
      },
    },

    {
      name: 'gitignore: an unmarked brand file of framework lines only converges to the template',
      run: (ctx) => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.gitignore'), UNMARKED_BRAND);

        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('converged');
        ctx.expect(readGitignore(root), 'every old header and entry was the framework\'s').toBe(renderBrandGitignore());
        ctx.expect(ensureGitignore(root, renderBrandGitignore()), 'a second run writes nothing').toBe('present');
      },
    },

    {
      name: 'gitignore: an unmarked file keeps every consumer line under Custom, nothing duplicated',
      run: (ctx) => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest/e2e/.logs/\n\n# Omega manager state (durable IDs + per-run output)\n.omega/\n\n# my own\n*.log\n');

        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('converged');
        const contents = readGitignore(root);
        ctx.expect(contents).toBe(`${renderBrandGitignore()}# my own\n*.log\n`);
        for (const entry of ['node_modules/', 'test/e2e/.logs/']) {
          ctx.expect(contents.split('\n').filter((line) => line === entry).length, entry).toBe(1);
        }
        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('present');
      },
    },

    {
      name: 'gitignore: a marked file heals its Default section and keeps the Custom section verbatim',
      run: (ctx) => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.gitignore'), `${DEFAULT}\nnode_modules/\nretired-by-the-framework/\n\n${CUSTOM}\nmy-secret-dir/\n`);

        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('healed');
        ctx.expect(readGitignore(root)).toBe(`${renderBrandGitignore()}my-secret-dir/\n`);
        ctx.expect(ensureGitignore(root, renderBrandGitignore())).toBe('present');
      },
    },

    {
      name: 'gitignore: a dry run returns the verdict and writes nothing',
      run: (ctx) => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
        ctx.expect(ensureGitignore(root, renderBrandGitignore(), { dryRun: true })).toBe('converged');
        ctx.expect(readGitignore(root)).toBe('node_modules/\n');

        const empty = tmpdir();
        ctx.expect(ensureGitignore(empty, renderBrandGitignore(), { dryRun: true })).toBe('created');
        ctx.expect(fs.existsSync(path.join(empty, '.gitignore'))).toBe(false);
      },
    },

    // ─── The workspace op: the brand root and the company root ───────────────────

    {
      name: 'gitignore op: converges the brand root and the company root, each from its own template, then is a no-op',
      run: async (ctx) => {
        const brandRoot = tmpdir();
        const companyRoot = path.join(tmpdir(), 'company');
        fs.mkdirSync(companyRoot);
        fs.writeFileSync(path.join(brandRoot, '.gitignore'), UNMARKED_BRAND);
        fs.writeFileSync(path.join(companyRoot, '.gitignore'), '# Secrets: the shared .env and its per-environment overlays\n.env\n.env.*\n\n.omega/\nshared-scratch/\n');

        const logged = [];
        const log = console.log;
        console.log = (line) => logged.push(line);
        let result;
        try {
          result = await gitignoreOp({ brandRoot, companyRoot });
        } finally {
          console.log = log;
        }
        ctx.expect(result.output).toEqual({ gitignore: { brand: 'converged', company: 'converged' } });
        ctx.expect(logged.every((line) => !/undefined|Custom section kept/.test(line)), logged.join('\n')).toBeTruthy();
        ctx.expect(readGitignore(brandRoot)).toBe(renderBrandGitignore());
        ctx.expect(readGitignore(companyRoot)).toBe(`${renderCompanyGitignore()}shared-scratch/\n`);

        ctx.expect(await gitignoreOp({ brandRoot, companyRoot }), 'a second run writes nothing').toBe(null);
      },
    },

    {
      name: 'gitignore op: a brand with no company heals the brand root alone',
      run: async (ctx) => {
        const brandRoot = tmpdir();
        const result = await gitignoreOp({ brandRoot, companyRoot: null });
        ctx.expect(result.output).toEqual({ gitignore: { brand: 'created' } });
        ctx.expect(readGitignore(brandRoot)).toBe(renderBrandGitignore());
      },
    },

    {
      name: '#971: the workspace op under --dry-run plans the heal and writes nothing',
      run: async (ctx) => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');

        const result = await gitignoreOp({ brandRoot: root, options: { dryRun: true } });

        ctx.expect(readGitignore(root)).toBe('node_modules/\n');
        ctx.expect(result.output).toEqual({ gitignore: { brand: 'planned' } });
      },
    },
  ],
});
