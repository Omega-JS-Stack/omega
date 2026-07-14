/**
 * Ensure the brand's bundle ID exists with the required capabilities.
 *
 * Bundle ID = composeBundleId(certificates.apple.bundleIdPrefix, brand.id)
 * — reverse-DNS prefix (config; the onboard wizard derives it from the
 * company/brand domain) + the brand id with hyphens as dots, e.g.
 * com.itwcreativeworks.omega.playground. Platforms derive from the enabled
 * targets (desktop → MACOS, mobile → IOS) and ride the returned state for
 * the profiles handler.
 */
const chalk = require('chalk').default;
const { catchAgreements } = require('../lib/apple-api.js');
const { composeBundleId } = require('../../../lib/bundle-id.js');

const {
  listBundleIds,
  createBundleId,
  findBundleId,
  listBundleIdCapabilities,
  enableCapabilities,
} = require('../lib/identifier-manager.js');

module.exports = catchAgreements(async (context) => {
  const { appleClient, brandConfig, brandId } = context;
  const dryRun = context.options?.dryRun || false;

  const appleConfig = brandConfig.certificates.apple || {};
  const prefix = appleConfig.bundleIdPrefix;
  if (!prefix) {
    return {
      status: 'error',
      error: 'certificates.apple.bundleIdPrefix not set — add it to config/omega.json5 (reverse-DNS of your domain, e.g. "com.yourcompany" — the onboard wizard seeds this; the bundle ID becomes <prefix>.<brand.id with dashes as dots>)',
    };
  }

  const bundleIdentifier = composeBundleId(prefix, brandId);
  const targets = brandConfig.targets || {};
  const platforms = [
    ...(targets.mobile ? ['IOS'] : []),
    ...(targets.desktop ? ['MACOS'] : []),
  ];
  const capabilities = appleConfig.capabilities || [];
  const brandName = brandConfig.brand?.name || brandId;

  const existingBundleIds = await listBundleIds(appleClient);
  console.log(`      ${chalk.green('✓')} Found ${existingBundleIds.length} existing bundle IDs`);
  console.log(`      ${chalk.dim('•')} ${chalk.cyan(bundleIdentifier)} ${chalk.dim(`(${brandName})`)}`);

  let record = findBundleId(existingBundleIds, bundleIdentifier);
  let output;

  if (record) {
    console.log(`        ${chalk.green('✓')} Bundle ID exists ${chalk.dim(`(${record.attributes.platform})`)}`);
    output = { synced: true };

    if (capabilities.length > 0) {
      const existingCaps = await listBundleIdCapabilities(appleClient, record.id);
      const existingCapTypes = existingCaps.map((cap) => cap.attributes.capabilityType);
      const missing = capabilities.filter((cap) => !existingCapTypes.includes(cap));

      if (missing.length > 0) {
        if (dryRun) {
          console.log(`        ${chalk.cyan('[DRY RUN]')} Would enable: ${missing.join(', ')}`);
          output = { planned: missing.map((cap) => `enable ${cap}`) };
        } else {
          const results = await enableCapabilities(appleClient, record.id, missing);
          for (const result of results) {
            if (result.success) {
              console.log(`          ${chalk.green('✓')} ${result.capability}`);
            } else {
              console.log(`          ${chalk.yellow('⚠')} ${result.capability} — ${chalk.gray(result.error)}`);
            }
          }
          output = { capabilitiesAdded: results.filter((r) => r.success).length };
        }
      } else {
        console.log(`        ${chalk.dim(`✓ All ${capabilities.length} capability(ies) enabled`)}`);
      }
    }
  } else {
    if (dryRun) {
      console.log(`        ${chalk.cyan('[DRY RUN]')} Would create ${bundleIdentifier} with ${capabilities.join(', ') || 'no capabilities'}`);
      return { output: { bundleIds: { planned: [`create ${bundleIdentifier}`] } } };
    }

    record = await createBundleId(appleClient, bundleIdentifier, brandName, 'IOS', capabilities);
    console.log(`        ${chalk.green('✓')} Created bundle ID`);
    output = { created: true };
  }

  return {
    state: {
      bundleId: { identifier: bundleIdentifier, id: record.id, platforms },
    },
    output: { bundleIds: output },
  };
});
