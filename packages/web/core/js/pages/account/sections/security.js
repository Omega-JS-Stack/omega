/**
 * Security Section JavaScript
 */

// Libraries
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import webManager from 'web-manager';

let firebaseAuth = null;
let signinMethodForms = new Map(); // Store FormManager instances for signin methods
let signoutAllFormManager = null; // FormManager instance for sign out all sessions

// Check query string for popup parameter
const url = new URL(window.location.href);
const useAuthPopup = url.searchParams.get('authPopup') === 'true' || window !== window.top;

// Initialize security section
export function init() {
  initializeSigninMethods();
  initializeSignoutAllForm();
  initializeSigninLinkGenerator();
}

// Load security data
export function loadData(account) {
  if (!account) {
    return;
  }

  console.log('[DEBUG] security.js - loadData() called with account:', account);

  // CRITICAL: Update signin methods BEFORE initializing FormManagers
  // This ensures FormManager stores the correct button state from the start
  updateSigninMethods();

  // Initialize FormManagers AFTER setting correct button states
  initializeSigninMethodForms();

  // Update 2FA status
  update2FAStatus(account.security?.twoFactor);

  // Update active sessions with full account data
  updateActiveSessions(account);
}

// Initialize signin methods
async function initializeSigninMethods() {
  console.log('[DEBUG] security.js - initializeSigninMethods() called');

  // Get Firebase auth instance
  firebaseAuth = webManager.firebaseAuth;

  // Check for redirect result (in case user is returning from Google auth)
  checkRedirectResult();

  // Update signin methods display on load
  updateSigninMethods();
}

// Check for redirect result from Google auth
async function checkRedirectResult() {
  try {
    const { getRedirectResult } = await import('@firebase/auth');
    const result = await getRedirectResult(firebaseAuth);

    if (result && result.user) {
      webManager.utilities().showNotification('Google account connected successfully', 'success');
      updateSigninMethods();
    }
  } catch (error) {
    if (error.code && error.code !== 'auth/no-auth-event') {
      console.error('Redirect result error:', error);
      webManager.utilities().showNotification('Failed to connect Google account', 'danger');
    }
  }
}

// Update signin methods display
async function updateSigninMethods() {
  console.log('[DEBUG] security.js - updateSigninMethods() called');

  // Use Firebase auth directly for most up-to-date provider information
  const firebaseUser = firebaseAuth?.currentUser;
  if (!firebaseUser) {
    console.log('[DEBUG] security.js - No firebaseUser, returning');
    return;
  }

  // Get the formatted user from webManager for consistency, but we'll use firebaseUser for provider data
  const user = webManager.auth().getUser();
  if (!user) {
    console.log('[DEBUG] security.js - No user, returning');
    return;
  }

  console.log('[DEBUG] security.js - firebaseUser.providerData:', firebaseUser.providerData);

  // Update password email display
  const $passwordEmail = document.getElementById('password-email');
  if ($passwordEmail) {
    // Check if user has password provider using firebaseUser for most up-to-date data
    const hasPassword = firebaseUser.providerData?.some(provider => provider.providerId === 'password');
    $passwordEmail.textContent = hasPassword ? user.email : 'Not set';
    console.log('[DEBUG] security.js - hasPassword:', hasPassword);
  }

  // Update Google signin display
  const $googleEmail = document.getElementById('google-email');
  const $googleForm = document.getElementById('signin-method-google-form');
  const $connectButton = $googleForm?.querySelector('button[data-action="connect"]');
  const $disconnectButton = $googleForm?.querySelector('button[data-action="disconnect"]');

  console.log('[DEBUG] security.js - Google DOM elements:', {
    $googleEmail: !!$googleEmail,
    $googleForm: !!$googleForm,
    $connectButton: !!$connectButton,
    $disconnectButton: !!$disconnectButton,
  });

  if ($googleEmail && $connectButton && $disconnectButton) {
    // Check if user has Google provider using firebaseUser for most up-to-date data
    const googleProvider = firebaseUser.providerData?.find(provider => provider.providerId === 'google.com');

    console.log('[DEBUG] security.js - googleProvider:', googleProvider);
    console.log('[DEBUG] security.js - googleProvider found:', !!googleProvider);

    if (googleProvider) {
      console.log('[DEBUG] security.js - Showing disconnect button');

      $googleEmail.textContent = googleProvider.email || 'Connected';
      // Hide connect button, show disconnect button
      $connectButton.classList.add('d-none');
      $disconnectButton.classList.remove('d-none');
    } else {
      console.log('[DEBUG] security.js - Showing connect button');

      $googleEmail.textContent = 'Not connected';
      // Show connect button, hide disconnect button
      $connectButton.classList.remove('d-none');
      $disconnectButton.classList.add('d-none');
    }
  }
}

// Update 2FA status
function update2FAStatus(twoFactorData) {
  const $2faStatus = document.getElementById('2fa-status');
  const $2faBtn = document.getElementById('2fa-btn');

  if (twoFactorData?.enabled) {
    if ($2faStatus) {
      $2faStatus.innerHTML = '<span class="badge bg-success">Enabled</span>';
    }
    if ($2faBtn) {
      $2faBtn.textContent = 'Manage 2FA';
      $2faBtn.className = 'btn btn-outline-primary';
    }
  } else {
    if ($2faStatus) {
      $2faStatus.innerHTML = '<span class="badge bg-secondary">Disabled</span>';
    }
    if ($2faBtn) {
      $2faBtn.textContent = 'Enable 2FA';
      $2faBtn.className = 'btn btn-primary';
    }
  }
}

// Update active sessions
async function updateActiveSessions(account) {
  const $sessionsList = document.getElementById('active-sessions-list');
  if (!$sessionsList) {
    return;
  }

  const sessions = [];

  // Add current session (from current activity)
  if (account?.activity) {
    const currentSession = {
      isCurrent: true,
      device: getDeviceFromUserAgent(account.activity.client?.userAgent),
      browser: getBrowserFromUserAgent(account.activity.client?.userAgent),
      platform: account.activity.client?.platform,
      mobile: account.activity.client?.mobile,
      language: account.activity.client?.language,
      ip: account.activity.geolocation?.ip,
      city: account.activity.geolocation?.city,
      region: account.activity.geolocation?.region,
      country: account.activity.geolocation?.country,
      timestamp: account.activity.created?.timestamp,
      timestampUNIX: account.activity.created?.timestampUNIX,
    };
    sessions.push(currentSession);
  }

  // Fetch other active sessions from server
  try {
    const serverApiURL = `${webManager.getApiUrl()}/backend-manager/user/sessions`;

    const data = await authorizedFetch(serverApiURL, {
      method: 'GET',
      timeout: 60000,
      response: 'json',
      tries: 2,
    });

    // Process sessions from server response
    let sessionData = data || {};

    // Add fake data if _dev_prefill=true is in query string
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('_dev_prefill') === 'true') {
      console.log('Adding fake session data for testing');
      const fakeSessions = generateFakeSessions();
      // Merge fake sessions with existing data (fake sessions don't override real ones)
      sessionData = { ...fakeSessions, ...sessionData };
    }

    if (sessionData && typeof sessionData === 'object') {
      // Convert sessions object to array and process each session
      Object.keys(sessionData).forEach(sessionId => {
        const session = sessionData[sessionId];

        // Skip if this is the current session (already added)
        if (session._current) {
          return;
        }

        // Create session object from server data
        const sessionObj = {
          isCurrent: false,
          sessionId: sessionId,
          platform: session.platform,
          ip: session.ip,
          timestamp: session.timestamp,
          timestampUNIX: session.timestampUNIX,
          // We don't have user agent data for other sessions, so use platform for device name
          device: getPlatformName(session.platform),
          browser: 'App • Desktop', // All sessions show as App • Desktop
          mobile: undefined, // Not available in session data
        };

        sessions.push(sessionObj);
      });
    }
  } catch (error) {
    console.error('Failed to get active sessions:', error);
  }

  // Add last activity session if different from current (fallback)
  if (account?.lastActivity) {
    const lastSession = {
      isCurrent: false,
      device: getDeviceFromUserAgent(account.lastActivity.client?.userAgent),
      browser: getBrowserFromUserAgent(account.lastActivity.client?.userAgent),
      platform: account.lastActivity.client?.platform,
      mobile: account.lastActivity.client?.mobile,
      language: account.lastActivity.client?.language,
      ip: account.lastActivity.geolocation?.ip,
      city: account.lastActivity.geolocation?.city,
      region: account.lastActivity.geolocation?.region,
      country: account.lastActivity.geolocation?.country,
      timestamp: account.lastActivity.timestamp,
      timestampUNIX: account.lastActivity.timestampUNIX,
    };

    // Only add if it's different from current session (different IP or timestamp)
    if (!sessions[0]
        || (lastSession.ip !== sessions[0].ip
        || lastSession.timestampUNIX !== sessions[0].timestampUNIX)) {
      sessions.push(lastSession);
    }
  }

  // Display active sessions
  if (sessions.length === 0) {
    $sessionsList.innerHTML = '<p class="text-muted text-center py-3">No active sessions found.</p>';
    return;
  }

  const sessionHTML = sessions.map((session, index) => {
    const deviceName = session.device || 'Unknown Device';
    const browserName = session.browser || 'Unknown Browser';
    const location = formatSessionLocation(session);
    const isLast = index === sessions.length - 1;

    return `
    <div class="px-0 py-3${isLast ? '' : ' border-bottom'}">
      <div class="d-flex justify-content-between align-items-start">
        <div class="d-flex align-items-center">
          <div class="d-flex align-items-center justify-content-center me-3 flex-shrink-0 text-muted">
            ${getDeviceIcon(session.platform || deviceName)}
          </div>
          <div>
            <strong>${webManager.utilities().escapeHTML(deviceName)}</strong>
            <div class="text-muted small">${webManager.utilities().escapeHTML(browserName)}${session.mobile !== undefined ? ` • ${session.mobile ? 'Mobile' : 'Desktop'}` : ''}</div>
            ${location ? `<div class="text-muted small">${webManager.utilities().escapeHTML(location)}</div>` : ''}
            ${session.ip ? `<div class="text-muted small">IP: ${webManager.utilities().escapeHTML(session.ip)}</div>` : ''}
          </div>
        </div>
        <div class="text-end">
          <small class="text-muted">${webManager.utilities().escapeHTML(formatDate(session.timestamp || (session.timestampUNIX * 1000)))}</small>
          ${session.isCurrent ? '<span class="badge bg-primary ms-2">Current</span>' : ''}
        </div>
      </div>
    </div>
  `;
  }).join('');

  $sessionsList.innerHTML = sessionHTML;
}

// Initialize FormManager for signin methods
function initializeSigninMethodForms() {
  console.log('[DEBUG] security.js - initializeSigninMethodForms() called');

  // Initialize password form
  const $passwordForm = document.getElementById('signin-method-password-form');

  if ($passwordForm && !signinMethodForms.has('password')) {
    console.log('[DEBUG] security.js - Initializing password FormManager');

    const formManager = new FormManager($passwordForm, {
      allowResubmit: false,
      submittingText: 'Sending...',
      submittedText: 'Email Sent!',
    });

    signinMethodForms.set('password', formManager);

    formManager.on('submit', async () => {
      await handleChangePassword();
      formManager.showSuccess('Password reset email sent!');
    });
  }

  // Initialize Google form
  const $googleForm = document.getElementById('signin-method-google-form');

  if ($googleForm && !signinMethodForms.has('google')) {
    console.log('[DEBUG] security.js - About to initialize Google FormManager');
    console.log('[DEBUG] security.js - Google form exists:', !!$googleForm);

    const formManager = new FormManager($googleForm, {
      submittingText: 'Connecting...',
    });

    signinMethodForms.set('google', formManager);
    console.log('[DEBUG] security.js - Google FormManager initialized and stored');

    formManager.on('submit', async ({ $submitButton }) => {
      // Determine action from the clicked button's data-action attribute
      const action = $submitButton?.getAttribute('data-action');

      if (action === 'disconnect') {
        await disconnectGoogleProvider();
      } else if (action === 'connect') {
        await connectGoogleProvider();
      }

      // Update display after success
      updateSigninMethods();
    });
  }

  // Initialize 2FA button if exists
  const $2faBtn = document.getElementById('2fa-btn');
  if ($2faBtn) {
    $2faBtn.addEventListener('click', handle2FAClick);
  }
}

// Initialize FormManager for sign out all sessions
function initializeSignoutAllForm() {
  const $form = document.getElementById('signout-all-sessions-form');

  if ($form && !signoutAllFormManager) {
    signoutAllFormManager = new FormManager($form, {
      submittingText: 'Signing out...',
    });

    signoutAllFormManager.on('submit', async () => {
      // 1ms wait to allow form state to update and show processing
      await new Promise(resolve => setTimeout(resolve, 1));

      // Confirm sign out
      if (!confirm('Are you sure you want to sign out of all sessions? This will log you out everywhere, including this device.')) {
        throw new Error('Sign out cancelled.');
      }

      // Sign out of all sessions
      await webManager.auth().signOut();

      // Show success message
      signoutAllFormManager.showSuccess('Successfully signed out of all sessions.');

      // Note: The page will likely redirect due to auth state change
    });
  }
}

// Initialize signin link generator (advanced feature).
// Creates a temporary signin URL using a Firebase custom token. The link grants
// full account access to anyone who holds it, so we gate it behind a typed
// confirmation phrase before hitting BEM's /user/token route.
function initializeSigninLinkGenerator() {
  const $modal = document.getElementById('generate-signin-link-modal');
  if (!$modal) {
    return;
  }

  const $phrase = document.getElementById('signin-link-confirm-phrase');
  const $input = document.getElementById('signin-link-confirm-input');
  const $generateBtn = document.getElementById('signin-link-generate-btn');
  const $warningView = document.getElementById('generate-signin-link-warning');
  const $resultView = document.getElementById('generate-signin-link-result');
  const $output = document.getElementById('signin-link-output');
  const $copyBtn = document.getElementById('signin-link-copy-btn');

  const expectedPhrase = $phrase.textContent.trim();

  // Reset modal state every time it opens. The custom token is never persisted
  // outside the input — closing the modal must drop it from the DOM.
  $modal.addEventListener('show.bs.modal', () => {
    $input.value = '';
    $output.value = '';
    $generateBtn.disabled = true;
    $warningView.classList.remove('d-none');
    $resultView.classList.add('d-none');
  });

  // Enable Generate only when the typed phrase matches exactly.
  $input.addEventListener('input', () => {
    $generateBtn.disabled = $input.value.trim() !== expectedPhrase;
  });

  $generateBtn.addEventListener('click', async () => {
    // Defensive: the button is disabled until the phrase matches, but re-check
    // in case anything bypassed the input handler.
    if ($input.value.trim() !== expectedPhrase) {
      return;
    }

    const originalText = $generateBtn.querySelector('.button-text').textContent;
    $generateBtn.disabled = true;
    $generateBtn.querySelector('.button-text').textContent = 'Generating...';

    try {
      const tokenURL = `${webManager.getApiUrl()}/backend-manager/user/token`;
      const data = await authorizedFetch(tokenURL, {
        method: 'POST',
        timeout: 60000,
        response: 'json',
        tries: 2,
      });

      const token = data?.token;
      if (!token) {
        throw new Error('No token returned from server');
      }

      const signinURL = new URL('/signin', window.location.origin);
      signinURL.searchParams.set('authCustomToken', token);

      $output.value = signinURL.toString();
      $warningView.classList.add('d-none');
      $resultView.classList.remove('d-none');
    } catch (error) {
      console.error('[Security] Failed to generate signin link:', error);
      webManager.utilities().showNotification(
        `Failed to generate signin link: ${error.message || 'Unknown error'}`,
        { type: 'danger', timeout: 8000 }
      );
      $generateBtn.disabled = false;
    } finally {
      $generateBtn.querySelector('.button-text').textContent = originalText;
    }
  });

  $copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($output.value);
      webManager.utilities().showNotification('Signin link copied to clipboard', 'success');
    } catch (error) {
      $output.select();
      document.execCommand('copy');
      webManager.utilities().showNotification('Signin link copied to clipboard', 'success');
    }
  });
}

// Connect Google provider
async function connectGoogleProvider() {
  // Dynamic import of Firebase auth methods
  const { GoogleAuthProvider, linkWithPopup, linkWithRedirect } = await import('@firebase/auth');

  const provider = new GoogleAuthProvider();

  // Use popup if query parameter is set, otherwise use redirect
  if (useAuthPopup) {
    try {
      const result = await linkWithPopup(firebaseAuth.currentUser, provider);
      webManager.utilities().showNotification('Google account connected successfully', 'success');

      // Force refresh of the current user to get updated provider data
      await firebaseAuth.currentUser.reload();

      return result;
    } catch (error) {
      // Check if we should fallback to redirect
      if (error.code === 'auth/popup-blocked'
          || error.code === 'auth/popup-closed-by-user'
          || error.code === 'auth/cancelled-popup-request') {

        console.log('Popup failed, falling back to redirect:', error.code);

        // Fallback to redirect
        await linkWithRedirect(firebaseAuth.currentUser, provider);
        // This will redirect the page, so no immediate result
      } else if (error.code === 'auth/credential-already-in-use') {
        throw new Error('This Google account is already linked to another user');
      } else {
        throw error;
      }
    }
  } else {
    // Use redirect by default
    console.log('Using redirect for Google account linking');
    await linkWithRedirect(firebaseAuth.currentUser, provider);
    // This will redirect the page, so no immediate result
  }
}

// Disconnect Google provider
async function disconnectGoogleProvider() {
  // Wait 1 ms to allow FormManager to show "Processing..." spinner
  await new Promise(resolve => setTimeout(resolve, 1));

  // Confirm disconnection
  if (!confirm('Are you sure you want to disconnect your Google account?')) {
    throw new Error('Disconnection cancelled.');
  }

  // Dynamic import of Firebase auth methods
  const { unlink } = await import('@firebase/auth');

  const user = firebaseAuth.currentUser;

  // Check if user has another sign-in method
  if (user.providerData.length <= 1) {
    throw new Error('Cannot disconnect Google. You need at least one sign-in method.');
  }

  try {
    await unlink(user, 'google.com');
    webManager.utilities().showNotification('Google account disconnected successfully', 'success');
  } catch (error) {
    if (error.code === 'auth/no-such-provider') {
      throw new Error('Google account is not connected');
    } else {
      throw error;
    }
  }
}

// Handle change password
async function handleChangePassword() {
  const user = webManager.auth().getUser();
  if (!user || !user.email) {
    throw new Error('Please log in to reset your password.');
  }

  // Import Firebase auth method
  const { sendPasswordResetEmail } = await import('@firebase/auth');

  // Send password reset email
  await sendPasswordResetEmail(firebaseAuth, user.email);
}

// Handle 2FA button click
async function handle2FAClick(event) {
  const isEnabled = event.target.textContent.includes('Enable');

  if (isEnabled) {
    // Start 2FA setup flow
    console.log('Starting 2FA setup...');
    // This would typically open a modal or redirect to 2FA setup page
  } else {
    // Manage existing 2FA
    console.log('Managing 2FA settings...');
  }
}

// Get device from user agent string
function getDeviceFromUserAgent(userAgent) {
  if (!userAgent) {
    return 'Unknown Device';
  }

  const ua = userAgent.toLowerCase();

  // Check for mobile devices first
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('android')) {
    if (ua.includes('mobile')) return 'Android Phone';
    if (ua.includes('tablet')) return 'Android Tablet';
    return 'Android Device';
  }
  if (ua.includes('windows phone')) return 'Windows Phone';

  // Check for desktop OS
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'Mac';
  if (ua.includes('windows nt')) return 'Windows PC';
  if (ua.includes('linux')) return 'Linux';
  if (ua.includes('cros')) return 'Chromebook';

  return 'Unknown Device';
}

// Get browser from user agent string
function getBrowserFromUserAgent(userAgent) {
  if (!userAgent) {
    return 'Unknown Browser';
  }

  const ua = userAgent.toLowerCase();

  // Check browsers (order matters for accurate detection)
  if (ua.includes('edg/')) return 'Microsoft Edge';
  if (ua.includes('chrome/') && !ua.includes('edg/')) return 'Chrome';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('edg/')) return 'Safari';
  if (ua.includes('opera/') || ua.includes('opr/')) return 'Opera';
  if (ua.includes('brave/')) return 'Brave';

  return 'Unknown Browser';
}

// Get platform name from platform string
function getPlatformName(platform) {
  if (!platform) {
    return 'Unknown Device';
  }

  const platformLower = platform.toLowerCase();

  if (platformLower.includes('mac') || platformLower.includes('darwin')) {
    return 'macOS';
  } else if (platformLower.includes('win')) {
    return 'Windows';
  } else if (platformLower.includes('linux')) {
    return 'Linux';
  } else if (platformLower.includes('android')) {
    return 'Android';
  } else if (platformLower.includes('ios') || platformLower.includes('iphone') || platformLower.includes('ipad')) {
    return 'iOS';
  } else {
    return 'Unknown';
  }
}

// Get device icon based on device type
function getDeviceIcon(device) {
  const deviceLower = (device || '').toLowerCase();
  let iconName = 'desktop'; // default

  if (deviceLower.includes('iphone')
      || deviceLower.includes('ipad')
      || deviceLower.includes('ios')
      || deviceLower.includes('mac')) {
    iconName = 'apple';
  } else if (deviceLower.includes('android')) {
    iconName = 'android';
  } else if (deviceLower.includes('windows')) {
    iconName = 'windows';
  } else if (deviceLower.includes('linux')) {
    iconName = 'linux';
  } else if (deviceLower.includes('chrome')) {
    iconName = 'chrome';
  }

  return getPrerenderedIcon(iconName, 'fa-xl');
}

// Format location from session data
function formatSessionLocation(session) {
  const parts = [];

  if (session.city) {
    // Capitalize first letter of each word in city name
    const cityFormatted = session.city.split(' ').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
    parts.push(cityFormatted);
  }

  if (session.region) {
    parts.push(session.region.toUpperCase());
  }

  if (session.country) {
    // Add country code or name
    parts.push(session.country.toUpperCase());
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

// Generate fake sessions for development mode
function generateFakeSessions() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  return {
    'session_abc123': {
      _current: false,
      platform: 'Windows',
      ip: '98.137.246.8',
      timestamp: new Date(now - (3 * oneHour)).toISOString(),
      timestampUNIX: Math.floor((now - (3 * oneHour)) / 1000),
    },
    'session_def456': {
      _current: false,
      platform: 'Darwin',  // macOS
      ip: '192.168.1.42',
      timestamp: new Date(now - (8 * oneHour)).toISOString(),
      timestampUNIX: Math.floor((now - (8 * oneHour)) / 1000),
    },
    'session_ghi789': {
      _current: false,
      platform: 'Linux',
      ip: '45.62.189.3',
      timestamp: new Date(now - (oneDay)).toISOString(),
      timestampUNIX: Math.floor((now - (oneDay)) / 1000),
    },
    'session_jkl012': {
      _current: false,
      platform: 'Win32',
      ip: '203.0.113.45',
      timestamp: new Date(now - (2 * oneDay)).toISOString(),
      timestampUNIX: Math.floor((now - (2 * oneDay)) / 1000),
    },
    'session_mno345': {
      _current: false,
      platform: 'Mac',
      ip: '172.217.16.195',
      timestamp: new Date(now - (5 * oneDay)).toISOString(),
      timestampUNIX: Math.floor((now - (5 * oneDay)) / 1000),
    },
  };
}

// Format date helper
function formatDate(timestamp) {
  if (!timestamp) {
    return 'Unknown';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // Less than 1 minute
  if (diff < 60000) {
    return 'Just now';
  }

  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }

  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }

  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  // More than 7 days - show full date
  return date.toLocaleDateString() + ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
