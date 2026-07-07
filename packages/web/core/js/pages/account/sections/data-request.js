/**
 * Data Request Section JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import webManager from 'web-manager';

let formManager = null;
let downloadFormManager = null;
let cancelFormManager = null;

// Initialize data-request section
export async function init() {
  setupDataRequestForm();
  setupDownloadButton();
  setupCancelButton();
}

// Setup data request form
function setupDataRequestForm() {
  const $form = document.getElementById('data-request-form');
  if (!$form) {
    return;
  }

  formManager = new FormManager('#data-request-form', {
    allowResubmit: false,
    warnOnUnsavedChanges: false,
    submittingText: 'Submitting request...',
    submittedText: 'Request Submitted',
  });

  formManager.on('submit', async ({ data }) => {
    trackDataRequest('submit');

    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user/data-request`, {
      method: 'POST',
      timeout: 30000,
      response: 'json',
      tries: 2,
      body: {
        confirmed: true,
        reason: data.reason || '',
      },
    });

    if (response.error) {
      throw new Error(response.message || 'Failed to submit data request. Please try again later.');
    }

    formManager.showSuccess('Your data request has been submitted. Please check back in up to 14 business days.');

    showRequestStatus(response.request);
  });
}

// Setup download form
function setupDownloadButton() {
  const $form = document.getElementById('data-request-download-form');

  if (!$form) {
    return;
  }

  downloadFormManager = new FormManager('#data-request-download-form', {
    allowResubmit: false,
    submittingText: 'Downloading...',
    submittedText: 'Downloaded!',
  });

  downloadFormManager.on('submit', async () => {
    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user/data-request?action=download`, {
      method: 'GET',
      timeout: 60000,
      response: 'json',
    });

    if (response.error || !response.data) {
      throw new Error(response.message || 'Failed to download data.');
    }

    trackDataRequest('download');

    // Trigger file download
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const $a = document.createElement('a');
    $a.href = url;
    $a.download = `my-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild($a);
    $a.click();
    document.body.removeChild($a);
    URL.revokeObjectURL(url);
  });
}

// Setup cancel form
function setupCancelButton() {
  const $form = document.getElementById('data-request-cancel-form');

  if (!$form) {
    return;
  }

  cancelFormManager = new FormManager('#data-request-cancel-form', {
    allowResubmit: true,
    submittingText: 'Withdrawing...',
  });

  cancelFormManager.on('submit', async () => {
    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user/data-request`, {
      method: 'DELETE',
      timeout: 30000,
      response: 'json',
    });

    if (response.error) {
      throw new Error(response.message || 'Failed to withdraw request.');
    }

    trackDataRequest('cancel');

    showRequestForm();
  });
}

// Load data (called when auth state resolves)
export async function loadData() {
  // Status is checked lazily in onShow
}

// Called when section is shown
export async function onShow() {
  await checkRequestStatus();
}

// Check request status from backend
async function checkRequestStatus() {
  try {
    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user/data-request`, {
      method: 'GET',
      timeout: 30000,
      response: 'json',
    });

    if (response.request) {
      showRequestStatus(response.request);
    } else {
      showRequestForm();
    }
  } catch (error) {
    // No active request or error — show form
    showRequestForm();
  }
}

// Show request status UI
function showRequestStatus(request) {
  const $status = document.getElementById('data-request-status');
  const $statusTitle = document.getElementById('data-request-status-title');
  const $statusMessage = document.getElementById('data-request-status-message');
  const $download = document.getElementById('data-request-download');
  const $cancel = document.getElementById('data-request-cancel');
  const $formContainer = document.getElementById('data-request-form-container');
  const $formTrigger = document.getElementById('data-request-form-trigger');

  if (!$status) {
    return;
  }

  if (request.status === 'expired') {
    showRequestForm();
    return;
  }

  $status.classList.remove('d-none');
  $formContainer.classList.add('d-none');
  if ($formTrigger) {
    $formTrigger.classList.add('d-none');
  }

  const createdDate = new Date(request.metadata.created.timestamp).toLocaleDateString();

  if (request.status === 'completed') {
    $statusTitle.textContent = 'Your data is ready';
    $statusMessage.textContent = `Your data request from ${createdDate} has been processed. Click below to download your data package. This download will expire 30 days after your data became available.`;
    $download.classList.remove('d-none');
    if (downloadFormManager) {
      downloadFormManager.reset();
    }
    $cancel.classList.add('d-none');

    trackDataRequest('download_available');
  } else {
    $statusTitle.textContent = 'Request pending';
    $statusMessage.textContent = `Your data request was submitted on ${createdDate}. Processing may take up to 14 business days. Please check back later.`;
    $download.classList.add('d-none');
    $cancel.classList.remove('d-none');
    if (cancelFormManager) {
      cancelFormManager.reset();
    }
  }
}

// Show request form UI
function showRequestForm() {
  const $status = document.getElementById('data-request-status');
  const $formContainer = document.getElementById('data-request-form-container');
  const $formTrigger = document.getElementById('data-request-form-trigger');

  if (!$status || !$formContainer) {
    return;
  }

  $status.classList.add('d-none');
  $formContainer.classList.remove('d-none');
  if ($formTrigger) {
    $formTrigger.classList.remove('d-none');
  }
}

// Tracking
function trackDataRequest(action) {
  gtag('event', 'data_request', {
    action: action,
  });
  fbq('trackCustom', 'DataRequest', {
    action: action,
  });
  ttq.track('ViewContent', {
    content_id: `data-request-${action}`,
    content_type: 'product',
    content_name: `Data Request ${action}`,
  });
}
