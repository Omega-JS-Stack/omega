/**
 * Admin Users Index Page JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import { formatTimeAgo, capitalize, setStatValue, setStatSubValue } from '__main_assets__/js/libs/admin-helpers.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import webManager from 'web-manager';

// State
let formManager = null;
let editFormManager = null;
let editingUid = null;
let searchResults = [];

const SEARCH_LIMIT = 50;

// Module
export default () => {
  return new Promise(async function (resolve) {
    await webManager.dom().ready();

    webManager.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      initForm();
      loadStatCards();
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
    const term = data?.search?.query?.trim();
    if (!term) {
      return;
    }

    showLoading();
    await searchUsers(term);
  });
}

// Load stat card counts
async function loadStatCards() {
  const { collection, query, where, getCountFromServer } = await import('firebase/firestore');
  const db = webManager.firebaseFirestore;
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

// Search users by email prefix or UID prefix
// Uses Firestore >= / \uf8ff range trick for prefix matching on both
async function searchUsers(term) {
  const firestore = webManager.firestore();
  const results = new Map();
  const prefixEnd = term + '\uf8ff';

  // Run email prefix search and UID prefix search in parallel
  await Promise.allSettled([
    // 1) Email prefix match
    firestore.collection('users')
      .where('auth.email', '>=', term)
      .where('auth.email', '<=', prefixEnd)
      .limit(SEARCH_LIMIT)
      .get()
      .then((snapshot) => {
        snapshot.docs.forEach((doc) => {
          results.set(doc.id, { id: doc.id, ...doc.data() });
        });
      }),

    // 2) UID prefix match
    firestore.collection('users')
      .where('__name__', '>=', term)
      .where('__name__', '<=', prefixEnd)
      .limit(SEARCH_LIMIT)
      .get()
      .then((snapshot) => {
        snapshot.docs.forEach((doc) => {
          results.set(doc.id, { id: doc.id, ...doc.data() });
        });
      }),
  ]);

  searchResults = Array.from(results.values());

  if (searchResults.length === 0) {
    showEmpty('No users match your search');
    return;
  }

  renderUsers();
}

// Render users table
function renderUsers() {
  const $prompt = document.getElementById('users-prompt');
  const $loading = document.getElementById('users-loading');
  const $empty = document.getElementById('users-empty');
  const $table = document.getElementById('users-table');
  const $tbody = document.getElementById('users-tbody');
  const $footer = document.getElementById('users-footer');
  const $count = document.getElementById('users-count');

  if ($loading) $loading.classList.add('d-none');
  if ($prompt) $prompt.classList.add('d-none');
  if ($empty) $empty.classList.add('d-none');
  if ($table) $table.classList.remove('d-none');
  if ($footer) $footer.classList.remove('d-none');
  if ($tbody) $tbody.innerHTML = '';

  searchResults.forEach((user) => {
    const email = user?.auth?.email || 'Unknown';
    const uid = user.id;
    const resolved = webManager.auth().resolveSubscription(user);
    const plan = resolved.plan;
    const isPaid = plan !== 'basic';
    const expiresUNIX = user?.subscription?.expires?.timestampUNIX;
    const updatedUNIX = user?.metadata?.updated?.timestampUNIX;

    let expiresText = '—';
    if (expiresUNIX) {
      const now = Math.floor(Date.now() / 1000);
      if (expiresUNIX < now) {
        expiresText = 'Expired';
      } else {
        expiresText = new Date(expiresUNIX * 1000).toLocaleDateString();
      }
    }

    const updatedText = updatedUNIX ? formatTimeAgo(updatedUNIX * 1000) : '—';
    const badgeClass = isPaid ? 'bg-success text-white' : 'bg-body-tertiary text-body';

    const $row = document.createElement('tr');
    $row.innerHTML = `
      <td>
        <div class="d-flex align-items-center">
          ${getPrerenderedIcon('user', 'fa-sm me-2 text-muted')}
          <div>
            <div class="text-truncate" style="max-width: 220px;">${webManager.utilities().escapeHTML(email)}</div>
            <div class="font-monospace text-muted text-truncate" style="max-width: 220px; font-size: 0.7rem;">${webManager.utilities().escapeHTML(uid)}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${badgeClass}">${webManager.utilities().escapeHTML(capitalize(plan))}</span></td>
      <td class="small ${expiresText === 'Expired' ? 'text-danger' : 'text-muted'}">${expiresText}</td>
      <td class="text-muted small">${updatedText}</td>
      <td>
        <div class="dropdown">
          <button class="btn btn-sm btn-adaptive rounded-circle" type="button" data-bs-toggle="dropdown">
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
      viewUser(uid, user);
    });

    $row.querySelector('.btn-edit-user').addEventListener('click', (e) => {
      e.preventDefault();
      editUser(uid, user);
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

    $row.querySelector('.btn-delete-user').addEventListener('click', (e) => {
      e.preventDefault();
      deleteUser(uid, email);
    });

    $tbody.appendChild($row);
  });

  if ($count) {
    $count.textContent = `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`;
  }
}

// ============================================
// User Actions
// ============================================
function viewUser(uid, userData) {
  const $label = document.getElementById('user-detail-modal-label');
  const $json = document.getElementById('user-detail-json');

  if ($label) {
    $label.textContent = `${userData?.auth?.email || uid}`;
  }

  if ($json) {
    $json.textContent = JSON.stringify(userData, null, 2);
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

  // Show modal
  const modal = new bootstrap.Modal(document.getElementById('user-detail-modal'));
  modal.show();
}

async function signInAsUser(uid, email) {
  openSignInAsModalLoading(email);

  try {
    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user/token`, {
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
    signinUrl.searchParams.set('authReturnUrl', '/dashboard');

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
    await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user`, {
      method: 'DELETE',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
      body: { uid: uid },
    });

    // Remove from results and re-render
    searchResults = searchResults.filter((u) => u.id !== uid);

    if (searchResults.length === 0) {
      showEmpty('No users match your search');
    } else {
      renderUsers();
    }
  } catch (error) {
    console.error('Failed to delete user:', error);
    alert(`Failed to delete user: ${error.message || 'Unknown error'}`);
  }
}

function editUser(uid, userData) {
  editingUid = uid;

  // Populate read-only fields
  const $uid = document.getElementById('edit-uid');
  const $email = document.getElementById('edit-email');
  if ($uid) $uid.value = uid;
  if ($email) $email.value = userData?.auth?.email || '';

  // Populate editable fields
  const $admin = document.getElementById('edit-role-admin');
  if ($admin) $admin.checked = !!userData?.roles?.admin;

  const $plan = document.getElementById('edit-plan');
  if ($plan) $plan.value = userData?.subscription?.product?.id || 'basic';

  const $expires = document.getElementById('edit-expires');
  if ($expires) {
    const expiresUNIX = userData?.subscription?.expires?.timestampUNIX;
    if (expiresUNIX) {
      $expires.value = new Date(expiresUNIX * 1000).toISOString().split('T')[0];
    } else {
      $expires.value = '';
    }
  }

  // Init FormManager on first use
  if (!editFormManager) {
    initEditForm();
  } else {
    editFormManager.reset();
  }

  const modal = new bootstrap.Modal(document.getElementById('user-edit-modal'));
  modal.show();
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

    const firestore = webManager.firestore();

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

    // Update local search results cache
    const idx = searchResults.findIndex((u) => u.id === editingUid);
    if (idx !== -1) {
      // Deep merge the update into cached user
      const user = searchResults[idx];
      user.roles = { ...user.roles, ...update.roles };
      user.subscription = user.subscription || {};
      user.subscription.product = { ...user.subscription.product, ...update.subscription.product };
      if (update.subscription.expires) {
        user.subscription.expires = { ...user.subscription.expires, ...update.subscription.expires };
      }
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

function hideAll() {
  ['users-loading', 'users-empty', 'users-prompt'].forEach((id) => {
    const $el = document.getElementById(id);
    if ($el) $el.classList.add('d-none');
  });
  const $table = document.getElementById('users-table');
  const $footer = document.getElementById('users-footer');
  if ($table) $table.classList.add('d-none');
  if ($footer) $footer.classList.add('d-none');
}
