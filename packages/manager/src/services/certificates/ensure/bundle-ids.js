/**
 * Ensure the brand's bundle ID exists with the required capabilities.
 *
 * Bundle ID = composeBundleId(certificates.providers.apple.bundleIdPrefix, brand.id)
 * — reverse-DNS prefix (config; the onboard wizard derives it from the
 * company/brand domain, and a brand without one is ASKED, #635) + the brand
 * id with hyphens as dots, e.g.
 * com.itwcreativeworks.omega.playground. Platforms derive from the enabled
 * targets (desktop → MACOS, mobile → IOS) and ride the returned state for
 * the profiles handler.
 */
const chalk = require('chalk').default;
const { catchAgreements } = require('../lib/apple-api.js');
const { composeBundleId } = require('../../../lib/bundle-id.js');
const { resolveConfigValue } = require('../../../lib/config-flow.js');

// Where the brand's identifiers live — the page a prefix is read off of
const APPLE_PORTAL_IDENTIFIERS_URL = 'https://developer.apple.com/account/resources/identifiers/list';

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

  const appleConfig = brandConfig.certificates.providers?.apple || {};

  // A value the brand must supply is ASKED for, not demanded (#635). The
  // service already gated on its App Store Connect credentials, hence
  // `gate: false`; a skip/disable/headless run steps aside warned, because a
  // brand that never set a prefix is an unconfigured brand, not a broken one.
  const prefix = appleConfig.bundleIdPrefix || await resolveConfigValue(context, {
    path: 'certificates.providers.apple.bundleIdPrefix',
    label: 'Apple bundle id prefix',
    entry: {
      url: APPLE_PORTAL_IDENTIFIERS_URL,
      message: 'Apple bundle id prefix (reverse-DNS, e.g. com.yourcompany):',
    },
    disablePath: 'certificates.enabled',
    gate: false,
  });

  if (!prefix) {
    console.log(`      ${chalk.yellow('⚠')} No ${chalk.cyan('certificates.providers.apple.bundleIdPrefix')} — the bundle ID is <prefix>.<brand.id with dashes as dots>`);
    return { status: 'warned', output: { bundleIds: { skipped: 'no bundleIdPrefix' } } };
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
