/**
 * `omega update` core — classification, wanted-resolution, quarantine math
 * (injected clock), file:-spec skipping, install selection, and install-command
 * routing (npu vs npm). Registry lookups are FIXTURES — the suite never
 * touches the network.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const update = require('../src/update.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Frozen clock: 2026-07-21T00:00:00Z
const NOW = Date.UTC(2026, 6, 21);
const day = (daysAgo) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

// Registry fixture: name → packument-ish
const REGISTRY = {
  'stable-pkg': {
    latest: '1.4.2',
    versions: ['1.2.0', '1.2.3', '1.3.0', '1.4.0', '1.4.2', '2.0.0-beta.1'],
    time: { '1.4.2': day(120), '1.4.0': day(200) },
  },
  'fresh-pkg': {
    latest: '2.1.0',
    versions: ['2.0.0', '2.0.5', '2.1.0'],
    time: { '2.1.0': day(2), '2.0.5': day(90) },
  },
  'breaking-pkg': {
    latest: '3.0.0',
    versions: ['1.0.0', '1.1.0', '1.9.4', '3.0.0'],
    time: { '3.0.0': day(30), '1.9.4': day(400) },
  },
  'current-pkg': {
    latest: '5.5.5',
    versions: ['5.5.5'],
    time: { '5.5.5': day(1000) },
  },
  '@omega.js/web': {
    latest: '0.55.0',
    versions: ['0.54.1', '0.55.0'],
    time: { '0.55.0': day(1), '0.54.1': day(30) },
  },
  'day-old-pkg': {
    latest: '1.1.0',
    versions: ['1.0.0', '1.1.0'],
    time: { '1.1.0': day(1), '1.0.0': day(60) },
  },
};

const lookup = async (name) => {
  if (!REGISTRY[name]) throw new Error(`404 for ${name}`);
  return REGISTRY[name];
};

/** Stage a target dir with a package.json and optional installed copies. */
function stageTarget(manifest, installed = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-update-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [name, version] of Object.entries(installed)) {
    const pkgDir = path.join(dir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }));
  }
  return dir;
}

// ─── Apply selection ─────────────────────────────────────────────────────────

async function fixtureRows(minAge = 7) {
  const dir = stageTarget({
    name: 'sel',
    dependencies: { 'stable-pkg': '^1.2.3', 'fresh-pkg': '^2.0.0' },
    devDependencies: { 'breaking-pkg': '^1.0.0' },
  }, { 'stable-pkg': '1.2.3', 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0' });
  const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge });
  fs.rmSync(dir, { recursive: true, force: true });
  return report.rows;
}

// ─── The verb body ───────────────────────────────────────────────────────────

function collectLogger() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), warn: (line) => lines.push(`WARN ${line}`) };
}

// ─── The quarantine allowlist ────────────────────────────────────────────────

/** One run holding a family release and a third-party release, both 1 day old. */
async function familyReport() {
  const dir = stageTarget({
    name: 'family',
    dependencies: { '@omega.js/web': '0.54.1', 'day-old-pkg': '^1.0.0' },
  }, { '@omega.js/web': '0.54.1', 'day-old-pkg': '1.0.0' });
  const report = await update.buildUpdateReport({ dir, lookup, now: NOW });
  fs.rmSync(dir, { recursive: true, force: true });
  return report;
}

module.exports = defineCases({
  type: 'group',
  description: 'update',
  tests: [
    // ─── Version math ────────────────────────────────────────────────────────────

    {
      name: 'classifyBump: patch / minor / major / equal',
      run: (ctx) => {
        ctx.expect(update.classifyBump('1.2.3', '1.2.9')).toBe('patch');
        ctx.expect(update.classifyBump('1.2.3', '1.5.0')).toBe('minor');
        ctx.expect(update.classifyBump('1.2.3', '2.0.0')).toBe('major');
        ctx.expect(update.classifyBump('0.1.0', '0.2.0')).toBe('minor');
        ctx.expect(update.classifyBump('1.2.3', '1.2.3')).toBe(null);
        ctx.expect(update.classifyBump('nonsense', '1.0.0')).toBe(null);
      },
    },

    {
      name: 'compareVersions: ordering incl. prerelease-before-release',
      run: (ctx) => {
        ctx.expect(update.compareVersions('1.2.3', '1.10.0')).toBe(-1);
        ctx.expect(update.compareVersions('2.0.0-beta.1', '2.0.0')).toBe(-1);
        ctx.expect(update.compareVersions('2.0.0', '2.0.0')).toBe(0);
      },
    },

    {
      name: 'resolveWanted: caret / tilde / exact / star / x-range, prereleases excluded',
      run: (ctx) => {
        const versions = REGISTRY['stable-pkg'].versions;
        ctx.expect(update.resolveWanted('^1.2.0', versions)).toBe('1.4.2');
        ctx.expect(update.resolveWanted('~1.2.0', versions)).toBe('1.2.3');
        ctx.expect(update.resolveWanted('1.3.0', versions)).toBe('1.3.0');
        ctx.expect(update.resolveWanted('*', versions), 'star never picks the 2.0.0-beta.1 prerelease').toBe('1.4.2');
        ctx.expect(update.resolveWanted('1.2.x', versions)).toBe('1.2.3');
        ctx.expect(update.resolveWanted('1', versions)).toBe('1.4.2');
      },
    },

    {
      name: 'resolveWanted: 0.x caret pins the minor',
      run: (ctx) => {
        const versions = ['0.2.0', '0.2.9', '0.3.0'];
        ctx.expect(update.resolveWanted('^0.2.0', versions)).toBe('0.2.9');
      },
    },

    {
      name: 'highestWithin: patch / minor / latest tiers',
      run: (ctx) => {
        const versions = REGISTRY['breaking-pkg'].versions;
        ctx.expect(update.highestWithin(versions, '1.0.0', 'patch')).toBe('1.0.0');
        ctx.expect(update.highestWithin(versions, '1.0.0', 'minor')).toBe('1.9.4');
        ctx.expect(update.highestWithin(versions, '1.0.0', 'latest')).toBe('3.0.0');
      },
    },

    {
      name: 'isRegistrySpec: file/link/git/url/shorthand specs are non-registry',
      run: (ctx) => {
        for (const spec of ['file:../../omega/packages/web', 'link:../x', 'workspace:*', 'git+https://x.test/r.git', 'github:o/r', 'https://x.test/a.tgz', 'owner/repo']) {
          ctx.expect(update.isRegistrySpec(spec), spec).toBe(false);
        }
        for (const spec of ['^1.2.3', '~0.0.1', '1.2.3', '*', 'latest']) {
          ctx.expect(update.isRegistrySpec(spec), spec).toBe(true);
        }
      },
    },

    // ─── Report ──────────────────────────────────────────────────────────────────

    {
      name: 'buildUpdateReport: rows classify, quarantine flags, file: specs skipped',
      run: async (ctx) => {
        const dir = stageTarget({
          name: 'fixture-target',
          dependencies: {
            'stable-pkg': '^1.2.3',
            'fresh-pkg': '^2.0.0',
            '@omega.js/web': 'file:../../omega/packages/web',
          },
          devDependencies: {
            'breaking-pkg': '^1.0.0',
            'current-pkg': '^5.5.5',
          },
        }, { 'stable-pkg': '1.2.3', 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0', 'current-pkg': '5.5.5' });

        const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge: 7 });

        ctx.expect(report.project).toBe('fixture-target');
        ctx.expect(report.locals).toEqual([{ name: '@omega.js/web', group: 'prod', spec: 'file:../../omega/packages/web' }]);

        const names = report.rows.map((row) => row.name);
        ctx.expect(!names.includes('current-pkg'), 'fully-current dep does not clutter the report').toBeTruthy();
        ctx.expect(!names.includes('@omega.js/web'), 'file: spec never reaches the registry').toBeTruthy();

        const stable = report.rows.find((row) => row.name === 'stable-pkg');
        ctx.expect(stable.installed).toBe('1.2.3');
        ctx.expect(stable.wanted).toBe('1.4.2');
        ctx.expect(stable.latest).toBe('1.4.2');
        ctx.expect(stable.bump).toBe('minor');
        ctx.expect(stable.quarantined, '120-day-old release is not fresh').toBe(false);
        ctx.expect(stable.group).toBe('prod');

        const fresh = report.rows.find((row) => row.name === 'fresh-pkg');
        ctx.expect(fresh.ageDays).toBe(2);
        ctx.expect(fresh.quarantined, '2-day-old latest is quarantined at min-age 7').toBe(true);

        const breaking = report.rows.find((row) => row.name === 'breaking-pkg');
        ctx.expect(breaking.bump).toBe('major');
        ctx.expect(breaking.minorTarget).toBe('1.9.4');
        ctx.expect(breaking.group).toBe('dev');

        // prod rows sort before dev rows
        ctx.expect(names.indexOf('fresh-pkg') < names.indexOf('breaking-pkg'), 'prod group first').toBeTruthy();

        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'buildUpdateReport: quarantine clears once installed matches latest, and at min-age 0',
      run: async (ctx) => {
        const dir = stageTarget({ name: 'x', dependencies: { 'fresh-pkg': '^2.1.0' } }, { 'fresh-pkg': '2.1.0' });
        const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge: 7 });
        ctx.expect(report.rows.length, 'installed latest = nothing to report').toBe(0);

        const dir2 = stageTarget({ name: 'y', dependencies: { 'fresh-pkg': '^2.0.0' } }, { 'fresh-pkg': '2.0.5' });
        const report2 = await update.buildUpdateReport({ dir: dir2, lookup, now: NOW, minAge: 0 });
        ctx.expect(report2.rows[0].quarantined, 'min-age 0 disables the quarantine').toBe(false);

        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(dir2, { recursive: true, force: true });
      },
    },

    {
      name: 'buildUpdateReport: lookup failure surfaces as a row error, not a crash',
      run: async (ctx) => {
        const dir = stageTarget({ name: 'z', dependencies: { 'missing-pkg': '^1.0.0' } });
        const report = await update.buildUpdateReport({ dir, lookup, now: NOW });
        ctx.expect(report.rows[0].error).toBe('404 for missing-pkg');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'selectUpdates: default = non-breaking + non-quarantined; majors and fresh releases held',
      run: async (ctx) => {
        const rows = await fixtureRows();
        const selection = update.selectUpdates(rows, { minAge: 7, now: NOW });

        ctx.expect(selection.updates, 'minor tier applies; breaking-pkg rides to its same-major top, never 3.0.0').toEqual([
          { name: 'stable-pkg', group: 'prod', from: '1.2.3', to: '1.4.2', bump: 'minor' },
          { name: 'breaking-pkg', group: 'dev', from: '1.0.0', to: '1.9.4', bump: 'minor' },
        ]);

        ctx.expect(selection.quarantined.length).toBe(1);
        ctx.expect(selection.quarantined[0].name).toBe('fresh-pkg');
        ctx.expect(selection.quarantined[0].ageDays).toBe(2);

        ctx.expect(selection.majorsHeld).toEqual([{ name: 'breaking-pkg', from: '1.0.0', to: '3.0.0' }]);
      },
    },

    {
      name: 'selectUpdates: --major unlocks latest; --min-age 0 releases the quarantine',
      run: async (ctx) => {
        const rows = await fixtureRows();
        const withMajor = update.selectUpdates(rows, { major: true, minAge: 7, now: NOW });
        const breaking = withMajor.updates.find((entry) => entry.name === 'breaking-pkg');
        ctx.expect(breaking).toEqual({ name: 'breaking-pkg', group: 'dev', from: '1.0.0', to: '3.0.0', bump: 'major' });
        ctx.expect(withMajor.majorsHeld.length).toBe(0);

        const forced = update.selectUpdates(rows, { minAge: 0, now: NOW });
        ctx.expect(forced.updates.some((entry) => entry.name === 'fresh-pkg' && entry.to === '2.1.0'), 'quarantine lifted').toBeTruthy();
        ctx.expect(forced.quarantined.length).toBe(0);
      },
    },

    // ─── Install command routing ─────────────────────────────────────────────────

    {
      name: 'buildInstallCommands: npu when present, npm otherwise; dev group gets --save-dev',
      run: (ctx) => {
        const updates = [
          { name: 'a', group: 'prod', from: '1.0.0', to: '1.1.0' },
          { name: 'b', group: 'dev', from: '2.0.0', to: '2.0.1' },
        ];
        ctx.expect(update.buildInstallCommands(updates, { hasNpu: true })).toEqual([
          { command: 'npu install a@1.1.0', group: 'prod' },
          { command: 'npu install b@2.0.1 --save-dev', group: 'dev' },
        ]);
        ctx.expect(update.buildInstallCommands(updates, { hasNpu: false })[0].command).toEqual('npm install a@1.1.0');
      },
    },

    {
      name: 'buildInstallCommands: an @omega.js dep installs --save-exact — the family pin survives its own mover (#794)',
      run: (ctx) => {
        const updates = [
          { name: 'a', group: 'prod', from: '1.0.0', to: '1.1.0' },
          { name: '@omega.js/web', group: 'prod', from: '0.4.0', to: '0.5.0' },
          { name: '@omega.js/manager', group: 'dev', from: '0.4.0', to: '0.5.0' },
        ];

        ctx.expect(update.buildInstallCommands(updates, { hasNpu: false })).toEqual([
          { command: 'npm install a@1.1.0', group: 'prod' },
          { command: 'npm install @omega.js/web@0.5.0 --save-exact', group: 'prod' },
          { command: 'npm install @omega.js/manager@0.5.0 --save-dev --save-exact', group: 'dev' },
        ]);
      },
    },

    {
      name: 'runUpdate --dry-run: reports and installs nothing, no exec ever fires',
      run: async (ctx) => {
        const dir = stageTarget({ name: 'ro', dependencies: { 'stable-pkg': '^1.2.3' } }, { 'stable-pkg': '1.2.3' });
        const logger = collectLogger();
        const calls = [];

        const result = await update.runUpdate({
          dir, logger, lookup, now: NOW, dryRun: true,
          execFn: (cmd) => calls.push(cmd),
          hasNpu: true,
        });

        ctx.expect(calls.length, 'a dry run never installs').toBe(0);
        ctx.expect(result.selection).toBe(null);
        ctx.expect(logger.lines.some((line) => line.includes('stable-pkg')), 'table row printed').toBeTruthy();
        ctx.expect(logger.lines.some((line) => line.includes('--dry-run') && line.includes('`omega update` installs')), 'dry-run hint names what a bare run does').toBeTruthy();
        ctx.expect(!logger.lines.some((line) => line.includes('--apply')), 'no retired switch in the output').toBeTruthy();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'runUpdate bare: installs via npu, holds quarantined + majors, warns on missing npu',
      run: async (ctx) => {
        const dir = stageTarget({
          name: 'ap',
          dependencies: { 'stable-pkg': '^1.2.3', 'fresh-pkg': '^2.0.0' },
          devDependencies: { 'breaking-pkg': '^1.0.0' },
        }, { 'stable-pkg': '1.2.3', 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0' });

        const logger = collectLogger();
        const calls = [];
        const result = await update.runUpdate({
          dir, logger, lookup, now: NOW, hasNpu: true,
          execFn: (cmd, opts) => calls.push({ cmd, cwd: opts.cwd }),
        });

        ctx.expect(calls.map((call) => call.cmd)).toEqual([
          'npu install stable-pkg@1.4.2',
          'npu install breaking-pkg@1.9.4 --save-dev',
        ]);
        ctx.expect(calls[0].cwd, 'installs run in the target dir').toBe(dir);
        ctx.expect(logger.lines.some((line) => line.startsWith('WARN held fresh-pkg@2.1.0')), 'quarantine hold logged').toBeTruthy();
        ctx.expect(logger.lines.some((line) => line.includes('--major to include')), 'major hold logged').toBeTruthy();
        ctx.expect(result.selection.updates.length).toBe(2);

        // npm fallback path warns loudly
        const logger2 = collectLogger();
        const calls2 = [];
        await update.runUpdate({
          dir, logger: logger2, lookup, now: NOW, hasNpu: false,
          execFn: (cmd) => calls2.push(cmd),
        });
        ctx.expect(calls2.every((cmd) => cmd.startsWith('npm install')), 'plain npm fallback').toBeTruthy();
        ctx.expect(logger2.lines.some((line) => line.includes('WITHOUT the Socket supply-chain firewall')), 'loud note').toBeTruthy();

        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'runUpdate --force-fresh: quarantined release installs',
      run: async (ctx) => {
        const dir = stageTarget({ name: 'ff', dependencies: { 'fresh-pkg': '^2.0.0' } }, { 'fresh-pkg': '2.0.5' });
        const calls = [];
        await update.runUpdate({
          dir, logger: collectLogger(), lookup, now: NOW,
          forceFresh: true, hasNpu: true,
          execFn: (cmd) => calls.push(cmd),
        });
        ctx.expect(calls).toEqual(['npu install fresh-pkg@2.1.0']);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'formatReport: QUARANTINED status + legends + local skips',
      run: async (ctx) => {
        const dir = stageTarget({
          name: 'fmt',
          dependencies: { 'fresh-pkg': '^2.0.0', 'breaking-pkg': '^1.0.0', '@omega.js/web': 'file:../x' },
        }, { 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0' });
        const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge: 7 });
        const lines = update.formatReport(report, { minAge: 7 });

        ctx.expect(lines.some((line) => line.includes('fresh-pkg') && line.includes('QUARANTINED'))).toBeTruthy();
        ctx.expect(lines.some((line) => line.includes('QUARANTINED = latest published < 7 days ago'))).toBeTruthy();
        ctx.expect(lines.some((line) => line.includes('major = breaking'))).toBeTruthy();
        ctx.expect(lines.some((line) => line.includes('skipped @omega.js/web (file:../x)'))).toBeTruthy();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'QUARANTINE_EXEMPT: the one allowlist holds the @omega.js family alone',
      run: (ctx) => {
        ctx.expect(update.QUARANTINE_EXEMPT).toEqual(['@omega.js/*']);
      },
    },

    {
      name: 'isQuarantineExempt: a name under the scope matches; a look-alike scope or bare name does not',
      run: (ctx) => {
        ctx.expect(update.isQuarantineExempt('@omega.js/web')).toBe(true);
        ctx.expect(update.isQuarantineExempt('@omega.js/manager')).toBe(true);
        ctx.expect(update.isQuarantineExempt('@omega.jsx/web')).toBe(false);
        ctx.expect(update.isQuarantineExempt('omega.js')).toBe(false);
      },
    },

    {
      name: 'buildUpdateReport: a 1-day-old family release is never QUARANTINED',
      run: async (ctx) => {
        const report = await familyReport();

        const family = report.rows.find((row) => row.name === '@omega.js/web');
        ctx.expect(family.latest).toBe('0.55.0');
        ctx.expect(family.ageDays).toBe(1);
        ctx.expect(family.quarantined, 'the family is exempt from the age hold').toBe(false);

        const lines = update.formatReport(report, { minAge: 7 });
        const familyLines = lines.filter((line) => line.includes('@omega.js/web') && line.includes('0.55.0'));
        ctx.expect(familyLines.length > 0, 'the family row prints').toBeTruthy();
        ctx.expect(familyLines.every((line) => !line.includes('QUARANTINED')), 'and never as QUARANTINED').toBeTruthy();
      },
    },

    {
      name: 'selectUpdates: the 1-day-old family release installs at the default min-age',
      run: async (ctx) => {
        const { rows } = await familyReport();
        const selection = update.selectUpdates(rows, { now: NOW });

        ctx.expect(selection.updates.some((entry) => entry.name === '@omega.js/web' && entry.to === '0.55.0'), 'the family moves').toBeTruthy();
        ctx.expect(!selection.quarantined.some((entry) => entry.name === '@omega.js/web'), 'and is not held').toBeTruthy();
      },
    },

    {
      name: 'a 1-day-old third-party release in the same run is still held',
      run: async (ctx) => {
        const report = await familyReport();

        const thirdParty = report.rows.find((row) => row.name === 'day-old-pkg');
        ctx.expect(thirdParty.quarantined, 'the exemption never reaches a third-party package').toBe(true);

        const selection = update.selectUpdates(report.rows, { now: NOW });
        ctx.expect(selection.quarantined.some((entry) => entry.name === 'day-old-pkg'), 'listed as held').toBeTruthy();
        ctx.expect(!selection.updates.some((entry) => entry.name === 'day-old-pkg'), 'and not installed').toBeTruthy();
      },
    },

    {
      name: 'formatReport: with a held row, the legend names the exempt family',
      run: async (ctx) => {
        // No @omega.js row or local in this run, so any line naming the family is the legend
        const dir = stageTarget({ name: 'legend', dependencies: { 'fresh-pkg': '^2.0.0' } }, { 'fresh-pkg': '2.0.5' });
        const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge: 7 });
        const lines = update.formatReport(report, { minAge: 7 });

        ctx.expect(lines.some((line) => line.includes('fresh-pkg') && line.includes('QUARANTINED')), 'a held row').toBeTruthy();
        ctx.expect(lines.some((line) => line.includes('@omega.js')), `the legend names the family:\n${lines.join('\n')}`).toBeTruthy();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },
  ],
});
