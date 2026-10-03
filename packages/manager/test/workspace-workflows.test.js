// Tests for the workspace `workflows` ensure op — the reconcile half of the
// brand root's composed CI ([#636](https://github.com/Omega-JS-Stack/omega/issues/636)):
// a target the brand's config no longer enables loses the
// `.github/workflows/<target>-*.yml` files a previous manage composed for it.
//
// The DELETION rules (the GENERATED header + composed-naming double lock) are
// devkit's and pinned in packages/devkit/test/ci-workflows.test.js; what these
// hold is the manage-lane framing this op owns — which targets count as live,
// the dir surviving the key, and the dry run.

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'workspace-workflows',
  tests: [
    {
      name: 'workflows op is registered in the workspace OPERATIONS',
      run: (ctx) => {
        ctx.expect(OPERATIONS.workspace.some((op) => op.name === 'workflows' && op.ensure === true)).toBeTruthy();
      },
    },

    {
      name: 'workflows: a target dropped from the config loses its composed files, the dir survives',
      run: async (ctx) => {
        const root = stageBrand(['web', 'extension']);
        ctx.expect(composed(root)).toEqual(['extension-build.yml', 'web-build.yml']);

        // `targets.extension` is gone from omega.json5; targets/extension/ is still
        // on disk (whole-dir removal is deliberately not ours) so discovery finds it
        const discovered = [
          { name: 'web', target: 'web' },
          { name: 'extension', target: 'extension' },
        ];

        const result = await workflowsOp(context(root, discovered, ['web']));

        ctx.expect(result.output.workflows.removed).toBe(1);
        ctx.expect(composed(root)).toEqual(['web-build.yml']);
        ctx.expect(fs.existsSync(path.join(root, 'targets', 'extension'))).toBe(true);
      },
    },

    {
      name: 'workflows: every enabled target keeps its files, and the rerun removes nothing',
      run: async (ctx) => {
        const root = stageBrand(['web', 'extension']);
        const discovered = [
          { name: 'web', target: 'web' },
          { name: 'extension', target: 'extension' },
        ];

        ctx.expect(await workflowsOp(context(root, discovered, ['web', 'extension']))).toBe(null);
        ctx.expect(composed(root)).toEqual(['extension-build.yml', 'web-build.yml']);

        // Set → unset → rerun: one removal, then a converged no-op
        const dropped = await workflowsOp(context(root, discovered, ['web']));
        ctx.expect(dropped.output.workflows.removed).toBe(1);
        ctx.expect(await workflowsOp(context(root, discovered, ['web']))).toBe(null);
        ctx.expect(composed(root)).toEqual(['web-build.yml']);
      },
    },

    {
      name: 'workflows: a declared custom target is live — it has no framework to compose with',
      run: async (ctx) => {
        const root = stageBrand(['web']);
        const discovered = [
          { name: 'web', target: 'web' },
          { name: 'render-api', target: null, custom: true },
        ];

        ctx.expect(await workflowsOp(context(root, discovered, ['web', 'render-api']))).toBe(null);
        ctx.expect(composed(root)).toEqual(['web-build.yml']);
      },
    },

    {
      name: 'workflows: a dry run names the files and deletes nothing',
      run: async (ctx) => {
        const root = stageBrand(['extension']);
        const discovered = [{ name: 'extension', target: 'extension' }];

        const result = await workflowsOp(context(root, discovered, [], { dryRun: true }));

        ctx.expect(result.output.workflows.planned).toBe(1);
        ctx.expect(composed(root)).toEqual(['extension-build.yml']);
      },
    },
  ],
});
