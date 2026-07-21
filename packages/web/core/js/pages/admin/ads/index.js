/**
 * Admin Ads Index Page JavaScript
 *
 * House ad inventory management (plans/ads-system.md phase 3): lists the
 * ads collection through the admin CRUD routes (GET/POST/PUT/DELETE
 * /omega/ads — the serve route's inventory), with a single editor modal
 * for create + edit, an enable/disable toggle, and delete. Images ride
 * the posts-editor convention: a plain URL the backend serves as-is.
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import omega from '@omega.js/client';

// State
let editorFormManager = null;
let editingId = null;
let rows = [];

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    omega.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      initControls();
      fetchAds();
    });

    return resolve();
  });
};

// Wire refresh + new-ad
function initControls() {
  const $refresh = document.getElementById('btn-refresh-ads');
  if ($refresh) {
    $refresh.addEventListener('click', () => fetchAds());
  }

  const $new = document.getElementById('btn-new-ad');
  if ($new) {
    $new.addEventListener('click', () => openEditor(null));
  }
}

// Fetch the full inventory from the admin CRUD route
async function fetchAds() {
  showLoading();

  try {
    const url = new URL(`${omega.getApiUrl()}/omega/ads`);
    url.searchParams.set('limit', 100);

    const response = await authorizedFetch(url.toString(), {
      method: 'GET',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
    });

    rows = Array.isArray(response?.ads) ? response.ads : [];

    updateStats();

    if (rows.length === 0) {
      showEmpty('No ads yet');
      return;
    }

    renderAds();
  } catch (error) {
    console.error('Failed to load ads:', error);
    showEmpty(`Failed to load ads: ${error.message || 'Unknown error'}`);
  }
}

// Stat cells are computed from the fetched inventory (the ads collection is
// route-only by rules — no client Firestore counts)
function updateStats() {
  const enabled = rows.filter((ad) => ad.enabled !== false).length;

  setStat('stat-total-ads', rows.length);
  setStat('stat-enabled-ads', enabled);
  setStat('stat-disabled-ads', rows.length - enabled);
}

function setStat(id, value) {
  const $el = document.getElementById(id);
  if ($el) {
    $el.textContent = String(value);
  }
}

// Render ads table
function renderAds() {
  const $loading = document.getElementById('ads-loading');
  const $empty = document.getElementById('ads-empty');
  const $table = document.getElementById('ads-table');
  const $tbody = document.getElementById('ads-tbody');
  const $footer = document.getElementById('ads-footer');
  const $count = document.getElementById('ads-count');

  if ($loading) $loading.classList.add('d-none');
  if ($empty) $empty.classList.add('d-none');
  if ($table) $table.classList.remove('d-none');
  if ($footer) $footer.classList.remove('d-none');
  if ($tbody) $tbody.innerHTML = '';

  rows.forEach((ad) => {
    $tbody.appendChild(renderRow(ad));
  });

  if ($count) {
    $count.textContent = `${rows.length} ad${rows.length !== 1 ? 's' : ''} in inventory`;
  }
}

// Build one inventory row
function renderRow(ad) {
  const escape = omega.utilities().escapeHTML;
  const enabled = ad.enabled !== false;

  // Link cell — the destination host
  let linkHost = '—';
  try {
    linkHost = new URL(ad.link).host;
  } catch (e) {
    linkHost = ad.link || '—';
  }

  // Targeting cell — flattened tag chips (first 3 + overflow count)
  const tags = []
    .concat(ad.targeting?.sites || [], ad.targeting?.categories || [], ad.targeting?.keywords || [])
    .filter(Boolean);
  const chips = tags.slice(0, 3)
    .map((tag) => `<span class="classy-chip">${escape(String(tag))}</span>`)
    .join(' ');
  const overflow = tags.length > 3
    ? ` <span class="text-muted small">+${tags.length - 3}</span>`
    : '';
  const lists = (ad.whitelist?.length || ad.blacklist?.length)
    ? `<div class="text-muted mt-1" style="font-size: 0.7rem;">WL ${ad.whitelist?.length || 0} · BL ${ad.blacklist?.length || 0}</div>`
    : '';
  const targetingCell = tags.length
    ? `${chips}${overflow}${lists}`
    : `<span class="text-muted small">—</span>${lists}`;

  // Status cell — dot + label (never color alone)
  const statusCell = enabled
    ? '<span class="classy-status"><span class="classy-dot classy-dot--ok"></span>Enabled</span>'
    : '<span class="classy-status"><span class="classy-dot"></span>Disabled</span>';

  const $row = document.createElement('tr');
  $row.innerHTML = `
    <td>
      <div class="d-flex align-items-center gap-2">
        <span class="classy-icon-chip classy-icon-chip--neutral">${getPrerenderedIcon('rectangle-ad', 'fa-sm')}</span>
        <div class="min-w-0">
          <div class="text-truncate fw-semibold" style="max-width: 220px;">${escape(ad.title || 'Untitled')}</div>
          <div class="font-monospace text-muted text-truncate" style="max-width: 220px; font-size: 0.7rem;">${escape(ad.id || '')}</div>
        </div>
      </div>
    </td>
    <td class="text-muted small">${escape(linkHost)}</td>
    <td>${targetingCell}</td>
    <td class="text-muted small">${escape(String(ad.weight || 1))}</td>
    <td>${statusCell}</td>
    <td>
      <div class="dropdown">
        <button class="classy-iconbtn" type="button" data-bs-toggle="dropdown" aria-label="Ad actions">
          ${getPrerenderedIcon('ellipsis-vertical', 'fa-sm')}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item small btn-edit-ad" href="#">
            ${getPrerenderedIcon('pen', 'fa-sm me-2')}
            Edit ad
          </a></li>
          <li><a class="dropdown-item small btn-toggle-ad" href="#">
            ${enabled
              ? `${getPrerenderedIcon('toggle-off', 'fa-sm me-2')} Disable ad`
              : `${getPrerenderedIcon('toggle-on', 'fa-sm me-2')} Enable ad`}
          </a></li>
          <li><hr class="dropdown-divider"></li>
          <li><a class="dropdown-item small text-danger btn-delete-ad" href="#">
            ${getPrerenderedIcon('trash', 'fa-sm me-2')}
            Delete ad
          </a></li>
        </ul>
      </div>
    </td>
  `;

  // Wire up action buttons
  $row.querySelector('.btn-edit-ad').addEventListener('click', (e) => {
    e.preventDefault();
    openEditor(ad);
  });

  $row.querySelector('.btn-toggle-ad').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAd(ad);
  });

  $row.querySelector('.btn-delete-ad').addEventListener('click', (e) => {
    e.preventDefault();
    deleteAd(ad);
  });

  return $row;
}

// ============================================
// Ad Actions
// ============================================

// Open the editor modal for create (ad = null) or edit
function openEditor(ad) {
  editingId = ad?.id || null;

  const $label = document.getElementById('ad-editor-modal-label');
  if ($label) {
    $label.textContent = ad ? 'Edit ad' : 'New ad';
  }

  // Init FormManager on first use
  if (!editorFormManager) {
    initEditorForm();
  } else {
    editorFormManager.reset();
  }

  // Populate from the fetched row (the list carries full docs)
  setField('ad-enabled', ad ? ad.enabled !== false : true);
  setField('ad-title', ad?.title || '');
  setField('ad-description', ad?.description || '');
  setField('ad-button', ad?.button || '');
  setField('ad-weight', ad?.weight || 1);
  setField('ad-link', ad?.link || '');
  setField('ad-image', ad?.image || '');
  setField('ad-footer', ad?.footer || '');
  setField('ad-targeting-sites', (ad?.targeting?.sites || []).join(', '));
  setField('ad-targeting-categories', (ad?.targeting?.categories || []).join(', '));
  setField('ad-targeting-keywords', (ad?.targeting?.keywords || []).join(', '));
  setField('ad-whitelist', (ad?.whitelist || []).join(', '));
  setField('ad-blacklist', (ad?.blacklist || []).join(', '));

  const modal = new bootstrap.Modal(document.getElementById('ad-editor-modal'));
  modal.show();
}

function setField(id, value) {
  const $el = document.getElementById(id);
  if (!$el) {
    return;
  }

  if ($el.type === 'checkbox') {
    $el.checked = value === true;
  } else {
    $el.value = value;
  }
}

function initEditorForm() {
  editorFormManager = new FormManager('#ad-editor-form', {
    allowResubmit: true,
    submittingText: 'Saving...',
  });

  editorFormManager.on('submit', async ({ data }) => {
    const ad = data?.ad || {};

    const payload = {
      enabled: !!ad.enabled,
      title: (ad.title || '').trim(),
      description: (ad.description || '').trim(),
      button: (ad.button || '').trim(),
      link: (ad.link || '').trim(),
      image: (ad.image || '').trim(),
      footer: (ad.footer || '').trim(),
      weight: parseInt(ad.weight, 10) || 1,
      targeting: {
        sites: parseList(ad.targeting?.sites),
        categories: parseList(ad.targeting?.categories),
        keywords: parseList(ad.targeting?.keywords),
      },
      whitelist: parseList(ad.whitelist),
      blacklist: parseList(ad.blacklist),
    };

    if (editingId) {
      payload.id = editingId;
    }

    try {
      await authorizedFetch(`${omega.getApiUrl()}/omega/ads`, {
        method: editingId ? 'PUT' : 'POST',
        timeout: 30000,
        response: 'json',
        tries: 1,
        log: true,
        body: payload,
      });

      // Close modal and reload the inventory
      bootstrap.Modal.getInstance(document.getElementById('ad-editor-modal'))?.hide();
      editorFormManager.showSuccess(editingId ? 'Ad updated' : 'Ad created');

      await fetchAds();
    } catch (error) {
      console.error('Failed to save ad:', error);
      alert(`Failed to save ad: ${error.message || 'Unknown error'}`);
    }
  });
}

// Comma-separated input → trimmed array
function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function toggleAd(ad) {
  const enabled = !(ad.enabled !== false);

  try {
    await authorizedFetch(`${omega.getApiUrl()}/omega/ads`, {
      method: 'PUT',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
      body: { id: ad.id, enabled: enabled },
    });

    // Reflect the new state in the cached row
    ad.enabled = enabled;

    updateStats();
    renderAds();
  } catch (error) {
    console.error('Failed to update ad:', error);
    alert(`Failed to ${enabled ? 'enable' : 'disable'} ad: ${error.message || 'Unknown error'}`);
  }
}

async function deleteAd(ad) {
  if (!confirm(`Delete ad "${ad.title || ad.id}"?\n\nIt will stop serving immediately and cannot be recovered.`)) {
    return;
  }

  try {
    await authorizedFetch(`${omega.getApiUrl()}/omega/ads`, {
      method: 'DELETE',
      timeout: 30000,
      response: 'json',
      tries: 1,
      log: true,
      body: { id: ad.id },
    });

    // Remove from results and re-render
    rows = rows.filter((item) => item.id !== ad.id);

    updateStats();

    if (rows.length === 0) {
      showEmpty('No ads yet');
    } else {
      renderAds();
    }
  } catch (error) {
    console.error('Failed to delete ad:', error);
    alert(`Failed to delete ad: ${error.message || 'Unknown error'}`);
  }
}

// UI state helpers
function showLoading() {
  hideAll();
  const $loading = document.getElementById('ads-loading');
  if ($loading) $loading.classList.remove('d-none');
}

function showEmpty(message) {
  hideAll();
  const $empty = document.getElementById('ads-empty');
  if ($empty) {
    $empty.classList.remove('d-none');
    $empty.textContent = message || 'No ads yet';
  }
}

function hideAll() {
  ['ads-loading', 'ads-empty'].forEach((id) => {
    const $el = document.getElementById(id);
    if ($el) $el.classList.add('d-none');
  });
  const $table = document.getElementById('ads-table');
  const $footer = document.getElementById('ads-footer');
  if ($table) $table.classList.add('d-none');
  if ($footer) $footer.classList.add('d-none');
}
