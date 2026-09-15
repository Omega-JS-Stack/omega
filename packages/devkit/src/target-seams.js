/**
 * The per-target shape differences on the ONE secrets transport
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * `publishTargetSecrets` is the same call for every target; what differs is
 * three small things, and they live here rather than in four framework bind
 * files that each had to remember the contract:
 *
 *   resolveValue   applied to each collected value before it travels
 *   deriveValues   applied to the COMPOSED map before anything reads it, so a
 *                  key the brand never typed can still be valued (and a key it
 *                  could NOT value names its own fix line)
 *   extraSecrets   already-valued keys with no `.env` home at all
 *
 * devkit never requires a framework package, so nothing here imports desktop or
 * backend: the desktop derivation is devkit's own signing-env module (the same
 * one the desktop env load calls), and the backend credential is devkit's own
 * service-account lookup.
 */
const path = require('node:path');
const fs = require('node:fs');
const jetpack = require('fs-jetpack');
const { findBrandRoot } = require('@omega.js/config');

const { deriveSigningEnv, signingPathCandidates } = require('./signing-env.js');
const { resolveServiceAccountPath } = require('./service-account.js');

// The env schema's name for the backend deploy credential
// (`delivery: { backend: 'ci' }`): the service-account JSON itself, which the
// workflow writes back to disk.
const SERVICE_ACCOUNT_KEY = 'OMEGA_SERVICE_ACCOUNT_JSON';

// The walk that PRODUCES the signing material a derivation could not find.
const CERTIFICATES_WALK = 'omega manage --service certificates';

/**
 * Desktop's value seam: base64 for a value that names an existing file, the
 * value itself otherwise.
 *
 * The derived signing paths are ABSOLUTE (they point into the signing tree,
 * which lives outside the target), so an absolute value is resolved as given.
 * A RELATIVE one still resolves under the target root then the brand root,
 * because an operator may still type `CSC_LINK=config/certs/mine.p12` by hand.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @returns {function} `(value, key) => string`
 */
function fileValueResolver({ targetDir }) {
  const brandRoot = findBrandRoot(targetDir);

  return (value) => fileContentsBase64(value, { targetDir, brandRoot }) || value;
}

// The base64 contents of the file `value` names, or null when it names none.
// Heuristic: a path-shaped value (a separator, or a typical cert/key extension)
// that resolves to a real file. A path-shaped value that exists nowhere is
// pushed as-is: it is a string.
function fileContentsBase64(value, { targetDir, brandRoot }) {
  const looksLikePath = /[/\\]/.test(value) || /\.(p12|pem|cer|p8|provisionprofile|crt|key|json)$/i.test(value);
  if (!looksLikePath) return null;

  const roots = path.isAbsolute(value) ? [''] : [targetDir, brandRoot].filter(Boolean);
  for (const root of roots) {
    const absolute = path.isAbsolute(value) ? value : path.join(root, value);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return fs.readFileSync(absolute).toString('base64');
    }
  }

  return null;
}

/**
 * Desktop's COMPOSED-map seam: the signing paths the brand's signing tree
 * holds, by the SAME derivation the desktop env load runs, plus the fix line
 * each key the tree could not answer should carry.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @returns {function} `(values) => { derived, fixes }`
 */
function signingValueDeriver({ targetDir }) {
  return (values) => {
    const { derived, problems } = deriveSigningEnv({ env: values, targetDir });
    const problemFor = new Map(problems.map(({ key, reason }) => [key, reason]));

    const fixes = {};
    for (const { key, paths } of signingPathCandidates({ env: values, targetDir })) {
      if (values[key]) continue;

      fixes[key] = problemFor.has(key)
        ? `${problemFor.get(key)}. Fix it, then re-run.`
        : `no signing file at ${paths.join(' or ')}. Run \`${CERTIFICATES_WALK}\` to produce it, then re-run.`;
    }

    return { derived, fixes };
  };
}

/**
 * The backend's service-account secret, valued from the authored key chain. An
 * absent key publishes nothing: a brand that has not minted one yet deploys
 * from a runner that cannot authenticate, and the missing secret is what says
 * so.
 *
 * @param {string} targetDir - The target root.
 * @returns {Object<string, string>} The one-key map, or an empty one.
 */
function serviceAccountSecret(targetDir) {
  const keyPath = resolveServiceAccountPath(targetDir);
  const contents = keyPath ? jetpack.read(keyPath) : null;

  return contents ? { [SERVICE_ACCOUNT_KEY]: contents } : {};
}

// Target type to its seams. A type with no entry has none, which is web and the
// extension: plain string secrets, nothing to reshape.
const SEAMS = {
  desktop: ({ targetDir }) => ({
    resolveValue: fileValueResolver({ targetDir }),
    deriveValues: signingValueDeriver({ targetDir }),
  }),
  backend: ({ targetDir }) => ({
    extraSecrets: serviceAccountSecret(targetDir),
  }),
};

/**
 * The seams this target type brings to the publish.
 *
 * @param {object} input
 * @param {string} input.target - Target type ('desktop', 'backend', 'web', 'extension').
 * @param {string} input.targetDir - The target root.
 * @returns {{ resolveValue?: function, deriveValues?: function, extraSecrets?: object }}
 */
function targetSeams({ target, targetDir }) {
  const build = SEAMS[target];
  return build ? build({ targetDir }) : {};
}

module.exports = { targetSeams, fileValueResolver, signingValueDeriver, serviceAccountSecret, SERVICE_ACCOUNT_KEY };
