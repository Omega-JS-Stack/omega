/**
 * Ensure Firebase Cloud Messaging is ready: the FCM API is enabled and a
 * VAPID key pair (web push) is in state.
 *
 * There is no public API for Web Push certificates — missing keys print the
 * console URL and, in an interactive terminal, prompt to paste both back
 * (length-validated; omega-manager's auto-open of the console is dropped —
 * the URL is printed and clickable). Non-interactive runs warn and move on.
 * The private key lives in gitignored state, never omega.json5.
 */
const chalk = require('chalk').default;
const { input, isInteractive, pressEnterToOpen } = require('@omega.js/devkit/prompt');

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
  console.log(`      ${chalk.dim('→')} Under "Web Push certificates": generate (or reveal via ⋮) the key pair`);

  if (!isInteractive() || options.dryRun) {
    console.log(`      ${chalk.dim('→')} ${chalk.cyan(consoleUrl)}`);
    console.log(`      ${chalk.dim('→')} Rerun in an interactive terminal to paste both keys; they land in .omega/state.json`);
    return {
      status: 'warned',
      output: {
        cloudMessaging: {
          note: 'no VAPID key pair in state (needs an interactive run)',
          needsInteractive: 'paste the VAPID key pair from the Cloud Messaging settings',
        },
      },
    };
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

  console.log(`      ${chalk.green('✓')} VAPID key pair saved`);

  return {
    state: {
      cloudMessaging: {
        vapidPublicKey: vapidPublicKey.trim(),
        vapidPrivateKey: vapidPrivateKey.trim(),
      },
    },
  };
};
