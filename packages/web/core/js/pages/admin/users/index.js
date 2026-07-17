/**
 * Admin Users Index Page JavaScript
 *
 * A real user directory: loads immediately (newest first) from
 * GET /admin/users/list — the backend route that joins Firebase Auth
 * records (providers, verification, disabled, last sign-in) the client
 * SDK can never read. Search = email prefix or exact UID; pagination
 * rides the route's uid cursor.
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import { formatTimeAgo, capitalize, setStatValue, setStatSubValue } from '__main_assets__/js/libs/admin-helpers.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import omega from '@omega.js/client';

// State
let formManager = null;
let editFormManager = null;
let editingUid = null;
let rows = [];
let nextCursor = null;
let currentSearch = '';
let loadingMore = false;

const PAGE_SIZE = 25;

// Human labels for Firebase Auth provider ids
const PROVIDER_LABELS = {
  'password': 'Password',
  'google.com': 'Google',
  'apple.com': 'Apple',
  'github.com': 'GitHub',
  'facebook.com': 'Facebook',
  'twitter.com': 'X',
  'microsoft.com': 'Microsoft',
  'phone': 'Phone',
};

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    omega.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      initForm();
      initControls();
      loadStatCards();
      fetchPage();
    });

    return resolve();
  });
};

// Initialize FormManager for search
function initForm() {
  formManager = new FormManager('#user-search-form', {
    allowResubmit: true,
    submittingText: 'Searching...',
  });

  formManager.on('submit', async ({ data }) => {
    currentSearch = (data?.search?.query || '').trim();

    await fetchPage();
  });
}

// Wire refresh + load-more
function initControls() {
  const $refresh = document.getElementById('btn-refresh-users');
  if ($refresh) {
    $refresh.addEventListener('click', () => fetchPage());
  }

  const $loadMore = document.getElementById('btn-load-more');
  if ($loadMore) {
    $loadMore.addEventListener('click', () => fetchPage({ append: true }));
  }
}

// Load stat card counts
async function loadStatCards() {
  const { collection, query, where, getCountFromServer } = await import('firebase/firestore');
  const db = omega.firebaseFirestore;
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60);

  const [totalUsers, newUsers, activeSubs, activeUsers] = await Promise.allSettled([
    getCountFromServer(collection(db, 'users')),
    getCountFromServer(query(collection(db, 'users'), where('metadata.created.timestampUNIX', '>=', thirtyDaysAgo))),
    getCountFromServer(query(collection(db, 'users'), where('subscription.status', '==', 'active'), where('subscription.product.id', '!=', 'basic'))),
    getCountFromServer(query(collection(db, 'users'), where('metadata.updated.timestampUNIX', '>=', thirtyDaysAgo))),
  ]);

  setStatValue('stat-total-users', totalUsers);
  setStatSubValue('stat-new-users', newUsers, 'in 30d');
  setStatValue('stat-active-subs', activeSubs);
  setStatValue('stat-active-users', activeUsers);
}

// Fetch a directory page from the backend (auth-joined rows)
async function fetchPage(options) {
  const append = options?.append === true;

  if (append) {
    if (loadingMore || !nextCursor) {
      return;
    }
    loadingMore = true;
    setLoadMoreBusy(true);
  } else {
    showLoading();
  }

  try {
    const url = new URL(`${omega.getApiUrl()}/omega/admin/users/list`);
    url.searchParams.set('limit', PAGE_SIZE);
    if (currentSearch) {
      url.searchParams.set('search', currentSearch);
    }
    if (append && nextCursor) {
      url.searchParams.set('startAfter', nextCursor);
    }

    const response = await authorizedFetch(url.toString(), {
      method: 'GET',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
    });

    const users = Array.isArray(response?.users) ? response.users : [];

    rows = append ? rows.concat(users) : users;
    nextCursor = response?.nextCursor || null;

    if (rows.length === 0) {
      showEmpty(currentSearch ? 'No users match your search' : 'No users yet');
      return;
    }

    renderUsers();
  } catch (error) {
    console.error('Failed to load users:', error);
    showEmpty(`Failed to load users: ${error.message || 'Unknown error'}`);
  } finally {
    loadingMore = false;
    setLoadMoreBusy(false);
  }
}

// Render users table
function renderUsers() {
  const $loading = document.getElementById('users-loading');
  const $empty = document.getElementById('users-empty');
  const $table = document.getElementById('users-table');
  const $tbody = document.getElementById('users-tbody');
  const $footer = document.getElementById('users-footer');
  const $count = document.getElementById('users-count');
  const $loadMore = document.getElementById('btn-load-more');

  if ($loading) $loading.classList.add('d-none');
  if ($empty) $empty.classList.add('d-none');
  if ($table) $table.classList.remove('d-none');
  if ($footer) $footer.classList.remove('d-none');
  if ($tbody) $tbody.innerHTML = '';

  rows.forEach((row) => {
    $tbody.appendChild(renderRow(row));
  });

  if ($count) {
    $count.textContent = currentSearch
      ? `${rows.length} match${rows.length !== 1 ? 'es' : ''} for “${currentSearch}”`
      : `${rows.length} user${rows.length !== 1 ? 's' : ''} shown · newest first`;
  }

  if ($loadMore) {
    $loadMore.classList.toggle('d-none', !nextCursor);
  }
}

// Build one directory row
function renderRow(row) {
  const escape = omega.utilities().escapeHTML;
  const email = row.email || 'Unknown';
  const uid = row.uid;
  const plan = row.plan || 'basic';
  const isPaid = plan !== 'basic';
  const auth = row.auth;

  // Plan cell — accent chip for paid plans, quiet chip for basic
  const planChip = isPaid
    ? `<span class="classy-chip classy-chip--accent">${escape(capitalize(plan))}</span>`
    : `<span class="classy-chip">${escape(capitalize(plan))}</span>`;
  const subStatus = row.subscriptionStatus && isPaid
    ? `<div class="text-muted mt-1" style="font-size: 0.7rem;">${escape(row.subscriptionStatus)}</div>`
    : '';

  // Sign-in cell (providers + last sign-in)
  const providers = (auth?.providers || [])
    .map((id) => `<span class="classy-chip">${escape(PROVIDER_LABELS[id] || id)}</span>`)
    .join(' ');
  const lastSignIn = auth?.lastSignIn
    ? `<div class="text-muted mt-1" style="font-size: 0.7rem;">${escape(formatTimeAgo(new Date(auth.lastSignIn).getTime()))}</div>`
    : '';
  const signInCell = auth
    ? `${providers || '<span class="text-muted small">—</span>'}${lastSignIn}`
    : '<span class="text-muted small">—</span>';

  // Status cell — dot + label (never color alone); disabled wins the eye
  let statusCell = '<span class="text-muted small">—</span>';
  if (auth) {
    statusCell = auth.emailVerified
      ? '<span class="classy-status"><span class="classy-dot classy-dot--ok"></span>Verified</span>'
      : '<span class="classy-status"><span class="classy-dot"></span>Unverified</span>';

    if (auth.disabled) {
      statusCell += ' <span class="classy-status ms-1"><span class="classy-dot classy-dot--danger"></span>Disabled</span>';
    }
  }

  // Created cell
  const createdText = row.created ? new Date(row.created).toLocaleDateString() : '—';

  const $row = document.createElement('tr');
  $row.innerHTML = `
    <td>
      <div class="d-flex align-items-center gap-2">
        <span class="classy-icon-chip classy-icon-chip--neutral">${getPrerenderedIcon('user', 'fa-sm')}</span>
        <div class="min-w-0">
          <div class="text-truncate fw-semibold" style="max-width: 220px;">${escape(email)}</div>
          <div class="font-monospace text-muted text-truncate" style="max-width: 220px; font-size: 0.7rem;">${escape(uid)}</div>
        </div>
      </div>
    </td>
    <td>
      ${planChip}
      ${subStatus}
    </td>
    <td>${signInCell}</td>
    <td>${statusCell}</td>
    <td class="text-muted small">${escape(createdText)}</td>
    <td>
      <div class="dropdown">
        <button class="classy-iconbtn" type="button" data-bs-toggle="dropdown" aria-label="User actions">
          ${getPrerenderedIcon('ellipsis-vertical', 'fa-sm')}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item small btn-view-user" href="#">
            ${getPrerenderedIcon('eye', 'fa-sm me-2')}
            View details
          </a></li>
          <li><a class="dropdown-item small btn-edit-user" href="#">
            ${getPrerenderedIcon('pen', 'fa-sm me-2')}
            Edit user
          </a></li>
          <li><a class="dropdown-item small btn-copy-uid" href="#">
            ${getPrerenderedIcon('copy', 'fa-sm me-2')}
            Copy UID
          </a></li>
          <li><a class="dropdown-item small btn-view-firebase" href="#">
            ${getPrerenderedIcon('fire', 'fa-sm me-2')}
            View in Explorer
          </a></li>
          <li><a class="dropdown-item small btn-signin-as" href="#">
            ${getPrerenderedIcon('right-to-bracket', 'fa-sm me-2')}
            Sign in as user
          </a></li>
          <li><hr class="dropdown-divider"></li>
          <li><a class="dropdown-item small btn-toggle-disabled" href="#">
            ${auth?.disabled
              ? `${getPrerenderedIcon('unlock', 'fa-sm me-2')} Enable user`
              : `${getPrerenderedIcon('ban', 'fa-sm me-2')} Disable user`}
          </a></li>
          <li><a class="dropdown-item small text-danger btn-delete-user" href="#">
            ${getPrerenderedIcon('trash', 'fa-sm me-2')}
            Delete user
          </a></li>
        </ul>
      </div>
    </td>
  `;

  // Wire up action buttons
  $row.querySelector('.btn-view-user').addEventListener('click', (e) => {
    e.preventDefault();
    viewUser(uid, email);
  });

  $row.querySelector('.btn-edit-user').addEventListener('click', (e) => {
    e.preventDefault();
    editUser(uid, email);
  });

  $row.querySelector('.btn-copy-uid').addEventListener('click', (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(uid);
  });

  $row.querySelector('.btn-view-firebase').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = `/admin/firebase?collection=users&doc=${uid}`;
  });

  $row.querySelector('.btn-signin-as').addEventListener('click', (e) => {
    e.preventDefault();
    signInAsUser(uid, email);
  });

  $row.querySelector('.btn-toggle-disabled').addEventListener('click', (e) => {
    e.preventDefault();
    toggleDisabled(row);
  });

  $row.querySelector('.btn-delete-user').addEventListener('click', (e) => {
    e.preventDefault();
    deleteUser(uid, email);
  });

  return $row;
}

// ============================================
// User Actions
// ============================================

// Fetch the full Firestore doc on demand (the directory rows are lean)
async function fetchFullUser(uid) {
  const doc = await omega.firestore().doc(`users/${uid}`).get();

  return doc.exists ? { id: uid, ...doc.data() } : null;
}

async function viewUser(uid, email) {
  const $label = document.getElementById('user-detail-modal-label');
  const $json = document.getElementById('user-detail-json');

  if ($label) {
    $label.textContent = email || uid;
  }

  if ($json) {
    $json.textContent = 'Loading...';
  }

  // Wire modal footer buttons
  const $copyBtn = document.getElementById('btn-copy-uid');
  if ($copyBtn) {
    $copyBtn.onclick = () => navigator.clipboard.writeText(uid);
  }

  const $firebaseBtn = document.getElementById('btn-view-in-firebase');
  if ($firebaseBtn) {
    $firebaseBtn.onclick = () => {
      window.location.href = `/admin/firebase?collection=users&doc=${uid}`;
    };
  }

  // Show modal, then fill with the full doc
  const modal = new bootstrap.Modal(document.getElementById('user-detail-modal'));
  modal.show();

  try {
    const userData = await fetchFullUser(uid);
    if ($json) {
      $json.textContent = userData ? JSON.stringify(userData, null, 2) : 'No Firestore document for this user';
    }
  } catch (error) {
    if ($json) {
      $json.textContent = `Failed to load user: ${error.message || 'Unknown error'}`;
    }
  }
}

async function toggleDisabled(row) {
  const disabled = !(row.auth?.disabled);
  const email = row.email || row.uid;

  if (disabled && !confirm(`Disable ${email}?\n\nThey will be signed out and blocked from signing in until re-enabled.`)) {
    return;
  }

  try {
    const response = await authorizedFetch(`${omega.getApiUrl()}/omega/admin/users/disable`, {
      method: 'POST',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
      body: { uid: row.uid, disabled: disabled },
    });

    // Reflect the new state in the cached row
    row.auth = row.auth || {};
    row.auth.disabled = response?.disabled === true;

    renderUsers();
  } catch (error) {
    console.error('Failed to update user:', error);
    alert(`Failed to ${disabled ? 'disable' : 'enable'} user: ${error.message || 'Unknown error'}`);
  }
}

async function signInAsUser(uid, email) {
  openSignInAsModalLoading(email);

  try {
    const response = await authorizedFetch(`${omega.getApiUrl()}/omega/user/token`, {
      method: 'POST',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
      body: { uid: uid },
    });

    const token = response?.token;
    if (!token) {
      throw new Error('No token returned from server');
    }

    const signinUrl = new URL('/signin', window.location.origin);
    signinUrl.searchParams.set('authSignout', 'true');
    signinUrl.searchParams.set('authCustomToken', token);
    signinUrl.searchParams.set('authReturnUrl', '/account');

    showSignInAsModalReady(email, signinUrl.toString());
  } catch (error) {
    console.error('Failed to create sign-in link:', error);
    showSignInAsModalError(error.message || 'Unknown error');
  }
}

function openSignInAsModalLoading(email) {
  const $loading = document.getElementById('signin-as-loading');
  const $ready = document.getElementById('signin-as-ready');
  const $error = document.getElementById('signin-as-error');
  const $loadingEmail = document.getElementById('signin-as-loading-email');
  const $navigateBtn = document.getElementById('btn-signin-as-navigate');

  if ($loading) $loading.classList.remove('d-none');
  if ($ready) $ready.classList.add('d-none');
  if ($error) $error.classList.add('d-none');
  if ($navigateBtn) $navigateBtn.classList.add('d-none');
  if ($loadingEmail) $loadingEmail.textContent = email;

  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('signin-as-modal'));
  modal.show();
}

function showSignInAsModalReady(email, urlString) {
  const $loading = document.getElementById('signin-as-loading');
  const $ready = document.getElementById('signin-as-ready');
  const $error = document.getElementById('signin-as-error');
  const $email = document.getElementById('signin-as-email');
  const $url = document.getElementById('signin-as-url');
  const $copyBtn = document.getElementById('btn-signin-as-copy');
  const $navigateBtn = document.getElementById('btn-signin-as-navigate');

  if ($loading) $loading.classList.add('d-none');
  if ($error) $error.classList.add('d-none');
  if ($ready) $ready.classList.remove('d-none');
  if ($navigateBtn) $navigateBtn.classList.remove('d-none');
  if ($email) $email.textContent = email;
  if ($url) $url.value = urlString;

  if ($copyBtn) {
    $copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(urlString).catch(() => {});
      const originalHTML = $copyBtn.innerHTML;
      $copyBtn.innerHTML = `${getPrerenderedIcon('circle-check', 'fa-sm')}`;
      $copyBtn.classList.add('btn-success');
      $copyBtn.classList.remove('btn-outline-adaptive');
      setTimeout(() => {
        $copyBtn.innerHTML = originalHTML;
        $copyBtn.classList.remove('btn-success');
        $copyBtn.classList.add('btn-outline-adaptive');
      }, 1500);
    };
  }

  if ($navigateBtn) {
    $navigateBtn.onclick = () => {
      window.open(urlString, '_blank', 'noopener');
    };
  }
}

function showSignInAsModalError(message) {
  const $loading = document.getElementById('signin-as-loading');
  const $ready = document.getElementById('signin-as-ready');
  const $error = document.getElementById('signin-as-error');
  const $errorMessage = document.getElementById('signin-as-error-message');
  const $navigateBtn = document.getElementById('btn-signin-as-navigate');

  if ($loading) $loading.classList.add('d-none');
  if ($ready) $ready.classList.add('d-none');
  if ($error) $error.classList.remove('d-none');
  if ($navigateBtn) $navigateBtn.classList.add('d-none');
  if ($errorMessage) $errorMessage.textContent = message;
}

async function deleteUser(uid, email) {
  if (!confirm(`Delete user ${email} (${uid})?\n\nThis will permanently delete their account and cannot be undone.`)) {
    return;
  }

  try {
    await authorizedFetch(`${omega.getApiUrl()}/omega/user`, {
      method: 'DELETE',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
      body: { uid: uid },
    });

    // Remove from results and re-render
    rows = rows.filter((u) => u.uid !== uid);

    if (rows.length === 0) {
      showEmpty(currentSearch ? 'No users match your search' : 'No users yet');
    } else {
      renderUsers();
    }
  } catch (error) {
    console.error('Failed to delete user:', error);
    alert(`Failed to delete user: ${error.message || 'Unknown error'}`);
  }
}

async function editUser(uid, email) {
  editingUid = uid;

  // Populate read-only fields
  const $uid = document.getElementById('edit-uid');
  const $email = document.getElementById('edit-email');
  if ($uid) $uid.value = uid;
  if ($email) $email.value = email || '';

  // Clear editable fields until the full doc arrives
  const $admin = document.getElementById('edit-role-admin');
  const $plan = document.getElementById('edit-plan');
  const $expires = document.getElementById('edit-expires');
  if ($admin) $admin.checked = false;
  if ($plan) $plan.value = '';
  if ($expires) $expires.value = '';

  // Init FormManager on first use
  if (!editFormManager) {
    initEditForm();
  } else {
    editFormManager.reset();
  }

  const modal = new bootstrap.Modal(document.getElementById('user-edit-modal'));
  modal.show();

  // Fill from the full Firestore doc
  try {
    const userData = await fetchFullUser(uid);

    if ($admin) $admin.checked = !!userData?.roles?.admin;
    if ($plan) $plan.value = userData?.subscription?.product?.id || 'basic';

    if ($expires) {
      const expiresUNIX = userData?.subscription?.expires?.timestampUNIX;
      $expires.value = expiresUNIX ? new Date(expiresUNIX * 1000).toISOString().split('T')[0] : '';
    }
  } catch (error) {
    console.error('Failed to load user for editing:', error);
  }
}

function initEditForm() {
  editFormManager = new FormManager('#user-edit-form', {
    allowResubmit: true,
    submittingText: 'Saving...',
  });

  editFormManager.on('submit', async ({ data }) => {
    if (!editingUid) {
      return;
    }

    const firestore = omega.firestore();

    // Build the update document
    const update = {
      roles: {
        admin: !!data?.roles?.admin,
      },
      subscription: {
        product: {
          id: data?.subscription?.product?.id?.trim() || 'basic',
        },
      },
    };

    // Handle expiry date
    const expiresDate = data?.subscription?.expires?.date;
    if (expiresDate) {
      const expiresTimestamp = Math.floor(new Date(expiresDate + 'T23:59:59').getTime() / 1000);
      update.subscription.expires = {
        timestamp: new Date(expiresTimestamp * 1000).toISOString(),
        timestampUNIX: expiresTimestamp,
      };
    }

    await firestore.doc(`users/${editingUid}`).set(update, { merge: true });

    // Update the cached directory row
    const row = rows.find((u) => u.uid === editingUid);
    if (row) {
      row.plan = update.subscription.product.id;
      row.roles = { ...row.roles, ...update.roles };
    }

    // Close modal and re-render
    bootstrap.Modal.getInstance(document.getElementById('user-edit-modal'))?.hide();
    renderUsers();

    editFormManager.showSuccess('User updated');
  });
}

// UI state helpers
function showLoading() {
  hideAll();
  const $loading = document.getElementById('users-loading');
  if ($loading) $loading.classList.remove('d-none');
}

function showEmpty(message) {
  hideAll();
  const $empty = document.getElementById('users-empty');
  if ($empty) {
    $empty.classList.remove('d-none');
    $empty.textContent = message || 'No users found';
  }
}

function setLoadMoreBusy(busy) {
  const $loadMore = document.getElementById('btn-load-more');
  if (!$loadMore) {
    return;
  }

  $loadMore.disabled = busy;
  const $text = $loadMore.querySelector('.button-text');
  if ($text) {
    $text.textContent = busy ? 'Loading...' : 'Load more';
  }
}

function hideAll() {
  ['users-loading', 'users-empty'].forEach((id) => {
    const $el = document.getElementById(id);
    if ($el) $el.classList.add('d-none');
  });
  const $table = document.getElementById('users-table');
  const $footer = document.getElementById('users-footer');
  if ($table) $table.classList.add('d-none');
  if ($footer) $footer.classList.add('d-none');
}
