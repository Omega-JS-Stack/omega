/**
 * Signing-artifact delivery — the copy layer of the ONE delivery step (#678).
 *
 * Sources are the certificates service's outputs under a signing tree,
 * `<sourceRoot>/.omega/certificates/apple/` (the company workspace's root for
 * a company-managed brand, the brand root otherwise); destinations are the
 * target's own certs dir (desktop: config/certs/ per EM v1.4.1+, mobile:
 * build/certs/). Copies are byte-compared first, so a converged run rewrites
 * nothing, and every certs dir gets a self-protecting .gitignore (`*`) — signing
 * material can never be committed, even in a target the framework's setup
 * hasn't touched yet.
 *
 * Delivery is WARN-ONLY on a miss: a rule with no source reports `missing` and
 * leaves the dest alone. The dests are documented HUMAN drop points (desktop's
 * signing docs tell an operator to copy their .p12/.p8 straight into
 * config/certs/), and `omega company init` scaffolds the signing tree EMPTY —
 * so a delete-on-missing pass would eat hand-placed signing material on the
 * next build.
 *
 * This module DELIVERS and reports; it logs nothing and classifies nothing.
 * Which misses are tolerable (`optional`) is on the rules, which callers read
 * through resolveCertRules — the manager's disperse writer turns them into its
 * per-rule lines, a desktop build into whatever its own voice is.
 */
const { join, dirname } = require('node:path');
const jetpack = require('fs-jetpack');

// Paths: source relative to .omega/certificates/apple/, dest relative to the
// target dir. `{env.VAR}` and `{brand.id}` placeholders supported on both sides.
const CERT_FILE_MAP = {
  desktop: [
    // macOS code signing — Developer ID Application (.p12 with private key)
    {
      source: 'certificates/DEVELOPER_ID_APPLICATION_G2.p12',
      dest: 'config/certs/developer-id-application.p12',
    },
    // macOS installer signing (only used if shipping a .pkg installer)
    {
      source: 'certificates/DEVELOPER_ID_INSTALLER_G2.p12',
      dest: 'config/certs/developer-id-installer.p12',
      optional: true,
    },
    // Notarization API key — App Store Connect .p8
    {
      source: 'AuthKey_{env.APPLE_API_KEY_ID}.p8',
      dest: 'config/certs/AuthKey_{env.APPLE_API_KEY_ID}.p8',
    },
    // Per-brand provisioning profile (only present if cert generation produced one)
    {
      source: 'profiles/{brand.id}/DEVELOPER_ID_APPLICATION_G2/MACOS.mobileprovision',
      dest: 'config/certs/{brand.id}.provisionprofile',
      optional: true,
    },
  ],
  mobile: [
    // iOS App Store distribution — used by xcodebuild
    {
      source: 'certificates/IOS_DISTRIBUTION.p12',
      dest: 'build/certs/ios-distribution.p12',
    },
    // Notarization / API access from CI
    {
      source: 'AuthKey_{env.APPLE_API_KEY_ID}.p8',
      dest: 'build/certs/AuthKey_{env.APPLE_API_KEY_ID}.p8',
    },
    // Per-brand iOS provisioning profile
    {
      source: 'profiles/{brand.id}/IOS_DISTRIBUTION/IOS.mobileprovision',
      dest: 'build/certs/{brand.id}.mobileprovision',
      optional: true,
    },
  ],
};

/**
 * Resolve `{env.VAR}` and `{brand.key}` placeholders. Returns null when an
 * env placeholder is unset — the rule can't produce a real path, and a
 * literal `AuthKey_.p8` miss would only confuse.
 */
function resolveTemplate(template, brand) {
  let missing = false;

  const resolved = template.replace(/\{([^}]+)\}/g, (match, path) => {
    const [source, ...keyParts] = path.split('.');
    const key = keyParts.join('.');
    if (source === 'env') {
      const value = process.env[key] || '';
      if (!value) missing = true;
      return value;
    }
    if (source === 'brand') return brand?.[key] || '';
    return match;
  });

  return missing ? null : resolved;
}

/**
 * Ensure the certs dir ignores everything it holds — signing material must
 * never land in git, regardless of whether the framework's own .gitignore
 * exists yet.
 */
function ensureCertsIgnore(destDir) {
  const ignorePath = join(destDir, '.gitignore');
  if (!jetpack.exists(ignorePath)) {
    jetpack.write(ignorePath, '*\n!.gitignore\n');
  }
}

/**
 * The signing tree a source root holds — the ONE home of that path.
 *
 * @param {string} sourceRoot - Company root (company-managed brands) or brand root.
 * @returns {string} Absolute path to .omega/certificates/apple/.
 */
function certsSourceDir(sourceRoot) {
  return join(sourceRoot, '.omega', 'certificates', 'apple');
}

/**
 * A target's signing rules with their placeholders resolved.
 *
 * @param {object} input
 * @param {string} input.target - Target type ('desktop'/'mobile'); anything
 *   else has no signing rules and returns [].
 * @param {object} [input.brand] - Brand config block (`{brand.id}` resolves from it).
 * @returns {Array<{ source, dest, optional, sourceRel, destRel }>} `sourceRel`/
 *   `destRel` are null when an env placeholder is unset; `dest` is the template.
 */
function resolveCertRules({ target, brand = null }) {
  return (CERT_FILE_MAP[target] || []).map((rule) => {
    const sourceRel = resolveTemplate(rule.source, brand);
    const destRel = sourceRel === null ? null : resolveTemplate(rule.dest, brand);

    return {
      source: rule.source,
      dest: rule.dest,
      optional: !!rule.optional,
      sourceRel,
      destRel,
    };
  });
}

/**
 * Copy a target's signing artifacts out of the signing tree.
 *
 * @param {object} input
 * @param {string} input.sourceRoot - Company root or brand root holding .omega/certificates/apple/.
 * @param {string} input.targetDir - The target's own directory (destinations resolve inside it).
 * @param {string} input.target - Target type ('desktop'/'mobile').
 * @param {object} [input.brand] - Brand config block, for `{brand.id}` rules.
 * @param {boolean} [input.dryRun] - Plan only: `copied` says what WOULD be
 *   written, nothing is written.
 * @returns {{ copied: string[], current: string[], missing: string[] }}
 *   Target-relative paths — copied (written this pass), current (already
 *   byte-identical), missing (no source, or an unresolved placeholder: that rule
 *   reports its dest TEMPLATE).
 */
function deliverCerts({ sourceRoot, targetDir, target, brand = null, dryRun = false }) {
  const appleDir = certsSourceDir(sourceRoot);
  const copied = [];
  const current = [];
  const missing = [];

  for (const rule of resolveCertRules({ target, brand })) {
    // An unset env placeholder (e.g. APPLE_API_KEY_ID) means the rule has no
    // real path to resolve to — it reports its template, which names the gap
    if (rule.destRel === null) {
      missing.push(rule.dest);
      continue;
    }

    const destPath = join(targetDir, rule.destRel);
    const sourcePath = join(appleDir, rule.sourceRel);
    if (!jetpack.exists(sourcePath)) {
      missing.push(rule.destRel);
      continue;
    }

    const sourceBytes = jetpack.read(sourcePath, 'buffer');
    const destBytes = jetpack.exists(destPath) ? jetpack.read(destPath, 'buffer') : null;

    if (destBytes && sourceBytes.equals(destBytes)) {
      current.push(rule.destRel);
      continue;
    }

    copied.push(rule.destRel);
    if (dryRun) continue;

    jetpack.copy(sourcePath, destPath, { overwrite: true });
    ensureCertsIgnore(dirname(destPath));
  }

  return { copied, current, missing };
}

module.exports = { deliverCerts, resolveCertRules, certsSourceDir, CERT_FILE_MAP };
