/**
 * Generate the web favicon set from the brandmark — the PNG ladder
 * (favicon/apple-touch/android-chrome), a multi-size favicon.ico, and
 * site.webmanifest — into `.omega/assets/favicon/`. Images are
 * mtime-diffed against the brandmark; the webmanifest derives from
 * config, so it's content-diffed instead.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const sharp = require('sharp');
const png2icons = require('png2icons');
const { FAVICON_CONFIG } = require('../lib/assets-config.js');
const { faviconImageFiles, WEBMANIFEST_NAME } = require('../lib/derived.js');
const { isStale } = require('../../../lib/stale.js');

module.exports = async function writeFavicons(context) {
  const { brandConfig, brandmarkPath, outDir, options } = context;
  const dryRun = options?.dryRun || false;

  const outputDir = join(outDir, FAVICON_CONFIG.outputDir);

  const staleImages = faviconImageFiles().filter((name) => isStale(brandmarkPath, join(outputDir, name)));

  const brandName = brandConfig.brand.name;
  const desiredManifest = JSON.stringify({
    name: brandName,
    short_name: brandName,
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
  }, null, 2);

  const manifestPath = join(outputDir, WEBMANIFEST_NAME);
  const manifestStale = jetpack.read(manifestPath) !== desiredManifest;

  if (staleImages.length === 0 && !manifestStale) {
    console.log(`      ${chalk.green('✓')} Favicons in sync ${chalk.dim(`(${FAVICON_CONFIG.files.length + 2} files fresh)`)}`);
    return { output: { favicons: { synced: true } } };
  }

  if (dryRun) {
    const count = staleImages.length + (manifestStale ? 1 : 0);
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would generate ${chalk.cyan(count)} favicon files`);
    return { output: { favicons: { planned: count } } };
  }

  jetpack.dir(outputDir);
  let generated = 0;

  for (const file of FAVICON_CONFIG.files) {
    if (!staleImages.includes(file.name)) {
      continue;
    }
    await sharp(brandmarkPath)
      .resize(file.size, file.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(outputDir, file.name));
    generated++;
  }

  if (staleImages.includes('favicon.ico')) {
    const sourcePng = await sharp(brandmarkPath)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    jetpack.write(join(outputDir, 'favicon.ico'), png2icons.createICO(sourcePng, png2icons.BICUBIC, 0, true));
    generated++;
  }

  if (manifestStale) {
    jetpack.write(manifestPath, desiredManifest);
    generated++;
  }

  console.log(`      ${chalk.green('✓')} Generated ${chalk.bold(generated)} favicon files`);
  return { output: { favicons: { generated } } };
};
