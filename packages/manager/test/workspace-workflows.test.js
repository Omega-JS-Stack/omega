// Tests for the workspace `workflows` ensure op — the reconcile half of the
// brand root's composed CI ([#636](https://github.com/Omega-JS-Stack/omega/issues/636)):
// a target the brand's config no longer enables loses the
// `.github/workflows/<target>-*.yml` files a previous manage composed for it.
//
// The DELETION rules (the GENERATED header + composed-naming double lock) are
// devkit's and pinned in packages/devkit/test/ci-workflows.test.js; what these
// hold is the manage-lane framing this op owns — which targets count as live,
// the dir surviving the key, and the dry run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS } = require('../src/config.js');
const { composeTargetWorkflows } = require('@omega.js/devkit/ci-workflows');
const workflowsOp = require('../src/services/workspace/ensure/workflows.js');

const TEMPLATE = `# Deliberate deploys: commits never auto-publish.
name: Build and Publish

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Build
        run: npx omega setup && npm run build
`;

/**
 * A brand root whose targets each composed one workflow into the root — the
 * state a previous manage leaves behind.
 */
function stageBrand(dirNames) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-workflows-'));

  for (const name of dirNames) {
    const targetDir = path.join(root, 'targets', name);
    const sourceDir = path.join(targetDir, '__defaults', '.github', 'workflows');
    jetpack.write(path.join(sourceDir, 'build.yml'), TEMPLATE);
    composeTargetWorkflows({ sourceDir, targetDir, brandRoot: root, logger: { log: () => {}, warn: () => {} } });
  }

  return root;
}

/** The op's context: discovered dirs (which outlive a dropped key) + the enabled set. */
function context(root, discovered, enabledTargets, options = {}) {
  return {
    brandRoot: root,
    brand: { enabledTargets },
    targets: discovered,
    options,
  };
}

const composed = (root) => (jetpack.list(path.join(root, '.github', 'workflows')) || []).sort();

test('workflows op is registered in the workspace OPERATIONS', () => {
  assert.ok(OPERATIONS.workspace.some((op) => op.name === 'workflows' && op.ensure === true));
});

test('workflows: a target dropped from the config loses its composed files, the dir survives', async () => {
  const root = stageBrand(['website', 'extension']);
  assert.deepEqual(composed(root), ['extension-build.yml', 'website-build.yml']);

  // `targets.extension` is gone from omega.json5; targets/extension/ is still
  // on disk (whole-dir removal is deliberately not ours) so discovery finds it
  const discovered = [
    { name: 'website', target: 'web' },
    { name: 'extension', target: 'extension' },
  ];

  const result = await workflowsOp(context(root, discovered, ['web']));

  assert.equal(result.output.workflows.removed, 1);
  assert.deepEqual(composed(root), ['website-build.yml']);
  assert.equal(fs.existsSync(path.join(root, 'targets', 'extension')), true);
});

test('workflows: every enabled target keeps its files, and the rerun removes nothing', async () => {
  const root = stageBrand(['website', 'extension']);
  const discovered = [
    { name: 'website', target: 'web' },
    { name: 'extension', target: 'extension' },
  ];

  assert.equal(await workflowsOp(context(root, discovered, ['web', 'extension'])), null);
  assert.deepEqual(composed(root), ['extension-build.yml', 'website-build.yml']);

  // Set → unset → rerun: one removal, then a converged no-op
  const dropped = await workflowsOp(context(root, discovered, ['web']));
  assert.equal(dropped.output.workflows.removed, 1);
  assert.equal(await workflowsOp(context(root, discovered, ['web'])), null);
  assert.deepEqual(composed(root), ['website-build.yml']);
});

test('workflows: a declared custom target is live — it has no framework to compose with', async () => {
  const root = stageBrand(['website']);
  const discovered = [
    { name: 'website', target: 'web' },
    { name: 'render-api', target: null, custom: true },
  ];

  assert.equal(await workflowsOp(context(root, discovered, ['web', 'render-api'])), null);
  assert.deepEqual(composed(root), ['website-build.yml']);
});

test('workflows: a dry run names the files and deletes nothing', async () => {
  const root = stageBrand(['extension']);
  const discovered = [{ name: 'extension', target: 'extension' }];

  const result = await workflowsOp(context(root, discovered, [], { dryRun: true }));

  assert.equal(result.output.workflows.planned, 1);
  assert.deepEqual(composed(root), ['extension-build.yml']);
});
