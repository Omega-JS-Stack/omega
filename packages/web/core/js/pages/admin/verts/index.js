/**
 * Admin Verts Index Page JavaScript
 *
 * House vert inventory management (docs/web/ads-system.md phase 3): lists the
 * verts collection through the admin CRUD routes (GET/POST/PUT/DELETE
 * /omega/verts — the serve route's inventory), with a single editor modal
 * for create + edit, an enable/disable toggle, and delete. Images ride
 * the posts-editor convention: a plain URL the backend serves as-is.
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
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
      fetchVerts();
    });

    return resolve();
  });
};

// Wire refresh + new-vert
function initControls() {
  const $refresh = document.getElementById('btn-refresh-verts');
  if ($refresh) {
    $refresh.addEventListener('click', () => fetchVerts());
  }

  const $new = document.getElementById('btn-new-vert');
  if ($new) {
    $new.addEventListener('click', () => openEditor(null));
  }
}

// Fetch the full inventory from the admin CRUD route
async function fetchVerts() {
  showLoading();

  try {
    const url = new URL(`${omega.getApiUrl()}/omega/verts`);
    url.searchParams.set('limit', 100);

    const response = await omega.request(url.toString(), {
      method: 'GET',
      timeout: 30000,
      tries: 1,
      log: true,
    });

    rows = Array.isArray(response?.verts) ? response.verts : [];

    updateStats();

    if (rows.length === 0) {
      showEmpty('No verts yet');
      return;
    }

    renderVerts();
  } catch (error) {
    console.error('Failed to load verts:', error);
    showEmpty(`Failed to load verts: ${error.message || 'Unknown error'}`);
  }
}

// Stat cells are computed from the fetched inventory (the verts collection is
// route-only by rules — no client Firestore counts)
function updateStats() {
  const enabled = rows.filter((vert) => vert.enabled !== false).length;

  setStat('stat-total-verts', rows.length);
  setStat('stat-enabled-verts', enabled);
  setStat('stat-disabled-verts', rows.length - enabled);
}

function setStat(id, value) {
  const $el = document.getElementById(id);
  if ($el) {
    $el.textContent = String(value);
  }
}

// Render verts table
function renderVerts() {
  const $loading = document.getElementById('verts-loading');
  const $empty = document.getElementById('verts-empty');
  const $table = document.getElementById('verts-table');
  const $tbody = document.getElementById('verts-tbody');
  const $footer = document.getElementById('verts-footer');
  const $count = document.getElementById('verts-count');

  if ($loading) $loading.classList.add('d-none');
  if ($empty) $empty.classList.add('d-none');
  if ($table) $table.classList.remove('d-none');
  if ($footer) $footer.classList.remove('d-none');
  if ($tbody) $tbody.innerHTML = '';

  rows.forEach((vert) => {
    $tbody.appendChild(renderRow(vert));
  });

  if ($count) {
    $count.textContent = `${rows.length} vert${rows.length !== 1 ? 's' : ''} in inventory`;
  }
}

// Build one inventory row
function renderRow(vert) {
  const escape = omega.utilities().escapeHTML;
  const enabled = vert.enabled !== false;

  // Link cell — the destination host
  let linkHost = '—';
  try {
    linkHost = new URL(vert.link).host;
  } catch (e) {
    linkHost = vert.link || '—';
  }

  // Targeting cell — flattened tag chips (first 3 + overflow count)
  const tags = []
    .concat(vert.targeting?.sites || [], vert.targeting?.categories || [], vert.targeting?.keywords || [])
    .filter(Boolean);
  const chips = tags.slice(0, 3)
    .map((tag) => `<span class="classy-chip">${escape(String(tag))}</span>`)
    .join(' ');
  const overflow = tags.length > 3
    ? ` <span class="text-muted small">+${tags.length - 3}</span>`
    : '';
  const lists = (vert.whitelist?.length || vert.blacklist?.length)
    ? `<div class="text-muted mt-1" style="font-size: 0.7rem;">WL ${vert.whitelist?.length || 0} · BL ${vert.blacklist?.length || 0}</div>`
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
        <span class="classy-icon-chip classy-icon-chip--neutral">${getPrerenderedIcon('rectangle-list', 'fa-sm')}</span>
        <div class="min-w-0">
          <div class="text-truncate fw-semibold" style="max-width: 220px;">${escape(vert.title || 'Untitled')}</div>
          <div class="font-monospace text-muted text-truncate" style="max-width: 220px; font-size: 0.7rem;">${escape(vert.id || '')}</div>
        </div>
      </div>
    </td>
    <td class="text-muted small">${escape(linkHost)}</td>
    <td>${targetingCell}</td>
    <td class="text-muted small">${escape(String(vert.weight || 1))}</td>
    <td>${statusCell}</td>
    <td>
      <div class="dropdown">
        <button class="classy-iconbtn" type="button" data-bs-toggle="dropdown" aria-label="Vert actions">
          ${getPrerenderedIcon('ellipsis-vertical', 'fa-sm')}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item small btn-edit-vert" href="#">
            ${getPrerenderedIcon('pen', 'fa-sm me-2')}
            Edit vert
          </a></li>
          <li><a class="dropdown-item small btn-toggle-vert" href="#">
            ${enabled
              ? `${getPrerenderedIcon('toggle-off', 'fa-sm me-2')} Disable vert`
              : `${getPrerenderedIcon('toggle-on', 'fa-sm me-2')} Enable vert`}
          </a></li>
          <li><hr class="dropdown-divider"></li>
          <li><a class="dropdown-item small text-danger btn-delete-vert" href="#">
            ${getPrerenderedIcon('trash', 'fa-sm me-2')}
            Delete vert
          </a></li>
        </ul>
      </div>
    </td>
  `;

  // Wire up action buttons
  $row.querySelector('.btn-edit-vert').addEventListener('click', (e) => {
    e.preventDefault();
    openEditor(vert);
  });

  $row.querySelector('.btn-toggle-vert').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAd(vert);
  });

  $row.querySelector('.btn-delete-vert').addEventListener('click', (e) => {
    e.preventDefault();
    deleteAd(vert);
  });

  return $row;
}

// ============================================
// Vert Actions
// ============================================

// Open the editor modal for create (vert = null) or edit
function openEditor(vert) {
  editingId = vert?.id || null;

  const $label = document.getElementById('vert-editor-modal-label');
  if ($label) {
    $label.textContent = vert ? 'Edit vert' : 'New vert';
  }

  // Init FormManager on first use
  if (!editorFormManager) {
    initEditorForm();
  } else {
    editorFormManager.reset();
  }

  // Populate from the fetched row (the list carries full docs)
  setField('vert-enabled', vert ? vert.enabled !== false : true);
  setField('vert-title', vert?.title || '');
  setField('vert-description', vert?.description || '');
  setField('vert-button', vert?.button || '');
  setField('vert-weight', vert?.weight || 1);
  setField('vert-link', vert?.link || '');
  setField('vert-image', vert?.image || '');
  setField('vert-footer', vert?.footer || '');
  setField('vert-targeting-sites', (vert?.targeting?.sites || []).join(', '));
  setField('vert-targeting-categories', (vert?.targeting?.categories || []).join(', '));
  setField('vert-targeting-keywords', (vert?.targeting?.keywords || []).join(', '));
  setField('vert-whitelist', (vert?.whitelist || []).join(', '));
  setField('vert-blacklist', (vert?.blacklist || []).join(', '));

  const modal = new bootstrap.Modal(document.getElementById('vert-editor-modal'));
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
  editorFormManager = new FormManager('#vert-editor-form', {
    allowResubmit: true,
    submittingText: 'Saving...',
  });

  editorFormManager.on('submit', async ({ data }) => {
    const vert = data?.vert || {};

    const payload = {
      enabled: !!vert.enabled,
      title: (vert.title || '').trim(),
      description: (vert.description || '').trim(),
      button: (vert.button || '').trim(),
      link: (vert.link || '').trim(),
      image: (vert.image || '').trim(),
      footer: (vert.footer || '').trim(),
      weight: parseInt(vert.weight, 10) || 1,
      targeting: {
        sites: parseList(vert.targeting?.sites),
        categories: parseList(vert.targeting?.categories),
        keywords: parseList(vert.targeting?.keywords),
      },
      whitelist: parseList(vert.whitelist),
      blacklist: parseList(vert.blacklist),
    };

    if (editingId) {
      payload.id = editingId;
    }

    try {
      await omega.request(`/omega/verts`, {
        method: editingId ? 'PUT' : 'POST',
        timeout: 30000,
        tries: 1,
        log: true,
        body: payload,
      });

      // Close modal and reload the inventory
      bootstrap.Modal.getInstance(document.getElementById('vert-editor-modal'))?.hide();
      editorFormManager.showSuccess(editingId ? 'Vert updated' : 'Vert created');

      await fetchVerts();
    } catch (error) {
      console.error('Failed to save vert:', error);
      alert(`Failed to save vert: ${error.message || 'Unknown error'}`);
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

async function toggleAd(vert) {
  const enabled = !(vert.enabled !== false);

  try {
    await omega.request(`/omega/verts`, {
      method: 'PUT',
      timeout: 30000,
      tries: 1,
      log: true,
      body: { id: vert.id, enabled: enabled },
    });

    // Reflect the new state in the cached row
    vert.enabled = enabled;

    updateStats();
    renderVerts();
  } catch (error) {
    console.error('Failed to update vert:', error);
    alert(`Failed to ${enabled ? 'enable' : 'disable'} vert: ${error.message || 'Unknown error'}`);
  }
}

async function deleteAd(vert) {
  if (!confirm(`Delete vert "${vert.title || vert.id}"?\n\nIt will stop serving immediately and cannot be recovered.`)) {
    return;
  }

  try {
    await omega.request(`/omega/verts`, {
      method: 'DELETE',
      timeout: 30000,
      tries: 1,
      log: true,
      body: { id: vert.id },
    });

    // Remove from results and re-render
    rows = rows.filter((item) => item.id !== vert.id);

    updateStats();

    if (rows.length === 0) {
      showEmpty('No verts yet');
    } else {
      renderVerts();
    }
  } catch (error) {
    console.error('Failed to delete vert:', error);
    alert(`Failed to delete vert: ${error.message || 'Unknown error'}`);
  }
}

// UI state helpers
function showLoading() {
  hideAll();
  const $loading = document.getElementById('verts-loading');
  if ($loading) $loading.classList.remove('d-none');
}

function showEmpty(message) {
  hideAll();
  const $empty = document.getElementById('verts-empty');
  if ($empty) {
    $empty.classList.remove('d-none');
    $empty.textContent = message || 'No verts yet';
  }
}

function hideAll() {
  ['verts-loading', 'verts-empty'].forEach((id) => {
    const $el = document.getElementById(id);
    if ($el) $el.classList.add('d-none');
  });
  const $table = document.getElementById('verts-table');
  const $footer = document.getElementById('verts-footer');
  if ($table) $table.classList.add('d-none');
  if ($footer) $footer.classList.add('d-none');
}
