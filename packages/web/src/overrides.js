/**
 * The layered override map (#94) — what `omega customize --list` prints and
 * what `omega customize <path>` materializes.
 *
 * A consumer overrides a framework file by OWNING the same relative path; until
 * now nothing listed those paths, so restyling one section meant reading the
 * theme source tree. This module answers both questions from the SAME layer
 * chains the build resolves through (`resolveThemeLayers` + `collectProviders`
 * in ./layers.js) — never a second table of layer order:
 *
 * - sections/components — consumer → active theme → base (engine.js hands
 *   registerSectionTags exactly these bases; core owns no entries). Resolution
 *   is per ENTRY, not per file: the layer owning `section.html` wins the whole
 *   folder unless the winner declares `inherit` (docs/web/sections.md), so a
 *   materialized asset file carries that note.
 * - includes — consumer → theme layers → core (engine.js includeRoots).
 * - css — ONLY `main.scss`, the one stylesheet the sass layer chain RESOLVES
 *   (assets.js): the first layer that ships one wins, and it extends the layers
 *   below with `@use 'omega:main'`. Page and layout sheets are deliberately
 *   absent (#624): every layer's sheet for a key loads, so a consumer's copy
 *   shadows nothing — materializing one would duplicate every rule it carries
 *   rather than replace it. Every other stylesheet is reached by a bare relative
 *   `@import`/`@use`, which Dart Sass resolves relative to the IMPORTING file
 *   before any loadPath — a consumer copy of `css/base/_utilities.scss` never
 *   loads. Listing either kind would hand a consumer a file that does the wrong
 *   thing, so the map lists neither. Paths carry the `assets/` prefix because
 *   the consumer's css layer root is `src/assets`.
 * - pages — the URL-addressable default pages, straight from ./customize.js's
 *   listCustomizable (the page lane keeps its own two materialize modes).
 *
 * Every non-page path in the map is CONSUMER-RELATIVE (`src/`), so the string
 * `--list` prints is the string `omega customize <path>` takes and the place
 * the copy lands.
 */
const fs = require('node:fs');
const path = require('node:path');
const { collectProviders, resolveThemeLayers } = require('./layers.js');
const { listCustomizable } = require('./customize.js');
const { PATHS } = require('./paths.js');

// The one css lane the sass build RESOLVES by layer (assets.js).
const CSS_MAIN = /^main\.scss$/;
// Section entries are folders of these four files.
const SECTION_ENTRY = /^(?:.*\/)?(section|component)\.(html|scss|js|json5)$/;

/**
 * The ordered layer roots per lane, labelled by owning layer.
 * @param {object} options
 * @param {string} options.consumerDir - the consumer's src dir
 * @param {object} [options.siteData] - resolved config (theme.id names the active theme)
 * @returns {Array<{ kind: string, subdirs: string[], prefix: string, roots: Array<{dir: string, layer: string}>, filter: RegExp|undefined }>}
 */
function overrideLanes({ consumerDir, siteData }) {
  const themeRoots = resolveThemeLayers({
    activeTheme: siteData?.theme?.id,
    consumerDir,
    themesDir: PATHS.themes,
  }).map((dir) => ({ dir, layer: `theme:${path.basename(dir)}` }));

  const consumer = { dir: consumerDir, layer: 'consumer' };
  const consumerAssets = { dir: path.join(consumerDir, 'assets'), layer: 'consumer' };
  const core = { dir: PATHS.core, layer: 'framework' };

  return [
    { kind: 'section', subdirs: ['_sections', '_components'], prefix: '', roots: [consumer, ...themeRoots], filter: SECTION_ENTRY },
    { kind: 'include', subdirs: ['_includes'], prefix: '', roots: [consumer, ...themeRoots, core], filter: undefined },
    // main.scss layers across the whole chain — the one sheet a consumer copy
    // takes over rather than joins
    { kind: 'css', subdirs: ['css'], prefix: 'assets/', roots: [consumerAssets, ...themeRoots, core], filter: CSS_MAIN },
  ];
}

/**
 * Every shadowable file, with its owning layer and whether the consumer
 * already shadows it.
 * @param {object} options
 * @param {string} options.consumerDir - the consumer's src dir
 * @param {object} [options.siteData]
 * @returns {Array<object>} entries — { kind, path, layer, shadowed, source, shadows, target }
 */
function buildOverrideMap({ consumerDir, siteData }) {
  const entries = [];

  for (const lane of overrideLanes({ consumerDir, siteData })) {
    const layerOf = new Map();
    for (const root of lane.roots) {
      for (const subdir of lane.subdirs) layerOf.set(path.join(root.dir, subdir), root.layer);
    }

    for (const subdir of lane.subdirs) {
      const dirs = lane.roots.map((root) => path.join(root.dir, subdir));

      for (const [rel, providers] of collectProviders(dirs, lane.filter)) {
        const stack = providers.map(({ dir, file }) => ({ layer: layerOf.get(dir), file }));
        const shadowPath = `${lane.prefix}${path.join(subdir, rel)}`;
        const framework = stack.find((provider) => provider.layer !== 'consumer') || null;

        entries.push({
          kind: lane.kind,
          path: shadowPath,
          layer: stack[0].layer,
          shadowed: stack[0].layer === 'consumer',
          // What a materialize would copy: the file the consumer would shadow
          source: framework && framework.file,
          shadows: stack.slice(1).map((provider) => provider.layer),
          target: path.join(consumerDir, shadowPath),
        });
      }
    }
  }

  // Pages keep their own lane — URL-addressable, two materialize modes
  for (const page of listCustomizable({ consumerDir, siteData })) {
    entries.push({
      kind: 'page',
      path: page.url,
      layer: page.owned ? 'consumer' : 'framework',
      shadowed: Boolean(page.owned),
      lane: page.lane,
      source: null,
      shadows: [],
      target: page.owned || null,
    });
  }

  return entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
}

/**
 * The provenance header for a materialized file, in the file's own comment
 * syntax. JSON carries no comments, so it gets none.
 * The first line opens with the `omega:consumer-override:` marker on purpose
 * ([#452](https://github.com/Omega-JS-Stack/omega/issues/452)): a materialize
 * IS the deliberate consumer copy, so the omega:guard hook — which reads the
 * first five lines — has to see it declared without anybody typing it back in.
 * @param {object} entry - a map entry
 * @param {string[]} [notes] - extra lines
 * @returns {string} the header (empty when the format has no comment form)
 */
function provenanceHeader(entry, notes = []) {
  const lines = [
    `omega:consumer-override: materialized by omega customize ${entry.path} — a copy of the ${entry.layer} layer's file.`,
    'This consumer file now SHADOWS it. Delete it to return to the framework\'s.',
    ...notes,
  ];
  const extension = path.extname(entry.path);

  if (['.html', '.liquid', '.md'].includes(extension)) {
    return `{% comment %}\n${lines.map((line) => `  ${line}`).join('\n')}\n{% endcomment %}\n`;
  }
  if (['.scss', '.css', '.js', '.json5'].includes(extension)) {
    return `${lines.map((line) => `// ${line}`).join('\n')}\n`;
  }
  return '';
}

/**
 * Materialize ONE shadowable file into the consumer tree. Idempotent: an
 * existing consumer file is never overwritten — the caller is told it exists.
 * @param {object} options
 * @param {string} options.path - a map path (`_includes/…`, `assets/css/…`)
 * @param {string} options.consumerDir
 * @param {object} [options.siteData]
 * @returns {object} { status: 'created'|'exists'|'unknown', ... }
 */
function materializeOverride({ path: shadowPath, consumerDir, siteData }) {
  const wanted = String(shadowPath || '').trim().replace(/^\.?\//, '');
  const map = buildOverrideMap({ consumerDir, siteData });
  const entry = map.find((candidate) => candidate.kind !== 'page' && candidate.path === wanted);

  if (!entry) return { status: 'unknown', path: wanted, known: map.filter((c) => c.kind !== 'page').map((c) => c.path) };
  if (entry.shadowed || fs.existsSync(entry.target)) return { ...entry, status: 'exists' };

  // Sections resolve per entry: shadowing an asset lane alone changes nothing
  // unless the winning section.html moves too (or declares inherit).
  const notes = entry.kind === 'section' && !/\.html$/.test(entry.path)
    ? [
      'Sections resolve per ENTRY: the layer owning section.html wins the whole',
      'folder. Shadow the entry\'s .html too, or declare `inherit` in its json5.',
    ]
    : [];

  const header = provenanceHeader(entry, notes);
  fs.mkdirSync(path.dirname(entry.target), { recursive: true });
  fs.writeFileSync(entry.target, header + fs.readFileSync(entry.source, 'utf8'));

  return { ...entry, status: 'created', headed: Boolean(header) };
}

module.exports = { buildOverrideMap, materializeOverride, overrideLanes };
