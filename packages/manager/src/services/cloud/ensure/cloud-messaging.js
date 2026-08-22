/**
 * Ensure Firebase Cloud Messaging is ready: the FCM API is enabled and a
 * VAPID key pair (web push) is on hand.
 *
 * There is no public API for Web Push certificates — missing keys print the
 * console URL and, in an interactive terminal, prompt to paste both back
 * (length-validated; omega-manager's auto-open of the console is dropped —
 * the URL is printed and clickable). Non-interactive runs warn and move on.
 *
 * The halves go to their own homes (#434): the PUBLIC key to
 * `cloud.messaging.vapidKey` in omega.json5 (it ships to every browser — the
 * client reads it from there), the PRIVATE key to VAPID_PRIVATE_KEY in the
 * gitignored brand .env.
 */
const chalk = require('chalk').default;
const { input, pressEnterToOpen } = require('@omega.js/devkit/prompt');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { writeEnvValue } = require('../../../lib/env-secret.js');
const { canPrompt, dryRunPlan, needsInteractiveSkip } = require('../../../lib/run-gates.js');

const VAPID_PUBLIC_PATH = 'cloud.messaging.vapidKey';
const VAPID_PRIVATE_ENV = 'VAPID_PRIVATE_KEY';

module.exports = async function ensureCloudMessaging(context) {
  const { firebaseApi: api, brandConfig, brandRoot, projectId, options = {} } = context;

  // === FCM API ===
  const fcmEnabled = await api.isServiceEnabled(projectId, 'fcm.googleapis.com');

  if (fcmEnabled) {
    console.log(`      ${chalk.green('✓')} FCM API enabled`);
  } else if (options.dryRun) {
    dryRunPlan('enable the FCM API');
  } else {
    console.log('      Enabling FCM API...');
    try {
      await api.enableService(projectId, 'fcm.googleapis.com');
      console.log(`      ${chalk.green('✓')} FCM API enabled`);
    } catch (error) {
      console.log(`      ${chalk.yellow('⚠')} Failed to enable FCM API${chalk.dim(`: ${error.message}`)}`);
      return { status: 'warned', output: { cloudMessaging: { error: error.message } } };
    }
  }

  // === VAPID key pair (config + .env — no API to create or read them) ===
  const existingPublicKey = brandConfig.cloud?.messaging?.vapidKey;

  if (existingPublicKey && process.env[VAPID_PRIVATE_ENV]) {
    console.log(`      ${chalk.green('✓')} VAPID key pair exists ${chalk.dim(`(${existingPublicKey.substring(0, 20)}...)`)}`);
    return {};
  }

  const consoleUrl = `https://console.firebase.google.com/project/${projectId}/settings/cloudmessaging`;
  console.log(`      ${chalk.yellow('⚠')} No VAPID key pair — web push won't work without one`);
  console.log(`      ${chalk.dim('→')} Under "Web Push certificates": generate (or reveal via ⋮) the key pair`);

  if (!canPrompt(options)) {
    console.log(`      ${chalk.dim('→')} ${chalk.cyan(consoleUrl)}`);
    console.log(`      ${chalk.dim('→')} Rerun in an interactive terminal to paste both keys; the public half lands in omega.json5 (${chalk.cyan(VAPID_PUBLIC_PATH)}), the private half in the brand .env (${chalk.cyan(VAPID_PRIVATE_ENV)})`);
    return needsInteractiveSkip(
      'cloudMessaging',
      'paste the VAPID key pair from the Cloud Messaging settings',
      'no VAPID key pair (needs an interactive run)',
    );
  }

  await pressEnterToOpen(consoleUrl, 'the Cloud Messaging settings');

  const vapidPublicKey = await input({
    message: '    VAPID public key:',
    validate: (value) => {
      if (!value?.trim()) {
        return 'Required — copy the Key pair value from the Firebase Console';
      }
      if (value.trim().length !== 87) {
        return `VAPID public key must be exactly 87 characters (got ${value.trim().length})`;
      }
      return true;
    },
  });

  const vapidPrivateKey = await input({
    message: '    VAPID private key:',
    validate: (value) => {
      if (!value?.trim()) {
        return 'Required — click the ⋮ menu next to the key pair to reveal it';
      }
      if (value.trim() === vapidPublicKey.trim()) {
        return 'That\'s the public key again — click ⋮ to reveal the private key (shorter, 43 chars)';
      }
      if (value.trim().length !== 43) {
        return `VAPID private key must be exactly 43 characters (got ${value.trim().length})`;
      }
      return true;
    },
  });

  writeBrandConfig(context, { [VAPID_PUBLIC_PATH]: vapidPublicKey.trim() });
  writeEnvValue(brandRoot, VAPID_PRIVATE_ENV, vapidPrivateKey.trim());
  process.env[VAPID_PRIVATE_ENV] = vapidPrivateKey.trim();

  console.log(`      ${chalk.green('✓')} VAPID key pair saved ${chalk.dim(`(${VAPID_PUBLIC_PATH} + .env ${VAPID_PRIVATE_ENV})`)}`);

  return {};
};
