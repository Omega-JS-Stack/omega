// Libraries
import * as profileSection from './sections/profile.js';
import * as notificationsSection from './sections/notifications.js';
import * as securitySection from './sections/security.js';
import * as billingSection from './sections/billing.js';
import * as teamSection from './sections/team.js';
import * as referralsSection from './sections/referrals.js';
import * as apiKeysSection from './sections/api-keys.js';
import * as deleteSection from './sections/delete.js';
import * as dataRequestSection from './sections/data-request.js';
import * as connectionsSection from './sections/connections.js';
import * as refundSection from './sections/refund.js';
import omega from '@omega.js/client';
import { WAKEUP_ROUTE } from '@omega.js/client/modules/request.js';
import { getPaymentConfig } from '__main_assets__/js/libs/payment-config.js';
import { event } from '__main_assets__/js/libs/analytics.js';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Warm the backend the moment the page loads: every section here acts
    // through it — the billing portal, a plan switch, a cancel, a refund, an
    // API key, a data request, the delete — and each of those is one click on a
    // function that may be cold. Fire-and-forget and unauthenticated: the
    // backend answers a wakeup before it loads a route or authenticates
    // ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
    omega.request(WAKEUP_ROUTE, { wakeup: true });

    // Initialize when DOM is ready
    await omega.dom().ready();

    try {
      await initializeAccount();
    } catch (error) {
      omega.sentry().captureException(new Error('Failed to initialize account page', { cause: error }));
    }

    // Resolve after initialization
    return resolve();
  });
};

// Global state
let $navLinks = null;
let $sections = null;

// Config from _config.yml (available instantly, no fetch needed)
const paymentConfig = getPaymentConfig();

// Section modules map
const sectionModules = {
  profile: profileSection,
  notifications: notificationsSection,
  security: securitySection,
  billing: billingSection,
  team: teamSection,
  referrals: referralsSection,
  'api-keys': apiKeysSection,
  delete: deleteSection,
  'data-request': dataRequestSection,
  connections: connectionsSection,
  refund: refundSection,
};

// Main initialization
async function initializeAccount() {
  // Get DOM elements
  $navLinks = document.querySelectorAll('#account-nav .nav-link');
  $sections = document.querySelectorAll('.account-section');

  // Initially hide all sections except loading
  hideAllSectionsExceptLoading();

  // Setup navigation
  setupNavigation();

  // Check if delete/data-request hash is present on initial load
  if (window.location.hash === '#delete') {
    showDeleteOption();
  }
  if (window.location.hash === '#data-request') {
    showDataRequestOption();
  }
  if (window.location.hash === '#refund') {
    showRefundOption();
  }

  // Initialize all section modules
  Object.values(sectionModules).forEach(module => {
    if (module.init) {
      module.init();
    }
  });

  // Setup auth listener. Dev-testing subscription states = sign in as a
  // seeded emulator persona (email + TEST_ACCOUNT_PASSWORD) — the old
  // ?_dev_subscription= mock fixtures are gone (N6). The page carries NO dev
  // control of its own (#343): the referrals and the sessions a persona shows
  // are the ones the backend seeded onto it, so the palette's persona
  // dropdown is the whole affordance.
  omega.auth().listen({}, async (state) => {
    console.log('Auth state with account data:', state);

    loadAllSectionData(state);

    // Hide loading section and show the appropriate section
    hideLoadingSection();

    // Handle initial hash or show default section
    handleHashChange();
  });
}

// Load data for all sections
function loadAllSectionData(authState) {
  const { user, account } = authState;

  // Load data for each section (passing brand data where needed)
  if (sectionModules.profile.loadData) {
    sectionModules.profile.loadData(account, user);
  }

  if (sectionModules.notifications.loadData) {
    sectionModules.notifications.loadData(account);
  }

  if (sectionModules.security.loadData) {
    sectionModules.security.loadData(account);
  }

  if (sectionModules.billing.loadData) {
    sectionModules.billing.loadData(account, paymentConfig);
  }

  if (sectionModules.team && sectionModules.team.loadData) {
    sectionModules.team.loadData(account);
  }

  if (sectionModules.referrals && sectionModules.referrals.loadData) {
    sectionModules.referrals.loadData(account);
  }

  if (sectionModules['api-keys'] && sectionModules['api-keys'].loadData) {
    sectionModules['api-keys'].loadData(account);
  }

  if (sectionModules.delete.loadData) {
    sectionModules.delete.loadData(account);
  }

  if (sectionModules['data-request'] && sectionModules['data-request'].loadData) {
    sectionModules['data-request'].loadData(account);
  }

  if (sectionModules.connections.loadData) {
    sectionModules.connections.loadData(account, omega.config?.oauth2 || {});
  }

  if (sectionModules.refund.loadData) {
    sectionModules.refund.loadData(account);
  }
}

// Setup navigation between sections
function setupNavigation() {
  // Add click listeners to nav links
  $navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = link.dataset.section;

      showSection(sectionId);

      // Update URL hash
      window.location.hash = sectionId;
    });
  });

  // Setup mobile dropdown navigation
  const $mobileNavSelect = document.getElementById('mobile-nav-select');
  if ($mobileNavSelect) {
    $mobileNavSelect.addEventListener('change', (e) => {
      const sectionId = e.target.value;

      showSection(sectionId);
      window.location.hash = sectionId;
    });
  }

  // Listen for hash changes
  window.addEventListener('hashchange', handleHashChange);
}

// Handle hash changes
function handleHashChange() {
  const hash = window.location.hash.slice(1);

  // Show hidden nav items based on hash
  if (hash === 'delete') {
    showDeleteOption();
  }
  if (hash === 'data-request') {
    showDataRequestOption();
  }
  if (hash === 'refund') {
    showRefundOption();
  }

  if (hash) {
    // Check if the section exists
    const $targetSection = document.getElementById(`${hash}-section`);
    if ($targetSection) {
      showSection(hash);
    } else {
      // Section doesn't exist, default to profile
      console.warn(`Section "${hash}" not found, defaulting to profile`);
      omega.sentry().captureException(new Error(`Invalid account section hash: ${hash}`));
      window.location.hash = '#profile';
      showSection('profile');
    }
  } else {
    // No hash, show profile by default
    showSection('profile');
  }
}

// Show delete option in navigation
function showDeleteOption() {
  // Show desktop nav item
  const $deleteNavItem = document.getElementById('delete-nav-item');
  if ($deleteNavItem) {
    $deleteNavItem.classList.remove('d-none');
  }

  // Add mobile dropdown option if not exists
  const $mobileNavSelect = document.getElementById('mobile-nav-select');
  if ($mobileNavSelect) {
    const deleteOption = $mobileNavSelect.querySelector('option[value="delete"]');
    if (!deleteOption) {
      const option = document.createElement('option');
      option.value = 'delete';
      option.textContent = 'Delete Account';
      option.className = 'text-danger';
      $mobileNavSelect.appendChild(option);
    }
  }
}

// Show data request option in navigation
function showDataRequestOption() {
  // Show desktop nav item
  const $dataRequestNavItem = document.getElementById('data-request-nav-item');
  if ($dataRequestNavItem) {
    $dataRequestNavItem.classList.remove('d-none');
  }

  // Add mobile dropdown option if not exists
  const $mobileNavSelect = document.getElementById('mobile-nav-select');
  if ($mobileNavSelect) {
    const dataRequestOption = $mobileNavSelect.querySelector('option[value="data-request"]');
    if (!dataRequestOption) {
      const option = document.createElement('option');
      option.value = 'data-request';
      option.textContent = 'Data Request';
      $mobileNavSelect.appendChild(option);
    }
  }
}

// Show refund option in navigation
function showRefundOption() {
  // Show desktop nav item
  const $refundNavItem = document.getElementById('refund-nav-item');
  if ($refundNavItem) {
    $refundNavItem.classList.remove('d-none');
  }

  // Add mobile dropdown option if not exists
  const $mobileNavSelect = document.getElementById('mobile-nav-select');
  if ($mobileNavSelect) {
    const refundOption = $mobileNavSelect.querySelector('option[value="refund"]');
    if (!refundOption) {
      const option = document.createElement('option');
      option.value = 'refund';
      option.textContent = 'Refund';
      $mobileNavSelect.appendChild(option);
    }
  }
}

// Hide all sections except loading
function hideAllSectionsExceptLoading() {
  $sections.forEach(section => {
    if (section.id !== 'loading-section') {
      section.classList.add('d-none');
    }
  });
}

// Hide loading section
function hideLoadingSection() {
  const $loadingSection = document.getElementById('loading-section');
  if ($loadingSection) {
    $loadingSection.classList.add('d-none');
  }
}

// Show specific section
function showSection(sectionId) {
  // Don't show sections while loading
  const $loadingSection = document.getElementById('loading-section');
  if ($loadingSection && !$loadingSection.classList.contains('d-none')) {
    // Still loading, don't switch sections yet
    return;
  }

  // Hide all sections
  $sections.forEach(section => {
    section.classList.add('d-none');
  });

  // Show selected section
  const $targetSection = document.getElementById(`${sectionId}-section`);
  if ($targetSection) {
    $targetSection.classList.remove('d-none');

    // Track section view when actually shown
    trackAccountSectionView(sectionId);
  }

  // Update nav active state
  $navLinks.forEach(link => {
    if (link.dataset.section === sectionId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update mobile dropdown to match
  const $mobileNavSelect = document.getElementById('mobile-nav-select');
  if ($mobileNavSelect) {
    $mobileNavSelect.value = sectionId;
  }

  // Call section's onShow method if it exists
  const sectionModule = sectionModules[sectionId];
  if (sectionModule && sectionModule.onShow) {
    sectionModule.onShow();
  }
}

// Tracking functions
function trackAccountSectionView(sectionId) {
  event('user_section_view', {
    section_name: sectionId
  });
}
