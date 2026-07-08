/**
 * Generate social profile icons — the square brandmark centered on a
 * white background with padding, for profile pictures (YouTube, Twitter,
 * …) — as a wrapped SVG + PNGs into `.omega/assets/social/brandmark/`.
 * mtime-diffed against the brandmark.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const sharp = require('sharp');
const { SOCIAL_ICON_CONFIG } = require('../lib/assets-config.js');
const { isStale } = require('../../../lib/stale.js');

module.exports = async function writeSocialIcons(context) {
  const { brandmarkPath, outDir, options } = context;
  const dryRun = options?.dryRun || false;

  const { outputDir: subDir, sizes, padding, background } = SOCIAL_ICON_CONFIG;
  const outputDir = join(outDir, subDir);

  const targets = [
    'color-x.svg',
    ...sizes.map((size) => `color-${size}.png`),
  ].filter((name) => isStale(brandmarkPath, join(outputDir, name)));

  if (targets.length === 0) {
    console.log(`      ${chalk.green('✓')} Social icons in sync ${chalk.dim(`(${1 + sizes.length} files fresh)`)}`);
    return { output: { socialIcons: { synced: true } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would generate ${chalk.cyan(targets.length)} social icon files`);
    return { output: { socialIcons: { planned: targets.length } } };
  }

  const svgContent = jetpack.read(brandmarkPath);
  let generated = 0;

  for (const name of targets) {
    const outputPath = join(outputDir, name);

    if (name.endsWith('.svg')) {
      jetpack.write(outputPath, wrapSvgWithBackground(svgContent, padding, background));
      generated++;
      continue;
    }

    const size = parseInt(name.match(/-(\d+)\.png$/)[1], 10);
    const logoSize = Math.round(size * (1 - padding * 2));
    const offset = Math.round(size * padding);

    const logoPng = await sharp(Buffer.from(svgContent))
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    jetpack.dir(outputDir);
    await sharp({ create: { width: size, height: size, channels: 4, background } })
      .composite([{ input: logoPng, left: offset, top: offset }])
      .png()
      .toFile(outputPath);
    generated++;
  }

  console.log(`      ${chalk.green('✓')} Generated ${chalk.bold(generated)} social icon files`);
  return { output: { socialIcons: { generated } } };
};

/**
 * Wrap an SVG's content in a padded 1024×1024 canvas with a background
 * rect, preserving aspect ratio.
 */
function wrapSvgWithBackground(svgContent, paddingRatio, background) {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const widthMatch = svgContent.match(/<svg[^>]*\swidth="([^"]+)"/);
  const heightMatch = svgContent.match(/<svg[^>]*\sheight="([^"]+)"/);

  let srcWidth, srcHeight;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/);
    srcWidth = parseFloat(parts[2]);
    srcHeight = parseFloat(parts[3]);
  } else {
    srcWidth = parseFloat(widthMatch?.[1]) || 100;
    srcHeight = parseFloat(heightMatch?.[1]) || 100;
  }

  const canvasSize = 1024;
  const pad = canvasSize * paddingRatio;
  const availableSize = canvasSize - pad * 2;

  const scale = Math.min(availableSize / srcWidth, availableSize / srcHeight);
  const scaledWidth = srcWidth * scale;
  const scaledHeight = srcHeight * scale;
  const offsetX = pad + (availableSize - scaledWidth) / 2;
  const offsetY = pad + (availableSize - scaledHeight) / 2;

  const innerContent = svgContent
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');

  const bgHex = `#${[background.r, background.g, background.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}" width="${canvasSize}" height="${canvasSize}">
  <rect width="${canvasSize}" height="${canvasSize}" fill="${bgHex}"/>
  <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})">
    ${innerContent.trim()}
  </g>
</svg>`;
}
