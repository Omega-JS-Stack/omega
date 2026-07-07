/**
 * Email Preferences Page JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import fetch from 'wonderful-fetch';
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    setupForm();

    // Resolve after initialization
    return resolve();
  });
};

// Decode a base64-encoded URL parameter
function decodeParam(encoded) {
  if (!encoded) {
    return '';
  }

  try {
    return atob(decodeURIComponent(encoded));
  } catch (e) {
    return '';
  }
}

// Mask an email address: show first 2 and last char of local part, first 2 chars of domain
// e.g. "ian.wiedenman+test-unsub@gmail.com" → "ia***************b@gm***.com"
function maskEmail(email) {
  const [local, domain] = email.split('@');

  if (!local || !domain) {
    return '***@***.***';
  }

  const domainParts = domain.split('.');
  const domainName = domainParts.slice(0, -1).join('.');
  const tld = domainParts.slice(-1)[0];

  const maskedLocal = local.length <= 3
    ? local[0] + '*'.repeat(local.length - 1)
    : local.slice(0, 2) + '*'.repeat(local.length - 3) + local.slice(-1);

  const maskedDomain = domainName.length <= 2
    ? domainName
    : domainName.slice(0, 2) + '*'.repeat(domainName.length - 2);

  return `${maskedLocal}@${maskedDomain}.${tld}`;
}

// Setup form handling
function setupForm() {
  const url = new URL(window.location.href);

  // Parse and decode URL parameters
  const email = decodeParam(url.searchParams.get('email'));
  const asmId = decodeParam(url.searchParams.get('asmId'));
  const templateId = decodeParam(url.searchParams.get('templateId'));
  const sig = url.searchParams.get('sig') || '';

  // DOM elements
  const $description = document.getElementById('email-preferences-description');
  const $error = document.getElementById('email-preferences-error');
  const $errorMessage = document.getElementById('email-preferences-error-message');
  const $content = document.getElementById('email-preferences-content');
  const $address = document.getElementById('email-preferences-address');
  const $submit = document.getElementById('email-preferences-submit');
  const $infoUnsubscribe = document.getElementById('email-preferences-info-unsubscribe');
  const $infoResubscribe = document.getElementById('email-preferences-info-resubscribe');
  const $actionButtons = document.querySelectorAll('[data-action]');

  // Validate required parameters
  if (!email || !asmId || !sig) {
    $description.textContent = 'Something went wrong.';
    $errorMessage.textContent = 'This link is invalid or expired. Please try clicking the link in your email again.';
    $error.hidden = false;
    return;
  }

  // Populate UI
  $description.textContent = 'Confirm your email address to update your email preferences.';
  $address.textContent = maskEmail(email);
  $content.hidden = false;

  // Track current action
  let currentAction = 'unsubscribe';

  // Action toggle buttons
  $actionButtons.forEach($btn => {
    $btn.addEventListener('click', () => {
      currentAction = $btn.dataset.action;

      // Update active state
      $actionButtons.forEach($b => $b.classList.remove('active'));
      $btn.classList.add('active');

      // Toggle info messages
      $infoUnsubscribe.hidden = currentAction !== 'unsubscribe';
      $infoResubscribe.hidden = currentAction !== 'resubscribe';

      // Update submit button
      if (currentAction === 'unsubscribe') {
        $submit.className = 'btn btn-danger w-100 mb-4';
        $submit.querySelector('.button-text').innerHTML = `${getPrerenderedIcon('bell-slash', 'me-2')}Unsubscribe`;
      } else {
        $submit.className = 'btn btn-success w-100 mb-4';
        $submit.querySelector('.button-text').innerHTML = `${getPrerenderedIcon('bell', 'me-2')}Resubscribe`;
      }
    });
  });

  // Initialize FormManager
  const formManager = new FormManager('#email-preferences-form', {
    autoReady: false,
    allowResubmit: false,
  });

  // Custom validation: confirm email matches
  formManager.on('validation', ({ data, setError }) => {
    if (data.email_confirm.toLowerCase().trim() !== email.toLowerCase().trim()) {
      setError('email_confirm', 'Email does not match. Please enter the email address this was sent to.');
    }
  });

  // Submit handler
  formManager.on('submit', async ({ data }) => {
    const action = currentAction;

    trackEmailPreference(action);

    try {
      await fetch(`${webManager.getApiUrl()}/backend-manager/marketing/email-preferences`, {
        method: 'POST',
        response: 'json',
        body: {
          email: email,
          asmId: asmId,
          action: action,
          sig: sig,
        },
        timeout: 30000,
      });

      if (action === 'unsubscribe') {
        formManager.showSuccess('You have been successfully unsubscribed. You will no longer receive these emails.');
      } else {
        formManager.showSuccess('You have been successfully resubscribed. You will start receiving these emails again.');
      }
    } catch (error) {
      webManager.sentry().captureException(new Error('Email preferences error', { cause: error }));
      throw new Error('An error occurred while processing your request. Please try again.');
    }
  });

  // Ready
  formManager.ready();
}

// Tracking
function trackEmailPreference(action) {
  gtag('event', `email_${action}`, {
    content_type: 'email_preferences',
  });
  fbq('trackCustom', action === 'unsubscribe' ? 'EmailUnsubscribe' : 'EmailResubscribe', {
    content_name: 'Email Preferences',
  });
  ttq.track('ViewContent', {
    content_id: `email-${action}`,
    content_type: 'product',
  });
}
