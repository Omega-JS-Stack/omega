/**
 * Generate the wordmark and combomark SVGs from the brandmark + brand
 * name + brand.font — text rendered as path outlines via opentype.js, so
 * the output SVGs are self-contained. Generation is missing-only: an
 * existing (possibly hand-tuned) wordmark or combomark is never
 * overwritten.
 *
 * `brand.font` names a font file (without extension) resolved from the
 * brand repo's `assets/fonts/` or the system font dirs. No font
 * configured → nothing to generate with, noted and moved past (a brand
 * with hand-made logo files never needs one). Configured but not found →
 * error, the config intent failed.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { loadFont } = require('../lib/font-loader.js');
const { generateWordmark, generateCombomark } = require('../lib/svg-logo-generator.js');

module.exports = async function ensureLogoGen(context) {
  const { brandConfig, brandRoot, logoDir, brandmarkPath, options } = context;
  const dryRun = options?.dryRun || false;

  const brandName = brandConfig.brand.name;
  const fontName = brandConfig.brand.font;

  const wordmarkPath = join(logoDir, 'wordmark.svg');
  const combomarkPath = join(logoDir, 'combomark.svg');

  const missing = [
    ['wordmark', wordmarkPath],
    ['combomark', combomarkPath],
  ].filter(([, path]) => !jetpack.exists(path));

  if (missing.length === 0) {
    console.log(`      ${chalk.green('✓')} Logo sources ${chalk.dim('(wordmark + combomark)')} in sync`);
    return { output: { logos: { synced: true } } };
  }

  if (!fontName) {
    console.log(`      ${chalk.dim(`⊘ No brand.font configured — ${missing.map(([name]) => name).join(' + ')} not generated (set brand.font + a font file in assets/fonts/, or add the SVGs by hand)`)}`);
    return { output: { logos: { skipped: 'no brand.font' } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would generate ${missing.map(([name]) => chalk.cyan(`${name}.svg`)).join(' + ')}`);
    return { output: { logos: { planned: missing.map(([name]) => name) } } };
  }

  const font = loadFont(fontName, brandRoot);
  if (!font) {
    console.log(`      ${chalk.red('✗')} Font ${chalk.cyan(fontName)} not found in ${chalk.dim('assets/fonts/')} or the system font dirs`);
    return { status: 'error', error: `font "${fontName}" not found` };
  }

  const generated = [];

  for (const [name, path] of missing) {
    const svg = name === 'wordmark'
      ? generateWordmark(brandName, font)
      : generateCombomark(brandName, jetpack.read(brandmarkPath), font);
    jetpack.write(path, svg);
    console.log(`      ${chalk.green('✓')} Generated ${chalk.cyan(`${name}.svg`)}`);
    generated.push(name);
  }

  return { output: { logos: { generated } } };
};
