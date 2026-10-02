/**
 * The template takeover rule: onboard never overwrites a file a person wrote,
 * except a file that carries the template marker, which it replaces with the
 * generated one. The generated files carry no marker, so a rerun changes nothing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
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

// ─── The marker ──────────────────────────────────────────────────────────────

test('#1023 marker: the README marker is the hidden comment <!-- omega:template -->', () => {
  assert.equal(TEMPLATE_COMMENT, '<!-- omega:template -->');
});

test('#1023 marker: a package.json carries it as "omega": { "template": true }, and a hand-written one does not', () => {
  assert.equal(carriesTemplateMarker('package.json', JSON.stringify(TEMPLATE_PACKAGE, null, 2)), true);
  assert.equal(carriesTemplateMarker('package.json', JSON.stringify({ name: 'mine', private: true })), false);
});

test('#1023 marker: a README carries it only as its first line', () => {
  assert.equal(carriesTemplateMarker('README.md', TEMPLATE_README), true);
  assert.equal(carriesTemplateMarker('README.md', '# My brand\n\nWritten by hand.\n'), false);
  assert.equal(carriesTemplateMarker('README.md', '# My brand\n\n<!-- omega:template -->\n'), false);
});

// ─── The takeover ────────────────────────────────────────────────────────────

test('#1023 case 1: a package.json carrying the marker is replaced by the generated one', () => {
  const root = stageTemplate(tempDir());

  const result = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  assert.ok(result.replaced.includes('package.json'), `package.json is reported replaced: ${JSON.stringify(result.replaced)}`);
  assert.ok(!result.kept.includes('package.json'));
  const pkg = JSON.parse(read(root, 'package.json'));
  assert.equal(pkg.name, 'acme');
  assert.deepEqual(pkg.workspaces, ['targets/*']);
  assert.deepEqual(pkg.devDependencies, { '@omega.js/manager': MANAGER_VERSION });
  assert.equal(pkg.scripts.start, 'omega dev');
  assert.ok(!('omega' in pkg), 'the generated package.json carries no marker');
});

test('#1023 case 2: a README whose first line is the marker is replaced by the brand\'s README', () => {
  const root = stageTemplate(tempDir());

  const result = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  assert.ok(result.replaced.includes('README.md'), `README.md is reported replaced: ${JSON.stringify(result.replaced)}`);
  const readme = read(root, 'README.md');
  assert.ok(readme.startsWith('# Acme'), `the brand's own README: ${readme.slice(0, 80)}`);
  assert.ok(!readme.includes('<!-- omega:template -->'));
});

test('#1023 case 3: a hand-written package.json and README are kept byte for byte', () => {
  const root = tempDir();
  const pkg = '{\n  "name": "hand-written",\n  "private": true\n}\n';
  const readme = '# Hand written\n\nMine.\n';
  fs.writeFileSync(path.join(root, 'package.json'), pkg);
  fs.writeFileSync(path.join(root, 'README.md'), readme);

  const result = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  assert.deepEqual(result.replaced, []);
  assert.ok(result.kept.includes('package.json'));
  assert.ok(result.kept.includes('README.md'));
  assert.equal(read(root, 'package.json'), pkg);
  assert.equal(read(root, 'README.md'), readme);
});

test('#1023 case 4: a second run on the generated brand replaces nothing and creates nothing', () => {
  const root = stageTemplate(tempDir());
  applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));
  const before = [read(root, 'package.json'), read(root, 'README.md')];

  const rerun = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  assert.deepEqual(rerun.replaced, []);
  assert.deepEqual(rerun.created, []);
  assert.deepEqual([read(root, 'package.json'), read(root, 'README.md')], before);
});
