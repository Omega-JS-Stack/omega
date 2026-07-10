/**
 * PSD templates — seed the brand's editable Photoshop sources and keep
 * their derived PNGs current.
 *
 * Per TEMPLATE_CONFIG entry:
 *   1. `assets/templates/{name}.psd` missing in the brand repo → seed it
 *      from the company root's `assets/templates/` (company-managed
 *      brands only — the marker locates the company; omega-manager baked
 *      ITW's binaries into its own src/defaults/ instead)
 *   2. When the PSD or the brandmark is newer than the exports: replace
 *      the logo layers (brandmark rendered via sharp, black variant for
 *      tray templates) and text layers (brandConfig values, font shrunk
 *      to fit), write the PSD back, composite all visible layers, and
 *      export the PNGs into `.omega/assets/{outputDir}/`
 *
 * Manual Photoshop edits persist — editing the PSD bumps its mtime, so
 * the next run re-replaces the logo/text layers and re-exports. Note
 * that PSDs store each layer's raster: replaced TEXT content lands in
 * the layer metadata (Photoshop re-renders it on open), so a text change
 * appears in the exports after the PSD is opened + saved once. The logo
 * layers are re-rastered here, so they're always current. Converged
 * brands are zero-work (mtime-diffed like every assets operation).
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const sharp = require('sharp');
const { readPsd, writePsdBuffer, initializeCanvas } = require('ag-psd');
const canvasModule = require('canvas');
const { TEMPLATE_CONFIG } = require('../lib/assets-config.js');
const { convertSvgToBlack } = require('../lib/svg-to-black.js');
const { readCompanyMarker } = require('../../../lib/company.js');
const { isStale } = require('../../../lib/stale.js');

const { createCanvas, loadImage } = canvasModule;
initializeCanvas(createCanvas);

/**
 * Find a layer by slash-delimited path (e.g. 'Main/Logo/Logo') — walks
 * folders by name, falling back to the first child on the last segment.
 */
function findLayerByPath(psd, layerPath) {
  const segments = layerPath.split('/');
  let current = psd;

  for (let i = 0; i < segments.length; i++) {
    if (!current.children) {
      return null;
    }

    const segment = segments[i];
    const isLast = i === segments.length - 1;

    const found = current.children.find((l) => l.name === segment);
    if (found) {
      current = found;
      continue;
    }

    // Last segment: fall back to first child of current folder
    if (isLast && current.children.length > 0) {
      current = current.children[0];
      continue;
    }

    return null;
  }

  return current;
}

/**
 * Get a nested value from an object using dot notation (e.g. 'brand.name').
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

/**
 * Recursively composite all visible layers onto a canvas context — first
 * layer = bottom, last = top (Photoshop draw order).
 */
function compositeLayers(ctx, layers) {
  if (!layers) {
    return;
  }

  for (const layer of layers) {
    if (layer.hidden) {
      continue;
    }

    if (layer.children) {
      compositeLayers(ctx, layer.children);
      continue;
    }

    if (!layer.canvas) {
      continue;
    }

    ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  }
}

/**
 * Scale a text layer's font down until the text fits maxWidthPx (canvas
 * measurement). Updates the default style and all styleRuns
 * proportionally. Returns { from, to } when scaled, null otherwise.
 */
function fitTextFontSize(textData, maxWidthPx) {
  const originalSize = textData.style?.fontSize
    || textData.styleRuns?.[0]?.style?.fontSize;

  if (!originalSize) {
    return null;
  }

  const fontName = textData.style?.font?.name
    || textData.styleRuns?.[0]?.style?.font?.name
    || 'Arial';

  const measureCanvas = createCanvas(1, 1);
  const ctx = measureCanvas.getContext('2d');

  let fontSize = originalSize;
  ctx.font = `${fontSize}px "${fontName}"`;
  const width = ctx.measureText(textData.text).width;

  if (width <= maxWidthPx) {
    return null;
  }

  // Scale down proportionally, then step until it fits (rounding can
  // leave it slightly over)
  fontSize = Math.floor(fontSize * (maxWidthPx / width));
  ctx.font = `${fontSize}px "${fontName}"`;
  while (ctx.measureText(textData.text).width > maxWidthPx && fontSize > 4) {
    fontSize--;
    ctx.font = `${fontSize}px "${fontName}"`;
  }

  if (textData.style) {
    textData.style.fontSize = fontSize;
  }

  if (textData.styleRuns) {
    const scale = fontSize / originalSize;
    for (const run of textData.styleRuns) {
      if (run.style.fontSize) {
        run.style.fontSize = Math.floor(run.style.fontSize * scale);
      }
    }
  }

  return { from: originalSize, to: fontSize };
}

/**
 * Replace the configured logo/text layers in a parsed PSD.
 *
 * @returns {boolean} whether any layer was modified
 */
async function replaceLayers(psd, config, { brandConfig, brandmarkPath }) {
  const [canvasWidth, canvasHeight] = config.dimensions;
  let modified = false;

  for (const layerConfig of config.layers || []) {
    const layer = findLayerByPath(psd, layerConfig.path);
    if (!layer) {
      console.log(`      ${chalk.yellow('⚠')} Layer ${chalk.cyan(layerConfig.path)} not found in ${config.outputName} template`);
      continue;
    }

    if (layerConfig.type === 'logo') {
      const logoSize = Math.floor(layerConfig.size * canvasWidth);

      // Tray templates need the pure-black brandmark (macOS inverts it)
      let logoSource;
      if (layerConfig.useBlackLogo) {
        const sourceSvg = jetpack.read(brandmarkPath, 'utf8') || '';
        logoSource = Buffer.from(convertSvgToBlack(sourceSvg));
      } else {
        logoSource = brandmarkPath;
      }

      const logoPng = await sharp(logoSource)
        .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      const logoImage = await loadImage(logoPng);
      const logoCanvas = createCanvas(logoSize, logoSize);
      const ctx = logoCanvas.getContext('2d');
      ctx.drawImage(logoImage, 0, 0, logoSize, logoSize);
      layer.canvas = logoCanvas;

      // Center within bounds (or the full canvas without bounds)
      let left, top;
      if (layerConfig.bounds) {
        const [bLeftPct, bTopPct, bRightPct, bBottomPct] = layerConfig.bounds;
        const bLeft = Math.floor(bLeftPct * canvasWidth);
        const bTop = Math.floor(bTopPct * canvasHeight);
        const bRight = Math.floor(bRightPct * canvasWidth);
        const bBottom = Math.floor(bBottomPct * canvasHeight);
        left = bLeft + Math.floor((bRight - bLeft - logoSize) / 2);
        top = bTop + Math.floor((bBottom - bTop - logoSize) / 2);
      } else {
        left = Math.floor((canvasWidth - logoSize) / 2);
        top = Math.floor((canvasHeight - logoSize) / 2);
      }
      layer.left = left;
      layer.top = top;
      layer.right = left + logoSize;
      layer.bottom = top + logoSize;

      modified = true;
    } else if (layerConfig.type === 'text') {
      const value = getNestedValue(brandConfig, layerConfig.value);
      if (!value) {
        console.log(`      ${chalk.dim(`⊘ No ${layerConfig.value} configured — text layer ${layerConfig.path} left as-is`)}`);
        continue;
      }

      if (layer.text) {
        layer.text.text = value;

        if (layerConfig.maxWidth) {
          fitTextFontSize(layer.text, Math.floor(layerConfig.maxWidth * canvasWidth));
        }
      }

      modified = true;
    }
  }

  return modified;
}

module.exports = async function writeTemplates(context) {
  const { brandRoot, brandConfig, brandmarkPath, outDir, options } = context;
  const dryRun = options?.dryRun || false;

  const brandTemplatesDir = join(brandRoot, 'assets', 'templates');
  const marker = readCompanyMarker(brandRoot);
  const companyTemplatesDir = marker && !marker.stale
    ? join(marker.companyRoot, 'assets', 'templates')
    : null;

  let seeded = 0;
  let processed = 0;
  let fresh = 0;
  const missing = [];
  const planned = [];

  for (const [name, config] of Object.entries(TEMPLATE_CONFIG)) {
    const psdPath = join(brandTemplatesDir, `${name}.psd`);
    const companyPsdPath = companyTemplatesDir ? join(companyTemplatesDir, `${name}.psd`) : null;

    // Resolve the source: the brand's own PSD, else seed from the company
    let needsSeed = false;
    if (!jetpack.exists(psdPath)) {
      if (companyPsdPath && jetpack.exists(companyPsdPath)) {
        needsSeed = true;
      } else {
        missing.push(name);
        continue;
      }
    }

    // Staleness: every export must be newer than the PSD AND the brandmark
    const exportSpecs = config.exports || [{ suffix: '' }];
    const outPaths = exportSpecs.map((exp) => join(outDir, config.outputDir, `${config.outputName}${exp.suffix || ''}.png`));
    const stalePsd = needsSeed ? companyPsdPath : psdPath;
    const stale = needsSeed || outPaths.some((p) => isStale(stalePsd, p) || isStale(brandmarkPath, p));

    if (!stale) {
      fresh++;
      continue;
    }

    if (dryRun) {
      planned.push(needsSeed ? `${name} (seed + process)` : name);
      continue;
    }

    if (needsSeed) {
      jetpack.copy(companyPsdPath, psdPath);
      seeded++;
      console.log(`      ${chalk.green('✓')} Seeded ${chalk.cyan(`assets/templates/${name}.psd`)} from the company templates`);
    }

    try {
      const psd = readPsd(jetpack.read(psdPath, 'buffer'));
      const [canvasWidth, canvasHeight] = config.dimensions;

      const modified = await replaceLayers(psd, config, { brandConfig, brandmarkPath });

      if (modified) {
        jetpack.write(psdPath, writePsdBuffer(psd));
      }

      // Composite all visible layers and export the PNGs
      const compositeCanvas = createCanvas(canvasWidth, canvasHeight);
      compositeLayers(compositeCanvas.getContext('2d'), psd.children);
      const fullPngBuffer = compositeCanvas.toBuffer('image/png');

      for (const [i, exp] of exportSpecs.entries()) {
        const resized = exp.width && exp.height
          ? await sharp(fullPngBuffer).resize(exp.width, exp.height).png().toBuffer()
          : fullPngBuffer;
        jetpack.write(outPaths[i], resized);
      }

      processed++;
      console.log(`      ${chalk.green('✓')} Exported ${chalk.cyan(`${config.outputDir}/${config.outputName}.png`)}${modified ? '' : chalk.dim(' (no replaceable layers)')}`);
    } catch (error) {
      console.log(`      ${chalk.red('✗')} Failed to process ${chalk.cyan(`${name}.psd`)}${chalk.dim(`: ${error.message}`)}`);
      return { status: 'error', error: `template ${name}: ${error.message}` };
    }
  }

  if (dryRun && planned.length > 0) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would process: ${planned.join(', ')}`);
  }

  if (missing.length === Object.keys(TEMPLATE_CONFIG).length) {
    console.log(`      ${chalk.dim(`⊘ No PSD templates yet — add assets/templates/{name}.psd to the brand${companyTemplatesDir ? ' or the company root' : ''} (see TEMPLATE_CONFIG)`)}`);
  } else if (processed === 0 && seeded === 0 && planned.length === 0) {
    console.log(`      ${chalk.green('✓')} Templates ${chalk.dim(`(${fresh} fresh${missing.length ? `, ${missing.length} absent` : ''})`)} in sync`);
  }

  return {
    output: {
      templates: {
        seeded,
        processed,
        fresh,
        missing,
        ...(dryRun ? { planned } : {}),
      },
    },
  };
};
