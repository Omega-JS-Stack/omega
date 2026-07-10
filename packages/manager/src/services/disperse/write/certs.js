/**
 * Copy signing artifacts into desktop/mobile apps.
 *
 * Sources are the certificates service's outputs under
 * {brandRoot}/.omega/certificates/apple/; destinations are each app's certs
 * dir (desktop: config/certs/ per EM v1.4.1+, mobile: build/certs/). Copies
 * are byte-compared first so a converged run rewrites nothing. Every certs
 * dir gets a self-protecting .gitignore (`*`) so signing material can never
 * be committed, even in an app the framework's `mgr setup` hasn't touched.
 *
 * Optional rules skip silently when the source is missing; required rules
 * warn (the desktop/mobile build would be unsigned). A brand with no Apple
 * artifacts at all (certificates disabled or never run) is a quiet note,
 * not a warning.
 */
const { join, dirname } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

// Paths: source relative to .omega/certificates/apple/, dest relative to the
// app dir. `{env.VAR}` and `{brand.id}` placeholders supported on both sides.
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
      source: 'profiles/DEVELOPER_ID_APPLICATION_G2/MACOS.mobileprovision',
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
      source: 'profiles/IOS_DISTRIBUTION/IOS.mobileprovision',
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
 * (written by `mgr setup`) exists yet.
 */
function ensureCertsIgnore(destDir) {
  const ignorePath = join(destDir, '.gitignore');
  if (!jetpack.exists(ignorePath)) {
    jetpack.write(ignorePath, '*\n!.gitignore\n');
  }
}

module.exports = async (context) => {
  const { brandRoot, brandConfig, targetApps, options = {} } = context;

  const certConfig = brandConfig.certificates;
  if (certConfig === false || certConfig?.enabled === false) {
    console.log(`      ${chalk.dim('⊘ certificates.enabled = false — no signing artifacts to disperse')}`);
    return { output: { certs: { reason: 'certificates.enabled = false' } } };
  }

  const certApps = targetApps.filter((app) => CERT_FILE_MAP[app.target]);
  if (certApps.length === 0) {
    console.log(`      ${chalk.dim('⊘ no desktop or mobile apps')}`);
    return { output: { certs: { reason: 'no desktop or mobile apps' } } };
  }

  const appleDir = join(brandRoot, '.omega', 'certificates', 'apple');
  if (!jetpack.exists(appleDir)) {
    console.log(`      ${chalk.dim('⊘ no signing artifacts yet (.omega/certificates/apple is empty — the certificates service produces them)')}`);
    return { output: { certs: { reason: 'no signing artifacts yet' } } };
  }

  const brand = brandConfig.brand;
  let copied = 0;
  let current = 0;
  let skipped = 0;
  let warned = 0;
  let planned = 0;

  for (const app of certApps) {
    console.log(`      ${chalk.cyan(app.dir)}:`);

    for (const rule of CERT_FILE_MAP[app.target]) {
      const sourceRel = resolveTemplate(rule.source, brand);
      const destRel = sourceRel === null ? rule.dest : resolveTemplate(rule.dest, brand);

      // An unset env placeholder (e.g. APPLE_API_KEY_ID) means the rule has
      // no real path to resolve to
      if (sourceRel === null || destRel === null) {
        if (rule.optional) {
          console.log(`        ${chalk.dim(`⊘ ${rule.dest} (env placeholder unset, optional)`)}`);
          skipped++;
        } else {
          console.log(`        ${chalk.yellow('⚠')} ${chalk.cyan(rule.dest)} ${chalk.dim(`(env placeholder unset in ${rule.source})`)}`);
          warned++;
        }
        continue;
      }

      const sourcePath = join(appleDir, sourceRel);
      const destPath = join(app.path, destRel);

      if (!jetpack.exists(sourcePath)) {
        if (rule.optional) {
          console.log(`        ${chalk.dim(`⊘ ${destRel} (source missing, optional)`)}`);
          skipped++;
        } else {
          console.log(`        ${chalk.yellow('⚠')} ${chalk.cyan(destRel)} ${chalk.dim(`source missing: ${sourcePath}`)}`);
          warned++;
        }
        continue;
      }

      const sourceBytes = jetpack.read(sourcePath, 'buffer');
      const destBytes = jetpack.exists(destPath) ? jetpack.read(destPath, 'buffer') : null;

      if (destBytes && sourceBytes.equals(destBytes)) {
        console.log(`        ${chalk.dim(`✓ ${destRel} (current)`)}`);
        current++;
        continue;
      }

      if (options.dryRun) {
        console.log(`        ${chalk.cyan('[DRY RUN]')} Would copy ${chalk.cyan(destRel)}`);
        planned++;
        continue;
      }

      jetpack.copy(sourcePath, destPath, { overwrite: true });
      ensureCertsIgnore(dirname(destPath));
      console.log(`        ${chalk.green('✓')} ${chalk.cyan(destRel)}`);
      copied++;
    }
  }

  const summary = { copied, current, skipped, warned, ...(options.dryRun ? { planned } : {}) };
  console.log(`      Summary: ${chalk.bold(copied)} copied, ${current} current, ${chalk.dim(skipped)} skipped, ${warned > 0 ? chalk.yellow(warned) : warned} warnings`);

  return {
    status: warned > 0 ? 'warned' : 'success',
    output: { certs: summary },
  };
};

module.exports.CERT_FILE_MAP = CERT_FILE_MAP;
