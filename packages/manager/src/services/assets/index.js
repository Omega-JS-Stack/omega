/**
 * Assets service — the brand's derived visual collateral generated from
 * its logo sources, entirely local (no external API): wordmark/combomark
 * SVGs from the brandmark + brand.font, color/black SVG variants + PNG
 * size ladders, macOS/Windows app icons, social profile icons, and the
 * web favicon set.
 *
 * Sources are committed brand collateral at `assets/logo/*.svg` in the
 * brand repo (omega-manager read `.brands/{id}/assets/`); derived files
 * land in the gitignored `.omega/assets/` (omega-manager's
 * `.output/{id}/assets/`). Every operation is mtime-diffed — only missing
 * or stale outputs regenerate — which replaces omega-manager's
 * `--onboarding` gate on the write operations (it regenerated blindly, so
 * running every time was too expensive; it also had no dry-run guard).
 *
 * Not ported here: the MrLogo AI brandmark generation (an interactive
 * prompt + a company-mode admin token — rides the onboarding/prompting
 * ports; a missing brandmark is a clean skip with guidance) and the PSD
 * template operations (templates / social-images / store-images — need
 * ag-psd + node-canvas and the company's binary PSD templates; they ride
 * the same later ports).
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const { createServiceRunner } = require('../../lib/service-runner.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.assets;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'assets.enabled = false' };
    }

    const logoDir = join(context.brandRoot, 'assets', 'logo');
    const brandmarkPath = join(logoDir, 'brandmark.svg');

    // The brandmark is the root of every derived asset
    if (!jetpack.exists(brandmarkPath)) {
      return { skip: true, reason: 'no assets/logo/brandmark.svg in the brand repo (add the brand\'s logo source — the AI logo-generation flow is parked: it needs the company MrLogo admin token)' };
    }

    return {
      logoDir,
      brandmarkPath,
      outDir: join(context.brandRoot, '.omega', 'assets'),
    };
  },
});
