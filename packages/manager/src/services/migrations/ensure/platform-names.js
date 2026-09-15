/**
 * Platform-names migration ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
 * the brand-data half of ONE platform vocabulary. OMEGA says `mac`, `windows`,
 * `linux` everywhere it speaks for itself, and what a target ships is declared
 * per FORMAT, so two things a brand may still carry are retired keys that
 * nothing reads:
 *
 *   platforms.win.*               → platforms.windows.*
 *   platforms.linux.snap.*        → platforms.linux.formats.snap.*
 *   config/icons/macos/<slot>.png → config/icons/mac/<slot>.png
 *
 * Neither key failed anything before: a brand still saying `win` got the
 * framework's default Windows installer settings with its own silently ignored,
 * and a brand still saying `snap: { enabled: true }` published no snap at all.
 * The validator errors on both now (@omega.js/config's retired-keys table), and
 * this is the fix, run ONCE by hand rather than healed inside every run:
 *
 *   npx omega manage --migration=platform-names            # prints the plan, writes nothing
 *   npx omega manage --migration=platform-names --execute  # performs it
 *
 * `snap.enabled: false` becomes `formats.snap: false`, because presence IS the
 * switch now. Every other snap setting (channels, confinement, grade,
 * autoStart) travels into the format unchanged.
 *
 * Every omega.json5 a brand owns is swept, not just the root one: the brand
 * file (where the keys live under `targets.<name>`) and each target's own
 * local-layer file (where they live at the top level). The icon dirs are swept
 * the same way, since a desktop target keeps its icons in its own
 * `config/icons/`.
 *
 * Unlike its Firestore siblings this migration touches only the brand's own
 * files, so it runs without a service account (`local: true`). Idempotent by
 * construction: a converged brand carries neither key and reports a clean
 * no-op.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

const { resolveConfigPath, writeConfigValues, removeConfigValues } = require('@omega.js/config');

const MIGRATION_NAME = 'platform-names';
const LEGACY_ICON_DIR = join('config', 'icons', 'macos');
const ICON_DIR = join('config', 'icons', 'mac');

/**
 * Every directory that can own an omega.json5 and an icon dir: the brand root
 * and each of its targets.
 *
 * @param {string} brandRoot - Absolute brand-monorepo root
 * @returns {string[]} Absolute dirs, the brand root first
 */
function configDirs(brandRoot) {
  const targetsRoot = join(brandRoot, 'targets');
  const targets = jetpack.exists(targetsRoot) === 'dir' ? jetpack.list(targetsRoot) || [] : [];

  return [brandRoot, ...targets.map((name) => join(targetsRoot, name))]
    .filter((dir) => jetpack.exists(dir) === 'dir');
}

/**
 * The prefixes a `platforms` block can sit under in one authored file: the top
 * level (a target's own file) and each declared target (the brand file).
 *
 * @param {object} authored - The parsed omega.json5
 * @returns {string[]} Dot-path prefixes ('' for the top level)
 */
function platformPrefixes(authored) {
  const prefixes = authored.platforms ? [''] : [];
  const targets = authored.targets;

  if (targets && typeof targets === 'object' && !Array.isArray(targets)) {
    for (const [name, entry] of Object.entries(targets)) {
      if (entry && typeof entry === 'object' && entry.platforms) prefixes.push(`targets.${name}.`);
    }
  }

  return prefixes;
}

/**
 * The moves one authored file owes: the new path, the value it lands with, and
 * the retired path that goes away.
 *
 * @param {object} authored - The parsed omega.json5
 * @returns {Array<{ from: string, to: string, value: * }>}
 */
function planFile(authored) {
  const moves = [];

  for (const prefix of platformPrefixes(authored)) {
    const platforms = prefix
      ? authored.targets[prefix.split('.')[1]].platforms
      : authored.platforms;

    if (platforms.win !== undefined) {
      moves.push({ from: `${prefix}platforms.win`, to: `${prefix}platforms.windows`, value: platforms.win });
    }

    const snap = platforms.linux && typeof platforms.linux === 'object' ? platforms.linux.snap : undefined;
    if (snap !== undefined) {
      // Presence is the switch now, so the old `enabled` flag has no home: an
      // explicitly disabled snap becomes the literal `false` that drops it, and
      // an enabled one keeps only its real settings.
      const { enabled, ...settings } = snap && typeof snap === 'object' ? snap : {};
      const value = snap === false || enabled === false ? false : settings;

      moves.push({ from: `${prefix}platforms.linux.snap`, to: `${prefix}platforms.linux.formats.snap`, value });
    }
  }

  return moves;
}

/**
 * Platform-names migration handler.
 *
 * @param {Object} context - Handler context ({ brandRoot, options })
 * @returns {Object} `{ output }`: the plan, or what was performed
 */
module.exports = async function ensurePlatformNames(context) {
  const { brandRoot, options = {} } = context;
  const execute = options.execute === true;

  const files = [];
  const icons = [];

  for (const dir of configDirs(brandRoot)) {
    const configPath = resolveConfigPath(dir);
    if (configPath) {
      const moves = planFile(JSON5.parse(jetpack.read(configPath)));
      if (moves.length > 0) files.push({ dir, configPath, moves });
    }

    if (jetpack.exists(join(dir, LEGACY_ICON_DIR)) === 'dir') icons.push(dir);
  }

  if (files.length === 0 && icons.length === 0) {
    console.log(`      ${chalk.green('✓')} Already on the one platform vocabulary ${chalk.dim('(mac, windows, linux; formats declared per platform)')}`);
    return { output: { platformNames: { migrated: false } } };
  }

  // ── The plan, printed the same way in both modes ──────────────────────────
  for (const file of files) {
    for (const move of file.moves) {
      console.log(`      ${chalk.dim('→')} ${chalk.dim(`${file.configPath}:`)} ${chalk.cyan(move.from)} ${chalk.dim('→')} ${chalk.cyan(move.to)}${move.value === false ? chalk.dim(' (dropped: `false`)') : ''}`);
    }
  }
  for (const dir of icons) {
    console.log(`      ${chalk.dim('→')} ${chalk.dim(`${dir}:`)} ${chalk.cyan(`${LEGACY_ICON_DIR}/`)} ${chalk.dim('→')} ${chalk.cyan(`${ICON_DIR}/`)}`);
  }

  const moved = files.flatMap((file) => file.moves.map((move) => move.from));

  if (!execute) {
    console.log(`      ${chalk.yellow('[AUDIT]')} Nothing rewritten ${chalk.dim('(--execute to perform it)')}`);
    return { output: { platformNames: { audit: true, keys: moved, icons } } };
  }

  for (const file of files) {
    // Write the new paths first, then delete the retired ones: the value has to
    // exist in its new home before the old key goes.
    writeConfigValues(file.dir, Object.fromEntries(file.moves.map((move) => [move.to, move.value])));
    removeConfigValues(file.dir, file.moves.map((move) => move.from));
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(file.configPath)} ${chalk.dim(`(${file.moves.length} key(s))`)}`);
  }

  for (const dir of icons) {
    jetpack.move(join(dir, LEGACY_ICON_DIR), join(dir, ICON_DIR));
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(join(dir, ICON_DIR))}`);
  }

  return { output: { platformNames: { migrated: true, keys: moved, icons } } };
};

module.exports.MIGRATION_NAME = MIGRATION_NAME;
module.exports.LEGACY_ICON_DIR = LEGACY_ICON_DIR;
module.exports.ICON_DIR = ICON_DIR;
module.exports.planFile = planFile;
