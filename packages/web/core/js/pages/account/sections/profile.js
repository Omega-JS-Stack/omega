/**
 * Profile Section JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import webManager from 'web-manager';

let formManager = null;

// Initialize profile section
export function init() {
  setupProfileForm();
  setupButtons();
}

// Load profile data
export function loadData(account, user) {
  if (!account) {
    return;
  }

  // Format birthday if it exists
  let birthdayValue = '';
  if (account.personal?.birthday?.timestamp && account.personal.birthday.timestampUNIX > 0) {
    const date = new Date(account.personal.birthday.timestamp);
    // Format as YYYY-MM-DD for HTML date input
    birthdayValue = date.toISOString().split('T')[0];
  }

  // Format phone country code
  let phoneCountryCode = '+1'; // Default to US/Canada
  if (account.personal?.telephone?.countryCode) {
    phoneCountryCode = `+${account.personal.telephone.countryCode}`;
  }

  // Build nested data structure matching our form field names
  const formData = {
    auth: {
      email: account.auth?.email || user?.email || '',
      uid: user?.uid || account.auth?.uid || '',
    },
    personal: {
      name: {
        first: account.personal?.name?.first || '',
        last: account.personal?.name?.last || '',
      },
      birthday: birthdayValue,
      gender: account.personal?.gender || '',
      location: {
        country: account.personal?.location?.country || '',
        region: account.personal?.location?.region || '',
        city: account.personal?.location?.city || '',
      },
      telephone: {
        countryCode: phoneCountryCode,
        national: account.personal?.telephone?.national?.toString() || '',
      },
    },
  };

  formManager.setData(formData);

  // Set form to ready state now that data is loaded
  formManager.ready();

  // Update join date
  updateJoinDate(user);

  // Update role badges
  updateRoleBadges(account);
}

// Setup profile form
function setupProfileForm() {
  formManager = new FormManager('#profile-form', {
    autoReady: false, // Start in initializing state until data loads
    submittingText: 'Saving...',
  });

  formManager.on('submit', async ({ data }) => {
    // Update user profile
    await updateUserProfile(data);

    // Show success message
    formManager.showSuccess('Profile updated successfully!');
  });
}

// Setup button handlers
function setupButtons() {
  // Setup copy UID button
  const $copyUidBtn = document.getElementById('copy-uid-btn');
  if ($copyUidBtn) {
    $copyUidBtn.addEventListener('click', handleCopyUid);
  }
}

// Update user profile
async function updateUserProfile(data) {
  // Data is already in nested format thanks to dot notation!
  // Just need to process special fields

  // Parse birthday if provided
  if (data.personal?.birthday) {
    const date = new Date(data.personal.birthday);
    data.personal.birthday = {
      timestamp: date.toISOString(),
      timestampUNIX: Math.floor(date.getTime() / 1000),
    };
  } else {
    data.personal.birthday = {
      timestamp: '1970-01-01T00:00:00.000Z',
      timestampUNIX: 0,
    };
  }

  // Parse phone country code (remove + sign)
  if (data.personal?.telephone?.countryCode) {
    data.personal.telephone.countryCode = parseInt(data.personal.telephone.countryCode.replace('+', '')) || 0;
  }

  // Parse phone national number (remove non-digits)
  if (data.personal?.telephone?.national) {
    data.personal.telephone.national = parseInt(data.personal.telephone.national.replace(/\D/g, '')) || 0;
  }

  // Remove auth data from update (shouldn't be updated)
  delete data.auth;

  // Log the data for debugging
  console.log('Profile update data:', data);

  // Get current user and update Firestore
  const user = webManager.auth().getUser();
  const firestore = webManager.firestore();
  const userDocRef = firestore.doc(`users/${user.uid}`);

  // Use merge to only update specified fields
  await userDocRef.set(data, { merge: true });

  console.log('Profile successfully updated in Firestore');
}

// Handle copy UID
async function handleCopyUid() {
  const $uidInput = document.getElementById('uid-input');
  const $copyBtn = document.getElementById('copy-uid-btn');

  if (!$uidInput || !$uidInput.value) {
    return;
  }

  try {
    // Use webManager's clipboard utility
    await webManager.utilities().clipboardCopy($uidInput);

    // Update button text temporarily
    const $text = $copyBtn.querySelector('.button-text');
    const originalText = $text.textContent;

    $text.textContent = 'Copied!';
    $copyBtn.classList.remove('btn-outline-adaptive');
    $copyBtn.classList.add('btn-success');

    // Reset after 2 seconds
    setTimeout(() => {
      $text.textContent = originalText;
      $copyBtn.classList.remove('btn-success');
      $copyBtn.classList.add('btn-outline-adaptive');
    }, 2000);
  } catch (err) {
    console.error('Failed to copy UID:', err);
  }
}

// Update join date from Firebase user
function updateJoinDate(user) {
  const $joinDate = document.getElementById('profile-join-date');
  if (!$joinDate) {
    return;
  }

  // Get creation time from Firebase user metadata
  const creationTime = user?.metadata?.creationTime;

  if (creationTime) {
    const joinDate = new Date(creationTime);
    const formattedDate = joinDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    $joinDate.textContent = `Member since ${formattedDate}`;
  } else {
    // Fallback if no creation time available
    $joinDate.textContent = 'Member';
  }
}

// Update role badges based on user roles and subscription
function updateRoleBadges(account) {
  const roles = account?.roles || {};
  const subscription = account?.subscription || account?.plan;

  // Map of role to badge ID
  const roleBadgeMap = {
    admin: 'badge-admin',
    developer: 'badge-coder',
    moderator: 'badge-moderator',
    betaTester: 'badge-beta',
    vip: 'badge-vip',
  };

  // Show/hide role badges
  Object.entries(roleBadgeMap).forEach(([role, badgeId]) => {
    const $badge = document.getElementById(badgeId);
    if ($badge) {
      if (roles[role]) {
        $badge.classList.remove('d-none');
      } else {
        $badge.classList.add('d-none');
      }
    }
  });

  // Show premium badge if subscription is active AND on a paid plan
  const $premiumBadge = document.getElementById('badge-premium');
  if ($premiumBadge) {
    const productId = subscription?.product?.id || 'basic';
    const isPaid = productId !== 'basic';
    const isActive = subscription?.status === 'active';

    if (isActive && isPaid) {
      $premiumBadge.classList.remove('d-none');
    } else {
      $premiumBadge.classList.add('d-none');
    }
  }
}
