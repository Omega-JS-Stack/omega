/**
 * Generate the platform app-icon files — macOS `.icns` and Windows
 * `.ico` — into `.omega/assets/app/{platform}/`. The source is the
 * composited `icon.png` in that directory when present (produced by the
 * templates operation, which runs just before), else the brandmark SVG.
 * mtime-diffed against the chosen source.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const sharp = require('sharp');
const png2icons = require('png2icons');
const { appIconFiles } = require('../lib/derived.js');
const { isStale } = require('../../../lib/stale.js');

module.exports = async function writeIcons(context) {
  const { brandmarkPath, outDir, options } = context;
  const dryRun = options?.dryRun || false;

  let generated = 0;
  let fresh = 0;
  const planned = [];

  for (const { platform, format, file } of appIconFiles()) {
    const compositedPath = join(outDir, 'app', platform, 'icon.png');
    const sourcePath = jetpack.exists(compositedPath) ? compositedPath : brandmarkPath;
    const iconPath = join(outDir, file);

    if (!isStale(sourcePath, iconPath)) {
      fresh++;
      continue;
    }

    if (dryRun) {
      planned.push(`${platform}/icon.${format}`);
      continue;
    }

    const sourcePng = await sharp(sourcePath)
      .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const buffer = format === 'icns'
      ? png2icons.createICNS(sourcePng, png2icons.BICUBIC, 0)
      : png2icons.createICO(sourcePng, png2icons.BICUBIC, 0, true);

    jetpack.write(iconPath, buffer);
    console.log(`      ${chalk.green('✓')} Generated ${chalk.cyan(`${platform}/icon.${format}`)}`);
    generated++;
  }

  if (dryRun && planned.length > 0) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would generate ${planned.map((name) => chalk.cyan(name)).join(' + ')}`);
    return { output: { icons: { planned: planned.length } } };
  }

  if (generated === 0) {
    console.log(`      ${chalk.green('✓')} App icons in sync ${chalk.dim(`(${fresh} fresh)`)}`);
    return { output: { icons: { synced: true } } };
  }

  return { output: { icons: { generated } } };
};
