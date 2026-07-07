/**
 * Delete Account Section JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import webManager from 'web-manager';

let formManager = null;

// Initialize delete section
export async function init() {
  setupDeleteAccountForm();
}

// Setup delete account form
function setupDeleteAccountForm() {
  const $form = document.getElementById('delete-account-form');
  if (!$form) {
    return;
  }

  formManager = new FormManager('#delete-account-form', {
    allowResubmit: false,
    warnOnUnsavedChanges: false,
    submittingText: 'Deleting account...',
    submittedText: 'Account Deleted!',
  });

  formManager.on('submit', async ({ data }) => {
    // 1ms wait for dialog to appear properly
    await new Promise(resolve => setTimeout(resolve, 1));

    // Show confirmation dialog
    const confirmMessage = `Are you absolutely sure you want to delete your account?\n\nThis action CANNOT be undone.\n\nType "DELETE" to confirm:`;
    const userInput = prompt(confirmMessage);

    if (userInput !== 'DELETE') {
      throw new Error('Account deletion cancelled. You must type "DELETE" exactly to confirm.');
    }

    // Send delete request to server
    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user`, {
      method: 'DELETE',
      timeout: 30000,
      response: 'json',
      tries: 2,
      body: {
        reason: data.reason || '',
        confirmed: true,
      },
    });

    console.log('Delete account response:', response);

    if (!response.success) {
      throw new Error(response.message || 'Failed to delete account');
    }

    // Show success message
    formManager.showSuccess('Your account has been successfully deleted. You will now be signed out.');

    // Sign out the user
    await webManager.auth().signOut();

    // Redirect to home page
    setTimeout(() => {
      window.location.href = '/';
    }, 1500);
  });
}

// Load delete section data (if needed)
export async function loadData() {
  // No specific data to load for delete section
}

// Called when section is shown
export function onShow() {
  // Nothing needed
}
