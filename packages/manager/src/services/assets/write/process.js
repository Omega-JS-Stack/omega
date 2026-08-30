/**
 * Process logo sources into their derived variants — for each of
 * brandmark/wordmark/combomark that exists: the color SVG as-is + an
 * all-black SVG, and PNGs at every ladder size for both. mtime-diffed
 * against the source, so an unchanged logo regenerates nothing.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const sharp = require('sharp');
const { PROCESSING_RULES } = require('../lib/assets-config.js');
const { logoVariantFiles } = require('../lib/derived.js');
const { convertSvgToBlack } = require('../lib/svg-to-black.js');
const { isStale } = require('../../../lib/stale.js');

module.exports = async function writeProcess(context) {
  const { brandRoot, outDir, options } = context;
  const dryRun = options?.dryRun || false;

  let generated = 0;
  let fresh = 0;
  const planned = [];

  for (const [key, rule] of Object.entries(PROCESSING_RULES)) {
    const sourcePath = join(brandRoot, rule.source);

    if (!jetpack.exists(sourcePath)) {
      // Only the brandmark is guaranteed by setup — wordmark/combomark are optional
      continue;
    }

    const outputDir = join(outDir, rule.outputDir);
    const resize = rule.square
      ? (size) => ({ width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      : (size) => ({ width: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

    // Lazy so a fully fresh source never reads or converts anything
    let svgContent = null;
    let ruleGenerated = 0;
    const variants = [
      { name: 'color', svg: () => svgContent },
      { name: 'black', svg: () => convertSvgToBlack(svgContent) },
    ];

    for (const variant of variants) {
      const targets = logoVariantFiles(rule, variant.name)
        .filter((name) => isStale(sourcePath, join(outputDir, name)));

      if (targets.length === 0) {
        fresh += 1 + rule.sizes.length;
        continue;
      }

      fresh += 1 + rule.sizes.length - targets.length;

      if (dryRun) {
        planned.push(...targets.map((name) => `${rule.outputDir}/${name}`));
        continue;
      }

      svgContent = svgContent ?? jetpack.read(sourcePath);
      const variantSvg = variant.svg();
      const svgBuffer = Buffer.from(variantSvg);

      for (const name of targets) {
        const outputPath = join(outputDir, name);
        if (name.endsWith('.svg')) {
          jetpack.write(outputPath, variantSvg);
        } else {
          const size = parseInt(name.match(/-(\d+)\.png$/)[1], 10);
          jetpack.dir(outputDir);
          await sharp(svgBuffer).resize(resize(size)).png().toFile(outputPath);
        }
        generated++;
        ruleGenerated++;
      }
    }

    if (!dryRun && ruleGenerated > 0) {
      console.log(`      ${chalk.green('✓')} Processed ${chalk.cyan(key)} ${chalk.dim(`(${ruleGenerated} files)`)}`);
    }
  }

  if (dryRun && planned.length > 0) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would generate ${chalk.cyan(planned.length)} logo files`);
    return { output: { process: { planned: planned.length } } };
  }

  if (generated === 0) {
    console.log(`      ${chalk.green('✓')} Logo variants in sync ${chalk.dim(`(${fresh} files fresh)`)}`);
    return { output: { process: { synced: true, fresh } } };
  }

  console.log(`      ${chalk.green('✓')} Summary: ${chalk.bold(generated)} logo files generated`);
  return { output: { process: { generated, fresh } } };
};
