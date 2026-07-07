/**
 * Notifications section — marketing email consent toggle.
 *
 * Reads consent.marketing.status from the user doc for the toggle's initial state.
 * User flips the toggle then clicks Save; on submit, POSTs to
 * /backend-manager/marketing/email-preferences with subscribe|unsubscribe.
 * The server writes consent.marketing to the user doc + syncs SendGrid + Beehiiv.
 *
 * Uses FormManager for standard in-flight/success/error UX. On failure, the
 * error message is shown via FormManager and the toggle stays where the user
 * left it — they can try Save again without re-flipping.
 */
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import webManager from 'web-manager';

const FORM_ID = 'marketing-emails-form';
const TOGGLE_ID = 'marketing-emails';
const GRANT_DATE_ID = 'marketing-emails-grant-date';

let formManager = null;
let pushFormManager = null;

export function init() {
  const $form = document.getElementById(FORM_ID);
  if (!$form) {
    return;
  }

  formManager = new FormManager(`#${FORM_ID}`, {
    autoReady: false,          // Wait for loadData() to populate the toggle
    allowResubmit: true,       // Save → flip again → Save again is normal flow
    warnOnUnsavedChanges: false, // Toggle changes are explicit-Save, not draft
  });

  formManager.on('submit', async ({ data }) => {
    const action = data.enabled ? 'subscribe' : 'unsubscribe';

    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/marketing/email-preferences`, {
      method: 'POST',
      timeout: 60000,
      response: 'json',
      tries: 2,
      body: { action },
    });

    if (!response?.success) {
      throw new Error(response?.message || 'Failed to update email preferences. Please try again.');
    }

    formManager.showSuccess(
      data.enabled
        ? 'Subscribed to email updates.'
        : 'Unsubscribed from email updates.'
    );

    // Hide the grant-date line on unsubscribe (the displayed date was the OLD grant;
    // informational only). loadData() will repopulate it on the next page load if
    // the user re-subscribes.
    if (!data.enabled) {
      const $date = document.getElementById(GRANT_DATE_ID);
      if ($date) {
        $date.classList.add('d-none');
      }
    }
  });
}

export function loadData(account) {
  if (!account || !formManager) {
    return;
  }

  const $toggle = document.getElementById(TOGGLE_ID);
  if (!$toggle) {
    return;
  }

  const isGranted = account.consent?.marketing?.status === 'granted';
  $toggle.checked = isGranted;

  // Show the original grant date if known — gives the user context on what they agreed to.
  const grantTimestamp = account.consent?.marketing?.grantedAt?.timestamp;
  if (isGranted && grantTimestamp) {
    const $date = document.getElementById(GRANT_DATE_ID);
    if ($date) {
      const date = new Date(grantTimestamp);
      $date.textContent = `Subscribed ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.`;
      $date.classList.remove('d-none');
    }
  }

  formManager.ready();

  initPushNotifications();
}

function updatePushUI() {
  const $status = document.getElementById('push-notification-status');
  const $tokenInput = document.getElementById('push-token-value');

  if (!$status) {
    return;
  }

  const notifications = webManager.notifications();
  const stored = webManager.storage().get('notifications', {});
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

  let state;
  if (stored.subscribed && stored.token) {
    state = 'subscribed';
    $status.innerHTML = '<span class="badge bg-success">Subscribed</span>';
    if ($tokenInput) { $tokenInput.value = stored.token; }
    if (pushFormManager) { pushFormManager._setDisabled(true); }
  } else if (!notifications.isSupported()) {
    state = 'not-supported';
    $status.innerHTML = '<span class="badge bg-warning">Not supported</span>';
    if (pushFormManager) { pushFormManager._setDisabled(true); }
  } else if (permission === 'denied') {
    state = 'denied';
    $status.innerHTML = '<span class="badge bg-danger">Denied</span>';
    if (pushFormManager) { pushFormManager._setDisabled(true); }
  } else {
    state = 'not-subscribed';
    $status.innerHTML = '<span class="badge bg-secondary">Not subscribed</span>';
    if ($tokenInput) { $tokenInput.value = ''; }
    if (pushFormManager) { pushFormManager.ready(); }
  }

  console.log('[Account:push] updatePushUI →', state, { storedSubscribed: stored.subscribed, storedToken: stored.token?.slice(-8), permission });
}

async function initPushNotifications() {
  const $status = document.getElementById('push-notification-status');
  const $form = document.getElementById('push-subscribe-form');
  const $copyBtn = document.getElementById('copy-push-token-btn');

  if (!$status) {
    return;
  }

  const notifications = webManager.notifications();

  // Full sync: validates permission + token + Firestore, then updates localStorage
  await notifications.syncSubscription();

  // Create the form (always starts disabled), then let updatePushUI control its state
  if (notifications.isSupported() && $form) {
    $form.style.display = '';

    pushFormManager = new FormManager('#push-subscribe-form', {
      autoReady: false,
      allowResubmit: true,
    });

    pushFormManager.on('submit', async () => {
      console.log('[Account:push] Subscribe button clicked');
      await notifications.subscribe();
      console.log('[Account:push] Subscribe complete — updating UI');
      setTimeout(() => updatePushUI(), 0);
    });
  }

  // Now that the form exists, let updatePushUI set the correct state
  updatePushUI();

  if ($copyBtn) {
    const $tokenInput = document.getElementById('push-token-value');
    const originalHtml = $copyBtn.innerHTML;
    $copyBtn.addEventListener('click', () => {
      if (!$tokenInput?.value) {
        return;
      }
      navigator.clipboard.writeText($tokenInput.value).then(() => {
        $copyBtn.textContent = 'Copied!';
        setTimeout(() => { $copyBtn.innerHTML = originalHtml; }, 2000);
      });
    });
  }
}
