/**
 * Assets service — the brand's derived visual collateral generated from
 * its logo sources: wordmark/combomark SVGs from the brandmark +
 * brand.font, color/black SVG variants + PNG size ladders, PSD templates
 * (seeded from the company root, logo/text layers refreshed, PNGs
 * exported), macOS/Windows app icons, social profile icons, and the web
 * favicon set.
 *
 * Sources are committed brand collateral at `assets/logo/*.svg` and
 * `assets/templates/*.psd` in the brand repo (omega-manager read
 * `.brands/{id}/assets/`); derived files land in the gitignored
 * `.omega/assets/` (omega-manager's `.output/{id}/assets/`). Every
 * operation is mtime-diffed — only missing or stale outputs regenerate —
 * which replaces omega-manager's `--onboarding` gate on the write
 * operations (it regenerated blindly, so running every time was too
 * expensive; it also had no dry-run guard).
 *
 * The brandmark is the root of every derived asset. When it's missing
 * and MrLogo credentials are present (MRLOGO_SERVICE_ACCOUNT /
 * MRLOGO_API_KEY / LOGO_API_ID_TOKEN — the product-service ladder,
 * lib/brandmark-api.js; zero config options by design), the AI generation
 * flow runs; otherwise the service skips with guidance. Not ported:
 * omega-manager's social-images/store-images
 * write operations — dead code whose template-name lists never matched
 * TEMPLATE_CONFIG keys (they could never generate anything); their
 * intended outputs are the templates operation's og-image and
 * store/chrome exports.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { input } = require('@omega.js/devkit/prompt');
const { withSpinner } = require('@omega.js/devkit/flows');
const { resolveLogoAuth, generateBrandmark, MRLOGO_URL } = require('./lib/brandmark-api.js');
const { canPrompt } = require('../../lib/run-gates.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.assets;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'assets.enabled = false' };
    }

    const logoDir = join(context.brandRoot, 'assets', 'logo');
    const brandmarkPath = join(logoDir, 'brandmark.svg');

    // The brandmark is the root of every derived asset — when the brand has
    // none and MrLogo credentials resolve (the product-service ladder:
    // operator SA → api key → pasted ID token; setting a credential IS the
    // consent to spend the API call), generate it. Interactive runs ask for
    // optional art direction. Dry runs never mint.
    if (!jetpack.exists(brandmarkPath)) {
      if (!context.options?.dryRun) {
        try {
          const auth = await resolveLogoAuth({
            brandConfig: context.brandConfig,
            brandRoot: context.brandRoot,
            db: context.mrlogoDb,
            authAdmin: context.mrlogoAuthAdmin,
            log: (line) => console.log(`    ${line}`),
          });

          if (auth) {
            const direction = canPrompt(context.options)
              ? (await input({ message: 'Logo prompt (press Enter to skip):', default: '' })).trim()
              : '';
            await withSpinner('Generating brandmark via MrLogo', () =>
              generateBrandmark({ brandConfig: context.brandConfig, brandmarkPath, direction, token: auth.token }));
          }
        } catch (error) {
          console.log(`    ${chalk.yellow('⚠')} Brandmark generation failed${chalk.dim(`: ${error.message}`)}`);
        }
      }

      if (!jetpack.exists(brandmarkPath)) {
        return { skip: true, reason: `no assets/logo/brandmark.svg in the brand repo (add the brand's logo source, set MRLOGO_SERVICE_ACCOUNT / MRLOGO_API_KEY / LOGO_API_ID_TOKEN in the brand .env for AI generation, or make one at ${MRLOGO_URL})` };
      }
    }

    return {
      logoDir,
      brandmarkPath,
      outDir: join(context.brandRoot, '.omega', 'assets'),
    };
  },
});
