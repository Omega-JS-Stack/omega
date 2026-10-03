/**
 * The template takeover rule: onboard never overwrites a file a person wrote,
 * except a file that carries the template marker, which it replaces with the
 * generated one. The generated files carry no marker, so a rerun changes nothing.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TEMPLATE_COMMENT, carriesTemplateMarker } = require('../src/lib/template-marker.js');
const { buildScaffoldPlan, applyScaffoldPlan } = require('../src/lib/scaffold.js');
const { TEMPLATE_PACKAGE, TEMPLATE_README, stageTemplate } = require('./lib/brand-template.js');

const MANAGER_VERSION = require('../package.json').version;

const ANSWERS = {
  id: 'acme',
  name: 'Acme',
  url: 'https://acme.test',
  email: 'hi@acme.test',
  targets: [{ name: 'web', type: 'web' }],
};

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'omega-template-marker-'));
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

module.exports = defineCases({
  type: 'group',
  description: 'template-marker',
  tests: [
    // ─── The marker ──────────────────────────────────────────────────────────────

    {
      name: '#1023 marker: the README marker is the hidden comment <!-- omega:template -->',
      run: (ctx) => {
        ctx.expect(TEMPLATE_COMMENT).toBe('<!-- omega:template -->');
      },
    },

    {
      name: '#1023 marker: a package.json carries it as "omega": { "template": true }, and a hand-written one does not',
      run: (ctx) => {
        ctx.expect(carriesTemplateMarker('package.json', JSON.stringify(TEMPLATE_PACKAGE, null, 2))).toBe(true);
        ctx.expect(carriesTemplateMarker('package.json', JSON.stringify({ name: 'mine', private: true }))).toBe(false);
      },
    },

    {
      name: '#1023 marker: a README carries it only as its first line',
      run: (ctx) => {
        ctx.expect(carriesTemplateMarker('README.md', TEMPLATE_README)).toBe(true);
        ctx.expect(carriesTemplateMarker('README.md', '# My brand\n\nWritten by hand.\n')).toBe(false);
        ctx.expect(carriesTemplateMarker('README.md', '# My brand\n\n<!-- omega:template -->\n')).toBe(false);
      },
    },

    // ─── The takeover ────────────────────────────────────────────────────────────

    {
      name: '#1023 case 1: a package.json carrying the marker is replaced by the generated one',
      run: (ctx) => {
        const root = stageTemplate(tempDir());

        const result = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        ctx.expect(result.replaced.includes('package.json'), `package.json is reported replaced: ${JSON.stringify(result.replaced)}`).toBeTruthy();
        ctx.expect(!result.kept.includes('package.json')).toBeTruthy();
        const pkg = JSON.parse(read(root, 'package.json'));
        ctx.expect(pkg.name).toBe('acme');
        ctx.expect(pkg.workspaces).toEqual(['targets/*']);
        ctx.expect(pkg.devDependencies).toEqual({ '@omega.js/manager': MANAGER_VERSION });
        ctx.expect(pkg.scripts.start).toBe('omega dev');
        ctx.expect(!('omega' in pkg), 'the generated package.json carries no marker').toBeTruthy();
      },
    },

    {
      name: '#1023 case 2: a README whose first line is the marker is replaced by the brand\'s README',
      run: (ctx) => {
        const root = stageTemplate(tempDir());

        const result = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        ctx.expect(result.replaced.includes('README.md'), `README.md is reported replaced: ${JSON.stringify(result.replaced)}`).toBeTruthy();
        const readme = read(root, 'README.md');
        ctx.expect(readme.startsWith('# Acme'), `the brand's own README: ${readme.slice(0, 80)}`).toBeTruthy();
        ctx.expect(!readme.includes('<!-- omega:template -->')).toBeTruthy();
      },
    },

    {
      name: '#1023 case 3: a hand-written package.json and README are kept byte for byte',
      run: (ctx) => {
        const root = tempDir();
        const pkg = '{\n  "name": "hand-written",\n  "private": true\n}\n';
        const readme = '# Hand written\n\nMine.\n';
        fs.writeFileSync(path.join(root, 'package.json'), pkg);
        fs.writeFileSync(path.join(root, 'README.md'), readme);

        const result = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        ctx.expect(result.replaced).toEqual([]);
        ctx.expect(result.kept.includes('package.json')).toBeTruthy();
        ctx.expect(result.kept.includes('README.md')).toBeTruthy();
        ctx.expect(read(root, 'package.json')).toBe(pkg);
        ctx.expect(read(root, 'README.md')).toBe(readme);
      },
    },

    {
      name: '#1023 case 4: a second run on the generated brand replaces nothing and creates nothing',
      run: (ctx) => {
        const root = stageTemplate(tempDir());
        applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));
        const before = [read(root, 'package.json'), read(root, 'README.md')];

        const rerun = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        ctx.expect(rerun.replaced).toEqual([]);
        ctx.expect(rerun.created).toEqual([]);
        ctx.expect([read(root, 'package.json'), read(root, 'README.md')]).toEqual(before);
      },
    },
  ],
});
