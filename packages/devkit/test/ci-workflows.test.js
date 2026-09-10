// Unit tests for src/ci-workflows.js — brand-monorepo CI composition (#265).
//
// GitHub only executes workflows from the REPO ROOT's .github/workflows/, so a
// per-target `targets/<dir>/.github/workflows/*.yml` scaffolded into a brand monorepo
// is dead on arrival: CI builds and store publishes silently never exist. Setup
// composes the target's workflow into the root dir instead, scoped to the target's
// path, one file per target, regenerated (never duplicated) on every setup.
//
// Each test builds a brand tree under .temp/ programmatically.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const jetpack = require('fs-jetpack');
const { composeWorkflow, composeTargetWorkflows, composedWorkflowName, reconcileComposedWorkflows } = require('../src/ci-workflows');

const TEMP = path.join(__dirname, '..', '.temp', `ci-workflows-${process.pid}`);
let caseIndex = 0;

const quiet = { log: () => {}, warn: () => {}, error: () => {} };

// A workflow template shaped like the ones the frameworks ship — including the
// `run:` step that executes BEFORE actions/checkout. A fixture that checked out
// first hid the composition bug that killed every composed run on step 1.
const TEMPLATE = `# Deliberate deploys: commits never auto-publish.
name: Build and Publish Extension

on:
  workflow_dispatch:
  repository_dispatch:
    types: [omega-deploy]

concurrency:
  group: \${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '22'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Setup git config
        run: |
          git config --global user.name "$GITHUB_ACTOR"

      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Build
        run: npx omega setup && npm run build
`;

// Every workflow template the frameworks actually ship, read from source. The
// composition has to survive THESE, not only the fixture above.
function frameworkTemplates() {
  const packagesDir = path.resolve(__dirname, '..', '..');
  const templates = [];

  for (const pkg of jetpack.list(packagesDir).sort()) {
    if (jetpack.exists(path.join(packagesDir, pkg)) !== 'dir') {
      continue;
    }

    // The two homes a framework keeps its scaffolded workflows in
    for (const defaults of [['src', 'defaults'], ['scaffold']]) {
      const workflowsDir = path.join(packagesDir, pkg, ...defaults, '.github', 'workflows');
      if (jetpack.exists(workflowsDir) !== 'dir') {
        continue;
      }

      for (const name of jetpack.list(workflowsDir).sort()) {
        templates.push({ label: `${pkg}/${name}`, contents: jetpack.read(path.join(workflowsDir, name)) });
      }
    }
  }

  return templates;
}

// The job blocks of a composed workflow (job keys sit at two spaces).
function jobBlocks(composed) {
  return composed
    .slice(composed.indexOf('\njobs:\n'))
    .split(/\n(?= {2}[A-Za-z0-9_-]+:\n)/)
    .slice(1);
}

// Stage a brand root with `targets/<name>/.github/workflows/<file>` sources.
function stageBrand(targets) {
  const brandRoot = path.join(TEMP, `case-${caseIndex++}`);
  jetpack.write(path.join(brandRoot, 'package.json'), '{ "name": "brand" }');

  const staged = {};
  for (const [name, workflows] of Object.entries(targets)) {
    const targetDir = path.join(brandRoot, 'targets', name);
    const sourceDir = path.join(targetDir, '__defaults', '.github', 'workflows');
    for (const [file, contents] of Object.entries(workflows)) {
      jetpack.write(path.join(sourceDir, file), contents);
    }
    staged[name] = { targetDir, sourceDir };
  }

  return { brandRoot, targets: staged };
}

const rootWorkflow = (brandRoot, file) => path.join(brandRoot, '.github', 'workflows', file);

test('composeWorkflow: scopes the run to the target, keeps the workflow itself intact', () => {
  const composed = composeWorkflow(TEMPLATE, { targetPath: 'targets/extension', targetName: 'extension' });

  // Says where it came from and that setup owns it
  assert.match(composed, /omega setup/);
  assert.match(composed, /targets\/extension/);

  // Every `run:` step AFTER the checkout executes in the target dir — the whole
  // point of composing
  assert.match(composed, / {6}- name: Build\n {8}working-directory: targets\/extension\n {8}run: npx omega setup && npm run build\n/);

  // …and the step that runs BEFORE the checkout is left at the repo root: the
  // target dir does not exist yet, so scoping it kills the job on step 1
  assert.match(composed, / {6}- name: Setup git config\n {8}run: \|\n/);

  // No workflow-level default — it would scope those pre-checkout steps too
  assert.doesNotMatch(composed, /^defaults:/m);

  // Per-target identity: two targets' runs never cancel each other, and the
  // Actions list shows which target a run belongs to
  assert.match(composed, /^name: Build and Publish Extension \(targets\/extension\)$/m);
  assert.match(composed, /^ {2}group: extension-\$\{\{ github\.ref \}\}$/m);

  // The workflow's own content is carried over verbatim
  assert.match(composed, /uses: actions\/checkout@v4/);
  assert.match(composed, /run: npx omega setup && npm run build/);
  assert.match(composed, /types: \[omega-deploy\]/);
});

test('the REAL framework templates: nothing before a job\'s checkout is scoped to the target dir', () => {
  const templates = frameworkTemplates();
  assert.ok(templates.length > 0, 'no framework workflow templates found — the pin would be vacuous');

  for (const template of templates) {
    const composed = composeWorkflow(template.contents, { targetPath: 'targets/extension', targetName: 'extension' });
    const scoped = 'working-directory: targets/extension';

    // A workflow-level default applies to every job, including the ones that
    // run a command before (or entirely without) a checkout
    assert.doesNotMatch(composed, /^defaults:/m, template.label);

    for (const job of jobBlocks(composed)) {
      if (!job.includes(scoped)) {
        continue;
      }

      const checkout = job.indexOf('uses: actions/checkout');
      assert.notEqual(checkout, -1, `${template.label}: a job with no checkout scopes a step to a dir it never creates`);
      assert.ok(checkout < job.indexOf(scoped), `${template.label}: a step before the checkout is scoped to a dir that does not exist yet`);
    }
  }
});

test('the REAL extension template: the git config step stays at the root, the build step runs in the target', () => {
  const template = frameworkTemplates().find((entry) => entry.label === 'extension/publish.yml');
  assert.ok(template, 'the extension publish template is missing');

  const composed = composeWorkflow(template.contents, { targetPath: 'targets/extension', targetName: 'extension' });

  // Step 1 of the shipped template: a `run:` before actions/checkout
  assert.match(composed, / {6}- name: Setup git config\n {8}run: \|\n/);

  // Post-checkout `run:` steps carry the scope, in both YAML shapes
  assert.match(composed, / {6}- name: Install dependencies\n {8}working-directory: targets\/extension\n {8}run: sfw npm install\n/);
  assert.match(composed, / {6}- name: Build and publish extension\n {8}working-directory: targets\/extension\n {8}run: \|\n/);

  // `uses:` steps are never scoped — checkout and friends want the repo root
  assert.match(composed, / {6}- name: Checkout repository\n {8}uses: actions\/checkout@v4\n/);
  assert.match(composed, / {6}- name: Setup Node\.js\n {8}uses: actions\/setup-node@v4\n/);
});

test('the REAL templates: no hashFiles() pattern is left pointing at the repo root', () => {
  for (const template of frameworkTemplates()) {
    const composed = composeWorkflow(template.contents, { targetPath: 'targets/extension', targetName: 'extension' });

    for (const [, pattern] of composed.matchAll(/hashFiles\(\s*['"]([^'"]+)['"]/g)) {
      // hashFiles() globs from GITHUB_WORKSPACE whatever step it sits in — a
      // root-relative pattern in a composed target workflow hashes nothing
      assert.ok(pattern.startsWith('targets/extension/'), `${template.label}: hashFiles('${pattern}') never sees the target`);
    }
  }
});

test('the REAL web template: the action inputs a working-directory can never reach are target-scoped', () => {
  const template = frameworkTemplates().find((entry) => entry.label === 'web/build.yml');
  assert.ok(template, 'the web build template is missing');

  const composed = composeWorkflow(template.contents, { targetPath: 'targets/website', targetName: 'website' });

  // `working-directory:` is a `run:` key — an action's inputs ignore it, so the
  // gh-pages publish pushed a repo-root dist/ that no build ever wrote
  assert.match(composed, /^ {10}publish_dir: targets\/website\/dist$/m);
  assert.match(composed, /^ {10}path: targets\/website\/\.omega\/cache\/imagemin$/m);
  assert.match(composed, /hashFiles\('targets\/website\/src\/assets\/images\/\*\*'\)/);

  // Untouched: the action's own inputs, and the key's literal prefix
  assert.match(composed, /^ {10}github_token: \$\{\{ secrets\.GH_TOKEN \}\}$/m);
  assert.match(composed, /^ {10}key: omega-imagemin-\$\{\{ hashFiles\(/m);

  // A standalone project IS the repo root: the scaffolded template is unchanged,
  // scoping belongs to composition alone
  assert.match(template.contents, /^ {10}publish_dir: \.\/dist$/m);
  assert.match(template.contents, /^ {10}path: \.omega\/cache\/imagemin$/m);
  assert.doesNotMatch(template.contents, /targets\//);
});

test('the REAL desktop template: artifact paths ride the target dir, in both YAML shapes', () => {
  const template = frameworkTemplates().find((entry) => entry.label === 'desktop/build.yml');
  assert.ok(template, 'the desktop build template is missing');

  const composed = composeWorkflow(template.contents, { targetPath: 'targets/desktop', targetName: 'desktop' });

  // upload-artifact's `path:` is a block scalar — every line is a repo-root glob
  assert.match(composed, /^ {12}targets\/desktop\/release\/\*\.exe$/m);
  assert.match(composed, /^ {12}targets\/desktop\/release\/\*\.yml$/m);
  assert.match(composed, /^ {12}targets\/desktop\/release\/\*\.blockmap$/m);

  // download-artifact lands where the (target-scoped) signing run step looks
  assert.match(composed, /^ {10}path: targets\/desktop\/release$/m);
  assert.match(composed, /^ {10}name: windows-unsigned$/m);

  // checkout's own inputs are never rewritten — they are not paths in the tree
  assert.match(composed, /^ {10}fetch-depth: 0$/m);
});

test('the REAL extension template: a target with no path-bearing action inputs is unchanged beyond its run steps', () => {
  const template = frameworkTemplates().find((entry) => entry.label === 'extension/publish.yml');
  const composed = composeWorkflow(template.contents, { targetPath: 'targets/extension', targetName: 'extension' });

  assert.doesNotMatch(composed, /^ {8}(?:path|publish_dir):/m);
  assert.equal(composed.match(/targets\/extension/g).length, composed.match(/working-directory: targets\/extension/g).length + 3); // + the 3 header lines
});

test('the sweep is unaffected: the target copy of a REAL template still compares byte-equal', () => {
  const template = frameworkTemplates().find((entry) => entry.label === 'web/build.yml');
  const { brandRoot, targets } = stageBrand({ website: { 'build.yml': template.contents } });

  // What a prior target-level scaffold wrote: the framework template, untouched.
  // Scoping happens at COMPOSE time, so this still matches and is still swept —
  // a token rendered into the template would have made every dead copy "differ".
  jetpack.write(path.join(targets.website.targetDir, '.github', 'workflows', 'build.yml'), template.contents);

  const warnings = [];
  const result = composeTargetWorkflows({
    sourceDir: targets.website.sourceDir,
    targetDir: targets.website.targetDir,
    brandRoot,
    logger: { ...quiet, warn: (message) => warnings.push(message) },
  });

  assert.deepEqual(result.removed, ['.github/workflows/build.yml']);
  assert.deepEqual(warnings, []);
  assert.equal(jetpack.exists(path.join(targets.website.targetDir, '.github')), false);
});

test('two-target monorepo: one root workflow per target, each scoped to its own dir', () => {
  const { brandRoot, targets } = stageBrand({
    extension: { 'publish.yml': TEMPLATE },
    website: { 'build.yml': TEMPLATE.replace('Build and Publish Extension', 'Compile and Build Site') },
  });

  for (const name of ['extension', 'website']) {
    composeTargetWorkflows({
      sourceDir: targets[name].sourceDir,
      targetDir: targets[name].targetDir,
      brandRoot,
      logger: quiet,
    });
  }

  const composedFiles = jetpack.list(path.join(brandRoot, '.github', 'workflows')).sort();
  assert.deepEqual(composedFiles, ['extension-publish.yml', 'website-build.yml']);

  const extension = jetpack.read(rootWorkflow(brandRoot, 'extension-publish.yml'));
  const website = jetpack.read(rootWorkflow(brandRoot, 'website-build.yml'));
  assert.match(extension, /working-directory: targets\/extension/);
  assert.match(website, /working-directory: targets\/website/);
  assert.match(extension, /group: extension-/);
  assert.match(website, /group: website-/);

  // No per-target .github/ in a monorepo — GitHub would never run it
  assert.equal(jetpack.exists(path.join(targets.extension.targetDir, '.github')), false);
  assert.equal(jetpack.exists(path.join(targets.website.targetDir, '.github')), false);
});

test('idempotent: re-running setup updates the target\'s file and never duplicates', () => {
  const { brandRoot, targets } = stageBrand({ extension: { 'publish.yml': TEMPLATE } });
  const compose = () => composeTargetWorkflows({
    sourceDir: targets.extension.sourceDir,
    targetDir: targets.extension.targetDir,
    brandRoot,
    logger: quiet,
  });

  const first = compose();
  assert.deepEqual(first.written, ['.github/workflows/extension-publish.yml']);

  const contents = jetpack.read(rootWorkflow(brandRoot, 'extension-publish.yml'));

  // Second run: identical content is not a write, and nothing is appended twice
  const second = compose();
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.skipped, ['.github/workflows/extension-publish.yml']);
  assert.equal(jetpack.read(rootWorkflow(brandRoot, 'extension-publish.yml')), contents);
  assert.equal(contents.match(/working-directory:/g).length, 1);
  assert.equal(contents.match(/^name:/gm).length, 1);
  assert.equal(jetpack.list(path.join(brandRoot, '.github', 'workflows')).length, 1);

  // A changed template updates the composed file in place
  jetpack.write(path.join(targets.extension.sourceDir, 'publish.yml'), TEMPLATE.replace('ubuntu-latest', 'ubuntu-24.04'));
  const third = compose();
  assert.deepEqual(third.written, ['.github/workflows/extension-publish.yml']);
  assert.match(jetpack.read(rootWorkflow(brandRoot, 'extension-publish.yml')), /ubuntu-24\.04/);
  assert.equal(jetpack.list(path.join(brandRoot, '.github', 'workflows')).length, 1);
});

test('sweeps the dead per-target copy, keeps one the consumer edited', () => {
  const { brandRoot, targets } = stageBrand({
    extension: { 'publish.yml': TEMPLATE },
    website: { 'build.yml': TEMPLATE },
  });

  // What a prior setup scaffolded into the target dirs: one untouched, one edited
  const deadCopy = path.join(targets.extension.targetDir, '.github', 'workflows', 'publish.yml');
  const editedCopy = path.join(targets.website.targetDir, '.github', 'workflows', 'build.yml');
  jetpack.write(deadCopy, TEMPLATE);
  jetpack.write(editedCopy, `${TEMPLATE}      - name: My own step\n        run: echo hi\n`);

  const warnings = [];
  const logger = { ...quiet, warn: (message) => warnings.push(message) };

  const extension = composeTargetWorkflows({ sourceDir: targets.extension.sourceDir, targetDir: targets.extension.targetDir, brandRoot, logger });
  const website = composeTargetWorkflows({ sourceDir: targets.website.sourceDir, targetDir: targets.website.targetDir, brandRoot, logger });

  // Framework-owned: deleted, and the empty .github/ goes with it
  assert.equal(jetpack.exists(deadCopy), false);
  assert.equal(jetpack.exists(path.join(targets.extension.targetDir, '.github')), false);
  assert.deepEqual(extension.removed, ['.github/workflows/publish.yml']);

  // Consumer content is NEVER destroyed — it is reported instead
  assert.equal(jetpack.exists(editedCopy), 'file');
  assert.deepEqual(website.removed, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /targets\/website\/\.github\/workflows\/build\.yml/);
  // A kept copy carries lines the current template does not ship, which is all
  // the compare can prove, so the warning never claims edits by name; it does
  // name the composed file to compare against
  assert.doesNotMatch(warnings[0], /your own edits/);
  assert.match(warnings[0], /differs from the current .*template/);
  assert.match(warnings[0], /\.github\/workflows\/website-build\.yml/);
});

test('sweeps a copy left by a superseded template, keeps one that changed a line', () => {
  // What #189 did to the shipped web template: it GAINED a generated block, so
  // every copy a prior setup wrote is now a strict subset of what the template
  // renders today ([#334](https://github.com/Omega-JS-Stack/omega/issues/334)).
  const current = TEMPLATE.replace(
    `  NODE_VERSION: '22'\n`,
    `  NODE_VERSION: '22'\n  # Generated from the brand's .env cascade by \`omega setup\`.\n  API_KEY: \${{ secrets.API_KEY }}\n`,
  );

  const { brandRoot, targets } = stageBrand({
    extension: { 'publish.yml': current },
    website: { 'build.yml': current },
  });

  // One copy is the superseded generation verbatim; the other CHANGED a line
  // the framework wrote, which no template of this framework ever shipped
  const supersededCopy = path.join(targets.extension.targetDir, '.github', 'workflows', 'publish.yml');
  const editedCopy = path.join(targets.website.targetDir, '.github', 'workflows', 'build.yml');
  jetpack.write(supersededCopy, TEMPLATE);
  jetpack.write(editedCopy, current.replace('ubuntu-latest', 'ubuntu-24.04'));

  const warnings = [];
  const logger = { ...quiet, warn: (message) => warnings.push(message) };

  const extension = composeTargetWorkflows({ sourceDir: targets.extension.sourceDir, targetDir: targets.extension.targetDir, brandRoot, logger });
  const website = composeTargetWorkflows({ sourceDir: targets.website.sourceDir, targetDir: targets.website.targetDir, brandRoot, logger });

  // The superseded copy is framework-owned: swept, empty .github/ pruned with it
  assert.equal(jetpack.exists(supersededCopy), false);
  assert.equal(jetpack.exists(path.join(targets.extension.targetDir, '.github')), false);
  assert.deepEqual(extension.removed, ['.github/workflows/publish.yml']);

  // The changed line is content no framework template wrote: kept and warned
  assert.equal(jetpack.exists(editedCopy), 'file');
  assert.deepEqual(website.removed, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /targets\/website\/\.github\/workflows\/build\.yml/);
});

test('composedWorkflowName: the root name in a monorepo, the plain name standalone', () => {
  assert.equal(composedWorkflowName({
    targetDir: '/brand/targets/extension',
    brandRoot: '/brand',
    workflow: 'publish.yml',
  }), 'extension-publish.yml');

  assert.equal(composedWorkflowName({
    targetDir: '/standalone-extension',
    brandRoot: null,
    workflow: 'publish.yml',
  }), 'publish.yml');

  // The TARGET DIR prefixes the name, not the framework: web's `website` and
  // desktop's `desktop` both ship a `build.yml`, and the two composed files sit
  // side by side at the brand root. Desktop's release/deploy verbs read this
  // name too (#799).
  assert.equal(composedWorkflowName({
    targetDir: '/brand/targets/desktop',
    brandRoot: '/brand',
    workflow: 'build.yml',
  }), 'desktop-build.yml');

  assert.equal(composedWorkflowName({
    targetDir: '/brand/targets/website',
    brandRoot: '/brand',
    workflow: 'build.yml',
  }), 'website-build.yml');

  assert.equal(composedWorkflowName({
    targetDir: '/standalone-desktop-app',
    brandRoot: null,
    workflow: 'build.yml',
  }), 'build.yml');
});

test('a transform hook renders the template before composing (site tokens)', () => {
  const { brandRoot, targets } = stageBrand({
    extension: { 'publish.yml': TEMPLATE.replace(`'22'`, `'[versions.node]'`) },
  });

  composeTargetWorkflows({
    sourceDir: targets.extension.sourceDir,
    targetDir: targets.extension.targetDir,
    brandRoot,
    transform: (contents) => contents.replace('[versions.node]', '22'),
    logger: quiet,
  });

  const composed = jetpack.read(rootWorkflow(brandRoot, 'extension-publish.yml'));
  assert.match(composed, /NODE_VERSION: '22'/);
  assert.equal(composed.includes('[versions.node]'), false);
});

// ─── Reconcile: a dropped target's composed files go (#636) ──────────────────

test('reconcile: a target the config no longer enables loses its composed files', () => {
  const { brandRoot, targets } = stageBrand({
    extension: { 'publish.yml': TEMPLATE },
    website: { 'build.yml': TEMPLATE.replace('Build and Publish Extension', 'Compile and Build Site') },
  });
  for (const name of ['extension', 'website']) {
    composeTargetWorkflows({ sourceDir: targets[name].sourceDir, targetDir: targets[name].targetDir, brandRoot, logger: quiet });
  }

  // `targets.extension` is deleted from omega.json5 — the dir may well still be
  // on disk, but the brand no longer enables it
  const result = reconcileComposedWorkflows({ brandRoot, liveTargets: ['website'], logger: quiet });

  assert.deepEqual(result.removed, ['.github/workflows/extension-publish.yml']);
  assert.deepEqual(jetpack.list(path.join(brandRoot, '.github', 'workflows')).sort(), ['website-build.yml']);
});

test('reconcile: a human-authored workflow with a colliding name is NEVER deleted', () => {
  const { brandRoot, targets } = stageBrand({ extension: { 'publish.yml': TEMPLATE } });
  composeTargetWorkflows({ sourceDir: targets.extension.sourceDir, targetDir: targets.extension.targetDir, brandRoot, logger: quiet });

  // The brand's own file, named exactly the composed way but written by a human:
  // no GENERATED header, so the first lock never opens
  const handWritten = `name: Extension smoke tests\n\non:\n  workflow_dispatch:\n`;
  jetpack.write(rootWorkflow(brandRoot, 'extension-smoke.yml'), handWritten);
  // …and one that is not named the composed way at all
  jetpack.write(rootWorkflow(brandRoot, 'release.yml'), handWritten);

  const result = reconcileComposedWorkflows({ brandRoot, liveTargets: [], logger: quiet });

  assert.deepEqual(result.removed, ['.github/workflows/extension-publish.yml']);
  assert.equal(jetpack.read(rootWorkflow(brandRoot, 'extension-smoke.yml')), handWritten);
  assert.equal(jetpack.read(rootWorkflow(brandRoot, 'release.yml')), handWritten);
});

test('reconcile: an enabled target keeps its files, and a rerun is a no-op', () => {
  const { brandRoot, targets } = stageBrand({ extension: { 'publish.yml': TEMPLATE } });
  composeTargetWorkflows({ sourceDir: targets.extension.sourceDir, targetDir: targets.extension.targetDir, brandRoot, logger: quiet });

  assert.deepEqual(reconcileComposedWorkflows({ brandRoot, liveTargets: ['extension'], logger: quiet }).removed, []);
  assert.equal(jetpack.exists(rootWorkflow(brandRoot, 'extension-publish.yml')), 'file');

  // Set → unset → rerun: the drop removes once, the next walk finds nothing left
  assert.deepEqual(reconcileComposedWorkflows({ brandRoot, liveTargets: [], logger: quiet }).removed, ['.github/workflows/extension-publish.yml']);
  assert.deepEqual(reconcileComposedWorkflows({ brandRoot, liveTargets: [], logger: quiet }).removed, []);
});

test('reconcile: a dry run names the files and deletes nothing', () => {
  const { brandRoot, targets } = stageBrand({ extension: { 'publish.yml': TEMPLATE } });
  composeTargetWorkflows({ sourceDir: targets.extension.sourceDir, targetDir: targets.extension.targetDir, brandRoot, logger: quiet });

  const result = reconcileComposedWorkflows({ brandRoot, liveTargets: [], dryRun: true, logger: quiet });

  assert.deepEqual(result.removed, ['.github/workflows/extension-publish.yml']);
  assert.equal(jetpack.exists(rootWorkflow(brandRoot, 'extension-publish.yml')), 'file');
});

test('reconcile: a composed file carrying the LEGACY header is still recognised', () => {
  const { brandRoot } = stageBrand({});

  // What a target dropped BEFORE this wave left behind: composed by the old
  // `omega setup` wording, never rewritten since — the exact case the reconcile
  // exists for
  const legacy = `# GENERATED by \`omega setup\` for targets/extension \u2014 do not edit.\n${TEMPLATE}`;
  jetpack.write(rootWorkflow(brandRoot, 'extension-publish.yml'), legacy);
  // …and a human file in the same dir, which no header lock ever opens
  const handWritten = `name: Extension smoke tests\n\non:\n  workflow_dispatch:\n`;
  jetpack.write(rootWorkflow(brandRoot, 'extension-smoke.yml'), handWritten);

  const result = reconcileComposedWorkflows({ brandRoot, liveTargets: ['website'], logger: quiet });

  assert.deepEqual(result.removed, ['.github/workflows/extension-publish.yml']);
  assert.equal(jetpack.exists(rootWorkflow(brandRoot, 'extension-publish.yml')), false);
  assert.equal(jetpack.read(rootWorkflow(brandRoot, 'extension-smoke.yml')), handWritten);
});

test('reconcile: a brand with no .github/workflows dir is a clean no-op', () => {
  const { brandRoot } = stageBrand({});

  assert.deepEqual(reconcileComposedWorkflows({ brandRoot, liveTargets: [], logger: quiet }), { removed: [] });
});
