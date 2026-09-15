/**
 * brand-version: the brand's ONE version
 * ([#869](https://github.com/Omega-JS-Stack/omega/issues/869)).
 *
 * A brand root's `package.json` `version` is the master and every
 * `targets/<name>/package.json` follows it. Targets keep a real `version`
 * field because every tool reads it there (electron-builder, the extension
 * manifest, npm), so nothing needs plumbing in dev or CI; what they never do
 * is move on their own.
 *
 * Two halves, one rule:
 *   - `bumpBrandVersion` is the ONE writer, behind `omega bump` at the brand
 *     root. It never commits and never tags: the ship flow owns the
 *     `chore(release)` commit.
 *   - `assertBrandVersion` is the gate every framework's `omega deploy` runs
 *     before its secrets precheck, so a target that drifted is refused before
 *     anything is published or published to.
 *
 * Twin in shape of the manager's `assertFamilyVersions`
 * ([#794](https://github.com/Omega-JS-Stack/omega/issues/794)), which refuses a
 * mixed @omega.js FAMILY. Same verdict, different subject: that one is about
 * the framework packages a brand installed, this one about the brand's own
 * release number.
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const { resolveBrandRoot } = require('@omega.js/config');
const Logger = require('./logger.js');

const defaultLogger = new Logger('brand-version');

// What `omega bump` takes, in the order it prints them.
const KINDS = ['patch', 'minor', 'major'];

// A plain release number and nothing else: a prerelease tag is refused by name
// rather than guessed at (which digit does `patch` move on `1.0.0-beta.2`?).
const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * A refusal: crafted text a human is meant to read, flagged so every surface
 * prints it the same way (the message alone, nothing added), the same shape
 * scaffold-guard's refusals take.
 *
 * @param {string} message - The lines to print verbatim.
 * @returns {Error} The flagged error to throw.
 */
function refusal(message) {
  const error = new Error(message);
  error.refusal = true;
  return error;
}

/**
 * The brand's version, resolved from anywhere inside the brand.
 *
 * @param {object} options
 * @param {string} options.dir - Any directory inside the brand (root or target).
 * @returns {{ brandRoot: string, version: string }|null} null when `dir` is not inside a brand.
 * @throws {Error} A refusal when the brand root carries no `version`: the
 *   master number cannot be defaulted, or every target would follow a guess.
 */
function readBrandVersion({ dir }) {
  const brandRoot = resolveBrandRoot(dir);
  if (!brandRoot) return null;

  const manifest = path.join(brandRoot, 'package.json');
  const version = (jetpack.read(manifest, 'json') || {}).version;

  if (!version) {
    throw refusal(
      `${manifest} carries no "version", and the brand root is the one version every target follows (#869).\n`
      + `  fix: add "version" to ${manifest}, then run \`omega bump\` at the brand root`,
    );
  }

  return { brandRoot, version };
}

/**
 * Every target that carries a package.json, by name. A directory under
 * `targets/` with no manifest is not a target (the manager's `discoverTargets`
 * rule), and the list is sorted so a bump's output reads the same every run.
 *
 * @param {object} options
 * @param {string} options.brandRoot - Brand monorepo root.
 * @returns {Array<{ name: string, dir: string, manifest: string }>}
 */
function listTargetPackages({ brandRoot }) {
  const targetsDir = path.join(brandRoot, 'targets');

  return (jetpack.list(targetsDir) || [])
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => ({
      name,
      dir: path.join(targetsDir, name),
      manifest: path.join(targetsDir, name, 'package.json'),
    }))
    .filter((entry) => jetpack.exists(entry.manifest) === 'file');
}

/**
 * The next release number for a kind.
 *
 * @param {string} previous - The brand's current version.
 * @param {'patch'|'minor'|'major'} kind - Which digit moves.
 * @returns {string} The next version.
 * @throws {Error} A refusal when `previous` is not a plain release number.
 */
function nextVersion(previous, kind) {
  const parts = RELEASE.exec(String(previous));

  if (!parts) {
    throw refusal(
      `the brand version "${previous}" is not a plain major.minor.patch, and \`omega bump\` moves whole releases with no prerelease handling.\n`
      + '  fix: set a plain version in the brand root package.json first',
    );
  }

  const [major, minor, patch] = parts.slice(1).map(Number);

  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The same content with `version` set, gaining the key after `name` when the
 * file never had one, so a target's first bump reads like every sibling's
 * manifest instead of appending a stray key at the end.
 *
 * @param {object} content - The parsed manifest (or lock entry).
 * @param {string} next - The version to write.
 * @returns {object} The content to write back.
 */
function withVersion(content, next) {
  if (content.version !== undefined) return { ...content, version: next };

  const updated = content.name === undefined ? { version: next } : {};
  for (const [key, value] of Object.entries(content)) {
    updated[key] = value;
    if (key === 'name') updated.version = next;
  }

  return updated;
}

/**
 * Write a JSON file the way npm writes them: 2-space indent, trailing newline.
 *
 * @param {string} file - Where to write.
 * @param {object} content - What to write.
 * @returns {void}
 */
function writeJson(file, content) {
  jetpack.write(file, `${JSON.stringify(content, null, 2)}\n`);
}

/**
 * Move the brand and every target onto the next version. The ONE writer.
 *
 * Writes the brand root manifest, every target manifest (a target with no
 * `version` GAINS one: every target follows), and the brand lock's entry for
 * each target plus its own root version where the lock carries one, since a
 * lock left behind would have `npm ci` install the old number.
 *
 * @param {object} options
 * @param {string} options.brandRoot - Brand monorepo root.
 * @param {'patch'|'minor'|'major'} options.kind - Which digit moves.
 * @param {object} [options.logger] - Where the per-file lines go.
 * @returns {{ previous: string, next: string, files: string[] }} Paths relative to the brand root.
 * @throws {Error} A refusal on an unknown kind, a missing root version, or a prerelease one.
 */
function bumpBrandVersion({ brandRoot, kind, logger = defaultLogger }) {
  if (!KINDS.includes(kind)) {
    throw refusal(`\`omega bump\` takes ${KINDS.join(', ')}, and "${kind}" is none of them.`);
  }

  const previous = readBrandVersion({ dir: brandRoot }).version;
  const next = nextVersion(previous, kind);
  const files = [];

  // One line per file, always `<old> -> <new>`; a file that had no version
  // says so rather than printing an empty left-hand side.
  const write = (file, old) => {
    const relative = path.relative(brandRoot, file);
    files.push(relative);
    logger.log(`${relative} ${old || '(none)'} -> ${next}`);
  };

  const rootManifest = path.join(brandRoot, 'package.json');
  writeJson(rootManifest, withVersion(jetpack.read(rootManifest, 'json'), next));
  write(rootManifest, previous);

  const targets = listTargetPackages({ brandRoot });

  for (const target of targets) {
    const content = jetpack.read(target.manifest, 'json');
    writeJson(target.manifest, withVersion(content, next));
    write(target.manifest, content.version);
  }

  const lockPath = path.join(brandRoot, 'package-lock.json');
  const lock = jetpack.exists(lockPath) === 'file' ? jetpack.read(lockPath, 'json') : null;

  if (lock && lock.packages) {
    for (const target of targets) {
      const key = `targets/${target.name}`;
      if (lock.packages[key]) lock.packages[key] = withVersion(lock.packages[key], next);
    }

    // The lock's own root number exists only when npm wrote one, and npm
    // writes it from the root manifest: where it is absent, the next install
    // is what puts it there.
    if (lock.version) lock.version = next;
    if (lock.packages[''] && lock.packages[''].version) lock.packages[''].version = next;

    writeJson(lockPath, lock);
    write(lockPath, previous);
  }

  return { previous, next, files };
}

/**
 * The deploy gate: refuse a target whose version has drifted from the brand's.
 *
 * Read-only, so every lane runs it (`--direct` and `--dry-run` included), and
 * it runs BEFORE the secrets precheck: a drifted target must not push its
 * secrets and dispatch a build of the wrong number. A match says nothing.
 *
 * @param {object} options
 * @param {string} options.dir - The target directory being deployed.
 * @returns {{ brandRoot: string, name: string, version: string }|null} null when there is nothing to compare.
 * @throws {Error} A refusal naming the target and `omega bump`.
 */
function assertBrandVersion({ dir }) {
  const brandRoot = resolveBrandRoot(dir);
  if (!brandRoot) return null;

  // Only a target follows the brand. A brand root, or any other directory
  // inside the brand, has nothing of its own to compare.
  const segments = path.relative(brandRoot, path.resolve(dir)).split(path.sep);
  if (segments[0] !== 'targets' || !segments[1]) return null;

  const name = segments[1];
  const manifest = path.join(brandRoot, 'targets', name, 'package.json');
  if (jetpack.exists(manifest) !== 'file') return null;

  const found = (jetpack.read(manifest, 'json') || {}).version;
  const { version } = readBrandVersion({ dir: brandRoot });

  if (found !== version) {
    throw refusal(
      `targets/${name} ${found ? `is ${found}` : 'has no version'} but the brand is ${version}; `
      + 'run `omega bump` at the brand root (#869).',
    );
  }

  return { brandRoot, name, version };
}

module.exports = { readBrandVersion, listTargetPackages, bumpBrandVersion, assertBrandVersion, KINDS };
