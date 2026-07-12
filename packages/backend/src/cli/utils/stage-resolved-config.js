/**
 * stage-resolved-config — ship the RESOLVED brand config across the upload
 * boundary (friction #31).
 *
 * The config cascade (company ← brand ← app) is a walk-up over the local
 * tree; `firebase deploy` uploads ONLY the functions folder, so the brand
 * layer never crosses the boundary and the deployed runtime falls back to
 * framework defaults ("My Brand"). The config twin of stage-local-packages:
 * compose brand+app into the staged app-layer file for the deploy (via
 * @omega.js/config's composeTargetConfig — the same merge the runtime runs
 * locally, frozen), restore the original bytes afterward. Apps with no
 * brand layer are already self-contained — no-op.
 */

const jetpack = require('fs-jetpack');
const { composeTargetConfig } = require('@omega.js/config');

async function stageResolvedConfig({ functionsPath, log = () => {} }) {
  const { config, files } = composeTargetConfig(functionsPath, 'backend');

  if (!files.brand) {
    return { staged: false, restore: async () => {} };
  }

  // Original bytes — restored verbatim after deploy
  const originalSource = jetpack.read(files.app);

  const banner = '// Composed by `omega deploy` (brand+app layers flattened for the upload boundary).\n'
    + '// Never committed — the original file is restored when the deploy finishes.\n';
  jetpack.write(files.app, banner + JSON.stringify(config, null, 2) + '\n');
  log(`  Staged resolved config: brand layer folded into the upload (${config.brand?.name || config.brand?.id || 'brand'})\n`);

  return {
    staged: true,
    restore: async () => {
      jetpack.write(files.app, originalSource);
    },
  };
}

module.exports = stageResolvedConfig;
