/**
 * Ensure provisioning profiles exist for the brand's bundle ID × every
 * applicable cert type/platform combo, downloading each to
 * .omega/certificates/apple/profiles/{BRAND_ID}/{CERT_TYPE}/{PLATFORM}.mobileprovision
 * (delete the local file to force a re-download). The brand segment matters:
 * the signing tree is shared at companyRoot, but a profile binds ONE bundle
 * ID — without the segment, sibling brands overwrite each other's profiles.
 *
 * Reads the bundle ID + certificateMap the previous handlers stashed in
 * state. Device lists are fetched lazily — only when a development
 * profile actually needs creating (omega-manager fetched them every run).
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { catchAgreements } = require('../lib/apple-api.js');

const {
  listProfiles,
  listDevices,
  downloadProfile,
  createProfile,
  findValidProfile,
  getProfileTypeForCertType,
  certAppliesToPlatform,
} = require('../lib/profile-manager.js');

module.exports = catchAgreements(async (context) => {
  const { appleClient, appleDir, brandConfig, brandId, serviceData } = context;
  const dryRun = context.options?.dryRun || false;

  const bundleId = serviceData?.bundleId;
  if (!bundleId?.id) {
    if (dryRun) {
      console.log(`      ${chalk.cyan('[DRY RUN]')} Bundle ID not created yet — profiles follow once it exists`);
      return { output: { profiles: { planned: 'after bundle ID exists' } } };
    }
    console.log(`      ${chalk.yellow('⚠')} No bundle ID resolved — skipping`);
    return {};
  }

  const certificateMap = serviceData?.certificateMap || {};
  if (Object.keys(certificateMap).length === 0) {
    console.log(`      ${chalk.yellow('⚠')} No certificates available — skipping`);
    return {};
  }

  const profilesDir = join(appleDir, 'profiles');
  const profileCertTypes = brandConfig.certificates.apple?.profiles || [];
  const brandName = brandConfig.brand?.name || brandId;

  const existingProfiles = await listProfiles(appleClient);
  console.log(`      ${chalk.green('✓')} Found ${existingProfiles.length} existing profiles`);

  const profileMap = {};
  const planned = [];
  let downloaded = 0;
  let created = 0;
  let synced = 0;
  let deviceIds = null;

  for (const platform of bundleId.platforms) {
    for (const certType of profileCertTypes) {
      if (!certAppliesToPlatform(certType, platform)) {
        continue;
      }

      const profileType = getProfileTypeForCertType(certType);
      if (!profileType) {
        continue; // e.g. MAC_INSTALLER_DISTRIBUTION — no profile needed
      }

      const cert = certificateMap[certType];
      if (!cert) {
        console.log(`      ${chalk.yellow('⚠')} Skipping ${chalk.cyan(certType)} (${platform}) — cert not available`);
        continue;
      }

      const profileName = `${brandName} - ${certType} (${platform})`;
      const profileKey = `${certType.toLowerCase()}-${platform.toLowerCase()}`;
      const profilePath = join(profilesDir, brandId, certType, `${platform}.mobileprovision`);

      console.log(`      ${chalk.dim('•')} ${chalk.cyan(profileName)}`);

      const validProfile = findValidProfile(existingProfiles, profileType, profileName);

      if (validProfile) {
        profileMap[profileKey] = { id: validProfile.id, expirationDate: validProfile.attributes.expirationDate };

        if (!jetpack.exists(profilePath)) {
          if (dryRun) {
            console.log(`        ${chalk.cyan('[DRY RUN]')} Would download`);
            planned.push(`download ${profileName}`);
          } else {
            await downloadProfile(appleClient, validProfile.id, profilePath);
            downloaded++;
          }
        } else {
          console.log(`        ${chalk.green('✓')} Valid profile exists ${chalk.dim(`(expires ${validProfile.attributes.expirationDate})`)}`);
          synced++;
        }
        continue;
      }

      // A cert known only from its local file has no API id to link the
      // profile to — the account's API key lacks permission to list it.
      if (cert.id === 'manual') {
        console.log(`        ${chalk.yellow('⚠')} Cert known only from the local file (API didn't list it) — cannot create the profile; check the API key's permissions`);
        continue;
      }

      if (dryRun) {
        console.log(`        ${chalk.cyan('[DRY RUN]')} Would create + download`);
        planned.push(`create ${profileName}`);
        continue;
      }

      // Development profiles bind devices; distribution profiles don't
      const requiresDevices = profileType === 'IOS_APP_DEVELOPMENT' || profileType === 'MAC_APP_DEVELOPMENT';
      if (requiresDevices && deviceIds === null) {
        const devices = await listDevices(appleClient);
        deviceIds = devices.map((d) => d.id);
        console.log(`      ${chalk.green('✓')} Found ${devices.length} registered devices`);
      }

      const newProfile = await createProfile(
        appleClient,
        profileName,
        profileType,
        bundleId.id,
        [cert.id],
        requiresDevices ? deviceIds : [],
      );
      console.log(`        ${chalk.green('✓')} Created ${chalk.dim(`(expires ${newProfile.attributes.expirationDate})`)}`);
      await downloadProfile(appleClient, newProfile.id, profilePath);
      profileMap[profileKey] = { id: newProfile.id, expirationDate: newProfile.attributes.expirationDate };
      created++;
    }
  }

  const summary = dryRun ? { planned } : { synced, downloaded, created };
  return { state: { profiles: profileMap }, output: { profiles: summary } };
});
