/**
 * Ensure Firebase Cloud Messaging is ready: the FCM API is enabled and a
 * VAPID key pair (web push) is in state.
 *
 * There is no public API for Web Push certificates — omega-manager opened
 * the console and prompted for both keys. Non-interactive here: missing keys
 * print the console URL and warn; the paste-back prompt rides the prompting
 * port. The private key lives in gitignored state, never omega.json5.
 */
const chalk = require('chalk').default;

module.exports = async function ensureCloudMessaging(context) {
  const { firebaseApi: api, projectId, serviceData = {}, options = {} } = context;

  // === FCM API ===
  const fcmEnabled = await api.isServiceEnabled(projectId, 'fcm.googleapis.com');

  if (fcmEnabled) {
    console.log(`      ${chalk.green('✓')} FCM API enabled`);
  } else if (options.dryRun) {
    console.log(`      ${chalk.dim('⊘ Dry run — would enable the FCM API')}`);
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

  // === VAPID key pair (from state — no API to create/read them) ===
  const existing = serviceData.cloudMessaging;

  if (existing?.vapidPublicKey && existing?.vapidPrivateKey) {
    console.log(`      ${chalk.green('✓')} VAPID key pair exists ${chalk.dim(`(${existing.vapidPublicKey.substring(0, 20)}...)`)}`);
    return {
      state: {
        cloudMessaging: {
          vapidPublicKey: existing.vapidPublicKey,
          vapidPrivateKey: existing.vapidPrivateKey,
        },
      },
    };
  }

  const consoleUrl = `https://console.firebase.google.com/project/${projectId}/settings/cloudmessaging`;
  console.log(`      ${chalk.yellow('⚠')} No VAPID key pair in state — web push won't work without one`);
  console.log(`      ${chalk.dim('→')} ${chalk.cyan(consoleUrl)}`);
  console.log(`      ${chalk.dim('→')} Under "Web Push certificates": generate (or reveal via ⋮) the key pair`);
  console.log(`      ${chalk.dim('→')} The paste-back prompt rides the prompting port; keys land in .omega/state.json`);

  return { status: 'warned', output: { cloudMessaging: { note: 'no VAPID key pair in state' } } };
};
